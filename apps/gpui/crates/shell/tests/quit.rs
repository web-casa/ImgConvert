// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The quit coordinator against the real workspace in a headless window. The
//! test platform's `quit` does nothing, so the coordinator's phase and the
//! models show what quitting would have done.

use gpui_kit::{
    AppContext, Bounds, TerminateReason, TerminateReply, TestAppContext, WindowBounds,
    WindowOptions, px, size,
};
use imgconvert_backend::settings::Settings;
use imgconvert_gpui::lifecycle::{self, Phase};
use imgconvert_gpui::{Workspace, init_app};
use imgconvert_gpui_shared::i18n::{Locale, set_locale};
use imgconvert_gpui_shared::progress_bridge::{self, StartError};
use imgconvert_gpui_shared::{AppModels, SettingsModel, services};
use imgconvert_gpui_workflow::NumberField;

fn open_workspace(
    cx: &mut TestAppContext,
) -> (gpui_kit::AnyWindowHandle, gpui_kit::Entity<Workspace>) {
    cx.update(|cx| {
        services::init_with_settings(cx, || SettingsModel::in_memory(Settings::default()));
        init_app(cx);
        set_locale(Locale::English);
        let opened = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    gpui_kit::Point::default(),
                    size(px(1_000.), px(640.)),
                ))),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| Workspace::new(window, cx)),
        )
        .expect("open test window");
        lifecycle::set_main_window(opened.0, cx);
        opened
    })
}

#[gpui_kit::test]
fn closing_the_idle_main_window_quits_and_refuses_new_batches(cx: &mut TestAppContext) {
    open_workspace(cx);
    cx.update(|cx| {
        assert_eq!(lifecycle::phase(cx), Phase::Running);
        assert!(lifecycle::window_should_close(cx));
        assert_eq!(lifecycle::phase(cx), Phase::Exiting);
        assert!(imgconvert_gpui_shared::lifecycle::is_quitting(cx));
        // A Start that raced the quit is refused before any backend work.
        assert_eq!(
            progress_bridge::start_batch(vec!["late".into()], Vec::new(), None, cx),
            Err(StartError::Quitting)
        );
        // Further requests are absorbed; the platform may terminate.
        lifecycle::request_quit(cx);
        assert_eq!(lifecycle::phase(cx), Phase::Exiting);
        assert!(lifecycle::window_should_close(cx));
        assert_eq!(
            lifecycle::should_terminate(TerminateReason::UserQuit, cx),
            TerminateReply::Now
        );
    });
}

#[gpui_kit::test]
fn the_platform_quit_without_a_batch_terminates_at_once(cx: &mut TestAppContext) {
    open_workspace(cx);
    cx.update(|cx| {
        assert_eq!(
            lifecycle::should_terminate(TerminateReason::UserQuit, cx),
            TerminateReply::Now
        );
        assert_eq!(lifecycle::phase(cx), Phase::Exiting);
    });
}

#[gpui_kit::test]
fn quitting_commits_a_number_typed_without_blur(cx: &mut TestAppContext) {
    let (handle, workspace) = open_workspace(cx);
    let form = cx.update(|cx| {
        workspace
            .read(cx)
            .workflow()
            .read(cx)
            .settings_form()
            .clone()
    });
    cx.update_window(handle, |_, window, cx| {
        let input = form
            .read(cx)
            .number_input(NumberField::PdfDpi)
            .expect("pdf dpi input")
            .clone();
        input.update(cx, |input, cx| input.set_value("240", window, cx));
    })
    .unwrap();
    cx.update(|cx| {
        let before = AppModels::global(cx).settings().read(cx).settings().pdf_dpi;
        assert_ne!(before, 240, "typing alone does not commit");
        lifecycle::request_quit(cx);
        assert_eq!(
            AppModels::global(cx).settings().read(cx).settings().pdf_dpi,
            240
        );
    });
}

#[gpui_kit::test]
fn quitting_commits_a_draft_while_the_batch_model_has_not_settled(cx: &mut TestAppContext) {
    let (handle, workspace) = open_workspace(cx);
    let form = cx.update(|cx| {
        workspace
            .read(cx)
            .workflow()
            .read(cx)
            .settings_form()
            .clone()
    });
    cx.update_window(handle, |_, window, cx| {
        let input = form
            .read(cx)
            .number_input(NumberField::PdfDpi)
            .expect("pdf dpi input")
            .clone();
        input.update(cx, |input, cx| input.set_value("180", window, cx));
    })
    .unwrap();
    cx.update(|cx| {
        // A stopped batch whose model has not caught up yet keeps the form
        // busy; the quit commit must not depend on it.
        let batch = AppModels::global(cx).batch().clone();
        batch.update(cx, |batch, _| {
            batch.begin(
                imgconvert_backend::progress::BatchId::new(1),
                vec!["one".into()],
            );
        });
        assert!(form.read(cx).is_busy(cx));
        lifecycle::request_quit(cx);
        assert_eq!(
            AppModels::global(cx).settings().read(cx).settings().pdf_dpi,
            180
        );
    });
}

#[gpui_kit::test]
fn the_menus_follow_the_macos_layout(cx: &mut TestAppContext) {
    open_workspace(cx);
    let menus = cx.update(|cx| {
        // Menus cache their labels; rebuild them in English.
        imgconvert_gpui::set_language(Locale::English, cx);
        cx.get_menus().expect("menus are installed")
    });
    let names: Vec<_> = menus.iter().map(|menu| menu.name.to_string()).collect();
    assert_eq!(names, ["ImgConvert", "File", "Edit", "Window"]);
    let items = |index: usize| -> Vec<String> {
        menus[index]
            .items
            .iter()
            .filter_map(|item| match item {
                gpui_kit::OwnedMenuItem::Action { name, .. } => Some(name.clone()),
                gpui_kit::OwnedMenuItem::SystemMenu(menu) => Some(menu.name.to_string()),
                _ => None,
            })
            .collect()
    };
    assert_eq!(
        items(0),
        [
            "About ImgConvert",
            "Settings…",
            "Services",
            "Hide ImgConvert",
            "Hide Others",
            "Show All",
            "Quit ImgConvert"
        ]
    );
    assert_eq!(
        items(2),
        ["Undo", "Redo", "Cut", "Copy", "Paste", "Select All"]
    );
    assert_eq!(items(3), ["Minimize", "Zoom", "Enter Full Screen"]);
}

#[gpui_kit::test]
fn close_window_quits_like_the_close_button(cx: &mut TestAppContext) {
    let (handle, _) = open_workspace(cx);
    cx.update_window(handle, |_, window, cx| {
        window.dispatch_action(Box::new(imgconvert_gpui::CloseWindow), cx);
    })
    .unwrap();
    cx.update(|cx| assert_eq!(lifecycle::phase(cx), Phase::Exiting));
}
