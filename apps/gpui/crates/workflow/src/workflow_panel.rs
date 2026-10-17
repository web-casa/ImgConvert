// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Side panel with the conversion decision: format, folder, start/cancel.
//! Primary styling goes to Start because it is the panel's one commit.
//!
//! Format and output folder are read from and written to the persisted
//! settings (`format`, `outDir`); every other conversion field comes from the
//! same record through `conversion_request`, so a batch started here uses
//! exactly what the Tauri shell would use.

use std::path::{Path, PathBuf};

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::form::{Field, Form};
use gpui_kit::component::progress::Progress;
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, IconName, IndexPath, Sizable as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, AppContext as _, Context, Entity, FontWeight, InteractiveElement as _, IntoElement,
    ParentElement as _, Render, SharedString, StatefulInteractiveElement as _, Styled as _,
    Subscription, TestSupportExt as _, Window, div,
};
use imgconvert_backend::conversion_request::{
    self, ConversionItem, output_suffix_for_request, quality_floor_for,
};
use imgconvert_backend::convert::{self, ConvertOptions};
use imgconvert_backend::settings::Settings;
use imgconvert_gpui_shared::file_prompt::{self, PromptKind};
use imgconvert_gpui_shared::i18n::{tr, tr_with};
use imgconvert_gpui_shared::progress_bridge::{self, StartError};
use imgconvert_gpui_shared::{
    AppModels, BatchModel, BatchPhase, QueueItem, QueueModel, SettingsModel,
};

/// Semantic notices, translated at render time so a locale switch re-renders them.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Notice {
    NothingToConvert,
    AlreadyRunning,
    Failed(String),
}

impl Notice {
    fn text(&self) -> SharedString {
        match self {
            Self::NothingToConvert => tr("workflow.nothing_to_convert"),
            Self::AlreadyRunning => tr("workflow.already_running"),
            Self::Failed(detail) => tr_with("workflow.failed", &[("detail", detail)]),
        }
    }
}

pub struct WorkflowPanel {
    queue: Entity<QueueModel>,
    batch: Entity<BatchModel>,
    settings: Entity<SettingsModel>,
    format: Entity<SelectState<Vec<SharedString>>>,
    formats: Vec<SharedString>,
    /// Formats the core can write losslessly, from the capability matrix.
    lossless_formats: Vec<String>,
    notice: Option<Notice>,
    _subscriptions: Vec<Subscription>,
}

