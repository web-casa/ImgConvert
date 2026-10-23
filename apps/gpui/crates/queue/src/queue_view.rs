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
use gpui_kit::component::button::{Button, ButtonRounded, ButtonVariants as _};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};
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
    Pixels, Render, RenderImage, RenderOnce, Role, SharedString, Size,
    StatefulInteractiveElement as _, Styled as _, StyledImage as _, Subscription,
    TestSupportExt as _, Window, div, img, px, size,
};
use imgconvert_gpui_shared::command_error::format_command_error;
use imgconvert_gpui_shared::i18n::{tr, tr_count, tr_with};
use imgconvert_gpui_shared::queue_model::{ImportFeedback, ThumbnailTicket};
use imgconvert_gpui_shared::theme::ActiveGlass as _;
use imgconvert_gpui_shared::{
    AppModels, BatchModel, ItemStatus, QueueItem, QueueModel, Services, ThumbnailState,
    progress_bridge, tasks,
};

use crate::import;
use crate::thumbnails;

/// Row height in rem so the list follows application zoom.
const ROW_HEIGHT_REM: f32 = 4.25;
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
    /// Open the storage and environmental scenario for a finished item.
    EnvironmentalImpact(SharedString),
}

impl EventEmitter<QueueViewEvent> for QueueView {}

