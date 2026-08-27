// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Tauri 转换命令胶水。
//!
//! 图片编解码由 `imgconvert-core` 进程内完成；这里只负责路径解析、文件读写、
//! 覆盖策略和前端能力矩阵。

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File, FileTimes, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use imgconvert_core::{
    AutoQualityOptions, AvifSubsample, ColorManagementPolicy, EncodeOptions, Format, RawMetadata,
    LOSSLESS_FORMATS, READABLE_FORMATS, WRITABLE_FORMATS,
};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use crate::access;
use crate::command_error::CommandError;
use crate::external_codecs;

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);
const MAX_BATCH_CONCURRENCY: usize = 8;
const BATCH_MEMORY_BUDGET_BYTES: u64 = 768 * 1024 * 1024;
const UNKNOWN_JOB_MEMORY_BYTES: u64 = 128 * 1024 * 1024;
const RGBA_WORKING_SET_MULTIPLIER: u64 = 3;
const CONVERT_WALL_CLOCK_TIMEOUT_ENV: &str = "IMGCONVERT_CONVERT_TIMEOUT_SECONDS";
const DEFAULT_CONVERT_WALL_CLOCK_TIMEOUT_SECONDS: u64 = 180;
const MIN_CONVERT_WALL_CLOCK_TIMEOUT_SECONDS: u64 = 5;
const MAX_CONVERT_WALL_CLOCK_TIMEOUT_SECONDS: u64 = 900;
const INPUT_FILE_NOT_FOUND_PREFIX: &str = "输入文件不存在:";
const INPUT_PERMISSION_DENIED_PREFIX: &str = "没有权限访问输入文件:";
const OUTPUT_PERMISSION_DENIED_PREFIX: &str = "没有权限写入输出目录:";
const UNSUPPORTED_TARGET_FORMAT_PREFIX: &str = "不支持的目标格式:";
const HEIC_OUTPUT_DISABLED_PREFIX: &str = "HEIC 输出暂未启用";
const TIFF_OUTPUT_UNSUPPORTED_PREFIX: &str = "TIFF 暂未纳入";
const OUTPUT_EXISTS_PREFIX: &str = "输出已存在";
const INVALID_OUTPUT_SUFFIX_PREFIX: &str = "输出后缀无效:";
const SOURCE_OVERWRITE_CONFIRMATION_REQUIRED_PREFIX: &str = "覆盖源文件需要明确确认:";
const OUTPUT_CONFLICTS_WITH_INPUT_PREFIX: &str = "输出路径与批次输入冲突:";
const OUTPUT_SAFETY_CHECK_PREFIX: &str = "无法安全验证输出路径:";
const OUTPUT_NOT_SMALLER_PREFIX: &str = "候选输出不小于源文件";
const GENERATION_LOSS_GUARD_PREFIX: &str = "代际损失防护:";
const MAX_OUTPUT_SUFFIX_CHARS: usize = 48;
const MAX_OUTPUT_SUFFIX_BYTES: usize = 128;
// Core decoders receive byte slices, so do not use `fs::read` on an arbitrary
// user file before any resource guard can run. This matches the thumbnail
// source ceiling and stays below the per-image RGBA working-set budget.
const MAX_CORE_SOURCE_FILE_BYTES: u64 = 256 * 1024 * 1024;
// Most commonly used filesystems allow a 255-byte filename component. Leave a
// safety margin for platform and encoding differences while preserving both
// the original stem and a user-entered suffix when a name is unusually long.
const MAX_OUTPUT_FILE_NAME_BYTES: usize = 240;

enum WriteMode {
    Replace,
    CreateNew,
}

struct IndexedConvertOptions {
    index: usize,
    options: ConvertOptions,
}

struct SourceForCore {
    bytes: Vec<u8>,
    metadata_override: Option<RawMetadata>,
}

/// A copyable file identity used only while planning a batch. Unlike
/// `same_file::Handle`, this does not retain an open file descriptor for each
/// queued input. The OS metadata is intentionally obtained under the same
/// scoped-access boundary as conversion work.
#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy)]
struct FileIdentity {
    legacy_volume_serial_number: u32,
    legacy_file_index: u64,
    file_id: Option<(u64, [u8; 16])>,
}

#[cfg(windows)]
impl PartialEq for FileIdentity {
    fn eq(&self, other: &Self) -> bool {
        match (self.file_id, other.file_id) {
            (Some(left), Some(right)) => left == right,
            // If `FILE_ID_INFO` is unavailable for either path (older or
            // remote filesystem), compare the legacy pair. This can only
            // produce a conservative false positive on uncommon ReFS cases;
            // it must never turn a potential source collision into a miss.
            _ => {
                self.legacy_volume_serial_number == other.legacy_volume_serial_number
                    && self.legacy_file_index == other.legacy_file_index
            }
        }
    }
}

#[cfg(windows)]
impl Eq for FileIdentity {}

#[cfg(windows)]
impl std::hash::Hash for FileIdentity {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        // Hash the compatibility pair because equality may deliberately use
        // it when either side lacks a 128-bit file id. Collisions remain safe:
        // `PartialEq` resolves them with the stronger id whenever both exist.
        state.write_u32(self.legacy_volume_serial_number);
        state.write_u64(self.legacy_file_index);
    }
}

// There are no currently supported desktop targets outside Unix and Windows,
// but retaining a normalized-path fallback keeps this safety code portable.
#[cfg(not(any(unix, windows)))]
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct FileIdentity {
    canonical_path: PathBuf,
}

/// 前端启动时读取的进程内 core 能力矩阵。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub readable: Vec<&'static str>,
    pub writable: Vec<&'static str>,
    pub lossless: Vec<&'static str>,
    pub color_pipeline: ColorPipelineCapability,
    /// 主程序不内置 HEIC；可选外部 provider 可在运行时启用 HEIC 导入。
    pub heic: bool,
    /// 可选外部 codec provider。主程序不链接这些 provider 的 codec 库。
    pub codec_providers: Vec<CodecProviderCapability>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorPipelineCapability {
    pub rgba8: bool,
    pub rgba16: bool,
    pub rgba_f32: bool,
    pub linear_resize: bool,
    pub icc_transform: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodecProviderCapability {
    pub id: String,
    pub kind: String,
    pub license: Option<String>,
    pub readable: Vec<String>,
    pub writable: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnostics {
    pub available_parallelism: usize,
    pub default_batch_concurrency: usize,
    pub max_batch_concurrency: usize,
    pub batch_memory_budget_bytes: u64,
    pub unknown_job_memory_bytes: u64,
    pub rgba_working_set_multiplier: u64,
    pub avif_encoder_max_threads: i32,
    pub auto_quality_max_scoring_evaluations: usize,
    pub convert_wall_clock_timeout_seconds: Option<u64>,
}

/// 单张图片的转换参数,由前端传入。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertOptions {
    /// 输入文件绝对路径。
    pub input: String,
    /// 输出目录(若为空则与输入同目录；macOS/portal 沙盒前端会先要求用户选择目录)。
    pub out_dir: Option<String>,
    /// 从导入目录根到输入文件父目录的相对目录,用于保留目录结构。
    pub relative_dir: Option<String>,
    /// 导入阶段探测到的源图宽度;仅作为批量内存预算提示,core 仍会自行校验真实尺寸。
    #[serde(default)]
    pub source_width: Option<u32>,
    /// 导入阶段探测到的源图高度;仅作为批量内存预算提示,core 仍会自行校验真实尺寸。
    #[serde(default)]
    pub source_height: Option<u32>,
    /// 目标格式:avif | webp | jpeg | png。
    pub format: String,
    /// 质量 1-100(有损时生效)。
    pub quality: u8,
    /// 有损质量下限 30-100;低于 30 视为禁用。旧前端缺字段时保持兼容。
    #[serde(default)]
    pub quality_floor: u8,
    /// 是否无损(对支持的格式生效:png/webp/avif)。
    pub lossless: bool,
    /// JPEG 是否使用 progressive scan。
    #[serde(default = "default_jpeg_progressive")]
    pub jpeg_progressive: bool,
    /// oxipng 优化级别 0..=6。
    #[serde(default = "default_png_oxipng_level")]
    pub png_oxipng_level: u8,
    /// 实验性 PNG 有损限色。
    #[serde(default)]
    pub png_lossy_quantize: bool,
    /// PNG 限色颜色数。
    #[serde(default = "default_png_quant_colors")]
    pub png_quant_colors: u16,
    /// WebP method 0..=6。
    #[serde(default = "default_webp_method")]
    pub webp_method: u8,
    /// AVIF speed 0..=10(越大越快)。
    #[serde(default = "default_avif_speed")]
    pub avif_speed: u8,
    /// AVIF subsample:yuv444 | yuv420。
    #[serde(default = "default_avif_subsample")]
    pub avif_subsample: String,
    /// WebP near-lossless 0..=100。100 表示关闭。
    #[serde(default = "default_webp_near_lossless")]
    pub webp_near_lossless: u8,
    /// WebP sharp YUV 转换。
    #[serde(default)]
    pub webp_sharp_yuv: bool,
    /// MozJPEG trellis。
    #[serde(default = "default_jpeg_trellis")]
    pub jpeg_trellis: bool,
    /// JPEG/WebP 自动质量,用 SSIMULACRA2 搜索达到目标分的最低质量。
    #[serde(default)]
    pub auto_quality: bool,
    /// 自动质量目标分。
    #[serde(default = "default_auto_quality_score")]
    pub auto_quality_score: f64,
    /// 仅压缩工作流可选：对有损源再次输出有损格式时要求足够体积收益才写入。
    #[serde(default = "default_generation_loss_protection")]
    pub generation_loss_protection: bool,
    /// 根据源文件 blake3 + 编码设置 hash 复用已存在输出。
    #[serde(default = "default_result_cache")]
    pub result_cache: bool,
    /// 仅压缩工作流可选：候选输出不小于源文件时跳过写入。
    #[serde(default = "default_skip_if_larger")]
    pub skip_if_larger: bool,
    /// 同一目标格式下尝试多个等价编码候选并取最小输出。
    #[serde(default = "default_multi_candidate")]
    pub multi_candidate: bool,
    /// 是否覆盖已存在的输出文件。
    pub overwrite: bool,
    /// 覆盖策略:ask | skip | overwrite。ask 由前端确认后以 overwrite 重试。
    pub overwrite_mode: Option<String>,
    /// 文件名模板,支持 %name% / %extension% / %date%。
    pub file_name_template: Option<String>,
    /// 输出文件名追加的字面后缀。存在时优先于旧的文件名模板，且不会解析模板占位符。
    #[serde(default)]
    pub output_suffix: Option<String>,
    /// 仅由本次明确确认生成的短生命周期授权；后端仍会拒绝未授权的原图覆盖。
    #[serde(default)]
    pub allow_source_overwrite: bool,
    /// 元数据保留开关预留;core P2 才实现实际透传。
    pub preserve_metadata: Option<bool>,
    /// 色彩管理策略:preserve | convertToSrgb。
    #[serde(default)]
    pub color_management_policy: Option<String>,
}

fn default_jpeg_progressive() -> bool {
    EncodeOptions::default().jpeg_progressive
}

fn default_png_oxipng_level() -> u8 {
    EncodeOptions::default().png_oxipng_level
}

fn default_png_quant_colors() -> u16 {
    EncodeOptions::default().png_quant_colors
}

fn default_webp_method() -> u8 {
    EncodeOptions::default().webp_method
}

fn default_avif_speed() -> u8 {
    EncodeOptions::default().avif_speed
}

fn default_avif_subsample() -> String {
    "yuv444".to_string()
}

fn default_webp_near_lossless() -> u8 {
    EncodeOptions::default().webp_near_lossless
}

fn default_jpeg_trellis() -> bool {
    EncodeOptions::default().jpeg_trellis
}

fn default_auto_quality_score() -> f64 {
    80.0
}

fn default_generation_loss_protection() -> bool {
    false
}

fn default_result_cache() -> bool {
    true
}

fn default_skip_if_larger() -> bool {
    false
}

fn default_multi_candidate() -> bool {
    true
}

/// 单张转换结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    pub input: String,
    pub output: String,
    /// 输入文件大小(字节)。
    pub in_size: u64,
    /// 输出文件大小(字节)。
    pub out_size: u64,
    /// 转换已完成但用户仍应知晓的非致命文件系统状态。
    pub warning: Option<ConvertWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "code")]
pub enum ConvertWarning {
    PreviousOutputBackupRetained { path: String },
}

/// 转换前输出路径规划,用于前端 ask 覆盖策略一次性收集决策。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionPlanEntry {
    pub index: usize,
    pub input: String,
    pub output: Option<String>,
    pub exists: bool,
    pub same_as_source: bool,
    pub conflicts_with_queued_input: bool,
    pub error: Option<CommandError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummary {
    pub total: usize,
    pub completed: usize,
    pub skipped: usize,
    pub failed: usize,
    pub cancelled: bool,
}

/// 语言无关的批量进度阶段；前端按当前 locale 映射为用户文案。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BatchProgressStage {
    ReadingAndConverting,
    Done,
}

/// 批量转换进度事件。`index` 是本次 batch options 数组中的下标。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum BatchProgressEvent {
    Started {
        total: usize,
    },
    FileStarted {
        index: usize,
        input: String,
    },
    FileProgress {
        index: usize,
        percent: f64,
        stage: BatchProgressStage,
    },
    FileFinished {
        index: usize,
        result: ConvertResult,
    },
    FileSkipped {
        index: usize,
        input: String,
        error: CommandError,
    },
    FileError {
        index: usize,
        input: String,
        error: CommandError,
    },
    Cancelled {
        completed: usize,
        total: usize,
    },
    Finished {
        summary: BatchSummary,
    },
}

#[derive(Default)]
pub struct BatchState {
    current: Mutex<Option<BatchHandle>>,
    next_id: AtomicU64,
}

struct BatchHandle {
    id: u64,
    token: CancellationToken,
}

pub struct BatchRegistration {
    id: u64,
    token: CancellationToken,
}

impl BatchState {
    pub fn begin(&self) -> Result<BatchRegistration, String> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "批量任务状态锁已损坏".to_string())?;
        if current.is_some() {
            return Err("已有批量任务正在运行".to_string());
        }

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let token = CancellationToken::new();
        *current = Some(BatchHandle {
            id,
            token: token.clone(),
        });
        Ok(BatchRegistration { id, token })
    }

    pub fn finish(&self, id: u64) {
        if let Ok(mut current) = self.current.lock() {
            if current.as_ref().is_some_and(|handle| handle.id == id) {
                *current = None;
            }
        }
    }

    pub fn cancel_current(&self) -> bool {
        if let Ok(current) = self.current.lock() {
            if let Some(handle) = current.as_ref() {
                handle.token.cancel();
                return true;
            }
        }
        false
    }
}

impl BatchRegistration {
    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

/// 返回当前平台/core 支持的格式能力。
pub fn capabilities() -> Capabilities {
    capabilities_with_heic_provider(external_codecs::heic_provider_info())
}

pub fn runtime_diagnostics() -> RuntimeDiagnostics {
    RuntimeDiagnostics {
        available_parallelism: thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1),
        default_batch_concurrency: default_batch_concurrency(),
        max_batch_concurrency: MAX_BATCH_CONCURRENCY,
        batch_memory_budget_bytes: BATCH_MEMORY_BUDGET_BYTES,
        unknown_job_memory_bytes: UNKNOWN_JOB_MEMORY_BYTES,
        rgba_working_set_multiplier: RGBA_WORKING_SET_MULTIPLIER,
        avif_encoder_max_threads: imgconvert_core::AVIF_ENCODER_MAX_THREADS,
        auto_quality_max_scoring_evaluations: imgconvert_core::AUTO_QUALITY_MAX_SCORING_EVALUATIONS,
        convert_wall_clock_timeout_seconds: convert_wall_clock_timeout()
            .ok()
            .flatten()
            .map(|timeout| timeout.as_secs()),
    }
}

fn capabilities_with_heic_provider(
    heic_provider: Option<external_codecs::CodecProviderInfo>,
) -> Capabilities {
    let mut readable = format_ids(READABLE_FORMATS);
    let mut codec_providers = Vec::new();
    if let Some(provider) = heic_provider {
        readable.push("heic");
        codec_providers.push(CodecProviderCapability {
            id: provider.id,
            kind: provider.kind.to_string(),
            license: provider.license,
            readable: provider.readable,
            writable: provider.writable,
        });
    }
    Capabilities {
        readable,
        writable: format_ids(WRITABLE_FORMATS),
        lossless: format_ids(LOSSLESS_FORMATS),
        color_pipeline: color_pipeline_capability(),
        heic: !codec_providers.is_empty(),
        codec_providers,
    }
}

fn color_pipeline_capability() -> ColorPipelineCapability {
    let caps = imgconvert_core::color_pipeline_capabilities();
    ColorPipelineCapability {
        rgba8: caps.rgba8,
        rgba16: caps.rgba16,
        rgba_f32: caps.rgba_f32,
        linear_resize: caps.linear_resize,
        icc_transform: caps.icc_transform,
    }
}

fn format_ids(formats: &[Format]) -> Vec<&'static str> {
    formats.iter().map(|format| format.id()).collect()
}

fn parse_format(format: &str) -> Result<Format, String> {
    match format.to_ascii_lowercase().as_str() {
        "jpeg" | "jpg" => Ok(Format::Jpeg),
        "png" => Ok(Format::Png),
        "webp" => Ok(Format::WebP),
        "avif" => Ok(Format::Avif),
        "heic" | "heif" => Err(format!(
            "{HEIC_OUTPUT_DISABLED_PREFIX};当前仅作为可选导入格式"
        )),
        "tiff" | "tif" => Err(format!("{TIFF_OUTPUT_UNSUPPORTED_PREFIX} v1 可写格式")),
        other => Err(format!("{UNSUPPORTED_TARGET_FORMAT_PREFIX} {other}")),
    }
}

/// 计算目标格式对应的文件扩展名。
fn ext_for_format(format: &str) -> Result<&'static str, String> {
    parse_format(format).map(Format::default_extension)
}

fn date_stamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    // Howard Hinnant civil-from-days algorithm, public domain.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    format!("{year:04}{m:02}{d:02}")
}

fn sanitize_file_stem(stem: &str) -> String {
    let cleaned: String = stem
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect();
    let trimmed = cleaned.trim_matches([' ', '.']);
    if trimmed.is_empty() {
        "converted".to_string()
    } else if is_windows_reserved_file_stem(trimmed) {
        format!("_{trimmed}")
    } else {
        trimmed.to_string()
    }
}

