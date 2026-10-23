// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The floating action capsule: the window's one decision (Start / Cancel)
//! with the output folder and the batch status beside it. The shell places it
//! at the foot of the queue panel; the behaviour stays in [`WorkflowPanel`],
//! which the bar drives and observes.

use gpui_kit::component::button::{Button, ButtonRounded, ButtonVariants};
use gpui_kit::component::progress::Progress;
use gpui_kit::component::tooltip::Tooltip;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, IconName, Sizable as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, Context, Entity, EventEmitter, FontWeight, InteractiveElement as _, IntoElement, Live,
    ParentElement as _, Render, SharedString, StatefulInteractiveElement as _, Styled as _,
    Subscription, TestSupportExt as _, Window, div,
};
use imgconvert_backend::progress::BatchId;
use imgconvert_gpui_shared::i18n::{tr, tr_count, tr_with};
use imgconvert_gpui_shared::theme::{ActiveGlass as _, GlassStyled as _};
use imgconvert_gpui_shared::{
    AppModels, BatchModel, BatchPhase, ItemStatus, QueueItem, QueueModel, SettingsModel,
    progress_bridge,
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

/// Window width, in rem, below which the capsule drops its secondary labels.
pub const COMPACT_WIDTH_REM: f32 = 66.;

pub struct ActionBar {
    panel: Entity<WorkflowPanel>,
    queue: Entity<QueueModel>,
    batch: Entity<BatchModel>,
    settings: Entity<SettingsModel>,
    /// The milestone already announced, and an announcement waiting to be
    /// put in the accessibility tree for one frame.
    announced: Announced,
    announcement: Option<(SharedString, Live)>,
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
        // What is already the case when the bar appears is not news.
        let batch = models.batch().read(cx);
        let announced = Announced {
            milestone: (batch.id(), Milestone::of(batch.phase())),
            settings_error: models
                .settings()
                .read(cx)
                .last_error()
                .map(SharedString::from),
        };
        Self {
            panel,
            queue: models.queue().clone(),
            batch: models.batch().clone(),
            settings: models.settings().clone(),
            announced,
            announcement: None,
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
        if let Some(text) = self.batch_text(cx) {
            let failed = matches!(self.batch.read(cx).phase(), BatchPhase::Failed(_));
            return (text, failed);
        }
        if let Some(notice) = self.panel.read(cx).notice_text() {
            return (notice, false);
        }
        let count = self.queue.read(cx).len();
        if count == 0 {
            (tr("workflow.ready_empty"), false)
        } else {
            (tr_count("workflow.ready", "count", count, &[]), false)
        }
    }

    /// The batch's part of the status line; `None` while no batch has run.
    fn batch_text(&self, cx: &App) -> Option<SharedString> {
        let batch = self.batch.read(cx);
        Some(match batch.phase() {
            BatchPhase::Idle => return None,
            BatchPhase::Running | BatchPhase::Cancelling => tr_with(
                "workflow.progress",
                &[("done", &batch.finished_count()), ("total", &batch.total())],
            ),
            BatchPhase::Finished(summary) if summary.cancelled => tr_with(
                "workflow.summary_cancelled",
                &[("done", &summary.completed), ("total", &summary.total)],
            ),
            BatchPhase::Finished(summary) => {
                // Zero skipped or failed counts are left out: the capsule has
                // room for what happened, not for what did not.
                let mut parts = vec![tr_with(
                    "workflow.summary_done",
                    &[("count", &summary.completed)],
                )];
                if summary.skipped > 0 {
                    parts.push(tr_with(
                        "workflow.summary_skipped",
                        &[("count", &summary.skipped)],
                    ));
                }
                if summary.failed > 0 {
                    parts.push(tr_with(
                        "workflow.summary_failed",
                        &[("count", &summary.failed)],
                    ));
                }
                let counts: SharedString = parts
                    .iter()
                    .map(SharedString::as_ref)
                    .collect::<Vec<_>>()
                    .join(" · ")
                    .into();
                match net_saving(self.queue.read(cx).items(), batch.jobs()) {
                    Some(saved) => tr_with(
                        "workflow.summary_saved",
                        &[
                            ("summary", &counts),
                            (
                                "saved",
                                &imgconvert_gpui_shared::images::format_bytes(saved),
                            ),
                        ],
                    ),
                    None => counts,
                }
            }
            BatchPhase::Failed(_detail) => tr("errors.batchFailed"),
        })
    }

    /// Records the milestone the batch and settings are at, and when one
    /// was entered since the last render, queues its announcement. Only the
    /// moments that matter are announced, once each: a batch starting,
    /// being cancelled, finishing or failing, and a settings write failing.
    /// Progress, readiness and notices are not: a screen reader user reads
    /// them on the status line, whose accessible value is its visible text.
    fn track_announcement(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let batch = self.batch.read(cx);
        let milestone = (batch.id(), Milestone::of(batch.phase()));
        let total = batch.total();
        let error = self.settings.read(cx).last_error().map(SharedString::from);
        let mut parts = Vec::new();
        let mut live = Live::Polite;
        // A new or different settings error is news; one clearing is not.
        if error != self.announced.settings_error {
            self.announced.settings_error.clone_from(&error);
            if let Some(detail) = &error {
                parts.push(tr_with("settings.save_failed", &[("detail", detail)]));
                live = Live::Assertive;
            }
        }
        if milestone != self.announced.milestone {
            // A batch that began and ended between two renders was still
            // started: say so before its outcome.
            let new_batch = milestone.0.is_some() && milestone.0 != self.announced.milestone.0;
            if new_batch && !matches!(milestone.1, Milestone::Idle | Milestone::Running) {
                parts.push(tr_with("workflow.announce_started", &[("count", &total)]));
            }
            self.announced.milestone = milestone;
            let text = match milestone.1 {
                Milestone::Idle => None,
                Milestone::Running => {
                    Some(tr_with("workflow.announce_started", &[("count", &total)]))
                }
                Milestone::Cancelling => Some(tr("workflow.cancelling")),
                Milestone::Finished | Milestone::Failed => self.batch_text(cx),
            };
            if milestone.1 == Milestone::Failed {
                live = Live::Assertive;
            }
            parts.extend(text);
        }
        if parts.is_empty() {
            return;
        }
        let text: SharedString = parts
            .iter()
            .map(SharedString::as_ref)
            .collect::<Vec<_>>()
            .join(" ")
            .into();
        self.announcement = Some((text, live));
        // The node is announced when it enters the accessibility tree; it
        // leaves on the next frame, so the same words are announced again
        // the next time they are due rather than read as unchanged.
        cx.on_next_frame(window, |this, _, cx| {
            this.announcement = None;
            cx.notify();
        });
    }
}

/// Where a batch is, as far as announcements are concerned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Milestone {
    Idle,
    Running,
    Cancelling,
    Finished,
    Failed,
}

