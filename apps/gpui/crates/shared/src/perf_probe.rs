// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! `IMGCONVERT_PERF_PROBE` protocol (docs/GPUI_BASELINE.md §2 and §7).
//!
//! When the variable is set the shell prints one JSON line per mark to
//! stderr. `scripts/measure-desktop-baseline.mjs` parses those lines, so the
//! field names and the mark vocabulary are a contract shared with the Tauri
//! shell; do not rename them here without changing the script.

use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const PROTOCOL_VERSION: u32 = 1;
const MAX_MARKS_PER_PROCESS: usize = 10_000;

static STARTED_AT: OnceLock<Instant> = OnceLock::new();
static CONFIG: OnceLock<Option<ProbeConfig>> = OnceLock::new();
static EMITTED: AtomicUsize = AtomicUsize::new(0);

/// What the probe should drive after the window is ready.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct ProbeConfig {
    /// Directory imported automatically once the UI is ready.
    pub import_dir: Option<PathBuf>,
    /// Scroll the queue after quiescence and report callback intervals.
    pub scroll: bool,
    /// Scroll duration in milliseconds (1 000–120 000, default 10 000).
    pub scroll_ms: u64,
    /// Output folder for an automatic batch after `probe_done` (GPUI shell
    /// only; replaces the operator click of the manual-batch scenario).
    pub batch_out_dir: Option<PathBuf>,
    /// Output format of the automatic batch (default: the panel's selection).
    pub batch_format: Option<String>,
}

impl ProbeConfig {
    fn from_env() -> Option<Self> {
        std::env::var_os("IMGCONVERT_PERF_PROBE")?;
        let import_dir = std::env::var_os("IMGCONVERT_PERF_PROBE_IMPORT")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let scroll =
            std::env::var_os("IMGCONVERT_PERF_PROBE_SCROLL").is_some_and(|value| value == "1");
        let scroll_ms = std::env::var("IMGCONVERT_PERF_PROBE_SCROLL_MS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .map_or(10_000, |value| value.clamp(1_000, 120_000));
        let batch_out_dir = std::env::var_os("IMGCONVERT_PERF_PROBE_BATCH_OUT")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let batch_format = std::env::var("IMGCONVERT_PERF_PROBE_BATCH_FORMAT")
            .ok()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());
        Some(Self {
            import_dir,
            scroll,
            scroll_ms,
            batch_out_dir,
            batch_format,
        })
    }
}

/// Records the process start. Call it as the first statement of `main`.
pub fn init() {
    let _ = STARTED_AT.set(Instant::now());
    let _ = CONFIG.set(ProbeConfig::from_env());
}

/// The probe configuration, or `None` when the probe is disabled.
pub fn config() -> Option<&'static ProbeConfig> {
    CONFIG.get().and_then(Option::as_ref)
}

pub fn is_enabled() -> bool {
    config().is_some()
}

/// Emits a mark. Silently ignored when the probe is disabled, when the name
/// is outside `[A-Za-z0-9_]{1,64}`, or after 10 000 marks.
pub fn mark(name: &str, value: Option<f64>) {
    if !is_enabled() || !is_valid_mark_name(name) {
        return;
    }
    if EMITTED.fetch_add(1, Ordering::Relaxed) >= MAX_MARKS_PER_PROCESS {
        return;
    }
    let elapsed_ms = STARTED_AT
        .get()
        .map(|started| started.elapsed().as_secs_f64() * 1_000.0);
    let unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64() * 1_000.0)
        .unwrap_or(0.0);
    let line = format_mark(name, elapsed_ms, unix_ms, value);
    eprintln!("{line}");
}

/// Convenience for marks whose value is a count.
pub fn mark_count(name: &str, count: usize) {
    mark(name, Some(count as f64));
}

fn format_mark(name: &str, elapsed_ms: Option<f64>, unix_ms: f64, value: Option<f64>) -> String {
    let elapsed = elapsed_ms.map_or_else(|| "null".to_string(), |ms| format!("{ms:.3}"));
    let value = value.map_or_else(|| "0".to_string(), |v| format!("{v}"));
    format!(
        "{{\"imgconvert_perf\":{PROTOCOL_VERSION},\"mark\":\"{name}\",\"elapsed_ms\":{elapsed},\"unix_ms\":{unix_ms:.3},\"value\":{value}}}"
    )
}

fn is_valid_mark_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

/// Percentile over callback intervals, matching `scripts/lib/desktop-baseline.mjs`.
pub fn percentile(sorted: &[f64], fraction: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let position = (sorted.len() - 1) as f64 * fraction;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    if lower == upper {
        return sorted[lower];
    }
    let weight = position - lower as f64;
    sorted[lower] * (1.0 - weight) + sorted[upper] * weight
}

/// Summary statistics of a scroll run, emitted as individual marks.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct IntervalSummary {
    pub count: usize,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
    pub max: f64,
    /// Intervals longer than 33 ms (two frames at 60 Hz).
    pub long: usize,
}

pub fn summarize_intervals(intervals: &[f64]) -> IntervalSummary {
    let mut sorted = intervals.to_vec();
    sorted.sort_by(f64::total_cmp);
    IntervalSummary {
        count: sorted.len(),
        p50: percentile(&sorted, 0.5),
        p95: percentile(&sorted, 0.95),
        p99: percentile(&sorted, 0.99),
        max: sorted.last().copied().unwrap_or(0.0),
        long: sorted.iter().filter(|interval| **interval > 33.0).count(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mark_lines_are_valid_json_with_the_contract_fields() {
        let line = format_mark("ready", Some(12.5), 1_760_000_000_123.4, Some(3.0));
        let parsed: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(parsed["imgconvert_perf"], 1);
        assert_eq!(parsed["mark"], "ready");
        assert_eq!(parsed["elapsed_ms"], 12.5);
        assert_eq!(parsed["value"], 3.0);
        assert!(parsed["unix_ms"].as_f64().unwrap() > 1.0e12);

        let line = format_mark("main_start", None, 1.0, None);
        let parsed: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert!(parsed["elapsed_ms"].is_null());
        assert_eq!(parsed["value"], 0);
    }

    #[test]
    fn mark_names_follow_the_protocol_alphabet() {
        assert!(is_valid_mark_name("scroll_interval_p99_ms"));
        assert!(!is_valid_mark_name(""));
        assert!(!is_valid_mark_name("has space"));
        assert!(!is_valid_mark_name(&"a".repeat(65)));
    }

    #[test]
    fn interval_summary_matches_the_script_percentiles() {
        let summary = summarize_intervals(&[16.0, 17.0, 16.5, 40.0, 16.0]);
        assert_eq!(summary.count, 5);
        assert_eq!(summary.long, 1);
        assert!((summary.max - 40.0).abs() < f64::EPSILON);
        assert!((summary.p50 - 16.5).abs() < f64::EPSILON);
        assert!(summary.p99 > 30.0);
        assert_eq!(summarize_intervals(&[]).count, 0);
    }
}
