// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The settings card (title + scrolling [`SettingsForm`]) and the owner of
//! the start decision: planning, output-safety prompts, batch start and
//! cancel. The controls that trigger it (output folder, status, Start /
//! Cancel) render in the floating [`crate::ActionBar`].
//!
//! Every field is read from and written to the persisted settings; a batch
//! started here builds its options from that record through
//! `conversion_request`, so it uses exactly what the Tauri shell would use.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::component::{WindowExt as _, v_flex};
use gpui_kit::{
    App, AppContext as _, Context, Entity, FontWeight, InteractiveElement as _, IntoElement,
    ParentElement as _, Render, SharedString, Styled as _, Subscription, TestSupportExt as _,
    Window, div,
};
use imgconvert_backend::convert::{self, ConvertOptions};
use imgconvert_backend::settings::Settings;
use imgconvert_gpui_shared::conversion::options_for_item;
use imgconvert_gpui_shared::file_prompt::{self, PromptKind};
use imgconvert_gpui_shared::i18n::{tr, tr_with};
use imgconvert_gpui_shared::progress_bridge::{self, StartError};
use imgconvert_gpui_shared::tasks;
use imgconvert_gpui_shared::{AppModels, QueueItem, QueueModel, SettingsModel};

use crate::output_safety;
use crate::settings_form::SettingsForm;

/// Semantic notices, translated at render time so a locale switch re-renders them.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Notice {
    NothingToConvert,
    AlreadyRunning,
    InvalidConfiguration,
    Planning,
    PlanFailed(String),
    /// Queue or settings changed while the prompts were open.
    RestartNeeded,
    Failed(String),
}

impl Notice {
    fn text(&self) -> SharedString {
        match self {
            Self::NothingToConvert => tr("workflow.nothing_to_convert"),
            Self::AlreadyRunning => tr("workflow.already_running"),
            Self::InvalidConfiguration => tr("workflow.invalid_configuration"),
            Self::Planning => tr("safety.planning"),
            Self::PlanFailed(detail) => tr_with("safety.plan_failed", &[("detail", detail)]),
            Self::RestartNeeded => tr("safety.restart_needed"),
            Self::Failed(detail) => tr_with("workflow.failed", &[("detail", detail)]),
        }
    }
}

/// A start between planning and submission.
struct PendingHandle {
    state: Rc<RefCell<Option<output_safety::PendingStart>>>,
    /// The queue and settings the jobs were built from.
    queue_revision: u64,
    settings: Settings,
}

pub struct WorkflowPanel {
    queue: Entity<QueueModel>,
    settings: Entity<SettingsModel>,
    settings_form: Entity<SettingsForm>,
    formats: Vec<SharedString>,
    /// Output paths are being planned or confirmed; Start is disabled.
    planning: bool,
    /// The start waiting for its decisions, owned here so the panel can tear
    /// it down (the dialog callbacks only borrow it).
    pending_start: Option<PendingHandle>,
    notice: Option<Notice>,
    _subscriptions: Vec<Subscription>,
}

