// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Batch ownership and lifecycle (§2.3 of the migration plan).
//!
//! [`BatchService`] runs each batch on its own coordinator thread, owns the
//! cancellation token and a queryable [`BatchSnapshot`], and clears the
//! "a batch is running" state through a drop guard so panics, scheduling
//! failures and cancellation all leave the service reusable.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use thiserror::Error;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::convert::{self, BatchProgressEvent, BatchSummary, ConvertOptions};
use crate::preview::{lock_workflow_execution_gate, WorkflowExecutionGate};
use crate::progress::{BatchId, ProgressSink, SinkClosed};

/// Why a batch could not start or did not finish normally.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BatchError {
    #[error("已有批量任务正在运行")]
    AlreadyRunning,
    #[error("批量任务调度失败: {0}")]
    Spawn(String),
    #[error("{0}")]
    Failed(String),
    #[error("批量任务线程异常终止")]
    Panicked,
    #[error("批量任务结果已丢失")]
    Lost,
}

/// Last known state of a batch. Shells that reopen a window rebuild their
/// view from this instead of replaying events.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSnapshot {
    pub id: BatchId,
    pub total: usize,
    pub completed: usize,
    pub skipped: usize,
    pub failed: usize,
    pub cancelled: bool,
    pub finished: bool,
    pub error: Option<String>,
}

impl BatchSnapshot {
    fn new(id: BatchId, total: usize) -> Self {
        Self {
            id,
            total,
            completed: 0,
            skipped: 0,
            failed: 0,
            cancelled: false,
            finished: false,
            error: None,
        }
    }

    fn apply(&mut self, event: &BatchProgressEvent) {
        match event {
            BatchProgressEvent::Started { total } => self.total = *total,
            BatchProgressEvent::FileFinished { .. } => self.completed += 1,
            BatchProgressEvent::FileSkipped { .. } => self.skipped += 1,
            BatchProgressEvent::FileError { .. } => self.failed += 1,
            BatchProgressEvent::Cancelled { .. } => self.cancelled = true,
            BatchProgressEvent::Finished { summary } => {
                self.total = summary.total;
                self.completed = summary.completed;
                self.skipped = summary.skipped;
                self.failed = summary.failed;
                self.cancelled = summary.cancelled;
                self.finished = true;
            }
            BatchProgressEvent::FileStarted { .. } | BatchProgressEvent::FileProgress { .. } => {}
        }
    }
}

struct ActiveBatch {
    id: BatchId,
    token: CancellationToken,
    completion: Arc<Completion>,
}

/// Signalled by [`ActiveBatchGuard`] when the coordinator is done, on every
/// exit path. `shutdown` waits on this, never on a thread handle, so a batch
/// that is still starting or that outlived an earlier timeout is still seen
/// as running.
#[derive(Default)]
struct Completion {
    done: Mutex<bool>,
    changed: Condvar,
}

impl Completion {
    fn mark(&self) {
        let mut done = self.done.lock().unwrap_or_else(|p| p.into_inner());
        *done = true;
        self.changed.notify_all();
    }

    /// Returns `true` once marked, `false` if `deadline` passed first.
    fn wait_until(&self, deadline: Instant) -> bool {
        let mut done = self.done.lock().unwrap_or_else(|p| p.into_inner());
        while !*done {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            done = self
                .changed
                .wait_timeout(done, deadline - now)
                .unwrap_or_else(|p| p.into_inner())
                .0;
        }
        true
    }
}

#[derive(Default)]
struct Inner {
    current: Mutex<Option<ActiveBatch>>,
    snapshot: Mutex<Option<BatchSnapshot>>,
    next_id: AtomicU64,
    gate: WorkflowExecutionGate,
}

impl Inner {
    fn current(&self) -> MutexGuard<'_, Option<ActiveBatch>> {
        self.current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn snapshot(&self) -> MutexGuard<'_, Option<BatchSnapshot>> {
        self.snapshot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Owns batch execution for the whole application. Shells hold one instance
/// for the process lifetime (Tauri managed state, GPUI global).
#[derive(Default, Clone)]
pub struct BatchService {
    inner: Arc<Inner>,
}

/// A started batch. `wait` resolves when the coordinator thread is done.
pub struct RunningBatch {
    id: BatchId,
    done: oneshot::Receiver<Result<BatchSummary, BatchError>>,
}

impl RunningBatch {
    pub fn id(&self) -> BatchId {
        self.id
    }

