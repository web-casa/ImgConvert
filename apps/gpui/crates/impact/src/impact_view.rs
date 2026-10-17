// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The scenario dialog's content. Parameters live only in this entity, which
//! the dialog owns: closing it resets them, nothing is saved or uploaded.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::collapsible::Collapsible;
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::link::Link;
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::component::select::{Select, SelectEvent};
use gpui_kit::component::{
    ActiveTheme as _, Icon, IconName, Sizable as _, WindowExt as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    AnyElement, App, AppContext as _, Context, Div, Entity, FontWeight, InteractiveElement as _,
    IntoElement, ParentElement as _, Render, SharedString, StatefulInteractiveElement as _,
    Styled as _, Subscription, TestSupportExt as _, Window, div,
};
use imgconvert_backend::environmental_impact::{
    self as model, ByteReductionMeasurement, ConversionImpactResult, DEFAULT_RETENTION_DAYS,
    ImpactQuantity, ReplacementStatus, STORAGE_IMPACT_MODEL_V1, UnavailableReason,
};
use imgconvert_gpui_shared::choice::{Choice, ChoiceItem};
use imgconvert_gpui_shared::i18n::{Locale, tr, tr_with};
use imgconvert_gpui_shared::{AppModels, ItemStatus, QueueModel};

/// What the dialog describes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImpactSubject {
    /// One finished queue item, by its stable key.
    Item(SharedString),
    /// Every comparable finished item of the queue, net.
    Batch,
}

/// The scenario's answer for the current parameters.
#[derive(Debug, Clone, PartialEq)]
pub enum ScenarioOutcome {
    /// Energy and carbon ranges, already formatted with their unit.
    Estimate {
        energy: String,
        carbon: String,
    },
    Unavailable(UnavailableReason),
    /// The days field is not a whole number in range.
    Invalid,
}

/// The measured facts the scenario starts from.
#[derive(Debug, Clone, PartialEq)]
struct Measured {
    measurement: ByteReductionMeasurement,
    comparable: bool,
    /// For a batch: eligible results and other finished results excluded.
    batch: Option<(usize, usize)>,
}

const STORAGE_LOCAL: &str = "local";
const STORAGE_CLOUD: &str = "cloud";

pub struct ImpactView {
    subject: ImpactSubject,
    queue: Entity<QueueModel>,
    locale: Locale,
    cloud: bool,
    replacement: ReplacementStatus,
    days_text: String,
    copies: u8,
    method_open: bool,
    storage: Choice,
    originals: Choice,
    copies_choice: Choice,
    days: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}

