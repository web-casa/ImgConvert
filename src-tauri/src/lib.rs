// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Tauri shell: IPC command adapters over `imgconvert-backend`.
//!
//! This crate owns nothing but the adapters: `#[tauri::command]` wrappers,
//! the Tauri `Channel` implementation of [`ProgressSink`], the binary IPC
//! response for previews, and plugin/state registration. Business logic lives
//! in `imgconvert-backend` and system capabilities in `imgconvert-platform`.

mod perf_probe;

use std::sync::Arc;

use imgconvert_backend::access;
use imgconvert_backend::command_error::CommandError;
use imgconvert_backend::convert::{
    self, BatchProgressEvent, BatchSummary, Capabilities, ConversionPlanEntry, ConvertOptions,
    RuntimeDiagnostics,
};
use imgconvert_backend::import::{
    self, ClipboardImageImport, ClipboardImageImportOptions, ClipboardImportState, ImportScanFile,
    ImportScanResult, ImportScanState, ScanImportOptions,
};
use imgconvert_backend::native_dialog::{self, NativePickOptions};
use imgconvert_backend::preview::{self, PreviewOptions, PreviewState};
use imgconvert_backend::progress::{BatchId, ProgressSink, SinkClosed};
use imgconvert_backend::result_cache;
use imgconvert_backend::service::{BatchError, BatchService};
use imgconvert_backend::thumbnail::{self, ThumbnailOptions, ThumbnailResult};
use imgconvert_platform::external_codecs::{self, CodecDiagnostics, SelectedHelperDiagnostic};
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::{Manager, State};

pub use imgconvert_backend::convert::ConvertResult;
pub use perf_probe::{init as perf_probe_init, mark as perf_probe_mark_native};

#[cfg(feature = "fuzzing")]
#[doc(hidden)]
pub use imgconvert_backend::fuzzing::{
    fuzz_external_codec_manifest, fuzz_import_scan_bytes, fuzz_pdf_document,
};

/// Forwards batch events to the webview through a Tauri IPC channel. A failed
/// `Channel::send` means the webview side is gone; the backend then cancels the
/// batch and ends it with an error, exactly as before the backend split.
struct TauriProgressSink {
    channel: Channel<BatchProgressEvent>,
}

impl ProgressSink for TauriProgressSink {
    fn send(&self, _batch_id: BatchId, event: BatchProgressEvent) -> Result<(), SinkClosed> {
        self.channel.send(event).map_err(|_| SinkClosed)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2ESeed {
    input: String,
    pdf_input: String,
    out_dir: String,
}

pub fn run_path_conversion_smoke(
    input: String,
    out_dir: Option<String>,
    format: String,
) -> Result<ConvertResult, String> {
    let options = convert::path_conversion_smoke_options(input, out_dir, format);
    convert::convert(&options).map_err(|error| error.to_string())
}

/// 返回当前运行时的文件访问策略,供前端选择正确的系统文件选择器和输出目录流程。
#[tauri::command]
fn file_access_runtime() -> access::RuntimeFileAccess {
    access::runtime_file_access()
}

/// 返回进程内 core 的格式能力矩阵。
#[tauri::command]
fn capabilities() -> Capabilities {
    convert::capabilities()
}

/// 返回并发/内存/AVIF 线程等运行时诊断信息。
#[tauri::command]
fn runtime_diagnostics() -> RuntimeDiagnostics {
    convert::runtime_diagnostics()
}

/// 返回可选 codec/plugin 的诊断信息。只读探测,不执行转换。
#[tauri::command]
fn codec_diagnostics() -> CodecDiagnostics {
    external_codecs::codec_diagnostics()
}

/// 设置用户显式选择的 HEIC helper。空值表示清除白名单。
#[tauri::command]
fn set_selected_heic_helper(
    path: Option<String>,
) -> Result<SelectedHelperDiagnostic, CommandError> {
    let requested_path = path.clone();
    external_codecs::set_selected_heic_helper(path).map_err(|detail| {
        CommandError::codec_configuration_failed(requested_path.as_deref(), detail)
    })
}

/// 批量转换图片。进度通过 Tauri Channel 返回,取消在文件边界生效。
#[tauri::command]
async fn convert_batch(
    options: Vec<ConvertOptions>,
    progress: Channel<BatchProgressEvent>,
    concurrency: Option<usize>,
    service: State<'_, BatchService>,
    preview_state: State<'_, PreviewState>,
) -> Result<BatchSummary, CommandError> {
    let sink = Arc::new(TauriProgressSink { channel: progress });
    let running = service
        .start(options, sink, concurrency)
        .map_err(|error| match error {
            BatchError::Spawn(detail) => CommandError::task_failed(detail),
            other => CommandError::batch_failed(other.to_string()),
        })?;
    // The batch is registered before preview is cancelled. A preview that raced past its first
    // active check either is current and gets cancelled here, or sees the active batch in its
    // post-registration check.
    preview_state.cancel_current();
    running.wait().await.map_err(|error| match error {
        BatchError::Failed(detail) => CommandError::batch_failed(detail),
        BatchError::Panicked | BatchError::Lost => CommandError::task_failed(error.to_string()),
        other => CommandError::batch_failed(other.to_string()),
    })
}

/// 批量规划输出路径,供 ask 覆盖模式在转换开始前确认。
#[tauri::command]
async fn plan_conversions(
    options: Vec<ConvertOptions>,
) -> Result<Vec<ConversionPlanEntry>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || convert::conversion_plan(&options))
        .await
        .map_err(|error| CommandError::task_failed(format!("转换规划任务调度失败: {error}")))
}

