// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Retained queue state. Owned by one `Entity<QueueModel>` created by the
//! shell and observed by the queue and workflow views. Pure logic lives here
//! so it is unit-tested without a window.

use std::collections::HashMap;
use std::sync::Arc;

use gpui_kit::{RenderImage, SharedString};
use imgconvert_backend::command_error::CommandError;
use imgconvert_backend::convert::BatchProgressEvent;
use imgconvert_backend::import::ImportScanFile;

/// Budget for decoded-thumbnail bytes (width × height × 4) held by the model.
/// Entries past the budget are evicted least-recently-shown first (plan
/// §3.3); evicted images are returned so the view can drop their textures.
pub const DEFAULT_THUMBNAIL_BYTE_BUDGET: usize = 128 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub enum ItemStatus {
    Pending,
    Running { percent: f32 },
    Done { in_size: u64, out_size: u64 },
    Skipped { detail: SharedString },
    Error { detail: SharedString },
}

#[derive(Debug, Clone)]
pub enum ThumbnailState {
    NotRequested,
    Loading,
    Ready(Arc<RenderImage>),
    /// The backend has no raster preview for this input (or failed once).
    Unavailable,
}

/// Identifies one thumbnail request: the item key and the queue generation
/// it was claimed in. A result for another generation (the queue was cleared
/// or re-imported meanwhile) is rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThumbnailTicket {
    key: SharedString,
    generation: u64,
}

impl ThumbnailTicket {
    pub fn key(&self) -> &SharedString {
        &self.key
    }
}

#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct QueueItem {
    /// Stable domain id from the import scan; also the `ElementId` of the row.
    pub key: SharedString,
    pub path: SharedString,
    pub name: SharedString,
    pub relative_dir: Option<SharedString>,
    /// Import-time metadata when the scan probed the file.
    pub source_format: Option<SharedString>,
    pub source_width: Option<u32>,
    pub source_height: Option<u32>,
    /// Page count of a document input (PDF); raster images keep `None`.
    pub page_count: Option<usize>,
    pub status: ItemStatus,
    pub thumbnail: ThumbnailState,
}

impl QueueItem {
    /// A document input: PDF by probed format or by extension.
    pub fn is_pdf(&self) -> bool {
        self.source_format.as_deref() == Some("pdf")
            || std::path::Path::new(self.path.as_ref())
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
    }

    /// Items a new batch would convert (everything not already done).
    pub fn is_pending_conversion(&self) -> bool {
        !matches!(self.status, ItemStatus::Done { .. })
    }

    fn from_scan(file: ImportScanFile) -> Self {
        let name = std::path::Path::new(&file.path).file_name().map_or_else(
            || file.path.clone(),
            |name| name.to_string_lossy().into_owned(),
        );
        Self {
            key: SharedString::from(file.key),
            path: SharedString::from(file.path),
            name: SharedString::from(name),
            relative_dir: file.relative_dir.map(SharedString::from),
            source_format: file
                .metadata
                .as_ref()
                .map(|metadata| SharedString::from(metadata.format.clone())),
            source_width: file.metadata.as_ref().map(|metadata| metadata.width),
            source_height: file.metadata.as_ref().map(|metadata| metadata.height),
            page_count: file
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.page_count),
            status: ItemStatus::Pending,
            thumbnail: ThumbnailState::NotRequested,
        }
    }
}

/// Feedback line under the toolbar after an import.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportFeedback {
    None,
    Added { added: usize, skipped: usize },
    Nothing,
    Cancelled,
    Failed(SharedString),
}

pub struct QueueModel {
    items: Vec<QueueItem>,
    index_by_key: HashMap<SharedString, usize>,
    importing: bool,
    feedback: ImportFeedback,
    thumbnail_bytes: usize,
    thumbnail_budget: usize,
    /// Last-shown tick per key with a ready thumbnail; the smallest tick is
    /// evicted first. Touching is O(1); eviction scans ready entries only.
    thumbnail_last_shown: HashMap<SharedString, u64>,
    tick: u64,
    /// Bumped on every structural change (import, clear) so views rebuild
    /// row sizes and stale thumbnail results are rejected.
    revision: u64,
}

impl Default for QueueModel {
    fn default() -> Self {
        Self::with_thumbnail_budget(DEFAULT_THUMBNAIL_BYTE_BUDGET)
    }
}

