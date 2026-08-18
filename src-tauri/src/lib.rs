// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

mod access;
mod convert;
mod external_codecs;
mod import;
mod macos_security;
#[cfg(target_os = "macos")]
mod macos_system_codecs;
mod native_dialog;
mod thumbnail;
#[cfg(target_os = "windows")]
mod windows_system_codecs;

use convert::{
    BatchProgressEvent, BatchState, BatchSummary, Capabilities, ConversionPlanEntry,
    ConvertOptions, RuntimeDiagnostics,
};
use import::{
    ClipboardImageImportOptions, ClipboardImportState, ImportScanFile, ImportScanResult,
    ImportScanState, ScanImportOptions,
};
use tauri::ipc::Channel;
use tauri::State;
use thumbnail::{ThumbnailOptions, ThumbnailResult};

use crate::external_codecs::{CodecDiagnostics, SelectedHelperDiagnostic};
use crate::native_dialog::NativePickOptions;

pub use convert::ConvertResult;

pub fn run_path_conversion_smoke(
    input: String,
    out_dir: Option<String>,
    format: String,
) -> Result<ConvertResult, String> {
    let options = convert::path_conversion_smoke_options(input, out_dir, format);
    convert::convert(&options)
}

/// 返回当前宿主平台,供前端选择平台专属系统集成路径。
#[tauri::command]
fn host_platform() -> &'static str {
    std::env::consts::OS
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
fn set_selected_heic_helper(path: Option<String>) -> Result<SelectedHelperDiagnostic, String> {
    external_codecs::set_selected_heic_helper(path)
}

/// 转换单张图片。前端按文件循环调用以便逐项汇报进度。
#[tauri::command]
async fn convert_image(options: ConvertOptions) -> Result<ConvertResult, String> {
    // 图像编解码和文件 IO 都是阻塞工作,放到阻塞线程池避免卡住异步运行时。
    tauri::async_runtime::spawn_blocking(move || convert::convert(&options))
        .await
        .map_err(|e| format!("任务调度失败: {e}"))?
}

/// 批量转换图片。进度通过 Tauri Channel 返回,取消在文件边界生效。
#[tauri::command]
async fn convert_batch(
    options: Vec<ConvertOptions>,
    progress: Channel<BatchProgressEvent>,
    concurrency: Option<usize>,
    state: State<'_, BatchState>,
) -> Result<BatchSummary, String> {
    let batch = state.begin()?;
    let batch_id = batch.id();
    let cancel = batch.token();

    let result = tauri::async_runtime::spawn_blocking(move || {
        convert::convert_batch(options, progress, cancel, concurrency)
    })
    .await
    .map_err(|e| format!("批量任务调度失败: {e}"))
    .and_then(|inner| inner);

    state.finish(batch_id);
    result
}

/// 批量规划输出路径,供 ask 覆盖模式在转换开始前确认。
#[tauri::command]
async fn plan_conversions(
    options: Vec<ConvertOptions>,
) -> Result<Vec<ConversionPlanEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || convert::conversion_plan(&options))
        .await
        .map_err(|e| format!("转换规划任务调度失败: {e}"))
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
) -> Result<ImportScanResult, String> {
    let scan = state.begin()?;
    let scan_id = scan.id();
    let cancel = scan.token();

    let result =
        tauri::async_runtime::spawn_blocking(move || import::scan_import_paths(options, cancel))
            .await
            .map_err(|e| format!("导入扫描任务调度失败: {e}"));

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
) -> Result<ImportScanFile, String> {
    let clipboard_import =
        tauri::async_runtime::spawn_blocking(move || import::import_clipboard_image(options))
            .await
            .map_err(|e| format!("剪贴板导入任务调度失败: {e}"))??;
    if let Err(error) = state.register(clipboard_import.managed_path.clone()) {
        import::cleanup_clipboard_file_best_effort(&clipboard_import.managed_path);
        return Err(error);
    }
    Ok(clipboard_import.file)
}

/// 清理由剪贴板导入创建的临时文件。非本应用管理的路径会被忽略。
#[tauri::command]
fn cleanup_imported_temp_file(
    path: String,
    state: State<'_, ClipboardImportState>,
) -> Result<bool, String> {
    import::cleanup_imported_temp_file(path, &state)
}

/// Linux AppImage 下优先使用宿主系统文件选择器,避免 WebKit/GTK dialog 进程内崩溃。
#[tauri::command]
async fn pick_paths(options: NativePickOptions) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || native_dialog::pick_paths(&options))
        .await
        .map_err(|e| format!("文件选择器任务调度失败:{e}"))?
}

/// 为队列项生成缩略图。全透明图片返回 null,前端保留格式占位。
#[tauri::command]
async fn generate_thumbnail(options: ThumbnailOptions) -> Result<Option<ThumbnailResult>, String> {
    tauri::async_runtime::spawn_blocking(move || thumbnail::generate_thumbnail(options))
        .await
        .map_err(|e| format!("缩略图任务调度失败: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(BatchState::default())
        .manage(ImportScanState::default())
        .manage(ClipboardImportState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    if option_env!("IMGCONVERT_DISABLE_UPDATER") != Some("1") {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            host_platform,
            capabilities,
            runtime_diagnostics,
            codec_diagnostics,
            set_selected_heic_helper,
            convert_image,
            convert_batch,
            plan_conversions,
            cancel_batch,
            scan_import_paths,
            cancel_import_scan,
            import_clipboard_image,
            cleanup_imported_temp_file,
            pick_paths,
            generate_thumbnail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
