// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

mod access;
mod command_error;
mod convert;
mod external_codecs;
#[cfg(feature = "fuzzing")]
mod fuzzing;
mod import;
mod macos_security;
#[cfg(target_os = "macos")]
mod macos_system_codecs;
mod native_dialog;
mod pdf;
mod preview;
mod result_cache;
mod thumbnail;
#[cfg(target_os = "windows")]
mod windows_system_codecs;

use convert::{
    BatchProgressEvent, BatchState, BatchSummary, Capabilities, ConversionPlanEntry,
    ConvertOptions, RuntimeDiagnostics,
};
use import::{
    ClipboardImageImport, ClipboardImageImportOptions, ClipboardImportState, ImportScanFile,
    ImportScanResult, ImportScanState, ScanImportOptions,
};
use preview::{PreviewOptions, PreviewState, WorkflowExecutionGate};
use tauri::ipc::Channel;
use tauri::State;
use thumbnail::{ThumbnailOptions, ThumbnailResult};

use crate::external_codecs::{CodecDiagnostics, SelectedHelperDiagnostic};
use crate::native_dialog::NativePickOptions;
use command_error::CommandError;

pub use convert::ConvertResult;

#[cfg(feature = "fuzzing")]
#[doc(hidden)]
pub use fuzzing::{fuzz_external_codec_manifest, fuzz_import_scan_bytes, fuzz_pdf_document};

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
    convert::convert(&options)
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
    state: State<'_, BatchState>,
    preview_state: State<'_, PreviewState>,
    execution_gate: State<'_, WorkflowExecutionGate>,
) -> Result<BatchSummary, CommandError> {
    let batch = state.begin().map_err(CommandError::batch_failed)?;
    // Register the batch before cancelling preview. A preview that raced past its first active
    // check will either already be current and get cancelled here, or observe the active batch in
    // its post-registration check below.
    preview_state.cancel_current();
    let batch_id = batch.id();
    let cancel = batch.token();
    let execution = execution_gate.handle();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = preview::lock_workflow_execution_gate(&execution);
        convert::convert_batch(options, progress, cancel, concurrency)
    })
    .await
    .map_err(|error| CommandError::task_failed(format!("批量任务调度失败: {error}")))
    .and_then(|inner| inner.map_err(CommandError::batch_failed));

    state.finish(batch_id);
    result
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
fn cancel_batch(state: State<'_, BatchState>) -> bool {
    state.cancel_current()
}

/// 扫描用户显式授权的文件/目录路径,递归过滤出可读图片文件。
#[tauri::command]
async fn scan_import_paths(
    options: ScanImportOptions,
    state: State<'_, ImportScanState>,
) -> Result<ImportScanResult, CommandError> {
    let scan = state
        .begin()
        .map_err(|detail| CommandError::import_failed(None, detail))?;
    let scan_id = scan.id();
    let cancel = scan.token();

    let result =
        tauri::async_runtime::spawn_blocking(move || import::scan_import_paths(options, cancel))
            .await
            .map_err(|error| CommandError::task_failed(format!("导入扫描任务调度失败: {error}")));

    state.finish(scan_id);
    result
}

/// 请求取消当前导入扫描。返回值表示是否找到正在运行的扫描并发出取消信号。
#[tauri::command]
fn cancel_import_scan(state: State<'_, ImportScanState>) -> bool {
    state.cancel_current()
}

/// 把剪贴板图片写入受控临时文件,并作为普通导入文件返回给前端队列。
#[tauri::command]
async fn import_clipboard_image(
    options: ClipboardImageImportOptions,
    state: State<'_, ClipboardImportState>,
) -> Result<ImportScanFile, CommandError> {
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
    batch_state: State<'_, BatchState>,
    execution_gate: State<'_, WorkflowExecutionGate>,
) -> Result<tauri::ipc::Response, CommandError> {
    let input = options.conversion.input.clone();
    if batch_state.is_active() {
        return Err(CommandError::preview_failed(
            input,
            "批量转换运行时不能生成预览",
        ));
    }
    let preview = state
        .begin()
        .map_err(|detail| CommandError::preview_failed(input.clone(), detail))?;
    let generation = preview.id();
    let cancel = preview.token();
    if batch_state.is_active() {
        cancel.cancel();
        state.finish(generation);
        return Err(CommandError::preview_failed(
            input,
            "批量转换运行时不能生成预览",
        ));
    }
    let execution = execution_gate.handle();
    let result = tauri::async_runtime::spawn_blocking(move || {
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
    state.finish(generation);
    result.and_then(|preview| {
        preview::into_ipc_response(preview)
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
        .manage(BatchState::default())
        .manage(PreviewState::default())
        .manage(WorkflowExecutionGate::default())
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
            desktop_e2e_seed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