impl QueueModel {
    pub fn with_thumbnail_budget(thumbnail_budget: usize) -> Self {
        Self {
            items: Vec::new(),
            index_by_key: HashMap::new(),
            importing: false,
            feedback: ImportFeedback::None,
            thumbnail_bytes: 0,
            thumbnail_budget,
            thumbnail_last_shown: HashMap::new(),
            tick: 0,
            revision: 0,
        }
    }

    pub fn items(&self) -> &[QueueItem] {
        &self.items
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn is_importing(&self) -> bool {
        self.importing
    }

    pub fn feedback(&self) -> &ImportFeedback {
        &self.feedback
    }

    pub fn item(&self, key: &SharedString) -> Option<&QueueItem> {
        self.index_by_key.get(key).map(|ix| &self.items[*ix])
    }

    pub fn item_at(&self, ix: usize) -> Option<&QueueItem> {
        self.items.get(ix)
    }

    /// Keys in queue order; the batch uses this as its job order.
    pub fn keys(&self) -> Vec<SharedString> {
        self.items.iter().map(|item| item.key.clone()).collect()
    }

    pub fn pending_thumbnail_count(&self) -> usize {
        self.items
            .iter()
            .filter(|item| matches!(item.thumbnail, ThumbnailState::Loading))
            .count()
    }

    pub fn set_importing(&mut self, importing: bool) {
        self.importing = importing;
        if importing {
            self.feedback = ImportFeedback::None;
        }
    }

    pub fn set_feedback(&mut self, feedback: ImportFeedback) {
        self.feedback = feedback;
    }

    /// Appends scanned files, ignoring keys already queued. Returns how many
    /// were new.
    pub fn add_files(&mut self, files: Vec<ImportScanFile>) -> usize {
        let mut added = 0;
        for file in files {
            let key = SharedString::from(file.key.clone());
            if self.index_by_key.contains_key(&key) {
                continue;
            }
            self.index_by_key.insert(key, self.items.len());
            self.items.push(QueueItem::from_scan(file));
            added += 1;
        }
        if added > 0 {
            self.revision += 1;
        }
        added
    }

    /// Empties the queue and returns every decoded thumbnail for release.
    /// Outstanding thumbnail requests become stale through the revision bump.
    pub fn clear(&mut self) -> Vec<Arc<RenderImage>> {
        let released = self
            .items
            .drain(..)
            .filter_map(|item| match item.thumbnail {
                ThumbnailState::Ready(image) => Some(image),
                _ => None,
            })
            .collect();
        self.index_by_key.clear();
        self.thumbnail_last_shown.clear();
        self.thumbnail_bytes = 0;
        self.feedback = ImportFeedback::None;
        self.revision += 1;
        released
    }

    /// Resets every item to pending before a batch starts.
    pub fn reset_statuses(&mut self) {
        for item in &mut self.items {
            item.status = ItemStatus::Pending;
        }
    }

    /// Claims a thumbnail request for `key`; `None` when one is already
    /// loading, ready or known to be unavailable.
    pub fn mark_thumbnail_loading(&mut self, key: &SharedString) -> Option<ThumbnailTicket> {
        let generation = self.revision;
        let item = self.item_mut(key)?;
        if matches!(item.thumbnail, ThumbnailState::NotRequested) {
            item.thumbnail = ThumbnailState::Loading;
            Some(ThumbnailTicket {
                key: key.clone(),
                generation,
            })
        } else {
            None
        }
    }

    /// Stores a decoded thumbnail for a ticket and returns every image the
    /// caller must release: the new one when the ticket is stale, a replaced
    /// image, and images evicted to stay within the byte budget.
    pub fn set_thumbnail(
        &mut self,
        ticket: &ThumbnailTicket,
        image: Arc<RenderImage>,
    ) -> Vec<Arc<RenderImage>> {
        if ticket.generation != self.revision {
            return vec![image];
        }
        let bytes = image_bytes(&image);
        let Some(item) = self.item_mut(&ticket.key) else {
            return vec![image];
        };
        let mut release = Vec::new();
        if let ThumbnailState::Ready(previous) =
            std::mem::replace(&mut item.thumbnail, ThumbnailState::Ready(image))
        {
            self.thumbnail_bytes = self.thumbnail_bytes.saturating_sub(image_bytes(&previous));
            release.push(previous);
        }
        self.thumbnail_bytes += bytes;
        self.tick += 1;
        self.thumbnail_last_shown
            .insert(ticket.key.clone(), self.tick);
        release.extend(self.evict_thumbnails_over_budget(&ticket.key));
        release
    }

    /// Records that a request ended without an image. Stale tickets are
    /// ignored so a re-imported item is not marked unavailable by an old scan.
    pub fn set_thumbnail_unavailable(&mut self, ticket: &ThumbnailTicket) {
        if ticket.generation != self.revision {
            return;
        }
        if let Some(item) = self.item_mut(&ticket.key)
            && matches!(item.thumbnail, ThumbnailState::Loading)
        {
            item.thumbnail = ThumbnailState::Unavailable;
        }
    }

    /// Marks keys as recently shown so eviction prefers rows far from the viewport.
    pub fn touch_thumbnails<'a>(&mut self, keys: impl IntoIterator<Item = &'a SharedString>) {
        for key in keys {
            if let Some(last) = self.thumbnail_last_shown.get_mut(key) {
                self.tick += 1;
                *last = self.tick;
            }
        }
    }