impl ImpactView {
    pub fn new(subject: ImpactSubject, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let models = AppModels::global(cx).clone();
        let storage = Choice::new(storage_items(), STORAGE_LOCAL, window, cx);
        let originals = Choice::new(
            originals_items(),
            ReplacementStatus::Hypothetical.as_str(),
            window,
            cx,
        );
        let copies_choice = Choice::new(copies_items(), "0", window, cx);
        let days = cx.new(|cx| {
            InputState::new(window, cx).default_value(DEFAULT_RETENTION_DAYS.to_string())
        });
        let subscriptions = vec![
            cx.observe(models.queue(), |_, _, cx| cx.notify()),
            cx.subscribe(
                storage.state(),
                |this, _, event: &SelectEvent<Vec<ChoiceItem>>, cx| {
                    let SelectEvent::Confirm(value) = event;
                    if let Some(id) = value.as_deref() {
                        this.cloud = id == STORAGE_CLOUD;
                        cx.notify();
                    }
                },
            ),
            cx.subscribe(
                originals.state(),
                |this, _, event: &SelectEvent<Vec<ChoiceItem>>, cx| {
                    let SelectEvent::Confirm(value) = event;
                    if let Some(status) = value.as_deref().and_then(ReplacementStatus::parse) {
                        this.replacement = status;
                        cx.notify();
                    }
                },
            ),
            cx.subscribe(
                copies_choice.state(),
                |this, _, event: &SelectEvent<Vec<ChoiceItem>>, cx| {
                    let SelectEvent::Confirm(value) = event;
                    if let Some(copies) = value.as_deref().and_then(|id| id.parse::<u8>().ok()) {
                        this.copies = copies;
                        cx.notify();
                    }
                },
            ),
            cx.subscribe(&days, |this, state, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) {
                    this.days_text = state.read(cx).value().to_string();
                    cx.notify();
                }
            }),
        ];
        Self {
            subject,
            queue: models.queue().clone(),
            locale: Locale::current(),
            cloud: false,
            replacement: ReplacementStatus::Hypothetical,
            days_text: DEFAULT_RETENTION_DAYS.to_string(),
            copies: 0,
            method_open: false,
            storage,
            originals,
            copies_choice,
            days,
            _subscriptions: subscriptions,
        }
    }

    pub fn subject(&self) -> &ImpactSubject {
        &self.subject
    }

    /// Whether the subject has a comparable measurement to put in a scenario.
    pub fn is_comparable(&self, cx: &App) -> bool {
        self.measured(cx)
            .is_some_and(|measured| measured.comparable)
    }

    /// For a batch subject: `(eligible, excluded)` finished results.
    pub fn batch_counts(&self, cx: &App) -> Option<(usize, usize)> {
        self.measured(cx).and_then(|measured| measured.batch)
    }

    /// The scenario's answer; `None` while the local (bytes only) scenario
    /// is selected or nothing is comparable.
    pub fn outcome(&self, cx: &App) -> Option<ScenarioOutcome> {
        if !self.cloud {
            return None;
        }
        let measured = self.measured(cx)?;
        if !measured.comparable {
            return None;
        }
        let Some(days) = model::parse_scenario_days(&self.days_text) else {
            return Some(ScenarioOutcome::Invalid);
        };
        let Ok(assumptions) = model::scenario_assumptions(days, self.copies) else {
            return Some(ScenarioOutcome::Invalid);
        };
        let result = model::calculate_conversion_impact(
            true,
            measured.measurement.input_bytes,
            measured.measurement.output_bytes,
            self.replacement,
            assumptions,
        );
        Some(match result {
            Ok(ConversionImpactResult::Estimate { estimate, .. }) => {
                let energy =
                    model::format_impact_range(estimate.energy_watt_hours, ImpactQuantity::Energy);
                let carbon =
                    model::format_impact_range(estimate.carbon_grams_co2, ImpactQuantity::Carbon);
                match (energy, carbon) {
                    (Ok(energy), Ok(carbon)) => ScenarioOutcome::Estimate { energy, carbon },
                    _ => ScenarioOutcome::Invalid,
                }
            }
            Ok(ConversionImpactResult::Unavailable { reason, .. }) => {
                ScenarioOutcome::Unavailable(reason)
            }
            Err(_) => ScenarioOutcome::Invalid,
        })
    }

    // ---- parameter setters (the controls' handlers and tests) ----

    pub fn set_cloud(&mut self, cloud: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.cloud = cloud;
        let id = if cloud { STORAGE_CLOUD } else { STORAGE_LOCAL };
        self.storage.sync(storage_items(), id, window, cx);
        cx.notify();
    }

    pub fn set_replacement(
        &mut self,
        replacement: ReplacementStatus,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.replacement = replacement;
        self.originals
            .sync(originals_items(), replacement.as_str(), window, cx);
        cx.notify();
    }

    pub fn set_days(&mut self, text: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.days_text = text.to_string();
        let text = text.to_string();
        self.days
            .update(cx, |state, cx| state.set_value(text, window, cx));
        cx.notify();
    }

    /// `0` keeps the model's 1–3 range; 1–3 fixes the copy count.
    pub fn set_copies(&mut self, copies: u8, window: &mut Window, cx: &mut Context<Self>) {
        self.copies = copies.min(3);
        self.copies_choice
            .sync(copies_items(), &self.copies.to_string(), window, cx);
        cx.notify();
    }

    fn measured(&self, cx: &App) -> Option<Measured> {
        let queue = self.queue.read(cx);
        match &self.subject {
            ImpactSubject::Item(key) => {
                let item = queue.item(key)?;
                let ItemStatus::Done {
                    in_size,
                    out_size,
                    comparable,
                } = item.status
                else {
                    return None;
                };
                let measurement = model::measure_byte_reduction(in_size, out_size).ok()?;
                Some(Measured {
                    measurement,
                    comparable,
                    batch: None,
                })
            }
            ImpactSubject::Batch => {
                let (eligible, done) = batch_pairs(queue);
                let (measurement, count) = model::summarize_measurements(eligible).ok()??;
                Some(Measured {
                    measurement,
                    comparable: true,
                    batch: Some((count, done - count)),
                })
            }
        }
    }

    /// Rebuilds the translated option labels after a locale switch.
    fn sync_locale(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.locale == Locale::current() {
            return;
        }
        self.locale = Locale::current();
        let storage = if self.cloud {
            STORAGE_CLOUD
        } else {
            STORAGE_LOCAL
        };
        self.storage.sync(storage_items(), storage, window, cx);
        self.originals
            .sync(originals_items(), self.replacement.as_str(), window, cx);
        self.copies_choice
            .sync(copies_items(), &self.copies.to_string(), window, cx);
    }

    // ---- rendering ----

    fn paragraph(text: SharedString, cx: &App) -> Div {
        div()
            .text_xs()
            .text_color(cx.theme().muted_foreground)
            .child(text)
    }

    fn field_label(text: SharedString, cx: &App) -> Div {
        div()
            .text_xs()
            .text_color(cx.theme().muted_foreground)
            .child(text)
    }

    fn render_measurement(measured: &Measured, _: &App) -> impl IntoElement {
        let difference = measured.measurement.byte_difference;
        let bytes = model::format_binary_bytes(difference.unsigned_abs());
        let text = match difference {
            d if d > 0 => tr_with("impact.smaller", &[("bytes", &bytes)]),
            d if d < 0 => tr_with("impact.larger", &[("bytes", &bytes)]),
            _ => tr("impact.same"),
        };
        div()
            .id("impact-measurement")
            .test_support()
            .aria_label(text.clone())
            .text_sm()
            .font_weight(FontWeight::SEMIBOLD)
            .child(text)
    }

    fn render_scenario(&self, cx: &mut Context<Self>) -> Div {
        let muted = cx.theme().muted_foreground;
        v_flex()
            .gap_3()
            .child(
                v_flex()
                    .gap_1()
                    .child(Self::field_label(tr("impact.storage"), cx))
                    .child(
                        Select::new(self.storage.state())
                            .id("impact-storage")
                            .small()
                            .accessibility_label(tr("impact.storage")),
                    ),
            )
            .when(self.cloud, |this| {
                this.child(
                    v_flex()
                        .gap_1()
                        .child(Self::field_label(tr("impact.originals"), cx))
                        .child(
                            Select::new(self.originals.state())
                                .id("impact-originals")
                                .small()
                                .accessibility_label(tr("impact.originals")),
                        ),
                )
                .child(
                    h_flex()
                        .gap_3()
                        .items_start()
                        .child(
                            v_flex()
                                .flex_1()
                                .min_w_0()
                                .gap_1()
                                .child(Self::field_label(tr("impact.days"), cx))
                                .child(
                                    Input::new(&self.days)
                                        .id("impact-days")
                                        .small()
                                        .aria_label(tr("impact.days")),
                                ),
                        )
                        .child(
                            v_flex()
                                .flex_1()
                                .min_w_0()
                                .gap_1()
                                .child(Self::field_label(tr("impact.copies"), cx))
                                .child(
                                    Select::new(self.copies_choice.state())
                                        .id("impact-copies")
                                        .small()
                                        .accessibility_label(tr("impact.copies")),
                                ),
                        ),
                )
                .children(self.render_outcome(cx))
                .child(Self::paragraph(tr("impact.limits"), cx).text_color(muted))
            })
    }

    fn render_outcome(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let outcome = self.outcome(cx)?;
        let (text, danger): (SharedString, bool) = match &outcome {
            ScenarioOutcome::Invalid => (tr("impact.invalid"), true),
            ScenarioOutcome::Unavailable(UnavailableReason::OriginalRetained) => {
                (tr("impact.retained_notice"), false)
            }
            ScenarioOutcome::Unavailable(_) => (tr("impact.no_reduction"), false),
            ScenarioOutcome::Estimate { energy, carbon } => {
                (format!("{energy} · {carbon}").into(), false)
            }
        };
        let is_estimate = matches!(outcome, ScenarioOutcome::Estimate { .. });
        Some(
            v_flex()
                .id("impact-result")
                .test_support()
                .aria_label(text.clone())
                .gap_0p5()
                .p_3()
                .rounded(cx.theme().radius)
                .bg(cx.theme().muted)
                .when(is_estimate, |this| {
                    this.child(
                        div()
                            .text_xs()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(tr("impact.estimate")),
                    )
                })
                .child(
                    div()
                        .text_sm()
                        .when(danger, |this| this.text_color(cx.theme().danger))
                        .child(text),
                )
                .into_any_element(),
        )
    }

    fn render_method(&self, cx: &mut Context<Self>) -> Div {
        let open = self.method_open;
        let chevron = if open {
            IconName::ChevronDown
        } else {
            IconName::ChevronRight
        };
        let sources = STORAGE_IMPACT_MODEL_V1.sources.iter().map(|source| {
            v_flex()
                .gap_0p5()
                .child(div().text_xs().child(source.title))
                .child(
                    Link::new(SharedString::from(format!("impact-source-{}", source.id)))
                        .href(source.url)
                        .text_xs()
                        .child(source.url),
                )
        });
        v_flex()
            .rounded(cx.theme().radius)
            .border_1()
            .border_color(cx.theme().border)
            .child(
                Button::new("impact-method")
                    .ghost()
                    .w_full()
                    .accessibility_label(tr("impact.method"))
                    .child(
                        h_flex()
                            .w_full()
                            .gap_2()
                            .items_center()
                            .child(Icon::new(chevron).xsmall())
                            .child(div().text_sm().child(tr("impact.method"))),
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.method_open = !this.method_open;
                        cx.notify();
                    })),
            )
            .child(
                Collapsible::new()
                    .open(open)
                    .motion_id("impact-method-body")
                    .content(
                        v_flex()
                            .px_3()
                            .pb_3()
                            .pt_1()
                            .gap_2()
                            .child(Self::paragraph(tr("impact.formula"), cx))
                            .child(Self::paragraph(tr("impact.privacy"), cx))
                            .children(sources),
                    ),
            )
    }
}

