// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The decisions a batch needs before it starts (port of the Svelte
//! `applyOutputSafetyDecisions`): the backend plans every output path, then
//!
//! 1. outputs that would replace *another* queued source are reported once
//!    and left unwritten (the person may continue with the rest);
//! 2. in the `ask` overwrite mode every existing output is confirmed one by
//!    one (overwrite or skip), replacing a source needing its own wording;
//! 3. otherwise outputs that are their own source are confirmed as a group
//!    (`skip` only informs; `overwrite` needs explicit consent, which also
//!    sets `allow_source_overwrite` for exactly those jobs).
//!
//! Each prompt is a Kit alert dialog; the flow resumes from its callbacks.
//! Nothing here touches the queue or writes a file.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gpui_kit::component::WindowExt as _;
use gpui_kit::component::button::ButtonVariant;
use gpui_kit::{App, SharedString, WeakEntity, Window};
use imgconvert_backend::convert::{ConversionPlanEntry, ConvertOptions};
use imgconvert_backend::settings::OverwriteMode;
use imgconvert_gpui_shared::a11y::dialog_title;
use imgconvert_gpui_shared::i18n::{tr, tr_with};
use imgconvert_gpui_shared::theme::GlassStyled as _;

use crate::workflow_panel::WorkflowPanel;

/// A batch waiting for its output-safety decisions.
#[derive(Debug)]
pub struct PendingStart {
    pub keys: Vec<SharedString>,
    pub options: Vec<ConvertOptions>,
    pub plan: Vec<ConversionPlanEntry>,
    pub concurrency: Option<usize>,
    pub overwrite: OverwriteMode,
    conflicts_acknowledged: bool,
    /// Next plan index the `ask` mode has to look at.
    ask_cursor: usize,
    source_collisions_decided: bool,
}

impl PendingStart {
    pub fn new(
        keys: Vec<SharedString>,
        options: Vec<ConvertOptions>,
        plan: Vec<ConversionPlanEntry>,
        concurrency: Option<usize>,
        overwrite: OverwriteMode,
    ) -> Self {
        Self {
            keys,
            options,
            plan,
            concurrency,
            overwrite,
            conflicts_acknowledged: false,
            ask_cursor: 0,
            source_collisions_decided: false,
        }
    }

    fn queued_input_conflicts(&self) -> usize {
        self.plan
            .iter()
            .filter(|entry| entry.error.is_none() && entry.conflicts_with_queued_input)
            .count()
    }

    fn source_collisions(&self) -> Vec<usize> {
        self.plan
            .iter()
            .filter(|entry| {
                entry.error.is_none() && entry.same_as_source && !entry.conflicts_with_queued_input
            })
            .map(|entry| entry.index)
            .collect()
    }

    fn set_decision(&mut self, index: usize, overwrite: bool, allow_source_overwrite: bool) {
        if let Some(options) = self.options.get_mut(index) {
            options.overwrite = overwrite;
            options.overwrite_mode = Some(if overwrite { "overwrite" } else { "skip" }.to_string());
            options.allow_source_overwrite = allow_source_overwrite;
        }
    }
}

/// Applies one answer to the pending decisions.
type Decision = Rc<dyn Fn(&mut PendingStart)>;

/// What the flow asks next.
enum Prompt {
    Conflicts {
        count: usize,
    },
    Ask {
        index: usize,
        same_as_source: bool,
        message: SharedString,
    },
    SourceSkip {
        count: usize,
    },
    SourceOverwrite {
        indexes: Vec<usize>,
    },
}

fn next_prompt(pending: &mut PendingStart) -> Option<Prompt> {
    if !pending.conflicts_acknowledged {
        pending.conflicts_acknowledged = true;
        let count = pending.queued_input_conflicts();
        if count > 0 {
            return Some(Prompt::Conflicts { count });
        }
    }
    if pending.overwrite == OverwriteMode::Ask {
        while pending.ask_cursor < pending.plan.len() {
            let entry = pending.plan[pending.ask_cursor].clone();
            pending.ask_cursor += 1;
            if entry.error.is_some() || entry.conflicts_with_queued_input {
                continue;
            }
            if !entry.exists {
                pending.set_decision(entry.index, false, false);
                continue;
            }
            let path = entry.output.clone().unwrap_or_else(|| entry.input.clone());
            let message = if entry.same_as_source {
                tr_with("safety.source_overwrite_single_message", &[("path", &path)])
            } else if entry.existing_output_count > 1 {
                tr_with(
                    "safety.pdf_outputs_exist",
                    &[("count", &entry.existing_output_count)],
                )
            } else {
                tr_with("safety.output_exists", &[("path", &path)])
            };
            return Some(Prompt::Ask {
                index: entry.index,
                same_as_source: entry.same_as_source,
                message,
            });
        }
        return None;
    }
    if !pending.source_collisions_decided {
        pending.source_collisions_decided = true;
        let indexes = pending.source_collisions();
        if !indexes.is_empty() {
            return Some(if pending.overwrite == OverwriteMode::Skip {
                Prompt::SourceSkip {
                    count: indexes.len(),
                }
            } else {
                Prompt::SourceOverwrite { indexes }
            });
        }
    }
    None
}