    pub fn thumbnail_bytes(&self) -> usize {
        self.thumbnail_bytes
    }

    /// Evicts least-recently-shown thumbnails until the budget holds; the
    /// image just stored (`keep`) is never evicted.
    fn evict_thumbnails_over_budget(&mut self, keep: &SharedString) -> Vec<Arc<RenderImage>> {
        let mut evicted = Vec::new();
        while self.thumbnail_bytes > self.thumbnail_budget {
            let Some(victim) = self
                .thumbnail_last_shown
                .iter()
                .filter(|(key, _)| *key != keep)
                .min_by_key(|(_, tick)| **tick)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            self.thumbnail_last_shown.remove(&victim);
            if let Some(item) = self.item_mut(&victim)
                && let ThumbnailState::Ready(image) =
                    std::mem::replace(&mut item.thumbnail, ThumbnailState::NotRequested)
            {
                self.thumbnail_bytes = self.thumbnail_bytes.saturating_sub(image_bytes(&image));
                evicted.push(image);
            }
        }
        evicted
    }

    /// Applies a batch event to the items of `jobs` (job index → queue key).
    /// Returns whether anything visible changed.
    pub fn apply_batch_event(&mut self, event: &BatchProgressEvent, jobs: &[SharedString]) -> bool {
        let job_key = |index: usize| jobs.get(index).cloned();
        match event {
            BatchProgressEvent::Started { .. } => false,
            BatchProgressEvent::FileStarted { index, .. } => {
                self.set_status(job_key(*index), ItemStatus::Running { percent: 0.0 })
            }
            BatchProgressEvent::FileProgress { index, percent, .. } => self.set_status(
                job_key(*index),
                ItemStatus::Running {
                    percent: *percent as f32,
                },
            ),
            BatchProgressEvent::FileFinished { index, result } => self.set_status(
                job_key(*index),
                ItemStatus::Done {
                    in_size: result.in_size,
                    out_size: result.out_size,
                },
            ),
            BatchProgressEvent::FileSkipped { index, error, .. } => self.set_status(
                job_key(*index),
                ItemStatus::Skipped {
                    detail: command_error_text(error),
                },
            ),
            BatchProgressEvent::FileError { index, error, .. } => self.set_status(
                job_key(*index),
                ItemStatus::Error {
                    detail: command_error_text(error),
                },
            ),
            BatchProgressEvent::Cancelled { .. } | BatchProgressEvent::Finished { .. } => {
                let mut changed = false;
                for key in jobs {
                    if let Some(item) = self.item_mut(key)
                        && matches!(item.status, ItemStatus::Running { .. })
                    {
                        item.status = ItemStatus::Pending;
                        changed = true;
                    }
                }
                changed
            }
        }
    }

    /// Everything still pending or running after a batch ended abnormally.
    pub fn fail_unfinished(&mut self, jobs: &[SharedString], detail: &SharedString) {
        for key in jobs {
            if let Some(item) = self.item_mut(key)
                && matches!(
                    item.status,
                    ItemStatus::Pending | ItemStatus::Running { .. }
                )
            {
                item.status = ItemStatus::Error {
                    detail: detail.clone(),
                };
            }
        }
    }

