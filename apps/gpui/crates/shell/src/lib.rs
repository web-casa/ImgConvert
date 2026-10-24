// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! ImgConvert GPUI shell: initialization, the main window, menus, global
//! actions and the perf-probe driver. Feature logic lives in the queue and
//! workflow crates; this crate only composes them.

pub mod appearance;
pub mod blocked;
pub mod language;
pub mod lifecycle;
pub mod probe_driver;
pub mod window_state;
pub mod workspace;

use gpui_kit::{App, KeyBinding, Menu, MenuItem, Window, actions};
use imgconvert_gpui_shared::i18n::{self, Locale, tr};
use imgconvert_gpui_shared::{AppModels, services, settings_model, theme};

pub use blocked::open_blocked_window;
pub use workspace::{Workspace, open_main_window};

actions!(
    imgconvert,
    [
        Quit,
        OpenFiles,
        About,
        OpenSettings,
        HideApp,
        HideOtherApps,
        ShowAllApps,
        Minimize,
        Zoom,
        ToggleFullScreen,
        CloseWindow,
    ]
);

/// Initializes Kit, services (which load the persisted settings), the product
/// theme and locale from those settings, key bindings, menus and global actions. Call once
/// inside `Application::run`, before opening a window.
pub fn init_app(cx: &mut App) {
    gpui_kit::init(cx);
    services::init(cx);
    theme::install(cx);
    imgconvert_gpui_app_settings::init(cx);
    let locale = AppModels::global(cx).settings().read(cx).settings().locale;
    i18n::set_locale(Locale::from_app_locale(locale));
    // A fallback: the coordinator flushes on every path it controls.
    settings_model::flush_on_quit(cx);
    lifecycle::install(cx);

    cx.on_action(|_: &Quit, cx| lifecycle::request_quit(cx));
    cx.on_action(|_: &OpenFiles, cx| imgconvert_gpui_queue::import::pick_and_import(cx));
    cx.on_action(|_: &About, cx| {
        in_active_window(cx, |window, cx| {
            // Choosing About again must not stack a second copy.
            if gpui_kit::component::WindowExt::has_active_dialog(window, cx) {
                return;
            }
            imgconvert_gpui_app_settings::legal::open_licenses(window, cx);
        });
    });
    cx.on_action(|_: &HideApp, cx| cx.hide());
    cx.on_action(|_: &HideOtherApps, cx| cx.hide_other_apps());
    cx.on_action(|_: &ShowAllApps, cx| cx.unhide_other_apps());
    cx.on_action(|_: &Minimize, cx| in_active_window(cx, |window, _| window.minimize_window()));
    cx.on_action(|_: &Zoom, cx| in_active_window(cx, |window, _| window.zoom_window()));
    cx.on_action(|_: &ToggleFullScreen, cx| {
        in_active_window(cx, |window, _| window.toggle_fullscreen());
    });
    // The only window: closing it quits, through the coordinator.
    cx.on_action(|_: &CloseWindow, cx| {
        lifecycle::window_should_close(cx);
    });

    // Bind before building the menus so shortcuts show next to their items.
    cx.bind_keys([
        KeyBinding::new("secondary-q", Quit, None),
        KeyBinding::new("secondary-o", OpenFiles, None),
        KeyBinding::new("secondary-,", OpenSettings, None),
        KeyBinding::new("secondary-h", HideApp, None),
        KeyBinding::new("alt-secondary-h", HideOtherApps, None),
        KeyBinding::new("secondary-m", Minimize, None),
        KeyBinding::new("ctrl-secondary-f", ToggleFullScreen, None),
        KeyBinding::new("secondary-w", CloseWindow, None),
        KeyBinding::new(
            "secondary-v",
            gpui_kit::component::input::Paste,
            Some("Workspace"),
        ),
    ]);
    install_menus(cx);
}

/// Switches between English and Simplified Chinese (from any other locale,
/// to English).
pub fn toggle_language(cx: &mut App) {
    set_language(Locale::current().toggled(), cx);
}

/// Sets the interface language, persists the choice and rebuilds every
/// window and the native menus, which cache their labels.
pub fn set_language(next: Locale, cx: &mut App) {
    i18n::set_locale(next);
    let settings = AppModels::global(cx).settings().clone();
    settings.update(cx, |settings, cx| {
        settings.update(cx, |settings| settings.locale = next.app_locale());
    });
    install_menus(cx);
    cx.refresh_windows();
}

/// Runs `f` in the active window once the current update has finished: an
/// action from a key binding or the menu arrives while that window is being
/// updated.
fn in_active_window(cx: &mut App, f: impl FnOnce(&mut Window, &mut App) + 'static) {
    cx.defer(move |cx| {
        if let Some(handle) = cx.active_window() {
            let _ = handle.update(cx, |_, window, cx| f(window, cx));
        }
    });
}

/// The standard macOS menus. The Window menu keeps a translated title, so
/// AppKit does not add its window list to it; ImgConvert has one window.
fn install_menus(cx: &mut App) {
    use gpui_kit::component::input::{Copy, Cut, Paste, Redo, SelectAll, Undo};
    use gpui_kit::{OsAction, SystemMenuType};
    cx.set_menus(vec![
        Menu {
            name: tr("app.title"),
            items: vec![
                MenuItem::action(tr("menu.about"), About),
                MenuItem::separator(),
                MenuItem::action(tr("menu.settings"), OpenSettings),
                MenuItem::separator(),
                MenuItem::os_submenu(tr("menu.services"), SystemMenuType::Services),
                MenuItem::separator(),
                MenuItem::action(tr("menu.hide"), HideApp),
                MenuItem::action(tr("menu.hide_others"), HideOtherApps),
                MenuItem::action(tr("menu.show_all"), ShowAllApps),
                MenuItem::separator(),
                MenuItem::action(tr("app.quit"), Quit),
            ],
            disabled: false,
        },
        Menu {
            name: tr("menu.file"),
            items: vec![
                MenuItem::action(tr("app.open_files"), OpenFiles),
                MenuItem::separator(),
                MenuItem::action(tr("menu.close_window"), CloseWindow),
            ],
            disabled: false,
        },
        Menu {
            name: tr("menu.edit"),
            items: vec![
                MenuItem::os_action(tr("menu.undo"), Undo, OsAction::Undo),
                MenuItem::os_action(tr("menu.redo"), Redo, OsAction::Redo),
                MenuItem::separator(),
                MenuItem::os_action(tr("menu.cut"), Cut, OsAction::Cut),
                MenuItem::os_action(tr("menu.copy"), Copy, OsAction::Copy),
                MenuItem::os_action(tr("queue.paste"), Paste, OsAction::Paste),
                MenuItem::os_action(tr("menu.select_all"), SelectAll, OsAction::SelectAll),
            ],
            disabled: false,
        },
        Menu {
            name: tr("menu.window"),
            items: vec![
                MenuItem::action(tr("menu.minimize"), Minimize),
                MenuItem::action(tr("menu.zoom"), Zoom),
                MenuItem::separator(),
                MenuItem::action(tr("menu.fullscreen"), ToggleFullScreen),
            ],
            disabled: false,
        },
    ]);
}