/// 请求取消当前批量任务。返回值表示是否找到正在运行的任务并发出取消信号。
#[tauri::command]
fn cancel_batch(service: State<'_, BatchService>) -> bool {
    service.cancel_current()
}

/// 扫描用户显式授权的文件/目录路径,递归过滤出可读图片文件。
#[tauri::command]
async fn scan_import_paths(
    options: ScanImportOptions,
    state: State<'_, ImportScanState>,
) -> Result<ImportScanResult, CommandError> {
    // The registration is a drop guard that travels with the blocking worker:
    // the running-scan slot clears when the scan really ends, even if this IPC
    // future is dropped first, so `cancel_import_scan` can still reach it.
    let scan = state
        .begin()
        .map_err(|detail| CommandError::import_failed(None, detail))?;
    let cancel = scan.token();

    tauri::async_runtime::spawn_blocking(move || {
        let _scan = scan;
        import::scan_import_paths(options, cancel)
    })
    .await
    .map_err(|error| CommandError::task_failed(format!("导入扫描任务调度失败: {error}")))
}

/// 请求取消当前导入扫描。返回值表示是否找到正在运行的扫描并发出取消信号。
#[tauri::command]
fn cancel_import_scan(state: State<'_, ImportScanState>) -> bool {
    state.cancel_current()
}

/// 把剪贴板图片写入受控临时文件,并作为普通导入文件返回给前端队列。
#[tauri::command]
async fn import_clipboard_image(
    request: Request<'_>,
    state: State<'_, ClipboardImportState>,
) -> Result<ImportScanFile, CommandError> {
    let options =
        clipboard_import_options(&request).map_err(CommandError::clipboard_import_failed)?;
    let clipboard_import =
        tauri::async_runtime::spawn_blocking(move || import::import_clipboard_image(options))
            .await
            .map_err(|error| CommandError::task_failed(format!("剪贴板导入任务调度失败: {error}")))?
            .map_err(CommandError::clipboard_import_failed)?;
    let ClipboardImageImport {
        file,
        managed_path,
        session_lock,
    } = clipboard_import;
    if let Err(error) = state.register(managed_path.clone(), session_lock) {
        import::cleanup_clipboard_file_best_effort(&managed_path);
        return Err(CommandError::clipboard_import_failed(error));
    }
    Ok(file)
}

const CLIPBOARD_MIME_HEADER: &str = "x-imgconvert-clipboard-mime";
const CLIPBOARD_NAME_HEADER: &str = "x-imgconvert-clipboard-name";
const MAX_CLIPBOARD_METADATA_HEADER_BYTES: usize = 1_024;

fn clipboard_import_options(request: &Request<'_>) -> Result<ClipboardImageImportOptions, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => {
            return Err("剪贴板图片必须使用原始二进制 IPC 传输".to_string());
        }
    };
    let mime_type = decoded_optional_header(request, CLIPBOARD_MIME_HEADER)?;
    let suggested_name = decoded_optional_header(request, CLIPBOARD_NAME_HEADER)?;
    Ok(ClipboardImageImportOptions {
        bytes,
        mime_type,
        suggested_name,
    })
}

