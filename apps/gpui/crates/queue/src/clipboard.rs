// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Queue paste owner: native files, then bitmaps, then absolute text paths.
//! Only newly created bitmap files carry cleanup ownership; scanning a path
//! never grants permission to remove an existing source on cancellation.

use std::collections::BTreeSet;
use std::path::Path;

use gpui_kit::{
    App, AppContext as _, AsyncApp, ClipboardEntry, ClipboardItem, ExternalPaths, Image,
    ImageFormat, Task,
};
use imgconvert_backend::clipboard::{self as native, ClipboardContent, ClipboardError};
use imgconvert_backend::import::{self, ClipboardImageImportOptions, ScanImportOptions};
use imgconvert_gpui_shared::i18n::{tr, tr_with};
use imgconvert_gpui_shared::queue_model::ImportFeedback;
use imgconvert_gpui_shared::{AppModels, Services};

#[derive(Debug)]
enum Payload {
    Paths { paths: Vec<String>, invalid: usize },
    Images(Vec<Image>),
    Empty,
}

fn payload(item: ClipboardItem) -> Payload {
    let mut native_paths = BTreeSet::new();
    let mut invalid = 0;
    let mut has_native_paths = false;
    for entry in &item.entries {
        if let ClipboardEntry::ExternalPaths(paths) = entry {
            has_native_paths |= !paths.paths().is_empty();
            for path in paths.paths() {
                if let Some(path) = path.to_str().filter(|_| path.is_absolute()) {
                    native_paths.insert(path.to_owned());
                } else {
                    invalid += 1;
                }
            }
        }
    }
    if has_native_paths {
        return Payload::Paths {
            paths: native_paths.into_iter().collect(),
            invalid,
        };
    }
    let mut images = Vec::new();
    let mut text_paths = BTreeSet::new();
    for entry in item.entries {
        match entry {
            ClipboardEntry::Image(image) => images.push(image),
            ClipboardEntry::String(text) => {
                for line in text.text.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with('#') {
                        continue;
                    }
                    if trimmed
                        .get(..5)
                        .is_some_and(|s| s.eq_ignore_ascii_case("file:"))
                    {
                        text_paths.insert(trimmed.to_owned());
                    } else if Path::new(line).is_absolute() {
                        text_paths.insert(line.to_owned());
                    }
                }
            }
            ClipboardEntry::ExternalPaths(_) => {}
        }
    }
    if !images.is_empty() {
        Payload::Images(images)
    } else if !text_paths.is_empty() {
        Payload::Paths {
            paths: text_paths.into_iter().collect(),
            invalid: 0,
        }
    } else {
        Payload::Empty
    }
}

/// GPUI's deterministic test platform supplies fixture clipboard entries.
/// Production reads use an independent native connection entirely on a worker:
/// the locked GPUI desktop read is synchronous and may discard image formats.
fn read(cx: &App) -> Task<Result<Option<ClipboardItem>, ClipboardError>> {
    if cx.is_test() {
        let read = cx.read_from_clipboard_async();
        return cx
            .background_executor()
            .spawn(async move { read.await.map_err(|_| ClipboardError::Unavailable) });
    }
    cx.background_executor().spawn(async move {
        native::read().map(|content| match content {
            ClipboardContent::Files(paths) => Some(ClipboardItem {
                entries: vec![ClipboardEntry::ExternalPaths(ExternalPaths(paths.into()))],
            }),
            ClipboardContent::Png(bytes) => Some(ClipboardItem::new_image(&Image::from_bytes(
                ImageFormat::Png,
                bytes,
            ))),
            ClipboardContent::Text(text) => Some(ClipboardItem::new_string(text)),
            ClipboardContent::Empty => None,
        })
    })
}

