// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Pixel-sensitivity smoke tests for the headless Metal/WGPU renderer.

#[path = "support/pixels.rs"]
mod support;

#[test]
fn headless_renderer_captures_a_solid_red_frame() {
    support::run_solid_red_frame();
}

#[test]
fn headless_renderer_captures_the_workspace_surface() {
    support::run_workspace_surface();
}
