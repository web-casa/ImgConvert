// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The floating action bar: the window's one decision (Start / Cancel) with
//! the output folder and the batch status beside it. The shell floats it
//! over the queue; the behaviour stays in [`WorkflowPanel`], which the bar
//! drives and observes.

use gpui_kit::component::button::{Button, ButtonRounded, ButtonVariants as _};
use gpui_kit::component::progress::Progress;
use gpui_kit::component::tooltip::Tooltip;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, IconName, Sizable as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, Context, Entity, EventEmitter, FontWeight, InteractiveElement as _, IntoElement,
    ParentElement as _, Render, SharedString, StatefulInteractiveElement as _, Styled as _,
    Subscription, TestSupportExt as _, Window, div,
};
use imgconvert_gpui_shared::i18n::{tr, tr_with};
use imgconvert_gpui_shared::theme::{ActiveGlass as _, GlassStyled as _};
use imgconvert_gpui_shared::{
    AppModels, BatchModel, BatchPhase, QueueModel, SettingsModel, progress_bridge,
};

use crate::workflow_panel::WorkflowPanel;

/// Commands the bar issues that another feature fulfils; the shell routes
/// them (feature crates never depend on each other).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActionBarEvent {
    /// Open the storage and environmental scenario for the finished batch.
    BatchImpact,
}

impl EventEmitter<ActionBarEvent> for ActionBar {}

pub struct ActionBar {
    panel: Entity<WorkflowPanel>,
    queue: Entity<QueueModel>,
    batch: Entity<BatchModel>,
    settings: Entity<SettingsModel>,
    _subscriptions: Vec<Subscription>,
}

impl ActionBar {
    pub fn new(panel: Entity<WorkflowPanel>, cx: &mut Context<Self>) -> Self {
        let models = AppModels::global(cx).clone();
        let subscriptions = vec![
            cx.observe(&panel, |_, _, cx| cx.notify()),
            cx.observe(models.queue(), |_, _, cx| cx.notify()),
            cx.observe(models.batch(), |_, _, cx| cx.notify()),
            cx.observe(models.settings(), |_, _, cx| cx.notify()),
        ];
        Self {
            panel,
            queue: models.queue().clone(),
            batch: models.batch().clone(),
            settings: models.settings().clone(),
            _subscriptions: subscriptions,
        }
    }

    pub fn panel(&self) -> &Entity<WorkflowPanel> {
        &self.panel
    }

    /// The status line: a failed settings write outranks everything (the
    /// person should know their choices are not being kept), then the
    /// batch, then the panel's transient notice, then readiness.
    fn status(&self, cx: &App) -> (SharedString, bool) {
        if let Some(detail) = self.settings.read(cx).last_error() {
            return (
                tr_with("settings.save_failed", &[("detail", &detail)]),
                true,
            );
        }
        let batch = self.batch.read(cx);
        let text = match batch.phase() {
            BatchPhase::Idle => {
                if let Some(notice) = self.panel.read(cx).notice_text() {
                    return (notice, false);
                }
                let count = self.queue.read(cx).len();
                return if count == 0 {
                    (tr("workflow.ready_empty"), false)
                } else {
                    (tr_with("workflow.ready", &[("count", &count)]), false)
                };
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
            BatchPhase::Failed(_detail) => tr("errors.batchFailed"),
        };
        (text, matches!(batch.phase(), BatchPhase::Failed(_)))
    }
}

impl Render for ActionBar {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let batch = self.batch.read(cx);
        let active = batch.is_active();
        let cancelling = matches!(batch.phase(), BatchPhase::Cancelling);
        let show_progress = active || matches!(batch.phase(), BatchPhase::Finished(_));
        let percent = batch.percent();
        let queue = self.queue.read(cx);
        let planning = self.panel.read(cx).is_planning();
        // The bridge may still be settling after the backend reported Finished.
        let can_start = queue
            .items()
            .iter()
            .any(imgconvert_gpui_shared::QueueItem::is_pending_conversion)
            && !queue.is_importing()
            && !active
            && !planning
            && !progress_bridge::is_busy(cx);
        let output_dir = self.panel.read(cx).output_dir(cx);
        // Starting without a chosen folder opens the picker first.
        let start_label = if output_dir.is_some() {
            tr("workflow.start")
        } else {
            tr("workflow.start_choose")
        };
        let output_path: SharedString = output_dir.as_ref().map_or_else(
            || tr("workflow.output_not_chosen"),
            |dir| SharedString::from(dir.to_string_lossy().into_owned()),
        );
        // The folder's own name; a root (`/`, a drive) has none and shows whole.
        let output_name: SharedString = output_dir.as_deref().map_or_else(
            || tr("workflow.output_not_chosen"),
            |dir| {
                SharedString::from(
                    dir.file_name()
                        .unwrap_or(dir.as_os_str())
                        .to_string_lossy()
                        .into_owned(),
                )
            },
        );
        let choose_output_name: SharedString =
            format!("{}: {output_path}", tr("workflow.choose_output")).into();
        let (status_text, status_danger) = self.status(cx);
        // A finished batch with comparable results can be put into the
        // storage scenario; the shell decides what "comparable" means.
        let batch_impact = matches!(batch.phase(), BatchPhase::Finished(_))
            && queue.items().iter().any(|item| {
                matches!(
                    item.status,
                    imgconvert_gpui_shared::ItemStatus::Done {
                        comparable: true,
                        ..
                    }
                )
            });
        let muted = cx.theme().muted_foreground;
        let pill = ButtonRounded::Size(cx.theme().radius_full());

