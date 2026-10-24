// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The before/after dialog (port of `ComparisonPreview.svelte` and the
//! `comparisonPreview` state): one entity per opened preview, owned by the
//! Kit dialog that shows it. Generation runs on the background executor
//! under the backend's workflow execution gate; a newer request cancels the
//! previous one through `PreviewState`. Settings changes while the dialog is
//! open mark the shown result stale; the person refreshes explicitly.

use std::sync::Arc;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::component::slider::{Slider, SliderEvent, SliderState};
use gpui_kit::component::spinner::Spinner;
use gpui_kit::component::{
    ActiveTheme as _, IconName, Sizable as _, WindowExt as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, AppContext as _, Context, Div, Entity, FocusHandle, FontWeight, ImageSource,
    InteractiveElement as _, IntoElement, KeyDownEvent, ObjectFit, ParentElement as _, Render,
    RenderImage, Role, SharedString, StatefulInteractiveElement as _, Styled as _,
    StyledImage as _, Subscription, TestSupportExt as _, Window, div, img, px, relative,
    transparent_black,
};
use imgconvert_backend::convert::ConvertWarning;
use imgconvert_backend::preview::{self, PreviewOptions};
use imgconvert_backend::settings::Settings;
use imgconvert_gpui_shared::a11y::{DisabledForAll as _, dialog_title};
use imgconvert_gpui_shared::conversion::{options_for_item, warning_texts};
use imgconvert_gpui_shared::i18n::{tr, tr_with};
use imgconvert_gpui_shared::images::{decode_png, format_bytes};
use imgconvert_gpui_shared::tasks;
use imgconvert_gpui_shared::theme::{ActiveGlass as _, GlassStyled as _};
use imgconvert_gpui_shared::{AppModels, BatchModel, QueueModel, Services, SettingsModel};

/// Longest edge of the preview images, as the Svelte shell requests.
pub const PREVIEW_MAX_EDGE: u32 = 1200;

/// The scalar part of a preview result.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct PreviewSummary {
    pub source_page: Option<usize>,
    /// The one-based pages the PDF selection converts; empty for images.
    pub pdf_pages: Vec<usize>,
    pub source_width: u32,
    pub source_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub output_size: u64,
    pub selected_quality: Option<u8>,
    pub target_size_met: Option<bool>,
    pub warnings: Vec<ConvertWarning>,
}

struct Generated {
    summary: PreviewSummary,
    before: Arc<RenderImage>,
    after: Arc<RenderImage>,
}

pub struct ComparisonPreview {
    item_key: SharedString,
    item_name: SharedString,
    settings: Entity<SettingsModel>,
    queue: Entity<QueueModel>,
    batch: Entity<BatchModel>,
    request_id: u64,
    /// The PDF page asked for; `None` shows the selection's first page.
    pdf_page: Option<usize>,
    loading: bool,
    stale: bool,
    error: Option<String>,
    summary: Option<PreviewSummary>,
    before: Option<Arc<RenderImage>>,
    after: Option<Arc<RenderImage>>,
    /// 0..=100, the share of the width that shows the converted image.
    reveal: f32,
    reveal_slider: Entity<SliderState>,
    reveal_focus: FocusHandle,
    baseline: String,
    _subscriptions: Vec<Subscription>,
}