fn is_windows_reserved_file_stem(stem: &str) -> bool {
    let base = stem
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_matches([' ', '.'])
        .to_ascii_uppercase();
    matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || base
            .strip_prefix("COM")
            .or_else(|| base.strip_prefix("LPT"))
            .is_some_and(|number| {
                matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

fn validated_output_suffix(raw: &str) -> Result<String, String> {
    let suffix = raw.trim();
    if suffix.is_empty() {
        return Err(format!("{INVALID_OUTPUT_SUFFIX_PREFIX}不能为空"));
    }
    if suffix.chars().count() > MAX_OUTPUT_SUFFIX_CHARS || suffix.len() > MAX_OUTPUT_SUFFIX_BYTES {
        return Err(format!(
            "{INVALID_OUTPUT_SUFFIX_PREFIX}最多 {MAX_OUTPUT_SUFFIX_CHARS} 个字符"
        ));
    }
    if suffix.chars().any(|ch| {
        ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
    }) {
        return Err(format!(
            "{INVALID_OUTPUT_SUFFIX_PREFIX}不能包含路径分隔符或系统保留字符"
        ));
    }
    Ok(suffix.to_string())
}

fn truncate_utf8_prefix(input: &str, max_bytes: usize) -> &str {
    if input.len() <= max_bytes {
        return input;
    }

    let mut end = 0;
    for (index, ch) in input.char_indices() {
        let next = index + ch.len_utf8();
        if next > max_bytes {
            break;
        }
        end = next;
    }
    &input[..end]
}

fn truncate_utf8_suffix(input: &str, max_bytes: usize) -> &str {
    if input.len() <= max_bytes {
        return input;
    }

    let start = input
        .char_indices()
        .find_map(|(index, _)| (input.len() - index <= max_bytes).then_some(index))
        .unwrap_or(input.len());
    &input[start..]
}

fn truncate_output_stem(output_stem: String, ext: &str) -> String {
    let extension_bytes = ext.len() + 1;
    let max_stem_bytes = MAX_OUTPUT_FILE_NAME_BYTES.saturating_sub(extension_bytes);
    if output_stem.len() <= max_stem_bytes {
        return output_stem;
    }

    // Keep a meaningful tail (usually the user suffix) as well as the source
    // name prefix. `~` also makes the automatic shortening visible.
    let tail_budget = 48.min(max_stem_bytes / 3);
    let head_budget = max_stem_bytes.saturating_sub(tail_budget + 1);
    let head = truncate_utf8_prefix(&output_stem, head_budget);
    let tail = truncate_utf8_suffix(&output_stem, tail_budget);
    let shortened = format!("{head}~{tail}");
    if shortened.is_empty() {
        "converted".to_string()
    } else {
        shortened
    }
}

fn apply_file_name_template(template: Option<&str>, source_stem: &str, ext: &str) -> String {
    let template = template
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("%name%");
    let rendered = template
        .replace("%name%", source_stem)
        .replace("%extension%", ext)
        .replace("%date%", &date_stamp());
    sanitize_file_stem(&rendered)
}

fn output_stem(opts: &ConvertOptions, source_stem: &str, ext: &str) -> String {
    let output_stem =
        apply_file_name_template(opts.file_name_template.as_deref(), source_stem, ext);
    truncate_output_stem(sanitize_file_stem(&output_stem), ext)
}

fn output_file_name(output_stem: String, ext: &str) -> String {
    let extension = format!(".{ext}");
    let stem = output_stem
        .strip_suffix(&extension)
        .or_else(|| {
            output_stem
                .to_ascii_lowercase()
                .ends_with(&extension)
                .then(|| &output_stem[..output_stem.len() - extension.len()])
        })
        .unwrap_or(&output_stem);
    format!("{}{extension}", truncate_output_stem(stem.to_string(), ext))
}

/// Builds a suffix-mode filename without interpreting or normalizing the
/// suffix as a template/stem. This matters for values such as `.png`: the
/// user explicitly asked for `source.png.png`, not an extension-deduplicated
/// `source.png`. Reserve enough space for the entire validated suffix first,
/// then shorten only the source portion on a UTF-8 boundary.
fn output_file_name_with_suffix(
    source_stem: &str,
    raw_suffix: &str,
    ext: &str,
) -> Result<String, String> {
    let suffix = validated_output_suffix(raw_suffix)?;
    let source_stem = sanitize_file_stem(source_stem);
    let extension = format!(".{ext}");
    let reserved_bytes = suffix.len() + extension.len();
    let max_source_bytes = MAX_OUTPUT_FILE_NAME_BYTES
        .checked_sub(reserved_bytes)
        .ok_or_else(|| format!("{INVALID_OUTPUT_SUFFIX_PREFIX}与目标扩展名组合后过长"))?;
    let source_prefix = truncate_utf8_prefix(&source_stem, max_source_bytes);
    // `source_stem` is always non-empty after sanitizing and the suffix limit
    // leaves ample room for at least one source character. Keep a defensive
    // fallback so this invariant remains true if either limit changes later.
    let source_prefix = if source_prefix.is_empty() {
        truncate_utf8_prefix("converted", max_source_bytes)
    } else {
        source_prefix
    };
    let output_name = format!("{source_prefix}{suffix}{extension}");
    debug_assert!(output_name.len() <= MAX_OUTPUT_FILE_NAME_BYTES);
    Ok(output_name)
}

/// 根据输入路径与目标格式计算输出路径。
fn output_path(opts: &ConvertOptions) -> Result<PathBuf, String> {
    let input = Path::new(&opts.input);
    let stem = input
        .file_stem()
        .ok_or_else(|| format!("无法解析文件名: {}", opts.input))?;
    let ext = ext_for_format(&opts.format)?;
    let stem = stem.to_string_lossy();
    let output_name = match opts.output_suffix.as_deref() {
        Some(suffix) => output_file_name_with_suffix(&stem, suffix, ext)?,
        None => output_file_name(output_stem(opts, &stem, ext), ext),
    };

    let dir: PathBuf = match access::output_directory(opts.out_dir.as_deref()) {
        Some(grant) => {
            let mut dir = grant.into_path_buf();
            if let Some(relative_dir) = safe_relative_dir(opts.relative_dir.as_deref())? {
                dir.push(relative_dir);
            }
            dir
        }
        _ => input
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(".")),
    };

    Ok(dir.join(output_name))
}

fn safe_relative_dir(relative_dir: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(relative_dir) = relative_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    let path = Path::new(relative_dir);
    if path.is_absolute() {
        return Err(format!("输出相对目录不能是绝对路径: {relative_dir}"));
    }

    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => {
                let part = sanitize_file_stem(&part.to_string_lossy());
                if !part.is_empty() {
                    safe.push(part);
                }
            }
            std::path::Component::CurDir => {}
            _ => return Err(format!("输出相对目录包含非法路径片段: {relative_dir}")),
        }
    }

    if safe.as_os_str().is_empty() {
        Ok(None)
    } else {
        Ok(Some(safe))
    }
}

pub fn conversion_plan(options: &[ConvertOptions]) -> Vec<ConversionPlanEntry> {
    let input_identities = match input_identity_index(options) {
        Ok(identities) => identities,
        Err(error) => {
            // Do not claim that a batch is safe when a queued source could
            // not be identified. The batch command makes the same
            // conservative decision before it starts any writer.
            return options
                .iter()
                .enumerate()
                .map(|(index, options)| ConversionPlanEntry {
                    index,
                    input: options.input.clone(),
                    output: None,
                    exists: false,
                    same_as_source: false,
                    conflicts_with_queued_input: false,
                    error: Some(CommandError::output_safety_check_failed(
                        options.input.clone(),
                        error.clone(),
                    )),
                })
                .collect();
        }
    };
    options
        .iter()
        .enumerate()
        .map(|(index, options)| {
            let _input_scope = access::scoped_path_access(Path::new(&options.input));
            let _output_dir_scope = access::output_directory(options.out_dir.as_deref())
                .map(|grant| grant.scoped_access());
            let output = match output_path(options) {
                Ok(output) => output,
                Err(error) => {
                    return ConversionPlanEntry {
                        index,
                        input: options.input.clone(),
                        output: None,
                        exists: false,
                        same_as_source: false,
                        conflicts_with_queued_input: false,
                        error: Some(command_error_for_conversion(options, error)),
                    };
                }
            };
            let _output_scope = output.parent().map(access::scoped_path_access);
            let output_identity = match existing_file_identity(&output) {
                Ok(identity) => identity,
                Err(error) => {
                    return ConversionPlanEntry {
                        index,
                        input: options.input.clone(),
                        output: Some(output.to_string_lossy().to_string()),
                        exists: output_entry_exists(&output),
                        same_as_source: false,
                        conflicts_with_queued_input: false,
                        error: Some(CommandError::output_safety_check_failed(
                            output.to_string_lossy().to_string(),
                            error,
                        )),
                    };
                }
            };
            let input_indexes = output_identity
                .as_ref()
                .and_then(|identity| input_identities.get(identity));
            ConversionPlanEntry {
                index,
                input: options.input.clone(),
                exists: output_entry_exists(&output),
                same_as_source: input_indexes.is_some_and(|indexes| indexes.contains(&index)),
                conflicts_with_queued_input: input_indexes
                    .is_some_and(|indexes| indexes.iter().any(|input_index| *input_index != index)),
                output: Some(output.to_string_lossy().to_string()),
                error: None,
            }
        })
        .collect()
}

/// Converts the legacy, internal conversion error text into the stable IPC
/// contract at the command boundary. The strings remain internal diagnostics;
/// frontend code never renders them.
pub fn command_error_for_conversion(
    options: &ConvertOptions,
    detail: impl Into<String>,
) -> CommandError {
    let detail = detail.into();
    let output = || {
        output_path(options)
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|_| options.input.clone())
    };
    let output_directory = || {
        output_path(options)
            .ok()
            .and_then(|path| {
                path.parent()
                    .map(|parent| parent.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| {
                options
                    .out_dir
                    .clone()
                    .unwrap_or_else(|| options.input.clone())
            })
    };

    if detail.starts_with(INPUT_FILE_NOT_FOUND_PREFIX) {
        return CommandError::file_not_found(options.input.clone(), detail);
    }
    if detail.starts_with(INPUT_PERMISSION_DENIED_PREFIX) {
        return CommandError::permission_denied(options.input.clone(), detail);
    }
    if detail.starts_with(OUTPUT_PERMISSION_DENIED_PREFIX) {
        return CommandError::output_permission_denied(output_directory(), detail);
    }
    if detail.starts_with(UNSUPPORTED_TARGET_FORMAT_PREFIX)
        || detail.starts_with(HEIC_OUTPUT_DISABLED_PREFIX)
        || detail.starts_with(TIFF_OUTPUT_UNSUPPORTED_PREFIX)
    {
        return CommandError::unsupported_format(options.format.clone(), detail);
    }
    if detail.starts_with(OUTPUT_EXISTS_PREFIX) {
        return CommandError::output_exists(output(), detail);
    }
    if detail.starts_with(INVALID_OUTPUT_SUFFIX_PREFIX) {
        return CommandError::invalid_output_suffix(detail);
    }
    if detail.starts_with(SOURCE_OVERWRITE_CONFIRMATION_REQUIRED_PREFIX) {
        return CommandError::source_overwrite_confirmation_required(output(), detail);
    }
    if detail.starts_with(OUTPUT_CONFLICTS_WITH_INPUT_PREFIX) {
        return CommandError::output_conflicts_with_input(output(), detail);
    }
    if detail.starts_with(OUTPUT_SAFETY_CHECK_PREFIX) {
        return CommandError::output_safety_check_failed(output(), detail);
    }
    if detail.starts_with(OUTPUT_NOT_SMALLER_PREFIX)
        || detail.starts_with(GENERATION_LOSS_GUARD_PREFIX)
    {
        return CommandError::output_not_smaller(output(), detail);
    }

    CommandError::conversion_failed(options.input.clone(), detail)
}

fn output_io_error(operation: &str, out: &Path, error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        let directory = out.parent().unwrap_or_else(|| Path::new("."));
        return format!(
            "{OUTPUT_PERMISSION_DENIED_PREFIX} {}: {error}",
            directory.display()
        );
    }

    format!("{operation} {}: {error}", out.display())
}

fn temp_file(out: &Path) -> Result<(PathBuf, File), String> {
    let parent = out.parent().unwrap_or_else(|| Path::new("."));
    let pid = std::process::id();

    for _ in 0..64 {
        let counter = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let tmp = parent.join(format!(".imgconvert-{pid}-{nanos}-{counter}.tmp"));
        match OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(file) => return Ok((tmp, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(output_io_error("无法创建临时文件", out, &e)),
        }
    }

    Err("无法创建唯一临时文件".to_string())
}

fn write_output(
    out: &Path,
    bytes: &[u8],
    mode: WriteMode,
) -> Result<Option<ConvertWarning>, String> {
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| output_io_error("无法创建输出目录", out, &e))?;
    }

    match mode {
        WriteMode::Replace => replace_output(out, bytes),
        WriteMode::CreateNew => write_new_output(out, bytes).map(|()| None),
    }
}

fn write_temp_output(out: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let (tmp, mut tmp_file) = temp_file(out)?;
    if let Err(e) = tmp_file.write_all(bytes).and_then(|_| tmp_file.flush()) {
        drop(tmp_file);
        let cleanup = cleanup_partial_note(&tmp);
        let detail = output_io_error("无法写入临时文件", out, &e);
        return Err(format!("{detail}{cleanup}"));
    }
    drop(tmp_file);
    Ok(tmp)
}

fn replace_output(out: &Path, bytes: &[u8]) -> Result<Option<ConvertWarning>, String> {
    let tmp = write_temp_output(out, bytes)?;

    match fs::rename(&tmp, out) {
        Ok(()) => Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && output_entry_exists(out) => {
            replace_existing_output(&tmp, out)
        }
        Err(e) => {
            let cleanup = cleanup_partial_note(&tmp);
            let detail = output_io_error("无法写入输出文件", out, &e);
            Err(format!("{detail}{cleanup}"))
        }
    }
}

/// Windows cannot always replace an existing destination with `rename`. Stage the old output in
/// the same directory first, so a failure while placing the new file can be rolled back without
/// deleting the user's previous conversion result.
fn replace_existing_output(tmp: &Path, out: &Path) -> Result<Option<ConvertWarning>, String> {
    let mut rename = |from: &Path, to: &Path| fs::rename(from, to);
    replace_existing_output_with_rename(tmp, out, &mut rename)
}

fn replace_existing_output_with_rename<F>(
    tmp: &Path,
    out: &Path,
    rename: &mut F,
) -> Result<Option<ConvertWarning>, String>
where
    F: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    if let Err(error) = ensure_replaceable_output_entry(out) {
        let cleanup = cleanup_partial_note(tmp);
        return Err(format!("{error}{cleanup}"));
    }

    let backup = backup_path(out).map_err(|error| {
        let cleanup = cleanup_partial_note(tmp);
        format!("{error}{cleanup}")
    })?;
    if let Err(error) = rename(out, &backup) {
        if error.kind() == std::io::ErrorKind::NotFound {
            // The destination disappeared after the initial replacement attempt. It is now safe
            // to place the already-written temporary output without staging a previous file.
            return match rename(tmp, out) {
                Ok(()) => Ok(None),
                Err(rename_error) => {
                    let cleanup = cleanup_partial_note(tmp);
                    let detail = output_io_error("无法写入输出文件", out, &rename_error);
                    Err(format!("{detail}{cleanup}"))
                }
            };
        }

        let cleanup = cleanup_partial_note(tmp);
        let detail = output_io_error("无法暂存已存在的输出文件", out, &error);
        return Err(format!("{detail}{cleanup}"));
    }

    match rename(tmp, out) {
        Ok(()) => Ok(cleanup_output_backup(&backup)),
        Err(rename_error) => {
            let cleanup = cleanup_partial_note(tmp);
            let detail = output_io_error("无法写入输出文件", out, &rename_error);
            match rename(&backup, out) {
                Ok(()) => Err(format!("{detail}; 原文件已恢复{cleanup}")),
                Err(restore_error) => Err(format!(
                    "{detail}; 无法恢复原文件，备份位于 {}: {restore_error}{cleanup}",
                    backup.display()
                )),
            }
        }
    }
}

fn cleanup_output_backup(backup: &Path) -> Option<ConvertWarning> {
    let result = fs::remove_file(backup).or_else(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Ok(())
        } else {
            // Windows requires remove_dir for a directory symlink/junction. The backup path is
            // generated by this process, and directories are rejected before staging, so this
            // only broadens cleanup for link entries rather than recursively removing anything.
            fs::remove_dir(backup)
        }
    });

    match result {
        Ok(()) => None,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            eprintln!(
                "ImgConvert wrote the new output, but could not remove the previous-output backup {}: {error}",
                backup.display()
            );
            Some(ConvertWarning::PreviousOutputBackupRetained {
                path: backup.to_string_lossy().to_string(),
            })
        }
    }
}

fn backup_path(out: &Path) -> Result<PathBuf, String> {
    let parent = out.parent().unwrap_or_else(|| Path::new("."));
    let pid = std::process::id();

    for _ in 0..64 {
        let counter = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        // Keep the backup name independent of the original output name. A valid output filename
        // can already be at the filesystem's NAME_MAX limit, while a backup suffix would make a
        // staging rename fail and unnecessarily reject an otherwise valid overwrite.
        let candidate = parent.join(format!("imgconvert-backup-{pid}-{nanos}-{counter}"));
        match fs::symlink_metadata(&candidate) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
            Ok(_) => continue,
            Err(error) => return Err(output_io_error("无法检查输出备份路径", &candidate, &error)),
        }
    }

    Err("无法创建唯一输出备份路径".to_string())
}

fn output_entry_exists(path: &Path) -> bool {
    // `Path::exists` follows links and returns false for a dangling symlink.
    // A dangling link is still an existing destination entry that Windows may
    // reject as `AlreadyExists`, so stage the link itself in that case.
    fs::symlink_metadata(path).is_ok()
}

fn ensure_replaceable_output_entry(out: &Path) -> Result<(), String> {
    match fs::symlink_metadata(out) {
        Ok(metadata) if metadata.file_type().is_dir() => {
            Err(format!("无法覆盖目录输出路径 {}", out.display()))
        }
        // Renaming a symlink stages or replaces the link itself; it never follows the link to
        // remove its target. That preserves the previous behavior for linked output locations
        // while still preventing the backup dance from moving a directory.
        Ok(metadata) if metadata.file_type().is_file() || metadata.file_type().is_symlink() => {
            Ok(())
        }
        Ok(_) => Err(format!("无法覆盖非普通输出路径 {}", out.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(output_io_error("无法读取已有输出路径", out, &error)),
    }
}

fn write_new_output(out: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(out)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                format!("{OUTPUT_EXISTS_PREFIX}(未开启覆盖): {}", out.display())
            } else {
                output_io_error("无法创建输出文件", out, &e)
            }
        })?;

    if let Err(e) = file.write_all(bytes).and_then(|_| file.flush()) {
        drop(file);
        let cleanup = cleanup_partial_note(out);
        let detail = output_io_error("无法写入输出文件", out, &e);
        return Err(format!("{detail}{cleanup}"));
    }

    Ok(())
}

