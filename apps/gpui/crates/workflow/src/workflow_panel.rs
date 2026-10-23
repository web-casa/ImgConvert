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

use gpui_kit::component::button::{Button, ButtonRounded, ButtonVariants as _};
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::component::{
    ActiveTheme as _, IconName, Sizable as _, WindowExt as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, AppContext as _, Context, Entity, FocusHandle, FontWeight, InteractiveElement as _,
    IntoElement, KeyDownEvent, ParentElement as _, Render, Role, ScrollHandle, SharedString,
    StatefulInteractiveElement as _, Styled as _, Subscription, TestSupportExt as _, Window, div,
    transparent_black,
};
use imgconvert_backend::convert::{self, ConvertOptions};
use imgconvert_backend::settings::Settings;
use imgconvert_gpui_shared::conversion::options_for_item;
use imgconvert_gpui_shared::file_prompt::{self, PromptKind};
use imgconvert_gpui_shared::i18n::{tr, tr_count, tr_with};
use imgconvert_gpui_shared::progress_bridge::{self, StartError};
use imgconvert_gpui_shared::tasks;
use imgconvert_gpui_shared::theme::ActiveGlass as _;
use imgconvert_gpui_shared::{AppModels, QueueItem, QueueModel, SettingsModel};

use crate::output_safety;
use crate::settings_form::{SettingsForm, SettingsTab};

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
            Self::PlanFailed(_detail) => tr("errors.outputSafetyCheckFailedGeneric"),
            Self::RestartNeeded => tr("safety.restart_needed"),
            Self::Failed(_detail) => tr("errors.batchFailed"),
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
    output_session_grant: Option<PathBuf>,
    /// The start waiting for its decisions, owned here so the panel can tear
    /// it down (the dialog callbacks only borrow it).
    pending_start: Option<PendingHandle>,
    notice: Option<Notice>,
    scroll: ScrollHandle,
    /// The settings tab list is one Tab stop; arrows switch tabs.
    tabs_focus: FocusHandle,
    _subscriptions: Vec<Subscription>,
}

