// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Import workflow: scan user-selected paths on the background executor and
//! append the result to the queue. One scan at a time; the backend's
//! `ImportScanRegistration` travels with the background work so cancellation
//! reaches it even if the caller is gone.

use std::path::PathBuf;

use gpui_kit::{App, AppContext as _, AsyncApp};
use imgconvert_backend::import::{self, ImportScanResult, ScanImportOptions};
use imgconvert_gpui_shared::file_prompt::{self, PromptKind};
use imgconvert_gpui_shared::i18n::tr;
use imgconvert_gpui_shared::queue_model::ImportFeedback;
use imgconvert_gpui_shared::{AppModels, QueueModel, Services, perf_probe};

/// Opens the platform picker and imports whatever the user selects.
pub fn pick_and_import(cx: &mut App) {
    pick_paths(PromptKind::ImportPaths, "queue.add_files", cx);
}

/// Opens the native folder picker; scanning and cancellation use the same import owner.
pub fn pick_folders_and_import(cx: &mut App) {
    pick_paths(PromptKind::ImportFolders, "queue.add_folders", cx);
}

fn pick_paths(kind: PromptKind, label: &str, cx: &mut App) {
    let picker = file_prompt::prompt_paths(kind, tr(label), cx);
    cx.spawn(async move |cx: &mut AsyncApp| {
        if let Some(paths) = picker.await {
            cx.update(|cx| import_paths(paths, cx));
        }
    })
    .detach();
}

/// Scans `paths` recursively and appends supported images to the queue.
pub fn import_paths(paths: Vec<PathBuf>, cx: &mut App) {
    if paths.is_empty() || AppModels::global(cx).queue().read(cx).is_importing() {
        return;
    }
    let models = AppModels::global(cx).clone();
    let queue = models.queue().clone();
    let registration = match Services::global(cx).import_scan().begin() {
        Ok(registration) => registration,
        Err(detail) => {
            queue.update(cx, |queue, cx| {
                queue.set_feedback(ImportFeedback::Failed(
                    imgconvert_backend::command_error::CommandError::import_failed(None, detail),
                ));
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
        // Keep the registration through the foreground commit: Stop must
        // still cancel a worker that has finished but has not published yet.
        let _registration = registration;
        let worker_cancel = cancel.clone();
        let scan = cx
            .background_spawn(async move { import::scan_import_paths(options, worker_cancel) })
            .await;
        cx.update(|cx| {
            queue.update(cx, |queue, cx| {
                apply_scan(queue, scan, cancel.is_cancelled());
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

/// Final commit checks both the scanner result and a later Stop request.
fn apply_scan(queue: &mut QueueModel, scan: ImportScanResult, cancel_requested: bool) {
    let cancelled = scan.cancelled || cancel_requested;
    let added = if cancelled {
        0
    } else {
        queue.add_files(scan.files)
    };
    queue.set_feedback(ImportFeedback::Scan {
        added,
        skipped: scan.skipped,
        errors: scan.errors.len(),
        truncated: scan.truncated,
        cancelled,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_discards_partial_results_and_a_finished_uncommitted_scan() {
        let state = import::ImportScanState::default();
        let registration = state.begin().unwrap();
        let token = registration.token();
        let file = || import::ImportScanFile {
            key: "new".into(),
            path: "/fixture/new.png".into(),
            relative_dir: None,
            metadata: None,
        };
        let scan = |cancelled| ImportScanResult {
            files: vec![file()],
            skipped: 0,
            errors: vec![],
            truncated: false,
            cancelled,
            limit_reason: None,
        };
        let mut queue = QueueModel::default();
        // Model the completed worker result, with registration still owned by
        // the foreground future. A Stop here must still reach the token.
        let finished = scan(false);
        assert!(state.cancel_current());
        apply_scan(&mut queue, finished, token.is_cancelled());
        assert!(queue.is_empty());
        assert!(matches!(
            queue.feedback(),
            ImportFeedback::Scan {
                added: 0,
                cancelled: true,
                ..
            }
        ));
        apply_scan(&mut queue, scan(true), false);
        assert!(
            queue.is_empty(),
            "partial discovery cannot commit on cancellation"
        );
        drop(registration);
        assert!(state.begin().is_ok());
        apply_scan(&mut queue, scan(false), false);
        assert_eq!(queue.len(), 1);
    }
}
