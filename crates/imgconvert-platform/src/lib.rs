// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! System capability layer shared by every ImgConvert desktop shell.
//!
//! Dependency direction: `imgconvert-platform` depends on `imgconvert-core`
//! only. It must never depend on `tauri`, `gpui` or any UI toolkit; shells
//! implement the traits declared here (for example [`dialogs::FilePicker`]).

pub mod dialogs;
pub mod external_codecs;
pub mod macos_security;
#[cfg(target_os = "macos")]
pub mod macos_system_codecs;
#[cfg(target_os = "windows")]
pub mod windows_system_codecs;
