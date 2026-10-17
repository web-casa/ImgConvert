// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! ImgConvert GPUI shell: initialization, the main window, menus, global
//! actions and the perf-probe driver. Feature logic lives in the queue and
//! workflow crates; this crate only composes them.

pub mod blocked;
pub mod probe_driver;
pub mod workspace;

use std::time::Duration;

use gpui_kit::{App, KeyBinding, Menu, MenuItem, actions};
use imgconvert_gpui_shared::i18n::{self, Locale, tr};
use imgconvert_gpui_shared::{AppModels, Services, services, settings_model};

pub use blocked::open_blocked_window;
pub use workspace::{Workspace, open_main_window};

actions!(imgconvert, [Quit, OpenFiles, ToggleLanguage]);

/// How long quitting waits for in-flight atomic writes.
pub const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);

/// Initializes Kit, services (which load the persisted settings), the locale
/// from those settings, key bindings, menus and global actions. Call once
/// inside `Application::run`, before opening a window.
pub fn init_app(cx: &mut App) {
    gpui_kit::init(cx);
    services::init(cx);
    let locale = AppModels::global(cx).settings().read(cx).settings().locale;
    i18n::set_locale(Locale::from_app_locale(locale));
    settings_model::flush_on_quit(cx);

    cx.on_action(|_: &Quit, cx| {
        settings_model::flush(cx);
        let _ = Services::shutdown(cx, SHUTDOWN_TIMEOUT);
        cx.quit();
    });
    cx.on_action(|_: &OpenFiles, cx| imgconvert_gpui_queue::import::pick_and_import(cx));
    cx.on_action(|_: &ToggleLanguage, cx| toggle_language(cx));

    // Bind before building the menus so shortcuts show next to their items.
    cx.bind_keys([
        KeyBinding::new("secondary-q", Quit, None),
        KeyBinding::new("secondary-o", OpenFiles, None),
    ]);
    install_menus(cx);
}

/// Switches between English and Simplified Chinese, persists the choice and
/// rebuilds every window and the native menus, which cache their labels.
pub fn toggle_language(cx: &mut App) {
    let next = Locale::current().next();
    i18n::set_locale(next);
    let settings = AppModels::global(cx).settings().clone();
    settings.update(cx, |settings, cx| {
        settings.update(cx, |settings| settings.locale = next.app_locale());
    });
    install_menus(cx);
    cx.refresh_windows();
}

fn install_menus(cx: &mut App) {
    cx.set_menus(vec![
        Menu {
            name: tr("app.title"),
            items: vec![MenuItem::action(tr("app.quit"), Quit)],
            disabled: false,
        },
        Menu {
            name: tr("menu.file"),
            items: vec![MenuItem::action(tr("app.open_files"), OpenFiles)],
            disabled: false,
        },
    ]);
}
