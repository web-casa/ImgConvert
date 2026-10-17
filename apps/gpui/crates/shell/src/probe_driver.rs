// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Drives the perf-probe scenarios (docs/GPUI_BASELINE.md §2, §7) in the GPUI
//! shell: `ready` after two presented frames, auto import, quiescence, a
//! refresh-rate estimate, one full triangle-wave scroll and the frame
//! watchdog. Marks are identical to the Svelte shell's so the same script
//! measures both.

use std::cell::RefCell;
use std::rc::Rc;
use std::time::{Duration, Instant};

use gpui_kit::{AnyWindowHandle, App, AppContext as _, AsyncApp, Entity, Pixels, point, px};
use imgconvert_gpui_shared::perf_probe::{self, ProbeConfig, summarize_intervals};
use imgconvert_gpui_shared::{AppModels, QueueModel};

use crate::workspace::Workspace;

const POLL: Duration = Duration::from_millis(50);
const IMPORT_TIMEOUT: Duration = Duration::from_mins(10);
const QUIESCENCE_TIMEOUT: Duration = Duration::from_mins(5);
const REFRESH_ESTIMATE: Duration = Duration::from_secs(1);
/// Grace after the nominal duration before the window is declared stalled.
const FRAME_WATCHDOG_GRACE: Duration = Duration::from_mins(1);

/// Starts the probe for `window` if `IMGCONVERT_PERF_PROBE` is set.
pub fn start(window: AnyWindowHandle, workspace: Entity<Workspace>, cx: &mut App) {
    let Some(config) = perf_probe::config().cloned() else {
        return;
    };
    // `ready` (§7): the persisted settings were loaded in `init_app`, the
    // capability check ran in WorkflowPanel::new, and two frames have been
    // presented. A redraw
    // is forced between the callbacks so each one follows a real frame
    // instead of the same frame-loop iteration.
    let _ = cx.update_window(window, |_, win, _| {
        win.on_next_frame(move |win, _| {
            win.refresh();
            win.on_next_frame(move |win, _| {
                win.refresh();
                win.on_next_frame(move |_, cx| {
                    let len = AppModels::global(cx).queue().read(cx).len();
                    perf_probe::mark_count("ready", len);
                    cx.spawn(async move |cx: &mut AsyncApp| {
                        run_scenarios(config, window, workspace, cx).await;
                    })
                    .detach();
                });
            });
        });
    });
}

async fn run_scenarios(
    config: ProbeConfig,
    window: AnyWindowHandle,
    workspace: Entity<Workspace>,
    cx: &mut AsyncApp,
) {
    let queue = cx.update(|cx| AppModels::global(cx).queue().clone());

    if let Some(dir) = config.import_dir.clone() {
        cx.update(|cx| imgconvert_gpui_queue::import::import_paths(vec![dir], cx));
        if !wait_until(cx, IMPORT_TIMEOUT, |cx| !queue.read(cx).is_importing()).await {
            perf_probe::mark_count("probe_error_import_timeout", queue_len(&queue, cx));
            return;
        }
        perf_probe::mark_count("probe_import_settled", queue_len(&queue, cx));
    }

    if !wait_quiescent(&queue, &workspace, window, cx).await {
        return;
    }
    perf_probe::mark_count("probe_quiescent", queue_len(&queue, cx));

    if config.scroll {
        if queue_len(&queue, cx) == 0 {
            perf_probe::mark("probe_error_no_scroll_container", None);
            return;
        }
        if !scroll_scenario(config.scroll_ms, window, &workspace, cx).await {
            return;
        }
        if !wait_quiescent(&queue, &workspace, window, cx).await {
            return;
        }
    }

    perf_probe::mark_count("probe_done", queue_len(&queue, cx));

    // manual-batch scenario without an operator: start into the given folder.
    // The bridge emits batch_start/batch_done/batch_failed/batch_cancelled.
    if let Some(dir) = config.batch_out_dir {
        if queue_len(&queue, cx) == 0 {
            return;
        }
        cx.update(|cx| {
            let workflow = workspace.read(cx).workflow().clone();
            let format = config.batch_format.clone();
            workflow.update(cx, |workflow, cx| {
                workflow.start_with_output_dir(dir, format, cx);
            });
        });
    }
}

fn queue_len(queue: &Entity<QueueModel>, cx: &mut AsyncApp) -> usize {
    cx.update(|cx| queue.read(cx).len())
}

