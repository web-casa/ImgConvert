// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

use std::path::Path;
use std::process::{Command, ExitStatus};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePickOptions {
    #[serde(default)]
    pub directory: bool,
    #[serde(default)]
    pub multiple: bool,
    pub title: Option<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    pub filter_name: Option<String>,
    pub all_files_name: Option<String>,
}

const HOST_DIALOG_ENV_REMOVE: &[&str] = &[
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GIO_MODULE_DIR",
    "GI_TYPELIB_PATH",
    "GSETTINGS_SCHEMA_DIR",
    "GST_PLUGIN_PATH",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_REGISTRY",
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
    "GTK_IM_MODULE",
    "GTK_IM_MODULE_FILE",
    "GTK_MODULES",
    "GTK_PATH",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "QML2_IMPORT_PATH",
    "QT_PLUGIN_PATH",
    "XDG_DATA_DIRS",
];

pub fn pick_paths(options: &NativePickOptions) -> Result<Vec<String>, String> {
    pick_paths_linux(options)
}

fn pick_paths_linux(options: &NativePickOptions) -> Result<Vec<String>, String> {
    let mut errors = Vec::new();

    for command in ["/usr/bin/zenity", "/usr/local/bin/zenity"] {
        if !Path::new(command).is_file() {
            continue;
        }
        match run_zenity(command, options) {
            Ok(paths) => return Ok(paths),
            Err(error) => errors.push(error),
        }
    }

    for command in ["/usr/bin/kdialog", "/usr/local/bin/kdialog"] {
        if !Path::new(command).is_file() {
            continue;
        }
        match run_kdialog(command, options) {
            Ok(paths) => return Ok(paths),
            Err(error) => errors.push(error),
        }
    }

    if errors.is_empty() {
        Err(
            "未找到可用的系统文件选择器。请安装 zenity 或 kdialog,也可以直接拖拽文件/文件夹导入。"
                .into(),
        )
    } else {
        Err(format!("系统文件选择器不可用:{}", errors.join("; ")))
    }
}

fn run_zenity(command: &str, options: &NativePickOptions) -> Result<Vec<String>, String> {
    let separator = "\n";
    let mut cmd = host_dialog_command(command);
    cmd.arg("--file-selection");
    if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
        cmd.arg(format!("--title={title}"));
    }
    if options.directory {
        cmd.arg("--directory");
    }
    if options.multiple {
        cmd.arg("--multiple")
            .arg(format!("--separator={separator}"));
    }
    if !options.directory {
        if let Some(filter) =
            zenity_image_filter(&options.extensions, options.filter_name.as_deref())
        {
            cmd.arg(filter);
        }
        let all_files = sanitized_filter_label(options.all_files_name.as_deref(), "All files");
        cmd.arg(format!("--file-filter={all_files} | *"));
    }
    run_dialog_command(cmd, "zenity")
}

fn run_kdialog(command: &str, options: &NativePickOptions) -> Result<Vec<String>, String> {
    let mut cmd = host_dialog_command(command);
    if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
        cmd.arg("--title").arg(title);
    }
    if options.directory {
        cmd.arg("--getexistingdirectory").arg(".");
    } else {
        cmd.arg("--getopenfilename").arg(".");
        if let Some(filter) =
            kdialog_image_filter(&options.extensions, options.filter_name.as_deref())
        {
            cmd.arg(filter);
        }
        if options.multiple {
            cmd.arg("--multiple").arg("--separate-output");
        }
    }
    run_dialog_command(cmd, "kdialog")
}

