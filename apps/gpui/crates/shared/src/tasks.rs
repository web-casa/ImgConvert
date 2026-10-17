// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Blocking backend calls (file system scans, native encoders) run on a
//! dedicated thread; a GPUI background task only polls for completion. That
//! keeps GPUI's shared workers free for thumbnails and autosave, and turns a
//! panic into an error instead of a dead executor worker.

use std::time::Duration;

use gpui_kit::{App, Task};

const POLL: Duration = Duration::from_millis(50);

/// Runs `work` on its own thread and resolves with its result, or with the
/// panic message when the thread unwound.
pub fn run_blocking<T: Send + 'static>(
    name: &str,
    cx: &App,
    work: impl FnOnce() -> T + Send + 'static,
) -> Task<Result<T, String>> {
    let executor = cx.background_executor().clone();
    let name = name.to_string();
    let spawned = std::thread::Builder::new().name(name.clone()).spawn(work);
    cx.background_executor().spawn(async move {
        let worker = spawned.map_err(|error| format!("{name} thread could not start: {error}"))?;
        while !worker.is_finished() {
            executor.timer(POLL).await;
        }
        worker.join().map_err(|payload| {
            let message = payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "no message".to_string());
            format!("{name} thread panicked: {message}")
        })
    })
}