impl WorkflowPanel {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let models = AppModels::global(cx).clone();
        let formats = writable_formats();
        let settings_form = cx.new(|cx| SettingsForm::new(window, cx));
        let subscriptions = vec![
            // A queue change or a settings edit invalidates planned jobs.
            cx.observe_in(models.queue(), window, |this, _, window, cx| {
                this.abort_pending_if_stale(window, cx);
                cx.notify();
            }),
            cx.observe(models.batch(), |_, _, cx| cx.notify()),
            cx.observe_in(models.settings(), window, |this, _, window, cx| {
                this.abort_pending_if_stale(window, cx);
                cx.notify();
            }),
            cx.observe(&settings_form, |_, _, cx| cx.notify()),
        ];
        Self {
            queue: models.queue().clone(),
            settings: models.settings().clone(),
            settings_form,
            formats,
            planning: false,
            pending_start: None,
            notice: None,
            _subscriptions: subscriptions,
        }
    }

    pub fn settings_form(&self) -> &Entity<SettingsForm> {
        &self.settings_form
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

    /// Persists `format` through the form; unknown formats are ignored.
    pub fn set_format(&mut self, format: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.settings_form
            .update(cx, |form, cx| form.set_format(format, window, cx));
    }

    /// Opens the folder picker and persists the choice.
    pub fn choose_output_dir(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
        if self.settings_form.read(cx).has_invalid_configuration(cx) {
            self.notice = Some(Notice::InvalidConfiguration);
            cx.notify();
            return;
        }
        if self.planning {
            return;
        }
        if let Some(dir) = self.output_dir(cx) {
            let format = self.selected_format(cx).to_string();
            self.start_with_safety_checks(dir, format, window, cx);
            return;
        }
        let picker =
            file_prompt::prompt_paths(PromptKind::OutputFolder, tr("workflow.choose_output"), cx);
        cx.spawn_in(window, async move |this, cx| {
            if let Some(mut paths) = picker.await {
                let dir = paths.remove(0);
                let _ = cx.update(|window, cx| {
                    this.update(cx, |this, cx| {
                        this.set_output_dir(dir.clone(), cx);
                        let format = this.selected_format(cx).to_string();
                        this.start_with_safety_checks(dir, format, window, cx);
                    })
                });
            }
        })
        .detach();
    }

    /// Plans every output path on a worker thread, then walks the
    /// output-safety prompts (see `output_safety`) before starting.
    fn start_with_safety_checks(
        &mut self,
        dir: PathBuf,
        format: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (keys, options, concurrency) = self.prepare_jobs(&dir, &format, cx);
        if keys.is_empty() {
            self.notice = Some(Notice::NothingToConvert);
            cx.notify();
            return;
        }
        let settings = self.settings.read(cx).settings().clone();
        let overwrite = settings.overwrite;
        let revision = self.queue.read(cx).revision();
        self.planning = true;
        self.pending_start = Some(PendingHandle {
            state: Rc::new(RefCell::new(None)),
            queue_revision: revision,
            settings,
        });
        self.notice = Some(Notice::Planning);
        cx.notify();
        let plan_options = options.clone();
        let planned = tasks::run_blocking("imgconvert-plan", cx, move || {
            convert::conversion_plan(&plan_options)
        });
        cx.spawn_in(window, async move |this, cx| {
            let plan = planned.await;
            let _ = cx.update(|window, cx| {
                // Decide inside the entity, prompt outside it: `advance` may
                // call straight back into the panel when no prompt is needed.
                let next = this.update(cx, |panel, cx| {
                    let Some(handle) = panel.pending_start.as_ref() else {
                        return None; // torn down meanwhile
                    };
                    match plan {
                        Ok(plan) => {
                            *handle.state.borrow_mut() = Some(output_safety::PendingStart::new(
                                keys,
                                options,
                                plan,
                                concurrency,
                                overwrite,
                            ));
                            Some(Rc::clone(&handle.state))
                        }
                        Err(detail) => {
                            panel.planning = false;
                            panel.pending_start = None;
                            panel.notice = Some(Notice::PlanFailed(detail));
                            cx.notify();
                            None
                        }
                    }
                });
                if let Ok(Some(pending)) = next {
                    output_safety::advance(this.clone(), pending, window, cx);
                }
            });
        })
        .detach();
    }

    /// Drops a pending start when the jobs it planned no longer match the
    /// queue or the settings; an open prompt is closed.
    fn abort_pending_if_stale(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(handle) = self.pending_start.as_ref() else {
            return;
        };
        let stale = self.queue.read(cx).revision() != handle.queue_revision
            || self.queue.read(cx).is_importing()
            || *self.settings.read(cx).settings() != handle.settings;
        if !stale {
            return;
        }
        handle.state.borrow_mut().take();
        self.pending_start = None;
        self.planning = false;
        self.notice = Some(Notice::RestartNeeded);
        if window.has_active_dialog(cx) {
            window.close_dialog(cx);
        }
        cx.notify();
    }

    /// The jobs a batch would submit: every queue item, in queue order.
    fn prepare_jobs(
        &self,
        dir: &Path,
        format: &str,
        cx: &App,
    ) -> (Vec<SharedString>, Vec<ConvertOptions>, Option<usize>) {
        let settings = self.settings.read(cx).settings().clone();
        let queue = self.queue.read(cx);
        let keys = queue.keys();
        let options = queue
            .items()
            .iter()
            .map(|item| build_options(&settings, item, dir, format))
            .collect::<Vec<_>>();
        let concurrency = match settings.concurrency {
            0 => None,
            n => Some(usize::from(n)),
        };
        (keys, options, concurrency)
    }

    /// Every prompt was answered: start with the decided options, unless the
    /// queue or settings moved on since they were planned.
    pub(crate) fn start_decided(
        &mut self,
        decided: output_safety::PendingStart,
        cx: &mut Context<Self>,
    ) {
        let Some(handle) = self.pending_start.take() else {
            self.planning = false;
            return;
        };
        self.planning = false;
        if self.queue.read(cx).revision() != handle.queue_revision
            || self.queue.read(cx).is_importing()
            || *self.settings.read(cx).settings() != handle.settings
        {
            self.notice = Some(Notice::RestartNeeded);
            cx.notify();
            return;
        }
        self.notice = match progress_bridge::start_batch(
            decided.keys,
            decided.options,
            decided.concurrency,
            cx,
        ) {
            Ok(_) => None,
            Err(StartError::Empty) => Some(Notice::NothingToConvert),
            Err(StartError::Settling) => Some(Notice::AlreadyRunning),
            Err(StartError::Batch(error)) => Some(Notice::Failed(error.to_string())),
        };
        cx.notify();
    }

    /// A prompt was dismissed: nothing starts.
    pub(crate) fn start_aborted(&mut self, cx: &mut Context<Self>) {
        self.pending_start = None;
        self.planning = false;
        self.notice = None;
        cx.notify();
    }

    pub fn is_planning(&self) -> bool {
        self.planning
    }

    /// The transient notice of the last start attempt, translated now so a
    /// locale switch re-renders it.
    pub fn notice_text(&self) -> Option<SharedString> {
        self.notice.as_ref().map(Notice::text)
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

    /// Starts without the output-safety prompts (perf probe and tests): the
    /// persisted overwrite mode applies as is, so `ask` behaves like `skip`.
    fn start_into(&mut self, dir: PathBuf, format: String, cx: &mut Context<Self>) {
        let (keys, options, concurrency) = self.prepare_jobs(&dir, &format, cx);
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
}

impl Render for WorkflowPanel {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        v_flex()
            .id("workflow-panel")
            .test_support()
            .size_full()
            .min_h_0()
            .child(
                div()
                    .px_4()
                    .pt_4()
                    .pb_2()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(tr("settings.title")),
            )
            .child(
                v_flex()
                    .id("workflow-scroll")
                    .flex_1()
                    .min_h_0()
                    .px_4()
                    .pb_4()
                    .overflow_y_scrollbar()
                    .child(self.settings_form.clone()),
            )
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
/// folder and format chosen in the panel (see `shared::conversion`).
pub fn build_options(
    settings: &Settings,
    item: &QueueItem,
    out_dir: &Path,
    format: &str,
) -> ConvertOptions {
    options_for_item(
        settings,
        item,
        Some(&out_dir.to_string_lossy()),
        Some(format),
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
        let options = build_options(&settings, &item("/in/a.png"), Path::new("/out"), "webp");
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
        let supported = build_options(&settings, &item("/in/a.png"), Path::new("/out"), "webp");
        let unsupported = build_options(&settings, &item("/in/a.png"), Path::new("/out"), "jpeg");
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