fn cleanup_partial_note(path: &Path) -> String {
    match fs::remove_file(path) {
        Ok(()) => format!("; 已清理半成品 {}", path.display()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            format!("; 半成品已不存在 {}", path.display())
        }
        Err(e) => format!("; 尝试清理半成品 {} 失败: {e}", path.display()),
    }
}

/// 执行一次转换。
pub fn convert(opts: &ConvertOptions) -> Result<ConvertResult, String> {
    let input = Path::new(&opts.input);
    let _input_scope = access::scoped_path_access(input);
    let input_metadata = fs::metadata(input).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => {
            format!("{INPUT_FILE_NOT_FOUND_PREFIX} {}", input.display())
        }
        std::io::ErrorKind::PermissionDenied => {
            format!("{INPUT_PERMISSION_DENIED_PREFIX} {}", input.display())
        }
        _ => format!("无法访问输入文件 {}: {error}", input.display()),
    })?;
    if !input_metadata.is_file() {
        return Err(format!("输入路径不是文件: {}", input.display()));
    }

    let _output_dir_scope =
        access::output_directory(opts.out_dir.as_deref()).map(|grant| grant.scoped_access());
    let out = output_path(opts)?;
    let _output_scope = out.parent().map(access::scoped_path_access);
    let source_modified = input_metadata.modified().ok();
    let overwrite_mode = match opts.overwrite_mode.as_deref() {
        Some(mode @ ("ask" | "skip" | "overwrite")) => mode,
        Some(other) => return Err(format!("不支持的覆盖策略: {other}")),
        None if opts.overwrite => "overwrite",
        None => "skip",
    };
    if overwrite_mode == "overwrite" {
        // `existing_file_identity` treats a verified-missing destination as
        // non-conflicting, but returns an error for an existing path whose
        // identity cannot be read. Never fail open here: this check guards the
        // explicit authorization boundary for source replacement.
        if let Some(output_identity) = existing_file_identity(&out)? {
            let input_identity = existing_file_identity(input)?.ok_or_else(|| {
                format!(
                    "{OUTPUT_SAFETY_CHECK_PREFIX} 无法读取输入文件身份: {}",
                    input.display()
                )
            })?;
            if output_identity == input_identity && !opts.allow_source_overwrite {
                return Err(format!(
                    "{SOURCE_OVERWRITE_CONFIRMATION_REQUIRED_PREFIX} {}",
                    out.display()
                ));
            }
        }
    }
    if output_entry_exists(&out) && overwrite_mode != "overwrite" {
        if overwrite_mode == "ask" {
            return Err(format!(
                "{OUTPUT_EXISTS_PREFIX}(需要确认覆盖): {}",
                out.display()
            ));
        }
        return Err(format!(
            "{OUTPUT_EXISTS_PREFIX}(未开启覆盖): {}",
            out.display()
        ));
    }

    let target = parse_format(&opts.format)?;
    let source_for_core = read_source_for_core(input)?;
    let source = &source_for_core.bytes;
    let metadata_override = source_for_core.metadata_override.as_ref();
    let source_format = Format::from_magic(source);
    let source_probe = imgconvert_core::probe(source).ok();
    let encode_options = encode_options_for(opts, target);
    let color_policy = color_management_policy_for(opts)?;
    let wall_clock_timeout = convert_wall_clock_timeout()?;
    let cache_key = opts.result_cache.then(|| {
        result_cache_key(
            opts,
            target,
            &encode_options,
            color_policy,
            source,
            metadata_override,
        )
    });
    if let Some(key) = cache_key.as_deref() {
        if let Some(out_size) = result_cache_hit(&out, key) {
            if let Some(message) = candidate_policy_error(
                opts,
                CandidatePolicyCheck {
                    source,
                    source_format,
                    target,
                    encode_options: &encode_options,
                    dimensions: source_probe
                        .as_ref()
                        .map(|probe| (probe.width, probe.height)),
                    source_size: input_metadata.len(),
                    candidate_size: out_size,
                },
            ) {
                return Err(message);
            }
            return Ok(ConvertResult {
                input: opts.input.clone(),
                output: out.to_string_lossy().to_string(),
                in_size: input_metadata.len(),
                out_size,
                warning: None,
            });
        }
    }
    let encoded = if should_use_auto_quality(opts, target, &encode_options) {
        let candidates = encode_candidates_for(opts, target, encode_options);
        convert_auto_quality_with_timeout(
            source,
            target,
            &candidates,
            AutoQualityOptions {
                min_quality: auto_quality_min(opts.quality_floor, encode_options.quality),
                target_score: opts.auto_quality_score.clamp(1.0, 100.0),
            },
            metadata_override,
            color_policy,
            wall_clock_timeout,
        )
        .map(|result| result.bytes)
        .map_err(|e| e.to_string())?
    } else if opts.multi_candidate {
        let candidates = encode_option_candidates(encode_options, target);
        convert_best_of_with_timeout(
            source,
            target,
            &candidates,
            metadata_override,
            color_policy,
            wall_clock_timeout,
        )
        .map_err(|e| e.to_string())?
    } else {
        convert_best_of_with_timeout(
            source,
            target,
            &[encode_options],
            metadata_override,
            color_policy,
            wall_clock_timeout,
        )
        .map_err(|e| e.to_string())?
    };
    let candidate_size = u64::try_from(encoded.len()).unwrap_or(u64::MAX);
    if let Some(message) = candidate_policy_error(
        opts,
        CandidatePolicyCheck {
            source,
            source_format,
            target,
            encode_options: &encode_options,
            dimensions: source_probe
                .as_ref()
                .map(|probe| (probe.width, probe.height)),
            source_size: input_metadata.len(),
            candidate_size,
        },
    ) {
        return Err(message);
    }

    let write_mode = if overwrite_mode == "overwrite" {
        WriteMode::Replace
    } else {
        WriteMode::CreateNew
    };
    let warning = write_output(&out, &encoded, write_mode)?;
    if let Some(modified) = source_modified {
        let _ = set_modified_time(&out, modified);
    }

    let in_size = input_metadata.len();
    let out_size = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    if let Some(key) = cache_key.as_deref() {
        write_result_cache_record(key, &encoded, out_size);
    }

    Ok(ConvertResult {
        input: opts.input.clone(),
        output: out.to_string_lossy().to_string(),
        in_size,
        out_size,
        warning,
    })
}

fn convert_best_of_with_timeout(
    source: &[u8],
    target: Format,
    candidates: &[EncodeOptions],
    metadata_override: Option<&RawMetadata>,
    color_policy: ColorManagementPolicy,
    timeout: Option<Duration>,
) -> imgconvert_core::Result<Vec<u8>> {
    if let Some(timeout) = timeout {
        imgconvert_core::convert_best_of_with_color_policy_timeout(
            source,
            target,
            candidates,
            metadata_override,
            color_policy,
            timeout,
        )
    } else {
        imgconvert_core::convert_best_of_with_color_policy(
            source,
            target,
            candidates,
            metadata_override,
            color_policy,
        )
    }
}

fn convert_auto_quality_with_timeout(
    source: &[u8],
    target: Format,
    candidates: &[EncodeOptions],
    auto: AutoQualityOptions,
    metadata_override: Option<&RawMetadata>,
    color_policy: ColorManagementPolicy,
    timeout: Option<Duration>,
) -> imgconvert_core::Result<imgconvert_core::AutoQualityResult> {
    if let Some(timeout) = timeout {
        imgconvert_core::convert_auto_quality_with_color_policy_timeout(
            source,
            target,
            candidates,
            &auto,
            metadata_override,
            color_policy,
            timeout,
        )
    } else {
        imgconvert_core::convert_auto_quality_with_color_policy(
            source,
            target,
            candidates,
            &auto,
            metadata_override,
            color_policy,
        )
    }
}

fn convert_wall_clock_timeout() -> Result<Option<Duration>, String> {
    parse_convert_wall_clock_timeout(
        std::env::var(CONVERT_WALL_CLOCK_TIMEOUT_ENV)
            .ok()
            .as_deref(),
    )
}

fn parse_convert_wall_clock_timeout(raw: Option<&str>) -> Result<Option<Duration>, String> {
    let Some(raw) = raw else {
        return Ok(Some(Duration::from_secs(
            DEFAULT_CONVERT_WALL_CLOCK_TIMEOUT_SECONDS,
        )));
    };
    let trimmed = raw.trim();
    if trimmed.eq_ignore_ascii_case("off")
        || trimmed.eq_ignore_ascii_case("disabled")
        || trimmed.eq_ignore_ascii_case("none")
        || trimmed == "0"
    {
        return Ok(None);
    }
    let seconds = trimmed
        .parse::<u64>()
        .map_err(|error| format!("{CONVERT_WALL_CLOCK_TIMEOUT_ENV} 必须是秒数或 off: {error}"))?;
    let seconds = seconds.clamp(
        MIN_CONVERT_WALL_CLOCK_TIMEOUT_SECONDS,
        MAX_CONVERT_WALL_CLOCK_TIMEOUT_SECONDS,
    );
    Ok(Some(Duration::from_secs(seconds)))
}

fn encode_options_for(opts: &ConvertOptions, target: Format) -> EncodeOptions {
    let lossless = opts.lossless && target.supports_lossless();
    EncodeOptions {
        quality: effective_quality(opts.quality, opts.quality_floor, target, lossless),
        lossless,
        jpeg_progressive: opts.jpeg_progressive,
        png_oxipng_level: opts.png_oxipng_level,
        png_lossy_quantize: opts.png_lossy_quantize,
        png_quant_colors: opts.png_quant_colors,
        webp_method: opts.webp_method,
        avif_speed: opts.avif_speed,
        avif_subsample: parse_avif_subsample(&opts.avif_subsample),
        // libwebp only applies near-lossless preprocessing in WebP lossless mode.
        // Normalize inactive values so they do not split candidates or result-cache keys.
        webp_near_lossless: if target == Format::WebP && lossless {
            opts.webp_near_lossless
        } else {
            default_webp_near_lossless()
        },
        webp_sharp_yuv: opts.webp_sharp_yuv,
        jpeg_trellis: opts.jpeg_trellis,
        preserve_metadata: opts.preserve_metadata.unwrap_or(false),
    }
}

fn parse_avif_subsample(value: &str) -> AvifSubsample {
    match value.to_ascii_lowercase().as_str() {
        "yuv420" | "420" | "4:2:0" => AvifSubsample::Yuv420,
        _ => AvifSubsample::Yuv444,
    }
}

fn color_management_policy_for(opts: &ConvertOptions) -> Result<ColorManagementPolicy, String> {
    match opts
        .color_management_policy
        .as_deref()
        .unwrap_or("preserve")
    {
        "preserve" | "preserveEmbeddedProfile" | "preserve-embedded-profile" => {
            Ok(ColorManagementPolicy::PreserveEmbeddedProfile)
        }
        "convertToSrgb" | "convert-to-srgb" | "srgb" => Ok(ColorManagementPolicy::ConvertToSrgb),
        other => Err(format!("不支持的色彩管理策略: {other}")),
    }
}

fn color_management_policy_id(policy: ColorManagementPolicy) -> &'static [u8] {
    match policy {
        ColorManagementPolicy::PreserveEmbeddedProfile => b"preserve",
        ColorManagementPolicy::ConvertToSrgb => b"convertToSrgb",
    }
}

fn effective_quality(requested: u8, floor: u8, target: Format, lossless: bool) -> u8 {
    let quality = requested.clamp(1, 100);
    if lossless || matches!(target, Format::Png) {
        return quality;
    }

    let floor = floor.clamp(0, 100);
    if floor < 30 {
        quality
    } else {
        quality.max(floor)
    }
}

fn encode_option_candidates(base: EncodeOptions, target: Format) -> Vec<EncodeOptions> {
    let mut candidates = Vec::new();
    push_unique_candidate(&mut candidates, base);

    match target {
        Format::Jpeg => {
            let mut alternate = base;
            alternate.jpeg_progressive = !base.jpeg_progressive;
            push_unique_candidate(&mut candidates, alternate);
        }
        Format::Png => {
            let level = base.png_oxipng_level.min(6);
            for candidate_level in [level.saturating_sub(1), level, (level + 1).min(6), 4, 6] {
                let mut alternate = base;
                alternate.png_oxipng_level = candidate_level;
                push_unique_candidate(&mut candidates, alternate);
            }
        }
        Format::WebP => {
            let method = base.webp_method.min(6);
            for candidate_method in [method, 4, 6] {
                let mut alternate = base;
                alternate.webp_method = candidate_method;
                push_unique_candidate(&mut candidates, alternate);
            }
        }
        // SVG/GIF/BMP are read-only source formats. `parse_format` never hands
        // them to this encoder-candidate helper, but keep the match exhaustive
        // so a future caller cannot accidentally select format-specific knobs.
        Format::Avif | Format::Svg | Format::Gif | Format::Bmp => {}
    }

    candidates
}

fn encode_candidates_for(
    opts: &ConvertOptions,
    target: Format,
    base: EncodeOptions,
) -> Vec<EncodeOptions> {
    if opts.multi_candidate {
        encode_option_candidates(base, target)
    } else {
        vec![base]
    }
}

fn push_unique_candidate(candidates: &mut Vec<EncodeOptions>, candidate: EncodeOptions) {
    if !candidates.iter().any(|existing| {
        existing.quality == candidate.quality
            && existing.lossless == candidate.lossless
            && existing.jpeg_progressive == candidate.jpeg_progressive
            && existing.png_oxipng_level == candidate.png_oxipng_level
            && existing.png_lossy_quantize == candidate.png_lossy_quantize
            && existing.png_quant_colors == candidate.png_quant_colors
            && existing.webp_method == candidate.webp_method
            && existing.avif_speed == candidate.avif_speed
            && existing.avif_subsample == candidate.avif_subsample
            && existing.webp_near_lossless == candidate.webp_near_lossless
            && existing.webp_sharp_yuv == candidate.webp_sharp_yuv
            && existing.jpeg_trellis == candidate.jpeg_trellis
            && existing.preserve_metadata == candidate.preserve_metadata
    }) {
        candidates.push(candidate);
    }
}

fn read_source_for_core(input: &Path) -> Result<SourceForCore, String> {
    if external_codecs::is_heic_path(input) {
        let decoded = external_codecs::decode_heic(input)?;
        return Ok(SourceForCore {
            bytes: decoded.image_bytes,
            metadata_override: decoded.metadata,
        });
    }
    let bytes = read_core_source_file(input)?;
    Ok(SourceForCore {
        bytes,
        metadata_override: None,
    })
}

fn read_core_source_file(input: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(input)
        .map_err(|error| format!("无法读取输入文件 {}: {error}", input.display()))?;
    if metadata.len() > MAX_CORE_SOURCE_FILE_BYTES {
        return Err(format!(
            "输入文件超过 {} MiB 上限: {}",
            MAX_CORE_SOURCE_FILE_BYTES / (1024 * 1024),
            input.display()
        ));
    }

    let file = File::open(input)
        .map_err(|error| format!("无法读取输入文件 {}: {error}", input.display()))?;
    let mut reader = file.take(MAX_CORE_SOURCE_FILE_BYTES.saturating_add(1));
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取输入文件 {}: {error}", input.display()))?;
    if bytes.len() as u64 > MAX_CORE_SOURCE_FILE_BYTES {
        return Err(format!(
            "输入文件超过 {} MiB 上限: {}",
            MAX_CORE_SOURCE_FILE_BYTES / (1024 * 1024),
            input.display()
        ));
    }
    Ok(bytes)
}

pub fn path_conversion_smoke_options(
    input: String,
    out_dir: Option<String>,
    format: String,
) -> ConvertOptions {
    ConvertOptions {
        input,
        out_dir,
        relative_dir: None,
        source_width: None,
        source_height: None,
        format,
        quality: 82,
        quality_floor: 0,
        lossless: false,
        jpeg_progressive: default_jpeg_progressive(),
        png_oxipng_level: default_png_oxipng_level(),
        png_lossy_quantize: false,
        png_quant_colors: default_png_quant_colors(),
        webp_method: default_webp_method(),
        avif_speed: 10,
        avif_subsample: default_avif_subsample(),
        webp_near_lossless: default_webp_near_lossless(),
        webp_sharp_yuv: false,
        jpeg_trellis: default_jpeg_trellis(),
        auto_quality: false,
        auto_quality_score: default_auto_quality_score(),
        generation_loss_protection: false,
        result_cache: false,
        skip_if_larger: false,
        multi_candidate: false,
        overwrite: true,
        overwrite_mode: Some("overwrite".to_string()),
        file_name_template: Some("%name%-imgconvert-smoke".to_string()),
        output_suffix: None,
        allow_source_overwrite: false,
        preserve_metadata: Some(false),
        color_management_policy: None,
    }
}

fn set_modified_time(path: &Path, modified: SystemTime) -> Result<(), String> {
    let file = OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|e| format!("无法打开输出文件以保留时间戳: {e}"))?;
    file.set_times(FileTimes::new().set_modified(modified))
        .map_err(|e| format!("无法保留源文件修改时间: {e}"))
}

pub fn convert_batch(
    options: Vec<ConvertOptions>,
    progress: Channel<BatchProgressEvent>,
    cancel: CancellationToken,
    concurrency: Option<usize>,
) -> Result<BatchSummary, String> {
    let total = options.len();
    let mut summary = BatchSummary {
        total,
        completed: 0,
        skipped: 0,
        failed: 0,
        cancelled: false,
    };

    send_progress(&progress, BatchProgressEvent::Started { total })?;
    if total == 0 {
        send_progress(
            &progress,
            BatchProgressEvent::Finished {
                summary: summary.clone(),
            },
        )?;
        return Ok(summary);
    }
    if cancel.is_cancelled() {
        summary.cancelled = true;
        send_cancelled_progress(&progress, &summary)?;
        send_progress(
            &progress,
            BatchProgressEvent::Finished {
                summary: summary.clone(),
            },
        )?;
        return Ok(summary);
    }

    let (jobs, preflight_events) = prepare_batch_work(options);
    for event in preflight_events {
        apply_batch_event(&progress, &mut summary, event)?;
    }
    if jobs.is_empty() {
        send_progress(
            &progress,
            BatchProgressEvent::Finished {
                summary: summary.clone(),
            },
        )?;
        return Ok(summary);
    }
    let worker_count = apply_memory_budget(
        resolve_batch_concurrency(concurrency, jobs.len()),
        jobs.iter(),
    );

    let queue = Arc::new(Mutex::new(jobs));
    let (tx, rx) = mpsc::channel::<BatchProgressEvent>();
    let coordinator_cancel = cancel.clone();

    let send_error = thread::scope(|scope| {
        for _ in 0..worker_count {
            let queue = Arc::clone(&queue);
            let tx = tx.clone();
            let worker_cancel = cancel.clone();
            scope.spawn(move || {
                batch_worker_loop(queue, tx, worker_cancel);
            });
        }
        drop(tx);

        let mut send_error = None;
        for event in rx {
            if send_error.is_some() {
                continue;
            }
            if let Err(error) = apply_batch_event(&progress, &mut summary, event) {
                coordinator_cancel.cancel();
                send_error = Some(error);
            }
        }
        send_error
    });

    if let Some(error) = send_error {
        return Err(error);
    }

    if cancel.is_cancelled() {
        summary.cancelled = true;
        send_cancelled_progress(&progress, &summary)?;
    }

    send_progress(
        &progress,
        BatchProgressEvent::Finished {
            summary: summary.clone(),
        },
    )?;
    Ok(summary)
}