fn is_idle(queue: &Entity<QueueModel>, workspace: &Entity<Workspace>, cx: &App) -> bool {
    let model = queue.read(cx);
    let view = workspace.read(cx).queue_view().read(cx);
    !model.is_importing() && model.pending_thumbnail_count() == 0 && !view.has_pending_work()
}

/// Nothing importing, no thumbnail request in flight or pending, confirmed
/// again after one more presented frame so deferred work has had its chance.
async fn wait_quiescent(
    queue: &Entity<QueueModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> bool {
    let deadline = Instant::now() + QUIESCENCE_TIMEOUT;
    loop {
        if cx.update(|cx| is_idle(queue, workspace, cx)) {
            if !wait_one_frame(window, cx).await {
                perf_probe::mark_count("probe_error_frame_timeout", 0);
                return false;
            }
            if cx.update(|cx| is_idle(queue, workspace, cx)) {
                return true;
            }
        }
        if Instant::now() >= deadline {
            perf_probe::mark_count("probe_error_quiescence_timeout", queue_len(queue, cx));
            return false;
        }
        cx.background_executor().timer(POLL).await;
    }
}

async fn wait_until(
    cx: &mut AsyncApp,
    timeout: Duration,
    mut condition: impl FnMut(&App) -> bool,
) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if cx.update(|cx| condition(cx)) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        cx.background_executor().timer(POLL).await;
    }
}

/// Forces a redraw and resolves once its frame callback ran.
async fn wait_one_frame(window: AnyWindowHandle, cx: &mut AsyncApp) -> bool {
    let presented = Rc::new(RefCell::new(false));
    let flag = Rc::clone(&presented);
    let registered = cx
        .update_window(window, |_, win, _| {
            win.refresh();
            win.on_next_frame(move |_, _| *flag.borrow_mut() = true);
        })
        .is_ok();
    if !registered {
        return false;
    }
    let deadline = Instant::now() + FRAME_WATCHDOG_GRACE;
    while !*presented.borrow() {
        if Instant::now() >= deadline {
            return false;
        }
        cx.background_executor().timer(POLL).await;
    }
    true
}

/// Frame-callback log of one probe phase, shared between the redraw
/// callbacks and the async scenario. The callbacks decide when the phase is
/// complete; the scenario only enforces the watchdog deadline.
struct FrameLog {
    duration: Duration,
    started: Option<Instant>,
    stamps: Vec<Instant>,
    done: bool,
    stop: bool,
    distance_px: f32,
    driver: Option<ScrollDriver>,
}

impl FrameLog {
    fn new(duration: Duration, driver: Option<ScrollDriver>) -> SharedFrameLog {
        Rc::new(RefCell::new(Self {
            duration,
            started: None,
            stamps: Vec::new(),
            done: false,
            stop: false,
            distance_px: 0.0,
            driver,
        }))
    }
}

type SharedFrameLog = Rc<RefCell<FrameLog>>;

fn intervals_ms(stamps: &[Instant]) -> Vec<f64> {
    stamps
        .windows(2)
        .map(|pair| pair[1].duration_since(pair[0]).as_secs_f64() * 1_000.0)
        .collect()
}

async fn scroll_scenario(
    scroll_ms: u64,
    window: AnyWindowHandle,
    workspace: &Entity<Workspace>,
    cx: &mut AsyncApp,
) -> bool {
    let scroll = cx.update(|cx| workspace.read(cx).queue_view().read(cx).scroll_handle());
    let handle = scroll.base_handle().clone();
    if handle.max_offset().y <= px(0.) {
        perf_probe::mark("probe_error_scroll_range", None);
        return false;
    }

    // 1. Refresh-period estimate: one second of frames while the list rests.
    let log = FrameLog::new(REFRESH_ESTIMATE, None);
    if !run_frame_phase(window, &log, cx).await {
        return false;
    }
    let refresh = {
        let mut intervals = intervals_ms(&log.borrow().stamps);
        intervals.sort_by(f64::total_cmp);
        perf_probe::percentile(&intervals, 0.5)
    };
    perf_probe::mark("scroll_refresh_interval_ms", Some(refresh));

    // 2. One full triangle wave (top → bottom → top) over the nominal time,
    //    like the Svelte probe. Distance is read back from the handle.
    let nominal = Duration::from_millis(scroll_ms);
    handle.set_offset(point(px(0.), px(0.)));
    let log = FrameLog::new(
        nominal,
        Some(ScrollDriver {
            handle: handle.clone(),
            last_y: px(0.),
        }),
    );
    if !run_frame_phase(window, &log, cx).await {
        return false;
    }
    handle.set_offset(point(px(0.), px(0.)));
    let (intervals, distance) = {
        let log = log.borrow();
        (intervals_ms(&log.stamps), log.distance_px)
    };
    let summary = summarize_intervals(&intervals);
    perf_probe::mark_count("scroll_intervals", summary.count);
    perf_probe::mark("scroll_interval_p50_ms", Some(summary.p50));
    perf_probe::mark("scroll_interval_p95_ms", Some(summary.p95));
    perf_probe::mark("scroll_interval_p99_ms", Some(summary.p99));
    perf_probe::mark("scroll_interval_max_ms", Some(summary.max));
    perf_probe::mark_count("scroll_long_intervals", summary.long);
    perf_probe::mark("scroll_distance_px", Some(f64::from(distance)));
    perf_probe::mark(
        "scroll_px_per_s",
        Some(f64::from(distance) / nominal.as_secs_f64()),
    );
    true
}

