// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Application-level globals (plan §2.3): the backend services live for the
//! process, the retained models live for the application, and neither is
//! owned by a window.

use std::sync::Arc;
use std::time::Duration;

use gpui_kit::{App, AppContext as _, Entity, Global};
use imgconvert_backend::import::ImportScanState;
use imgconvert_backend::service::{BatchService, ShutdownOutcome};

use crate::batch_model::BatchModel;
use crate::queue_model::QueueModel;

/// Backend services shared by every window.
#[derive(Clone)]
pub struct Services {
    batch: BatchService,
    import_scan: Arc<ImportScanState>,
}

impl Global for Services {}

impl Services {
    pub fn batch(&self) -> &BatchService {
        &self.batch
    }

    pub fn import_scan(&self) -> &Arc<ImportScanState> {
        &self.import_scan
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
}

impl Global for AppModels {}

impl AppModels {
    pub fn queue(&self) -> &Entity<QueueModel> {
        &self.queue
    }

    pub fn batch(&self) -> &Entity<BatchModel> {
        &self.batch
    }

    pub fn global(cx: &App) -> &Self {
        cx.global::<Self>()
    }
}

/// Registers services and models. Call once after `gpui_kit::init`.
pub fn init(cx: &mut App) {
    if !cx.has_global::<Services>() {
        cx.set_global(Services {
            batch: BatchService::new(),
            import_scan: Arc::new(ImportScanState::default()),
        });
    }
    if !cx.has_global::<AppModels>() {
        let queue = cx.new(|_| QueueModel::default());
        let batch = cx.new(|_| BatchModel::default());
        cx.set_global(AppModels { queue, batch });
    }
}
