// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Import workflow: scan user-selected paths on the background executor and
//! append the result to the queue. One scan at a time; the backend's
//! `ImportScanRegistration` travels with the background work so cancellation
//! reaches it even if the caller is gone.

use std::path::PathBuf;

use gpui_kit::{App, AppContext as _, AsyncApp, SharedString};
use imgconvert_backend::import::{self, ScanImportOptions};
use imgconvert_gpui_shared::file_prompt::{self, PromptKind};
use imgconvert_gpui_shared::i18n::tr;
use imgconvert_gpui_shared::queue_model::ImportFeedback;
use imgconvert_gpui_shared::{AppModels, Services, perf_probe};

/// Opens the platform picker and imports whatever the user selects.
pub fn pick_and_import(cx: &mut App) {
    let picker = file_prompt::prompt_paths(PromptKind::ImportPaths, tr("queue.add_files"), cx);
    cx.spawn(async move |cx: &mut AsyncApp| {
        if let Some(paths) = picker.await {
            cx.update(|cx| import_paths(paths, cx));
        }
    })
    .detach();
}

/// Scans `paths` recursively and appends supported images to the queue.
pub fn import_paths(paths: Vec<PathBuf>, cx: &mut App) {
    if paths.is_empty() {
        return;
    }
    let models = AppModels::global(cx).clone();
    let queue = models.queue().clone();
    let registration = match Services::global(cx).import_scan().begin() {
        Ok(registration) => registration,
        Err(detail) => {
            queue.update(cx, |queue, cx| {
                queue.set_feedback(ImportFeedback::Failed(SharedString::from(detail)));
                cx.notify();
            });
            return;
        }
    };
    let cancel = registration.token();
    let options = ScanImportOptions {
        paths: paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        recursive: true,
        max_files: None,
        max_entries: None,
        max_depth: None,
    };

    perf_probe::mark_count("import_start", paths.len());
    queue.update(cx, |queue, cx| {
        queue.set_importing(true);
        cx.notify();
    });

    cx.spawn(async move |cx: &mut AsyncApp| {
        let scan = cx
            .background_spawn(async move {
                let _registration = registration;
                import::scan_import_paths(options, cancel)
            })
            .await;
        cx.update(|cx| {
            queue.update(cx, |queue, cx| {
                // The scanner reports per-entry problems inside the result; a
                // scan itself cannot fail once it started.
                let cancelled = scan.cancelled;
                let skipped = scan.skipped + scan.errors.len();
                let added = queue.add_files(scan.files);
                queue.set_feedback(if cancelled {
                    ImportFeedback::Cancelled
                } else if added == 0 {
                    ImportFeedback::Nothing
                } else {
                    ImportFeedback::Added { added, skipped }
                });
                perf_probe::mark_count("import_done", queue.len());
                queue.set_importing(false);
                cx.notify();
            });
        });
    })
    .detach();
}

/// Requests cancellation of the running scan, if any.
pub fn cancel_import(cx: &App) -> bool {
    Services::global(cx).import_scan().cancel_current()
}