fn prepare_batch_work(
    options: Vec<ConvertOptions>,
) -> (VecDeque<IndexedConvertOptions>, Vec<BatchProgressEvent>) {
    let mut jobs = VecDeque::new();
    let mut preflight_events = Vec::new();
    let mut output_paths = HashSet::new();
    let input_identities = match input_identity_index(&options) {
        Ok(identities) => identities,
        Err(error) => {
            // A source whose identity cannot be checked may still exist. Do
            // not start any writer that could replace it through an alias.
            let failures = options
                .into_iter()
                .enumerate()
                .map(|(index, options)| BatchProgressEvent::FileError {
                    index,
                    input: options.input.clone(),
                    error: CommandError::output_safety_check_failed(options.input, error.clone()),
                })
                .collect();
            return (jobs, failures);
        }
    };

    for (index, options) in options.into_iter().enumerate() {
        let _output_dir_scope =
            access::output_directory(options.out_dir.as_deref()).map(|grant| grant.scoped_access());
        match output_path(&options) {
            Ok(output) => {
                let _output_scope = output.parent().map(access::scoped_path_access);
                let output_identity = match existing_file_identity(&output) {
                    Ok(identity) => identity,
                    Err(error) => {
                        preflight_events.push(BatchProgressEvent::FileError {
                            index,
                            input: options.input,
                            error: CommandError::output_safety_check_failed(
                                output.to_string_lossy().to_string(),
                                error,
                            ),
                        });
                        continue;
                    }
                };
                if output_identity.is_some_and(|identity| {
                    input_identities
                        .get(&identity)
                        .is_some_and(|input_indexes| {
                            input_indexes
                                .iter()
                                .any(|input_index| *input_index != index)
                        })
                }) {
                    preflight_events.push(BatchProgressEvent::FileError {
                        index,
                        input: options.input,
                        error: CommandError::output_conflicts_with_input(
                            output.to_string_lossy().to_string(),
                            format!("{OUTPUT_CONFLICTS_WITH_INPUT_PREFIX} {}", output.display()),
                        ),
                    });
                    continue;
                }
                let key = output_conflict_key(&output);
                if !output_paths.insert(key) {
                    preflight_events.push(BatchProgressEvent::FileError {
                        index,
                        input: options.input,
                        error: CommandError::batch_failed(format!(
                            "输出路径在本批次内重复: {}",
                            output.display()
                        )),
                    });
                    continue;
                }
            }
            Err(_) => {
                // Let convert() report the exact validation error through the normal file path.
            }
        }

        jobs.push_back(IndexedConvertOptions { index, options });
    }

    (jobs, preflight_events)
}

fn output_conflict_key(output: &Path) -> PathBuf {
    let Some(parent) = output.parent() else {
        return output.to_path_buf();
    };
    let Some(file_name) = output.file_name() else {
        return output.to_path_buf();
    };
    match fs::canonicalize(parent) {
        Ok(parent) => parent.join(file_name),
        Err(_) => output.to_path_buf(),
    }
}

fn input_identity_index(
    options: &[ConvertOptions],
) -> Result<HashMap<FileIdentity, Vec<usize>>, String> {
    let mut identities = HashMap::new();
    for (index, options) in options.iter().enumerate() {
        let input = Path::new(&options.input);
        let _input_scope = access::scoped_path_access(input);
        if let Some(identity) = existing_file_identity(input)? {
            identities
                .entry(identity)
                .or_insert_with(Vec::new)
                .push(index);
        }
    }
    Ok(identities)
}

/// Returns `None` when no underlying regular file needs a collision check:
/// a positively absent path, dangling final symlink, or non-file destination.
/// Permission and metadata failures stay errors so collision protection never
/// quietly degrades to a path-string comparison.
fn existing_file_identity(path: &Path) -> Result<Option<FileIdentity>, String> {
    match fs::metadata(path) {
        // Input sources are required to be regular files. A destination that
        // resolves to a directory, device, or other non-file entry therefore
        // cannot alias a source; leave its normal write-path validation to
        // the converter instead of turning it into an identity error.
        Ok(metadata) if !metadata.is_file() => Ok(None),
        Ok(_) => file_identity(path).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match fs::symlink_metadata(path) {
                Err(link_error) if link_error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                // A dangling link is an existing output entry, but cannot be
                // the same underlying file as an accessible source. Keeping
                // it as `None` preserves the safe replacement behavior for
                // the link itself; `output_entry_exists` still handles it as
                // an existing destination later.
                Ok(metadata) if metadata.file_type().is_symlink() => Ok(None),
                Ok(_) => Err(file_identity_error(path, error)),
                Err(link_error) => Err(file_identity_error(path, link_error)),
            }
        }
        Err(error) => Err(file_identity_error(path, error)),
    }
}

fn file_identity_error(path: &Path, error: impl std::fmt::Display) -> String {
    format!(
        "{OUTPUT_SAFETY_CHECK_PREFIX} 无法读取 {} 的文件身份: {error}",
        path.display()
    )
}

#[cfg(unix)]
fn file_identity(path: &Path) -> Result<FileIdentity, String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = fs::metadata(path).map_err(|error| file_identity_error(path, error))?;
    Ok(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(windows)]
fn file_identity(path: &Path) -> Result<FileIdentity, String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileIdInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        BY_HANDLE_FILE_INFORMATION, FILE_ID_INFO,
    };

    let file = File::open(path).map_err(|error| file_identity_error(path, error))?;
    let handle = HANDLE(file.as_raw_handle());
    let mut legacy_info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: `file` remains alive for this call and `as_raw_handle` returns
    // the valid Windows file handle owned by it.
    unsafe {
        GetFileInformationByHandle(handle, &mut legacy_info)
            .map_err(|error| file_identity_error(path, error))?;
    }
    let mut file_id_info = FILE_ID_INFO::default();
    // SAFETY: same live `file` and handle as the legacy query above.
    let file_id = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileIdInfo,
            (&mut file_id_info as *mut FILE_ID_INFO).cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    }
    .ok()
    .map(|()| {
        (
            file_id_info.VolumeSerialNumber,
            file_id_info.FileId.Identifier,
        )
    });

    // `FILE_ID_INFO` is the primary identity (including ReFS's 128-bit file
    // id). Older or remote Windows filesystems can reject that query, so retain
    // the documented volume/index pair as a safe compatibility fallback.
    Ok(FileIdentity {
        legacy_volume_serial_number: legacy_info.dwVolumeSerialNumber,
        legacy_file_index: (u64::from(legacy_info.nFileIndexHigh) << 32)
            | u64::from(legacy_info.nFileIndexLow),
        file_id,
    })
}

#[cfg(not(any(unix, windows)))]
fn file_identity(path: &Path) -> Result<FileIdentity, String> {
    let canonical_path =
        fs::canonicalize(path).map_err(|error| file_identity_error(path, error))?;
    Ok(FileIdentity { canonical_path })
}

fn batch_worker_loop(
    queue: Arc<Mutex<VecDeque<IndexedConvertOptions>>>,
    tx: mpsc::Sender<BatchProgressEvent>,
    cancel: CancellationToken,
) {
    loop {
        if cancel.is_cancelled() {
            break;
        }

        let Some(job) = next_batch_job(&queue) else {
            break;
        };
        if cancel.is_cancelled() {
            break;
        }

        let index = job.index;
        let opts = job.options;
        let input = opts.input.clone();

        if send_worker_event(
            &tx,
            BatchProgressEvent::FileStarted {
                index,
                input: input.clone(),
            },
            &cancel,
        )
        .is_err()
        {
            break;
        }
        if send_worker_event(
            &tx,
            BatchProgressEvent::FileProgress {
                index,
                percent: 5.0,
                stage: BatchProgressStage::ReadingAndConverting,
            },
            &cancel,
        )
        .is_err()
        {
            break;
        }

        let event = match convert(&opts) {
            Ok(result) => BatchProgressEvent::FileFinished { index, result },
            Err(detail) => {
                let skipped = should_count_as_skipped(&opts, &detail);
                let error = command_error_for_conversion(&opts, detail);
                if skipped {
                    BatchProgressEvent::FileSkipped {
                        index,
                        input,
                        error,
                    }
                } else {
                    BatchProgressEvent::FileError {
                        index,
                        input,
                        error,
                    }
                }
            }
        };

        if send_worker_event(&tx, event, &cancel).is_err() {
            break;
        }
    }
}

fn next_batch_job(
    queue: &Arc<Mutex<VecDeque<IndexedConvertOptions>>>,
) -> Option<IndexedConvertOptions> {
    queue.lock().ok()?.pop_front()
}

fn send_worker_event(
    tx: &mpsc::Sender<BatchProgressEvent>,
    event: BatchProgressEvent,
    cancel: &CancellationToken,
) -> Result<(), ()> {
    tx.send(event).map_err(|_| {
        cancel.cancel();
    })
}

fn apply_batch_event(
    progress: &Channel<BatchProgressEvent>,
    summary: &mut BatchSummary,
    event: BatchProgressEvent,
) -> Result<(), String> {
    match &event {
        BatchProgressEvent::FileFinished { .. } => summary.completed += 1,
        BatchProgressEvent::FileSkipped { .. } => summary.skipped += 1,
        BatchProgressEvent::FileError { .. } => summary.failed += 1,
        _ => {}
    }
    if matches!(event, BatchProgressEvent::FileFinished { .. }) {
        let index = match &event {
            BatchProgressEvent::FileFinished { index, .. } => *index,
            _ => unreachable!(),
        };
        send_progress(
            progress,
            BatchProgressEvent::FileProgress {
                index,
                percent: 100.0,
                stage: BatchProgressStage::Done,
            },
        )?;
    }
    send_progress(progress, event)
}

fn resolve_batch_concurrency(requested: Option<usize>, total: usize) -> usize {
    if total == 0 {
        return 0;
    }

    requested
        .filter(|value| *value > 0)
        .unwrap_or_else(default_batch_concurrency)
        .clamp(1, MAX_BATCH_CONCURRENCY)
        .min(total)
}

fn default_batch_concurrency() -> usize {
    thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(2)
        .saturating_sub(1)
        .clamp(1, MAX_BATCH_CONCURRENCY)
}

fn apply_memory_budget<'a>(
    base: usize,
    options: impl IntoIterator<Item = &'a IndexedConvertOptions>,
) -> usize {
    if base <= 1 {
        return base;
    }

    let mut estimates = options
        .into_iter()
        .map(|job| estimated_job_memory_bytes(&job.options))
        .collect::<Vec<_>>();
    if estimates.is_empty() {
        return base;
    }
    estimates.sort_unstable_by(|a, b| b.cmp(a));

    for candidate in (1..=base).rev() {
        let worst_case = estimates
            .iter()
            .take(candidate)
            .fold(0u128, |acc, value| acc + *value as u128);
        if worst_case <= BATCH_MEMORY_BUDGET_BYTES as u128 {
            return candidate;
        }
    }
    1
}

fn estimated_job_memory_bytes(options: &ConvertOptions) -> u64 {
    // `read_source_for_core` retains the complete source byte buffer while
    // core decodes and encodes it. Pixel dimensions alone therefore
    // underestimate batches of small-canvas files with unusually large
    // compressed payloads or metadata. Use the current file length when it is
    // available, and reserve the read ceiling if it is not, so an unreadable
    // or changing input cannot make the scheduler overcommit memory.
    let source_bytes = source_bytes_for_memory_budget(Path::new(&options.input));
    let image_working_set = estimate_from_dimensions(options.source_width, options.source_height)
        .unwrap_or(UNKNOWN_JOB_MEMORY_BYTES);
    image_working_set.saturating_add(source_bytes)
}

fn source_bytes_for_memory_budget(input: &Path) -> u64 {
    if external_codecs::is_heic_path(input) {
        // ImageIO/WIC first materializes a decoded frame and a PNG bridge in
        // addition to the core working set. Until a platform-neutral header
        // probe exists here, run HEIC jobs one at a time rather than allowing
        // several system decoders to allocate concurrently.
        return BATCH_MEMORY_BUDGET_BYTES;
    }

    let _scope = access::scoped_path_access(input);
    fs::metadata(input)
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len().min(MAX_CORE_SOURCE_FILE_BYTES))
        .unwrap_or(MAX_CORE_SOURCE_FILE_BYTES)
}

fn estimate_from_dimensions(width: Option<u32>, height: Option<u32>) -> Option<u64> {
    let width = width?;
    let height = height?;
    if width == 0 || height == 0 {
        return None;
    }
    let pixels = u64::from(width).checked_mul(u64::from(height))?;
    pixels
        .checked_mul(4)?
        .checked_mul(RGBA_WORKING_SET_MULTIPLIER)
}

fn send_progress(
    progress: &Channel<BatchProgressEvent>,
    event: BatchProgressEvent,
) -> Result<(), String> {
    progress
        .send(event)
        .map_err(|e| format!("无法发送批量进度事件: {e}"))
}

fn send_cancelled_progress(
    progress: &Channel<BatchProgressEvent>,
    summary: &BatchSummary,
) -> Result<(), String> {
    send_progress(
        progress,
        BatchProgressEvent::Cancelled {
            completed: summary.completed,
            total: summary.total,
        },
    )
}

fn should_skip_larger_candidate(
    opts: &ConvertOptions,
    source_size: u64,
    candidate_size: u64,
) -> bool {
    opts.skip_if_larger && source_size > 0 && candidate_size >= source_size
}

fn should_use_auto_quality(
    opts: &ConvertOptions,
    target: Format,
    encode_options: &EncodeOptions,
) -> bool {
    opts.auto_quality
        && matches!(target, Format::Jpeg | Format::WebP)
        && !(target == Format::WebP && encode_options.lossless)
}

fn auto_quality_min(floor: u8, max_quality: u8) -> u8 {
    let max_quality = max_quality.clamp(1, 100);
    if floor >= 30 {
        floor.clamp(30, 100).min(max_quality)
    } else {
        30.min(max_quality)
    }
}

#[derive(Clone, Copy)]
struct CandidatePolicyCheck<'a> {
    source: &'a [u8],
    source_format: Option<Format>,
    target: Format,
    encode_options: &'a EncodeOptions,
    dimensions: Option<(u32, u32)>,
    source_size: u64,
    candidate_size: u64,
}

fn candidate_policy_error(
    opts: &ConvertOptions,
    check: CandidatePolicyCheck<'_>,
) -> Option<String> {
    // SVG is a vector source, whereas every supported target is raster. Comparing the
    // compact SVG markup with raster bytes makes "skip if larger" reject legitimate
    // conversions almost every time, so size-based compression policy is not applicable.
    if check.source_format != Some(Format::Svg)
        && should_skip_larger_candidate(opts, check.source_size, check.candidate_size)
    {
        return Some(skip_larger_message(check.source_size, check.candidate_size));
    }
    if should_skip_generation_loss(
        opts,
        GenerationLossCheck {
            source: check.source,
            source_format: check.source_format,
            target: check.target,
            encode_options: check.encode_options,
            dimensions: check.dimensions,
            source_size: check.source_size,
            candidate_size: check.candidate_size,
        },
    ) {
        return Some(generation_loss_message(
            check.source_size,
            check.candidate_size,
            check.dimensions,
        ));
    }
    None
}

#[derive(Clone, Copy)]
struct GenerationLossCheck<'a> {
    source: &'a [u8],
    source_format: Option<Format>,
    target: Format,
    encode_options: &'a EncodeOptions,
    dimensions: Option<(u32, u32)>,
    source_size: u64,
    candidate_size: u64,
}

fn should_skip_generation_loss(opts: &ConvertOptions, check: GenerationLossCheck<'_>) -> bool {
    opts.generation_loss_protection
        && check.source_size > 0
        && is_lossy_source(check.source, check.source_format)
        && is_lossy_target(check.target, check.encode_options)
        && savings_basis_points(check.source_size, check.candidate_size)
            < required_generation_savings_basis_points(check.source_size, check.dimensions)
}

fn is_lossy_source(source: &[u8], source_format: Option<Format>) -> bool {
    match source_format {
        Some(Format::Jpeg | Format::Avif) => true,
        Some(Format::WebP) => webp_source_is_lossy(source),
        Some(Format::Png) => imgconvert_core::detect_lossy_artifacts(source)
            .ok()
            .flatten()
            .is_some(),
        _ => false,
    }
}

fn webp_source_is_lossy(source: &[u8]) -> bool {
    if source.len() < 16 || &source[0..4] != b"RIFF" || &source[8..12] != b"WEBP" {
        return true;
    }
    let mut offset = 12usize;
    while offset + 8 <= source.len() {
        let fourcc = &source[offset..offset + 4];
        let Some(length) = source
            .get(offset + 4..offset + 8)
            .and_then(|bytes| bytes.try_into().ok())
            .map(u32::from_le_bytes)
            .map(|value| value as usize)
        else {
            return true;
        };
        match fourcc {
            b"VP8 " => return true,
            b"VP8L" => return false,
            _ => {}
        }
        let data_start = offset + 8;
        let Some(next) = data_start
            .checked_add(length)
            .and_then(|end| end.checked_add(length % 2))
        else {
            return true;
        };
        offset = next;
    }
    true
}

fn is_lossy_target(target: Format, encode_options: &EncodeOptions) -> bool {
    matches!(target, Format::Jpeg)
        || (target == Format::Avif && !encode_options.lossless)
        || (target == Format::WebP && !encode_options.lossless)
}

fn savings_basis_points(source_size: u64, candidate_size: u64) -> u64 {
    if candidate_size >= source_size || source_size == 0 {
        return 0;
    }
    ((source_size - candidate_size) * 10_000) / source_size
}

fn source_bits_per_pixel(source_size: u64, dimensions: Option<(u32, u32)>) -> Option<f64> {
    let (width, height) = dimensions?;
    let pixels = u64::from(width).checked_mul(u64::from(height))?;
    if pixels == 0 {
        return None;
    }
    Some(source_size as f64 * 8.0 / pixels as f64)
}