fn decoded_optional_header(request: &Request<'_>, name: &str) -> Result<Option<String>, String> {
    let Some(value) = request.headers().get(name) else {
        return Ok(None);
    };
    let encoded = value
        .to_str()
        .map_err(|_| format!("剪贴板元数据头无效: {name}"))?;
    if encoded.len() > MAX_CLIPBOARD_METADATA_HEADER_BYTES {
        return Err(format!("剪贴板元数据头过长: {name}"));
    }
    let decoded = decode_uri_component(encoded)?;
    if decoded.is_empty() {
        Ok(None)
    } else {
        Ok(Some(decoded))
    }
}

fn decode_uri_component(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = bytes
                .get(index + 1)
                .and_then(|byte| (*byte as char).to_digit(16));
            let low = bytes
                .get(index + 2)
                .and_then(|byte| (*byte as char).to_digit(16));
            let (Some(high), Some(low)) = (high, low) else {
                return Err("剪贴板元数据包含无效百分号编码".to_string());
            };
            decoded.push(((high << 4) | low) as u8);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| "剪贴板元数据不是有效 UTF-8".to_string())
}

/// 清理由剪贴板导入创建的临时文件。非本应用管理的路径会被忽略。
#[tauri::command]
fn cleanup_imported_temp_file(
    path: String,
    state: State<'_, ClipboardImportState>,
) -> Result<bool, CommandError> {
    import::cleanup_imported_temp_file(path, &state).map_err(CommandError::clipboard_import_failed)
}

/// AppImage 下使用宿主系统文件选择器,避免 WebKit/GTK dialog 进程内崩溃。
/// Flatpak 由前端改用 GTK portal picker,本命令也会拒绝在该沙盒中执行。
#[tauri::command]
async fn pick_paths(options: NativePickOptions) -> Result<Vec<String>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || native_dialog::pick_paths(&options))
        .await
        .map_err(|error| CommandError::task_failed(format!("文件选择器任务调度失败:{error}")))?
        .map_err(CommandError::native_dialog_failed)
}

/// 为队列项生成缩略图。全透明图片返回 null,前端保留格式占位。
#[tauri::command]
async fn generate_thumbnail(
    options: ThumbnailOptions,
) -> Result<Option<ThumbnailResult>, CommandError> {
    let input = options.input.clone();
    tauri::async_runtime::spawn_blocking(move || thumbnail::generate_thumbnail(options))
        .await
        .map_err(|error| CommandError::task_failed(format!("缩略图任务调度失败: {error}")))?
        .map_err(|detail| {
            convert::command_error_for_pdf(&input, &detail)
                .unwrap_or_else(|| CommandError::thumbnail_failed(input, detail))
        })
}

/// 运行与最终转换相同的内存工作流，仅返回有界 PNG 前后预览与标量统计。
#[tauri::command]
async fn generate_comparison_preview(
    options: PreviewOptions,
    state: State<'_, PreviewState>,
    service: State<'_, BatchService>,
) -> Result<tauri::ipc::Response, CommandError> {
    let input = options.conversion.input.clone();
    if service.is_active() {
        return Err(CommandError::preview_failed(
            input,
            "批量转换运行时不能生成预览",
        ));
    }
    // The registration is a drop guard that travels with the blocking worker:
    // the current-preview slot clears when the native call really ends, even
    // if this IPC future is dropped first.
    let preview = state
        .begin()
        .map_err(|detail| CommandError::preview_failed(input.clone(), detail))?;
    let cancel = preview.token();
    if service.is_active() {
        cancel.cancel();
        return Err(CommandError::preview_failed(
            input,
            "批量转换运行时不能生成预览",
        ));
    }
    let execution = service.execution_gate().handle();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _preview = preview;
        let _guard = preview::lock_workflow_execution_gate(&execution);
        if cancel.is_cancelled() {
            return Err("预览已取消".to_string());
        }
        preview::generate_preview(options, cancel)
    })
    .await
    .map_err(|error| CommandError::task_failed(format!("预览任务调度失败: {error}")))
    .and_then(|inner| {
        inner.map_err(|detail| {
            convert::command_error_for_pdf(&input, &detail)
                .unwrap_or_else(|| CommandError::preview_failed(input.clone(), detail))
        })
    });
    result.and_then(|preview| {
        preview::encode_ipc_payload(preview)
            .map(tauri::ipc::Response::new)
            .map_err(|detail| CommandError::preview_failed(input, detail))
    })
}

