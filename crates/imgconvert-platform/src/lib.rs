// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! System capability layer shared by every ImgConvert desktop shell.
//!
//! Dependency direction: `imgconvert-platform` depends on `imgconvert-core`
//! only. It must never depend on `tauri`, `gpui` or any UI toolkit; shells
//! implement the traits declared here (for example [`dialogs::FilePicker`]).

pub mod atomic_output;
#[cfg(feature = "clipboard")]
pub mod clipboard;
pub mod dialogs;
pub mod external_codecs;
pub mod instance_lock;
pub mod macos_security;
#[cfg(target_os = "macos")]
pub mod macos_system_codecs;
pub mod paths;
pub mod settings;
#[cfg(target_os = "windows")]
pub mod windows_system_codecs;
pub mod workflow_presets;

#[cfg(feature = "update-guard")]
pub mod update_policy;