impl Milestone {
    fn of(phase: &BatchPhase) -> Self {
        match phase {
            BatchPhase::Idle => Self::Idle,
            BatchPhase::Running => Self::Running,
            BatchPhase::Cancelling => Self::Cancelling,
            BatchPhase::Finished(_) => Self::Finished,
            BatchPhase::Failed(_) => Self::Failed,
        }
    }
}

/// What the last announcement covered.
struct Announced {
    milestone: (Option<BatchId>, Milestone),
    settings_error: Option<SharedString>,
}

/// The net bytes this batch saved: finished rows of its own jobs whose
/// outputs were all written in this run (rows kept from an earlier batch and
/// partial multi-output rows have no saving to report). `None` when the
/// outputs did not shrink overall or the sum cannot be represented.
pub fn net_saving(items: &[QueueItem], jobs: &[SharedString]) -> Option<u64> {
    let mut before = 0u64;
    let mut after = 0u64;
    for item in items.iter().filter(|item| jobs.contains(&item.key)) {
        if let ItemStatus::Done {
            in_size,
            out_size,
            complete: true,
            ..
        } = item.status
        {
            before = before.checked_add(in_size)?;
            after = after.checked_add(out_size)?;
        }
    }
    before.checked_sub(after).filter(|saved| *saved > 0)
}