pub struct QueueView {
    queue: Entity<QueueModel>,
    batch: Entity<BatchModel>,
    input_formats: Vec<SharedString>,
    formats_revision: u64,
    helper_path: Option<String>,
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
            cx.observe_global::<Services>(|this, cx| {
                if this.formats_revision == 0 && Services::global(cx).is_codec_restore_complete() {
                    this.refresh_input_formats(cx);
                }
            }),
            cx.observe(models.queue(), |_, _, cx| cx.notify()),
            cx.observe(models.batch(), |_, _, cx| cx.notify()),
            cx.observe(models.settings(), |this, settings, cx| {
                let helper_path = settings.read(cx).settings().heic_helper_path.clone();
                if this.helper_path != helper_path {
                    this.helper_path = helper_path;
                    this.refresh_input_formats(cx);
                }
                cx.notify();
            }),
        ];
        let mut view = Self {
            queue: models.queue().clone(),
            batch: models.batch().clone(),
            input_formats: Vec::new(),
            formats_revision: 0,
            helper_path: models
                .settings()
                .read(cx)
                .settings()
                .heic_helper_path
                .clone(),
            scroll: VirtualListScrollHandle::new(),
            item_sizes: Rc::new(Vec::new()),
            sizes_key: (u64::MAX, px(0.)),
            scheduled_for: None,
            schedule_pending: false,
            inflight: 0,
            _subscriptions: subscriptions,
        };
        view.refresh_input_formats(cx);
        view
    }

    fn refresh_input_formats(&mut self, cx: &mut Context<Self>) {
        if !Services::global(cx).is_codec_restore_complete() {
            return;
        }
        self.formats_revision = self.formats_revision.wrapping_add(1);
        let revision = self.formats_revision;
        let task = tasks::run_blocking("imgconvert-input-formats", cx, || {
            imgconvert_backend::convert::capabilities()
                .readable
                .into_iter()
                .map(|format| SharedString::from(format.to_uppercase()))
                .collect()
        });
        cx.spawn(async move |this, cx| {
            let formats = match task.await {
                Ok(formats) => formats,
                Err(detail) => {
                    eprintln!("imgconvert: input formats unavailable: {detail}");
                    return;
                }
            };
            let _ = this.update(cx, |this, cx| {
                if this.formats_revision == revision {
                    this.input_formats = formats;
                    cx.notify();
                }
            });
        })
        .detach();
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
        if self.batch.read(cx).is_active()
            || progress_bridge::is_busy(cx)
            || self.queue.read(cx).is_importing()
        {
            return;
        }
        let evicted = self.queue.update(cx, |queue, cx| {
            let paths = queue
                .items()
                .iter()
                .map(|item| item.path.to_string())
                .collect();
            crate::clipboard::cleanup(paths, cx);
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
        let importing = queue.is_importing();
        let batch_busy = self.batch.read(cx).is_active() || progress_bridge::is_busy(cx);
        let glass = cx.glass();
        let pill = ButtonRounded::Size(cx.theme().radius_full());
        // One band: the title with its count, the quiet queue commands, then
        // the import commands. It wraps rather than clipping when narrow.
        h_flex()
            .flex_wrap()
            .gap_2()
            .items_center()
            .px_5()
            .pt_4()
            .pb_3()
            .child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(
                        div()
                            .id("queue-title")
                            .test_support()
                            .role(Role::Heading)
                            .aria_label(tr("queue.title"))
                            .text_lg()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(tr("queue.title")),
                    )
                    .when(count > 0, |this| {
                        this.child(
                            div()
                                .id("queue-count")
                                .test_support()
                                .role(Role::Label)
                                .aria_value(tr_count("queue.item_count", "count", count, &[]))
                                .px_2()
                                .py_0p5()
                                .rounded(cx.theme().radius_full())
                                .bg(glass.chip())
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child(tr_count("queue.item_count", "count", count, &[])),
                        )
                    }),
            )
            .child(div().flex_1())
            .child(
                Button::new("queue-reset-formats")
                    .ghost()
                    .small()
                    .rounded(pill)
                    .label(tr("queue.reset_formats"))
                    .disabled(count == 0 || batch_busy || importing)
                    .on_click(|_, _, cx| {
                        if format_edit_busy(cx) {
                            return;
                        }
                        AppModels::global(cx)
                            .queue()
                            .clone()
                            .update(cx, |queue, cx| {
                                if queue.reset_target_formats() {
                                    cx.notify();
                                }
                            });
                    }),
            )
            .child(
                Button::new("queue-clear")
                    .ghost()
                    .small()
                    .rounded(pill)
                    .label(tr("queue.clear"))
                    .disabled(count == 0 || batch_busy || importing)
                    .on_click(cx.listener(|this, _, window, cx| this.clear_queue(window, cx))),
            )
            .child(
                Button::new("queue-add-files")
                    .small()
                    .rounded(pill)
                    .icon(IconName::Plus)
                    .label(tr("queue.add_files"))
                    .disabled(importing)
                    .on_click(|_, _, cx| import::pick_and_import(cx)),
            )
            .child(
                Button::new("queue-add-folders")
                    .small()
                    .rounded(pill)
                    .icon(IconName::FolderOpen)
                    .label(tr("queue.add_folders"))
                    .disabled(importing)
                    .on_click(|_, _, cx| import::pick_folders_and_import(cx)),
            )
            .child(
                Button::new("queue-paste")
                    .small()
                    .rounded(pill)
                    .icon(IconName::Copy)
                    .label(tr("queue.paste"))
                    .disabled(importing)
                    .on_click(|_, _, cx| crate::clipboard::paste(cx)),
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
                    tr_count("queue.import_added", "added", *added, &[])
                }
                ImportFeedback::Added { added, skipped } => tr_count(
                    "queue.import_added_skipped",
                    "added",
                    *added,
                    &[("skipped", skipped)],
                ),
                ImportFeedback::Clipboard { added, issues } => {
                    let detail = issues
                        .iter()
                        .map(|issue| issue.text().to_string())
                        .collect::<Vec<_>>()
                        .join(" ");
                    if *added > 0 {
                        tr_count(
                            "queue.import_partial",
                            "added",
                            *added,
                            &[("detail", &detail)],
                        )
                    } else {
                        tr_with("queue.import_failed", &[("detail", &detail)])
                    }
                }
                ImportFeedback::Scan {
                    added,
                    skipped,
                    errors,
                    truncated,
                    cancelled,
                } => {
                    let mut parts =
                        vec![tr_count("queue.import_added", "added", *added, &[]).to_string()];
                    if *skipped > 0 || *errors > 0 {
                        parts.push(
                            tr_with(
                                "queue.scan_issues",
                                &[("skipped", skipped), ("errors", errors)],
                            )
                            .to_string(),
                        );
                    }
                    if *truncated {
                        parts.push(tr("queue.clipboard_truncated").to_string());
                    }
                    if *cancelled {
                        parts.push(tr("queue.import_cancelled").to_string());
                    }
                    parts.join(" ").into()
                }
                ImportFeedback::Nothing => tr("queue.import_nothing"),
                ImportFeedback::Cancelled => tr("queue.import_cancelled"),
                ImportFeedback::Failed(error) => format_command_error(error),
            }
        };
        let glass = cx.glass();
        Some(
            h_flex()
                .id("queue-feedback")
                .test_support()
                .role(Role::Label)
                .aria_value(text.clone())
                .mx_4()
                .mb_2()
                .px_3()
                .py_1p5()
                .gap_2()
                .items_center()
                .rounded(cx.theme().radius_lg)
                .text_xs()
                .text_color(cx.theme().muted_foreground)
                // An import in progress is a banner; a finished import's
                // summary is a quiet line.
                .when(importing, |this| {
                    this.bg(glass.accent_soft())
                        .border_1()
                        .border_color(glass.accent_edge())
                        .text_color(cx.theme().foreground)
                        .child(Spinner::new().xsmall())
                })
                .child(div().flex_1().min_w_0().child(text))
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
        let importing = self.queue.read(cx).is_importing();
        let glass = cx.glass();
        let muted = cx.theme().muted_foreground;
        let [tint_a, tint_b] = glass.illustration();
        // The whole queue region is the drop target; the dashed frame says
        // so, and the buttons are the keyboard path to the same imports.
        v_flex()
            .id("queue-empty")
            .test_support()
            .flex_1()
            .min_h_0()
            .p_4()
            .child(
                v_flex()
                    .id("queue-import-card")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .items_center()
                    .justify_center()
                    .gap_5()
                    .p_6()
                    .rounded(cx.theme().radius_2xl())
                    .border_2()
                    .border_dashed()
                    .border_color(cx.theme().border)
                    .child(
                        // Two tinted sheets behind a raised one: a stack of
                        // images about to be added.
                        div()
                            .relative()
                            .w_32()
                            .h_24()
                            .flex_none()
                            .child(
                                div()
                                    .absolute()
                                    .left_0()
                                    .top_4()
                                    .size_16()
                                    .rounded(cx.theme().radius_tokens().xl)
                                    .bg(tint_a),
                            )
                            .child(
                                div()
                                    .absolute()
                                    .right_0()
                                    .top_4()
                                    .size_16()
                                    .rounded(cx.theme().radius_tokens().xl)
                                    .bg(tint_b),
                            )
                            .child(
                                div()
                                    .absolute()
                                    .left_6()
                                    .top_0()
                                    .w_20()
                                    .h_24()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .rounded(cx.theme().radius_2xl())
                                    .bg(glass.chip_strong())
                                    .shadow(glass.panel_shadows())
                                    .child(
                                        div()
                                            .size_10()
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .rounded(cx.theme().radius_full())
                                            .bg(cx.theme().tokens.primary)
                                            .child(
                                                Icon::new(IconName::ArrowUp)
                                                    .small()
                                                    .text_color(cx.theme().primary_foreground),
                                            ),
                                    ),
                            ),
                    )
                    .child(
                        v_flex()
                            .gap_1p5()
                            .items_center()
                            .child(
                                div()
                                    .id("queue-drop-title")
                                    .test_support()
                                    .role(Role::Heading)
                                    .aria_label(tr("queue.empty_title"))
                                    .text_xl()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_center()
                                    .child(tr("queue.empty_title")),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(muted)
                                    .text_center()
                                    .id("queue-drop-description")
                                    .test_support()
                                    .role(Role::Label)
                                    .aria_value(tr("queue.empty_description"))
                                    .child(tr("queue.empty_description")),
                            ),
                    )
                    .child(
                        h_flex()
                            .flex_wrap()
                            .gap_2()
                            .justify_center()
                            .child(
                                div().id("queue-empty-add").test_support().child(
                                    Button::new("queue-add-files")
                                        .rounded(ButtonRounded::Size(cx.theme().radius_full()))
                                        .icon(IconName::Plus)
                                        .label(tr("queue.add_files"))
                                        .disabled(importing)
                                        .on_click(|_, _, cx| import::pick_and_import(cx)),
                                ),
                            )
                            .child(
                                Button::new("queue-add-folders")
                                    .rounded(ButtonRounded::Size(cx.theme().radius_full()))
                                    .icon(IconName::FolderOpen)
                                    .label(tr("queue.add_folders"))
                                    .disabled(importing)
                                    .on_click(|_, _, cx| import::pick_folders_and_import(cx)),
                            )
                            .child(
                                Button::new("queue-paste")
                                    .rounded(ButtonRounded::Size(cx.theme().radius_full()))
                                    .icon(IconName::Copy)
                                    .label(tr("queue.paste"))
                                    .disabled(importing)
                                    .on_click(|_, _, cx| crate::clipboard::paste(cx)),
                            ),
                    )
                    .child(
                        v_flex()
                            .gap_2()
                            .items_center()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(muted)
                                    .child(tr("queue.supported_formats")),
                            )
                            .child(h_flex().gap_1().flex_wrap().justify_center().children(
                                self.input_formats.iter().map(|format| {
                                    div()
                                        .rounded(cx.theme().radius_full())
                                        .px_2()
                                        .py_0p5()
                                        .id(SharedString::from(format!("input-format:{format}")))
                                        .test_support()
                                        .role(Role::Label)
                                        .aria_value(format.clone())
                                        .text_xs()
                                        .font_weight(FontWeight::MEDIUM)
                                        .bg(glass.chip())
                                        .text_color(muted)
                                        .child(format.clone())
                                }),
                            )),
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
                    || AppModels::global(cx).batch().read(cx).is_active()
                    || progress_bridge::is_busy(cx);
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
                        let key = item.key.clone();
                        let on_impact: RowClickHandler =
                            Rc::new(cx.listener(move |_, _: &ClickEvent, _, cx| {
                                cx.emit(QueueViewEvent::EnvironmentalImpact(key.clone()));
                            }));
                        QueueRow {
                            item,
                            row_height,
                            busy,
                            on_compare,
                            on_impact,
                        }
                    })
                    .collect()
            },
        )
        .track_scroll(&self.scroll)
        .flex_1()
        .min_h_0()
        .px_2()
        .pb_2()
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
            .when(!is_empty, |view| view.child(self.render_toolbar(cx)))
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
    on_impact: RowClickHandler,
}