/// A saved path is not a fresh sandbox grant. The picker must authorize this
/// exact directory again on platforms requiring a per-session selection.
fn output_grant_valid(required: bool, dir: &Path, granted: Option<&Path>) -> bool {
    !required || granted == Some(dir)
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
            output_session_grant: None,
            pending_start: None,
            notice: None,
            scroll: ScrollHandle::new(),
            tabs_focus: cx.focus_handle().tab_stop(true),
            _subscriptions: subscriptions,
        }
    }

    pub fn settings_form(&self) -> &Entity<SettingsForm> {
        &self.settings_form
    }

    /// Bring the format cards into view and focus them without changing any
    /// settings.
    pub fn focus_conversion_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.scroll.set_offset(gpui_kit::Point::default());
        if !self.settings_form.read(cx).is_busy(cx) {
            self.settings_form.update(cx, |form, cx| {
                form.focus_format(window, cx);
            });
        }
        cx.notify();
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
        self.output_session_grant = Some(dir.clone());
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
        let access = imgconvert_backend::access::runtime_file_access();
        if let Some(dir) = self.output_dir(cx).filter(|dir| {
            output_grant_valid(
                access.requires_output_directory_session_grant,
                dir,
                self.output_session_grant.as_deref(),
            )
        }) {
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
        let revision = self.queue.read(cx).conversion_revision();
        self.planning = true;
        let request = Rc::new(RefCell::new(None));
        self.pending_start = Some(PendingHandle {
            state: Rc::clone(&request),
            queue_revision: revision,
            settings,
        });
        self.notice = Some(Notice::Planning);
        cx.notify();
        let plan_options = options.clone();
        let protected_inputs: Vec<_> = self
            .queue
            .read(cx)
            .items()
            .iter()
            .map(|item| item.path.to_string())
            .collect();
        let planned = tasks::run_blocking("imgconvert-plan", cx, move || {
            convert::conversion_plan_with_protected_inputs(&plan_options, &protected_inputs)
        });
        cx.spawn_in(window, async move |this, cx| {
            let plan = planned.await;
            let _ = cx.update(|window, cx| {
                // Decide inside the entity, prompt outside it: `advance` may
                // call straight back into the panel when no prompt is needed.
                let next = this.update(cx, |panel, cx| {
                    let result = plan.map(|plan| {
                        output_safety::PendingStart::new(
                            keys,
                            options,
                            plan,
                            concurrency,
                            overwrite,
                        )
                    });
                    panel.finish_plan(&request, result, cx)
                });
                if let Ok(Some(pending)) = next {
                    output_safety::advance(this.clone(), pending, window, cx);
                }
            });
        })
        .detach();
    }

    /// Only the request that owns the current handle may publish or fail it.
    /// A stale worker may finish after a format edit and a second Start.
    fn finish_plan(
        &mut self,
        request: &Rc<RefCell<Option<output_safety::PendingStart>>>,
        result: Result<output_safety::PendingStart, String>,
        cx: &mut Context<Self>,
    ) -> Option<Rc<RefCell<Option<output_safety::PendingStart>>>> {
        let handle = self.pending_start.as_ref()?;
        if !Rc::ptr_eq(request, &handle.state) {
            return None;
        }
        match result {
            Ok(plan) => {
                *handle.state.borrow_mut() = Some(plan);
                Some(Rc::clone(&handle.state))
            }
            Err(detail) => {
                self.planning = false;
                self.pending_start = None;
                self.notice = Some(Notice::PlanFailed(detail));
                cx.notify();
                None
            }
        }
    }

    /// Drops a pending start when the jobs it planned no longer match the
    /// queue or the settings; an open prompt is closed.
    fn abort_pending_if_stale(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(handle) = self.pending_start.as_ref() else {
            return;
        };
        let stale = self.queue.read(cx).conversion_revision() != handle.queue_revision
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

    /// The jobs a batch would submit: unfinished queue items, in queue order.
    fn prepare_jobs(
        &self,
        dir: &Path,
        format: &str,
        cx: &App,
    ) -> (Vec<SharedString>, Vec<ConvertOptions>, Option<usize>) {
        let settings = self.settings.read(cx).settings().clone();
        let queue = self.queue.read(cx);
        let pending: Vec<_> = queue
            .items()
            .iter()
            .filter(|item| item.is_pending_conversion())
            .collect();
        let keys = pending.iter().map(|item| item.key.clone()).collect();
        let options = pending
            .into_iter()
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
        if self.queue.read(cx).conversion_revision() != handle.queue_revision
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

impl WorkflowPanel {
    /// Moves between tabs with the arrow, Home and End keys.
    fn tabs_key(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let tabs = SettingsTab::ALL;
        let current = self.settings_form.read(cx).active_tab();
        let index = tabs.iter().position(|tab| *tab == current).unwrap_or(0);
        let last = tabs.len() - 1;
        let next = match event.keystroke.key.as_str() {
            "left" => index.checked_sub(1).unwrap_or(last),
            "right" => (index + 1) % tabs.len(),
            "home" => 0,
            "end" => last,
            _ => return,
        };
        cx.stop_propagation();
        self.settings_form
            .update(cx, |form, cx| form.set_tab(tabs[next], cx));
    }

    /// The segmented tab bar over the settings. Kit's `Tab` takes no
    /// keyboard focus in 0.7.1, so the tab list is one Tab stop with its
    /// own focus handle (arrow, Home and End keys switch tabs) and each tab
    /// is a Button with the tab role and its selected state. A click also
    /// focuses the list, so focus never falls out of a tab that unmounts.
    fn render_tabs(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let form = self.settings_form.read(cx);
        let active = form.active_tab();
        let glass = cx.glass();
        let pill = ButtonRounded::Size(cx.theme().radius_full());
        let tabs: Vec<_> = SettingsTab::ALL
            .into_iter()
            .map(|tab| {
                let selected = tab == active;
                let title = tr(tab.title_key());
                let issue = form.tab_has_issue(tab, cx);
                let target = self.settings_form.downgrade();
                let list_focus = self.tabs_focus.clone();
                Button::new(tab.id())
                    .ghost()
                    .small()
                    .role(Role::Tab)
                    .tab_stop(false)
                    .rounded(pill)
                    .flex_1()
                    .min_w_0()
                    .toggled(selected)
                    .label(title.clone())
                    .when(issue, |button| {
                        button
                            .icon(IconName::TriangleAlert)
                            .accessibility_label(tr_with(
                                "settings.tab_has_issue",
                                &[("tab", &title)],
                            ))
                    })
                    .when(selected, |button| {
                        button
                            .bg(glass.chip_strong())
                            .shadow(glass.lift_shadows())
                            .font_weight(FontWeight::SEMIBOLD)
                    })
                    .on_click(move |_, window, cx| {
                        let _ = target.update(cx, |form, cx| form.set_tab(tab, cx));
                        window.focus(&list_focus, cx);
                    })
            })
            .collect();
        let ring = cx.theme().ring;
        h_flex()
            .id("settings-tabs")
            .test_support()
            .role(Role::TabList)
            .aria_label(tr("settings.title"))
            .track_focus(&self.tabs_focus)
            .border_1()
            .border_color(transparent_black())
            .focus_visible(move |style| style.border_color(ring))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                this.tabs_key(event, cx);
            }))
            .p_0p5()
            .gap_0p5()
            .rounded(cx.theme().radius_full())
            .bg(glass.chip())
            .children(tabs)
    }
}

