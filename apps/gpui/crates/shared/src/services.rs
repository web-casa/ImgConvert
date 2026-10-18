// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Application-level globals (plan §2.3): the backend services live for the
//! process, the retained models live for the application, and neither is
//! owned by a window.

use std::sync::Arc;
use std::time::Duration;

use gpui_kit::{App, AppContext as _, Entity, Global};
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
    if !cx.has_global::<Services>() {
        cx.set_global(Services {
            batch: BatchService::new(),
            import_scan: Arc::new(ImportScanState::default()),
            clipboard: Arc::new(ClipboardImportState::default()),
            preview: Arc::new(PreviewState::default()),
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
            cx.background_executor()
                .spawn(async move {
                    if let Err(error) = external_codecs::set_selected_heic_helper(Some(path)) {
                        eprintln!("imgconvert: persisted HEIC helper not usable: {error}");
                    }
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