impl ComparisonPreview {
    fn new(
        item_key: SharedString,
        item_name: SharedString,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let models = AppModels::global(cx).clone();
        let reveal_slider = cx.new(|_| {
            SliderState::new()
                .min(0.)
                .max(100.)
                .step(1.)
                .default_value(50.)
        });
        let subscriptions = vec![
            // A change during generation also counts: the result that lands
            // was computed from the previous record.
            cx.observe(models.settings(), |this, _, cx| {
                if this.signature(cx) != this.baseline {
                    this.stale = true;
                    cx.notify();
                }
            }),
            cx.observe_in(models.queue(), window, |this, queue, window, cx| {
                // The previewed item left the queue: the dialog has nothing to show.
                if queue.read(cx).item(&this.item_key).is_none() {
                    this.cancel(cx);
                    window.close_dialog(cx);
                } else if this.signature(cx) != this.baseline {
                    this.stale = true;
                    cx.notify();
                }
            }),
            // A batch takes the execution gate; the preview yields the way
            // the Svelte shell closes it before `convertAll`.
            cx.observe_in(models.batch(), window, |this, batch, window, cx| {
                if batch.read(cx).is_active() {
                    this.cancel(cx);
                    window.close_dialog(cx);
                }
            }),
            cx.subscribe(&reveal_slider, |this, _, event: &SliderEvent, cx| {
                let (SliderEvent::Change(value) | SliderEvent::Release(value)) = event;
                this.set_reveal(value.start(), cx);
            }),
        ];
        let mut this = Self {
            item_key,
            item_name,
            settings: models.settings().clone(),
            queue: models.queue().clone(),
            batch: models.batch().clone(),
            request_id: 0,
            pdf_page: None,
            loading: false,
            stale: false,
            error: None,
            summary: None,
            before: None,
            after: None,
            reveal: 50.,
            reveal_slider,
            reveal_focus: cx.focus_handle().tab_stop(true),
            baseline: String::new(),
            _subscriptions: subscriptions,
        };
        this.baseline = this.signature(cx);
        this
    }

    pub fn item_key(&self) -> &SharedString {
        &self.item_key
    }

    pub fn is_loading(&self) -> bool {
        self.loading
    }

    pub fn is_stale(&self) -> bool {
        self.stale
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    pub fn summary(&self) -> Option<&PreviewSummary> {
        self.summary.as_ref()
    }

    /// The source image as shown, for tests that check what was rendered.
    pub fn before_image(&self) -> Option<Arc<RenderImage>> {
        self.before.clone()
    }

    pub fn has_images(&self) -> bool {
        self.before.is_some() && self.after.is_some()
    }

    pub fn reveal(&self) -> f32 {
        self.reveal
    }

    /// Shows another page of a PDF's selection: the next (`step` 1) or the
    /// previous (`step` -1) one, regenerating the preview. Ignored while a
    /// generation runs, while the preview is stale, or when there is no
    /// other page.
    pub fn step_pdf_page(&mut self, step: isize, cx: &mut Context<Self>) {
        // A stale summary may list pages the current range no longer selects;
        // Refresh first.
        if self.loading || self.stale {
            return;
        }
        let Some(summary) = self.summary.as_ref() else {
            return;
        };
        let (Some(current), pages) = (summary.source_page, &summary.pdf_pages) else {
            return;
        };
        let Some(index) = pages.iter().position(|page| *page == current) else {
            return;
        };
        let Some(next) = index
            .checked_add_signed(step)
            .and_then(|next| pages.get(next).copied())
        else {
            return;
        };
        self.pdf_page = Some(next);
        self.refresh(cx);
    }

    /// Generations requested so far (tests observe the loading guard).
    pub fn request_id(&self) -> u64 {
        self.request_id
    }

    fn reveal_enabled(&self) -> bool {
        !self.loading && self.after.is_some()
    }

    /// The output-affecting part of the record: when it changes while the
    /// dialog is open, the shown "after" image no longer matches.
    fn signature(&self, cx: &App) -> String {
        let settings = self.settings.read(cx).settings();
        let snapshot = serde_json::to_string(&settings.workflow_snapshot()).unwrap_or_default();
        format!(
            "{snapshot}|{}|{}|{:?}",
            settings.pdf_dpi,
            settings.pdf_page_range,
            self.queue
                .read(cx)
                .item(&self.item_key)
                .and_then(|item| item.target_format.as_deref())
        )
    }

    fn is_busy(&self, cx: &App) -> bool {
        self.batch.read(cx).is_active() || self.queue.read(cx).is_importing()
    }

    pub fn set_reveal(&mut self, value: f32, cx: &mut Context<Self>) {
        let value = value.round().clamp(0., 100.);
        if (self.reveal - value).abs() > f32::EPSILON {
            self.reveal = value;
            cx.notify();
        }
    }

    fn reveal_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if !self.reveal_enabled() {
            return;
        }
        let next = match event.keystroke.key.as_str() {
            "left" | "down" => self.reveal - 1.,
            "right" | "up" => self.reveal + 1.,
            "pagedown" => self.reveal - 10.,
            "pageup" => self.reveal + 10.,
            "home" => 0.,
            "end" => 100.,
            _ => return,
        };
        self.set_reveal(next, cx);
        let value = self.reveal;
        self.reveal_slider
            .update(cx, |state, cx| state.set_value(value, window, cx));
    }