    pub async fn wait(self) -> Result<BatchSummary, BatchError> {
        self.done.await.unwrap_or(Err(BatchError::Lost))
    }

    pub fn wait_blocking(self) -> Result<BatchSummary, BatchError> {
        self.done.blocking_recv().unwrap_or(Err(BatchError::Lost))
    }

    /// Non-blocking check for shells that poll from their own event loop.
    /// Returns `None` while the coordinator is still running; afterwards the
    /// result is returned once and later calls report [`BatchError::Lost`].
    pub fn try_wait(&mut self) -> Option<Result<BatchSummary, BatchError>> {
        match self.done.try_recv() {
            Ok(result) => Some(result),
            Err(oneshot::error::TryRecvError::Empty) => None,
            Err(oneshot::error::TryRecvError::Closed) => Some(Err(BatchError::Lost)),
        }
    }
}

/// Result of [`BatchService::shutdown`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShutdownOutcome {
    /// No batch was running or it finished within the timeout.
    Completed,
    /// A batch was still running when the timeout elapsed; its thread is detached.
    TimedOut,
}

/// Clears the active-batch slot, marks the snapshot finished and signals
/// completion when dropped. It is dropped on the coordinator thread after
/// `convert_batch` returned or unwound, so every in-flight write is over.
struct ActiveBatchGuard {
    inner: Arc<Inner>,
    id: BatchId,
    completion: Arc<Completion>,
}

impl Drop for ActiveBatchGuard {
    fn drop(&mut self) {
        {
            let mut current = self.inner.current();
            if current.as_ref().is_some_and(|active| active.id == self.id) {
                *current = None;
            }
        }
        {
            let mut snapshot = self.inner.snapshot();
            if let Some(snapshot) = snapshot.as_mut().filter(|snapshot| snapshot.id == self.id) {
                if !snapshot.finished {
                    snapshot.finished = true;
                    if snapshot.error.is_none() {
                        snapshot.error = Some("批量任务异常终止".to_string());
                    }
                }
            }
        }
        self.completion.mark();
    }
}

/// Updates the snapshot before forwarding each event to the shell sink.
struct SnapshotSink<S> {
    inner: Arc<Inner>,
    shell: S,
}

impl<S: ProgressSink> ProgressSink for SnapshotSink<S> {
    fn send(&self, batch_id: BatchId, event: BatchProgressEvent) -> Result<(), SinkClosed> {
        {
            let mut snapshot = self.inner.snapshot();
            if let Some(snapshot) = snapshot.as_mut().filter(|snapshot| snapshot.id == batch_id) {
                snapshot.apply(&event);
            }
        }
        self.shell.send(batch_id, event)
    }
}

impl BatchService {
    pub fn new() -> Self {
        Self::default()
    }

    /// The gate that serializes batch conversion with full-resolution preview.
    pub fn execution_gate(&self) -> &WorkflowExecutionGate {
        &self.inner.gate
    }

