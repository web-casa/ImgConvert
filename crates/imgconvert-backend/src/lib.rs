// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Desktop business services shared by the Tauri and GPUI shells.
//!
//! Dependency direction: `imgconvert-backend` → `imgconvert-platform` →
//! `imgconvert-core`. This crate never depends on `tauri` or `gpui`; shells
//! adapt its [`progress::ProgressSink`] and drive [`service::BatchService`].

pub mod access;
pub mod command_error;
pub mod conversion_request;
pub mod convert;
pub mod environment;
pub mod environmental_impact;
#[cfg(feature = "fuzzing")]
pub mod fuzzing;
pub mod import;
pub mod native_dialog;
/// PDF rasterization stays behind `convert`, `preview`, `thumbnail` and
/// `import`; shells only need [`convert::PdfConvertOptions`].
pub(crate) mod pdf;
pub mod preview;
pub mod progress;
pub mod result_cache;
pub mod service;
pub mod thumbnail;

/// Settings persistence, per-channel paths and the single-instance marker
/// live in the platform crate; shells reach them through this facade.
pub use imgconvert_platform::{external_codecs, instance_lock, paths, settings, workflow_presets};

#[cfg(feature = "clipboard")]
pub use imgconvert_platform::clipboard;
