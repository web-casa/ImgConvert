// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Batch progress contract between the backend coordinator and a shell.
//!
//! The coordinator thread calls [`ProgressSink::send`]; the shell owns the
//! receiving side. `Err(SinkClosed)` means the receiver is gone or failed, and
//! the coordinator cancels the batch and ends it with an error. That is the
//! existing product semantics and must not change without its own decision.

use std::collections::VecDeque;
use std::fmt;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::convert::BatchProgressEvent;

/// Identifies one batch for the lifetime of the process. Shells drop events
/// whose id does not match the batch they are displaying.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct BatchId(u64);

impl BatchId {
    pub const fn new(raw: u64) -> Self {
        Self(raw)
    }

    pub const fn raw(self) -> u64 {
        self.0
    }
}

impl fmt::Display for BatchId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "batch#{}", self.0)
    }
}

/// The receiving side is closed or stopped consuming; the batch must abort.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SinkClosed;

impl fmt::Display for SinkClosed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("progress receiver closed")
    }
}

impl std::error::Error for SinkClosed {}

/// Delivers batch events to the shell. Only the backend coordinator thread
/// calls `send`; a UI thread must never call it.
///
/// Reliable events (`Started`, `FileStarted`, `FileFinished`, `FileSkipped`,
/// `FileError`, `Cancelled`, `Finished`) must keep their order and must not be
/// dropped. `FileProgress` may be coalesced per index and must never block.
pub trait ProgressSink: Send + Sync {
    fn send(&self, batch_id: BatchId, event: BatchProgressEvent) -> Result<(), SinkClosed>;
}

impl<S: ProgressSink + ?Sized> ProgressSink for Arc<S> {
    fn send(&self, batch_id: BatchId, event: BatchProgressEvent) -> Result<(), SinkClosed> {
        (**self).send(batch_id, event)
    }
}

impl<S: ProgressSink + ?Sized> ProgressSink for &S {
    fn send(&self, batch_id: BatchId, event: BatchProgressEvent) -> Result<(), SinkClosed> {
        (**self).send(batch_id, event)
    }
}

/// Discards every event. For smoke runs and tests that do not observe progress.
#[derive(Debug, Default, Clone, Copy)]
pub struct NullSink;

impl ProgressSink for NullSink {
    fn send(&self, _batch_id: BatchId, _event: BatchProgressEvent) -> Result<(), SinkClosed> {
        Ok(())
    }
}

/// Adapts a closure (for example a Tauri `Channel::send`) to the contract.
pub struct FnSink<F>(F);

impl<F> FnSink<F>
where
    F: Fn(BatchId, BatchProgressEvent) -> Result<(), SinkClosed> + Send + Sync,
{
    pub fn new(send: F) -> Self {
        Self(send)
    }
}

impl<F> ProgressSink for FnSink<F>
where
    F: Fn(BatchId, BatchProgressEvent) -> Result<(), SinkClosed> + Send + Sync,
{
    fn send(&self, batch_id: BatchId, event: BatchProgressEvent) -> Result<(), SinkClosed> {
        (self.0)(batch_id, event)
    }
}

/// Default capacity of the reliable queue in [`ProgressChannel`].
pub const DEFAULT_RELIABLE_CAPACITY: usize = 4_096;
/// Default time a full reliable queue may block the coordinator.
pub const DEFAULT_MAX_BLOCK: Duration = Duration::from_secs(5);

/// Application-level transport for a shell that consumes events on its own
/// thread (the GPUI foreground task). Reliable events go through a bounded
/// queue; when it is full `send` blocks the coordinator for at most
/// `max_block` and then reports the receiver as failed. `FileProgress` events
/// overwrite a per-index slot and never block.
pub struct ProgressChannel {
    shared: Arc<Shared>,
}

/// Receiving half of [`ProgressChannel`]. Dropping it closes the channel and
/// makes every later `send` fail with [`SinkClosed`].
pub struct ProgressReceiver {
    shared: Arc<Shared>,
}

struct Shared {
    state: Mutex<State>,
    not_empty: Condvar,
    not_full: Condvar,
    capacity: usize,
    max_block: Duration,
}

#[derive(Default)]
struct State {
    reliable: VecDeque<(BatchId, BatchProgressEvent)>,
    /// Latest `FileProgress` per index; `dirty` keeps delivery order.
    latest_progress: Vec<Option<(BatchId, BatchProgressEvent)>>,
    dirty: VecDeque<usize>,
    receiver_closed: bool,
    /// Set once a send timed out; the receiver is treated as dead from then on.
    receiver_failed: bool,
    blocked_total: Duration,
    blocked_sends: u64,
}

