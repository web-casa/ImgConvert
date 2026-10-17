// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Plugin diagnostics: what the optional HEIC import can use on this machine
//! (system codecs, manifest providers, system helpers) and the one setting
//! behind it, the manually chosen helper executable. Read-only probing plus
//! the helper selection; no conversion runs here.

pub mod plugin_diagnostics;

pub use plugin_diagnostics::{PluginDiagnostics, open_plugin_diagnostics};