    /// Starts a batch on a dedicated coordinator thread. Fails if one is running.
    pub fn start<S>(
        &self,
        options: Vec<ConvertOptions>,
        sink: S,
        concurrency: Option<usize>,
    ) -> Result<RunningBatch, BatchError>
    where
        S: ProgressSink + 'static,
    {
        let completion = Arc::new(Completion::default());
        let (id, token) = {
            let mut current = self.inner.current();
            if current.is_some() {
                return Err(BatchError::AlreadyRunning);
            }
            let id = BatchId::new(self.inner.next_id.fetch_add(1, Ordering::Relaxed));
            let token = CancellationToken::new();
            *current = Some(ActiveBatch {
                id,
                token: token.clone(),
                completion: Arc::clone(&completion),
            });
            (id, token)
        };
        *self.inner.snapshot() = Some(BatchSnapshot::new(id, options.len()));

        let guard = ActiveBatchGuard {
            inner: Arc::clone(&self.inner),
            id,
            completion,
        };
        let (done_tx, done_rx) = oneshot::channel();
        let inner = Arc::clone(&self.inner);
        let spawned = thread::Builder::new()
            .name(format!("imgconvert-batch-{}", id.raw()))
            .spawn(move || {
                let guard = guard;
                let sink = SnapshotSink {
                    inner: Arc::clone(&inner),
                    shell: sink,
                };
                let execution = inner.gate.handle();
                let outcome = catch_unwind(AssertUnwindSafe(|| {
                    let _gate = lock_workflow_execution_gate(&execution);
                    convert::convert_batch(options, &sink, id, token, concurrency)
                }));
                let result = match outcome {
                    Ok(Ok(summary)) => Ok(summary),
                    Ok(Err(detail)) => Err(BatchError::Failed(detail)),
                    Err(_) => Err(BatchError::Panicked),
                };
                if let Err(error) = &result {
                    let mut snapshot = inner.snapshot();
                    if let Some(snapshot) = snapshot.as_mut().filter(|snapshot| snapshot.id == id) {
                        snapshot.error = Some(error.to_string());
                    }
                }
                drop(guard);
                let _ = done_tx.send(result);
            });
        match spawned {
            Ok(_detached) => Ok(RunningBatch { id, done: done_rx }),
            Err(error) => {
                // The closure (and with it the guard) was dropped by the failed
                // spawn: the slot is clear and completion is signalled. Only the
                // snapshot error needs the real cause.
                let mut snapshot = self.inner.snapshot();
                if let Some(snapshot) = snapshot.as_mut().filter(|snapshot| snapshot.id == id) {
                    snapshot.finished = true;
                    snapshot.error = Some(error.to_string());
                }
                Err(BatchError::Spawn(error.to_string()))
            }
        }
    }

    /// Requests cancellation of the running batch. Returns whether one was running.
    pub fn cancel_current(&self) -> bool {
        let current = self.inner.current();
        match current.as_ref() {
            Some(active) => {
                active.token.cancel();
                true
            }
            None => false,
        }
    }

    pub fn is_active(&self) -> bool {
        self.inner.current().is_some()
    }

    pub fn current_id(&self) -> Option<BatchId> {
        self.inner.current().as_ref().map(|active| active.id)
    }

    pub fn snapshot(&self) -> Option<BatchSnapshot> {
        self.inner.snapshot().clone()
    }