/// How long the coordinator spent blocked on a full queue.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BlockingStats {
    pub blocked_total: Duration,
    pub blocked_sends: u64,
}

impl ProgressChannel {
    pub fn new() -> (Self, ProgressReceiver) {
        Self::with_limits(DEFAULT_RELIABLE_CAPACITY, DEFAULT_MAX_BLOCK)
    }

    pub fn with_limits(capacity: usize, max_block: Duration) -> (Self, ProgressReceiver) {
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
            not_empty: Condvar::new(),
            not_full: Condvar::new(),
            capacity: capacity.max(1),
            max_block,
        });
        (
            Self {
                shared: Arc::clone(&shared),
            },
            ProgressReceiver { shared },
        )
    }

    pub fn blocking_stats(&self) -> BlockingStats {
        let state = self.shared.lock();
        BlockingStats {
            blocked_total: state.blocked_total,
            blocked_sends: state.blocked_sends,
        }
    }
}

impl Shared {
    /// The queue holds no invariants a panicking holder could break, so a
    /// poisoned lock is recovered instead of failing every later send.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl ProgressSink for ProgressChannel {
    fn send(&self, batch_id: BatchId, event: BatchProgressEvent) -> Result<(), SinkClosed> {
        let shared = &*self.shared;
        let mut state = shared.lock();
        if state.receiver_closed || state.receiver_failed {
            return Err(SinkClosed);
        }
        match &event {
            BatchProgressEvent::FileProgress { index, .. } => {
                let index = *index;
                if state.latest_progress.len() <= index {
                    state.latest_progress.resize_with(index + 1, || None);
                }
                if state.latest_progress[index].is_none() {
                    state.dirty.push_back(index);
                }
                state.latest_progress[index] = Some((batch_id, event));
                shared.not_empty.notify_one();
                return Ok(());
            }
            // A file's terminal event is a barrier for that index: progress
            // coalesced earlier must not be delivered after it.
            BatchProgressEvent::FileFinished { index, .. }
            | BatchProgressEvent::FileSkipped { index, .. }
            | BatchProgressEvent::FileError { index, .. } => {
                if let Some(slot) = state.latest_progress.get_mut(*index) {
                    *slot = None;
                }
            }
            // A batch boundary is a barrier for every index: nothing from an
            // earlier batch, or from before the terminal event, may follow it.
            BatchProgressEvent::Started { .. }
            | BatchProgressEvent::Cancelled { .. }
            | BatchProgressEvent::Finished { .. } => {
                state.latest_progress.clear();
                state.dirty.clear();
            }
            BatchProgressEvent::FileStarted { .. } => {}
        }
        if state.reliable.len() >= shared.capacity {
            let started = Instant::now();
            let deadline = started + shared.max_block;
            while state.reliable.len() >= shared.capacity {
                if state.receiver_closed {
                    return Err(SinkClosed);
                }
                let now = Instant::now();
                if now >= deadline {
                    state.receiver_failed = true;
                    state.blocked_total += started.elapsed();
                    state.blocked_sends += 1;
                    shared.not_empty.notify_all();
                    return Err(SinkClosed);
                }
                let (guard, _) = shared
                    .not_full
                    .wait_timeout(state, deadline - now)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                state = guard;
            }
            state.blocked_total += started.elapsed();
            state.blocked_sends += 1;
        }
        state.reliable.push_back((batch_id, event));
        shared.not_empty.notify_one();
        Ok(())
    }
}