/// Shows the next prompt, or starts the batch when none is left. Callbacks
/// of a prompt call back into this function with the pending state.
pub fn advance(
    panel: WeakEntity<WorkflowPanel>,
    pending: Rc<RefCell<Option<PendingStart>>>,
    window: &mut Window,
    cx: &mut App,
) {
    let Some(mut state) = pending.borrow_mut().take() else {
        return;
    };
    let Some(prompt) = next_prompt(&mut state) else {
        let _ = panel.update(cx, |panel, cx| panel.start_decided(state, cx));
        return;
    };
    // `on_cancel` is the answer the second button gives; `None` means the
    // second button abandons the start.
    let (title, description, ok_text, ok_variant, cancel_text, on_ok, on_cancel): (
        SharedString,
        SharedString,
        SharedString,
        ButtonVariant,
        SharedString,
        Decision,
        Option<Decision>,
    ) = match prompt {
        Prompt::Conflicts { count } => (
            tr("safety.queued_input_conflict_title"),
            tr_with("safety.queued_input_conflict_message", &[("count", &count)]),
            tr("safety.continue_remaining"),
            ButtonVariant::Primary,
            tr("workflow.cancel"),
            Rc::new(|_| {}),
            None,
        ),
        Prompt::Ask {
            index,
            same_as_source,
            message,
        } => (
            if same_as_source {
                tr("safety.source_overwrite_title")
            } else {
                tr("safety.confirm_overwrite_title")
            },
            message,
            if same_as_source {
                tr("safety.source_overwrite")
            } else {
                tr("safety.overwrite")
            },
            ButtonVariant::Danger,
            tr("safety.skip"),
            Rc::new(move |state| state.set_decision(index, true, same_as_source)),
            // "Skip" is an answer, not an abort: the flow continues.
            Some(Rc::new(move |state| {
                state.set_decision(index, false, false);
            })),
        ),
        Prompt::SourceSkip { count } => (
            tr("safety.source_overwrite_title"),
            tr_with(
                "safety.source_overwrite_will_skip_message",
                &[("count", &count)],
            ),
            tr("safety.continue_conversion"),
            ButtonVariant::Primary,
            tr("workflow.cancel"),
            Rc::new(|_| {}),
            None,
        ),
        Prompt::SourceOverwrite { indexes } => (
            tr("safety.source_overwrite_title"),
            tr_with(
                "safety.source_overwrite_message",
                &[("count", &indexes.len())],
            ),
            tr("safety.source_overwrite"),
            ButtonVariant::Danger,
            tr("workflow.cancel"),
            Rc::new(move |state| {
                for index in &indexes {
                    state.set_decision(*index, true, true);
                }
            }),
            None,
        ),
    };
    // Kit routes Escape to the second button. Where that button is an answer
    // ("Skip") rather than an abort, Escape must not answer silently, so the
    // keyboard dismissal is off and only the buttons decide.
    let escape_closes = on_cancel.is_none();
    *pending.borrow_mut() = Some(state);

    // One answer per dialog: the close handler aborts only when neither
    // button answered (close button, Escape).
    let answered = Rc::new(Cell::new(false));
    window.open_alert_dialog(cx, move |dialog, _, cx| {
        let ok_panel = panel.clone();
        let ok_pending = Rc::clone(&pending);
        let ok_answered = Rc::clone(&answered);
        let ok_apply = Rc::clone(&on_ok);
        let cancel_panel = panel.clone();
        let cancel_pending = Rc::clone(&pending);
        let cancel_answered = Rc::clone(&answered);
        let cancel_apply = on_cancel.clone();
        let close_panel = panel.clone();
        let close_pending = Rc::clone(&pending);
        let close_answered = Rc::clone(&answered);
        dialog
            .glass_dialog(cx)
            .confirm()
            .keyboard(escape_closes)
            .title(dialog_title(title.clone()))
            .description(description.clone())
            .ok_text(ok_text.clone())
            .ok_variant(ok_variant)
            .cancel_text(cancel_text.clone())
            .on_ok(move |_, window, cx| {
                if ok_answered.replace(true) {
                    return true;
                }
                if let Some(state) = ok_pending.borrow_mut().as_mut() {
                    ok_apply(state);
                }
                let panel = ok_panel.clone();
                let pending = Rc::clone(&ok_pending);
                // Let this dialog close before the next one opens.
                window.defer(cx, move |window, cx| advance(panel, pending, window, cx));
                true
            })
            .on_cancel(move |_, window, cx| {
                if cancel_answered.replace(true) {
                    return true;
                }
                match &cancel_apply {
                    Some(apply) => {
                        if let Some(state) = cancel_pending.borrow_mut().as_mut() {
                            apply(state);
                        }
                        let panel = cancel_panel.clone();
                        let pending = Rc::clone(&cancel_pending);
                        window.defer(cx, move |window, cx| advance(panel, pending, window, cx));
                    }
                    None => abort(&cancel_panel, &cancel_pending, cx),
                }
                true
            })
            .on_close(move |_, _, cx| {
                if !close_answered.get() {
                    abort(&close_panel, &close_pending, cx);
                }
            })
    });
}