impl Render for WorkflowPanel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let queue = self.queue.read(cx);
        let (animated, unknown) = queue.animation_counts();
        let count = queue
            .items()
            .iter()
            .filter(|item| item.is_pending_conversion())
            .count();
        let summary = tr_count(
            "workflow.animation_summary",
            "count",
            count,
            &[("animated", &animated), ("unknown", &unknown)],
        );
        v_flex()
            .id("workflow-panel")
            .test_support()
            .size_full()
            .min_h_0()
            .child(div().px_4().pt_4().pb_3().child(self.render_tabs(cx)))
            .children((animated + unknown > 0).then(|| {
                div()
                    .id("workflow-animation-check")
                    .test_support()
                    .aria_label(summary.clone())
                    .text_xs()
                    .px_4()
                    .pb_2()
                    .child(summary)
            }))
            .child(
                v_flex()
                    .id("workflow-scroll")
                    .test_support()
                    .track_scroll(&self.scroll)
                    .flex_1()
                    .min_h_0()
                    .px_4()
                    .pb_4()
                    .overflow_y_scroll()
                    .vertical_scrollbar(&self.scroll)
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
    #[test]
    fn persisted_output_path_does_not_grant_session_access() {
        use super::output_grant_valid;
        use std::path::Path;
        let dir = Path::new("/chosen");
        assert!(!output_grant_valid(true, dir, None));
        assert!(!output_grant_valid(true, dir, Some(Path::new("/other"))));
        assert!(output_grant_valid(true, dir, Some(dir)));
        assert!(output_grant_valid(false, dir, None));
    }

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
    fn mixed_formats_plan_the_overridden_extension_and_queued_source_conflict() {
        let dir = std::env::temp_dir().join(format!("imgconvert-s10-plan-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("source.png");
        let jpeg = dir.join("source.jpg");
        std::fs::write(&png, b"path planning does not decode").unwrap();
        std::fs::write(&jpeg, b"queued source must be preserved").unwrap();
        let mut first = item(&png.to_string_lossy());
        first.relative_dir = None;
        first.target_format = Some("jpeg".into());
        let second = item(&jpeg.to_string_lossy());
        let mut settings = Settings::default();
        settings.output_suffix_enabled = false;
        settings.result_cache = false;
        let jobs = [
            build_options(&settings, &first, &dir, "webp"),
            build_options(&settings, &second, &dir, "webp"),
        ];
        let plan = convert::conversion_plan(&jobs);
        assert!(plan[0].error.is_none(), "{:?}", plan[0].error);
        assert_eq!(
            plan[0].output.as_deref(),
            Some(jpeg.to_string_lossy().as_ref())
        );
        assert!(plan[0].conflicts_with_queued_input);
        assert_eq!(jobs[1].format, "webp");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[gpui_kit::test]
    fn superseded_plan_success_and_failure_cannot_overwrite_the_next_request(
        cx: &mut gpui_kit::TestAppContext,
    ) {
        cx.update(|cx| {
            imgconvert_gpui_shared::services::init_with_settings(cx, || {
                SettingsModel::in_memory(Settings::default())
            });
            gpui_kit::init(cx);
            // The panel paints with the product's glass tokens, as in the app.
            imgconvert_gpui_shared::theme::install(cx);
            let (_, panel) =
                gpui_kit::open_window(gpui_kit::WindowOptions::default(), cx, |window, cx| {
                    cx.new(|cx| WorkflowPanel::new(window, cx))
                })
                .unwrap();
            panel.update(cx, |panel, cx| {
                let old = Rc::new(RefCell::new(None));
                let current = Rc::new(RefCell::new(None));
                panel.planning = true;
                panel.pending_start = Some(PendingHandle {
                    state: current.clone(),
                    queue_revision: 2,
                    settings: Settings::default(),
                });
                let plan = || {
                    output_safety::PendingStart::new(
                        vec![],
                        vec![],
                        vec![],
                        None,
                        imgconvert_backend::settings::OverwriteMode::Skip,
                    )
                };
                assert!(panel.finish_plan(&old, Ok(plan()), cx).is_none());
                assert!(current.borrow().is_none());
                assert!(
                    panel
                        .finish_plan(&old, Err("obsolete error".into()), cx)
                        .is_none()
                );
                assert!(panel.planning);
                assert!(panel.notice.is_none());
                assert!(Rc::ptr_eq(
                    &panel.finish_plan(&current, Ok(plan()), cx).unwrap(),
                    &current
                ));
                assert!(current.borrow().is_some());
            });
        });
    }

    #[test]
    fn writable_formats_exclude_heic_and_pdf() {
        let formats = writable_formats();
        assert!(formats.iter().any(|format| format.as_ref() == "webp"));
        assert!(!formats.iter().any(|format| format.as_ref() == "heic"));
        assert!(!formats.iter().any(|format| format.as_ref() == "pdf"));
    }
}
