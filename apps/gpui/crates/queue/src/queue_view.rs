// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The queue region: toolbar, drop target, virtualized rows and the empty
//! state. Behaviour owner: `QueueModel` (shared) for data, this view for
//! viewport, thumbnail scheduling and import commands. Rows are value-like
//! (`RenderOnce`) and keyed by the import scan's stable item key.

use std::ops::Range;
use std::rc::Rc;
use std::sync::Arc;

use gpui_kit::base::{VirtualListScrollHandle, v_virtual_list};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::progress::Progress;
use gpui_kit::component::spinner::Spinner;
use gpui_kit::component::tooltip::Tooltip;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Icon, IconName, Sizable as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, AppContext as _, AsyncApp, ClickEvent, Context, Entity, EventEmitter, ExternalPaths,
    FontWeight, ImageSource, InteractiveElement as _, IntoElement, ObjectFit, ParentElement as _,
    Pixels, Render, RenderImage, RenderOnce, SharedString, Size, StatefulInteractiveElement as _,
    Styled as _, StyledImage as _, Subscription, TestSupportExt as _, Window, div, img, px, size,
};
use imgconvert_gpui_shared::i18n::{tr, tr_with};
use imgconvert_gpui_shared::queue_model::{ImportFeedback, ThumbnailTicket};
use imgconvert_gpui_shared::theme;
use imgconvert_gpui_shared::{
    AppModels, BatchModel, ItemStatus, QueueItem, QueueModel, ThumbnailState, progress_bridge,
};

use crate::import;
use crate::thumbnails;

/// Row height in rem so the list follows application zoom.
const ROW_HEIGHT_REM: f32 = 3.5;
/// Thumbnails decoding at once; matches the backend's thumbnail concurrency.
const MAX_INFLIGHT_THUMBNAILS: usize = 4;
/// Rows beyond the viewport that get thumbnails ahead of scrolling.
const THUMBNAIL_LOOKAHEAD: usize = 12;

/// A row action handler shared with the row element.
type RowClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

/// Commands a queue row issues that another feature fulfils; the shell
/// subscribes and routes them (feature crates never depend on each other).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueViewEvent {
    /// Open the before/after comparison for the item with this key.
    ComparePreview(SharedString),
}

impl EventEmitter<QueueViewEvent> for QueueView {}

pub struct QueueView {
    queue: Entity<QueueModel>,
    batch: Entity<BatchModel>,
    scroll: VirtualListScrollHandle,
    item_sizes: Rc<Vec<Size<Pixels>>>,
    sizes_key: (u64, Pixels),
    /// Last `(queue revision, visible range)` a thumbnail pass was scheduled for.
    scheduled_for: Option<(u64, Range<usize>)>,
    schedule_pending: bool,
    inflight: usize,
    _subscriptions: Vec<Subscription>,
}