fn required_generation_savings_basis_points(
    source_size: u64,
    dimensions: Option<(u32, u32)>,
) -> u64 {
    match source_bits_per_pixel(source_size, dimensions) {
        Some(bpp) if bpp < 0.5 => 800,
        Some(bpp) if bpp < 1.0 => 500,
        Some(bpp) if bpp < 2.0 => 300,
        _ => 200,
    }
}

fn generation_loss_message(
    source_size: u64,
    candidate_size: u64,
    dimensions: Option<(u32, u32)>,
) -> String {
    let required = required_generation_savings_basis_points(source_size, dimensions) as f64 / 100.0;
    let actual = savings_basis_points(source_size, candidate_size) as f64 / 100.0;
    format!("{GENERATION_LOSS_GUARD_PREFIX}有损源再次压缩收益不足(需 {required:.1}%, 实际 {actual:.1}%)")
}

fn skip_larger_message(source_size: u64, candidate_size: u64) -> String {
    format!("{OUTPUT_NOT_SMALLER_PREFIX}(源 {source_size} B, 输出 {candidate_size} B)")
}

fn result_cache_key(
    opts: &ConvertOptions,
    target: Format,
    encode_options: &EncodeOptions,
    color_policy: ColorManagementPolicy,
    source: &[u8],
    metadata_override: Option<&RawMetadata>,
) -> String {
    let source_hash = blake3::hash(source);
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"imgconvert-result-cache-v4\0");
    hasher.update(source_hash.as_bytes());
    hasher.update(target.id().as_bytes());
    hasher.update(color_management_policy_id(color_policy));
    hasher.update(&[encode_options.quality]);
    hasher.update(&[u8::from(encode_options.lossless)]);
    hasher.update(&[u8::from(encode_options.jpeg_progressive)]);
    hasher.update(&[encode_options.png_oxipng_level]);
    hasher.update(&[u8::from(encode_options.png_lossy_quantize)]);
    hasher.update(&encode_options.png_quant_colors.to_le_bytes());
    hasher.update(&[encode_options.webp_method]);
    hasher.update(&[encode_options.avif_speed]);
    hasher.update(match encode_options.avif_subsample {
        AvifSubsample::Yuv444 => b"yuv444",
        AvifSubsample::Yuv420 => b"yuv420",
    });
    hasher.update(&[encode_options.webp_near_lossless]);
    hasher.update(&[u8::from(encode_options.webp_sharp_yuv)]);
    hasher.update(&[u8::from(encode_options.jpeg_trellis)]);
    hasher.update(&[u8::from(encode_options.preserve_metadata)]);
    hasher.update(&[u8::from(opts.multi_candidate)]);
    hasher.update(&[u8::from(opts.auto_quality)]);
    hasher.update(&opts.auto_quality_score.to_le_bytes());
    if should_use_auto_quality(opts, target, encode_options) {
        hasher.update(&[auto_quality_min(opts.quality_floor, encode_options.quality)]);
    }
    if encode_options.preserve_metadata || color_policy == ColorManagementPolicy::ConvertToSrgb {
        hash_metadata_override(&mut hasher, metadata_override);
    }
    hasher.finalize().to_hex().to_string()
}

fn hash_metadata_override(hasher: &mut blake3::Hasher, metadata: Option<&RawMetadata>) {
    let Some(metadata) = metadata else {
        hasher.update(b"metadata:none\0");
        return;
    };
    hasher.update(b"metadata:some\0");
    hash_optional_metadata_blob(hasher, b"icc", metadata.icc.as_deref());
    hash_optional_metadata_blob(hasher, b"exif", metadata.exif.as_deref());
    hash_optional_metadata_blob(hasher, b"xmp", metadata.xmp.as_deref());
    hash_optional_metadata_blob(hasher, b"iptc", metadata.iptc.as_deref());
}

fn hash_optional_metadata_blob(hasher: &mut blake3::Hasher, label: &[u8], bytes: Option<&[u8]>) {
    hasher.update(label);
    hasher.update(b"\0");
    if let Some(bytes) = bytes {
        hasher.update(b"1");
        hasher.update(&bytes.len().to_le_bytes());
        hasher.update(bytes);
    } else {
        hasher.update(b"0");
    }
    hasher.update(b"\0");
}

fn result_cache_hit(out: &Path, key: &str) -> Option<u64> {
    let record = read_result_cache_record(key)?;
    let (output_size, output_hash) = blake3_hash_file(out)?;
    if output_size == record.output_size && output_hash.to_hex().as_str() == record.output_hash {
        Some(output_size)
    } else {
        None
    }
}

fn blake3_hash_file(path: &Path) -> Option<(u64, blake3::Hash)> {
    let mut file = File::open(path).ok()?;
    let output_size = file.metadata().ok()?.len();
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some((output_size, hasher.finalize()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResultCacheRecord {
    output_hash: String,
    output_size: u64,
}

fn read_result_cache_record(key: &str) -> Option<ResultCacheRecord> {
    let path = result_cache_record_path(key)?;
    let data = fs::read_to_string(path).ok()?;
    parse_result_cache_record(&data)
}

fn write_result_cache_record(key: &str, output: &[u8], output_size: u64) {
    let Some(path) = result_cache_record_path(key) else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let record = format!("v1\n{}\n{}\n", blake3::hash(output).to_hex(), output_size);
    let _ = fs::write(path, record);
}

fn parse_result_cache_record(data: &str) -> Option<ResultCacheRecord> {
    let mut lines = data.lines();
    if lines.next()? != "v1" {
        return None;
    }
    let output_hash = lines.next()?.trim().to_string();
    let output_size = lines.next()?.trim().parse().ok()?;
    if output_hash.len() != 64 || !output_hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(ResultCacheRecord {
        output_hash,
        output_size,
    })
}

fn result_cache_record_path(key: &str) -> Option<PathBuf> {
    if key.len() != 64 || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(result_cache_dir()?.join(format!("{key}.txt")))
}

fn result_cache_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("IMGCONVERT_RESULT_CACHE_DIR") {
        return Some(PathBuf::from(dir));
    }

    platform_result_cache_dir()
}

#[cfg(target_os = "windows")]
fn platform_result_cache_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|base| base.join("ImgConvert").join("Cache").join("results"))
}

#[cfg(target_os = "macos")]
fn platform_result_cache_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).map(|home| {
        home.join("Library")
            .join("Caches")
            .join("ImgConvert")
            .join("results")
    })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_result_cache_dir() -> Option<PathBuf> {
    if let Some(cache_home) = std::env::var_os("XDG_CACHE_HOME") {
        return Some(PathBuf::from(cache_home).join("imgconvert").join("results"));
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".cache").join("imgconvert").join("results"))
}

#[cfg(not(any(unix, target_os = "windows")))]
fn platform_result_cache_dir() -> Option<PathBuf> {
    None
}