impl ProgressReceiver {
    /// Blocks until an event is available, every sender is gone, or the
    /// channel failed (a send timed out) and the queue is drained.
    pub fn recv(&self) -> Option<(BatchId, BatchProgressEvent)> {
        let shared = &*self.shared;
        let mut state = shared.lock();
        loop {
            if let Some(item) = Self::take(&mut state) {
                shared.not_full.notify_one();
                return Some(item);
            }
            if state.receiver_failed || Arc::strong_count(&self.shared) == 1 {
                return None;
            }
            state = shared
                .not_empty
                .wait_timeout(state, Duration::from_millis(50))
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
    }

    /// Returns immediately with the next event, if any.
    pub fn try_recv(&self) -> Option<(BatchId, BatchProgressEvent)> {
        let shared = &*self.shared;
        let mut state = shared.lock();
        let item = Self::take(&mut state);
        if item.is_some() {
            shared.not_full.notify_one();
        }
        item
    }

    /// Reliable events first, then the latest progress of each dirty index.
    fn take(state: &mut State) -> Option<(BatchId, BatchProgressEvent)> {
        if let Some(item) = state.reliable.pop_front() {
            return Some(item);
        }
        while let Some(index) = state.dirty.pop_front() {
            if let Some(item) = state.latest_progress.get_mut(index).and_then(Option::take) {
                return Some(item);
            }
        }
        None
    }
}

impl Drop for ProgressReceiver {
    fn drop(&mut self) {
        let mut state = self.shared.lock();
        state.receiver_closed = true;
        self.shared.not_full.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::{BatchProgressStage, BatchSummary};
    use std::thread;

    fn started(total: usize) -> BatchProgressEvent {
        BatchProgressEvent::Started { total }
    }

    fn progress(index: usize, percent: f64) -> BatchProgressEvent {
        BatchProgressEvent::FileProgress {
            index,
            percent,
            stage: BatchProgressStage::ReadingAndConverting,
        }
    }

    fn finished(total: usize, completed: usize) -> BatchProgressEvent {
        BatchProgressEvent::Finished {
            summary: BatchSummary {
                total,
                completed,
                skipped: 0,
                failed: total - completed,
                cancelled: false,
            },
        }
    }

    fn file_error(index: usize) -> BatchProgressEvent {
        BatchProgressEvent::FileError {
            index,
            input: format!("input-{index}"),
            error: crate::command_error::CommandError::batch_failed("boom"),
        }
    }

    fn drain(receiver: &ProgressReceiver) -> Vec<BatchProgressEvent> {
        let mut events = Vec::new();
        while let Some((_, event)) = receiver.try_recv() {
            events.push(event);
        }
        events
    }

    #[test]
    fn reliable_events_keep_order_and_progress_coalesces() {
        let (sink, receiver) = ProgressChannel::with_limits(8, Duration::from_millis(10));
        let id = BatchId::new(7);
        sink.send(id, started(2)).unwrap();
        sink.send(id, progress(0, 5.0)).unwrap();
        sink.send(id, progress(0, 50.0)).unwrap();
        sink.send(id, progress(1, 5.0)).unwrap();
        sink.send(
            id,
            BatchProgressEvent::FileStarted {
                index: 1,
                input: "b".into(),
            },
        )
        .unwrap();

        let events = drain(&receiver);
        assert!(matches!(
            events[0],
            BatchProgressEvent::Started { total: 2 }
        ));
        assert!(matches!(
            events[1],
            BatchProgressEvent::FileStarted { index: 1, .. }
        ));
        assert!(
            matches!(events[2], BatchProgressEvent::FileProgress { index: 0, percent, .. } if percent == 50.0)
        );
        assert!(matches!(
            events[3],
            BatchProgressEvent::FileProgress { index: 1, .. }
        ));
        assert_eq!(events.len(), 4);
    }

    #[test]
    fn file_terminal_event_drops_pending_progress_for_that_index() {
        let (sink, receiver) = ProgressChannel::with_limits(8, Duration::from_millis(10));
        let id = BatchId::new(1);
        sink.send(id, started(2)).unwrap();
        sink.send(id, progress(0, 5.0)).unwrap();
        sink.send(id, progress(1, 5.0)).unwrap();
        sink.send(id, file_error(0)).unwrap();

        let events = drain(&receiver);
        assert_eq!(events.len(), 3, "{events:?}");
        assert!(matches!(events[0], BatchProgressEvent::Started { .. }));
        assert!(matches!(
            events[1],
            BatchProgressEvent::FileError { index: 0, .. }
        ));
        assert!(matches!(
            events[2],
            BatchProgressEvent::FileProgress { index: 1, .. }
        ));

        // Progress for the same index after its terminal event is a new slot
        // again (the coordinator never does this, but the channel must not
        // resurrect the old value).
        sink.send(id, progress(0, 99.0)).unwrap();
        let events = drain(&receiver);
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn batch_terminal_event_is_a_barrier_for_every_index() {
        let (sink, receiver) = ProgressChannel::with_limits(8, Duration::from_millis(10));
        let id = BatchId::new(1);
        sink.send(id, started(2)).unwrap();
        sink.send(id, progress(0, 5.0)).unwrap();
        sink.send(id, progress(1, 5.0)).unwrap();
        sink.send(
            id,
            BatchProgressEvent::Cancelled {
                completed: 0,
                total: 2,
            },
        )
        .unwrap();
        sink.send(id, finished(2, 0)).unwrap();

        let events = drain(&receiver);
        assert_eq!(events.len(), 3, "{events:?}");
        assert!(matches!(events[1], BatchProgressEvent::Cancelled { .. }));
        assert!(matches!(events[2], BatchProgressEvent::Finished { .. }));
    }

    #[test]
    fn next_batch_start_drops_progress_left_by_the_previous_batch() {
        let (sink, receiver) = ProgressChannel::with_limits(8, Duration::from_millis(10));
        let first = BatchId::new(1);
        let second = BatchId::new(2);
        sink.send(first, started(1)).unwrap();
        sink.send(first, progress(0, 40.0)).unwrap();
        // The first batch ends without a terminal event (its sink failed).
        sink.send(second, started(1)).unwrap();
        sink.send(second, progress(0, 10.0)).unwrap();

        let mut ids = Vec::new();
        while let Some((id, event)) = receiver.try_recv() {
            ids.push((id, event));
        }
        assert_eq!(ids.len(), 3, "{ids:?}");
        assert_eq!(ids[0].0, first);
        assert_eq!(ids[1].0, second);
        assert_eq!(ids[2].0, second);
        assert!(
            matches!(ids[2].1, BatchProgressEvent::FileProgress { percent, .. } if percent == 10.0)
        );
    }

    #[test]
    fn full_queue_blocks_then_fails_when_nobody_drains() {
        let (sink, _receiver) = ProgressChannel::with_limits(2, Duration::from_millis(60));
        let id = BatchId::new(1);
        sink.send(id, started(1)).unwrap();
        sink.send(id, started(1)).unwrap();
        let before = Instant::now();
        assert_eq!(sink.send(id, started(1)), Err(SinkClosed));
        assert!(before.elapsed() >= Duration::from_millis(60));
        // Once the receiver is considered dead every later send fails fast.
        assert_eq!(sink.send(id, started(1)), Err(SinkClosed));
        let stats = sink.blocking_stats();
        assert_eq!(stats.blocked_sends, 1);
        assert!(stats.blocked_total >= Duration::from_millis(60));
    }

    #[test]
    fn full_queue_unblocks_when_receiver_drains() {
        let (sink, receiver) = ProgressChannel::with_limits(1, Duration::from_secs(5));
        let id = BatchId::new(1);
        sink.send(id, started(1)).unwrap();
        let drainer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            let first = receiver.recv();
            let second = receiver.recv();
            (first.is_some(), second.is_some())
        });
        sink.send(id, started(2)).unwrap();
        drop(sink);
        assert_eq!(drainer.join().unwrap(), (true, true));
    }