impl RenderOnce for QueueRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let muted = cx.theme().muted_foreground;
        let item = self.item;
        let on_compare = self.on_compare;
        let on_impact = self.on_impact;
        let meta = row_meta(&item);
        let compare = Button::new(SharedString::from(format!("compare:{}", item.key)))
            .ghost()
            .xsmall()
            .icon(IconName::Eye)
            .accessibility_label(tr_with("queue.compare_item", &[("name", &item.name)]))
            .tooltip(tr("preview.title"))
            .disabled(self.busy)
            .on_click(move |event, window, cx| on_compare(event, window, cx));
        // A finished item has a measured size change to put in context.
        let impact = matches!(item.status, ItemStatus::Done { .. }).then(|| {
            Button::new(SharedString::from(format!("impact:{}", item.key)))
                .ghost()
                .xsmall()
                .icon(IconName::ChartPie)
                .accessibility_label(tr_with("queue.impact_item", &[("name", &item.name)]))
                .tooltip(tr("impact.title"))
                .on_click(move |event, window, cx| on_impact(event, window, cx))
        });
        let remove_key = item.key.clone();
        let remove = Button::new(SharedString::from(format!("remove:{}", item.key)))
            .ghost()
            .xsmall()
            .icon(IconName::CircleX)
            .accessibility_label(tr_with("queue.remove_item", &[("name", &item.name)]))
            .tooltip(tr("queue.remove"))
            .disabled(self.busy)
            .on_click(move |_, window, cx| {
                if format_edit_busy(cx) {
                    return;
                }
                let removed = AppModels::global(cx)
                    .queue()
                    .clone()
                    .update(cx, |queue, cx| {
                        let removed = queue.remove(&remove_key);
                        if removed.is_some() {
                            cx.notify();
                        }
                        removed
                    });
                if let Some(item) = removed {
                    crate::clipboard::cleanup(vec![item.path.to_string()], cx);
                    if let ThumbnailState::Ready(image) = item.thumbnail {
                        release_images(vec![image], Some(window), cx);
                    }
                }
            });
        let path = item.path.clone();
        // Thumbnail, then a text column of two lines (name and result; facts
        // and target format), then the row's commands in a fixed lane.
        h_flex()
            .id(item.key.clone())
            .test_support()
            .role(Role::Group)
            .aria_label(item.name.clone())
            .tooltip(move |window, cx| Tooltip::new(path.clone()).build(window, cx))
            .h(self.row_height)
            .w_full()
            .px_3()
            .gap_3()
            .items_center()
            .rounded(cx.theme().radius_lg)
            .hover(|style| style.bg(cx.theme().list_hover))
            .child(render_thumbnail(&item.thumbnail, cx))
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap_1()
                    .child(
                        h_flex()
                            .gap_3()
                            .items_center()
                            .child(
                                div()
                                    .id(SharedString::from(format!("name:{}", item.key)))
                                    .test_support()
                                    .role(Role::Label)
                                    .aria_value(item.name.clone())
                                    .flex_1()
                                    .min_w_0()
                                    .text_sm()
                                    .font_weight(FontWeight::MEDIUM)
                                    .truncate()
                                    .child(item.name.clone()),
                            )
                            .child(render_status(&item, cx)),
                    )
                    .child(
                        h_flex()
                            .gap_3()
                            .items_center()
                            .child(
                                div()
                                    .id(SharedString::from(format!("meta:{}", item.key)))
                                    .test_support()
                                    .role(Role::Label)
                                    .aria_value(meta.clone())
                                    .flex_1()
                                    .min_w_0()
                                    .text_xs()
                                    .text_color(muted)
                                    .truncate()
                                    .child(meta),
                            )
                            .child(format_control(&item, self.busy, cx)),
                    ),
            )
            .child(
                h_flex()
                    .flex_none()
                    .gap_0p5()
                    .children(impact)
                    .child(compare)
                    .child(remove),
            )
    }
}

