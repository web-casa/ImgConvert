// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Workflow feature: the conversion settings form, output folder,
//! start/cancel and batch progress. The batch itself is owned by the backend
//! `BatchService`; this crate only issues commands and renders
//! `shared::BatchModel`. Every setting lives in `shared::SettingsModel`.

pub mod action_bar;
pub mod output_safety;
pub mod settings_form;
mod workflow_panel;

pub use action_bar::{ActionBar, ActionBarEvent};
pub use settings_form::{NumberField, Section, SettingsForm, SliderKind};
pub use workflow_panel::WorkflowPanel;
