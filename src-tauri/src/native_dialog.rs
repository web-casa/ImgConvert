// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

use std::io::Read;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::access;

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

struct DialogOutputReader {
    receiver: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    handle: thread::JoinHandle<()>,
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

// A host dialog is allowed to remain open while the user browses files, but it
// must not hold the blocking command indefinitely if the helper becomes stuck.
const HOST_DIALOG_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DIALOG_COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(50);
const DIALOG_OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

pub fn pick_paths(options: &NativePickOptions) -> Result<Vec<String>, String> {
    if !access::runtime_file_access().use_host_linux_picker {
        return Err(
            "宿主系统文件选择器只适用于 AppImage 运行时；沙盒环境必须使用门户文件选择器。".into(),
        );
    }
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
    run_dialog_command(kdialog_command(command, options), "kdialog")
}

fn kdialog_command(command: &str, options: &NativePickOptions) -> Command {
    let mut cmd = host_dialog_command(command);
    if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
        cmd.arg("--title").arg(title);
    }
    if options.directory && options.multiple {
        // KDialog only supports --multiple with its file-open dialog. Its
        // documented inode/directory MIME filter makes that dialog select
        // directories, so this preserves the caller's multi-directory request.
        cmd.arg("--getopenfilename")
            .arg(".")
            .arg("inode/directory")
            .arg("--multiple")
            .arg("--separate-output");
    } else if options.directory {
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
    cmd
}

fn run_dialog_command(cmd: Command, label: &str) -> Result<Vec<String>, String> {
    run_dialog_command_with_timeout(cmd, label, HOST_DIALOG_TIMEOUT)
}

fn run_dialog_command_with_timeout(
    mut cmd: Command,
    label: &str,
    timeout: Duration,
) -> Result<Vec<String>, String> {
    let output = dialog_command_output(&mut cmd, label, timeout)?;
    if is_cancelled(output.status.code(), &output.stdout, &output.stderr) {
        return Ok(Vec::new());
    }
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            format!("{label} 退出码 {}", output.status)
        } else {
            format!("{label}: {detail}")
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

fn dialog_command_output(
    cmd: &mut Command,
    label: &str,
    timeout: Duration,
) -> Result<Output, String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("{label} 启动失败:{error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{label} 无法读取标准输出管道"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{label} 无法读取错误输出管道"))?;
    let stdout_reader = spawn_dialog_output_reader(stdout);
    let stderr_reader = spawn_dialog_output_reader(stderr);
    let started = Instant::now();

    let status = loop {
        match child
            .try_wait()
            .map_err(|error| format!("{label} 等待响应失败:{error}"))?
        {
            Some(status) => break status,
            None if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{label} 响应超时，请关闭后重试。"));
            }
            None => {
                let remaining = timeout.saturating_sub(started.elapsed());
                thread::sleep(DIALOG_COMMAND_POLL_INTERVAL.min(remaining));
            }
        }
    };

    let stdout = join_dialog_output_reader(stdout_reader, label, "标准输出")?;
    let stderr = join_dialog_output_reader(stderr_reader, label, "错误输出")?;

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn spawn_dialog_output_reader<R>(mut reader: R) -> DialogOutputReader
where
    R: Read + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    let handle = thread::spawn(move || {
        let mut output = Vec::new();
        let result = reader.read_to_end(&mut output).map(|_| output);
        let _ = sender.send(result);
    });
    DialogOutputReader { receiver, handle }
}

fn join_dialog_output_reader(
    reader: DialogOutputReader,
    label: &str,
    stream_name: &str,
) -> Result<Vec<u8>, String> {
    match reader.receiver.recv_timeout(DIALOG_OUTPUT_DRAIN_TIMEOUT) {
        Ok(Ok(output)) => {
            let _ = reader.handle.join();
            Ok(output)
        }
        Ok(Err(error)) => {
            let _ = reader.handle.join();
            Err(format!("{label} 读取{stream_name}失败:{error}"))
        }
        Err(mpsc::RecvTimeoutError::Timeout) => Err(format!("{label} 读取{stream_name}超时。")),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(format!("{label} 读取{stream_name}线程异常退出。"))
        }
    }
}

fn is_cancelled(exit_code: Option<i32>, stdout: &[u8], stderr: &[u8]) -> bool {
    // Zenity and KDialog both reserve exit code 1 for a user cancellation.
    // If either stream has a diagnostic, preserve it as an actionable failure
    // instead of silently treating it as a cancellation.
    exit_code == Some(1) && output_is_blank(stdout) && output_is_blank(stderr)
}

fn output_is_blank(output: &[u8]) -> bool {
    output.iter().all(|byte| byte.is_ascii_whitespace())
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

    #[test]
    fn kdialog_uses_the_directory_filter_for_multiple_directory_selection() {
        let options = NativePickOptions {
            directory: true,
            multiple: true,
            title: Some("Choose folders".into()),
            extensions: Vec::new(),
            filter_name: None,
            all_files_name: None,
        };
        let command = kdialog_command("/usr/bin/kdialog", &options);
        let arguments: Vec<_> = command
            .get_args()
            .map(|argument| argument.to_string_lossy().to_string())
            .collect();

        assert_eq!(
            arguments,
            vec![
                "--title",
                "Choose folders",
                "--getopenfilename",
                ".",
                "inode/directory",
                "--multiple",
                "--separate-output",
            ]
        );
    }

    #[test]
    fn cancellation_requires_the_expected_exit_code_without_diagnostics() {
        assert!(is_cancelled(Some(1), b"", b""));
        assert!(is_cancelled(Some(1), b" \n", b"\t"));
        assert!(!is_cancelled(Some(0), b"", b""));
        assert!(!is_cancelled(Some(1), b"selected-path", b""));
        assert!(!is_cancelled(Some(1), b"", b"dialog backend failed"));
    }

    #[cfg(unix)]
    #[test]
    fn dialog_command_times_out_and_returns_an_error() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "while :; do :; done"]);

        let error =
            run_dialog_command_with_timeout(command, "test dialog", Duration::from_millis(10))
                .expect_err("a non-terminating dialog command must time out");

        assert!(error.contains("响应超时"));
    }

    #[cfg(unix)]
    #[test]
    fn dialog_command_drains_output_while_waiting_for_exit() {
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "i=0; while [ \"$i\" -lt 10000 ]; do printf 0123456789; i=$((i + 1)); done",
        ]);

        let paths = run_dialog_command_with_timeout(command, "test dialog", Duration::from_secs(1))
            .expect("a large dialog result must not block on a full output pipe");

        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].len(), 100_000);
    }
}