    #[test]
    fn progress_never_blocks_on_a_full_queue() {
        let (sink, _receiver) = ProgressChannel::with_limits(1, Duration::from_secs(5));
        let id = BatchId::new(1);
        sink.send(id, started(1)).unwrap();
        let before = Instant::now();
        sink.send(id, progress(0, 10.0)).unwrap();
        assert!(before.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn dropping_the_receiver_closes_the_sink() {
        let (sink, receiver) = ProgressChannel::new();
        drop(receiver);
        assert_eq!(sink.send(BatchId::new(1), started(1)), Err(SinkClosed));
    }

    #[test]
    fn recv_ends_when_all_senders_are_gone() {
        let (sink, receiver) = ProgressChannel::new();
        sink.send(BatchId::new(3), started(1)).unwrap();
        drop(sink);
        assert!(receiver.recv().is_some());
        assert!(receiver.recv().is_none());
    }

    #[test]
    fn recv_ends_after_a_timed_out_send_even_if_the_sender_is_kept() {
        let (sink, receiver) = ProgressChannel::with_limits(1, Duration::from_millis(20));
        let id = BatchId::new(1);
        sink.send(id, started(1)).unwrap();
        assert_eq!(sink.send(id, started(1)), Err(SinkClosed));
        // The queued event is still delivered, then the receiver sees the end.
        assert!(receiver.recv().is_some());
        let before = Instant::now();
        assert!(receiver.recv().is_none());
        assert!(before.elapsed() < Duration::from_secs(1));
        drop(sink);
    }
}