impl Render for ImpactView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_locale(window, cx);
        let measured = self.measured(cx);
        // The dialog's own height bound; the body scrolls beyond it.
        let max_height = window.viewport_size().height * 0.7;
        // The observed root stays outside the scroll wrapper so tests can
        // find it; the scrolling happens in the inner column.
        v_flex().id("impact-view").test_support().child(
            v_flex()
                .id("impact-scroll")
                .max_h(max_height)
                .overflow_y_scrollbar()
                .gap_3()
                .pr_2()
                .children(measured.as_ref().and_then(|measured| measured.batch).map(
                    |(count, excluded)| {
                        Self::paragraph(
                            tr_with(
                                "impact.batch",
                                &[("count", &count), ("excluded", &excluded)],
                            ),
                            cx,
                        )
                    },
                ))
                .children(
                    measured
                        .as_ref()
                        .map(|measured| Self::render_measurement(measured, cx)),
                )
                .child(Self::paragraph(tr("impact.boundary"), cx))
                .map(|this| {
                    if measured
                        .as_ref()
                        .is_some_and(|measured| measured.comparable)
                    {
                        this.child(self.render_scenario(cx))
                    } else {
                        this.child(
                            div()
                                .id("impact-excluded")
                                .test_support()
                                .aria_label(tr("impact.excluded"))
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child(tr("impact.excluded")),
                        )
                    }
                })
                .child(self.render_method(cx)),
        )
    }
}