/// Reads only after an explicit command. One registration spans reading,
/// background processing and the foreground commit, so Stop remains effective
/// even after the worker has finished but before its result enters the queue.
pub fn paste(cx: &mut App) {
    let queue = AppModels::global(cx).queue().clone();
    if queue.read(cx).is_importing() {
        return;
    }
    let Ok(registration) = Services::global(cx).import_scan().begin() else {
        return;
    };
    let state = Services::global(cx).clipboard().clone();
    let cancel = registration.token();
    queue.update(cx, |queue, cx| {
        queue.set_importing(true);
        cx.notify();
    });
    let read = read(cx);
    cx.spawn(async move |cx: &mut AsyncApp| {
        let _registration = registration;
        let item = read.await;
        let worker_cancel = cancel.clone();
        let result = cx
            .background_spawn(async move {
                let cancel = worker_cancel;
                let mut files = Vec::new();
                let mut created = Vec::new();
                let mut issues = Vec::new();
                match item {
                    Ok(Some(item)) => match payload(item) {
                        Payload::Paths { paths, invalid } => {
                            if invalid > 0 {
                                issues.push(tr_with(
                                    "queue.clipboard_invalid_paths",
                                    &[("count", &invalid)],
                                ));
                            }
                            let scan = import::scan_import_paths(
                                ScanImportOptions {
                                    paths,
                                    recursive: true,
                                    max_files: None,
                                    max_entries: None,
                                    max_depth: None,
                                },
                                cancel.clone(),
                            );
                            if scan.skipped > 0 || !scan.errors.is_empty() {
                                issues.push(tr_with(
                                    "queue.clipboard_path_issues",
                                    &[("skipped", &scan.skipped), ("errors", &scan.errors.len())],
                                ));
                            }
                            if scan.truncated {
                                issues.push(tr("queue.clipboard_truncated"));
                            }
                            files = scan.files;
                        }
                        Payload::Images(images) => {
                            let mut failed = 0;
                            for image in images {
                                if cancel.is_cancelled() {
                                    break;
                                }
                                match import::import_clipboard_image(ClipboardImageImportOptions {
                                    bytes: image.bytes,
                                    mime_type: Some(image.format.mime_type().to_owned()),
                                    suggested_name: None,
                                }) {
                                    Ok(imported) => {
                                        if let Err(error) = state
                                            .register(imported.managed_path, imported.session_lock)
                                        {
                                            eprintln!(
                                                "imgconvert: clipboard registration failed: {error}"
                                            );
                                            let _ = std::fs::remove_file(&imported.file.path);
                                            failed += 1;
                                        } else {
                                            created.push(imported.file.path.clone());
                                            files.push(imported.file);
                                        }
                                    }
                                    Err(error) => {
                                        eprintln!(
                                            "imgconvert: clipboard image import failed: {error}"
                                        );
                                        failed += 1;
                                    }
                                }
                            }
                            if failed > 0 {
                                issues.push(tr_with(
                                    "queue.clipboard_image_issues",
                                    &[("count", &failed)],
                                ));
                            }
                        }
                        Payload::Empty => issues.push(tr("queue.clipboard_empty")),
                    },
                    Ok(None) => issues.push(tr("queue.clipboard_empty")),
                    Err(ClipboardError::Unavailable) => {
                        issues.push(tr("queue.clipboard_unavailable"));
                    }
                    Err(ClipboardError::InvalidImage) => {
                        issues.push(tr("queue.clipboard_image_failed"));
                    }
                }
                (files, created, issues)
            })
            .await;
        cx.update(|cx| {
            let (files, created, issues) = result;
            let cancelled = cancel.is_cancelled();
            if cancelled {
                cleanup(created, cx);
            }
            queue.update(cx, |queue, cx| {
                let added = if cancelled { 0 } else { queue.add_files(files) };
                let detail = issues
                    .iter()
                    .map(AsRef::as_ref)
                    .collect::<Vec<&str>>()
                    .join(" ");
                queue.set_feedback(if cancelled {
                    ImportFeedback::Cancelled
                } else if added > 0 && !issues.is_empty() {
                    ImportFeedback::Partial {
                        added,
                        detail: detail.into(),
                    }
                } else if added > 0 {
                    ImportFeedback::Added { added, skipped: 0 }
                } else if !issues.is_empty() {
                    ImportFeedback::Failed(detail.into())
                } else {
                    ImportFeedback::Nothing
                });
                queue.set_importing(false);
                cx.notify();
            });
        });
    })
    .detach();
}

