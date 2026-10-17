// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Storage and environmental scenario feature (port of
//! `EnvironmentalImpact.svelte`): a dialog for one finished queue item or
//! for the whole batch. The arithmetic is `imgconvert_backend::
//! environmental_impact`; this crate only collects the inputs and shows the
//! result with the model's own boundary text.

pub mod impact_view;

pub use impact_view::{ImpactSubject, ImpactView, ScenarioOutcome, open_environmental_impact};
