// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Application-level globals (plan §2.3): the backend services live for the
//! process, the retained models live for the application, and neither is
//! owned by a window.

use std::sync::Arc;
use std::time::Duration;

use gpui_kit::{App, AppContext as _, BorrowAppContext as _, Entity, Global, Task};
use imgconvert_backend::external_codecs;
use imgconvert_backend::import::{self, ClipboardImportState, ImportScanState};
use imgconvert_backend::preview::PreviewState;
use imgconvert_backend::service::{BatchService, ShutdownOutcome};

use crate::batch_model::BatchModel;
use crate::i18n::Locale;
use crate::queue_model::QueueModel;
use crate::settings_model::SettingsModel;

/// Backend services shared by every window.
#[derive(Clone)]
pub struct Services {
    batch: BatchService,
    import_scan: Arc<ImportScanState>,
    clipboard: Arc<ClipboardImportState>,
    /// The one current comparison preview; a newer one cancels the previous.
    preview: Arc<PreviewState>,
    codec_restore_complete: bool,
}

impl Global for Services {}

impl Services {
    pub fn batch(&self) -> &BatchService {
        &self.batch
    }

    pub fn import_scan(&self) -> &Arc<ImportScanState> {
        &self.import_scan
    }

    pub fn clipboard(&self) -> &Arc<ClipboardImportState> {
        &self.clipboard
    }

    pub fn preview(&self) -> &Arc<PreviewState> {
        &self.preview
    }

    /// Whether startup helper selection has finished, successfully or otherwise.
    /// Capability consumers wait for this latch before their first probe.
    pub fn is_codec_restore_complete(&self) -> bool {
        self.codec_restore_complete
    }

    pub fn global(cx: &App) -> &Self {
        cx.global::<Self>()
    }

    /// Cancels a running batch and waits for its atomic writes to finish.
    pub fn shutdown(cx: &App, timeout: Duration) -> ShutdownOutcome {
        cx.try_global::<Self>()
            .map_or(ShutdownOutcome::Completed, |services| {
                services.batch.shutdown(timeout)
            })
    }
}

/// The retained domain models, one of each per application.
#[derive(Clone)]
pub struct AppModels {
    queue: Entity<QueueModel>,
    batch: Entity<BatchModel>,
    settings: Entity<SettingsModel>,
}

impl Global for AppModels {}

impl AppModels {
    pub fn queue(&self) -> &Entity<QueueModel> {
        &self.queue
    }

    pub fn batch(&self) -> &Entity<BatchModel> {
        &self.batch
    }

    pub fn settings(&self) -> &Entity<SettingsModel> {
        &self.settings
    }

    pub fn global(cx: &App) -> &Self {
        cx.global::<Self>()
    }
}

/// Registers services and models, loading the settings from the shared
/// per-channel store. Call once after `gpui_kit::init`.
pub fn init(cx: &mut App) {
    if !cx.has_global::<Services>() {
        cx.background_executor()
            .spawn(async {
                import::cleanup_stale_clipboard_temp_dirs_best_effort();
            })
            .detach();
    }
    init_with_settings(cx, || {
        SettingsModel::from_data_dir(Locale::from_environment().app_locale())
    });
}

/// Like [`init`], but with the settings model the caller provides (tests use
/// an in-memory model). A second call is a no-op.
pub fn init_with_settings(cx: &mut App, settings: impl FnOnce() -> SettingsModel) {
    init_with_restore(cx, settings, |path, cx| {
        let worker = crate::tasks::run_blocking("imgconvert-restore-heic", cx, move || {
            external_codecs::set_selected_heic_helper(Some(path)).map(|_| ())
        });
        cx.background_executor()
            .spawn(async move { worker.await.and_then(|result| result) })
    });
}