fn abort(
    panel: &WeakEntity<WorkflowPanel>,
    pending: &Rc<RefCell<Option<PendingStart>>>,
    cx: &mut App,
) {
    pending.borrow_mut().take();
    let _ = panel.update(cx, WorkflowPanel::start_aborted);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(
        index: usize,
        exists: bool,
        same_as_source: bool,
        conflict: bool,
    ) -> ConversionPlanEntry {
        ConversionPlanEntry {
            index,
            input: format!("/in/{index}.png"),
            output: Some(format!("/out/{index}.avif")),
            exists,
            same_as_source,
            conflicts_with_queued_input: conflict,
            output_count: 1,
            existing_output_count: usize::from(exists),
            error: None,
        }
    }

    fn options(n: usize) -> Vec<ConvertOptions> {
        (0..n)
            .map(|i| {
                imgconvert_backend::convert::default_conversion_options(
                    format!("/in/{i}.png"),
                    Some("/out".into()),
                    "avif".into(),
                )
            })
            .collect()
    }

    fn pending(mode: OverwriteMode, plan: Vec<ConversionPlanEntry>) -> PendingStart {
        let n = plan.len();
        PendingStart::new(vec![], options(n), plan, None, mode)
    }

    #[test]
    fn ask_mode_prompts_for_existing_outputs_only() {
        let mut p = pending(
            OverwriteMode::Ask,
            vec![
                entry(0, false, false, false),
                entry(1, true, false, false),
                entry(2, true, true, false),
            ],
        );
        match next_prompt(&mut p) {
            Some(Prompt::Ask {
                index: 1,
                same_as_source: false,
                ..
            }) => {}
            _ => panic!("first existing output"),
        }
        assert_eq!(p.options[0].overwrite_mode.as_deref(), Some("skip"));
        p.set_decision(1, true, false);
        match next_prompt(&mut p) {
            Some(Prompt::Ask {
                index: 2,
                same_as_source: true,
                ..
            }) => {}
            _ => panic!("source collision asks with its own wording"),
        }
        p.set_decision(2, false, false);
        assert!(next_prompt(&mut p).is_none());
        assert!(p.options[1].overwrite && !p.options[1].allow_source_overwrite);
        assert!(!p.options[2].overwrite);
    }

    #[test]
    fn conflicts_come_first_then_source_collisions_by_mode() {
        let plan = vec![entry(0, true, true, false), entry(1, true, false, true)];
        let mut skip = pending(OverwriteMode::Skip, plan.clone());
        assert!(matches!(
            next_prompt(&mut skip),
            Some(Prompt::Conflicts { count: 1 })
        ));
        assert!(matches!(
            next_prompt(&mut skip),
            Some(Prompt::SourceSkip { count: 1 })
        ));
        assert!(next_prompt(&mut skip).is_none());

        let mut overwrite = pending(OverwriteMode::Overwrite, plan);
        assert!(matches!(
            next_prompt(&mut overwrite),
            Some(Prompt::Conflicts { count: 1 })
        ));
        match next_prompt(&mut overwrite) {
            Some(Prompt::SourceOverwrite { indexes }) => assert_eq!(indexes, vec![0]),
            _ => panic!("overwrite mode asks for consent"),
        }
        overwrite.set_decision(0, true, true);
        assert!(overwrite.options[0].allow_source_overwrite);
        assert!(!overwrite.options[1].allow_source_overwrite);
    }
}