        h_flex()
            .id("workflow-action-bar")
            .test_support()
            .glass_bar(cx)
            .p_1p5()
            .gap_3()
            .items_center()
            .child(
                Button::new("workflow-choose-output")
                    .ghost()
                    .rounded(pill)
                    .h_11()
                    .px_3()
                    .tooltip(output_path.clone())
                    .accessibility_label(choose_output_name)
                    .disabled(active)
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(gpui_kit::component::Icon::new(IconName::FolderOpen).small())
                            .child(
                                v_flex()
                                    .items_start()
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(muted)
                                            .child(tr("workflow.output_dir")),
                                    )
                                    .child(
                                        div()
                                            .id("workflow-output-dir")
                                            .test_support()
                                            .aria_label(output_path)
                                            .text_sm()
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .max_w_48()
                                            .truncate()
                                            .child(output_name),
                                    ),
                            ),
                    )
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.panel
                            .update(cx, |panel, cx| panel.choose_output_dir(window, cx));
                    })),
            )
            .child(div().w_px().h_8().bg(cx.theme().border))
            .child(
                v_flex()
                    .min_w_40()
                    .max_w_72()
                    .gap_0p5()
                    .child(
                        div()
                            .text_xs()
                            .text_color(muted)
                            .child(tr("workflow.status")),
                    )
                    .child(
                        div()
                            .id("workflow-status")
                            .test_support()
                            .aria_label(status_text.clone())
                            // Long errors and summaries truncate; the full
                            // text is one hover or focus away.
                            .tooltip({
                                let text = status_text.clone();
                                move |window, cx| Tooltip::new(text.clone()).build(window, cx)
                            })
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .when(status_danger, |this| this.text_color(cx.theme().danger))
                            .truncate()
                            .child(status_text),
                    )
                    .when(show_progress, |this| {
                        this.child(Progress::new("workflow-progress").value(percent))
                    }),
            )
            .when(batch_impact, |this| {
                this.child(
                    Button::new("workflow-impact")
                        .ghost()
                        .small()
                        .rounded(pill)
                        .label(tr("impact.batch_open"))
                        .tooltip(tr("impact.title"))
                        .on_click(cx.listener(|_, _, _, cx| {
                            cx.emit(ActionBarEvent::BatchImpact);
                        })),
                )
            })
            .child(if active {
                Button::new("workflow-cancel")
                    .danger()
                    .large()
                    .rounded(pill)
                    .px_6()
                    .label(if cancelling {
                        tr("workflow.cancelling")
                    } else {
                        tr("workflow.cancel")
                    })
                    .disabled(cancelling)
                    .loading(cancelling)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.panel.update(cx, WorkflowPanel::cancel);
                    }))
            } else {
                Button::new("workflow-start")
                    .primary()
                    .large()
                    .rounded(pill)
                    .px_6()
                    .label(start_label)
                    .disabled(!can_start)
                    .when(can_start, |this| this.shadow(cx.glass().primary_shadows()))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.panel.update(cx, |panel, cx| panel.start(window, cx));
                    }))
            })
    }
}