impl QueueView {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let models = AppModels::global(cx).clone();
        let subscriptions = vec![
            cx.observe(models.queue(), |_, _, cx| cx.notify()),
            cx.observe(models.batch(), |_, _, cx| cx.notify()),
        ];
        Self {
            queue: models.queue().clone(),
            batch: models.batch().clone(),
            scroll: VirtualListScrollHandle::new(),
            item_sizes: Rc::new(Vec::new()),
            sizes_key: (u64::MAX, px(0.)),
            scheduled_for: None,
            schedule_pending: false,
            inflight: 0,
            _subscriptions: subscriptions,
        }
    }

    /// Scroll handle of the list, for the perf probe's scroll scenario.
    pub fn scroll_handle(&self) -> VirtualListScrollHandle {
        self.scroll.clone()
    }

    /// Thumbnail work this view still owes: decodes in flight or a scheduled
    /// pass that has not run. The perf probe's quiescence check reads it.
    pub fn has_pending_work(&self) -> bool {
        self.inflight > 0 || self.schedule_pending
    }

    /// Imports dropped or picked paths.
    pub fn import_paths(&mut self, paths: Vec<std::path::PathBuf>, cx: &mut Context<Self>) {
        import::import_paths(paths, cx);
    }

    fn clear_queue(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // Re-check at the command entry: the toolbar state may be one frame old.
        if self.batch.read(cx).is_active() || progress_bridge::is_busy(cx) {
            return;
        }
        let evicted = self.queue.update(cx, |queue, cx| {
            let evicted = queue.clear();
            cx.notify();
            evicted
        });
        release_images(evicted, Some(window), cx);
    }

    /// Keeps the row-size table in step with the queue length and the rem size.
    fn sync_item_sizes(&mut self, window: &Window, cx: &App) {
        let rem = window.rem_size();
        let revision = self.queue.read(cx).revision();
        if self.sizes_key == (revision, rem) {
            return;
        }
        let len = self.queue.read(cx).len();
        self.item_sizes = Rc::new(vec![size(px(0.), rem * ROW_HEIGHT_REM); len]);
        self.sizes_key = (revision, rem);
    }

    /// Called from the virtual list's range callback. Kit calls that callback
    /// for a measurement range and for the visible range; only a new
    /// `(revision, range)` pair schedules one deferred thumbnail pass.
    fn on_visible_range(&mut self, range: Range<usize>, window: &Window, cx: &mut Context<Self>) {
        let key = (self.queue.read(cx).revision(), range);
        if self.scheduled_for.as_ref() == Some(&key) || self.schedule_pending {
            return;
        }
        self.scheduled_for = Some(key);
        self.schedule_pending = true;
        cx.defer_in(window, |this, window, cx| {
            this.schedule_pending = false;
            this.request_thumbnails(window, cx);
        });
    }

    /// Starts bounded thumbnail loads for rows near the viewport. Results are
    /// applied to the application-level model even if this view is gone, so
    /// no item stays `Loading` after a window closes.
    fn request_thumbnails(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let visible = self
            .scheduled_for
            .as_ref()
            .map_or(0..0, |(_, range)| range.clone());
        let (keys, candidates) = {
            let queue = self.queue.read(cx);
            let end = (visible.end + THUMBNAIL_LOOKAHEAD).min(queue.len());
            let start = visible.start.saturating_sub(THUMBNAIL_LOOKAHEAD);
            let mut keys = Vec::new();
            let mut candidates = Vec::new();
            for ix in start..end {
                if let Some(item) = queue.item_at(ix) {
                    keys.push(item.key.clone());
                    if matches!(item.thumbnail, ThumbnailState::NotRequested) {
                        candidates.push((item.key.clone(), item.path.to_string()));
                    }
                }
            }
            (keys, candidates)
        };
        self.queue
            .update(cx, |queue, _| queue.touch_thumbnails(keys.iter()));
        for (key, path) in candidates {
            if self.inflight >= MAX_INFLIGHT_THUMBNAILS {
                break;
            }
            let Some(ticket) = self
                .queue
                .update(cx, |queue, _| queue.mark_thumbnail_loading(&key))
            else {
                continue;
            };
            self.inflight += 1;
            let queue = self.queue.clone();
            cx.spawn_in(window, async move |this, cx| {
                let loaded = cx
                    .background_spawn(async move { thumbnails::load_thumbnail(path) })
                    .await;
                // Model first, through the app context: it outlives the view.
                let app: &mut AsyncApp = cx;
                app.update(|cx| apply_thumbnail_result(&queue, &ticket, loaded, cx));
                // Then the view, if it is still there: bookkeeping and the next pass.
                let _ = this.update_in(cx, |this, window, cx| {
                    this.inflight = this.inflight.saturating_sub(1);
                    this.request_thumbnails(window, cx);
                });
            })
            .detach();
        }
    }

    fn render_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let queue = self.queue.read(cx);
        let count = queue.len();
        let batch_busy = self.batch.read(cx).is_active() || progress_bridge::is_busy(cx);
        h_flex()
            .h_12()
            .px_4()
            .gap_3()
            .border_b_1()
            .border_color(cx.theme().border)
            .child(
                h_flex()
                    .gap_2()
                    .items_baseline()
                    .child(
                        div()
                            .id("queue-title")
                            .test_support()
                            .aria_label(tr("queue.title"))
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(tr("queue.title")),
                    )
                    .when(count > 0, |this| {
                        this.child(
                            div()
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child(tr_with("queue.item_count", &[("count", &count)])),
                        )
                    }),
            )
            .child(div().flex_1())
            .child(
                Button::new("queue-clear")
                    .ghost()
                    .small()
                    .label(tr("queue.clear"))
                    .disabled(count == 0 || batch_busy || queue.is_importing())
                    .on_click(cx.listener(|this, _, window, cx| this.clear_queue(window, cx))),
            )
            .child(
                Button::new("queue-add-files")
                    .small()
                    .icon(IconName::FolderOpen)
                    .label(tr("queue.add_files"))
                    .disabled(queue.is_importing())
                    .on_click(|_, _, cx| import::pick_and_import(cx)),
            )
    }

    fn render_feedback(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let queue = self.queue.read(cx);
        let importing = queue.is_importing();
        let text: SharedString = if importing {
            tr("queue.importing")
        } else {
            match queue.feedback() {
                ImportFeedback::None => return None,
                ImportFeedback::Added { added, skipped: 0 } => {
                    tr_with("queue.import_added", &[("added", added)])
                }
                ImportFeedback::Added { added, skipped } => tr_with(
                    "queue.import_added_skipped",
                    &[("added", added), ("skipped", skipped)],
                ),
                ImportFeedback::Nothing => tr("queue.import_nothing"),
                ImportFeedback::Cancelled => tr("queue.import_cancelled"),
                ImportFeedback::Failed(detail) => {
                    tr_with("queue.import_failed", &[("detail", detail)])
                }
            }
        };
        Some(
            h_flex()
                .id("queue-feedback")
                .test_support()
                .aria_label(text.clone())
                .px_4()
                .py_1()
                .gap_2()
                .text_xs()
                .text_color(cx.theme().muted_foreground)
                .when(importing, |this| this.child(Spinner::new().xsmall()))
                .child(text)
                .when(importing, |this| {
                    this.child(
                        Button::new("queue-cancel-import")
                            .ghost()
                            .xsmall()
                            .label(tr("queue.cancel_import"))
                            .on_click(|_, _, cx| {
                                import::cancel_import(cx);
                            }),
                    )
                }),
        )
    }

    fn render_empty(&self, cx: &mut Context<Self>) -> impl IntoElement {
        v_flex()
            .id("queue-empty")
            .test_support()
            .flex_1()
            .items_center()
            .justify_center()
            .gap_2()
            .p_8()
            .child(
                Icon::new(IconName::Inbox)
                    .size_8()
                    .text_color(cx.theme().muted_foreground),
            )
            .child(
                div()
                    .text_base()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(tr("queue.empty_title")),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .text_center()
                    .child(tr("queue.empty_description")),
            )
            .child(
                div().mt_2().child(
                    Button::new("queue-empty-add")
                        .icon(IconName::FolderOpen)
                        .label(tr("queue.add_files"))
                        .on_click(|_, _, cx| import::pick_and_import(cx)),
                ),
            )
    }

    fn render_rows(&mut self, row_height: Pixels, cx: &mut Context<Self>) -> impl IntoElement {
        let queue = self.queue.clone();
        v_virtual_list(
            cx.entity(),
            "queue-list",
            Rc::clone(&self.item_sizes),
            move |this, range, window, cx| {
                this.on_visible_range(range.clone(), window, cx);
                let busy = queue.read(cx).is_importing()
                    || AppModels::global(cx).batch().read(cx).is_active();
                let items: Vec<QueueItem> = {
                    let queue = queue.read(cx);
                    range.filter_map(|ix| queue.item_at(ix).cloned()).collect()
                };
                items
                    .into_iter()
                    .map(|item| {
                        let key = item.key.clone();
                        let on_compare: RowClickHandler =
                            Rc::new(cx.listener(move |_, _: &ClickEvent, _, cx| {
                                cx.emit(QueueViewEvent::ComparePreview(key.clone()));
                            }));
                        QueueRow {
                            item,
                            row_height,
                            busy,
                            on_compare,
                        }
                    })
                    .collect()
            },
        )
        .track_scroll(&self.scroll)
        .flex_1()
        .min_h_0()
        .px_2()
        // The floating action bar covers the bottom of the card; the last
        // rows must be able to scroll above it.
        .pb(theme::ACTION_BAR_CLEARANCE)
    }
}