    /// Generates (or regenerates) the preview with the current settings. A
    /// generation already in flight is left alone (one worker per dialog).
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.loading {
            return;
        }
        if self.is_busy(cx) {
            self.error = Some(tr("workflow.already_running").to_string());
            cx.notify();
            return;
        }
        let Some(item) = self.queue.read(cx).item(&self.item_key).cloned() else {
            return;
        };
        let settings: Settings = self.settings.read(cx).settings().clone();
        let conversion = options_for_item(&settings, &item, None, None);
        let pdf_page = self.pdf_page;
        let services = Services::global(cx).clone();
        let registration = match services.preview().begin() {
            Ok(registration) => registration,
            Err(detail) => {
                self.error = Some(detail);
                cx.notify();
                return;
            }
        };
        let token = registration.token();
        let gate = services.batch().execution_gate().handle();

        self.request_id += 1;
        let request_id = self.request_id;
        self.loading = true;
        self.stale = false;
        self.error = None;
        self.baseline = self.signature(cx);
        cx.notify();

        let cancelled_text = tr("preview.cancelled").to_string();
        // The gate wait and the native encode block for seconds; they run on
        // a dedicated thread (see `shared::tasks`).
        let task = tasks::run_blocking(
            "imgconvert-preview",
            cx,
            move || -> Result<Generated, String> {
                // The registration travels with the work: the current-preview
                // slot clears when the native call really ends.
                let _registration = registration;
                if token.is_cancelled() {
                    return Err(cancelled_text.clone());
                }
                let _gate = preview::lock_workflow_execution_gate(&gate);
                if token.is_cancelled() {
                    return Err(cancelled_text);
                }
                let result = preview::generate_preview(
                    PreviewOptions {
                        conversion,
                        max_edge: Some(PREVIEW_MAX_EDGE),
                        pdf_page,
                    },
                    token,
                )?;
                if result.mime != "image/png" {
                    return Err(format!("unexpected preview format {}", result.mime));
                }
                let before = decode_png(&result.before_bytes)?;
                let after = decode_png(&result.after_bytes)?;
                Ok(Generated {
                    summary: PreviewSummary {
                        source_page: result.source_page,
                        pdf_pages: result.pdf_pages,
                        source_width: result.source_width,
                        source_height: result.source_height,
                        output_width: result.output_width,
                        output_height: result.output_height,
                        output_size: result.output_size,
                        selected_quality: result.selected_quality,
                        target_size_met: result.target_size_met,
                        warnings: result.warnings,
                    },
                    before,
                    after,
                })
            },
        );
        cx.spawn(async move |this, cx| {
            let outcome = task.await.and_then(|inner| inner);
            let _ = this.update(cx, |this, cx| {
                if this.request_id != request_id {
                    // Superseded or cancelled: release what arrived late.
                    if let Ok(generated) = outcome {
                        cx.drop_image(generated.before, None);
                        cx.drop_image(generated.after, None);
                    }
                    return;
                }
                this.loading = false;
                match outcome {
                    Ok(generated) => {
                        this.release_images(cx);
                        this.summary = Some(generated.summary);
                        this.before = Some(generated.before);
                        this.after = Some(generated.after);
                    }
                    Err(detail) => this.error = Some(detail),
                }
                // The record may have moved on while this ran.
                if this.signature(cx) != this.baseline {
                    this.stale = true;
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// Stops an in-flight generation; the dialog is closing.
    pub fn cancel(&mut self, cx: &mut Context<Self>) {
        self.request_id += 1;
        self.loading = false;
        Services::global(cx).preview().cancel_current();
    }

    /// Frees the GPU textures of the shown images.
    fn release_images(&mut self, cx: &mut App) {
        for image in [self.before.take(), self.after.take()]
            .into_iter()
            .flatten()
        {
            cx.drop_image(image, None);
        }
    }

    fn render_stage(
        &self,
        stage_height: gpui_kit::Pixels,
        cx: &mut Context<Self>,
    ) -> gpui_kit::AnyElement {
        let reveal = self.reveal / 100.;
        let muted = cx.theme().muted_foreground;
        let (label_background, label_foreground, divider) = {
            let glass = cx.glass();
            (
                glass.image_label_background(),
                glass.image_label_foreground(),
                glass.image_divider(),
            )
        };
        let label = |text: SharedString| {
            div()
                .absolute()
                .top_3()
                .px_2()
                .py_1()
                .rounded_sm()
                .bg(label_background)
                .text_xs()
                .font_weight(FontWeight::MEDIUM)
                .text_color(label_foreground)
                .child(text)
        };
        let mut stage = div()
            .id("preview-stage")
            .test_support()
            .relative()
            .w_full()
            .h(stage_height)
            .rounded_lg()
            .border_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().muted)
            .overflow_hidden();
        if let (Some(before), Some(after)) = (&self.before, &self.after) {
            stage = stage
                .child(
                    img(ImageSource::Render(Arc::clone(before)))
                        .absolute()
                        .inset_0()
                        .size_full()
                        .object_fit(ObjectFit::Contain),
                )
                .when(reveal > 0.005, |this| {
                    this.child(
                        div()
                            .absolute()
                            .top_0()
                            .left_0()
                            .bottom_0()
                            .w(relative(reveal))
                            .overflow_hidden()
                            .child(
                                img(ImageSource::Render(Arc::clone(after)))
                                    .absolute()
                                    .top_0()
                                    .left_0()
                                    .h_full()
                                    .w(relative(1. / reveal))
                                    .object_fit(ObjectFit::Contain),
                            ),
                    )
                })
                .child(
                    div()
                        .absolute()
                        .top_0()
                        .bottom_0()
                        .left(relative(reveal))
                        .w(px(2.))
                        .bg(divider),
                )
                .child(label(tr("preview.after")).left_3())
                .child(label(tr("preview.before")).right_3());
        }
        if self.loading {
            stage = stage.child(
                div()
                    .id("preview-loading")
                    .test_support()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(cx.theme().background.opacity(0.75))
                    .child(
                        h_flex()
                            .gap_2()
                            .text_sm()
                            .child(Spinner::new().small())
                            .child(tr("preview.loading")),
                    ),
            );
        } else if let Some(error) = &self.error {
            stage = stage.child(
                div()
                    .id("preview-error")
                    .test_support()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .p_6()
                    .bg(cx.theme().background.opacity(0.9))
                    .child(
                        div().text_sm().text_color(cx.theme().danger).child(
                            imgconvert_gpui_shared::command_error::format_command_error(
                                &imgconvert_backend::command_error::CommandError::preview_failed(
                                    self.queue
                                        .read(cx)
                                        .item(&self.item_key)
                                        .map_or("", |item| item.path.as_ref()),
                                    error,
                                ),
                            ),
                        ),
                    ),
            );
        } else if self.before.is_none() {
            stage = stage.child(
                div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_sm()
                    .text_color(muted)
                    .child(tr("preview.loading")),
            );
        }
        stage.into_any_element()
    }

    fn stat(label: SharedString, value: Option<SharedString>, cx: &App) -> Div {
        v_flex()
            .flex_1()
            .min_w_0()
            .gap_0p5()
            .px_3()
            .py_2()
            .rounded_md()
            .border_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child(label),
            )
            .children(
                value.map(|value| div().text_sm().font_weight(FontWeight::MEDIUM).child(value)),
            )
    }

    fn render_summary(&self, summary: &PreviewSummary, cx: &mut Context<Self>) -> Div {
        let dims = |w: u32, h: u32| tr_with("preview.dimensions", &[("width", &w), ("height", &h)]);
        let target: Option<(SharedString, bool)> = summary.target_size_met.map(|met| {
            if met {
                (tr("preview.target_met"), true)
            } else {
                (tr("preview.target_not_met"), false)
            }
        });
        let warnings: Vec<SharedString> = summary.warnings.iter().flat_map(warning_texts).collect();
        v_flex()
            .gap_2()
            .child(
                h_flex()
                    .gap_2()
                    .child(Self::stat(
                        tr("preview.before"),
                        Some(dims(summary.source_width, summary.source_height)),
                        cx,
                    ))
                    .child(Self::stat(
                        tr("preview.after"),
                        Some(dims(summary.output_width, summary.output_height)),
                        cx,
                    ))
                    .child(Self::stat(
                        tr_with(
                            "preview.output_size",
                            &[("size", &format_bytes(summary.output_size))],
                        ),
                        summary
                            .selected_quality
                            .map(|quality| tr_with("preview.quality", &[("quality", &quality)])),
                        cx,
                    ))
                    .child(match target {
                        Some((text, met)) => {
                            Self::stat(tr("workflow.target_section"), Some(text), cx).text_color(
                                if met {
                                    cx.theme().success
                                } else {
                                    cx.theme().warning
                                },
                            )
                        }
                        None => Self::stat(tr("workflow.target_section"), Some("—".into()), cx),
                    }),
            )
            .when(!warnings.is_empty(), |this| {
                this.child(
                    v_flex()
                        .gap_1()
                        .px_3()
                        .py_2()
                        .rounded_md()
                        .border_1()
                        .border_color(cx.theme().warning)
                        .text_xs()
                        .children(warnings.into_iter().map(|text| div().child(text))),
                )
            })
    }
}

impl ComparisonPreview {
    /// Previous / position / next for a PDF whose selection has more than
    /// one page.
    fn render_page_controls(&self, cx: &mut Context<Self>) -> Option<impl IntoElement + use<>> {
        let summary = self.summary.as_ref()?;
        let current = summary.source_page?;
        let pages = &summary.pdf_pages;
        if pages.len() < 2 {
            return None;
        }
        let index = pages.iter().position(|page| *page == current)?;
        let first = index == 0;
        let last = index + 1 == pages.len();
        Some(
            h_flex()
                .id("preview-pages")
                .test_support()
                .flex_none()
                .gap_1()
                .items_center()
                .child(
                    Button::new("preview-page-previous")
                        .ghost()
                        .xsmall()
                        .icon(IconName::ChevronLeft)
                        .accessibility_label(tr("preview.previous_page"))
                        .tooltip(tr("preview.previous_page"))
                        .disabled_for_all(first || self.loading || self.stale)
                        .on_click(cx.listener(|this, _, _, cx| this.step_pdf_page(-1, cx))),
                )
                .child(
                    div()
                        .id("preview-page-position")
                        .test_support()
                        .role(Role::Label)
                        .aria_label(tr_with(
                            "preview.page_position",
                            &[("index", &(index + 1)), ("count", &pages.len())],
                        ))
                        .text_xs()
                        .child(format!("{} / {}", index + 1, pages.len())),
                )
                .child(
                    Button::new("preview-page-next")
                        .ghost()
                        .xsmall()
                        .icon(IconName::ChevronRight)
                        .accessibility_label(tr("preview.next_page"))
                        .tooltip(tr("preview.next_page"))
                        .disabled_for_all(last || self.loading || self.stale)
                        .on_click(cx.listener(|this, _, _, cx| this.step_pdf_page(1, cx))),
                ),
        )
    }
}

impl Render for ComparisonPreview {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let muted = cx.theme().muted_foreground;
        let ring = cx.theme().ring;
        // Geometry follows the window: the stage takes under half its height
        // and the body scrolls when statistics and warnings do not fit.
        let viewport = window.viewport_size();
        let stage_height = (viewport.height * 0.45).clamp(px(180.), px(480.));
        let body_max_height = (viewport.height * 0.72).max(px(240.));
        let reveal_enabled = self.reveal_enabled();
        let subtitle: SharedString = match self.summary.as_ref().and_then(|s| s.source_page) {
            Some(page) => format!(
                "{} · {}",
                self.item_name,
                tr_with("preview.pdf_page", &[("page", &page)])
            )
            .into(),
            None => self.item_name.clone(),
        };
        let reveal_label = tr("preview.reveal");
        v_flex()
            .id("preview-body")
            .max_h(body_max_height)
            .overflow_y_scrollbar()
            .child(
                v_flex()
                    .id("comparison-preview")
                    .test_support()
                    .gap_3()
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .text_xs()
                                    .text_color(muted)
                                    .truncate()
                                    .child(subtitle),
                            )
                            .children(self.render_page_controls(cx)),
                    )
                    .child(self.render_stage(stage_height, cx))
                    .when(
                        self.stale && !self.loading && self.error.is_none(),
                        |this| {
                            this.child(
                                h_flex()
                                    .id("preview-stale")
                                    .test_support()
                                    .items_center()
                                    .gap_2()
                                    .px_3()
                                    .py_2()
                                    .rounded_md()
                                    .border_1()
                                    .border_color(cx.theme().warning)
                                    .text_xs()
                                    .child(div().flex_1().min_w_0().child(tr("preview.stale")))
                                    .child(
                                        Button::new("preview-stale-refresh")
                                            .outline()
                                            .small()
                                            .label(tr("preview.refresh"))
                                            .on_click(
                                                cx.listener(|this, _, _, cx| this.refresh(cx)),
                                            ),
                                    ),
                            )
                        },
                    )
                    .child(
                        v_flex()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(muted)
                                    .child(reveal_label.clone()),
                            )
                            .child(
                                // Kit's slider has no accessible-name builder in 0.7.1;
                                // the focusable wrapper carries the name and is only a
                                // Tab stop while the slider itself is enabled.
                                div()
                                    .id("preview-reveal")
                                    .test_support()
                                    .aria_label(reveal_label)
                                    .rounded_md()
                                    .border_1()
                                    .border_color(transparent_black())
                                    .when(reveal_enabled, |this| {
                                        this.track_focus(&self.reveal_focus)
                                            .focus_visible(move |style| style.border_color(ring))
                                            .on_key_down(cx.listener(
                                                |this, event: &KeyDownEvent, window, cx| {
                                                    this.reveal_key(event, window, cx);
                                                },
                                            ))
                                    })
                                    .child(
                                        Slider::new(&self.reveal_slider).disabled(!reveal_enabled),
                                    ),
                            ),
                    )
                    .children(
                        self.summary
                            .clone()
                            .map(|summary| self.render_summary(&summary, cx)),
                    ),
            )
    }
}