/// 请求取消当前比较预览。原生编码调用会在下一个可安全检查的边界停止。
#[tauri::command]
fn cancel_comparison_preview(state: State<'_, PreviewState>) -> bool {
    state.cancel_current()
}

/// 删除本应用创建的 metadata-only 转换结果缓存记录。
#[tauri::command]
fn clear_result_cache() -> Result<usize, CommandError> {
    result_cache::clear().map_err(CommandError::task_failed)
}

/// Test-only queue seed. Release builds compile this command as an inert null
/// response; debug E2E builds must also opt in at compile and runtime.
#[tauri::command]
fn desktop_e2e_seed() -> Option<DesktopE2ESeed> {
    if !cfg!(feature = "desktop-e2e")
        || std::env::var("IMGCONVERT_ENABLE_DESKTOP_E2E").as_deref() != Ok("1")
    {
        return None;
    }
    let input = std::env::var_os("IMGCONVERT_DESKTOP_E2E_INPUT").map(std::path::PathBuf::from)?;
    let pdf_input =
        std::env::var_os("IMGCONVERT_DESKTOP_E2E_PDF_INPUT").map(std::path::PathBuf::from)?;
    let out_dir =
        std::env::var_os("IMGCONVERT_DESKTOP_E2E_OUT_DIR").map(std::path::PathBuf::from)?;
    if !input.is_file() || !pdf_input.is_file() || !out_dir.is_dir() {
        return None;
    }
    Some(DesktopE2ESeed {
        input: input.to_string_lossy().to_string(),
        pdf_input: pdf_input.to_string_lossy().to_string(),
        out_dir: out_dir.to_string_lossy().to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    result_cache::cleanup_best_effort();
    import::cleanup_stale_clipboard_temp_dirs_best_effort();
    let builder = tauri::Builder::default()
        .manage(BatchService::new())
        .manage(PreviewState::default())
        .manage(ImportScanState::default())
        .manage(ClipboardImportState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init());

    #[cfg(feature = "updater")]
    let builder = if option_env!("IMGCONVERT_DISABLE_UPDATER") != Some("1") {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };

    builder
        .invoke_handler(tauri::generate_handler![
            file_access_runtime,
            capabilities,
            runtime_diagnostics,
            codec_diagnostics,
            set_selected_heic_helper,
            convert_batch,
            plan_conversions,
            cancel_batch,
            scan_import_paths,
            cancel_import_scan,
            import_clipboard_image,
            cleanup_imported_temp_file,
            pick_paths,
            generate_thumbnail,
            generate_comparison_preview,
            cancel_comparison_preview,
            clear_result_cache,
            desktop_e2e_seed,
            perf_probe::perf_probe_config,
            perf_probe::perf_probe_mark
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Exit path: cancel the running batch and wait for in-flight atomic writes.
            if let tauri::RunEvent::Exit = event {
                let service = app.state::<BatchService>();
                if service.shutdown(BATCH_SHUTDOWN_TIMEOUT)
                    == imgconvert_backend::service::ShutdownOutcome::TimedOut
                {
                    eprintln!("ImgConvert exited while a batch was still finishing");
                }
            }
        });
}

/// How long exit waits for a cancelled batch to reach a safe boundary.
const BATCH_SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg(test)]
mod tests {
    use super::decode_uri_component;

    #[test]
    fn decodes_clipboard_header_components_without_form_semantics() {
        assert_eq!(
            decode_uri_component("screen%20shot%20%E4%B8%AD%E6%96%87.png").unwrap(),
            "screen shot 中文.png"
        );
        assert_eq!(decode_uri_component("a+b.png").unwrap(), "a+b.png");
    }

    #[test]
    fn rejects_malformed_clipboard_header_components() {
        assert!(decode_uri_component("bad%2").is_err());
        assert!(decode_uri_component("%FF").is_err());
    }
}