fn should_count_as_skipped(opts: &ConvertOptions, message: &str) -> bool {
    let skip_mode = match opts.overwrite_mode.as_deref() {
        Some("skip") => true,
        None => !opts.overwrite,
        _ => false,
    };
    (skip_mode && message.starts_with(OUTPUT_EXISTS_PREFIX))
        || (opts.skip_if_larger && message.starts_with(OUTPUT_NOT_SMALLER_PREFIX))
        || (opts.generation_loss_protection && message.starts_with(GENERATION_LOSS_GUARD_PREFIX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_progress_stages_serialize_as_language_neutral_codes() {
        let reading = serde_json::to_value(BatchProgressEvent::FileProgress {
            index: 2,
            percent: 5.0,
            stage: BatchProgressStage::ReadingAndConverting,
        })
        .unwrap();
        let done = serde_json::to_value(BatchProgressStage::Done).unwrap();

        assert_eq!(reading["event"], "fileProgress");
        assert_eq!(reading["data"]["stage"], "readingAndConverting");
        assert_eq!(done, "done");
    }

    #[test]
    fn conversion_skip_policies_are_opt_in_by_default() {
        let options: ConvertOptions = serde_json::from_value(serde_json::json!({
            "input": "/tmp/source.png",
            "outDir": null,
            "relativeDir": null,
            "format": "png",
            "quality": 80,
            "lossless": false,
            "overwrite": false,
            "overwriteMode": "skip",
            "fileNameTemplate": "%name%",
            "preserveMetadata": false,
        }))
        .unwrap();

        assert!(!options.skip_if_larger);
        assert!(!options.generation_loss_protection);
    }

    #[test]
    fn core_source_reader_rejects_oversized_file_before_reading_it() {
        let dir = unique_test_dir("oversized-source");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("oversized.png");
        let file = File::create(&input).unwrap();
        file.set_len(MAX_CORE_SOURCE_FILE_BYTES + 1).unwrap();

        let error = read_core_source_file(&input).unwrap_err();

        assert!(error.contains("输入文件超过"));
        fs::remove_dir_all(dir).unwrap();
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let counter = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "imgconvert-{name}-{}-{counter}",
            std::process::id()
        ))
    }

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = 0xffff_ffffu32;
        for &byte in bytes {
            crc ^= byte as u32;
            for _ in 0..8 {
                if crc & 1 == 1 {
                    crc = (crc >> 1) ^ 0xedb8_8320;
                } else {
                    crc >>= 1;
                }
            }
        }
        !crc
    }

    fn adler32(bytes: &[u8]) -> u32 {
        const MOD: u32 = 65_521;
        let mut a = 1u32;
        let mut b = 0u32;
        for &byte in bytes {
            a = (a + byte as u32) % MOD;
            b = (b + a) % MOD;
        }
        (b << 16) | a
    }

    fn append_png_chunk(png: &mut Vec<u8>, name: &[u8; 4], data: &[u8]) {
        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        png.extend_from_slice(name);
        png.extend_from_slice(data);
        let mut crc_input = Vec::with_capacity(4 + data.len());
        crc_input.extend_from_slice(name);
        crc_input.extend_from_slice(data);
        png.extend_from_slice(&crc32(&crc_input).to_be_bytes());
    }

    fn one_by_one_png() -> Vec<u8> {
        let scanline = [0, 255, 255, 255, 255]; // filter byte + opaque white RGBA pixel
        let mut zlib = vec![0x78, 0x01, 0x01, 5, 0, 0xfa, 0xff];
        zlib.extend_from_slice(&scanline);
        zlib.extend_from_slice(&adler32(&scanline).to_be_bytes());

        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&1u32.to_be_bytes());
        ihdr.extend_from_slice(&1u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);

        let mut png = Vec::new();
        png.extend_from_slice(&[0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n']);
        append_png_chunk(&mut png, b"IHDR", &ihdr);
        append_png_chunk(&mut png, b"IDAT", &zlib);
        append_png_chunk(&mut png, b"IEND", &[]);
        png
    }

    fn test_convert_options(input: String) -> ConvertOptions {
        ConvertOptions {
            input,
            out_dir: None,
            relative_dir: None,
            source_width: None,
            source_height: None,
            format: "jpeg".to_string(),
            quality: 80,
            quality_floor: 0,
            lossless: false,
            jpeg_progressive: default_jpeg_progressive(),
            png_oxipng_level: default_png_oxipng_level(),
            png_lossy_quantize: false,
            png_quant_colors: default_png_quant_colors(),
            webp_method: default_webp_method(),
            avif_speed: default_avif_speed(),
            avif_subsample: default_avif_subsample(),
            webp_near_lossless: default_webp_near_lossless(),
            webp_sharp_yuv: false,
            jpeg_trellis: default_jpeg_trellis(),
            auto_quality: false,
            auto_quality_score: default_auto_quality_score(),
            generation_loss_protection: false,
            result_cache: false,
            skip_if_larger: false,
            multi_candidate: false,
            overwrite: false,
            overwrite_mode: Some("skip".to_string()),
            file_name_template: Some("%name%".to_string()),
            output_suffix: None,
            allow_source_overwrite: false,
            preserve_metadata: Some(false),
            color_management_policy: None,
        }
    }

    #[test]
    fn command_error_mapping_keeps_conversion_details_out_of_the_ipc_code() {
        let mut options = test_convert_options("/images/source.png".to_string());

        let missing = command_error_for_conversion(
            &options,
            format!("{INPUT_FILE_NOT_FOUND_PREFIX} /images/source.png"),
        );
        assert_eq!(missing.code, crate::command_error::ErrorCode::FileNotFound);
        assert_eq!(
            missing.params,
            Some(serde_json::json!({ "path": "/images/source.png" }))
        );

        options.format = "tiff".to_string();
        let unsupported = command_error_for_conversion(
            &options,
            format!("{TIFF_OUTPUT_UNSUPPORTED_PREFIX} v1 可写格式"),
        );
        assert_eq!(
            unsupported.code,
            crate::command_error::ErrorCode::UnsupportedFormat
        );
        assert_eq!(
            unsupported.params,
            Some(serde_json::json!({ "format": "tiff" }))
        );
        assert_eq!(
            unsupported.detail.as_deref(),
            Some("TIFF 暂未纳入 v1 可写格式")
        );

        let denied = command_error_for_conversion(
            &options,
            format!("{INPUT_PERMISSION_DENIED_PREFIX} /images/source.png"),
        );
        assert_eq!(
            denied.code,
            crate::command_error::ErrorCode::PermissionDenied
        );

        options.format = "jpeg".to_string();
        let output_denied = command_error_for_conversion(
            &options,
            format!("{OUTPUT_PERMISSION_DENIED_PREFIX} /images: Permission denied"),
        );
        assert_eq!(
            output_denied.code,
            crate::command_error::ErrorCode::OutputPermissionDenied
        );
        assert_eq!(
            output_denied.params,
            Some(serde_json::json!({ "path": "/images" }))
        );

        let output_exists = command_error_for_conversion(
            &options,
            format!("{OUTPUT_EXISTS_PREFIX}(未开启覆盖): /images/source.jpg"),
        );
        assert_eq!(
            output_exists.code,
            crate::command_error::ErrorCode::OutputExists
        );

        let invalid_suffix = command_error_for_conversion(
            &options,
            format!("{INVALID_OUTPUT_SUFFIX_PREFIX}不能包含路径分隔符或系统保留字符"),
        );
        assert_eq!(
            invalid_suffix.code,
            crate::command_error::ErrorCode::InvalidOutputSuffix
        );

        let source_confirmation = command_error_for_conversion(
            &options,
            format!("{SOURCE_OVERWRITE_CONFIRMATION_REQUIRED_PREFIX} /images/source.jpg"),
        );
        assert_eq!(
            source_confirmation.code,
            crate::command_error::ErrorCode::SourceOverwriteConfirmationRequired
        );

        let queued_input_conflict = command_error_for_conversion(
            &options,
            format!("{OUTPUT_CONFLICTS_WITH_INPUT_PREFIX} /images/source.jpg"),
        );
        assert_eq!(
            queued_input_conflict.code,
            crate::command_error::ErrorCode::OutputConflictsWithInput
        );

        let safety_check = command_error_for_conversion(
            &options,
            format!("{OUTPUT_SAFETY_CHECK_PREFIX} 无法读取 /images/source.jpg 的文件身份"),
        );
        assert_eq!(
            safety_check.code,
            crate::command_error::ErrorCode::OutputSafetyCheckFailed
        );

        let not_smaller = command_error_for_conversion(
            &options,
            format!("{OUTPUT_NOT_SMALLER_PREFIX}(源 10 B, 输出 11 B)"),
        );
        assert_eq!(
            not_smaller.code,
            crate::command_error::ErrorCode::OutputNotSmaller
        );

        let fallback = command_error_for_conversion(&options, "codec backend failed");
        assert_eq!(
            fallback.code,
            crate::command_error::ErrorCode::ConversionFailed
        );
        assert_eq!(
            fallback.params,
            Some(serde_json::json!({ "path": "/images/source.png" }))
        );
    }

    #[test]
    fn write_output_create_new_does_not_clobber_existing_file() {
        let dir = unique_test_dir("create-new");
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.bin");
        fs::write(&out, b"old").unwrap();

        let err = write_output(&out, b"new", WriteMode::CreateNew).unwrap_err();
        assert!(err.contains("输出已存在"));
        assert_eq!(fs::read(&out).unwrap(), b"old");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_output_error_includes_blocked_parent_path() {
        let dir = unique_test_dir("blocked-parent");
        fs::create_dir_all(&dir).unwrap();
        let blocked = dir.join("blocked");
        fs::write(&blocked, b"file").unwrap();
        let out = blocked.join("out.bin");

        let err = write_output(&out, b"new", WriteMode::CreateNew).unwrap_err();

        assert!(err.contains("无法创建输出目录"));
        assert!(err.contains(&blocked.to_string_lossy().to_string()));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn output_io_error_keeps_output_permission_failures_machine_readable() {
        let error = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        let detail = output_io_error(
            "无法创建输出文件",
            Path::new("/images/output/photo.webp"),
            &error,
        );

        assert!(detail.starts_with(OUTPUT_PERMISSION_DENIED_PREFIX));
        assert!(detail.contains("/images/output"));
    }

    #[test]
    fn cleanup_partial_note_removes_partial_file() {
        let dir = unique_test_dir("cleanup-partial");
        fs::create_dir_all(&dir).unwrap();
        let partial = dir.join(".imgconvert-test.tmp");
        fs::write(&partial, b"partial").unwrap();

        let note = cleanup_partial_note(&partial);

        assert!(note.contains("已清理半成品"));
        assert!(!partial.exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_rejects_directory_input_with_specific_message() {
        let dir = unique_test_dir("directory-input");
        let input_dir = dir.join("input-dir");
        fs::create_dir_all(&input_dir).unwrap();
        let mut options = test_convert_options(input_dir.to_string_lossy().to_string());
        options.out_dir = Some(dir.join("out").to_string_lossy().to_string());

        let err = convert(&options).unwrap_err();

        assert!(err.contains("输入路径不是文件"));
        assert!(err.contains(&input_dir.to_string_lossy().to_string()));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_accepts_preserve_metadata_flag() {
        let dir = unique_test_dir("preserve-metadata-flag");
        let out_dir = dir.join("out");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.png");
        fs::write(&input, one_by_one_png()).unwrap();

        let mut options = test_convert_options(input.to_string_lossy().to_string());
        options.out_dir = Some(out_dir.to_string_lossy().to_string());
        options.preserve_metadata = Some(true);

        let result = convert(&options).unwrap();

        assert!(Path::new(&result.output).exists());
        assert!(result.out_size > 0);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_accepts_svg_input_and_writes_a_supported_output_format() {
        let dir = unique_test_dir("svg-input");
        let out_dir = dir.join("out");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.svg");
        fs::write(
            &input,
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="#4c91d9"/></svg>"##,
        )
        .unwrap();

        let mut options = test_convert_options(input.to_string_lossy().to_string());
        options.out_dir = Some(out_dir.to_string_lossy().to_string());
        options.format = "webp".to_string();

        let result = convert(&options).unwrap();
        let encoded = fs::read(&result.output).unwrap();

        assert_eq!(Format::from_magic(&encoded), Some(Format::WebP));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_writes_svg_raster_output_when_skip_if_larger_is_enabled() {
        let dir = unique_test_dir("svg-skip-larger");
        let out_dir = dir.join("out");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.svg");
        let source = br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>"#;
        fs::write(&input, source).unwrap();

        let mut options = test_convert_options(input.to_string_lossy().to_string());
        options.out_dir = Some(out_dir.to_string_lossy().to_string());
        options.skip_if_larger = true;
        options.multi_candidate = false;

        let result = convert(&options).unwrap();
        let encoded = fs::read(&result.output).unwrap();

        assert_eq!(Format::from_magic(&encoded), Some(Format::Jpeg));
        assert!(encoded.len() > source.len());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_writes_avif_lossless_when_requested() {
        let dir = unique_test_dir("avif-lossless-output");
        let out_dir = dir.join("out");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.png");
        let source = one_by_one_png();
        fs::write(&input, &source).unwrap();

        let mut options = test_convert_options(input.to_string_lossy().to_string());
        options.out_dir = Some(out_dir.to_string_lossy().to_string());
        options.format = "avif".to_string();
        options.lossless = true;
        options.generation_loss_protection = true;

        let result = convert(&options).unwrap();
        let encoded = fs::read(&result.output).unwrap();
        assert_eq!(Format::from_magic(&encoded), Some(Format::Avif));

        let source_pixels = imgconvert_core::codec_for(Format::Png)
            .decode(&source)
            .unwrap();
        let decoded = imgconvert_core::codec_for(Format::Avif)
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded.rgba8().unwrap(), source_pixels.rgba8().unwrap());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn capabilities_add_heic_as_read_only_when_helper_exists() {
        let capabilities =
            capabilities_with_heic_provider(Some(external_codecs::CodecProviderInfo {
                id: "imgconvert-heic-helper".to_string(),
                kind: "manifest",
                license: Some("LGPL-3.0-or-later".to_string()),
                readable: vec!["heic".to_string(), "heif".to_string(), "hif".to_string()],
                writable: Vec::new(),
            }));

        assert!(capabilities.readable.contains(&"heic"));
        assert!(!capabilities.writable.contains(&"heic"));
        assert!(capabilities.heic);
        assert_eq!(capabilities.codec_providers.len(), 1);
        assert_eq!(capabilities.codec_providers[0].kind, "manifest");
    }

    #[test]
    fn encode_options_carry_p2_format_parameters_and_gate_lossless() {
        let mut options = test_convert_options("/tmp/input.png".to_string());
        options.quality = 140;
        options.quality_floor = 0;
        options.lossless = true;
        options.jpeg_progressive = false;
        options.png_oxipng_level = 6;
        options.png_lossy_quantize = true;
        options.png_quant_colors = 128;
        options.webp_method = 5;
        options.avif_speed = 9;
        options.avif_subsample = "yuv420".to_string();
        options.webp_near_lossless = 80;
        options.webp_sharp_yuv = true;
        options.jpeg_trellis = false;
        options.preserve_metadata = Some(true);

        let webp = encode_options_for(&options, Format::WebP);
        assert_eq!(webp.quality, 100);
        assert!(webp.lossless);
        assert!(!webp.jpeg_progressive);
        assert_eq!(webp.png_oxipng_level, 6);
        assert!(webp.png_lossy_quantize);
        assert_eq!(webp.png_quant_colors, 128);
        assert_eq!(webp.webp_method, 5);
        assert_eq!(webp.avif_speed, 9);
        assert_eq!(webp.avif_subsample, AvifSubsample::Yuv420);
        assert_eq!(webp.webp_near_lossless, 80);
        assert!(webp.webp_sharp_yuv);
        assert!(!webp.jpeg_trellis);
        assert!(webp.preserve_metadata);

        let jpeg = encode_options_for(&options, Format::Jpeg);
        assert!(!jpeg.lossless);
        assert_eq!(jpeg.webp_near_lossless, default_webp_near_lossless());

        let avif = encode_options_for(&options, Format::Avif);
        assert!(avif.lossless);
        assert_eq!(avif.quality, 100);
        assert_eq!(avif.avif_subsample, AvifSubsample::Yuv420);

        options.lossless = false;
        let lossy_webp = encode_options_for(&options, Format::WebP);
        assert!(!lossy_webp.lossless);
        assert_eq!(lossy_webp.webp_near_lossless, default_webp_near_lossless());
    }

    #[test]
    fn encode_options_apply_lossy_quality_floor_only_when_enabled() {
        let mut options = test_convert_options("/tmp/input.png".to_string());
        options.quality = 12;
        options.quality_floor = 65;

        let jpeg = encode_options_for(&options, Format::Jpeg);
        assert_eq!(jpeg.quality, 65);

        let avif = encode_options_for(&options, Format::Avif);
        assert_eq!(avif.quality, 65);

        options.quality_floor = 29;
        let webp = encode_options_for(&options, Format::WebP);
        assert_eq!(webp.quality, 12);

        options.quality_floor = 80;
        options.lossless = true;
        let lossless_webp = encode_options_for(&options, Format::WebP);
        assert_eq!(lossless_webp.quality, 12);
        assert!(lossless_webp.lossless);

        let lossless_avif = encode_options_for(&options, Format::Avif);
        assert_eq!(lossless_avif.quality, 12);
        assert!(lossless_avif.lossless);

        let png = encode_options_for(&options, Format::Png);
        assert_eq!(png.quality, 12);
    }

    #[test]
    fn encode_option_candidates_expand_safe_p2_variants() {
        let base = EncodeOptions {
            png_oxipng_level: 4,
            webp_method: 2,
            jpeg_progressive: true,
            ..EncodeOptions::default()
        };

        let jpeg = encode_option_candidates(base, Format::Jpeg);
        assert_eq!(jpeg.len(), 2);
        assert!(jpeg.iter().any(|candidate| candidate.jpeg_progressive));
        assert!(jpeg.iter().any(|candidate| !candidate.jpeg_progressive));

        let png = encode_option_candidates(base, Format::Png);
        let png_levels = png
            .iter()
            .map(|candidate| candidate.png_oxipng_level)
            .collect::<Vec<_>>();
        assert_eq!(png_levels, vec![4, 3, 5, 6]);

        let webp = encode_option_candidates(base, Format::WebP);
        let webp_methods = webp
            .iter()
            .map(|candidate| candidate.webp_method)
            .collect::<Vec<_>>();
        assert_eq!(webp_methods, vec![2, 4, 6]);
    }

    #[test]
    fn auto_quality_is_gated_to_lossy_jpeg_and_webp() {
        let mut options = test_convert_options("/tmp/input.png".to_string());
        options.auto_quality = true;

        let jpeg = encode_options_for(&options, Format::Jpeg);
        assert!(should_use_auto_quality(&options, Format::Jpeg, &jpeg));

        let webp = encode_options_for(&options, Format::WebP);
        assert!(should_use_auto_quality(&options, Format::WebP, &webp));

        options.lossless = true;
        let lossless_webp = encode_options_for(&options, Format::WebP);
        assert!(!should_use_auto_quality(
            &options,
            Format::WebP,
            &lossless_webp
        ));
        assert!(!should_use_auto_quality(
            &options,
            Format::Avif,
            &encode_options_for(&options, Format::Avif)
        ));
    }

    #[test]
    fn auto_quality_min_respects_requested_quality_ceiling() {
        assert_eq!(auto_quality_min(0, 80), 30);
        assert_eq!(auto_quality_min(0, 20), 20);
        assert_eq!(auto_quality_min(65, 80), 65);
        assert_eq!(auto_quality_min(90, 70), 70);
    }

    #[test]
    fn convert_wall_clock_timeout_parser_handles_defaults_disable_and_clamp() {
        assert_eq!(
            parse_convert_wall_clock_timeout(None)
                .unwrap()
                .unwrap()
                .as_secs(),
            DEFAULT_CONVERT_WALL_CLOCK_TIMEOUT_SECONDS
        );
        assert!(parse_convert_wall_clock_timeout(Some("0"))
            .unwrap()
            .is_none());
        assert!(parse_convert_wall_clock_timeout(Some("off"))
            .unwrap()
            .is_none());
        assert_eq!(
            parse_convert_wall_clock_timeout(Some("1"))
                .unwrap()
                .unwrap()
                .as_secs(),
            MIN_CONVERT_WALL_CLOCK_TIMEOUT_SECONDS
        );
        assert_eq!(
            parse_convert_wall_clock_timeout(Some("99999"))
                .unwrap()
                .unwrap()
                .as_secs(),
            MAX_CONVERT_WALL_CLOCK_TIMEOUT_SECONDS
        );
        assert!(parse_convert_wall_clock_timeout(Some("bad")).is_err());
    }

    #[test]
    fn generation_loss_protection_uses_bpp_tiered_savings() {
        let mut options = test_convert_options("/tmp/input.jpg".to_string());
        options.generation_loss_protection = true;
        let encode = encode_options_for(&options, Format::Jpeg);

        assert!(should_skip_generation_loss(
            &options,
            GenerationLossCheck {
                source: &[0xff, 0xd8, 0xff],
                source_format: Some(Format::Jpeg),
                target: Format::Jpeg,
                encode_options: &encode,
                dimensions: Some((1000, 1000)),
                source_size: 60_000,
                candidate_size: 57_500,
            },
        ));
        assert!(!should_skip_generation_loss(
            &options,
            GenerationLossCheck {
                source: &[0xff, 0xd8, 0xff],
                source_format: Some(Format::Jpeg),
                target: Format::Jpeg,
                encode_options: &encode,
                dimensions: Some((1000, 1000)),
                source_size: 60_000,
                candidate_size: 54_000,
            },
        ));
        assert!(!should_skip_generation_loss(
            &options,
            GenerationLossCheck {
                source: b"\x89PNG\r\n\x1a\n",
                source_format: Some(Format::Png),
                target: Format::Jpeg,
                encode_options: &encode,
                dimensions: Some((1000, 1000)),
                source_size: 60_000,
                candidate_size: 57_500,
            },
        ));

        options.lossless = true;
        let lossless_avif = encode_options_for(&options, Format::Avif);
        assert!(lossless_avif.lossless);
        assert!(!should_skip_generation_loss(
            &options,
            GenerationLossCheck {
                source: &[0xff, 0xd8, 0xff],
                source_format: Some(Format::Jpeg),
                target: Format::Avif,
                encode_options: &lossless_avif,
                dimensions: Some((1000, 1000)),
                source_size: 60_000,
                candidate_size: 59_500,
            },
        ));
    }

    #[test]
    fn result_cache_key_includes_source_and_encode_settings() {
        let mut options = test_convert_options("/tmp/input.png".to_string());
        options.result_cache = true;
        let encode = encode_options_for(&options, Format::Jpeg);

        let key_a = result_cache_key(
            &options,
            Format::Jpeg,
            &encode,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            None,
        );
        let key_b = result_cache_key(
            &options,
            Format::Jpeg,
            &encode,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-b",
            None,
        );
        options.quality = 70;
        let changed_encode = encode_options_for(&options, Format::Jpeg);
        let key_c = result_cache_key(
            &options,
            Format::Jpeg,
            &changed_encode,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            None,
        );

        assert_eq!(key_a.len(), 64);
        assert_ne!(key_a, key_b);
        assert_ne!(key_a, key_c);
    }

    #[test]
    fn result_cache_key_ignores_inactive_webp_near_lossless() {
        let mut options = test_convert_options("/tmp/input.png".to_string());
        options.result_cache = true;
        options.webp_near_lossless = 20;
        let lossy_a = encode_options_for(&options, Format::WebP);
        let key_a = result_cache_key(
            &options,
            Format::WebP,
            &lossy_a,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            None,
        );

        options.webp_near_lossless = 80;
        let lossy_b = encode_options_for(&options, Format::WebP);
        let key_b = result_cache_key(
            &options,
            Format::WebP,
            &lossy_b,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            None,
        );

        assert_eq!(lossy_a.webp_near_lossless, default_webp_near_lossless());
        assert_eq!(lossy_b.webp_near_lossless, default_webp_near_lossless());
        assert_eq!(key_a, key_b);

        options.lossless = true;
        options.webp_near_lossless = 20;
        let lossless_a = encode_options_for(&options, Format::WebP);
        let key_lossless_a = result_cache_key(
            &options,
            Format::WebP,
            &lossless_a,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            None,
        );

        options.webp_near_lossless = 80;
        let lossless_b = encode_options_for(&options, Format::WebP);
        let key_lossless_b = result_cache_key(
            &options,
            Format::WebP,
            &lossless_b,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            None,
        );

        assert_eq!(lossless_a.webp_near_lossless, 20);
        assert_eq!(lossless_b.webp_near_lossless, 80);
        assert_ne!(key_lossless_a, key_lossless_b);
    }

    #[test]
    fn result_cache_key_includes_auto_quality_floor() {
        let mut options = test_convert_options("/tmp/input.png".to_string());
        options.result_cache = true;
        options.auto_quality = true;
        options.quality = 80;
        options.quality_floor = 30;
        let low_floor = encode_options_for(&options, Format::Jpeg);
        let key_low_floor = result_cache_key(
            &options,
            Format::Jpeg,
            &low_floor,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            None,
        );

        options.quality_floor = 70;
        let high_floor = encode_options_for(&options, Format::Jpeg);
        let key_high_floor = result_cache_key(
            &options,
            Format::Jpeg,
            &high_floor,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            None,
        );

        assert_eq!(low_floor.quality, high_floor.quality);
        assert_ne!(key_low_floor, key_high_floor);
    }

    #[test]
    fn result_cache_key_includes_metadata_override_when_preserved() {
        let mut options = test_convert_options("/tmp/input.png".to_string());
        options.result_cache = true;
        options.preserve_metadata = Some(true);
        let encode = encode_options_for(&options, Format::Png);
        let metadata_a = RawMetadata {
            icc: Some(b"ICC-A".to_vec()),
            exif: None,
            xmp: None,
            iptc: None,
        };
        let metadata_b = RawMetadata {
            icc: Some(b"ICC-B".to_vec()),
            exif: None,
            xmp: None,
            iptc: None,
        };

        let key_a = result_cache_key(
            &options,
            Format::Png,
            &encode,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            Some(&metadata_a),
        );
        let key_b = result_cache_key(
            &options,
            Format::Png,
            &encode,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            Some(&metadata_b),
        );

        assert_ne!(key_a, key_b);
    }

    #[test]
    fn result_cache_key_includes_color_policy_and_transform_metadata() {
        let mut options = test_convert_options("/tmp/input.png".to_string());
        options.result_cache = true;
        let encode = encode_options_for(&options, Format::Png);
        let metadata_a = RawMetadata {
            icc: Some(b"ICC-A".to_vec()),
            exif: None,
            xmp: None,
            iptc: None,
        };
        let metadata_b = RawMetadata {
            icc: Some(b"ICC-B".to_vec()),
            exif: None,
            xmp: None,
            iptc: None,
        };

        let preserve_key = result_cache_key(
            &options,
            Format::Png,
            &encode,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            b"source-a",
            Some(&metadata_a),
        );
        let srgb_key_a = result_cache_key(
            &options,
            Format::Png,
            &encode,
            ColorManagementPolicy::ConvertToSrgb,
            b"source-a",
            Some(&metadata_a),
        );
        let srgb_key_b = result_cache_key(
            &options,
            Format::Png,
            &encode,
            ColorManagementPolicy::ConvertToSrgb,
            b"source-a",
            Some(&metadata_b),
        );

        assert_ne!(preserve_key, srgb_key_a);
        assert_ne!(srgb_key_a, srgb_key_b);

        options.color_management_policy = Some("convertToSrgb".to_string());
        assert_eq!(
            color_management_policy_for(&options).unwrap(),
            ColorManagementPolicy::ConvertToSrgb
        );
        options.color_management_policy = Some("bad".to_string());
        assert!(color_management_policy_for(&options).is_err());
    }

    #[test]
    fn candidate_policy_error_applies_skip_if_larger_to_cached_size() {
        let mut options = test_convert_options("/tmp/input.png".to_string());
        options.skip_if_larger = true;
        let encode = encode_options_for(&options, Format::Jpeg);

        let message = candidate_policy_error(
            &options,
            CandidatePolicyCheck {
                source: b"\x89PNG\r\n\x1a\n",
                source_format: Some(Format::Png),
                target: Format::Jpeg,
                encode_options: &encode,
                dimensions: Some((1, 1)),
                source_size: 42,
                candidate_size: 42,
            },
        )
        .unwrap();

        assert!(message.contains("不小于源文件"));
    }

    #[test]
    fn candidate_policy_does_not_compare_svg_source_bytes_with_raster_output() {
        let mut options = test_convert_options("/tmp/input.svg".to_string());
        options.skip_if_larger = true;
        let encode = encode_options_for(&options, Format::Jpeg);

        let message = candidate_policy_error(
            &options,
            CandidatePolicyCheck {
                source: br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>"#,
                source_format: Some(Format::Svg),
                target: Format::Jpeg,
                encode_options: &encode,
                dimensions: Some((1, 1)),
                source_size: 96,
                candidate_size: 512,
            },
        );

        assert!(message.is_none());
    }

    #[test]
    fn blake3_hash_file_reports_size_and_hash() {
        let dir = unique_test_dir("hash-file");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.bin");
        let data = b"cached-output";
        fs::write(&path, data).unwrap();

        let (size, hash) = blake3_hash_file(&path).unwrap();

        assert_eq!(size, data.len() as u64);
        assert_eq!(hash, blake3::hash(data));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn result_cache_record_parser_rejects_malformed_data() {
        let valid_hash = "a".repeat(64);
        let valid = format!("v1\n{valid_hash}\n42\n");

        assert_eq!(
            parse_result_cache_record(&valid),
            Some(ResultCacheRecord {
                output_hash: valid_hash,
                output_size: 42,
            })
        );
        assert!(parse_result_cache_record("v0\nabc\n42\n").is_none());
        assert!(parse_result_cache_record("v1\nnot-hex\n42\n").is_none());
        assert!(parse_result_cache_record("v1\nabc\nsize\n").is_none());
    }

    #[test]
    fn write_output_replace_replaces_and_cleans_temp_file() {
        let dir = unique_test_dir("replace");
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.bin");
        fs::write(&out, b"old").unwrap();

        write_output(&out, b"new", WriteMode::Replace).unwrap();

        assert_eq!(fs::read(&out).unwrap(), b"new");
        let leftovers = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".imgconvert-")
            })
            .count();
        assert_eq!(leftovers, 0);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replace_existing_output_restores_old_file_when_new_rename_fails() {
        let dir = unique_test_dir("replace-restore");
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.bin");
        fs::write(&out, b"old").unwrap();
        let tmp = write_temp_output(&out, b"new").unwrap();
        let mut rename_calls = 0;

        let error = replace_existing_output_with_rename(&tmp, &out, &mut |from, to| {
            rename_calls += 1;
            if rename_calls == 2 {
                Err(std::io::Error::other("injected placement failure"))
            } else {
                fs::rename(from, to)
            }
        })
        .unwrap_err();

        assert!(error.contains("原文件已恢复"));
        assert_eq!(fs::read(&out).unwrap(), b"old");
        assert!(!tmp.exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replace_existing_output_rejects_directory_without_moving_it() {
        let dir = unique_test_dir("replace-directory");
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("output");
        fs::create_dir_all(&out).unwrap();
        let nested = out.join("keep.txt");
        fs::write(&nested, b"keep").unwrap();
        let tmp = write_temp_output(&out, b"new").unwrap();

        let error = replace_existing_output(&tmp, &out).unwrap_err();

        assert!(error.contains("目录输出路径"));
        assert!(out.is_dir());
        assert_eq!(fs::read(&nested).unwrap(), b"keep");
        assert!(!tmp.exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn replace_existing_output_replaces_symlink_without_touching_its_target() {
        use std::os::unix::fs::symlink;

        let dir = unique_test_dir("replace-symlink");
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("target.bin");
        let out = dir.join("output.bin");
        fs::write(&target, b"old-target").unwrap();
        symlink(&target, &out).unwrap();
        let tmp = write_temp_output(&out, b"new-output").unwrap();

        let warning = replace_existing_output(&tmp, &out).unwrap();

        assert!(warning.is_none());
        assert_eq!(fs::read(&out).unwrap(), b"new-output");
        assert_eq!(fs::read(&target).unwrap(), b"old-target");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn output_entry_exists_recognizes_a_dangling_symlink() {
        use std::os::unix::fs::symlink;

        let dir = unique_test_dir("dangling-output-symlink");
        fs::create_dir_all(&dir).unwrap();
        let output = dir.join("output.bin");
        symlink(dir.join("missing-target.bin"), &output).unwrap();

        assert!(output_entry_exists(&output));
        assert!(!output.exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replace_existing_output_writes_when_destination_disappears_during_staging() {
        let dir = unique_test_dir("replace-vanished-output");
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.bin");
        fs::write(&out, b"old").unwrap();
        let tmp = write_temp_output(&out, b"new").unwrap();
        let mut rename_calls = 0;

        let warning = replace_existing_output_with_rename(&tmp, &out, &mut |from, to| {
            rename_calls += 1;
            if rename_calls == 1 {
                fs::remove_file(from)?;
                return Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "destination disappeared",
                ));
            }
            fs::rename(from, to)
        })
        .unwrap();

        assert!(warning.is_none());
        assert_eq!(fs::read(&out).unwrap(), b"new");
        assert!(!tmp.exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replace_existing_output_reports_retained_backup_when_restore_fails() {
        let dir = unique_test_dir("replace-restore-failure");
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.bin");
        fs::write(&out, b"old").unwrap();
        let tmp = write_temp_output(&out, b"new").unwrap();
        let mut rename_calls = 0;
        let mut backup = None;

        let error = replace_existing_output_with_rename(&tmp, &out, &mut |from, to| {
            rename_calls += 1;
            if rename_calls == 1 {
                backup = Some(to.to_path_buf());
                return fs::rename(from, to);
            }
            Err(std::io::Error::other("injected rename failure"))
        })
        .unwrap_err();

        let backup = backup.unwrap();
        assert!(error.contains("无法恢复原文件"));
        assert!(error.contains(&backup.to_string_lossy().to_string()));
        assert!(!out.exists());
        assert!(!tmp.exists());
        assert_eq!(fs::read(&backup).unwrap(), b"old");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn backup_path_stays_short_for_a_name_at_the_filesystem_limit() {
        let dir = unique_test_dir("backup-name-length");
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("a".repeat(255));

        let backup = backup_path(&out).unwrap();

        assert!(backup.file_name().unwrap().len() < 100);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_warning_serializes_as_the_frontend_contract() {
        let warning = ConvertWarning::PreviousOutputBackupRetained {
            path: "/tmp/imgconvert-backup".to_string(),
        };

        let serialized = serde_json::to_value(warning).unwrap();

        assert_eq!(serialized["code"], "previousOutputBackupRetained");
        assert_eq!(serialized["path"], "/tmp/imgconvert-backup");
    }

    #[test]
    fn replace_existing_output_succeeds_when_backup_cleanup_fails() {
        let dir = unique_test_dir("replace-backup-cleanup");
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.bin");
        fs::write(&out, b"old").unwrap();
        let tmp = write_temp_output(&out, b"new").unwrap();
        let mut rename_calls = 0;
        let mut backup = None;

        let warning = replace_existing_output_with_rename(&tmp, &out, &mut |from, to| {
            rename_calls += 1;
            if rename_calls == 1 {
                backup = Some(to.to_path_buf());
                return fs::rename(from, to);
            }

            fs::rename(from, to)?;
            let backup = backup.as_ref().unwrap();
            fs::remove_file(backup)?;
            fs::create_dir(backup)?;
            fs::write(backup.join("retained"), b"keep")
        })
        .unwrap();

        assert_eq!(fs::read(&out).unwrap(), b"new");
        assert!(!tmp.exists());
        assert_eq!(
            warning,
            Some(ConvertWarning::PreviousOutputBackupRetained {
                path: backup.as_ref().unwrap().to_string_lossy().to_string(),
            })
        );
        assert!(backup.as_ref().unwrap().join("retained").is_file());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn batch_state_allows_one_active_task_and_cancels_it() {
        let state = BatchState::default();
        let batch = state.begin().unwrap();

        assert!(state.begin().is_err());
        assert!(state.cancel_current());
        assert!(batch.token.is_cancelled());

        state.finish(batch.id());
        assert!(state.begin().is_ok());
    }

    #[test]
    fn batch_empty_options_finishes_cleanly() {
        let progress = Channel::<BatchProgressEvent>::new(|_| Ok(()));
        let summary = convert_batch(Vec::new(), progress, CancellationToken::new(), None).unwrap();

        assert_eq!(summary.total, 0);
        assert_eq!(summary.completed, 0);
        assert_eq!(summary.skipped, 0);
        assert_eq!(summary.failed, 0);
        assert!(!summary.cancelled);
    }

    #[test]
    fn batch_converts_one_file_and_writes_summary() {
        let dir = unique_test_dir("batch-convert");
        let out_dir = dir.join("out");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.png");
        fs::write(&input, one_by_one_png()).unwrap();

        let options = ConvertOptions {
            input: input.to_string_lossy().to_string(),
            out_dir: Some(out_dir.to_string_lossy().to_string()),
            relative_dir: None,
            source_width: None,
            source_height: None,
            format: "jpeg".to_string(),
            quality: 80,
            quality_floor: 0,
            lossless: false,
            jpeg_progressive: default_jpeg_progressive(),
            png_oxipng_level: default_png_oxipng_level(),
            png_lossy_quantize: false,
            png_quant_colors: default_png_quant_colors(),
            webp_method: default_webp_method(),
            avif_speed: default_avif_speed(),
            avif_subsample: default_avif_subsample(),
            webp_near_lossless: default_webp_near_lossless(),
            webp_sharp_yuv: false,
            jpeg_trellis: default_jpeg_trellis(),
            auto_quality: false,
            auto_quality_score: default_auto_quality_score(),
            generation_loss_protection: false,
            result_cache: false,
            skip_if_larger: false,
            multi_candidate: false,
            overwrite: false,
            overwrite_mode: Some("skip".to_string()),
            file_name_template: Some("%name%".to_string()),
            output_suffix: None,
            allow_source_overwrite: false,
            preserve_metadata: Some(false),
            color_management_policy: None,
        };
        let progress = Channel::<BatchProgressEvent>::new(|_| Ok(()));
        let summary =
            convert_batch(vec![options], progress, CancellationToken::new(), Some(2)).unwrap();

        assert_eq!(summary.total, 1);
        assert_eq!(summary.completed, 1);
        assert_eq!(summary.skipped, 0);
        assert_eq!(summary.failed, 0);
        assert!(out_dir.join("sample.jpg").exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_skips_candidate_that_is_not_smaller_than_source() {
        let dir = unique_test_dir("skip-larger-single");
        let out_dir = dir.join("out");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.png");
        fs::write(&input, one_by_one_png()).unwrap();

        let mut options = test_convert_options(input.to_string_lossy().to_string());
        options.out_dir = Some(out_dir.to_string_lossy().to_string());
        options.skip_if_larger = true;
        options.multi_candidate = false;

        let err = convert(&options).unwrap_err();

        assert!(err.contains("不小于源文件"));
        assert!(!out_dir.join("sample.jpg").exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_writes_larger_candidate_when_size_policy_is_disabled() {
        let dir = unique_test_dir("allow-larger-single");
        let out_dir = dir.join("out");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.png");
        let source = one_by_one_png();
        fs::write(&input, &source).unwrap();

        let mut options = test_convert_options(input.to_string_lossy().to_string());
        options.out_dir = Some(out_dir.to_string_lossy().to_string());
        options.skip_if_larger = false;
        options.multi_candidate = false;

        let result = convert(&options).unwrap();

        assert!(Path::new(&result.output).exists());
        assert!(result.out_size >= source.len() as u64);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn batch_counts_skip_if_larger_and_keeps_existing_output() {
        let dir = unique_test_dir("skip-larger-batch");
        let out_dir = dir.join("out");
        fs::create_dir_all(&out_dir).unwrap();
        let input = dir.join("sample.png");
        let output = out_dir.join("sample.jpg");
        fs::write(&input, one_by_one_png()).unwrap();
        fs::write(&output, b"old").unwrap();

        let mut options = test_convert_options(input.to_string_lossy().to_string());
        options.out_dir = Some(out_dir.to_string_lossy().to_string());
        options.overwrite = true;
        options.overwrite_mode = Some("overwrite".to_string());
        options.skip_if_larger = true;
        options.multi_candidate = false;
        let progress = Channel::<BatchProgressEvent>::new(|_| Ok(()));

        let summary =
            convert_batch(vec![options], progress, CancellationToken::new(), Some(2)).unwrap();

        assert_eq!(summary.total, 1);
        assert_eq!(summary.completed, 0);
        assert_eq!(summary.skipped, 1);
        assert_eq!(summary.failed, 0);
        assert_eq!(fs::read(output).unwrap(), b"old");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn conversion_plan_reports_existing_outputs_per_entry() {
        let dir = unique_test_dir("plan-existing");
        let out_dir = dir.join("out");
        fs::create_dir_all(&out_dir).unwrap();
        let input = dir.join("sample.png");
        let output = out_dir.join("sample.jpg");
        fs::write(&input, one_by_one_png()).unwrap();
        fs::write(&output, b"old").unwrap();

        let options = ConvertOptions {
            input: input.to_string_lossy().to_string(),
            out_dir: Some(out_dir.to_string_lossy().to_string()),
            relative_dir: None,
            source_width: None,
            source_height: None,
            format: "jpeg".to_string(),
            quality: 80,
            quality_floor: 0,
            lossless: false,
            jpeg_progressive: default_jpeg_progressive(),
            png_oxipng_level: default_png_oxipng_level(),
            png_lossy_quantize: false,
            png_quant_colors: default_png_quant_colors(),
            webp_method: default_webp_method(),
            avif_speed: default_avif_speed(),
            avif_subsample: default_avif_subsample(),
            webp_near_lossless: default_webp_near_lossless(),
            webp_sharp_yuv: false,
            jpeg_trellis: default_jpeg_trellis(),
            auto_quality: false,
            auto_quality_score: default_auto_quality_score(),
            generation_loss_protection: false,
            result_cache: false,
            skip_if_larger: false,
            multi_candidate: false,
            overwrite: false,
            overwrite_mode: Some("ask".to_string()),
            file_name_template: Some("%name%".to_string()),
            output_suffix: None,
            allow_source_overwrite: false,
            preserve_metadata: Some(false),
            color_management_policy: None,
        };

        let plan = conversion_plan(&[options]);

        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].index, 0);
        assert!(plan[0].exists);
        assert_eq!(
            plan[0].output.as_deref(),
            Some(output.to_string_lossy().as_ref())
        );
        assert!(plan[0].error.is_none());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn conversion_plan_marks_output_that_is_the_same_source_file() {
        let dir = unique_test_dir("plan-source-collision");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("real.png");
        let output_alias = dir.join("alias.png");
        fs::write(&input, one_by_one_png()).unwrap();
        fs::hard_link(&input, &output_alias).unwrap();

        let mut options = test_convert_options(input.to_string_lossy().to_string());
        options.format = "png".to_string();
        options.file_name_template = Some("alias".to_string());

        let plan = conversion_plan(&[options]);

        assert!(plan[0].exists);
        assert!(plan[0].same_as_source);
        assert!(!plan[0].conflicts_with_queued_input);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_requires_explicit_authorization_before_replacing_the_source() {
        let dir = unique_test_dir("source-overwrite-confirmation");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.png");
        let original = one_by_one_png();
        fs::write(&input, &original).unwrap();

        let mut options = test_convert_options(input.to_string_lossy().to_string());
        options.format = "png".to_string();
        options.overwrite = true;
        options.overwrite_mode = Some("overwrite".to_string());

        let error = convert(&options).unwrap_err();
        assert!(error.starts_with(SOURCE_OVERWRITE_CONFIRMATION_REQUIRED_PREFIX));
        assert_eq!(fs::read(&input).unwrap(), original);

        options.allow_source_overwrite = true;
        let result = convert(&options).unwrap();
        assert_eq!(PathBuf::from(result.output), input);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn output_suffix_is_literal_validated_and_keeps_a_safe_filename_length() {
        let mut options = test_convert_options("holiday.2026.01.png".to_string());
        options.out_dir = Some("out".to_string());
        options.output_suffix = Some("_done%100".to_string());

        assert_eq!(
            output_path(&options).unwrap(),
            PathBuf::from("out").join("holiday.2026.01_done%100.jpg")
        );

        options.output_suffix = Some("_bad/path".to_string());
        assert!(output_path(&options)
            .unwrap_err()
            .starts_with(INVALID_OUTPUT_SUFFIX_PREFIX));

        options.output_suffix = Some(".jpg".to_string());
        assert_eq!(
            output_path(&options).unwrap(),
            PathBuf::from("out").join("holiday.2026.01.jpg.jpg")
        );

        options.output_suffix = Some("x".repeat(MAX_OUTPUT_SUFFIX_CHARS + 1));
        assert!(output_path(&options)
            .unwrap_err()
            .starts_with(INVALID_OUTPUT_SUFFIX_PREFIX));

        options.input = format!("{}.png", "a".repeat(300));
        options.output_suffix = Some("_done".to_string());
        let output_name = output_path(&options)
            .unwrap()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(output_name.len() <= MAX_OUTPUT_FILE_NAME_BYTES);
        assert!(output_name.ends_with("_done.jpg"));

        let emoji_suffix = "😀".repeat(MAX_OUTPUT_SUFFIX_BYTES / "😀".len());
        options.output_suffix = Some(emoji_suffix.clone());
        let output_name = output_path(&options)
            .unwrap()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(output_name.len() <= MAX_OUTPUT_FILE_NAME_BYTES);
        assert!(output_name.ends_with(&format!("{emoji_suffix}.jpg")));
    }

    #[test]
    fn batch_preflight_rejects_output_that_would_replace_another_queued_input() {
        let dir = unique_test_dir("batch-input-collision");
        fs::create_dir_all(&dir).unwrap();
        let png = dir.join("sample.png");
        let jpeg = dir.join("sample.jpg");
        fs::write(&png, one_by_one_png()).unwrap();
        fs::write(&jpeg, one_by_one_png()).unwrap();

        let mut png_to_jpeg = test_convert_options(png.to_string_lossy().to_string());
        png_to_jpeg.format = "jpeg".to_string();
        let mut jpeg_to_png = test_convert_options(jpeg.to_string_lossy().to_string());
        jpeg_to_png.format = "png".to_string();

        let (jobs, preflight_events) = prepare_batch_work(vec![png_to_jpeg, jpeg_to_png]);

        assert!(jobs.is_empty());
        assert_eq!(preflight_events.len(), 2);
        assert!(preflight_events.iter().all(|event| matches!(
            event,
            BatchProgressEvent::FileError {
                error: CommandError {
                    code: crate::command_error::ErrorCode::OutputConflictsWithInput,
                    ..
                },
                ..
            }
        )));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn batch_identity_preflight_does_not_keep_one_file_descriptor_per_input() {
        fn open_descriptor_count() -> Option<usize> {
            fs::read_dir("/proc/self/fd")
                .ok()
                .map(|entries| entries.count())
        }

        let Some(before) = open_descriptor_count() else {
            return;
        };
        let dir = unique_test_dir("batch-identity-fds");
        fs::create_dir_all(&dir).unwrap();
        let options = (0..192)
            .map(|index| {
                let input = dir.join(format!("input-{index}.png"));
                fs::write(&input, b"identity").unwrap();
                test_convert_options(input.to_string_lossy().to_string())
            })
            .collect::<Vec<_>>();

        let identities = input_identity_index(&options).unwrap();
        let after = open_descriptor_count().unwrap();

        assert_eq!(identities.len(), options.len());
        // Allow a small amount of parallel-test noise. The old
        // `same_file::Handle` index retained 192 descriptors here.
        assert!(
            after <= before + 16,
            "identity preflight unexpectedly retained descriptors: before={before}, after={after}"
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn output_path_preserves_safe_relative_directory_under_out_dir() {
        let dir = unique_test_dir("relative-output");
        let input = dir.join("source").join("photo.png");
        let out_dir = dir.join("out");
        fs::create_dir_all(input.parent().unwrap()).unwrap();
        fs::write(&input, one_by_one_png()).unwrap();

        let options = ConvertOptions {
            input: input.to_string_lossy().to_string(),
            out_dir: Some(out_dir.to_string_lossy().to_string()),
            relative_dir: Some("album/day-1".to_string()),
            source_width: None,
            source_height: None,
            format: "jpeg".to_string(),
            quality: 80,
            quality_floor: 0,
            lossless: false,
            jpeg_progressive: default_jpeg_progressive(),
            png_oxipng_level: default_png_oxipng_level(),
            png_lossy_quantize: false,
            png_quant_colors: default_png_quant_colors(),
            webp_method: default_webp_method(),
            avif_speed: default_avif_speed(),
            avif_subsample: default_avif_subsample(),
            webp_near_lossless: default_webp_near_lossless(),
            webp_sharp_yuv: false,
            jpeg_trellis: default_jpeg_trellis(),
            auto_quality: false,
            auto_quality_score: default_auto_quality_score(),
            generation_loss_protection: false,
            result_cache: false,
            skip_if_larger: false,
            multi_candidate: false,
            overwrite: false,
            overwrite_mode: Some("skip".to_string()),
            file_name_template: Some("%name%".to_string()),
            output_suffix: None,
            allow_source_overwrite: false,
            preserve_metadata: Some(false),
            color_management_policy: None,
        };

        let output = output_path(&options).unwrap();

        assert_eq!(
            output,
            out_dir.join("album").join("day-1").join("photo.jpg")
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn output_path_preserves_dotted_stems_and_template_suffixes() {
        let mut options = test_convert_options("holiday.2026.01.png".to_string());
        options.out_dir = Some("out".to_string());

        assert_eq!(
            output_path(&options).unwrap(),
            PathBuf::from("out").join("holiday.2026.01.jpg")
        );

        options.file_name_template = Some("%name%-imgconvert-smoke".to_string());
        assert_eq!(
            output_path(&options).unwrap(),
            PathBuf::from("out").join("holiday.2026.01-imgconvert-smoke.jpg")
        );

        options.file_name_template = Some("%name%-%date%".to_string());
        let dated_output = output_path(&options).unwrap();
        let dated_name = dated_output.file_name().unwrap().to_string_lossy();
        assert!(dated_name.starts_with("holiday.2026.01-"));
        assert!(dated_name.ends_with(".jpg"));

        options.file_name_template = Some("%name%.%extension%".to_string());
        assert_eq!(
            output_path(&options).unwrap(),
            PathBuf::from("out").join("holiday.2026.01.jpg")
        );
    }

    #[test]
    fn batch_preflight_keeps_distinct_dotted_source_stems() {
        let mut first = test_convert_options("holiday.2026.01.png".to_string());
        first.out_dir = Some("out".to_string());
        let mut second = first.clone();
        second.input = "holiday.2026.02.png".to_string();

        let (jobs, preflight_events) = prepare_batch_work(vec![first, second]);

        assert_eq!(jobs.len(), 2);
        assert!(preflight_events.is_empty());
    }

    #[test]
    fn output_path_rejects_unsafe_relative_directory() {
        let options = ConvertOptions {
            input: "photo.png".to_string(),
            out_dir: Some("out".to_string()),
            relative_dir: Some("../escape".to_string()),
            source_width: None,
            source_height: None,
            format: "jpeg".to_string(),
            quality: 80,
            quality_floor: 0,
            lossless: false,
            jpeg_progressive: default_jpeg_progressive(),
            png_oxipng_level: default_png_oxipng_level(),
            png_lossy_quantize: false,
            png_quant_colors: default_png_quant_colors(),
            webp_method: default_webp_method(),
            avif_speed: default_avif_speed(),
            avif_subsample: default_avif_subsample(),
            webp_near_lossless: default_webp_near_lossless(),
            webp_sharp_yuv: false,
            jpeg_trellis: default_jpeg_trellis(),
            auto_quality: false,
            auto_quality_score: default_auto_quality_score(),
            generation_loss_protection: false,
            result_cache: false,
            skip_if_larger: false,
            multi_candidate: false,
            overwrite: false,
            overwrite_mode: Some("skip".to_string()),
            file_name_template: Some("%name%".to_string()),
            output_suffix: None,
            allow_source_overwrite: false,
            preserve_metadata: Some(false),
            color_management_policy: None,
        };

        let err = output_path(&options).unwrap_err();

        assert!(err.contains("非法路径片段"));
    }

    #[test]
    fn batch_converts_multiple_files_with_requested_concurrency() {
        let dir = unique_test_dir("batch-convert-concurrent");
        let out_dir = dir.join("out");
        fs::create_dir_all(&dir).unwrap();
        let input_a = dir.join("sample-a.png");
        let input_b = dir.join("sample-b.png");
        fs::write(&input_a, one_by_one_png()).unwrap();
        fs::write(&input_b, one_by_one_png()).unwrap();

        let options = [input_a.clone(), input_b.clone()]
            .into_iter()
            .map(|input| ConvertOptions {
                input: input.to_string_lossy().to_string(),
                out_dir: Some(out_dir.to_string_lossy().to_string()),
                relative_dir: None,
                source_width: None,
                source_height: None,
                format: "jpeg".to_string(),
                quality: 80,
                quality_floor: 0,
                lossless: false,
                jpeg_progressive: default_jpeg_progressive(),
                png_oxipng_level: default_png_oxipng_level(),
                png_lossy_quantize: false,
                png_quant_colors: default_png_quant_colors(),
                webp_method: default_webp_method(),
                avif_speed: default_avif_speed(),
                avif_subsample: default_avif_subsample(),
                webp_near_lossless: default_webp_near_lossless(),
                webp_sharp_yuv: false,
                jpeg_trellis: default_jpeg_trellis(),
                auto_quality: false,
                auto_quality_score: default_auto_quality_score(),
                generation_loss_protection: false,
                result_cache: false,
                skip_if_larger: false,
                multi_candidate: false,
                overwrite: false,
                overwrite_mode: Some("skip".to_string()),
                file_name_template: Some("%name%".to_string()),
                output_suffix: None,
                allow_source_overwrite: false,
                preserve_metadata: Some(false),
                color_management_policy: None,
            })
            .collect();
        let progress = Channel::<BatchProgressEvent>::new(|_| Ok(()));
        let summary = convert_batch(options, progress, CancellationToken::new(), Some(2)).unwrap();

        assert_eq!(summary.total, 2);
        assert_eq!(summary.completed, 2);
        assert_eq!(summary.skipped, 0);
        assert_eq!(summary.failed, 0);
        assert!(out_dir.join("sample-a.jpg").exists());
        assert!(out_dir.join("sample-b.jpg").exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn batch_rejects_duplicate_output_paths_before_parallel_work() {
        let dir = unique_test_dir("batch-duplicate-output");
        let source_a = dir.join("a");
        let source_b = dir.join("b");
        let out_dir = dir.join("out");
        fs::create_dir_all(&source_a).unwrap();
        fs::create_dir_all(&source_b).unwrap();
        let input_a = source_a.join("sample.png");
        let input_b = source_b.join("sample.png");
        fs::write(&input_a, one_by_one_png()).unwrap();
        fs::write(&input_b, one_by_one_png()).unwrap();

        let options = [input_a.clone(), input_b.clone()]
            .into_iter()
            .map(|input| ConvertOptions {
                input: input.to_string_lossy().to_string(),
                out_dir: Some(out_dir.to_string_lossy().to_string()),
                relative_dir: None,
                source_width: None,
                source_height: None,
                format: "jpeg".to_string(),
                quality: 80,
                quality_floor: 0,
                lossless: false,
                jpeg_progressive: default_jpeg_progressive(),
                png_oxipng_level: default_png_oxipng_level(),
                png_lossy_quantize: false,
                png_quant_colors: default_png_quant_colors(),
                webp_method: default_webp_method(),
                avif_speed: default_avif_speed(),
                avif_subsample: default_avif_subsample(),
                webp_near_lossless: default_webp_near_lossless(),
                webp_sharp_yuv: false,
                jpeg_trellis: default_jpeg_trellis(),
                auto_quality: false,
                auto_quality_score: default_auto_quality_score(),
                generation_loss_protection: false,
                result_cache: false,
                skip_if_larger: false,
                multi_candidate: false,
                overwrite: true,
                overwrite_mode: Some("overwrite".to_string()),
                file_name_template: Some("%name%".to_string()),
                output_suffix: None,
                allow_source_overwrite: false,
                preserve_metadata: Some(false),
                color_management_policy: None,
            })
            .collect();
        let progress = Channel::<BatchProgressEvent>::new(|_| Ok(()));
        let summary = convert_batch(options, progress, CancellationToken::new(), Some(2)).unwrap();

        assert_eq!(summary.total, 2);
        assert_eq!(summary.completed, 1);
        assert_eq!(summary.skipped, 0);
        assert_eq!(summary.failed, 1);
        assert!(!summary.cancelled);
        assert!(out_dir.join("sample.jpg").exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_preserves_source_modified_time_on_output() {
        let dir = unique_test_dir("preserve-mtime");
        let out_dir = dir.join("out");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.png");
        fs::write(&input, one_by_one_png()).unwrap();
        let modified = UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        set_modified_time(&input, modified).unwrap();

        let options = ConvertOptions {
            input: input.to_string_lossy().to_string(),
            out_dir: Some(out_dir.to_string_lossy().to_string()),
            relative_dir: Some("nested".to_string()),
            source_width: None,
            source_height: None,
            format: "jpeg".to_string(),
            quality: 80,
            quality_floor: 0,
            lossless: false,
            jpeg_progressive: default_jpeg_progressive(),
            png_oxipng_level: default_png_oxipng_level(),
            png_lossy_quantize: false,
            png_quant_colors: default_png_quant_colors(),
            webp_method: default_webp_method(),
            avif_speed: default_avif_speed(),
            avif_subsample: default_avif_subsample(),
            webp_near_lossless: default_webp_near_lossless(),
            webp_sharp_yuv: false,
            jpeg_trellis: default_jpeg_trellis(),
            auto_quality: false,
            auto_quality_score: default_auto_quality_score(),
            generation_loss_protection: false,
            result_cache: false,
            skip_if_larger: false,
            multi_candidate: false,
            overwrite: false,
            overwrite_mode: Some("skip".to_string()),
            file_name_template: Some("%name%".to_string()),
            output_suffix: None,
            allow_source_overwrite: false,
            preserve_metadata: Some(false),
            color_management_policy: None,
        };

        let result = convert(&options).unwrap();
        let output_modified = fs::metadata(result.output).unwrap().modified().unwrap();
        let delta = output_modified
            .duration_since(modified)
            .or_else(|_| modified.duration_since(output_modified))
            .unwrap();

        assert!(delta < std::time::Duration::from_secs(2));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn path_conversion_smoke_options_use_stable_overwrite_defaults() {
        let options = path_conversion_smoke_options(
            "/tmp/input.heic".to_string(),
            Some("/tmp/out".to_string()),
            "png".to_string(),
        );

        assert_eq!(options.input, "/tmp/input.heic");
        assert_eq!(options.out_dir.as_deref(), Some("/tmp/out"));
        assert_eq!(options.format, "png");
        assert_eq!(options.overwrite_mode.as_deref(), Some("overwrite"));
        assert_eq!(
            options.file_name_template.as_deref(),
            Some("%name%-imgconvert-smoke")
        );
        assert!(!options.skip_if_larger);
        assert!(!options.result_cache);
        assert!(!options.multi_candidate);
        assert_eq!(options.preserve_metadata, Some(false));
    }

    #[test]
    fn batch_concurrency_respects_default_bounds_request_and_total() {
        assert_eq!(resolve_batch_concurrency(Some(0), 0), 0);
        assert_eq!(resolve_batch_concurrency(Some(1), 10), 1);
        assert_eq!(
            resolve_batch_concurrency(Some(999), 10),
            MAX_BATCH_CONCURRENCY
        );
        assert_eq!(resolve_batch_concurrency(Some(999), 3), 3);
        assert!((1..=MAX_BATCH_CONCURRENCY).contains(&resolve_batch_concurrency(None, 999)));
    }

    #[test]
    fn runtime_diagnostics_expose_concurrency_and_avif_thread_limits() {
        let diagnostics = runtime_diagnostics();

        assert!(diagnostics.available_parallelism >= 1);
        assert!((1..=MAX_BATCH_CONCURRENCY).contains(&diagnostics.default_batch_concurrency));
        assert_eq!(diagnostics.max_batch_concurrency, MAX_BATCH_CONCURRENCY);
        assert_eq!(
            diagnostics.batch_memory_budget_bytes,
            BATCH_MEMORY_BUDGET_BYTES
        );
        assert_eq!(
            diagnostics.avif_encoder_max_threads,
            imgconvert_core::AVIF_ENCODER_MAX_THREADS
        );
        assert_eq!(
            diagnostics.auto_quality_max_scoring_evaluations,
            imgconvert_core::AUTO_QUALITY_MAX_SCORING_EVALUATIONS
        );
        if std::env::var_os(CONVERT_WALL_CLOCK_TIMEOUT_ENV).is_none() {
            assert_eq!(
                diagnostics.convert_wall_clock_timeout_seconds,
                Some(DEFAULT_CONVERT_WALL_CLOCK_TIMEOUT_SECONDS)
            );
        }
    }

    #[test]
    fn memory_budget_reduces_parallelism_for_large_sources() {
        let dir = unique_test_dir("memory-budget-large");
        fs::create_dir_all(&dir).unwrap();
        let jobs = (0..4)
            .map(|index| {
                let input = dir.join(format!("sample-{index}.png"));
                File::create(&input).unwrap();
                let mut options = test_convert_options(input.to_string_lossy().into_owned());
                options.source_width = Some(6000);
                options.source_height = Some(4000);
                IndexedConvertOptions { index, options }
            })
            .collect::<Vec<_>>();

        assert_eq!(apply_memory_budget(4, jobs.iter()), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn memory_budget_forces_single_worker_for_oversized_sources() {
        let dir = unique_test_dir("memory-budget-oversized");
        fs::create_dir_all(&dir).unwrap();
        let jobs = (0..2)
            .map(|index| {
                let input = dir.join(format!("huge-{index}.png"));
                File::create(&input).unwrap();
                let mut options = test_convert_options(input.to_string_lossy().into_owned());
                options.source_width = Some(12_000);
                options.source_height = Some(8000);
                IndexedConvertOptions { index, options }
            })
            .collect::<Vec<_>>();

        assert_eq!(apply_memory_budget(2, jobs.iter()), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn memory_budget_accounts_for_retained_source_bytes() {
        let dir = unique_test_dir("memory-budget-source-bytes");
        fs::create_dir_all(&dir).unwrap();
        let jobs = (0..3)
            .map(|index| {
                let input = dir.join(format!("large-payload-{index}.png"));
                File::create(&input)
                    .unwrap()
                    .set_len(MAX_CORE_SOURCE_FILE_BYTES)
                    .unwrap();
                let mut options = test_convert_options(input.to_string_lossy().into_owned());
                options.source_width = Some(1);
                options.source_height = Some(1);
                IndexedConvertOptions { index, options }
            })
            .collect::<Vec<_>>();

        // Three 256 MiB retained inputs exceed the 768 MiB batch budget;
        // two still fit alongside their small decoded working sets.
        assert_eq!(apply_memory_budget(3, jobs.iter()), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn memory_budget_serializes_heic_system_decode_jobs() {
        let jobs = (0..3)
            .map(|index| {
                let mut options = test_convert_options(format!("sample-{index}.heic"));
                options.source_width = Some(1);
                options.source_height = Some(1);
                IndexedConvertOptions { index, options }
            })
            .collect::<Vec<_>>();

        assert_eq!(apply_memory_budget(3, jobs.iter()), 1);
    }

    #[test]
    fn batch_cancelled_before_first_file_reports_cancelled() {
        let dir = unique_test_dir("batch-cancel");
        let out_dir = dir.join("out");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.png");
        fs::write(&input, one_by_one_png()).unwrap();

        let options = ConvertOptions {
            input: input.to_string_lossy().to_string(),
            out_dir: Some(out_dir.to_string_lossy().to_string()),
            relative_dir: None,
            source_width: None,
            source_height: None,
            format: "jpeg".to_string(),
            quality: 80,
            quality_floor: 0,
            lossless: false,
            jpeg_progressive: default_jpeg_progressive(),
            png_oxipng_level: default_png_oxipng_level(),
            png_lossy_quantize: false,
            png_quant_colors: default_png_quant_colors(),
            webp_method: default_webp_method(),
            avif_speed: default_avif_speed(),
            avif_subsample: default_avif_subsample(),
            webp_near_lossless: default_webp_near_lossless(),
            webp_sharp_yuv: false,
            jpeg_trellis: default_jpeg_trellis(),
            auto_quality: false,
            auto_quality_score: default_auto_quality_score(),
            generation_loss_protection: false,
            result_cache: false,
            skip_if_larger: false,
            multi_candidate: false,
            overwrite: false,
            overwrite_mode: Some("skip".to_string()),
            file_name_template: Some("%name%".to_string()),
            output_suffix: None,
            allow_source_overwrite: false,
            preserve_metadata: Some(false),
            color_management_policy: None,
        };
        let token = CancellationToken::new();
        token.cancel();
        let progress = Channel::<BatchProgressEvent>::new(|_| Ok(()));
        let summary = convert_batch(vec![options], progress, token, Some(2)).unwrap();

        assert_eq!(summary.total, 1);
        assert_eq!(summary.completed, 0);
        assert_eq!(summary.skipped, 0);
        assert_eq!(summary.failed, 0);
        assert!(summary.cancelled);
        assert!(!out_dir.join("sample.jpg").exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn batch_skip_mode_counts_existing_output_as_skipped() {
        let dir = unique_test_dir("batch-skip-existing");
        let out_dir = dir.join("out");
        fs::create_dir_all(&out_dir).unwrap();
        let input = dir.join("sample.png");
        let output = out_dir.join("sample.jpg");
        fs::write(&input, one_by_one_png()).unwrap();
        fs::write(&output, b"old").unwrap();

        let options = ConvertOptions {
            input: input.to_string_lossy().to_string(),
            out_dir: Some(out_dir.to_string_lossy().to_string()),
            relative_dir: None,
            source_width: None,
            source_height: None,
            format: "jpeg".to_string(),
            quality: 80,
            quality_floor: 0,
            lossless: false,
            jpeg_progressive: default_jpeg_progressive(),
            png_oxipng_level: default_png_oxipng_level(),
            png_lossy_quantize: false,
            png_quant_colors: default_png_quant_colors(),
            webp_method: default_webp_method(),
            avif_speed: default_avif_speed(),
            avif_subsample: default_avif_subsample(),
            webp_near_lossless: default_webp_near_lossless(),
            webp_sharp_yuv: false,
            jpeg_trellis: default_jpeg_trellis(),
            auto_quality: false,
            auto_quality_score: default_auto_quality_score(),
            generation_loss_protection: false,
            result_cache: false,
            skip_if_larger: false,
            multi_candidate: false,
            overwrite: false,
            overwrite_mode: Some("skip".to_string()),
            file_name_template: Some("%name%".to_string()),
            output_suffix: None,
            allow_source_overwrite: false,
            preserve_metadata: Some(false),
            color_management_policy: None,
        };
        let progress = Channel::<BatchProgressEvent>::new(|_| Ok(()));
        let summary =
            convert_batch(vec![options], progress, CancellationToken::new(), Some(2)).unwrap();

        assert_eq!(summary.total, 1);
        assert_eq!(summary.completed, 0);
        assert_eq!(summary.skipped, 1);
        assert_eq!(summary.failed, 0);
        assert!(!summary.cancelled);
        assert_eq!(fs::read(output).unwrap(), b"old");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn batch_progress_send_failure_aborts_batch() {
        let progress = Channel::<BatchProgressEvent>::new(|_| {
            Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "closed").into())
        });
        let err = convert_batch(Vec::new(), progress, CancellationToken::new(), None).unwrap_err();

        assert!(err.contains("无法发送批量进度事件"));
    }
}