impl WorkflowPanel {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let models = AppModels::global(cx).clone();
        let capabilities = convert::capabilities();
        let formats: Vec<SharedString> = capabilities
            .writable
            .iter()
            .map(|format| SharedString::from((*format).to_string()))
            .collect();
        let lossless_formats = capabilities
            .lossless
            .iter()
            .map(|format| (*format).to_string())
            .collect();
        let persisted = models.settings().read(cx).settings().format.clone();
        let selected_ix = formats
            .iter()
            .position(|format| format.as_ref() == persisted)
            .unwrap_or(0);
        let format = cx.new(|cx| {
            SelectState::new(
                formats.clone(),
                Some(IndexPath::default().row(selected_ix)),
                window,
                cx,
            )
        });
        let subscriptions = vec![
            cx.observe(models.queue(), |_, _, cx| cx.notify()),
            cx.observe(models.batch(), |_, _, cx| cx.notify()),
            // Another writer (a preset, a future settings panel) changed the
            // record: mirror the format into the control.
            cx.observe_in(models.settings(), window, |this, _, window, cx| {
                this.sync_format_from_settings(window, cx);
                cx.notify();
            }),
            cx.subscribe(&format, |this, _, event: &SelectEvent<_>, cx| {
                if let SelectEvent::Confirm(Some(value)) = event {
                    let value = value.to_string();
                    this.settings.update(cx, |settings, cx| {
                        settings.update(cx, |settings| settings.format = value);
                    });
                }
            }),
        ];
        Self {
            queue: models.queue().clone(),
            batch: models.batch().clone(),
            settings: models.settings().clone(),
            format,
            formats,
            lossless_formats,
            notice: None,
            _subscriptions: subscriptions,
        }
    }

    /// The persisted output folder (`outDir`).
    pub fn output_dir(&self, cx: &App) -> Option<PathBuf> {
        self.settings
            .read(cx)
            .settings()
            .out_dir
            .as_deref()
            .map(PathBuf::from)
    }

    /// Sets and persists the output folder without a prompt (the picker
    /// callback, tests and the perf probe).
    pub fn set_output_dir(&mut self, dir: PathBuf, cx: &mut Context<Self>) {
        let dir = dir.to_string_lossy().into_owned();
        self.settings.update(cx, |settings, cx| {
            settings.update(cx, |settings| settings.out_dir = Some(dir));
        });
        cx.notify();
    }

    /// The persisted output format when the core can write it, else the
    /// first writable format.
    pub fn selected_format(&self, cx: &App) -> SharedString {
        let persisted = &self.settings.read(cx).settings().format;
        self.formats
            .iter()
            .find(|format| format.as_ref() == persisted)
            .or_else(|| self.formats.first())
            .cloned()
            .unwrap_or_else(|| SharedString::from("webp"))
    }

    /// Persists `format` and mirrors it into the control; unknown formats
    /// are ignored.
    pub fn set_format(&mut self, format: &str, window: &mut Window, cx: &mut Context<Self>) {
        if !self.formats.iter().any(|known| known.as_ref() == format) {
            return;
        }
        let format = format.to_string();
        self.settings.update(cx, |settings, cx| {
            settings.update(cx, |settings| settings.format = format);
        });
        self.sync_format_from_settings(window, cx);
    }

    fn sync_format_from_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let wanted = self.selected_format(cx);
        if self.format.read(cx).selected_value() != Some(&wanted) {
            self.format.update(cx, |select, cx| {
                select.set_selected_value(&wanted, window, cx);
            });
        }
    }

    fn choose_output_dir(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let picker =
            file_prompt::prompt_paths(PromptKind::OutputFolder, tr("workflow.choose_output"), cx);
        cx.spawn_in(window, async move |this, cx| {
            if let Some(mut paths) = picker.await {
                let dir = paths.remove(0);
                let _ = this.update(cx, |this, cx| this.set_output_dir(dir, cx));
            }
        })
        .detach();
    }

    /// Starts the batch, asking for an output folder first when none is set.
    pub fn start(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.queue.read(cx).is_empty() {
            self.notice = Some(Notice::NothingToConvert);
            cx.notify();
            return;
        }
        if progress_bridge::is_busy(cx) {
            self.notice = Some(Notice::AlreadyRunning);
            cx.notify();
            return;
        }
        if let Some(dir) = self.output_dir(cx) {
            let format = self.selected_format(cx).to_string();
            self.start_into(dir, format, cx);
            return;
        }
        let picker =
            file_prompt::prompt_paths(PromptKind::OutputFolder, tr("workflow.choose_output"), cx);
        cx.spawn_in(window, async move |this, cx| {
            if let Some(mut paths) = picker.await {
                let dir = paths.remove(0);
                let _ = this.update(cx, |this, cx| {
                    this.start_with_output_dir(dir, None, cx);
                });
            }
        })
        .detach();
    }

    /// Starts the batch into `dir` without prompting (perf probe and tests).
    /// `format` overrides the panel's selection when given.
    pub fn start_with_output_dir(
        &mut self,
        dir: PathBuf,
        format: Option<String>,
        cx: &mut Context<Self>,
    ) {
        self.set_output_dir(dir.clone(), cx);
        let format = format.unwrap_or_else(|| self.selected_format(cx).to_string());
        self.start_into(dir, format, cx);
    }

    fn start_into(&mut self, dir: PathBuf, format: String, cx: &mut Context<Self>) {
        let settings = self.settings.read(cx).settings().clone();
        let lossless_supported = self.lossless_formats.contains(&format);
        let (keys, options) = {
            let queue = self.queue.read(cx);
            let keys = queue.keys();
            let options = queue
                .items()
                .iter()
                .map(|item| build_options(&settings, item, &dir, &format, lossless_supported))
                .collect::<Vec<_>>();
            (keys, options)
        };
        let concurrency = match settings.concurrency {
            0 => None,
            n => Some(usize::from(n)),
        };
        self.notice = match progress_bridge::start_batch(keys, options, concurrency, cx) {
            Ok(_) => None,
            Err(StartError::Empty) => Some(Notice::NothingToConvert),
            Err(StartError::Settling) => Some(Notice::AlreadyRunning),
            Err(StartError::Batch(error)) => Some(Notice::Failed(error.to_string())),
        };
        cx.notify();
    }

    pub fn cancel(&mut self, cx: &mut Context<Self>) {
        progress_bridge::cancel_batch(cx);
        cx.notify();
    }

    fn render_status(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let batch = self.batch.read(cx);
        let muted = cx.theme().muted_foreground;
        let text: SharedString = match batch.phase() {
            BatchPhase::Idle => {
                // A failed settings write outranks a transient notice: the
                // person should know their choices are not being kept.
                if let Some(detail) = self.settings.read(cx).last_error() {
                    let text = tr_with("settings.save_failed", &[("detail", &detail)]);
                    return Some(
                        div()
                            .id("workflow-status")
                            .test_support()
                            .aria_label(text.clone())
                            .text_xs()
                            .text_color(cx.theme().danger)
                            .child(text),
                    );
                }
                return self.notice.as_ref().map(|notice| {
                    let text = notice.text();
                    div()
                        .id("workflow-status")
                        .test_support()
                        .aria_label(text.clone())
                        .text_xs()
                        .text_color(muted)
                        .child(text)
                });
            }
            BatchPhase::Running | BatchPhase::Cancelling => tr_with(
                "workflow.progress",
                &[("done", &batch.finished_count()), ("total", &batch.total())],
            ),
            BatchPhase::Finished(summary) if summary.cancelled => tr_with(
                "workflow.summary_cancelled",
                &[("done", &summary.completed), ("total", &summary.total)],
            ),
            BatchPhase::Finished(summary) => tr_with(
                "workflow.summary",
                &[
                    ("done", &summary.completed),
                    ("skipped", &summary.skipped),
                    ("failed", &summary.failed),
                ],
            ),
            BatchPhase::Failed(detail) => tr_with("workflow.failed", &[("detail", detail)]),
        };
        let color = if matches!(batch.phase(), BatchPhase::Failed(_)) {
            cx.theme().danger
        } else {
            muted
        };
        Some(
            div()
                .id("workflow-status")
                .test_support()
                .aria_label(text.clone())
                .text_xs()
                .text_color(color)
                .child(text),
        )
    }
}

