// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! macOS pixel harness. GPUI's macOS platform must be created on the process
//! main thread; a normal `#[test]` runs on a worker thread and panics.

#[path = "support/pixels.rs"]
mod support;

fn main() {
    if cfg!(target_os = "macos") {
        support::run_solid_red_frame();
        support::run_workspace_surface();
    } else {
        eprintln!("skipping macOS pixel harness on this platform");
    }
}
