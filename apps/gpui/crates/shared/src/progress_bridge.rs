// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Moves backend batch progress onto the GPUI foreground (plan §2.3).
//!
//! The backend coordinator writes into a bounded [`ProgressChannel`]; a
//! forwarding thread drains it into an async channel; one foreground task per
//! batch applies the events to the models and notifies once per drained
//! burst. Backend threads never touch an entity.
//!
//! Start order matters: the receiving side (channel + forwarding thread) is
//! set up first, the backend batch second, the model is marked running last.
//! A batch is "over" only once its bridge has settled and emitted the final
//! probe mark; until then no second batch may start.

use std::cell::Cell;
use std::rc::Rc;
use std::thread;

use gpui_kit::{App, AsyncApp, Entity, SharedString, Task};
use imgconvert_backend::convert::{BatchProgressEvent, ConvertOptions};
use imgconvert_backend::progress::{BatchId, ProgressChannel};
use imgconvert_backend::service::{BatchError, RunningBatch};
use thiserror::Error;

use crate::batch_model::BatchModel;
use crate::perf_probe;
use crate::queue_model::QueueModel;
use crate::services::{AppModels, Services};

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum StartError {
    #[error("nothing to convert")]
    Empty,
    #[error("the previous batch is still finishing")]
    Settling,
    #[error(transparent)]
    Batch(#[from] BatchError),
}

/// Whether a batch is running or its bridge has not settled yet. Views use
/// this, not only `BatchModel::is_active`, to enable "Start".
pub fn is_busy(cx: &App) -> bool {
    cx.try_global::<ActiveBridge>()
        .is_some_and(|bridge| !bridge.settled.get())
}

/// Starts a batch for `options` (one per `jobs` key, same order) and keeps the
/// bridge task alive in a global until the batch has settled.
pub fn start_batch(
    jobs: Vec<SharedString>,
    options: Vec<ConvertOptions>,
    concurrency: Option<usize>,
    cx: &mut App,
) -> Result<BatchId, StartError> {
    if jobs.is_empty() || jobs.len() != options.len() {
        return Err(StartError::Empty);
    }
    if is_busy(cx) {
        return Err(StartError::Settling);
    }
    let services = Services::global(cx).clone();
    let models = AppModels::global(cx).clone();

    // 1. Receiving side first: bounded backend channel → forwarding thread →
    //    async channel. If the forwarder cannot start, nothing else did.
    let (sink, receiver) = ProgressChannel::new();
    let (tx, rx) = async_channel::unbounded::<(BatchId, BatchProgressEvent)>();
    thread::Builder::new()
        .name("imgconvert-progress-forwarder".to_string())
        .spawn(move || {
            while let Some(item) = receiver.recv() {
                if tx.send_blocking(item).is_err() {
                    break;
                }
            }
        })
        .map_err(|error| StartError::Batch(BatchError::Spawn(error.to_string())))?;

    // 2. The backend batch. Dropping `sink` on failure ends the forwarder.
    perf_probe::mark_count("batch_start", jobs.len());
    let running = match services.batch().start(options, sink, concurrency) {
        Ok(running) => running,
        Err(error) => {
            perf_probe::mark_count("batch_failed", 0);
            return Err(StartError::Batch(error));
        }
    };
    let id = running.id();

    // 3. Models and the foreground pump.
    models.queue().update(cx, |queue, _| queue.reset_statuses());
    models.batch().update(cx, |batch, cx| {
        batch.begin(id, jobs.clone());
        cx.notify();
    });
    let settled = Rc::new(Cell::new(false));
    let settled_in_task = Rc::clone(&settled);
    let queue = models.queue().clone();
    let batch = models.batch().clone();
    let task = cx.spawn(async move |cx: &mut AsyncApp| {
        pump_events(&rx, &queue, &batch, id, &jobs, cx).await;
        settle(running, &queue, &batch, &jobs, cx).await;
        settled_in_task.set(true);
    });
    cx.set_global(ActiveBridge {
        settled,
        _task: Some(task),
    });
    Ok(id)
}

/// Requests cancellation of the running batch and reflects it in the model.
pub fn cancel_batch(cx: &mut App) -> bool {
    let cancelled = Services::global(cx).batch().cancel_current();
    if cancelled {
        AppModels::global(cx)
            .batch()
            .clone()
            .update(cx, |batch, cx| {
                batch.request_cancel();
                cx.notify();
            });
    }
    cancelled
}

/// Keeps the foreground pump alive until the batch has settled.
struct ActiveBridge {
    settled: Rc<Cell<bool>>,
    _task: Option<Task<()>>,
}

impl gpui_kit::Global for ActiveBridge {}

async fn pump_events(
    rx: &async_channel::Receiver<(BatchId, BatchProgressEvent)>,
    queue: &Entity<QueueModel>,
    batch: &Entity<BatchModel>,
    id: BatchId,
    jobs: &[SharedString],
    cx: &mut AsyncApp,
) {
    while let Ok(first) = rx.recv().await {
        let mut burst = vec![first];
        while let Ok(next) = rx.try_recv() {
            burst.push(next);
            if burst.len() >= 512 {
                break;
            }
        }
        cx.update(|cx| {
            // Events of another batch are dropped (plan §2.2).
            let mut queue_changed = false;
            queue.update(cx, |queue, _| {
                for (event_id, event) in &burst {
                    if *event_id == id {
                        queue_changed |= queue.apply_batch_event(event, jobs);
                    }
                }
            });
            if queue_changed {
                queue.update(cx, |_, cx| cx.notify());
            }
            batch.update(cx, |batch, cx| {
                let mut changed = false;
                for (event_id, event) in &burst {
                    changed |= batch.apply(*event_id, event);
                }
                if changed {
                    cx.notify();
                }
            });
        });
    }
}

async fn settle(
    running: RunningBatch,
    queue: &Entity<QueueModel>,
    batch: &Entity<BatchModel>,
    jobs: &[SharedString],
    cx: &mut AsyncApp,
) {
    let result = running.wait().await;
    cx.update(|cx| match result {
        Ok(summary) => {
            let mark = if summary.cancelled {
                "batch_cancelled"
            } else if summary.failed == 0 && summary.skipped == 0 {
                "batch_done"
            } else {
                "batch_failed"
            };
            perf_probe::mark_count(mark, summary.completed);
            batch.update(cx, |batch, cx| {
                batch.finish_without_summary(Some(summary));
                cx.notify();
            });
        }
        Err(error) => {
            let detail = SharedString::from(error.to_string());
            perf_probe::mark_count("batch_failed", batch.read(cx).completed());
            queue.update(cx, |queue, cx| {
                queue.fail_unfinished(jobs, &detail);
                cx.notify();
            });
            batch.update(cx, |batch, cx| {
                batch.fail(detail);
                cx.notify();
            });
        }
    });
}