impl Render for WorkflowPanel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let batch = self.batch.read(cx);
        let active = batch.is_active();
        let cancelling = matches!(batch.phase(), BatchPhase::Cancelling);
        let show_progress = active || matches!(batch.phase(), BatchPhase::Finished(_));
        let percent = batch.percent();
        let queue = self.queue.read(cx);
        // The bridge may still be settling after the backend reported Finished.
        let can_start =
            !queue.is_empty() && !queue.is_importing() && !active && !progress_bridge::is_busy(cx);
        // Starting without a chosen folder opens the picker first.
        let output_dir = self.output_dir(cx);
        let start_label = if output_dir.is_some() {
            tr("workflow.start")
        } else {
            tr("workflow.start_choose")
        };
        let output_label: SharedString = output_dir.as_ref().map_or_else(
            || tr("workflow.output_not_chosen"),
            |dir| SharedString::from(dir.to_string_lossy().into_owned()),
        );
        let muted = cx.theme().muted_foreground;

        v_flex()
            .id("workflow-panel")
            .test_support()
            .w_80()
            .flex_none()
            .h_full()
            .p_4()
            .gap_4()
            .border_l_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().sidebar)
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(tr("workflow.title")),
            )
            .child(
                Form::new()
                    .child(
                        Field::new().label(tr("workflow.format")).child(
                            Select::new(&self.format)
                                .id("workflow-format")
                                .disabled(active),
                        ),
                    )
                    .child(
                        Field::new().label(tr("workflow.output_dir")).child(
                            v_flex()
                                .gap_1()
                                .child(
                                    Button::new("workflow-choose-output")
                                        .outline()
                                        .small()
                                        .icon(IconName::FolderOpen)
                                        .label(tr("workflow.choose_output"))
                                        .disabled(active)
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.choose_output_dir(window, cx);
                                        })),
                                )
                                .child(
                                    div()
                                        .id("workflow-output-dir")
                                        .test_support()
                                        .aria_label(output_label.clone())
                                        .text_xs()
                                        .text_color(muted)
                                        .truncate()
                                        .child(output_label),
                                ),
                        ),
                    ),
            )
            .child(div().flex_1())
            .when(show_progress, |this| {
                this.child(Progress::new("workflow-progress").value(percent))
            })
            .children(self.render_status(cx))
            .child(if active {
                h_flex().child(
                    Button::new("workflow-cancel")
                        .danger()
                        .w_full()
                        .label(if cancelling {
                            tr("workflow.cancelling")
                        } else {
                            tr("workflow.cancel")
                        })
                        .disabled(cancelling)
                        .loading(cancelling)
                        .on_click(cx.listener(|this, _, _, cx| this.cancel(cx))),
                )
            } else {
                h_flex().child(
                    Button::new("workflow-start")
                        .primary()
                        .w_full()
                        .label(start_label)
                        .disabled(!can_start)
                        .on_click(cx.listener(|this, _, window, cx| this.start(window, cx))),
                )
            })
    }
}