fn init_with_restore(
    cx: &mut App,
    settings: impl FnOnce() -> SettingsModel,
    restore: impl FnOnce(String, &mut App) -> Task<Result<(), String>>,
) {
    if !cx.has_global::<Services>() {
        cx.set_global(Services {
            batch: BatchService::new(),
            import_scan: Arc::new(ImportScanState::default()),
            clipboard: Arc::new(ClipboardImportState::default()),
            preview: Arc::new(PreviewState::default()),
            codec_restore_complete: true,
        });
    }
    if !cx.has_global::<AppModels>() {
        let queue = cx.new(|_| QueueModel::default());
        let batch = cx.new(|_| BatchModel::default());
        let settings = cx.new(|_| settings());
        // A repaired or migrated record is written once, like the Tauri shell.
        let heic_helper = settings.update(cx, |model, cx| {
            if model.is_dirty() {
                model.schedule_save(cx);
            }
            model.settings().heic_helper_path.clone()
        });
        // A manually chosen HEIC helper outside the discovery paths must be
        // selected again in this process; the probe runs off the foreground.
        if let Some(path) = heic_helper {
            cx.update_global::<Services, _>(|services, _| {
                services.codec_restore_complete = false;
            });
            let task = restore(path, cx);
            cx.spawn(async move |cx| {
                if let Err(error) = task.await {
                    eprintln!("imgconvert: persisted HEIC helper not usable: {error}");
                }
                // Notify even after an unusable helper: capability probing must
                // see the settled configuration and is not a permission gate.
                cx.update_global::<Services, _>(|services, _| {
                    services.codec_restore_complete = true;
                });
            })
            .detach();
        }
        cx.set_global(AppModels {
            queue,
            batch,
            settings,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::TestAppContext;
    use imgconvert_backend::settings::Settings;
    use std::cell::Cell;
    use std::rc::Rc;

    fn assert_restore_latch(cx: &mut TestAppContext, outcome: Result<(), String>) {
        let notifications = Rc::new(Cell::new(0));
        cx.update(|cx| {
            let mut settings = Settings::default();
            settings.heic_helper_path = Some("/owned-fixture/helper".into());
            init_with_restore(
                cx,
                || SettingsModel::in_memory(settings),
                move |path, cx| {
                    assert_eq!(path, "/owned-fixture/helper");
                    // Controlled async work; no helper or real filesystem is used.
                    let delay = cx.background_executor().timer(Duration::from_millis(100));
                    cx.background_executor().spawn(async move {
                        delay.await;
                        outcome
                    })
                },
            );
            assert!(!Services::global(cx).is_codec_restore_complete());
            let count = Rc::clone(&notifications);
            cx.observe_global::<Services>(move |cx| {
                if Services::global(cx).is_codec_restore_complete() {
                    count.set(count.get() + 1);
                }
            })
            .detach();
        });
        cx.run_until_parked();
        cx.executor().advance_clock(Duration::from_millis(50));
        cx.run_until_parked();
        cx.update(|cx| assert!(!Services::global(cx).is_codec_restore_complete()));
        assert_eq!(notifications.get(), 0);
        cx.executor().advance_clock(Duration::from_millis(51));
        cx.run_until_parked();
        cx.update(|cx| {
            assert!(Services::global(cx).is_codec_restore_complete());
            init_with_restore(
                cx,
                || panic!("settings must not reload"),
                |_, _| {
                    panic!("helper must not restore twice");
                },
            );
        });
        assert_eq!(
            notifications.get(),
            1,
            "one completion notification wakes capability consumers"
        );
    }

    #[gpui_kit::test]
    fn codec_capabilities_wait_for_restore_and_receive_completion(cx: &mut TestAppContext) {
        assert_restore_latch(cx, Ok(()));
    }

    #[gpui_kit::test]
    fn failed_codec_restore_also_releases_capability_consumers(cx: &mut TestAppContext) {
        assert_restore_latch(cx, Err("fixture helper unavailable".into()));
    }

    #[gpui_kit::test]
    fn no_manual_helper_does_not_delay_capability_consumers(cx: &mut TestAppContext) {
        cx.update(|cx| {
            init_with_restore(
                cx,
                || SettingsModel::in_memory(Settings::default()),
                |_, _| {
                    panic!("no helper path must not dispatch a restore");
                },
            );
            assert!(Services::global(cx).is_codec_restore_complete());
        });
    }
}