impl Render for QueueView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_item_sizes(window, cx);
        let row_height = window.rem_size() * ROW_HEIGHT_REM;
        let is_empty = self.queue.read(cx).is_empty();
        v_flex()
            .id("queue-drop-target")
            .test_support()
            .size_full()
            .min_w_0()
            .on_drop(cx.listener(|this, paths: &ExternalPaths, _, cx| {
                this.import_paths(paths.paths().to_vec(), cx);
            }))
            .drag_over::<ExternalPaths>(|style, _, _, cx| style.bg(cx.theme().drop_target))
            .child(self.render_toolbar(cx))
            .children(self.render_feedback(cx))
            .map(|this| {
                if is_empty {
                    this.child(self.render_empty(cx))
                } else {
                    this.child(self.render_rows(row_height, cx))
                }
            })
    }
}

/// Applies a finished thumbnail request to the model and releases whatever
/// the model hands back (stale, replaced or evicted images).
fn apply_thumbnail_result(
    queue: &Entity<QueueModel>,
    ticket: &ThumbnailTicket,
    loaded: Result<Option<Arc<RenderImage>>, String>,
    cx: &mut App,
) {
    let release = queue.update(cx, |queue, cx| {
        let release = if let Ok(Some(image)) = loaded {
            queue.set_thumbnail(ticket, image)
        } else {
            queue.set_thumbnail_unavailable(ticket);
            Vec::new()
        };
        cx.notify();
        release
    });
    release_images(release, None, cx);
}

/// Frees GPU textures of thumbnails the model no longer holds.
fn release_images(images: Vec<Arc<RenderImage>>, mut window: Option<&mut Window>, cx: &mut App) {
    for image in images {
        cx.drop_image(image, window.as_deref_mut());
    }
}

/// One queue row. Value-like: the view passes a snapshot of the item.
#[derive(IntoElement)]
struct QueueRow {
    item: QueueItem,
    row_height: Pixels,
    busy: bool,
    on_compare: RowClickHandler,
}