impl Render for ActionBar {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.track_announcement(window, cx);
        // The same breakpoint the shell uses to narrow the settings panel:
        // below it the capsule keeps only icons for its secondary commands,
        // with their names on tooltips and in the accessibility tree.
        let compact = window.viewport_size().width < window.rem_size() * COMPACT_WIDTH_REM;
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
        // The capsule shows the folder and its parent; the full path is the
        // tooltip and the accessible name, so the batch status keeps room.
        let output_short: SharedString = output_dir.as_ref().map_or_else(
            || tr("workflow.output_not_chosen"),
            |dir| {
                let name = |path: &std::path::Path| {
                    path.file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                };
                match (dir.parent().and_then(&name), name(dir)) {
                    (Some(parent), Some(leaf)) => format!("{parent} / {leaf}").into(),
                    (None, Some(leaf)) => leaf.into(),
                    _ => SharedString::from(dir.to_string_lossy().into_owned()),
                }
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
        let glass = cx.glass();
        let pill = ButtonRounded::Size(cx.theme().radius_full());

        let announcement = self.announcement.clone();
        h_flex()
            .id("workflow-action-bar")
            .test_support()
            .relative()
            .glass_bar(cx)
            // A live region with no size: it is only ever heard. It exists for
            // the one frame an announcement needs (see `track_announcement`).
            .children(announcement.map(|(text, live)| {
                div()
                    .id("workflow-announcement")
                    .test_support()
                    .role(gpui_kit::Role::Status)
                    // macOS announces the value; Windows and Linux adapters
                    // announce a live region by its name.
                    .aria_label(text.clone())
                    .aria_value(text)
                    .aria_live(live)
                    .absolute()
                    .size_0()
                    .overflow_hidden()
            }))
            .w_full()
            .py_2()
            .pl_2()
            .pr_2()
            .gap_3()
            .items_center()
            .child(
                Button::new("workflow-choose-output")
                    .ghost()
                    .rounded(pill)
                    .h_12()
                    .max_w_64()
                    .min_w_0()
                    .flex_shrink(1.)
                    .pl_1p5()
                    .pr_4()
                    .bg(glass.chip())
                    .tooltip(output_path.clone())
                    .accessibility_label(choose_output_name)
                    .disabled(active)
                    .child(
                        h_flex()
                            .gap_2p5()
                            .items_center()
                            .min_w_0()
                            .child(
                                div()
                                    .size_9()
                                    .flex_none()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .rounded(cx.theme().radius_full())
                                    .bg(glass.chip_strong())
                                    .shadow(glass.lift_shadows())
                                    .child(
                                        gpui_kit::component::Icon::new(IconName::FolderOpen)
                                            .small(),
                                    ),
                            )
                            .child(
                                v_flex()
                                    .items_start()
                                    .min_w_0()
                                    // Narrow windows keep the folder name and
                                    // drop only its caption.
                                    .when(!compact, |this| {
                                        this.child(
                                            div()
                                                .text_xs()
                                                .text_color(muted)
                                                .child(tr("workflow.output_dir")),
                                        )
                                    })
                                    .child(
                                        div()
                                            .id("workflow-output-dir")
                                            .test_support()
                                            .aria_label(output_path.clone())
                                            .text_sm()
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .map(|this| {
                                                if compact {
                                                    this.max_w_24()
                                                } else {
                                                    this.max_w_48()
                                                }
                                            })
                                            .truncate()
                                            .child(output_short),
                                    ),
                            ),
                    )
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.panel
                            .update(cx, |panel, cx| panel.choose_output_dir(window, cx));
                    })),
            )
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap_1p5()
                    .child(
                        div()
                            .id("workflow-status")
                            .test_support()
                            .role(gpui_kit::Role::Label)
                            .aria_value(status_text.clone())
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
                        this.child(
                            Progress::new("workflow-progress")
                                .accessibility_label(tr("workflow.batch_progress"))
                                .value(percent),
                        )
                    }),
            )
            .when(batch_impact, |this| {
                this.child(
                    Button::new("workflow-impact")
                        .ghost()
                        .small()
                        .rounded(pill)
                        .map(|this| {
                            if compact {
                                this.icon(IconName::ChartPie)
                                    .accessibility_label(tr("impact.batch_open"))
                            } else {
                                this.label(tr("impact.batch_open"))
                            }
                        })
                        .tooltip(tr("impact.title"))
                        .on_click(cx.listener(|_, _, _, cx| {
                            cx.emit(ActionBarEvent::BatchImpact);
                        })),
                )
            })
            .child(if active {
                // Stopping keeps finished outputs, so it is not destructive:
                // a default button, not a danger one.
                Button::new("workflow-cancel")
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
                // Only an available Start is the window's default commit; a
                // disabled primary washes out to an unreadable tint.
                Button::new("workflow-start")
                    .when(can_start, ButtonVariants::primary)
                    .large()
                    .rounded(pill)
                    .px_6()
                    .label(start_label)
                    .disabled(!can_start)
                    .when(can_start, |this| this.shadow(glass.primary_shadows()))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.panel.update(cx, |panel, cx| panel.start(window, cx));
                    }))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use imgconvert_backend::import::ImportScanFile;
    use imgconvert_gpui_shared::QueueModel;

    fn queue(rows: &[(&str, ItemStatus)]) -> Vec<QueueItem> {
        let mut model = QueueModel::default();
        model.add_files(
            rows.iter()
                .map(|(key, _)| ImportScanFile {
                    key: (*key).into(),
                    path: format!("/no-real-data/{key}.png"),
                    relative_dir: None,
                    metadata: None,
                })
                .collect(),
        );
        let mut items = model.items().to_vec();
        for (item, (_, status)) in items.iter_mut().zip(rows) {
            item.status = status.clone();
        }
        items
    }

    fn done(in_size: u64, out_size: u64, complete: bool) -> ItemStatus {
        ItemStatus::Done {
            in_size,
            out_size,
            comparable: complete,
            complete,
        }
    }

    #[test]
    fn saving_counts_only_complete_rows_of_this_batch() {
        let items = queue(&[
            ("earlier", done(10_000_000, 0, true)),
            ("grew", done(1_000, 2_000, true)),
            ("shrank", done(5_000, 1_000, true)),
            ("partial-pdf", done(9_000, 100, false)),
            ("failed", ItemStatus::Pending),
        ]);
        let jobs: Vec<SharedString> = ["grew", "shrank", "partial-pdf", "failed"]
            .into_iter()
            .map(SharedString::from)
            .collect();
        // 6,000 in, 3,000 out: the earlier batch's row and the partial PDF
        // are not part of this batch's saving.
        assert_eq!(net_saving(&items, &jobs), Some(3_000));
    }

    #[test]
    fn no_saving_when_outputs_grow_are_equal_or_nothing_finished() {
        let jobs: Vec<SharedString> = vec!["a".into()];
        assert_eq!(net_saving(&queue(&[("a", done(1, 2, true))]), &jobs), None);
        assert_eq!(net_saving(&queue(&[("a", done(5, 5, true))]), &jobs), None);
        assert_eq!(
            net_saving(&queue(&[("a", ItemStatus::Pending)]), &jobs),
            None
        );
    }

    #[test]
    fn an_unrepresentable_sum_reports_no_saving() {
        let items = queue(&[("a", done(u64::MAX, 0, true)), ("b", done(1, 0, true))]);
        let jobs: Vec<SharedString> = vec!["a".into(), "b".into()];
        assert_eq!(net_saving(&items, &jobs), None);
    }
}