/// Opens the comparison dialog for the queue item `key` and starts the first
/// generation. `None` when the item is unknown or a batch/import is running.
pub fn open_comparison_preview(
    key: SharedString,
    window: &mut Window,
    cx: &mut App,
) -> Option<Entity<ComparisonPreview>> {
    let models = AppModels::global(cx).clone();
    let item = models.queue().read(cx).item(&key)?.clone();
    if models.batch().read(cx).is_active() || models.queue().read(cx).is_importing() {
        return None;
    }
    let preview =
        cx.new(|cx| ComparisonPreview::new(item.key.clone(), item.name.clone(), window, cx));
    // When Kit drops the dialog (close button, Escape, backdrop, our Close),
    // the entity goes with it: stop any generation and free the textures.
    cx.observe_release(&preview, |preview, cx| {
        preview.request_id += 1;
        Services::global(cx).preview().cancel_current();
        preview.release_images(cx);
    })
    .detach();
    preview.update(cx, ComparisonPreview::refresh);

    let for_content = preview.clone();
    let for_close = preview.clone();
    window.open_dialog(cx, move |dialog, _, cx| {
        let content_entity = for_content.clone();
        let refresh_entity = for_content.clone();
        let close_entity = for_close.clone();
        let loading = for_content.read(cx).is_loading();
        dialog
            .glass_dialog(cx)
            // The footer's own close button is the one way out besides
            // Escape: Kit's corner button is named "Close" in every language.
            .close_button(false)
            .title(dialog_title(tr("preview.title")))
            .w(px(880.))
            .content(move |content, _, _| content.child(content_entity.clone()))
            .footer(
                h_flex()
                    .justify_end()
                    .gap_2()
                    .child(
                        Button::new("preview-refresh")
                            .outline()
                            .label(tr("preview.refresh"))
                            .disabled_for_all(loading)
                            .on_click(move |_, _, cx| {
                                refresh_entity.update(cx, ComparisonPreview::refresh);
                            }),
                    )
                    .child(
                        Button::new("preview-close")
                            .label(tr("preview.close"))
                            .on_click(|_, window, cx| window.close_dialog(cx)),
                    ),
            )
            .on_close(move |_, _, cx| {
                close_entity.update(cx, ComparisonPreview::cancel);
            })
    });
    Some(preview)
}