impl RenderOnce for QueueRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let muted = cx.theme().muted_foreground;
        let item = self.item;
        let on_compare = self.on_compare;
        let meta = row_meta(&item);
        let compare = Button::new(SharedString::from(format!("compare:{}", item.key)))
            .ghost()
            .xsmall()
            .label(tr("preview.open"))
            .tooltip(tr("preview.title"))
            .disabled(self.busy)
            .on_click(move |event, window, cx| on_compare(event, window, cx));
        let path = item.path.clone();
        h_flex()
            .id(item.key.clone())
            .test_support()
            .aria_label(item.name.clone())
            // Two files of the same name from different folders differ only
            // by the full path, which the meta line abbreviates.
            .tooltip(move |window, cx| Tooltip::new(path.clone()).build(window, cx))
            .h(self.row_height)
            .w_full()
            .px_3()
            .gap_3()
            .rounded(cx.theme().radius_lg)
            .hover(|style| style.bg(cx.theme().list_hover))
            .child(render_thumbnail(&item.thumbnail, cx))
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap_0p5()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .truncate()
                            .child(item.name.clone()),
                    )
                    .child(div().text_xs().text_color(muted).truncate().child(meta)),
            )
            .child(compare)
            .child(render_status(&item.status, cx))
    }
}

/// The row's second line: pixel size and page count when the import probed
/// the file, then the folder it came from. The full path is the row's
/// tooltip.
fn row_meta(item: &QueueItem) -> SharedString {
    let mut parts: Vec<String> = Vec::new();
    if let (Some(width), Some(height)) = (item.source_width, item.source_height) {
        parts.push(format!("{width} × {height}"));
    }
    if let Some(pages) = item.page_count {
        parts.push(tr_with("queue.page_count", &[("count", &pages)]).to_string());
    }
    let folder = std::path::Path::new(item.path.as_ref())
        .parent()
        .and_then(std::path::Path::file_name)
        .map(|name| name.to_string_lossy().into_owned());
    if let Some(folder) = folder {
        parts.push(folder);
    }
    if parts.is_empty() {
        item.path.clone()
    } else {
        SharedString::from(parts.join(" · "))
    }
}

fn render_thumbnail(thumbnail: &ThumbnailState, cx: &App) -> impl IntoElement {
    let slot = div()
        .flex_none()
        .size_10()
        .rounded(cx.theme().radius)
        .bg(cx.theme().muted)
        .overflow_hidden()
        .flex()
        .items_center()
        .justify_center();
    match thumbnail {
        ThumbnailState::Ready(image) => slot.child(
            img(ImageSource::Render(Arc::clone(image)))
                .size_full()
                .object_fit(ObjectFit::Contain),
        ),
        ThumbnailState::Loading => slot.child(Spinner::new().xsmall()),
        ThumbnailState::NotRequested | ThumbnailState::Unavailable => slot.child(
            Icon::new(IconName::File)
                .small()
                .text_color(cx.theme().muted_foreground),
        ),
    }
}

fn render_status(status: &ItemStatus, cx: &App) -> impl IntoElement {
    let lane = h_flex().flex_none().w_40().justify_end().gap_2().text_xs();
    match status {
        ItemStatus::Pending => lane
            .text_color(cx.theme().muted_foreground)
            .child(tr("status.pending")),
        ItemStatus::Running { percent } => lane
            .child(
                div()
                    .w_24()
                    .child(Progress::new("row-progress").value(*percent)),
            )
            .child(
                div()
                    .text_color(cx.theme().muted_foreground)
                    .child(format!("{percent:.0}%")),
            ),
        ItemStatus::Done { in_size, out_size } => lane
            .text_color(cx.theme().muted_foreground)
            .child(
                Icon::new(IconName::CircleCheck)
                    .small()
                    .text_color(cx.theme().success),
            )
            .child(tr_with(
                "status.saved",
                &[
                    ("before", &format_bytes(*in_size)),
                    ("after", &format_bytes(*out_size)),
                ],
            )),
        ItemStatus::Skipped { .. } => lane
            .text_color(cx.theme().muted_foreground)
            .child(tr("status.skipped")),
        ItemStatus::Error { detail } => lane
            .text_color(cx.theme().danger)
            .child(Icon::new(IconName::CircleX).small())
            .child(div().truncate().child(detail.clone()))
            .child(tr("status.error")),
    }
}

pub use imgconvert_gpui_shared::images::format_bytes;

#[cfg(test)]
mod tests {
    use super::format_bytes;

    #[test]
    fn sizes_are_formatted_with_binary_units() {
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(1536), "1.5 KB");
        assert_eq!(format_bytes(3 * 1024 * 1024), "3.0 MB");
    }
}
