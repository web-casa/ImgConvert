// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Workflow feature: output format, output folder, start/cancel and batch
//! progress. The batch itself is owned by the backend `BatchService`; this
//! crate only issues commands and renders `shared::BatchModel`.

pub mod workflow_panel;

pub use workflow_panel::WorkflowPanel;
