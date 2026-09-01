// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! 用户显式授权路径边界。
//!
//! Tauri 直发包当前拿到的是本机路径；Flatpak portal 可能给 portal 映射路径。
//! macOS App Sandbox 当前依赖用户在本进程中通过原生选择器授予的访问范围，
//! 不把路径持久化伪装成 security-scoped bookmark。上层导入/转换只依赖这里产出
//! 的 grant，避免后续把平台授权逻辑散落到业务代码。

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::macos_security::ScopedResource;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizedPath {
    path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RejectedSelectedPath {
    pub input: String,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct ResolvedSelectedPaths {
    pub authorized: Vec<AuthorizedPath>,
    pub rejected: Vec<RejectedSelectedPath>,
}

impl AuthorizedPath {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn into_path_buf(self) -> PathBuf {
        self.path
    }

    pub fn scoped_access(&self) -> ScopedPathAccess {
        ScopedPathAccess::start(&self.path)
    }
}

#[derive(Debug)]
pub struct ScopedPathAccess {
    #[allow(dead_code)]
    path: PathBuf,
    _resource: ScopedResource,
}

/// Platform-specific user-selected file access policy exposed to the frontend.
///
/// This deliberately describes capabilities rather than packaging names in
/// JavaScript. Flatpak and strict Snap runtimes must use the GTK portal file
/// chooser, while the AppImage needs its host-dialog workaround for the
/// WebKit/GTK crash.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFileAccess {
    pub use_host_linux_picker: bool,
    pub requires_output_directory: bool,
    pub requires_output_directory_session_grant: bool,
}

pub fn runtime_file_access() -> RuntimeFileAccess {
    let platform = std::env::consts::OS;
    let flatpak = if platform == "linux" {
        is_flatpak_runtime()
    } else {
        false
    };
    let snap = if platform == "linux" {
        is_snap_runtime()
    } else {
        false
    };
    let appimage = if platform == "linux" {
        is_appimage_runtime()
    } else {
        false
    };

    runtime_file_access_for(platform, flatpak, snap, appimage)
}

fn runtime_file_access_for(
    platform: &str,
    flatpak: bool,
    snap: bool,
    appimage: bool,
) -> RuntimeFileAccess {
    let requires_output_directory_session_grant = platform == "macos";
    RuntimeFileAccess {
        // Never try to execute host zenity/kdialog in a portal sandbox. GTK's
        // GtkFileChooserNative uses the file chooser portal there instead.
        use_host_linux_picker: platform == "linux" && appimage && !flatpak && !snap,
        // An individual portal-selected source file does not grant permission
        // to create a sibling output. Selecting an output folder provides the
        // required writable document-portal scope.
        requires_output_directory: requires_output_directory_session_grant || flatpak || snap,
        requires_output_directory_session_grant,
    }
}

fn is_flatpak_runtime() -> bool {
    Path::new("/.flatpak-info").is_file() || has_environment_value("FLATPAK_ID")
}

fn is_snap_runtime() -> bool {
    has_environment_value("SNAP") || has_environment_value("SNAP_NAME")
}

fn is_appimage_runtime() -> bool {
    has_environment_value("APPIMAGE") || has_environment_value("APPDIR")
}

fn has_environment_value(name: &str) -> bool {
    std::env::var_os(name).is_some_and(|value| !value.is_empty())
}

impl ScopedPathAccess {
    pub fn start(path: &Path) -> Self {
        Self {
            path: path.to_path_buf(),
            _resource: ScopedResource::start(path),
        }
    }

    #[cfg(all(test, not(target_os = "macos")))]
    pub fn started(&self) -> bool {
        self._resource.started()
    }
}

pub fn user_selected_paths(paths: Vec<String>) -> ResolvedSelectedPaths {
    let mut resolved = ResolvedSelectedPaths::default();
    for input in paths {
        match selected_path_to_path_buf(&input) {
            Ok(path) => resolved.authorized.push(AuthorizedPath::new(path)),
            Err(reason) => resolved
                .rejected
                .push(RejectedSelectedPath { input, reason }),
        }
    }
    resolved
}

pub fn user_selected_path(path: &str) -> Result<AuthorizedPath, String> {
    selected_path_to_path_buf(path).map(AuthorizedPath::new)
}

pub fn output_directory(path: Option<&str>) -> Result<Option<AuthorizedPath>, String> {
    path.map(user_selected_path).transpose()
}

pub fn clipboard_temp_path(path: impl Into<PathBuf>) -> AuthorizedPath {
    AuthorizedPath::new(path)
}

pub fn scoped_path_access(path: &Path) -> ScopedPathAccess {
    ScopedPathAccess::start(path)
}

fn selected_path_to_path_buf(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径为空".to_string());
    }
    if let Ok(url) = tauri::Url::parse(trimmed) {
        if url.scheme() == "file" {
            return url
                .to_file_path()
                .map_err(|_| format!("无法解析 file URL: {trimmed}"));
        }
        if url.scheme().len() != 1 {
            return Err(format!("不支持的路径 URL scheme: {}", url.scheme()));
        }
    }
    // Whitespace is legal in native filenames. Use the trimmed view only for empty/URL
    // validation; a plain path must preserve exactly what the picker returned.
    Ok(PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_selected_paths_preserve_noncanonical_portal_paths() {
        let resolved = user_selected_paths(vec![
            "  ".to_string(),
            "/run/user/1000/doc/by-app/imgconvert/photo.png".to_string(),
        ]);

        assert_eq!(resolved.authorized.len(), 1);
        assert_eq!(resolved.rejected.len(), 1);
        assert_eq!(
            resolved.authorized[0].path(),
            Path::new("/run/user/1000/doc/by-app/imgconvert/photo.png")
        );
        assert_eq!(resolved.rejected[0].input, "  ");
    }

    #[test]
    fn output_directory_rejects_invalid_values_instead_of_falling_back() {
        assert!(output_directory(None).unwrap().is_none());
        assert!(output_directory(Some(" ")).is_err());
        assert_eq!(
            output_directory(Some("/tmp/out")).unwrap().unwrap().path(),
            Path::new("/tmp/out")
        );
    }

    #[test]
    fn selected_paths_accept_file_urls_for_scoped_dialogs() {
        #[cfg(windows)]
        let (input, expected) = (
            "file:///C:/Users/example/Pictures/photo.png",
            Path::new(r"C:\Users\example\Pictures\photo.png"),
        );
        #[cfg(not(windows))]
        let (input, expected) = ("file:///tmp/photo.png", Path::new("/tmp/photo.png"));

        let paths = user_selected_paths(vec![input.to_string()]);

        assert_eq!(paths.authorized.len(), 1);
        assert!(paths.rejected.is_empty());
        assert_eq!(paths.authorized[0].path(), expected);
    }

    #[test]
    fn selected_paths_reject_non_file_urls() {
        let paths = user_selected_paths(vec!["https://example.com/photo.png".to_string()]);
        assert!(paths.authorized.is_empty());
        assert_eq!(paths.rejected.len(), 1);
    }

    #[test]
    fn selected_plain_path_preserves_filename_whitespace() {
        let input = "/tmp/photo .png ";
        let selected = user_selected_path(input).unwrap();

        assert_eq!(selected.path(), Path::new(input));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn scoped_access_is_noop_off_macos() {
        assert!(!scoped_path_access(Path::new("/tmp")).started());
    }

    #[test]
    fn runtime_file_access_keeps_appimage_workaround_out_of_flatpak() {
        assert_eq!(
            runtime_file_access_for("linux", false, false, true),
            RuntimeFileAccess {
                use_host_linux_picker: true,
                requires_output_directory: false,
                requires_output_directory_session_grant: false,
            }
        );
        assert_eq!(
            runtime_file_access_for("linux", true, false, true),
            RuntimeFileAccess {
                use_host_linux_picker: false,
                requires_output_directory: true,
                requires_output_directory_session_grant: false,
            }
        );
    }

    #[test]
    fn runtime_file_access_requires_output_directory_for_snap_portal_paths() {
        assert_eq!(
            runtime_file_access_for("linux", false, true, false),
            RuntimeFileAccess {
                use_host_linux_picker: false,
                requires_output_directory: true,
                requires_output_directory_session_grant: false,
            }
        );
    }

    #[test]
    fn runtime_file_access_requires_a_fresh_macos_directory_grant() {
        assert_eq!(
            runtime_file_access_for("macos", false, false, false),
            RuntimeFileAccess {
                use_host_linux_picker: false,
                requires_output_directory: true,
                requires_output_directory_session_grant: true,
            }
        );
        assert_eq!(
            runtime_file_access_for("windows", false, false, false),
            RuntimeFileAccess {
                use_host_linux_picker: false,
                requires_output_directory: false,
                requires_output_directory_session_grant: false,
            }
        );
    }
}
