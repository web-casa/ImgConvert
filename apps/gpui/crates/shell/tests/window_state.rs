// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The main window reopens where the saved state says and saves it on quit.

use gpui_kit::{AppContext as _, TestAppContext};
use imgconvert_backend::settings::Settings;
use imgconvert_gpui::window_state::{self, Kind, Rect, Saved};
use imgconvert_gpui::{init_app, open_main_window};
use imgconvert_gpui_shared::{SettingsModel, lifecycle, services};

fn state_file(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("imgconvert-ws-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(window_state::FILE_NAME)
}

fn open(cx: &mut TestAppContext, path: &std::path::Path) -> gpui_kit::AnyWindowHandle {
    cx.update(|cx| {
        services::init_with_settings(cx, || SettingsModel::in_memory(Settings::default()));
        init_app(cx);
        window_state::install(path.to_path_buf(), cx);
        open_main_window(cx).expect("open main window").0
    })
}

fn placed(cx: &mut TestAppContext, handle: gpui_kit::AnyWindowHandle) -> Rect {
    cx.update_window(handle, |_, window, _| {
        let (frame, content) = (window.bounds(), window.viewport_size());
        Rect {
            x: frame.origin.x.as_f32(),
            y: frame.origin.y.as_f32(),
            w: content.width.as_f32(),
            h: content.height.as_f32(),
        }
    })
    .unwrap()
}

#[gpui_kit::test]
fn the_window_reopens_at_the_saved_place_and_saves_it_on_quit(cx: &mut TestAppContext) {
    let path = state_file("saved");
    let restore = Rect {
        x: 200.,
        y: 150.,
        w: 900.,
        h: 600.,
    };
    window_state::store(
        &path,
        &Saved {
            kind: Kind::Windowed,
            maximized: false,
            restore,
            display_uuid: Some("a display that is gone".into()),
        },
    )
    .unwrap();
    let handle = open(cx, &path);
    cx.run_until_parked();
    assert_eq!(placed(cx, handle), restore);

    cx.update(lifecycle::run_before_quit_hooks);
    let saved = window_state::load(&path).expect("saved on quit");
    assert_eq!(saved.restore, restore);
    assert_eq!(saved.kind, Kind::Windowed);
    assert!(saved.display_uuid.is_some(), "records the test display");
    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}

#[gpui_kit::test]
fn a_damaged_file_opens_the_default_window(cx: &mut TestAppContext) {
    let path = state_file("damaged");
    std::fs::write(&path, b"not json").unwrap();
    let handle = open(cx, &path);
    cx.run_until_parked();
    let rect = placed(cx, handle);
    assert_eq!((rect.w, rect.h), window_state::DEFAULT_SIZE);
    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}