/// Runs the frame pump until its callbacks report the phase done. Fails with
/// `probe_error_frame_timeout` when frames stop for `FRAME_WATCHDOG_GRACE`
/// past the nominal duration, or never start.
async fn run_frame_phase(window: AnyWindowHandle, log: &SharedFrameLog, cx: &mut AsyncApp) -> bool {
    let nominal = log.borrow().duration;
    let registered = cx
        .update_window(window, |_, win, _| {
            let log = Rc::clone(log);
            win.refresh();
            win.on_next_frame(move |win, cx| pump(win, cx, log));
        })
        .is_ok();
    if !registered {
        perf_probe::mark_count("probe_error_frame_timeout", 0);
        return false;
    }
    let armed = Instant::now();
    loop {
        cx.background_executor().timer(POLL).await;
        let (done, frames, last) = {
            let log = log.borrow();
            (log.done, log.stamps.len(), log.stamps.last().copied())
        };
        if done {
            return true;
        }
        let silent_since = last.unwrap_or(armed);
        if silent_since.elapsed() > nominal + FRAME_WATCHDOG_GRACE {
            log.borrow_mut().stop = true;
            perf_probe::mark_count("probe_error_frame_timeout", frames);
            return false;
        }
    }
}

struct ScrollDriver {
    handle: gpui_kit::ScrollHandle,
    last_y: Pixels,
}

impl ScrollDriver {
    /// Moves to the triangle-wave position for `progress` in 0..=1 (0 → max
    /// → 0) and returns the distance actually travelled since the last frame,
    /// read back from the handle.
    fn step(&mut self, progress: f32) -> f32 {
        // `max_offset` is the positive scroll extent; offsets themselves grow
        // negative as the content scrolls up.
        let max = self.handle.max_offset().y;
        if max <= px(0.) {
            return 0.0;
        }
        let actual = -self.handle.offset().y;
        let moved = f32::from((actual - self.last_y).abs());
        let wave = if progress <= 0.5 {
            progress * 2.0
        } else {
            (1.0 - progress) * 2.0
        };
        let target = px(f32::from(max) * wave.clamp(0.0, 1.0));
        self.handle.set_offset(point(px(0.), -target));
        self.last_y = actual;
        moved
    }
}

/// Re-registers a redraw callback every frame until the phase completes.
fn pump(win: &mut gpui_kit::Window, _cx: &mut App, log: SharedFrameLog) {
    {
        let mut log = log.borrow_mut();
        if log.stop || log.done {
            return;
        }
        let now = Instant::now();
        let started = *log.started.get_or_insert(now);
        log.stamps.push(now);
        let elapsed = now.duration_since(started);
        let progress = (elapsed.as_secs_f32() / log.duration.as_secs_f32()).min(1.0);
        if let Some(driver) = log.driver.as_mut() {
            let moved = driver.step(progress);
            log.distance_px += moved;
        }
        if elapsed >= log.duration {
            log.done = true;
            return;
        }
    }
    // `request_animation_frame` needs a rendering view; outside render the
    // window is driven by marking it dirty, which schedules the next frame.
    win.refresh();
    win.on_next_frame(move |win, cx| pump(win, cx, log));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intervals_are_consecutive_frame_gaps_in_ms() {
        let base = Instant::now();
        let stamps = vec![
            base,
            base + Duration::from_millis(16),
            base + Duration::from_millis(50),
        ];
        let intervals = intervals_ms(&stamps);
        assert_eq!(intervals.len(), 2);
        assert!((intervals[0] - 16.0).abs() < 1.0);
        assert!((intervals[1] - 34.0).abs() < 1.0);
    }
}