/// Writable formats from the backend capability matrix, in its order.
pub fn writable_formats() -> Vec<SharedString> {
    convert::capabilities()
        .writable
        .into_iter()
        .map(SharedString::from)
        .collect()
}

/// Conversion options for one queue item from the persisted settings, the
/// folder and format chosen in the panel. `settings.out_dir` is overridden by
/// `out_dir` so a folder picked at start time applies even before the record
/// is written.
pub fn build_options(
    settings: &Settings,
    item: &QueueItem,
    out_dir: &Path,
    format: &str,
    lossless_supported: bool,
) -> ConvertOptions {
    let mut settings = settings.clone();
    settings.out_dir = Some(out_dir.to_string_lossy().into_owned());
    let conversion_item = ConversionItem::new(item.path.to_string())
        .with_relative_dir(item.relative_dir.as_ref().map(ToString::to_string))
        .with_source(
            item.source_format.as_ref().map(ToString::to_string),
            item.source_width,
            item.source_height,
        );
    conversion_request::conversion_options_for(
        &settings,
        &conversion_item,
        format,
        quality_floor_for(&settings, format),
        lossless_supported,
        output_suffix_for_request(&settings).as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(path: &str) -> QueueItem {
        let mut model = QueueModel::default();
        model.add_files(vec![imgconvert_backend::import::ImportScanFile {
            path: path.to_string(),
            key: "k".into(),
            relative_dir: Some("sub".into()),
            metadata: None,
        }]);
        model.item_at(0).unwrap().clone()
    }

    #[test]
    fn options_follow_the_settings_folder_and_format() {
        let mut settings = Settings::default();
        settings.quality = 66;
        settings.output_suffix_enabled = true;
        settings.output_suffix = "_web".into();
        let options = build_options(
            &settings,
            &item("/in/a.png"),
            Path::new("/out"),
            "webp",
            true,
        );
        assert_eq!(options.input, "/in/a.png");
        assert_eq!(options.out_dir.as_deref(), Some("/out"));
        assert_eq!(options.relative_dir.as_deref(), Some("sub"));
        assert_eq!(options.format, "webp");
        assert_eq!(options.quality, 66);
        assert_eq!(options.quality_floor, 30);
        assert_eq!(options.output_suffix.as_deref(), Some("_web"));
        assert!(!options.allow_source_overwrite);
        assert_eq!(options.file_name_template.as_deref(), Some("%name%"));
        assert_eq!(options.overwrite_mode.as_deref(), Some("skip"));
        assert!(!options.overwrite);
    }

    #[test]
    fn lossless_needs_core_support_for_the_format() {
        let mut settings = Settings::default();
        settings.lossless = true;
        let supported = build_options(
            &settings,
            &item("/in/a.png"),
            Path::new("/out"),
            "webp",
            true,
        );
        let unsupported = build_options(
            &settings,
            &item("/in/a.png"),
            Path::new("/out"),
            "jpeg",
            false,
        );
        assert!(supported.lossless);
        assert!(!unsupported.lossless);
    }

    #[test]
    fn writable_formats_exclude_heic_and_pdf() {
        let formats = writable_formats();
        assert!(formats.iter().any(|format| format.as_ref() == "webp"));
        assert!(!formats.iter().any(|format| format.as_ref() == "heic"));
        assert!(!formats.iter().any(|format| format.as_ref() == "pdf"));
    }
}