/// Re-check when the menu action commits: it may have opened before a batch.
fn format_edit_busy(cx: &App) -> bool {
    let models = AppModels::global(cx);
    models.queue().read(cx).is_importing()
        || models.batch().read(cx).is_active()
        || progress_bridge::is_busy(cx)
}

fn set_item_format(key: &SharedString, format: Option<&str>, cx: &mut App) {
    if format_edit_busy(cx) {
        return;
    }
    AppModels::global(cx)
        .queue()
        .clone()
        .update(cx, |queue, cx| {
            if queue.set_target_format(key, format) {
                cx.notify();
            }
        });
}

/// The standard menu retains focus/navigation only for rendered rows; no
/// select entity or subscription is allocated for every queued file.
fn format_control(item: &QueueItem, busy: bool, cx: &App) -> impl IntoElement {
    let global = &AppModels::global(cx).settings().read(cx).settings().format;
    let label = item.target_format.as_ref().map_or_else(
        || {
            tr_with(
                "queue.global_format",
                &[("format", &global.to_ascii_uppercase())],
            )
        },
        |format| SharedString::from(format.to_ascii_uppercase()),
    );
    let key = item.key.clone();
    let selected = item.target_format.clone();
    let source = item.source_format_hint().map(SharedString::from);
    Button::new(SharedString::from(format!("item-format:{key}")))
        .outline()
        .xsmall()
        .rounded(ButtonRounded::Size(cx.theme().radius_full()))
        .flex_none()
        .accessibility_label(tr_with(
            "queue.item_format_label",
            &[("name", &item.name), ("format", &label)],
        ))
        .label(label)
        .icon(IconName::ChevronDown)
        .tooltip(tr("queue.target_format"))
        .disabled(busy)
        .dropdown_menu(move |menu, _, _| {
            let default_key = key.clone();
            let mut menu = menu
                .item(
                    PopupMenuItem::new(tr("queue.follow_global"))
                        .checked(selected.is_none())
                        .on_click(move |_, _, cx| set_item_format(&default_key, None, cx)),
                )
                .separator();
            for format in imgconvert_backend::convert::capabilities().writable {
                let item_key = key.clone();
                menu = menu.item(
                    PopupMenuItem::new(if source.as_deref() == Some(format) {
                        tr_with(
                            "queue.source_format",
                            &[("format", &format.to_ascii_uppercase())],
                        )
                    } else {
                        format.to_ascii_uppercase().into()
                    })
                    .checked(selected.as_deref() == Some(format))
                    .on_click(move |_, _, cx| set_item_format(&item_key, Some(format), cx)),
                );
            }
            menu
        })
}

