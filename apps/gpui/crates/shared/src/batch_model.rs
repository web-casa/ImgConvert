// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Retained state of the current or last batch, rebuilt from backend events
//! by the progress bridge. Views observe it; they never hold the batch.

use gpui_kit::SharedString;
use imgconvert_backend::convert::{BatchProgressEvent, BatchSummary};
use imgconvert_backend::progress::BatchId;

#[derive(Debug, Clone, PartialEq)]
pub enum BatchPhase {
    Idle,
    Running,
    /// Cancellation was requested; the backend has not confirmed yet.
    Cancelling,
    Finished(BatchSummary),
    Failed(SharedString),
}

#[derive(Debug, Clone, PartialEq)]
pub struct BatchModel {
    phase: BatchPhase,
    id: Option<BatchId>,
    total: usize,
    completed: usize,
    skipped: usize,
    failed: usize,
    /// Queue keys in job order; the bridge maps event indexes through this.
    jobs: Vec<SharedString>,
}

impl Default for BatchModel {
    fn default() -> Self {
        Self {
            phase: BatchPhase::Idle,
            id: None,
            total: 0,
            completed: 0,
            skipped: 0,
            failed: 0,
            jobs: Vec::new(),
        }
    }
}

impl BatchModel {
    pub fn phase(&self) -> &BatchPhase {
        &self.phase
    }

    pub fn id(&self) -> Option<BatchId> {
        self.id
    }

    pub fn jobs(&self) -> &[SharedString] {
        &self.jobs
    }

    pub fn total(&self) -> usize {
        self.total
    }

    pub fn completed(&self) -> usize {
        self.completed
    }

    pub fn skipped(&self) -> usize {
        self.skipped
    }

    pub fn failed(&self) -> usize {
        self.failed
    }

    pub fn finished_count(&self) -> usize {
        self.completed + self.skipped + self.failed
    }

    pub fn is_active(&self) -> bool {
        matches!(self.phase, BatchPhase::Running | BatchPhase::Cancelling)
    }

    /// Fraction done in 0–100 for a progress bar.
    pub fn percent(&self) -> f32 {
        if self.total == 0 {
            return 0.0;
        }
        (self.finished_count() as f32 / self.total as f32 * 100.0).clamp(0.0, 100.0)
    }

    pub fn begin(&mut self, id: BatchId, jobs: Vec<SharedString>) {
        self.total = jobs.len();
        self.jobs = jobs;
        self.id = Some(id);
        self.completed = 0;
        self.skipped = 0;
        self.failed = 0;
        self.phase = BatchPhase::Running;
    }

    pub fn request_cancel(&mut self) {
        if self.phase == BatchPhase::Running {
            self.phase = BatchPhase::Cancelling;
        }
    }

    /// Applies an event; events for another batch id are ignored.
    pub fn apply(&mut self, id: BatchId, event: &BatchProgressEvent) -> bool {
        if self.id != Some(id) {
            return false;
        }
        match event {
            BatchProgressEvent::Started { total } => self.total = *total,
            BatchProgressEvent::FileFinished { .. } => self.completed += 1,
            BatchProgressEvent::FileSkipped { .. } => self.skipped += 1,
            BatchProgressEvent::FileError { .. } => self.failed += 1,
            BatchProgressEvent::Finished { summary } => {
                self.total = summary.total;
                self.completed = summary.completed;
                self.skipped = summary.skipped;
                self.failed = summary.failed;
                self.phase = BatchPhase::Finished(summary.clone());
            }
            BatchProgressEvent::Cancelled { .. }
            | BatchProgressEvent::FileStarted { .. }
            | BatchProgressEvent::FileProgress { .. } => {}
        }
        true
    }

    pub fn fail(&mut self, detail: SharedString) {
        self.phase = BatchPhase::Failed(detail);
    }

    /// Called when the coordinator ended without a `Finished` event.
    pub fn finish_without_summary(&mut self, summary: Option<BatchSummary>) {
        if self.is_active() {
            self.phase = match summary {
                Some(summary) => BatchPhase::Finished(summary),
                None => BatchPhase::Failed(SharedString::from("batch ended without a summary")),
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_follow_events_of_the_current_batch_only() {
        let mut model = BatchModel::default();
        let id = BatchId::new(3);
        model.begin(id, vec!["a".into(), "b".into()]);
        assert!(model.is_active());
        assert!(model.apply(
            id,
            &BatchProgressEvent::FileSkipped {
                index: 0,
                input: "a".into(),
                error: imgconvert_backend::command_error::CommandError::batch_failed("skip"),
            }
        ));
        assert!(!model.apply(BatchId::new(9), &BatchProgressEvent::Started { total: 7 }));
        assert_eq!(model.total(), 2);
        assert_eq!(model.finished_count(), 1);
        assert!((model.percent() - 50.0).abs() < f32::EPSILON);
        let summary = BatchSummary {
            total: 2,
            completed: 1,
            skipped: 1,
            failed: 0,
            cancelled: false,
        };
        model.apply(
            id,
            &BatchProgressEvent::Finished {
                summary: summary.clone(),
            },
        );
        assert_eq!(model.phase(), &BatchPhase::Finished(summary));
        assert!(!model.is_active());
    }

    #[test]
    fn cancel_request_is_visible_until_the_backend_confirms() {
        let mut model = BatchModel::default();
        model.begin(BatchId::new(1), vec!["a".into()]);
        model.request_cancel();
        assert_eq!(model.phase(), &BatchPhase::Cancelling);
        model.finish_without_summary(None);
        assert!(matches!(model.phase(), BatchPhase::Failed(_)));
    }
}
