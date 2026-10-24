// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Moves backend batch progress onto the GPUI foreground (plan §2.3).
//!
//! The backend coordinator writes into a bounded [`ProgressChannel`]; one
//! foreground task per batch polls its receiver on a short timer, applies
//! each drained burst to the models and notifies once per burst. Polling
//! instead of a wake-up channel keeps every GPUI interaction on the
//! foreground: backend threads never touch an entity or a GPUI waker, which
//! also keeps the deterministic test scheduler happy.
//!
//! Start order matters: the receiver exists before the backend batch starts,
//! and the model is marked running last. A batch is "over" only once its
//! bridge has settled and emitted the final probe mark; until then no second
//! batch may start.

use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::{App, AsyncApp, Entity, SharedString, Task};
use imgconvert_backend::convert::{BatchProgressEvent, ConvertOptions};
use imgconvert_backend::progress::{BatchId, ProgressChannel, ProgressReceiver};
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
    #[error("the application is quitting")]
    Quitting,
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
    if crate::lifecycle::is_quitting(cx) {
        return Err(StartError::Quitting);
    }
    if jobs.is_empty() || jobs.len() != options.len() {
        return Err(StartError::Empty);
    }
    if is_busy(cx) {
        return Err(StartError::Settling);
    }
    let services = Services::global(cx).clone();
    let models = AppModels::global(cx).clone();

    // 1. Receiving side first: the bounded backend channel.
    let (sink, receiver) = ProgressChannel::new();

    // 2. The backend batch. Dropping `sink` on failure closes the channel.
    perf_probe::mark_count("batch_start", jobs.len());
    let protected_inputs = models
        .queue()
        .read(cx)
        .items()
        .iter()
        .map(|item| item.path.to_string())
        .collect();
    let running = match services.batch().start_with_protected_inputs(
        options,
        sink,
        concurrency,
        protected_inputs,
    ) {
        Ok(running) => running,
        Err(error) => {
            perf_probe::mark_count("batch_failed", 0);
            return Err(StartError::Batch(error));
        }
    };
    let id = running.id();

    // 3. Models and the foreground pump.
    models
        .queue()
        .update(cx, |queue, _| queue.reset_statuses(&jobs));
    models.batch().update(cx, |batch, cx| {
        batch.begin(id, jobs.clone());
        cx.notify();
    });
    let settled = Rc::new(Cell::new(false));
    let settled_in_task = Rc::clone(&settled);
    let queue = models.queue().clone();
    let batch = models.batch().clone();
    // Keeps App Nap from throttling the batch and idle sleep from cutting it
    // short; released when the task ends, after the batch has settled.
    let activity = cx.prevent_idle_sleep("Converting images");
    let task = cx.spawn(async move |cx: &mut AsyncApp| {
        let _activity = activity.await.ok();
        let result = pump_events(receiver, running, &queue, &batch, id, &jobs, cx).await;
        settle(result, &queue, &batch, &jobs, cx);
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

/// Interval between polls of the backend channel while a batch runs. Events
/// are coalesced per poll, so this bounds latency, not throughput.
const POLL_INTERVAL: Duration = Duration::from_millis(16);

/// Drains the backend channel until the coordinator reports its result.
async fn pump_events(
    receiver: ProgressReceiver,
    mut running: RunningBatch,
    queue: &Entity<QueueModel>,
    batch: &Entity<BatchModel>,
    id: BatchId,
    jobs: &[SharedString],
    cx: &mut AsyncApp,
) -> Result<imgconvert_backend::convert::BatchSummary, BatchError> {
    loop {
        let mut burst = Vec::new();
        while let Some(item) = receiver.try_recv() {
            burst.push(item);
            if burst.len() >= 512 {
                break;
            }
        }
        if !burst.is_empty() {
            apply_burst(&burst, queue, batch, id, jobs, cx);
            continue;
        }
        // The coordinator sends its last event before it returns, so an empty
        // queue plus a result means everything has been applied.
        if let Some(result) = running.try_wait() {
            return result;
        }
        cx.background_executor().timer(POLL_INTERVAL).await;
    }
}

fn apply_burst(
    burst: &[(BatchId, BatchProgressEvent)],
    queue: &Entity<QueueModel>,
    batch: &Entity<BatchModel>,
    id: BatchId,
    jobs: &[SharedString],
    cx: &mut AsyncApp,
) {
    cx.update(|cx| {
        // Events of another batch are dropped (plan §2.2).
        let mut queue_changed = false;
        queue.update(cx, |queue, _| {
            for (event_id, event) in burst {
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
            for (event_id, event) in burst {
                changed |= batch.apply(*event_id, event);
            }
            if changed {
                cx.notify();
            }
        });
    });
}

fn settle(
    result: Result<imgconvert_backend::convert::BatchSummary, BatchError>,
    queue: &Entity<QueueModel>,
    batch: &Entity<BatchModel>,
    jobs: &[SharedString],
    cx: &mut AsyncApp,
) {
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
            let error =
                imgconvert_backend::command_error::CommandError::batch_failed(error.to_string());
            perf_probe::mark_count("batch_failed", batch.read(cx).completed());
            queue.update(cx, |queue, cx| {
                queue.fail_unfinished(jobs, &error);
                cx.notify();
            });
            batch.update(cx, |batch, cx| {
                // Like the Ok path: only a batch still running may fail; a
                // model already settled or forgotten stays as it is.
                if batch.is_active() {
                    batch.fail(crate::command_error::format_command_error(&error));
                    cx.notify();
                }
            });
        }
    });
}
