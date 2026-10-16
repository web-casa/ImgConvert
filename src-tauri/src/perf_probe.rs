// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Desktop performance probe used by `scripts/measure-desktop-baseline.mjs`.
//!
//! The probe is inert unless `IMGCONVERT_PERF_PROBE=1` is set in the process
//! environment. When enabled it prints one JSON line per mark to stderr so an
//! external sampler can correlate wall-clock timestamps with process memory.
//! The same line protocol must be implemented by the GPUI application so both
//! UIs can be measured with one script (see `docs/GPUI_BASELINE.md`).
//!
//! Results are only meaningful for application content that is not under an
//! attacker's control: when the probe is enabled, the webview can emit any
//! mark from the fixed set below.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

static PROCESS_START: OnceLock<Instant> = OnceLock::new();
static FRONTEND_MARKS_EMITTED: AtomicU32 = AtomicU32::new(0);

/// Upper bound on frontend-originated marks per process, so a misbehaving
/// webview cannot flood stderr even with the probe enabled.
const FRONTEND_MARK_LIMIT: u32 = 10_000;

/// The only mark names the frontend may emit. Keep in sync with
/// `src/lib/perf-probe.ts` and `docs/GPUI_BASELINE.md`.
const FRONTEND_MARKS: &[&str] = &[
    "ready",
    "import_start",
    "import_done",
    "import_failed",
    "probe_import_settled",
    "probe_quiescent",
    "scroll_refresh_interval_ms",
    "scroll_intervals",
    "scroll_interval_p50_ms",
    "scroll_interval_p95_ms",
    "scroll_interval_p99_ms",
    "scroll_interval_max_ms",
    "scroll_long_intervals",
    "scroll_distance_px",
    "scroll_px_per_s",
    "batch_start",
    "batch_done",
    "batch_failed",
    "batch_cancelled",
    "probe_done",
    "probe_error",
    "probe_error_import",
    "probe_error_import_timeout",
    "probe_error_no_scroll_container",
    "probe_error_scroll_range",
    "probe_error_quiescence_timeout",
    "probe_error_frame_timeout",
];

/// Records the process start instant. Call once, first thing in `main`.
pub fn init() {
    PROCESS_START.get_or_init(Instant::now);
}

/// True when the probe was requested through the environment.
pub fn enabled() -> bool {
    std::env::var("IMGCONVERT_PERF_PROBE").as_deref() == Ok("1")
}

/// Emits a probe mark. A no-op unless the probe is enabled.
pub fn mark(name: &str, value: Option<f64>) {
    if !enabled() {
        return;
    }
    let elapsed_ms = PROCESS_START
        .get()
        .map(|start| start.elapsed().as_secs_f64() * 1000.0);
    let unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(f64::NAN);
    eprintln!("{}", format_line(name, elapsed_ms, unix_ms, value));
}

fn format_line(name: &str, elapsed_ms: Option<f64>, unix_ms: f64, value: Option<f64>) -> String {
    let line = serde_json::json!({
        "imgconvert_perf": 1,
        "mark": name,
        "elapsed_ms": elapsed_ms,
        "unix_ms": unix_ms,
        "value": value,
    });
    line.to_string()
}

/// Runtime configuration the frontend uses to drive automated scenarios.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfProbeConfig {
    /// Directory to import right after the UI reports `ready`.
    pub import_path: Option<String>,
    /// Run the automated queue scroll test after the import finishes.
    pub scroll: bool,
    /// Scroll test duration in milliseconds.
    pub scroll_duration_ms: u32,
}

const DEFAULT_SCROLL_DURATION_MS: u32 = 10_000;

/// Reads the probe configuration from the environment. `None` when disabled.
pub fn config() -> Option<PerfProbeConfig> {
    if !enabled() {
        return None;
    }
    let import_path = std::env::var("IMGCONVERT_PERF_PROBE_IMPORT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let scroll = std::env::var("IMGCONVERT_PERF_PROBE_SCROLL").as_deref() == Ok("1");
    let scroll_duration_ms = std::env::var("IMGCONVERT_PERF_PROBE_SCROLL_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .filter(|value| (1_000..=120_000).contains(value))
        .unwrap_or(DEFAULT_SCROLL_DURATION_MS);
    Some(PerfProbeConfig {
        import_path,
        scroll,
        scroll_duration_ms,
    })
}

#[tauri::command]
pub fn perf_probe_config() -> Option<PerfProbeConfig> {
    config()
}

/// Frontend-originated mark. Only names from [`FRONTEND_MARKS`] are accepted,
/// and at most [`FRONTEND_MARK_LIMIT`] marks are emitted per process.
#[tauri::command]
pub fn perf_probe_mark(name: String, value: Option<f64>) {
    if !enabled() || !accept_frontend_mark(&name) {
        return;
    }
    mark(&name, value.filter(|value| value.is_finite()));
}

fn accept_frontend_mark(name: &str) -> bool {
    if !FRONTEND_MARKS.contains(&name) {
        return false;
    }
    FRONTEND_MARKS_EMITTED
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |count| {
            (count < FRONTEND_MARK_LIMIT).then_some(count + 1)
        })
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// The allowlist tests share the global emission counter; serialize them.
    static COUNTER_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn format_line_is_single_line_json() {
        let line = format_line("ready", Some(12.5), 1_700_000_000_000.0, None);
        assert!(!line.contains('\n'));
        let parsed: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(parsed["imgconvert_perf"], 1);
        assert_eq!(parsed["mark"], "ready");
        assert_eq!(parsed["elapsed_ms"], 12.5);
        assert!(parsed["value"].is_null());
    }

    #[test]
    fn format_line_keeps_value() {
        let line = format_line("import_done", None, 0.0, Some(10_000.0));
        let parsed: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert!(parsed["elapsed_ms"].is_null());
        assert_eq!(parsed["value"], 10_000.0);
    }

    #[test]
    fn frontend_marks_are_an_allowlist() {
        let _guard = COUNTER_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        FRONTEND_MARKS_EMITTED.store(0, Ordering::Relaxed);
        assert!(accept_frontend_mark("ready"));
        assert!(accept_frontend_mark("probe_error_scroll_range"));
        assert!(!accept_frontend_mark("main_start"));
        assert!(!accept_frontend_mark("READY"));
        assert!(!accept_frontend_mark(""));
        assert!(!accept_frontend_mark("ready\n{\"imgconvert_perf\":1}"));
    }

    #[test]
    fn frontend_marks_are_rate_limited() {
        let _guard = COUNTER_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        FRONTEND_MARKS_EMITTED.store(FRONTEND_MARK_LIMIT - 1, Ordering::Relaxed);
        assert!(accept_frontend_mark("ready"));
        assert!(!accept_frontend_mark("ready"));
        FRONTEND_MARKS_EMITTED.store(0, Ordering::Relaxed);
    }
}