/// `(eligible (in, out) pairs, finished count)` of the queue.
fn batch_pairs(queue: &QueueModel) -> (Vec<(u64, u64)>, usize) {
    let mut eligible = Vec::new();
    let mut done = 0usize;
    for item in queue.items() {
        if let ItemStatus::Done {
            in_size,
            out_size,
            comparable,
        } = item.status
        {
            done += 1;
            if comparable {
                eligible.push((in_size, out_size));
            }
        }
    }
    (eligible, done)
}

/// Whether the batch scenario has anything to show: at least one comparable
/// finished result.
pub fn batch_has_comparable_results(queue: &QueueModel) -> bool {
    !batch_pairs(queue).0.is_empty()
}

fn storage_items() -> Vec<ChoiceItem> {
    vec![
        ChoiceItem::new(STORAGE_LOCAL, tr("impact.local")),
        ChoiceItem::new(STORAGE_CLOUD, tr("impact.cloud")),
    ]
}

fn originals_items() -> Vec<ChoiceItem> {
    ReplacementStatus::ALL
        .into_iter()
        .map(|status| {
            ChoiceItem::new(
                status.as_str(),
                tr(match status {
                    ReplacementStatus::Hypothetical => "impact.hypothetical",
                    ReplacementStatus::Confirmed => "impact.confirmed",
                    ReplacementStatus::Retained => "impact.retained",
                }),
            )
        })
        .collect()
}

