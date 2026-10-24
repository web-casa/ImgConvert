// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Shared headless pixel checks for the normal test harness and the macOS
//! main-thread harness.

use std::collections::HashSet;
use std::sync::Arc;

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    AppContext as _, Bounds, HeadlessAppContext, ParentElement as _, Render, Styled as _,
    StyledImage as _, Window, WindowBounds, WindowOptions, div, point, px, rgb, size,
};
use imgconvert_backend::settings::Settings;
use imgconvert_gpui::{Workspace, init_app};
use imgconvert_gpui_shared::i18n::{Locale, set_locale};
use imgconvert_gpui_shared::{SettingsModel, services};

struct Solid;

/// White, with a translucent dark-red image over it decoded the way the
/// comparison preview decodes its PNGs.
struct Translucent(Arc<gpui_kit::RenderImage>);

impl Render for Translucent {
    fn render(
        &mut self,
        _: &mut Window,
        _: &mut gpui_kit::Context<Self>,
    ) -> impl gpui_kit::IntoElement {
        div().size_full().bg(rgb(0x00ff_ffff)).child(
            gpui_kit::img(gpui_kit::ImageSource::Render(self.0.clone()))
                .size_full()
                .object_fit(gpui_kit::ObjectFit::Fill),
        )
    }
}

impl Render for Solid {
    fn render(
        &mut self,
        _: &mut Window,
        _: &mut gpui_kit::Context<Self>,
    ) -> impl gpui_kit::IntoElement {
        div().size_full().bg(rgb(0x00ff_0000))
    }
}

pub fn pixel_tests_enabled() -> bool {
    std::env::var("IMGCONVERT_PIXEL_TESTS").as_deref() == Ok("1")
}

/// GPUI's macOS platform must be created on the process main thread. The Rust
/// test harness runs each test on a worker thread, so macOS needs the custom
/// `pixels_macos` harness before these pixel checks can run there.
pub fn main_thread_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::thread::current().name() == Some("main")
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub fn run_solid_red_frame() {
    if !pixel_tests_enabled() {
        eprintln!("skipping pixel test: set IMGCONVERT_PIXEL_TESTS=1 on a GPU-capable runner");
        return;
    }
    if !main_thread_available() {
        eprintln!("skipping pixel test: macOS needs a main-thread harness");
        return;
    }
    if !matches!(gpui_kit::platform::current_headless_renderer(), Ok(Some(_))) {
        eprintln!("skipping pixel test: no headless renderer on this platform");
        return;
    }
    let platform = gpui_kit::platform::current_platform(false);
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
    eprintln!(
        "pixel check passed: solid frame {}x{}",
        image.width(),
        image.height()
    );
}

pub fn run_workspace_surface() {
    if !pixel_tests_enabled() {
        eprintln!(
            "skipping workspace pixel test: set IMGCONVERT_PIXEL_TESTS=1 on a GPU-capable runner"
        );
        return;
    }
    if !main_thread_available() {
        eprintln!("skipping workspace pixel test: macOS needs a main-thread harness");
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
    eprintln!(
        "pixel check passed: workspace surface {}x{} with {} colors",
        image.width(),
        image.height(),
        colors.len()
    );
}

/// The comparison preview hands GPUI straight (not premultiplied) BGRA, as
/// GPUI's own decoder does. Red 100 at alpha 128 over white must blend to
/// about (177, 127, 127); reading the same bytes as premultiplied would give
/// about (227, 127, 127).
pub fn run_translucent_preview_image() {
    if !pixel_tests_enabled() {
        eprintln!(
            "skipping alpha pixel test: set IMGCONVERT_PIXEL_TESTS=1 on a GPU-capable runner"
        );
        return;
    }
    if !main_thread_available() {
        eprintln!("skipping alpha pixel test: macOS needs a main-thread harness");
        return;
    }
    if !matches!(gpui_kit::platform::current_headless_renderer(), Ok(Some(_))) {
        eprintln!("skipping alpha pixel test: no headless renderer on this platform");
        return;
    }
    let mut png = Vec::new();
    image::RgbaImage::from_pixel(8, 8, image::Rgba([100, 0, 0, 128]))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("encode PNG");
    let decoded = imgconvert_gpui_shared::images::decode_png(&png).expect("decode PNG");
    let platform = gpui_kit::platform::current_platform(false);
    let mut cx = HeadlessAppContext::with_platform(
        platform.text_system(),
        Arc::new(gpui_kit::assets::Assets),
        gpui_kit::platform::current_headless_renderer,
    );
    let handle = cx
        .open_window(size(px(40.), px(40.)), |_, cx| {
            cx.new(|_| Translucent(decoded))
        })
        .expect("open headless window");
    cx.run_until_parked();
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
    })
    .unwrap();
    let image = cx
        .capture_screenshot(handle.into())
        .expect("capture screenshot");
    let center = image.get_pixel(image.width() / 2, image.height() / 2);
    let near = |value: u8, expected: u8| value.abs_diff(expected) <= 6;
    assert!(
        near(center.0[0], 177) && near(center.0[1], 127) && near(center.0[2], 127),
        "straight-alpha blend over white, got {center:?}"
    );
    eprintln!("pixel check passed: translucent preview image blends to {center:?}");
}