/// The row's second line: pixel size and page count when the import probed
/// the file, then the folder it came from. The full path is the row's
/// tooltip.
fn row_meta(item: &QueueItem) -> SharedString {
    let mut parts: Vec<String> = Vec::new();
    match item.animation {
        imgconvert_backend::import::ImportAnimation::Animated => {
            parts.push(tr("queue.animated").to_string());
        }
        imgconvert_backend::import::ImportAnimation::Unknown => {
            parts.push(tr("queue.animation_unknown").to_string());
        }
        imgconvert_backend::import::ImportAnimation::Static => {}
    }
    if let Some(format) = item.source_format_hint() {
        parts.push(format.to_ascii_uppercase());
    }
    if let (Some(width), Some(height)) = (item.source_width, item.source_height) {
        parts.push(format!("{width} × {height}"));
    }
    if let Some(pages) = item.page_count {
        parts.push(tr_count("queue.page_count", "count", pages, &[]).to_string());
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
        .size_11()
        .rounded(cx.theme().radius_lg)
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

/// The complete current state is readable without hovering an error or warning.
/// Keep this text derived at render time so locale and model changes stay in sync.
fn status_text(
    status: &ItemStatus,
    warnings: &[imgconvert_backend::convert::ConvertWarning],
) -> SharedString {
    let parts = match status {
        ItemStatus::Pending => vec![tr("status.pending").to_string()],
        ItemStatus::Running { percent } => {
            vec![tr("status.running").to_string(), format!("{percent:.0}%")]
        }
        ItemStatus::Done {
            in_size, out_size, ..
        } => {
            let mut parts = vec![
                tr("status.done").to_string(),
                tr_with(
                    "status.saved",
                    &[
                        ("before", &format_bytes(*in_size)),
                        ("after", &format_bytes(*out_size)),
                    ],
                )
                .to_string(),
            ];
            parts.extend(
                warnings
                    .iter()
                    .flat_map(imgconvert_gpui_shared::conversion::warning_texts)
                    .map(|text| text.to_string()),
            );
            parts
        }
        ItemStatus::Skipped { error } => vec![
            tr("status.skipped").to_string(),
            format_command_error(error).to_string(),
        ],
        ItemStatus::Error { error } => vec![
            tr("status.error").to_string(),
            format_command_error(error).to_string(),
        ],
    };
    parts.join(" · ").into()
}

/// The change in size, in whole percent of the source; equal sizes and
/// changes under one percent are said as such rather than rounded to 0%.
fn size_change(in_size: u64, out_size: u64) -> SharedString {
    if in_size == 0 {
        return SharedString::default();
    }
    if in_size == out_size {
        return tr("status.same_size");
    }
    let ratio = out_size as f64 / in_size as f64;
    let percent = ((1. - ratio).abs() * 100.).round();
    match (out_size < in_size, percent < 1.) {
        (true, true) => tr("status.smaller_under_one"),
        (true, false) => tr_with("status.smaller_percent", &[("percent", &percent)]),
        (false, true) => tr("status.larger_under_one"),
        (false, false) => tr_with("status.larger_percent", &[("percent", &percent)]),
    }
}

/// The row's result lane. It shows a compact form (the output size and the
/// change, a short state or the reason); the complete text is the lane's
/// accessible value, and a tooltip where the compact form is cut short.
fn render_status(item: &QueueItem, cx: &App) -> impl IntoElement {
    let status = &item.status;
    let warnings = &item.warnings;
    let text = status_text(status, warnings);
    // The lane shrinks with the text column; a long reason truncates
    // instead of running into the command lane.
    let lane = h_flex()
        .flex_shrink(1.)
        .max_w_56()
        .min_w_0()
        .justify_end()
        .items_center()
        .gap_1p5()
        .text_xs()
        .id(SharedString::from(format!("status:{}", item.key)))
        .test_support()
        .role(if matches!(status, ItemStatus::Running { .. }) {
            Role::Group
        } else {
            Role::Label
        })
        // Static text is its value. Repeating it as a title makes VoiceOver
        // speak it twice. The running group has a title and contains the
        // actual named ProgressIndicator instead.
        .when(matches!(status, ItemStatus::Running { .. }), |lane| {
            lane.aria_label(text.clone())
        })
        .when(!matches!(status, ItemStatus::Running { .. }), |lane| {
            lane.aria_value(text.clone())
        });
    let lane = match status {
        ItemStatus::Done { .. } if !warnings.is_empty() => {
            lane.tooltip(move |window, cx| Tooltip::new(text.clone()).build(window, cx))
        }
        ItemStatus::Error { .. } | ItemStatus::Skipped { .. } => {
            lane.tooltip(move |window, cx| Tooltip::new(text.clone()).build(window, cx))
        }
        _ => lane,
    };
    match status {
        ItemStatus::Pending => lane
            .text_color(cx.theme().muted_foreground)
            .child(tr("status.pending")),
        ItemStatus::Running { percent } => lane
            .child(
                div().w_20().child(
                    Progress::new("row-progress")
                        .accessibility_label(tr_with(
                            "queue.progress_item",
                            &[("name", &item.name)],
                        ))
                        .value(*percent),
                ),
            )
            .child(
                div()
                    .text_color(cx.theme().muted_foreground)
                    .child(format!("{percent:.0}%")),
            ),
        ItemStatus::Done {
            in_size, out_size, ..
        } => {
            let smaller = out_size < in_size;
            lane.child(
                Icon::new(IconName::CircleCheck)
                    .xsmall()
                    .text_color(cx.theme().success),
            )
            .when(!warnings.is_empty(), |lane| {
                lane.child(
                    div()
                        .flex_none()
                        .text_color(cx.theme().warning)
                        .child(tr("status.warnings")),
                )
            })
            .child(
                div()
                    .flex_none()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(format_bytes(*out_size)),
            )
            .child(
                div()
                    .flex_none()
                    .text_color(if smaller {
                        cx.theme().success
                    } else {
                        cx.theme().muted_foreground
                    })
                    .child(size_change(*in_size, *out_size)),
            )
        }
        ItemStatus::Skipped { error } => lane
            .text_color(cx.theme().warning)
            .child(div().flex_none().child(tr("status.skipped")))
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .child(format_command_error(error)),
            ),
        ItemStatus::Error { error } => lane
            .text_color(cx.theme().danger)
            .child(Icon::new(IconName::CircleX).xsmall())
            .child(div().flex_none().child(tr("status.error")))
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .child(format_command_error(error)),
            ),
    }
}