fn copies_items() -> Vec<ChoiceItem> {
    let mut items = vec![ChoiceItem::new("0", tr("impact.copies_default"))];
    items.extend((1..=3u8).map(|n| ChoiceItem::new(n.to_string(), n.to_string())));
    items
}

/// Opens the scenario dialog for `subject`. The entity lives as long as the
/// dialog; closing it drops the parameters.
pub fn open_environmental_impact(
    subject: ImpactSubject,
    window: &mut Window,
    cx: &mut App,
) -> Entity<ImpactView> {
    let view = cx.new(|cx| ImpactView::new(subject, window, cx));
    let for_content = view.clone();
    window.open_dialog(cx, move |dialog, window, _| {
        let content_entity = for_content.clone();
        dialog
            .title(tr("impact.title"))
            // Kit dialogs take pixels; follow the rem scale by hand.
            .w(window.rem_size() * 35.)
            .content(move |content, _, _| content.child(content_entity.clone()))
            .footer(
                h_flex().justify_end().child(
                    Button::new("impact-close")
                        .label(tr("impact.close"))
                        .on_click(|_, window, cx| window.close_dialog(cx)),
                ),
            )
    });
    view
}

#[cfg(test)]
mod tests {
    use super::*;
    use imgconvert_backend::convert::BatchProgressEvent;
    use imgconvert_backend::convert::ConvertResult;
    use imgconvert_backend::import::ImportScanFile;

    fn finished(
        index: usize,
        in_size: u64,
        out_size: u64,
        comparable: bool,
        outputs: usize,
    ) -> BatchProgressEvent {
        BatchProgressEvent::FileFinished {
            index,
            result: ConvertResult {
                input: format!("/in/{index}.png"),
                output: format!("/out/{index}.webp"),
                in_size,
                environment_comparable: comparable,
                out_size,
                warning: None,
                warnings: Vec::new(),
                output_count: outputs,
                skipped_output_count: 0,
            },
        }
    }

    #[test]
    fn batch_pairs_net_comparable_results_and_count_the_rest_as_excluded() {
        let mut queue = QueueModel::default();
        queue.add_files(
            ["a", "b", "c", "d"]
                .into_iter()
                .map(|key| ImportScanFile {
                    path: format!("/in/{key}.png"),
                    key: key.to_string(),
                    relative_dir: None,
                    metadata: None,
                })
                .collect(),
        );
        let jobs = queue.keys();
        queue.apply_batch_event(&finished(0, 1000, 100, true, 1), &jobs);
        queue.apply_batch_event(&finished(1, 100, 1200, true, 1), &jobs);
        // A document with several outputs and a non-comparable raster.
        queue.apply_batch_event(&finished(2, 5000, 10, true, 3), &jobs);
        queue.apply_batch_event(&finished(3, 5000, 10, false, 1), &jobs);
        let (eligible, done) = batch_pairs(&queue);
        assert_eq!(eligible, vec![(1000, 100), (100, 1200)]);
        assert_eq!(done, 4);
        assert!(batch_has_comparable_results(&queue));
        let (measurement, count) = model::summarize_measurements(eligible).unwrap().unwrap();
        assert_eq!(count, 2);
        assert_eq!(measurement.byte_difference, -200);
        assert_eq!(measurement.saved_bytes, 0);
    }
}
