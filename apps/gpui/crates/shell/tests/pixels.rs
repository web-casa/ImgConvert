// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Pixel-sensitivity smoke test for the headless Metal/WGPU renderer.

use std::sync::Arc;

use std::collections::HashSet;

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    AppContext as _, Bounds, HeadlessAppContext, Render, Styled as _, Window, WindowBounds,
    WindowOptions, div, point, px, rgb, size,
};
use imgconvert_backend::settings::Settings;
use imgconvert_gpui::{Workspace, init_app};
use imgconvert_gpui_shared::i18n::{Locale, set_locale};
use imgconvert_gpui_shared::{SettingsModel, services};

struct Solid;

impl Render for Solid {
    fn render(
        &mut self,
        _: &mut Window,
        _: &mut gpui_kit::Context<Self>,
    ) -> impl gpui_kit::IntoElement {
        div().size_full().bg(rgb(0x00ff_0000))
    }
}

fn pixel_tests_enabled() -> bool {
    std::env::var("IMGCONVERT_PIXEL_TESTS").as_deref() == Ok("1")
}

#[test]
fn headless_renderer_captures_a_solid_red_frame() {
    if !pixel_tests_enabled() {
        eprintln!("skipping pixel test: set IMGCONVERT_PIXEL_TESTS=1 on a GPU-capable runner");
        return;
    }
    let platform = gpui_kit::platform::current_platform(false);
    if !matches!(gpui_kit::platform::current_headless_renderer(), Ok(Some(_))) {
        eprintln!("skipping pixel test: no headless renderer on this platform");
        return;
    }
    let mut cx = HeadlessAppContext::with_platform(
        platform.text_system(),
        Arc::new(gpui_kit::assets::Assets),
        gpui_kit::platform::current_headless_renderer,
    );
    let handle = cx
        .open_window(size(px(40.), px(40.)), |_, cx| cx.new(|_| Solid))
        .expect("open headless window");
    cx.run_until_parked();
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
    })
    .unwrap();
    let image = cx
        .capture_screenshot(handle.into())
        .expect("capture screenshot");
    assert!(image.width() > 0 && image.height() > 0);
    let center = image.get_pixel(image.width() / 2, image.height() / 2);
    assert_eq!(center.0[0], 255, "red channel: {center:?}");
    assert_eq!(center.0[1], 0, "green channel: {center:?}");
    assert_eq!(center.0[2], 0, "blue channel: {center:?}");
}

#[test]
fn headless_renderer_captures_the_workspace_surface() {
    if !pixel_tests_enabled() {
        eprintln!(
            "skipping workspace pixel test: set IMGCONVERT_PIXEL_TESTS=1 on a GPU-capable runner"
        );
        return;
    }
    if !matches!(gpui_kit::platform::current_headless_renderer(), Ok(Some(_))) {
        eprintln!("skipping workspace pixel test: no headless renderer on this platform");
        return;
    }
    let platform = gpui_kit::platform::current_platform(false);
    let mut cx = HeadlessAppContext::with_platform(
        platform.text_system(),
        Arc::new(gpui_kit::assets::Assets),
        gpui_kit::platform::current_headless_renderer,
    );
    let (handle, _workspace) = cx.update(|cx| {
        services::init_with_settings(cx, || SettingsModel::in_memory(Settings::default()));
        init_app(cx);
        set_locale(Locale::English);
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    point(px(0.), px(0.)),
                    size(px(800.), px(600.)),
                ))),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| Workspace::new(window, cx)),
        )
        .expect("open workspace")
    });
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
    })
    .unwrap();
    let image = cx.capture_screenshot(handle).expect("capture workspace");
    assert!(image.width() >= 800 && image.height() >= 600);
    let colors: HashSet<[u8; 4]> = image.pixels().map(|pixel| pixel.0).collect();
    assert!(
        colors.len() > 20,
        "workspace render must contain a UI surface, got {} colors",
        colors.len()
    );
    let center = image.get_pixel(image.width() / 2, image.height() / 2);
    assert_ne!(center.0, [0, 0, 0, 0], "center must not be transparent");
}