/// Queue clear deletes only files in this process's backend registry. A path
/// scanner's result has no cleanup ownership, even when already registered.
pub(crate) fn cleanup(paths: Vec<String>, cx: &App) {
    let state = Services::global(cx).clipboard().clone();
    cx.background_executor()
        .spawn(async move {
            for path in paths {
                if let Err(error) = import::cleanup_imported_temp_file(path, &state) {
                    eprintln!("imgconvert: clipboard cleanup failed: {error}");
                }
            }
        })
        .detach();
}
#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::{ClipboardString, ExternalPaths, ImageFormat};

    #[test]
    fn native_files_win_over_bitmap_previews_and_text() {
        let path = std::env::temp_dir().join("clipboard photo.png");
        let item = ClipboardItem {
            entries: vec![
                ClipboardEntry::String(ClipboardString::new("/other.png".into())),
                ClipboardEntry::Image(Image::empty()),
                ClipboardEntry::ExternalPaths(ExternalPaths(
                    vec![path.clone(), path.clone()].into(),
                )),
            ],
        };
        let Payload::Paths { paths, .. } = payload(item) else {
            panic!("files must win");
        };
        assert_eq!(paths, vec![path.to_str().unwrap().to_string()]);
    }

    #[test]
    fn bitmaps_win_over_text_paths_and_keep_all_images() {
        let item = ClipboardItem {
            entries: vec![
                ClipboardEntry::String(ClipboardString::new("file:///tmp/other.png".into())),
                ClipboardEntry::Image(Image::empty()),
                ClipboardEntry::Image(Image::from_bytes(ImageFormat::Jpeg, vec![1])),
            ],
        };
        let Payload::Images(images) = payload(item) else {
            panic!("images must win");
        };
        assert_eq!(images.len(), 2);
        assert_eq!(images[1].format, ImageFormat::Jpeg);
    }

    #[test]
    fn text_accepts_only_absolute_paths_and_file_urls_with_gnome_headers_ignored() {
        let path = std::env::temp_dir().join("clipboard photo.png");
        let text = format!(
            "copy\r\n# comment\r\n{}\r\n{}\nfile:///tmp/a%20b.png\nhttps://example.com/a.png\n./relative.png\njust words",
            path.display(),
            path.display()
        );
        let Payload::Paths { paths, .. } = payload(ClipboardItem::new_string(text)) else {
            panic!("paths");
        };
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&path.to_str().unwrap().to_string()));
        assert!(paths.contains(&"file:///tmp/a%20b.png".to_string()));
        assert!(matches!(
            payload(ClipboardItem::new_string(
                "words\nrelative.png\nhttps://example.com/a".into()
            )),
            Payload::Empty
        ));
    }
}

#[cfg(test)]
mod path_regressions {
    use super::*;

    #[test]
    fn text_paths_preserve_legal_trailing_whitespace() {
        let path = format!("{} ", std::env::temp_dir().join("photo.png").display());
        let Payload::Paths { paths, invalid } =
            payload(ClipboardItem::new_string(format!("{path}\r\n")))
        else {
            panic!("path");
        };
        assert_eq!(paths, vec![path]);
        assert_eq!(invalid, 0);
    }

    #[cfg(unix)]
    #[test]
    fn unrepresentable_native_paths_report_failure_instead_of_pasting_a_preview() {
        use std::os::unix::ffi::OsStringExt as _;
        let path = std::path::PathBuf::from(std::ffi::OsString::from_vec(
            b"/tmp/invalid-\xff.png".to_vec(),
        ));
        let item = ClipboardItem {
            entries: vec![
                ClipboardEntry::ExternalPaths(ExternalPaths(vec![path].into())),
                ClipboardEntry::Image(Image::empty()),
            ],
        };
        assert!(matches!(payload(item), Payload::Paths { paths, invalid: 1 } if paths.is_empty()));
    }
}