fn run_dialog_command(mut cmd: Command, label: &str) -> Result<Vec<String>, String> {
    let output = cmd
        .output()
        .map_err(|error| format!("{label} 启动失败:{error}"))?;
    if is_cancelled(output.status) {
        return Ok(Vec::new());
    }
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("{label} 退出码 {}", output.status)
        } else {
            format!("{label}: {stderr}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn is_cancelled(status: ExitStatus) -> bool {
    matches!(status.code(), Some(1))
}

fn zenity_image_filter(extensions: &[String], filter_name: Option<&str>) -> Option<String> {
    let patterns = extension_patterns(extensions);
    let label = sanitized_filter_label(filter_name, "Images");
    (!patterns.is_empty()).then(|| format!("--file-filter={label} | {}", patterns.join(" ")))
}

fn kdialog_image_filter(extensions: &[String], filter_name: Option<&str>) -> Option<String> {
    let patterns = extension_patterns(extensions);
    let label = sanitized_filter_label(filter_name, "Images");
    (!patterns.is_empty()).then(|| format!("{}|{label}", patterns.join(" ")))
}

fn sanitized_filter_label(value: Option<&str>, fallback: &str) -> String {
    let sanitized = value
        .unwrap_or_default()
        .chars()
        .filter(|character| !matches!(character, '|' | '\r' | '\n'))
        .collect::<String>();
    let trimmed = sanitized.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn extension_patterns(extensions: &[String]) -> Vec<String> {
    let mut patterns = Vec::new();

    extensions
        .iter()
        .map(|extension| {
            extension
                .trim()
                .trim_start_matches('.')
                .to_ascii_lowercase()
        })
        .filter(|extension| {
            !extension.is_empty() && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
        .for_each(|extension| {
            push_pattern(&mut patterns, format!("*.{extension}"));
            let upper = extension.to_ascii_uppercase();
            if upper != extension {
                push_pattern(&mut patterns, format!("*.{upper}"));
            }
        });

    patterns
}

fn push_pattern(patterns: &mut Vec<String>, pattern: String) {
    if !patterns.iter().any(|existing| existing == &pattern) {
        patterns.push(pattern);
    }
}

fn host_dialog_command(path: &str) -> Command {
    let mut cmd = Command::new(path);
    for key in HOST_DIALOG_ENV_REMOVE {
        cmd.env_remove(key);
    }
    for (key, _) in std::env::vars_os() {
        if should_remove_dynamic_host_dialog_env_key(&key.to_string_lossy()) {
            cmd.env_remove(key);
        }
    }
    cmd
}

fn should_remove_dynamic_host_dialog_env_key(key: &str) -> bool {
    key.starts_with("WEBKIT_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_patterns_deduplicate_and_reject_unsafe_filters() {
        let patterns = extension_patterns(&[
            ".jpg".into(),
            "JPG".into(),
            "jpeg".into(),
            "bad*glob".into(),
            "../png".into(),
            "heif".into(),
            "".into(),
        ]);

        assert_eq!(
            patterns,
            vec!["*.jpg", "*.JPG", "*.jpeg", "*.JPEG", "*.heif", "*.HEIF"]
        );
    }

    #[test]
    fn file_filters_use_sanitized_extension_patterns() {
        let extensions = vec![
            "png".to_string(),
            "webp".to_string(),
            "bad glob".to_string(),
        ];

        assert_eq!(
            zenity_image_filter(&extensions, Some("Images")),
            Some("--file-filter=Images | *.png *.PNG *.webp *.WEBP".into())
        );
        assert_eq!(
            kdialog_image_filter(&extensions, Some("图片")),
            Some("*.png *.PNG *.webp *.WEBP|图片".into())
        );
        assert_eq!(
            sanitized_filter_label(Some("Images|unsafe\n"), "fallback"),
            "Imagesunsafe"
        );
    }

    #[test]
    fn host_dialog_environment_removes_appimage_and_toolkit_overrides() {
        let cmd = host_dialog_command("/usr/bin/zenity");
        let removed: Vec<_> = cmd
            .get_envs()
            .filter(|(_, value)| value.is_none())
            .map(|(key, _)| key.to_string_lossy().to_string())
            .collect();

        assert!(removed.iter().any(|key| key == "APPDIR"));
        assert!(removed.iter().any(|key| key == "LD_LIBRARY_PATH"));
        assert!(removed.iter().any(|key| key == "GSETTINGS_SCHEMA_DIR"));
    }

    #[test]
    fn host_dialog_environment_removes_dynamic_webkit_overrides() {
        assert!(should_remove_dynamic_host_dialog_env_key(
            "WEBKIT_FORCE_COMPOSITING_MODE"
        ));
        assert!(should_remove_dynamic_host_dialog_env_key(
            "WEBKIT_DISABLE_DMABUF_RENDERER"
        ));
        assert!(!should_remove_dynamic_host_dialog_env_key(
            "GSETTINGS_SCHEMA_DIR"
        ));
    }
}