    fn set_status(&mut self, key: Option<SharedString>, status: ItemStatus) -> bool {
        let Some(item) = key.and_then(|key| self.item_mut(&key)) else {
            return false;
        };
        if item.status == status {
            return false;
        }
        item.status = status;
        true
    }

    fn item_mut(&mut self, key: &SharedString) -> Option<&mut QueueItem> {
        let ix = *self.index_by_key.get(key)?;
        self.items.get_mut(ix)
    }
}

/// Short, locale-neutral text for a backend command error: its detail when
/// present, otherwise the error code. Localized rendering is stage 3 work.
fn command_error_text(error: &CommandError) -> SharedString {
    SharedString::from(
        error
            .detail
            .clone()
            .unwrap_or_else(|| format!("{:?}", error.code)),
    )
}

/// Decoded size of the first frame: width × height × 4 bytes (BGRA).
fn image_bytes(image: &RenderImage) -> usize {
    let size = image.size(0);
    let width: i32 = size.width.into();
    let height: i32 = size.height.into();
    (width.max(0) as usize) * (height.max(0) as usize) * 4
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Frame, ImageBuffer, Rgba};
    use imgconvert_backend::convert::ConvertResult;

    fn scan_file(key: &str) -> ImportScanFile {
        ImportScanFile {
            path: format!("/photos/{key}.png"),
            key: key.to_string(),
            relative_dir: None,
            metadata: None,
        }
    }

    /// A render image of `pixels` pixels (4 bytes each), 1 px tall.
    fn image(pixels: u32) -> Arc<RenderImage> {
        Arc::new(RenderImage::new(vec![Frame::new(ImageBuffer::from_pixel(
            pixels,
            1,
            Rgba([0, 0, 0, 0]),
        ))]))
    }

    fn claim(model: &mut QueueModel, key: &str) -> ThumbnailTicket {
        model
            .mark_thumbnail_loading(&SharedString::from(key.to_string()))
            .expect("claim")
    }

    #[test]
    fn add_files_dedupes_by_key_and_bumps_revision() {
        let mut model = QueueModel::default();
        assert_eq!(model.add_files(vec![scan_file("a"), scan_file("b")]), 2);
        let revision = model.revision();
        assert_eq!(model.add_files(vec![scan_file("b"), scan_file("c")]), 1);
        assert_eq!(model.len(), 3);
        assert_eq!(model.revision(), revision + 1);
        assert_eq!(model.add_files(vec![scan_file("a")]), 0);
        assert_eq!(model.revision(), revision + 1);
        assert_eq!(model.item_at(0).unwrap().name.as_ref(), "a.png");
    }

    #[test]
    fn batch_events_update_the_right_items_by_job_index() {
        let mut model = QueueModel::default();
        model.add_files(vec![scan_file("a"), scan_file("b")]);
        let jobs = vec![SharedString::from("b"), SharedString::from("a")];
        assert!(model.apply_batch_event(
            &BatchProgressEvent::FileStarted {
                index: 0,
                input: "x".into()
            },
            &jobs
        ));
        assert!(matches!(
            model.item(&"b".into()).unwrap().status,
            ItemStatus::Running { .. }
        ));
        assert!(model.apply_batch_event(
            &BatchProgressEvent::FileFinished {
                index: 0,
                result: ConvertResult {
                    input: "x".into(),
                    output: "y".into(),
                    in_size: 10,
                    environment_comparable: true,
                    out_size: 4,
                    warning: None,
                    warnings: Vec::new(),
                    output_count: 1,
                    skipped_output_count: 0,
                },
            },
            &jobs
        ));
        assert_eq!(
            model.item(&"b".into()).unwrap().status,
            ItemStatus::Done {
                in_size: 10,
                out_size: 4
            }
        );
        assert!(model.apply_batch_event(
            &BatchProgressEvent::FileError {
                index: 1,
                input: "a".into(),
                error: CommandError::batch_failed("boom"),
            },
            &jobs
        ));
        assert!(matches!(
            model.item(&"a".into()).unwrap().status,
            ItemStatus::Error { .. }
        ));
        // Unknown indexes are ignored instead of panicking.
        assert!(!model.apply_batch_event(
            &BatchProgressEvent::FileStarted {
                index: 9,
                input: "x".into()
            },
            &jobs
        ));
    }

    #[test]
    fn cancelled_batch_returns_running_items_to_pending() {
        let mut model = QueueModel::default();
        model.add_files(vec![scan_file("a")]);
        let jobs = vec![SharedString::from("a")];
        model.apply_batch_event(
            &BatchProgressEvent::FileStarted {
                index: 0,
                input: "a".into(),
            },
            &jobs,
        );
        assert!(model.apply_batch_event(
            &BatchProgressEvent::Cancelled {
                completed: 0,
                total: 1
            },
            &jobs
        ));
        assert_eq!(model.item(&"a".into()).unwrap().status, ItemStatus::Pending);
    }

    #[test]
    fn thumbnail_budget_evicts_least_recently_shown_first() {
        // Budget of 250 bytes; every image below is 25 px = 100 bytes.
        let mut model = QueueModel::with_thumbnail_budget(250);
        model.add_files(vec![scan_file("a"), scan_file("b"), scan_file("c")]);
        let (a, b, c) = (
            claim(&mut model, "a"),
            claim(&mut model, "b"),
            claim(&mut model, "c"),
        );
        assert!(model.set_thumbnail(&a, image(25)).is_empty());
        assert!(model.set_thumbnail(&b, image(25)).is_empty());
        // "a" was shown again, so "b" is the eviction candidate.
        model.touch_thumbnails([a.key()]);
        let evicted = model.set_thumbnail(&c, image(25));
        assert_eq!(evicted.len(), 1);
        assert!(matches!(
            model.item(b.key()).unwrap().thumbnail,
            ThumbnailState::NotRequested
        ));
        assert!(matches!(
            model.item(a.key()).unwrap().thumbnail,
            ThumbnailState::Ready(_)
        ));
        assert!(matches!(
            model.item(c.key()).unwrap().thumbnail,
            ThumbnailState::Ready(_)
        ));
        assert_eq!(model.thumbnail_bytes(), 200);
        // A re-claimed "b" that alone exceeds the budget is kept; the others go.
        let b = claim(&mut model, "b");
        let evicted = model.set_thumbnail(&b, image(100));
        assert_eq!(evicted.len(), 2);
        assert!(matches!(
            model.item(b.key()).unwrap().thumbnail,
            ThumbnailState::Ready(_)
        ));
        // Clearing hands back whatever is still decoded.
        assert_eq!(model.clear().len(), 1);
        assert_eq!(model.thumbnail_bytes(), 0);
    }

    #[test]
    fn stale_tickets_are_rejected_and_replacements_release_the_old_image() {
        let mut model = QueueModel::with_thumbnail_budget(10_000);
        model.add_files(vec![scan_file("a")]);
        let old = claim(&mut model, "a");
        // Clear + re-import of the same key: the old request is from another generation.
        model.clear();
        model.add_files(vec![scan_file("a")]);
        let rejected = model.set_thumbnail(&old, image(10));
        assert_eq!(
            rejected.len(),
            1,
            "stale result must be handed back for release"
        );
        assert!(matches!(
            model.item(old.key()).unwrap().thumbnail,
            ThumbnailState::NotRequested
        ));
        model.set_thumbnail_unavailable(&old);
        assert!(matches!(
            model.item(old.key()).unwrap().thumbnail,
            ThumbnailState::NotRequested
        ));

        let fresh = claim(&mut model, "a");
        assert!(model.set_thumbnail(&fresh, image(10)).is_empty());
        assert_eq!(model.thumbnail_bytes(), 40);
        // A second result for the same live ticket replaces and releases the first.
        let replaced = model.set_thumbnail(&fresh, image(20));
        assert_eq!(replaced.len(), 1);
        assert_eq!(model.thumbnail_bytes(), 80);
    }

    #[test]
    fn loading_is_claimed_once() {
        let mut model = QueueModel::default();
        model.add_files(vec![scan_file("a")]);
        let a = SharedString::from("a");
        let ticket = model.mark_thumbnail_loading(&a).unwrap();
        assert!(model.mark_thumbnail_loading(&a).is_none());
        assert_eq!(model.pending_thumbnail_count(), 1);
        model.set_thumbnail_unavailable(&ticket);
        assert_eq!(model.pending_thumbnail_count(), 0);
        assert!(model.mark_thumbnail_loading(&a).is_none());
    }
}
