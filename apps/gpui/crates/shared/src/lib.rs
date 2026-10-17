// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Shared capabilities of the GPUI shell (migration plan §2, "shared" crate).
//!
//! Owns the retained domain models ([`QueueModel`], [`BatchModel`],
//! [`SettingsModel`]), the application-level service globals, the bridge that moves backend progress
//! onto the GPUI foreground, native file prompts, interface strings and the
//! performance probe. Feature crates depend on this crate; it depends on
//! `imgconvert-backend` and `gpui-kit` only.

rust_i18n::i18n!("locales", fallback = "en");

pub mod batch_model;
pub mod choice;
pub mod conversion;
pub mod file_prompt;
pub mod i18n;
pub mod images;
pub mod perf_probe;
pub mod progress_bridge;
pub mod queue_model;
pub mod services;
pub mod settings_model;
pub mod tasks;
pub mod theme;

pub use batch_model::{BatchModel, BatchPhase};
pub use queue_model::{ItemStatus, QueueItem, QueueModel, ThumbnailState};
pub use services::{AppModels, Services};
pub use settings_model::SettingsModel;
