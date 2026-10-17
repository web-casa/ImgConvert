// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Per-channel configuration directories (migration plan §3.5).
//!
//! The Tauri shell opens `settings.json` through `tauri-plugin-store`, which
//! resolves relative store paths against `BaseDirectory::AppData`, that is
//! `dirs::data_dir()/<identifier>` (verified in tauri-plugin-store 2.4.3,
//! `store.rs`, and tauri 2.12 `path/desktop.rs`). On macOS and Windows this is
//! the same directory as the config dir; on Linux it is `$XDG_DATA_HOME`
//! (default `~/.local/share`), not `$XDG_CONFIG_HOME`. The GPUI shell uses
//! the same resolution so both shells see one file during the migration.
//! Sandboxed channels (MAS, Snap, Flatpak) redirect the home directory
//! themselves; the relative layout is unchanged there.

use std::path::PathBuf;

/// Bundle / app identifier shared by every channel.
pub const APP_IDENTIFIER: &str = "com.ivmm.imgconvert";
/// File name used by `tauri-plugin-store`.
pub const SETTINGS_FILE_NAME: &str = "settings.json";
/// Single-instance marker written by both shells (§3.5 互斥运行).
pub const INSTANCE_LOCK_FILE_NAME: &str = "instance.lock";

/// The directory Tauri calls `app_data_dir`: `~/Library/Application
/// Support/<id>` on macOS, `%APPDATA%\<id>` on Windows, `$XDG_DATA_HOME/<id>`
/// (default `~/.local/share/<id>`) on Linux. `None` when the platform reports
/// no data directory.
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(APP_IDENTIFIER))
}

/// Where both shells keep `settings.json`.
pub fn settings_file() -> Option<PathBuf> {
    app_data_dir().map(|dir| dir.join(SETTINGS_FILE_NAME))
}

/// Where both shells keep the single-instance marker.
pub fn instance_lock_file() -> Option<PathBuf> {
    app_data_dir().map(|dir| dir.join(INSTANCE_LOCK_FILE_NAME))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_file_lives_under_the_identifier_directory() {
        if let Some(path) = settings_file() {
            assert!(path.ends_with(format!("{APP_IDENTIFIER}/{SETTINGS_FILE_NAME}")));
            assert_eq!(
                path.parent().map(std::path::Path::to_path_buf),
                app_data_dir()
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_follows_the_tauri_store_into_xdg_data_home() {
        // dirs reads the variable at call time, so the expectation is derived
        // from the same source instead of pinning a home directory.
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| dirs::home_dir().map(|h| h.join(".local/share")));
        assert_eq!(app_data_dir(), base.map(|b| b.join(APP_IDENTIFIER)));
    }
}