pub use imgconvert_gpui_shared::images::format_bytes;

#[cfg(test)]
mod tests {
    use super::{
        QueueModel, ThumbnailState, apply_thumbnail_result, format_bytes, size_change, tr, tr_with,
    };
    use gpui_kit::{AppContext as _, RenderImage, SharedString, TestAppContext};
    use image::{Frame, ImageBuffer, Rgba};
    use imgconvert_backend::import::ImportScanFile;
    use imgconvert_gpui_shared::queue_model::ThumbnailTicket;
    use std::sync::Arc;

    #[test]
    fn size_change_names_equal_and_sub_percent_changes() {
        assert_eq!(size_change(0, 10), SharedString::default());
        assert_eq!(size_change(1000, 1000), tr("status.same_size"));
        assert_eq!(size_change(100_000, 99_900), tr("status.smaller_under_one"));
        assert_eq!(size_change(100_000, 100_100), tr("status.larger_under_one"));
        assert_eq!(
            size_change(2048, 1024),
            tr_with("status.smaller_percent", &[("percent", &50.)])
        );
        assert_eq!(
            size_change(1000, 1290),
            tr_with("status.larger_percent", &[("percent", &29.)])
        );
    }

    #[test]
    fn sizes_are_formatted_with_binary_units() {
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(1536), "1.5 KB");
        assert_eq!(format_bytes(3 * 1024 * 1024), "3.0 MB");
    }

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

    #[gpui_kit::test]
    fn evicted_thumbnail_is_released_by_the_view(cx: &mut TestAppContext) {
        cx.update(|cx| {
            let queue = cx.new(|_| QueueModel::with_thumbnail_budget(250));
            queue.update(cx, |queue, cx| {
                queue.add_files(vec![scan_file("a"), scan_file("b"), scan_file("c")]);
                cx.notify();
            });
            let tickets: Vec<ThumbnailTicket> = queue.update(cx, |queue, _| {
                ["a", "b", "c"]
                    .into_iter()
                    .map(|key| {
                        queue
                            .mark_thumbnail_loading(&SharedString::from(key))
                            .expect("claim")
                    })
                    .collect()
            });

            let first = image(25);
            let second = image(25);
            apply_thumbnail_result(&queue, &tickets[0], Ok(Some(Arc::clone(&first))), cx);
            apply_thumbnail_result(&queue, &tickets[1], Ok(Some(Arc::clone(&second))), cx);
            queue.update(cx, |queue, _| queue.touch_thumbnails([tickets[0].key()]));

            let third = image(25);
            apply_thumbnail_result(&queue, &tickets[2], Ok(Some(Arc::clone(&third))), cx);

            assert_eq!(
                Arc::strong_count(&second),
                1,
                "the evicted image must be released by the view"
            );
            let queue = queue.read(cx);
            assert!(matches!(
                queue.item(&"b".into()).unwrap().thumbnail,
                ThumbnailState::NotRequested
            ));
            assert_eq!(queue.thumbnail_bytes(), 200);
            drop(first);
            drop(third);
        });
    }
}
