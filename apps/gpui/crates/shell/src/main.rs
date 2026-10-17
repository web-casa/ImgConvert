// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

use gpui_kit::Global;
use imgconvert_backend::instance_lock::{self, AcquireOutcome, InstanceInfo, InstanceLock};
use imgconvert_backend::paths;
use imgconvert_backend::settings::Settings;
use imgconvert_gpui::{init_app, open_blocked_window, open_main_window, probe_driver};
use imgconvert_gpui_shared::i18n::Locale;
use imgconvert_gpui_shared::{SettingsModel, perf_probe, services};

/// Marker flavor written to `instance.lock`; the Tauri line writes `tauri`.
const INSTANCE_FLAVOR: &str = "gpui";

/// Keeps the marker's file open for the application's lifetime.
struct HeldInstanceLock(#[allow(dead_code)] Option<InstanceLock>);

impl Global for HeldInstanceLock {}

enum Startup {
    /// The marker is ours (or could not be written at all).
    Run(Option<InstanceLock>),
    /// Another ImgConvert holds the marker; never touch the shared store.
    Blocked(Option<InstanceInfo>),
}

fn main() {
    perf_probe::init();
    perf_probe::mark("main_start", None);

    // Held for the whole run; the OS releases the lock when the process ends,
    // cleanly or not.
    let startup = acquire_instance_lock();

    let app = gpui_kit::application().with_assets(gpui_kit::assets::Assets);
    perf_probe::mark("rust_run", None);
    app.run(move |cx| {
        let instance_lock = match startup {
            Startup::Run(lock) => lock,
            Startup::Blocked(other) => {
                // Settings stay in memory: the other instance owns the file
                // and nothing here may schedule a write to it.
                services::init_with_settings(cx, || {
                    SettingsModel::in_memory(Settings::defaults_for(
                        Locale::from_environment().app_locale(),
                    ))
                });
                init_app(cx);
                match open_blocked_window(other, cx) {
                    Ok(_) => cx.activate(true),
                    Err(error) => {
                        eprintln!("imgconvert: another ImgConvert is running ({error:#})");
                        cx.quit();
                    }
                }
                return;
            }
        };
        cx.set_global(HeldInstanceLock(instance_lock));
        init_app(cx);
        match open_main_window(cx) {
            Ok((window, workspace)) => {
                probe_driver::start(window, workspace, cx);
                cx.activate(true);
            }
            Err(error) => {
                eprintln!("imgconvert: cannot open the main window: {error:#}");
                cx.quit();
            }
        }
    });
}

/// Takes the single-instance marker. Without a data directory or on an I/O
/// failure other than contention the shell still starts (and settings then
/// cannot be saved either, which the panel reports).
fn acquire_instance_lock() -> Startup {
    let Some(path) = paths::instance_lock_file() else {
        return Startup::Run(None);
    };
    let info = InstanceInfo::new(INSTANCE_FLAVOR, env!("CARGO_PKG_VERSION"));
    match instance_lock::acquire(&path, info) {
        Ok(AcquireOutcome::Acquired(lock)) => Startup::Run(Some(lock)),
        Ok(AcquireOutcome::HeldByOther(other)) => Startup::Blocked(other),
        Err(error) => {
            eprintln!(
                "imgconvert: cannot write the instance marker at {}: {error}",
                path.display()
            );
            Startup::Run(None)
        }
    }
}