    /// Cancels the running batch and waits up to `timeout` for its coordinator
    /// to finish, so in-flight atomic writes can complete before the process
    /// exits. Safe to call repeatedly: a batch that outlived an earlier timeout
    /// is waited for again, and a batch that is still starting is not mistaken
    /// for a finished one.
    pub fn shutdown(&self, timeout: Duration) -> ShutdownOutcome {
        let deadline = Instant::now() + timeout;
        let completion = {
            let current = self.inner.current();
            match current.as_ref() {
                Some(active) => {
                    active.token.cancel();
                    Arc::clone(&active.completion)
                }
                None => return ShutdownOutcome::Completed,
            }
        };
        if completion.wait_until(deadline) {
            ShutdownOutcome::Completed
        } else {
            ShutdownOutcome::TimedOut
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::{FnSink, NullSink, ProgressChannel};
    use std::sync::atomic::AtomicBool;

    #[test]
    fn empty_batch_finishes_and_clears_state() {
        let service = BatchService::new();
        let running = service.start(Vec::new(), NullSink, None).unwrap();
        assert!(service.is_active() || service.snapshot().is_some());
        let summary = running.wait_blocking().unwrap();
        assert_eq!(summary.total, 0);
        assert!(!service.is_active());
        let snapshot = service.snapshot().unwrap();
        assert!(snapshot.finished);
        assert_eq!(snapshot.error, None);
    }

    #[test]
    fn only_one_batch_runs_at_a_time() {
        let service = BatchService::new();
        let (sink, receiver) = ProgressChannel::with_limits(1, Duration::from_secs(5));
        // Capacity 1 and no drain: the coordinator blocks on the second reliable event.
        let running = service.start(Vec::new(), sink, None).unwrap();
        assert_eq!(
            service.start(Vec::new(), NullSink, None).err(),
            Some(BatchError::AlreadyRunning)
        );
        drop(receiver);
        let result = running.wait_blocking();
        assert!(matches!(result, Err(BatchError::Failed(_))), "{result:?}");
        assert!(!service.is_active());
    }

    #[test]
    fn closed_receiver_aborts_the_batch_and_marks_snapshot() {
        let service = BatchService::new();
        let failing = FnSink::new(|_, _| Err(SinkClosed));
        let running = service.start(Vec::new(), failing, None).unwrap();
        let error = running.wait_blocking().unwrap_err();
        assert!(
            matches!(error, BatchError::Failed(ref detail) if detail.contains("无法发送批量进度事件"))
        );
        let snapshot = service.snapshot().unwrap();
        assert!(snapshot.finished);
        assert!(snapshot.error.is_some());
        assert!(!service.is_active());
    }

    #[test]
    fn coordinator_panic_releases_the_service() {
        let service = BatchService::new();
        let panicking = FnSink::new(|_, _| panic!("sink exploded"));
        let running = service.start(Vec::new(), panicking, None).unwrap();
        assert_eq!(running.wait_blocking().unwrap_err(), BatchError::Panicked);
        assert!(!service.is_active());
        let snapshot = service.snapshot().unwrap();
        assert!(snapshot.finished);
        assert_eq!(snapshot.error.as_deref(), Some("批量任务线程异常终止"));
        // The gate must not stay poisoned for the next batch.
        let again = service.start(Vec::new(), NullSink, None).unwrap();
        assert!(again.wait_blocking().is_ok());
    }

    #[test]
    fn batch_survives_a_closed_window_while_the_app_receiver_stays() {
        // The application-level receiver outlives windows. Closing a window
        // only stops that window's subscription; the batch must still finish
        // normally and the snapshot must let a reopened window catch up.
        let service = BatchService::new();
        let (app_sink, app_receiver) = ProgressChannel::new();
        let drained = thread::spawn(move || {
            let mut count = 0;
            while app_receiver.recv().is_some() {
                count += 1;
            }
            count
        });
        let window_open = Arc::new(AtomicBool::new(true));
        let window_saw = Arc::new(AtomicBool::new(false));
        let (open, saw) = (Arc::clone(&window_open), Arc::clone(&window_saw));
        let tee = FnSink::new(move |id, event| {
            if open.load(Ordering::Relaxed) {
                saw.store(true, Ordering::Relaxed);
            }
            app_sink.send(id, event)
        });
        // The window closes before any event is delivered.
        window_open.store(false, Ordering::Relaxed);
        let running = service.start(Vec::new(), tee, None).unwrap();
        let summary = running.wait_blocking().unwrap();
        assert_eq!(summary.total, 0);
        assert!(!window_saw.load(Ordering::Relaxed));
        let snapshot = service.snapshot().unwrap();
        assert!(snapshot.finished);
        assert_eq!(snapshot.error, None);
        // The coordinator dropped its sink when it finished, so the app
        // receiver ends after draining Started + Finished.
        assert_eq!(drained.join().unwrap(), 2);
    }

    type ReleaseGate = Arc<(Mutex<bool>, Condvar)>;

    /// Blocks the coordinator inside `send` until the test releases it.
    struct GateSink {
        released: ReleaseGate,
        blocked: Arc<AtomicBool>,
    }

    impl GateSink {
        fn new() -> (Self, ReleaseGate, Arc<AtomicBool>) {
            let released = Arc::new((Mutex::new(false), Condvar::new()));
            let blocked = Arc::new(AtomicBool::new(false));
            (
                Self {
                    released: Arc::clone(&released),
                    blocked: Arc::clone(&blocked),
                },
                released,
                blocked,
            )
        }

        fn release(gate: &(Mutex<bool>, Condvar)) {
            *gate.0.lock().unwrap() = true;
            gate.1.notify_all();
        }
    }

    impl ProgressSink for GateSink {
        fn send(&self, _: BatchId, _: BatchProgressEvent) -> Result<(), SinkClosed> {
            self.blocked.store(true, Ordering::SeqCst);
            let mut released = self.released.0.lock().unwrap();
            while !*released {
                released = self.released.1.wait(released).unwrap();
            }
            Ok(())
        }
    }

    fn wait_until(flag: &AtomicBool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !flag.load(Ordering::SeqCst) {
            assert!(
                Instant::now() < deadline,
                "coordinator never reached the sink"
            );
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn shutdown_reports_timeout_while_the_batch_runs_and_completion_afterwards() {
        let service = BatchService::new();
        let (sink, gate, blocked) = GateSink::new();
        let running = service.start(Vec::new(), sink, None).unwrap();
        wait_until(&blocked);

        let before = Instant::now();
        assert_eq!(
            service.shutdown(Duration::from_millis(50)),
            ShutdownOutcome::TimedOut
        );
        assert!(before.elapsed() >= Duration::from_millis(50));
        // A timed-out shutdown must not make the next call pretend the batch is gone.
        assert!(service.is_active());
        assert_eq!(
            service.shutdown(Duration::from_millis(20)),
            ShutdownOutcome::TimedOut
        );

        GateSink::release(&gate);
        assert_eq!(
            service.shutdown(Duration::from_secs(10)),
            ShutdownOutcome::Completed
        );
        assert!(!service.is_active());
        assert!(running.wait_blocking().is_ok());
    }

    #[test]
    fn cancel_current_cancels_a_non_empty_batch_before_its_first_file() {
        let service = BatchService::new();
        let (sink, gate, blocked) = GateSink::new();
        let options = vec![
            convert::path_conversion_smoke_options(
                "/nonexistent/imgconvert-a.png".into(),
                None,
                "png".into(),
            ),
            convert::path_conversion_smoke_options(
                "/nonexistent/imgconvert-b.png".into(),
                None,
                "png".into(),
            ),
        ];
        let running = service.start(options, sink, None).unwrap();
        wait_until(&blocked);
        assert!(service.cancel_current());
        GateSink::release(&gate);
        let summary = running.wait_blocking().unwrap();
        assert!(summary.cancelled);
        assert_eq!(summary.completed, 0);
        assert!(!service.is_active());
        let snapshot = service.snapshot().unwrap();
        assert!(snapshot.finished && snapshot.cancelled);
        assert_eq!(snapshot.error, None);
        assert!(!service.cancel_current());
    }

    #[test]
    fn coordinator_panic_after_files_started_releases_the_service() {
        let dir = std::env::temp_dir().join(format!(
            "imgconvert-service-panic-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let mut options = Vec::new();
        for index in 0..3 {
            let input = dir.join(format!("in-{index}.png"));
            std::fs::write(&input, convert::tests::one_by_one_png()).unwrap();
            options.push(convert::path_conversion_smoke_options(
                input.to_string_lossy().into_owned(),
                Some(dir.join("out").to_string_lossy().into_owned()),
                "png".into(),
            ));
        }
        let service = BatchService::new();
        let panicking = FnSink::new(|_, event| {
            if matches!(event, BatchProgressEvent::FileStarted { .. }) {
                panic!("sink exploded while workers run");
            }
            Ok(())
        });
        let running = service.start(options, panicking, Some(3)).unwrap();
        assert_eq!(running.wait_blocking().unwrap_err(), BatchError::Panicked);
        assert!(!service.is_active());
        assert!(service.snapshot().unwrap().finished);
        let again = service.start(Vec::new(), NullSink, None).unwrap();
        assert!(again.wait_blocking().is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn shutdown_without_a_batch_completes_immediately() {
        let service = BatchService::new();
        assert_eq!(
            service.shutdown(Duration::from_millis(10)),
            ShutdownOutcome::Completed
        );
        let running = service.start(Vec::new(), NullSink, None).unwrap();
        running.wait_blocking().unwrap();
        assert_eq!(
            service.shutdown(Duration::from_millis(10)),
            ShutdownOutcome::Completed
        );
    }
}
