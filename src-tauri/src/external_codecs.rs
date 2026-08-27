// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Optional external codec helpers.
//!
//! HEIC support is intentionally decode-only and process-isolated. The main
//! application does not link libheif or ship LGPL/GPL codec libraries.

use std::env;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use imgconvert_core::RawMetadata;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
use crate::macos_system_codecs;
#[cfg(target_os = "windows")]
use crate::windows_system_codecs;

const HEIC_HELPERS: &[&str] = &["heif-convert", "heif-dec", "imgconvert-heic-helper"];
const HEIC_EXTENSIONS: &[&str] = &["heic", "heif", "hif"];
const HEIC_DECODE_TIMEOUT: Duration = Duration::from_secs(120);
const HEIC_HELPER_STDERR_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
// The system/helper bridge hands this PNG back to the core as an in-memory
// source. Keep it at the same ceiling as other core sources; otherwise HEIC
// could bypass the generic bounded-read policy with a larger buffer.
pub(crate) const MAX_HEIC_DECODED_PNG_BYTES: usize = 256 * 1024 * 1024;
const MAX_HEIC_SOURCE_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_HEIC_HELPER_STDERR_BYTES: usize = 64 * 1024;
const MAX_HEIC_METADATA_SIDECAR_BYTES: usize = 64 * 1024;
const MAX_HEIC_METADATA_BLOB_BYTES: usize = 16 * 1024 * 1024;
const MAX_PLUGIN_MANIFEST_BYTES: usize = 64 * 1024;
const PLUGIN_DIRS_ENV: &str = "IMGCONVERT_CODEC_PLUGIN_DIRS";
const DISABLE_EXTERNAL_CODECS_ENV: &str = "IMGCONVERT_DISABLE_EXTERNAL_CODECS";
#[cfg(target_os = "linux")]
const ALLOW_FLATPAK_CODEC_EXTENSIONS_ENV: &str = "IMGCONVERT_ALLOW_FLATPAK_CODEC_EXTENSIONS";
#[cfg(target_os = "linux")]
const FLATPAK_CODEC_EXTENSION_DIR_ENV: &str = "IMGCONVERT_FLATPAK_CODEC_EXTENSION_DIR";
const FLATPAK_CODEC_EXTENSION_DIR_DEFAULT: &str = "/app/extensions/codecs";
const HEIC_MANIFEST_NAME: &str = "imgconvert-codec-heic.json";
const PLUGIN_PROTOCOL_VERSION: u32 = 1;
const PLUGIN_MODE_EXTERNAL_PROCESS: &str = "external-process";
const PLUGIN_DECODE_KIND_HEIC_TO_PNG: &str = "heic-to-png-file";
const ARG_INPUT: &str = "{input}";
const ARG_OUTPUT: &str = "{output}";
const ARG_METADATA: &str = "{metadata}";

/// Apply the core image pixel budget before a platform decoder materializes a
/// HEIC frame. Keeping this here gives ImageIO and WIC the exact same policy
/// and lets the boundary be tested on every supported host platform.
#[cfg(any(target_os = "macos", target_os = "windows", test))]
pub(crate) fn validate_system_heic_dimensions(width: u32, height: u32) -> Result<(), String> {
    imgconvert_core::validate_image_dimensions(width, height).map_err(|error| {
        format!(
            "HEIC 尺寸超过 ImgConvert 的 {} MP 解码上限（{width}×{height}）: {error}",
            imgconvert_core::MAX_PIXELS / 1_000_000
        )
    })
}

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);
static SELECTED_HEIC_HELPER: Mutex<Option<PathBuf>> = Mutex::new(None);

#[derive(Debug, Clone)]
struct Helper {
    command: String,
    path: PathBuf,
    args: Vec<String>,
    provider: HelperProvider,
}

#[derive(Debug, Clone)]
enum HelperProvider {
    SelectedPath,
    SystemPath,
    Manifest {
        id: String,
        license: String,
        readable: Vec<String>,
        writable: Vec<String>,
    },
}

#[derive(Debug, Clone)]
pub struct CodecProviderInfo {
    pub id: String,
    pub kind: &'static str,
    pub license: Option<String>,
    pub readable: Vec<String>,
    pub writable: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct DecodedExternalImage {
    pub image_bytes: Vec<u8>,
    pub metadata: Option<RawMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodecDiagnostics {
    pub heic: HeicCodecDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticMessage {
    pub code: String,
    pub detail: Option<String>,
}

impl DiagnosticMessage {
    pub(crate) fn new(code: &str) -> Self {
        Self {
            code: code.to_string(),
            detail: None,
        }
    }

    pub(crate) fn with_detail(code: &str, detail: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            detail: Some(detail.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeicCodecDiagnostics {
    pub enabled: bool,
    pub external_codecs_enabled: bool,
    pub disabled_reason: Option<DiagnosticMessage>,
    pub extensions: Vec<&'static str>,
    pub active_provider: Option<CodecProviderDiagnostic>,
    pub system_codecs: Vec<SystemCodecDiagnostic>,
    pub selected_helper: SelectedHelperDiagnostic,
    pub manifest_dirs: Vec<ManifestSearchDirDiagnostic>,
    pub system_helpers: Vec<SystemHelperDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodecProviderDiagnostic {
    pub id: String,
    pub kind: String,
    pub license: Option<String>,
    pub readable: Vec<String>,
    pub writable: Vec<String>,
    pub command: String,
    pub path: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCodecDiagnostic {
    pub id: String,
    pub kind: String,
    pub available: bool,
    pub readable: Vec<String>,
    pub message: DiagnosticMessage,
    pub install_hint: Option<DiagnosticMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSearchDirDiagnostic {
    pub source: String,
    pub path: String,
    pub status: String,
    pub message: Option<DiagnosticMessage>,
    pub manifests: Vec<ManifestDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDiagnostic {
    pub path: String,
    pub status: String,
    pub message: Option<DiagnosticMessage>,
    pub provider: Option<CodecProviderDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemHelperDiagnostic {
    pub command: String,
    pub available: bool,
    pub path: Option<String>,
    pub message: Option<DiagnosticMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedHelperDiagnostic {
    pub configured: bool,
    pub available: bool,
    pub path: Option<String>,
    pub message: Option<DiagnosticMessage>,
    pub provider: Option<CodecProviderDiagnostic>,
}

#[derive(Debug, Clone)]
struct PluginSearchDir {
    source: &'static str,
    path: PathBuf,
}

#[derive(Debug, Clone, Copy)]
enum ExternalCodecsDisabledReason {
    BuildConfiguration,
    Environment,
}

impl ExternalCodecsDisabledReason {
    fn diagnostic(self, flatpak_extensions_enabled: bool) -> DiagnosticMessage {
        match (self, flatpak_extensions_enabled) {
            (Self::BuildConfiguration, false) => {
                DiagnosticMessage::new("externalCodecsBuildDisabled")
            }
            (Self::BuildConfiguration, true) => {
                DiagnosticMessage::new("externalCodecsBuildDisabledFlatpakEnabled")
            }
            (Self::Environment, false) => DiagnosticMessage::with_detail(
                "externalCodecsEnvironmentDisabled",
                DISABLE_EXTERNAL_CODECS_ENV,
            ),
            (Self::Environment, true) => DiagnosticMessage::with_detail(
                "externalCodecsEnvironmentDisabledFlatpakEnabled",
                DISABLE_EXTERNAL_CODECS_ENV,
            ),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodecManifest {
    id: String,
    protocol: u32,
    license: String,
    readable: Vec<String>,
    #[serde(default)]
    writable: Vec<String>,
    mode: String,
    decode: ManifestDecode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestDecode {
    kind: String,
    command: String,
    #[serde(default = "default_decode_args")]
    args: Vec<String>,
    #[serde(default = "default_decode_output")]
    output: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetadataSidecar {
    version: u32,
    icc: Option<String>,
    exif: Option<String>,
    xmp: Option<String>,
    iptc: Option<String>,
}

struct WorkDir {
    path: PathBuf,
}

struct CappedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

struct CappedReader {
    receiver: mpsc::Receiver<std::io::Result<CappedOutput>>,
    handle: thread::JoinHandle<()>,
    max_bytes: usize,
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub fn heic_available() -> bool {
    system_heic_available() || find_heic_helper().is_some()
}

pub fn heic_provider_info() -> Option<CodecProviderInfo> {
    system_heic_provider_info().or_else(|| find_heic_helper().map(|helper| helper.provider_info()))
}

pub fn heic_extensions() -> &'static [&'static str] {
    HEIC_EXTENSIONS
}

pub fn codec_diagnostics() -> CodecDiagnostics {
    let active_system_provider = system_heic_provider_diagnostic();
    let active_helper = if active_system_provider.is_some() {
        None
    } else {
        find_heic_helper()
    };
    let flatpak_extensions_enabled = flatpak_codec_extensions_enabled();
    let raw_disabled_reason = external_codec_discovery_disabled_reason();
    let disabled_reason =
        raw_disabled_reason.map(|reason| reason.diagnostic(flatpak_extensions_enabled));
    CodecDiagnostics {
        heic: HeicCodecDiagnostics {
            enabled: active_system_provider.is_some() || active_helper.is_some(),
            external_codecs_enabled: external_codec_discovery_supported()
                && (raw_disabled_reason.is_none() || flatpak_extensions_enabled),
            disabled_reason,
            extensions: HEIC_EXTENSIONS.to_vec(),
            active_provider: active_system_provider
                .or_else(|| active_helper.as_ref().map(Helper::provider_diagnostic)),
            system_codecs: system_codec_diagnostics(),
            selected_helper: selected_helper_diagnostic(),
            manifest_dirs: manifest_dir_diagnostics(),
            system_helpers: system_helper_diagnostics(),
        },
    }
}

pub fn is_heic_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            let normalized = extension.to_ascii_lowercase();
            HEIC_EXTENSIONS.contains(&normalized.as_str())
        })
        .unwrap_or(false)
}

pub fn is_heic_magic(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || &bytes[4..8] != b"ftyp" {
        return false;
    }
    let end = bytes.len().min(64);
    bytes[8..end].windows(4).any(|brand| {
        matches!(
            brand,
            b"heic" | b"heix" | b"hevc" | b"hevx" | b"heif" | b"heis" | b"mif1" | b"msf1"
        )
    })
}

pub fn decode_heic(input: &Path) -> Result<DecodedExternalImage, String> {
    validate_heic_source_file(input)?;
    if system_heic_available() {
        return system_decode_heic_to_png(input).map(|image_bytes| DecodedExternalImage {
            image_bytes,
            metadata: None,
        });
    }
    let helper = find_heic_helper().ok_or_else(|| {
        "未检测到 HEIC 解码能力。macOS 使用系统 ImageIO; Linux 可安装 libheif-examples; Fedora 的 HEVC HEIC 可能还需要 RPM Fusion libheif-freeworld。".to_string()
    })?;
    decode_heic_to_png_with_helper(input, &helper)
}

fn validate_heic_source_file(input: &Path) -> Result<(), String> {
    let metadata = fs::metadata(input)
        .map_err(|error| format!("无法读取 HEIC 输入 {}: {error}", input.display()))?;
    if !metadata.is_file() {
        return Err(format!("HEIC 输入不是普通文件: {}", input.display()));
    }
    if metadata.len() > MAX_HEIC_SOURCE_FILE_BYTES {
        return Err(format!(
            "HEIC 输入文件超过 {} MiB 上限: {}",
            MAX_HEIC_SOURCE_FILE_BYTES / (1024 * 1024),
            input.display()
        ));
    }
    Ok(())
}

pub fn decode_heic_to_png(input: &Path) -> Result<Vec<u8>, String> {
    decode_heic(input).map(|decoded| decoded.image_bytes)
}

#[cfg(target_os = "macos")]
fn system_heic_available() -> bool {
    macos_system_codecs::heic_available()
}

#[cfg(target_os = "windows")]
fn system_heic_available() -> bool {
    windows_system_codecs::heic_available()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn system_heic_available() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn system_heic_provider_info() -> Option<CodecProviderInfo> {
    macos_system_codecs::heic_provider_info()
}

#[cfg(target_os = "windows")]
fn system_heic_provider_info() -> Option<CodecProviderInfo> {
    windows_system_codecs::heic_provider_info()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn system_heic_provider_info() -> Option<CodecProviderInfo> {
    None
}

#[cfg(target_os = "macos")]
fn system_heic_provider_diagnostic() -> Option<CodecProviderDiagnostic> {
    macos_system_codecs::heic_provider_diagnostic()
}

#[cfg(target_os = "windows")]
fn system_heic_provider_diagnostic() -> Option<CodecProviderDiagnostic> {
    windows_system_codecs::heic_provider_diagnostic()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn system_heic_provider_diagnostic() -> Option<CodecProviderDiagnostic> {
    None
}

#[cfg(target_os = "macos")]
fn system_decode_heic_to_png(input: &Path) -> Result<Vec<u8>, String> {
    macos_system_codecs::decode_heic_to_png(input)
}

#[cfg(target_os = "windows")]
fn system_decode_heic_to_png(input: &Path) -> Result<Vec<u8>, String> {
    windows_system_codecs::decode_heic_to_png(input)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn system_decode_heic_to_png(_input: &Path) -> Result<Vec<u8>, String> {
    Err("系统 HEIC 解码仅在 macOS ImageIO 或 Windows WIC 后端可用".to_string())
}

#[cfg(target_os = "windows")]
fn system_codec_diagnostics() -> Vec<SystemCodecDiagnostic> {
    let diagnostic = windows_system_codecs::heic_system_diagnostic();
    vec![SystemCodecDiagnostic {
        id: diagnostic.id,
        kind: diagnostic.kind,
        available: diagnostic.available,
        readable: diagnostic.readable,
        message: diagnostic.message,
        install_hint: diagnostic.install_hint,
    }]
}

#[cfg(not(target_os = "windows"))]
fn system_codec_diagnostics() -> Vec<SystemCodecDiagnostic> {
    Vec::new()
}

pub fn set_selected_heic_helper(path: Option<String>) -> Result<SelectedHelperDiagnostic, String> {
    let selected_path = match path {
        Some(path) if !path.trim().is_empty() => {
            let path = path.trim();
            let selected_path = selected_helper_from_path(Path::new(path))
                .map(|helper| helper.path)
                .unwrap_or_else(|_| PathBuf::from(path));
            Some(selected_path)
        }
        _ => None,
    };

    let mut state = SELECTED_HEIC_HELPER
        .lock()
        .map_err(|_| "HEIC helper 白名单状态锁已损坏".to_string())?;
    *state = selected_path;
    drop(state);

    Ok(selected_helper_diagnostic())
}

fn default_decode_args() -> Vec<String> {
    vec![ARG_INPUT.to_string(), ARG_OUTPUT.to_string()]
}

fn default_decode_output() -> String {
    "png".to_string()
}

impl Helper {
    fn selected(path: PathBuf) -> Self {
        let command = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("selected-heic-helper")
            .to_string();
        Self {
            command,
            path,
            args: default_decode_args(),
            provider: HelperProvider::SelectedPath,
        }
    }

    fn system(command: &'static str, path: PathBuf) -> Self {
        Self {
            command: command.to_string(),
            path,
            args: default_decode_args(),
            provider: HelperProvider::SystemPath,
        }
    }

    fn manifest(manifest: CodecManifest, helper_path: PathBuf, args: Vec<String>) -> Self {
        Self {
            command: manifest.id.clone(),
            path: helper_path,
            args,
            provider: HelperProvider::Manifest {
                id: manifest.id,
                license: manifest.license,
                readable: manifest.readable,
                writable: manifest.writable,
            },
        }
    }

    fn provider_info(&self) -> CodecProviderInfo {
        match &self.provider {
            HelperProvider::SelectedPath => CodecProviderInfo {
                id: "user-selected-heic-helper".to_string(),
                kind: "selected-helper",
                license: None,
                readable: HEIC_EXTENSIONS
                    .iter()
                    .map(|extension| (*extension).to_string())
                    .collect(),
                writable: Vec::new(),
            },
            HelperProvider::SystemPath => CodecProviderInfo {
                id: "system-libheif-helper".to_string(),
                kind: "system-helper",
                license: None,
                readable: HEIC_EXTENSIONS
                    .iter()
                    .map(|extension| (*extension).to_string())
                    .collect(),
                writable: Vec::new(),
            },
            HelperProvider::Manifest {
                id,
                license,
                readable,
                writable,
            } => CodecProviderInfo {
                id: id.clone(),
                kind: "manifest",
                license: Some(license.clone()),
                readable: readable.clone(),
                writable: writable.clone(),
            },
        }
    }

    fn provider_diagnostic(&self) -> CodecProviderDiagnostic {
        let info = self.provider_info();
        CodecProviderDiagnostic {
            id: info.id,
            kind: info.kind.to_string(),
            license: info.license,
            readable: info.readable,
            writable: info.writable,
            command: self.command.clone(),
            path: self.path.to_string_lossy().to_string(),
            args: self.args.clone(),
        }
    }

    fn wants_metadata(&self) -> bool {
        self.args.iter().any(|arg| arg == ARG_METADATA)
    }
}

fn decode_heic_to_png_with_helper(
    input: &Path,
    helper: &Helper,
) -> Result<DecodedExternalImage, String> {
    validate_heic_header(input)?;
    let workdir = WorkDir::new()?;
    let output = workdir.path.join("decoded.png");
    let metadata_output = helper
        .wants_metadata()
        .then(|| workdir.path.join("metadata.json"));

    let stderr = run_decode_helper(helper, input, &output, metadata_output.as_deref())?;
    let image_bytes = read_decoded_png(&workdir.path, &output).map_err(|error| {
        if stderr.trim().is_empty() {
            error
        } else {
            format!("{error}; helper 输出: {}", stderr.trim())
        }
    })?;
    let metadata = if let Some(path) = metadata_output.as_deref() {
        read_metadata_sidecar(&workdir.path, path)?
    } else {
        None
    };
    Ok(DecodedExternalImage {
        image_bytes,
        metadata,
    })
}

impl WorkDir {
    fn new() -> Result<Self, String> {
        let base = heic_workdir_base()?;
        let pid = std::process::id();
        for _ in 0..64 {
            let counter = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            let path = base.join(format!("imgconvert-heic-{pid}-{nanos}-{counter}"));
            match create_private_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!(
                        "无法创建 HEIC 临时目录 {}: {error}",
                        path.display()
                    ));
                }
            }
        }

        Err("无法创建唯一 HEIC 临时目录".to_string())
    }
}

#[cfg(windows)]
fn heic_workdir_base() -> Result<PathBuf, String> {
    let local_app_data = env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "LOCALAPPDATA 未设置,无法创建私有 HEIC 临时目录".to_string())?;
    let base = PathBuf::from(local_app_data)
        .join("ImgConvert")
        .join("Temp")
        .join("heic");
    if !base.is_absolute() {
        return Err(format!(
            "LOCALAPPDATA 不是绝对路径,无法创建私有 HEIC 临时目录: {}",
            base.display()
        ));
    }
    fs::create_dir_all(&base)
        .map_err(|error| format!("无法创建 HEIC 临时目录根 {}: {error}", base.display()))?;
    Ok(base)
}

#[cfg(not(windows))]
fn heic_workdir_base() -> Result<PathBuf, String> {
    Ok(env::temp_dir())
}

#[cfg(unix)]
fn create_private_dir(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new().mode(0o700).create(path)
}

#[cfg(not(unix))]
fn create_private_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir(path)
}

fn validate_heic_header(input: &Path) -> Result<(), String> {
    let mut file = File::open(input)
        .map_err(|error| format!("无法读取 HEIC 文件头 {}: {error}", input.display()))?;
    let mut header = [0u8; 64];
    let len = file
        .read(&mut header)
        .map_err(|error| format!("无法读取 HEIC 文件头 {}: {error}", input.display()))?;
    if is_heic_magic(&header[..len]) {
        Ok(())
    } else {
        Err(format!(
            "输入文件扩展名为 HEIC/HEIF,但文件头不是受支持的 HEIF/HEIC: {}",
            input.display()
        ))
    }
}

fn find_heic_helper() -> Option<Helper> {
    if !external_codec_discovery_supported() {
        return None;
    }
    if external_codec_discovery_disabled_reason().is_some() {
        return find_manifest_heic_helper_in_entries(flatpak_codec_extension_search_entries());
    }
    find_selected_heic_helper()
        .or_else(find_manifest_heic_helper)
        .or_else(|| find_heic_helper_in_path(&env::var_os("PATH")?))
}

fn selected_heic_helper_path() -> Option<PathBuf> {
    SELECTED_HEIC_HELPER.lock().ok()?.clone()
}

fn find_selected_heic_helper() -> Option<Helper> {
    selected_heic_helper_path()
        .as_deref()
        .and_then(|path| selected_helper_from_path(path).ok())
}

fn selected_helper_from_path(path: &Path) -> Result<Helper, String> {
    let (path, metadata) = canonical_trusted_file(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::PermissionDenied {
            "HEIC_SELECTED_HELPER_UNTRUSTED"
        } else {
            "HEIC_SELECTED_HELPER_NOT_FOUND"
        };
        format!("{code}: {}: {error}", path.display())
    })?;
    if !is_supported_helper_binary(&path) {
        return Err(format!(
            "HEIC_SELECTED_HELPER_NOT_EXECUTABLE: {}",
            path.display()
        ));
    }
    if !has_execute_bit(&metadata) {
        return Err(format!(
            "HEIC_SELECTED_HELPER_NOT_EXECUTABLE: {}",
            path.display()
        ));
    }
    Ok(Helper::selected(path))
}

fn selected_helper_diagnostic() -> SelectedHelperDiagnostic {
    let Some(path) = selected_heic_helper_path() else {
        return SelectedHelperDiagnostic {
            configured: false,
            available: false,
            path: None,
            message: Some(DiagnosticMessage::new("selectedHelperNotConfigured")),
            provider: None,
        };
    };
    let path_text = path.to_string_lossy().to_string();

    if let Some(reason) = external_codec_discovery_disabled_reason() {
        return SelectedHelperDiagnostic {
            configured: true,
            available: false,
            path: Some(path_text),
            message: Some(reason.diagnostic(false)),
            provider: None,
        };
    }
    if !external_codec_discovery_supported() {
        return SelectedHelperDiagnostic {
            configured: true,
            available: false,
            path: Some(path_text),
            message: Some(DiagnosticMessage::new("externalCodecTrustUnsupported")),
            provider: None,
        };
    }

    match selected_helper_from_path(&path) {
        Ok(helper) => SelectedHelperDiagnostic {
            configured: true,
            available: true,
            path: Some(helper.path.to_string_lossy().to_string()),
            message: None,
            provider: Some(helper.provider_diagnostic()),
        },
        Err(error) => SelectedHelperDiagnostic {
            configured: true,
            available: false,
            path: Some(path_text),
            message: Some(DiagnosticMessage::with_detail(
                "selectedHelperUnavailable",
                error,
            )),
            provider: None,
        },
    }
}

fn find_manifest_heic_helper() -> Option<Helper> {
    find_manifest_heic_helper_in_dirs(plugin_search_dirs())
}

fn find_manifest_heic_helper_in_dirs(dirs: Vec<PathBuf>) -> Option<Helper> {
    find_manifest_heic_helper_in_entries(
        dirs.into_iter()
            .map(|path| PluginSearchDir {
                source: "explicit",
                path,
            })
            .collect(),
    )
}

fn find_manifest_heic_helper_in_entries(entries: Vec<PluginSearchDir>) -> Option<Helper> {
    for entry in entries {
        let dir = entry.path;
        if !is_trusted_path_dir(&dir) {
            continue;
        }
        let manifest = dir.join(HEIC_MANIFEST_NAME);
        if let Ok(helper) = load_manifest_helper(&manifest) {
            return Some(helper);
        }

        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        let mut manifests = entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with("imgconvert-codec-") && name.ends_with(".json")
                    })
            })
            .collect::<Vec<_>>();
        manifests.sort();

        for manifest in manifests {
            if manifest.file_name() == Some(OsStr::new(HEIC_MANIFEST_NAME)) {
                continue;
            }
            if let Ok(helper) = load_manifest_helper(&manifest) {
                return Some(helper);
            }
        }
    }
    None
}

fn plugin_search_dirs() -> Vec<PathBuf> {
    plugin_search_entries()
        .into_iter()
        .map(|entry| entry.path)
        .collect()
}

fn plugin_search_entries() -> Vec<PluginSearchDir> {
    let mut dirs = Vec::new();
    let flatpak_extension_dirs = flatpak_codec_extension_search_entries();
    if external_codec_discovery_disabled_reason().is_some() {
        return flatpak_extension_dirs;
    }

    if let Some(raw_dirs) = env::var_os(PLUGIN_DIRS_ENV) {
        dirs.extend(env::split_paths(&raw_dirs).map(|path| PluginSearchDir {
            source: PLUGIN_DIRS_ENV,
            path,
        }));
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(xdg_data_home) = env::var_os("XDG_DATA_HOME") {
            dirs.push(PluginSearchDir {
                source: "XDG_DATA_HOME",
                path: PathBuf::from(xdg_data_home)
                    .join("imgconvert")
                    .join("codecs"),
            });
        } else if let Some(home) = env::var_os("HOME") {
            dirs.push(PluginSearchDir {
                source: "HOME",
                path: PathBuf::from(home)
                    .join(".local")
                    .join("share")
                    .join("imgconvert")
                    .join("codecs"),
            });
        }

        let xdg_data_dirs = env::var_os("XDG_DATA_DIRS")
            .unwrap_or_else(|| OsStr::new("/usr/local/share:/usr/share").to_os_string());
        for dir in env::split_paths(&xdg_data_dirs) {
            dirs.push(PluginSearchDir {
                source: "XDG_DATA_DIRS",
                path: dir.join("imgconvert").join("codecs"),
            });
        }
    }

    #[cfg(windows)]
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        dirs.push(PluginSearchDir {
            source: "LOCALAPPDATA",
            path: PathBuf::from(local_app_data)
                .join("ImgConvert")
                .join("codecs"),
        });
    }

    #[cfg(windows)]
    if let Some(program_data) = env::var_os("PROGRAMDATA") {
        dirs.push(PluginSearchDir {
            source: "PROGRAMDATA",
            path: PathBuf::from(program_data)
                .join("ImgConvert")
                .join("codecs"),
        });
    }

    dirs.extend(flatpak_extension_dirs);
    dirs
}

fn manifest_dir_diagnostics() -> Vec<ManifestSearchDirDiagnostic> {
    if let Some(reason) = external_codec_discovery_disabled_reason() {
        if flatpak_codec_extensions_enabled() {
            let entries = plugin_search_entries();
            if !entries.is_empty() {
                return entries
                    .into_iter()
                    .map(|entry| manifest_dir_diagnostic(&entry))
                    .collect();
            }
        }
        return vec![ManifestSearchDirDiagnostic {
            source: DISABLE_EXTERNAL_CODECS_ENV.to_string(),
            path: String::new(),
            status: "disabled".to_string(),
            message: Some(reason.diagnostic(false)),
            manifests: Vec::new(),
        }];
    }

    if !external_codec_discovery_supported() {
        return vec![ManifestSearchDirDiagnostic {
            source: "platform".to_string(),
            path: String::new(),
            status: "unsupported".to_string(),
            message: Some(DiagnosticMessage::new("externalCodecTrustUnsupported")),
            manifests: Vec::new(),
        }];
    }

    plugin_search_entries()
        .into_iter()
        .map(|entry| manifest_dir_diagnostic(&entry))
        .collect()
}

fn manifest_dir_diagnostic(entry: &PluginSearchDir) -> ManifestSearchDirDiagnostic {
    let path = entry.path.to_string_lossy().to_string();
    let Ok(metadata) = fs::metadata(&entry.path) else {
        return ManifestSearchDirDiagnostic {
            source: entry.source.to_string(),
            path,
            status: "missing".to_string(),
            message: Some(DiagnosticMessage::new("directoryMissing")),
            manifests: Vec::new(),
        };
    };
    if !metadata.is_dir() {
        return ManifestSearchDirDiagnostic {
            source: entry.source.to_string(),
            path,
            status: "notDirectory".to_string(),
            message: Some(DiagnosticMessage::new("pathNotDirectory")),
            manifests: Vec::new(),
        };
    }
    if !is_trusted_path_dir(&entry.path) {
        return ManifestSearchDirDiagnostic {
            source: entry.source.to_string(),
            path,
            status: "untrusted".to_string(),
            message: Some(DiagnosticMessage::new("directoryUntrusted")),
            manifests: Vec::new(),
        };
    }

    let mut manifests = Vec::new();
    let heic_manifest = entry.path.join(HEIC_MANIFEST_NAME);
    if heic_manifest.is_file() {
        manifests.push(manifest_diagnostic(&heic_manifest));
    }

    match fs::read_dir(&entry.path) {
        Ok(entries) => {
            let mut other_manifests = entries
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .filter(|manifest| {
                    manifest.file_name() != Some(OsStr::new(HEIC_MANIFEST_NAME))
                        && manifest
                            .file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(|name| {
                                name.starts_with("imgconvert-codec-") && name.ends_with(".json")
                            })
                })
                .collect::<Vec<_>>();
            other_manifests.sort();
            manifests.extend(
                other_manifests
                    .iter()
                    .map(|manifest| manifest_diagnostic(manifest)),
            );

            let status = if manifests
                .iter()
                .any(|manifest| manifest.status == "accepted")
            {
                "ready"
            } else if manifests.is_empty() {
                "empty"
            } else {
                "rejected"
            };
            let message = if manifests.is_empty() {
                Some(DiagnosticMessage::new("manifestNotFound"))
            } else {
                None
            };

            ManifestSearchDirDiagnostic {
                source: entry.source.to_string(),
                path,
                status: status.to_string(),
                message,
                manifests,
            }
        }
        Err(error) => ManifestSearchDirDiagnostic {
            source: entry.source.to_string(),
            path,
            status: "unreadable".to_string(),
            message: Some(DiagnosticMessage::with_detail(
                "directoryUnreadable",
                error.to_string(),
            )),
            manifests,
        },
    }
}

fn manifest_diagnostic(path: &Path) -> ManifestDiagnostic {
    match load_manifest_helper(path) {
        Ok(helper) => ManifestDiagnostic {
            path: path.to_string_lossy().to_string(),
            status: "accepted".to_string(),
            message: None,
            provider: Some(helper.provider_diagnostic()),
        },
        Err(error) => ManifestDiagnostic {
            path: path.to_string_lossy().to_string(),
            status: "rejected".to_string(),
            message: Some(DiagnosticMessage::with_detail("manifestRejected", error)),
            provider: None,
        },
    }
}

fn system_helper_diagnostics() -> Vec<SystemHelperDiagnostic> {
    if let Some(reason) = external_codec_discovery_disabled_reason() {
        return HEIC_HELPERS
            .iter()
            .map(|command| SystemHelperDiagnostic {
                command: (*command).to_string(),
                available: false,
                path: None,
                message: Some(reason.diagnostic(false)),
            })
            .collect();
    }

    if !external_codec_discovery_supported() {
        return HEIC_HELPERS
            .iter()
            .map(|command| SystemHelperDiagnostic {
                command: (*command).to_string(),
                available: false,
                path: None,
                message: Some(DiagnosticMessage::new("externalCodecTrustUnsupported")),
            })
            .collect();
    }

    let Some(paths) = env::var_os("PATH") else {
        return HEIC_HELPERS
            .iter()
            .map(|command| SystemHelperDiagnostic {
                command: (*command).to_string(),
                available: false,
                path: None,
                message: Some(DiagnosticMessage::new("pathEnvironmentMissing")),
            })
            .collect();
    };

    HEIC_HELPERS
        .iter()
        .map(|command| match find_executable_in_path(command, &paths) {
            Some(path) => SystemHelperDiagnostic {
                command: (*command).to_string(),
                available: true,
                path: Some(path.to_string_lossy().to_string()),
                message: None,
            },
            None => SystemHelperDiagnostic {
                command: (*command).to_string(),
                available: false,
                path: None,
                message: Some(DiagnosticMessage::new("helperNotFoundInTrustedPath")),
            },
        })
        .collect()
}

fn load_manifest_helper(manifest_path: &Path) -> Result<Helper, String> {
    let (manifest_path, manifest_metadata) = match canonical_trusted_file(manifest_path) {
        Ok(file) => file,
        Err(error) if matches!(error.kind(), std::io::ErrorKind::NotFound) => {
            return Err(format!(
                "HEIC_PLUGIN_MANIFEST_NOT_FOUND: {}",
                manifest_path.display()
            ));
        }
        Err(error) => {
            return Err(format!(
                "HEIC_PLUGIN_MANIFEST_UNTRUSTED: {}: {error}",
                manifest_path.display()
            ));
        }
    };
    let manifest_dir = manifest_path.parent().ok_or_else(|| {
        format!(
            "HEIC_PLUGIN_MANIFEST_PATH_INVALID: {}",
            manifest_path.display()
        )
    })?;

    let bytes = read_manifest_bytes(&manifest_path, &manifest_metadata)?;
    let manifest: CodecManifest = serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "HEIC_PLUGIN_MANIFEST_PARSE_FAILED: {}: {error}",
            manifest_path.display()
        )
    })?;

    validate_manifest(&manifest)?;
    let helper_path = resolve_manifest_helper_path(manifest_dir, &manifest.decode.command)?;
    let args = validate_manifest_args(&manifest.decode.args)?;
    Ok(Helper::manifest(manifest, helper_path, args))
}

fn read_manifest_bytes(manifest_path: &Path, metadata: &fs::Metadata) -> Result<Vec<u8>, String> {
    if metadata.len() > MAX_PLUGIN_MANIFEST_BYTES as u64 {
        return Err(format!(
            "HEIC_PLUGIN_MANIFEST_TOO_LARGE: {} exceeds {} bytes",
            manifest_path.display(),
            MAX_PLUGIN_MANIFEST_BYTES
        ));
    }

    let file = File::open(manifest_path).map_err(|error| {
        format!(
            "HEIC_PLUGIN_MANIFEST_READ_FAILED: {}: {error}",
            manifest_path.display()
        )
    })?;
    let mut reader = file.take(MAX_PLUGIN_MANIFEST_BYTES as u64 + 1);
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    reader.read_to_end(&mut bytes).map_err(|error| {
        format!(
            "HEIC_PLUGIN_MANIFEST_READ_FAILED: {}: {error}",
            manifest_path.display()
        )
    })?;
    if bytes.len() > MAX_PLUGIN_MANIFEST_BYTES {
        return Err(format!(
            "HEIC_PLUGIN_MANIFEST_TOO_LARGE: {} exceeds {} bytes",
            manifest_path.display(),
            MAX_PLUGIN_MANIFEST_BYTES
        ));
    }
    Ok(bytes)
}

fn validate_manifest(manifest: &CodecManifest) -> Result<(), String> {
    validate_manifest_id(&manifest.id)?;
    if manifest.protocol != PLUGIN_PROTOCOL_VERSION {
        return Err(format!(
            "HEIC_PLUGIN_PROTOCOL_UNSUPPORTED: {} declares protocol {}",
            manifest.id, manifest.protocol
        ));
    }
    if !is_allowed_plugin_license(&manifest.license) {
        return Err(format!(
            "HEIC_PLUGIN_LICENSE_UNSUPPORTED: {} declares {}",
            manifest.id, manifest.license
        ));
    }
    if manifest.mode != PLUGIN_MODE_EXTERNAL_PROCESS {
        return Err(format!(
            "HEIC_PLUGIN_MODE_UNSUPPORTED: {} declares {}",
            manifest.id, manifest.mode
        ));
    }
    if manifest.decode.kind != PLUGIN_DECODE_KIND_HEIC_TO_PNG {
        return Err(format!(
            "HEIC_PLUGIN_DECODE_KIND_UNSUPPORTED: {} declares {}",
            manifest.id, manifest.decode.kind
        ));
    }
    if !manifest.decode.output.eq_ignore_ascii_case("png") {
        return Err(format!(
            "HEIC_PLUGIN_OUTPUT_UNSUPPORTED: {} declares {}",
            manifest.id, manifest.decode.output
        ));
    }
    validate_readable_formats(&manifest.id, &manifest.readable)?;
    if !manifest.writable.is_empty() {
        return Err(format!(
            "HEIC_PLUGIN_WRITABLE_UNSUPPORTED: {} declares writable formats",
            manifest.id
        ));
    }
    Ok(())
}

fn validate_manifest_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    if valid {
        Ok(())
    } else {
        Err(format!("HEIC_PLUGIN_ID_INVALID: {id}"))
    }
}

fn is_allowed_plugin_license(license: &str) -> bool {
    matches!(
        license,
        "LGPL-2.1-only"
            | "LGPL-2.1-or-later"
            | "LGPL-3.0-only"
            | "LGPL-3.0-or-later"
            | "Apache-2.0"
            | "MIT"
            | "BSD-2-Clause"
            | "BSD-3-Clause"
            | "MPL-2.0"
    )
}

fn validate_readable_formats(id: &str, readable: &[String]) -> Result<(), String> {
    if readable.is_empty() {
        return Err(format!("HEIC_PLUGIN_READABLE_EMPTY: {id}"));
    }
    let mut has_heic = false;
    for format in readable {
        let normalized = format.to_ascii_lowercase();
        if !HEIC_EXTENSIONS.contains(&normalized.as_str()) {
            return Err(format!(
                "HEIC_PLUGIN_READABLE_UNSUPPORTED: {id} declares {format}"
            ));
        }
        if normalized == "heic" {
            has_heic = true;
        }
    }
    if has_heic {
        Ok(())
    } else {
        Err(format!("HEIC_PLUGIN_READABLE_MISSING_HEIC: {id}"))
    }
}

fn resolve_manifest_helper_path(manifest_dir: &Path, command: &str) -> Result<PathBuf, String> {
    if command.is_empty() || command.as_bytes().contains(&0) {
        return Err("HEIC_PLUGIN_HELPER_PATH_INVALID: empty helper command".to_string());
    }

    let command_path = Path::new(command);
    let helper_path = if command_path.is_absolute() {
        command_path.to_path_buf()
    } else {
        validate_relative_helper_path(command_path)?;
        manifest_dir.join(command_path)
    };
    let requested_helper_path = helper_path;
    let (helper_path, helper_metadata) = match canonical_regular_file(&requested_helper_path) {
        Ok(file) => file,
        Err(error) if matches!(error.kind(), std::io::ErrorKind::InvalidInput) => {
            return Err(format!(
                "HEIC_PLUGIN_HELPER_NOT_EXECUTABLE: {}",
                requested_helper_path.display()
            ));
        }
        Err(error) => {
            return Err(format!(
                "HEIC_PLUGIN_HELPER_NOT_FOUND: {}: {error}",
                requested_helper_path.display()
            ));
        }
    };
    if !has_execute_bit(&helper_metadata) {
        return Err(format!(
            "HEIC_PLUGIN_HELPER_NOT_EXECUTABLE: {}",
            helper_path.display()
        ));
    }
    if has_unsafe_write_bit(&helper_metadata) {
        return Err(format!(
            "HEIC_PLUGIN_HELPER_UNTRUSTED: {}",
            helper_path.display()
        ));
    }
    if !is_supported_helper_binary(&helper_path) {
        return Err(format!(
            "HEIC_PLUGIN_HELPER_NOT_EXECUTABLE: {}",
            helper_path.display()
        ));
    }

    if command_path.is_absolute() {
        let parent = helper_path
            .parent()
            .ok_or_else(|| format!("HEIC_PLUGIN_HELPER_PATH_INVALID: {}", helper_path.display()))?;
        if !is_trusted_path_dir(parent) {
            return Err(format!(
                "HEIC_PLUGIN_HELPER_UNTRUSTED: {}",
                helper_path.display()
            ));
        }
    } else {
        let manifest_dir = fs::canonicalize(manifest_dir).map_err(|error| {
            format!(
                "HEIC_PLUGIN_MANIFEST_DIR_INVALID: {}: {error}",
                manifest_dir.display()
            )
        })?;
        if !helper_path.starts_with(&manifest_dir) {
            return Err(format!(
                "HEIC_PLUGIN_HELPER_ESCAPES_MANIFEST_DIR: {}",
                helper_path.display()
            ));
        }
        let parent = helper_path
            .parent()
            .ok_or_else(|| format!("HEIC_PLUGIN_HELPER_PATH_INVALID: {}", helper_path.display()))?;
        if !is_trusted_path_dir(parent) {
            return Err(format!(
                "HEIC_PLUGIN_HELPER_UNTRUSTED: {}",
                helper_path.display()
            ));
        }
    }

    Ok(helper_path)
}

fn validate_relative_helper_path(path: &Path) -> Result<(), String> {
    if path
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
        Ok(())
    } else {
        Err(format!(
            "HEIC_PLUGIN_HELPER_PATH_INVALID: {}",
            path.display()
        ))
    }
}

fn validate_manifest_args(args: &[String]) -> Result<Vec<String>, String> {
    if args.is_empty() || args.len() > 16 {
        return Err("HEIC_PLUGIN_ARGS_INVALID: expected 1-16 argv entries".to_string());
    }

    let mut has_input = false;
    let mut has_output = false;
    for arg in args {
        if arg.as_bytes().contains(&0) || arg.len() > 512 {
            return Err("HEIC_PLUGIN_ARGS_INVALID: invalid argv entry".to_string());
        }
        if arg == ARG_INPUT {
            has_input = true;
        } else if arg == ARG_OUTPUT {
            has_output = true;
        } else if arg == ARG_METADATA {
            // Optional metadata sidecar path. Presence is advertised by args alone.
        } else if arg.contains(ARG_INPUT) || arg.contains(ARG_OUTPUT) || arg.contains(ARG_METADATA)
        {
            return Err(
                "HEIC_PLUGIN_ARGS_INVALID: placeholders must be standalone argv entries"
                    .to_string(),
            );
        }
    }

    if has_input && has_output {
        Ok(args.to_vec())
    } else {
        Err("HEIC_PLUGIN_ARGS_INVALID: missing {input} or {output}".to_string())
    }
}

fn find_heic_helper_in_path(paths: &OsStr) -> Option<Helper> {
    for command in HEIC_HELPERS {
        if let Some(path) = find_executable_in_path(command, paths) {
            return Some(Helper::system(command, path));
        }
    }
    None
}

fn find_executable_in_path(command: &'static str, paths: &OsStr) -> Option<PathBuf> {
    for dir in env::split_paths(paths) {
        if !is_trusted_path_dir(&dir) {
            continue;
        }
        let candidate = dir.join(command);
        if let Some(candidate) = trusted_executable_file(&candidate) {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let candidate = dir.join(format!("{command}.exe"));
            if let Some(candidate) = trusted_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(any(target_os = "linux", windows))]
fn external_codec_discovery_supported() -> bool {
    true
}

#[cfg(not(any(target_os = "linux", windows)))]
fn external_codec_discovery_supported() -> bool {
    false
}

fn external_codec_discovery_disabled_reason() -> Option<ExternalCodecsDisabledReason> {
    if disable_external_codecs_value(option_env!("IMGCONVERT_DISABLE_EXTERNAL_CODECS")) {
        return Some(ExternalCodecsDisabledReason::BuildConfiguration);
    }

    match env::var(DISABLE_EXTERNAL_CODECS_ENV) {
        Ok(value) if disable_external_codecs_value(Some(value.as_str())) => {
            Some(ExternalCodecsDisabledReason::Environment)
        }
        _ => None,
    }
}

fn disable_external_codecs_value(value: Option<&str>) -> bool {
    truthy_env_value(value)
}

fn flatpak_codec_extensions_enabled() -> bool {
    #[cfg(target_os = "linux")]
    {
        truthy_env_value(env::var(ALLOW_FLATPAK_CODEC_EXTENSIONS_ENV).ok().as_deref())
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

fn truthy_env_value(value: Option<&str>) -> bool {
    value
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn flatpak_codec_extension_search_entries() -> Vec<PluginSearchDir> {
    if !flatpak_codec_extensions_enabled() {
        return Vec::new();
    }
    flatpak_codec_extension_search_entries_for(flatpak_codec_extension_root())
}

#[cfg(target_os = "linux")]
fn flatpak_codec_extension_root() -> PathBuf {
    env::var_os(FLATPAK_CODEC_EXTENSION_DIR_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(FLATPAK_CODEC_EXTENSION_DIR_DEFAULT))
}

#[cfg(not(target_os = "linux"))]
fn flatpak_codec_extension_root() -> PathBuf {
    PathBuf::from(FLATPAK_CODEC_EXTENSION_DIR_DEFAULT)
}

fn flatpak_codec_extension_search_entries_for(root: PathBuf) -> Vec<PluginSearchDir> {
    let mut entries = vec![PluginSearchDir {
        source: "flatpak-extension",
        path: root.clone(),
    }];

    let Ok(children) = fs::read_dir(&root) else {
        return entries;
    };
    let mut child_dirs = children
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    child_dirs.sort();
    entries.extend(child_dirs.into_iter().map(|path| PluginSearchDir {
        source: "flatpak-extension",
        path,
    }));
    entries
}

#[cfg(target_os = "linux")]
fn is_trusted_path_dir(dir: &Path) -> bool {
    if !dir.is_absolute() {
        return false;
    }
    let Ok(canonical_dir) = fs::canonicalize(dir) else {
        return false;
    };
    if !canonical_dir.is_absolute() {
        return false;
    }
    let Ok(metadata) = fs::metadata(&canonical_dir) else {
        return false;
    };
    if !metadata.is_dir() {
        return false;
    }
    !has_unsafe_write_bit(&metadata) && !has_unsafe_writable_ancestor(&canonical_dir)
}

#[cfg(windows)]
fn is_trusted_path_dir(dir: &Path) -> bool {
    if !dir.is_absolute() {
        return false;
    }
    let Ok(canonical_dir) = fs::canonicalize(dir) else {
        return false;
    };
    if !canonical_dir.is_absolute() {
        return false;
    }
    let Ok(metadata) = fs::metadata(&canonical_dir) else {
        return false;
    };
    if !metadata.is_dir() {
        return false;
    }

    windows_trusted_install_roots()
        .iter()
        .any(|root| path_starts_with_case_insensitive(&canonical_dir, root))
}

#[cfg(not(any(target_os = "linux", windows)))]
fn is_trusted_path_dir(_dir: &Path) -> bool {
    false
}

#[cfg(windows)]
fn windows_trusted_install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(path) = env::var_os(key) {
            roots.push(PathBuf::from(path));
        }
    }
    if let Some(program_data) = env::var_os("PROGRAMDATA") {
        roots.push(
            PathBuf::from(program_data)
                .join("ImgConvert")
                .join("codecs"),
        );
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        roots.push(
            PathBuf::from(local_app_data)
                .join("ImgConvert")
                .join("codecs"),
        );
    }
    roots
        .into_iter()
        .filter_map(|root| fs::canonicalize(root).ok())
        .collect()
}

#[cfg(windows)]
fn path_starts_with_case_insensitive(path: &Path, root: &Path) -> bool {
    let path = normalize_windows_path(path);
    let root = normalize_windows_path(root);
    path == root || path.starts_with(&(root + "\\"))
}

#[cfg(windows)]
fn normalize_windows_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

#[cfg(unix)]
fn has_unsafe_write_bit(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o022 != 0
}

#[cfg(not(unix))]
fn has_unsafe_write_bit(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(target_os = "linux")]
fn has_unsafe_writable_ancestor(dir: &Path) -> bool {
    dir.ancestors().any(|ancestor| {
        fs::metadata(ancestor)
            .map(|metadata| has_unsafe_write_bit(&metadata))
            .unwrap_or(false)
    })
}

fn canonical_regular_file(path: &Path) -> std::io::Result<(PathBuf, fs::Metadata)> {
    let canonical_path = fs::canonicalize(path)?;
    let metadata = fs::symlink_metadata(&canonical_path)?;
    if metadata.is_file() {
        Ok((canonical_path, metadata))
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path is not a regular file",
        ))
    }
}

fn canonical_trusted_file(path: &Path) -> std::io::Result<(PathBuf, fs::Metadata)> {
    let (canonical_path, metadata) = canonical_regular_file(path)?;
    let parent = canonical_path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    if !is_trusted_path_dir(parent) || has_unsafe_write_bit(&metadata) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "file or parent directory is not trusted",
        ));
    }
    Ok((canonical_path, metadata))
}

fn trusted_executable_file(path: &Path) -> Option<PathBuf> {
    let (path, metadata) = canonical_trusted_file(path).ok()?;
    if is_supported_helper_binary(&path) && has_execute_bit(&metadata) {
        Some(path)
    } else {
        None
    }
}

fn is_supported_helper_binary(path: &Path) -> bool {
    #[cfg(windows)]
    {
        path.extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        true
    }
}

#[cfg(unix)]
fn has_execute_bit(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn has_execute_bit(_metadata: &fs::Metadata) -> bool {
    true
}

fn run_decode_helper(
    helper: &Helper,
    input: &Path,
    output: &Path,
    metadata_output: Option<&Path>,
) -> Result<String, String> {
    let mut command = Command::new(&helper.path);
    for arg in &helper.args {
        match arg.as_str() {
            ARG_INPUT => {
                command.arg(input);
            }
            ARG_OUTPUT => {
                command.arg(output);
            }
            ARG_METADATA => {
                let metadata_output = metadata_output
                    .ok_or_else(|| "HEIC helper metadata sidecar path 未配置".to_string())?;
                command.arg(metadata_output);
            }
            literal => {
                command.arg(literal);
            }
        }
    }

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut attempts = 0;
    let mut child = loop {
        match command.spawn() {
            Ok(child) => break child,
            Err(error) if error.raw_os_error() == Some(26) && attempts < 3 => {
                attempts += 1;
                thread::sleep(Duration::from_millis(20));
            }
            Err(error) => {
                return Err(format!(
                    "无法启动 HEIC helper {} ({}): {error}",
                    helper.command,
                    helper.path.display()
                ));
            }
        }
    };

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 HEIC helper stderr 管道".to_string())?;
    let stderr_reader = spawn_capped_reader(stderr, MAX_HEIC_HELPER_STDERR_BYTES);

    let started = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("等待 HEIC helper 失败: {error}"))?
        {
            break status;
        }
        if started.elapsed() >= HEIC_DECODE_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            let stderr = join_capped_reader(stderr_reader);
            return Err(format!(
                "HEIC helper {} 解码超时({}s){}",
                helper.command,
                HEIC_DECODE_TIMEOUT.as_secs(),
                stderr_suffix(&stderr)
            ));
        }
        thread::sleep(Duration::from_millis(50));
    };

    let stderr = join_capped_reader(stderr_reader);
    if status.success() {
        Ok(stderr)
    } else {
        Err(format!(
            "HEIC helper {} 解码失败(code {:?}){}",
            helper.command,
            status.code(),
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", stderr.trim())
            }
        ))
    }
}

fn read_decoded_png(workdir: &Path, output: &Path) -> Result<Vec<u8>, String> {
    if output.exists() {
        return read_limited_file(output, MAX_HEIC_DECODED_PNG_BYTES);
    }

    let mut candidates = fs::read_dir(workdir)
        .map_err(|error| format!("无法读取 HEIC 临时目录 {}: {error}", workdir.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
        })
        .collect::<Vec<_>>();
    candidates.sort();

    let Some(first) = candidates.first() else {
        return Err(format!("HEIC helper 未生成 PNG 输出: {}", output.display()));
    };
    read_limited_file(first, MAX_HEIC_DECODED_PNG_BYTES)
}

fn read_metadata_sidecar(workdir: &Path, sidecar: &Path) -> Result<Option<RawMetadata>, String> {
    if !sidecar.exists() {
        return Ok(None);
    }
    let bytes = read_limited_file(sidecar, MAX_HEIC_METADATA_SIDECAR_BYTES)?;
    let sidecar: MetadataSidecar = serde_json::from_slice(&bytes)
        .map_err(|error| format!("HEIC metadata sidecar JSON 解析失败: {error}"))?;
    if sidecar.version != 1 {
        return Err(format!(
            "HEIC metadata sidecar protocol 不支持: {}",
            sidecar.version
        ));
    }
    let metadata = RawMetadata {
        icc: read_sidecar_blob(workdir, sidecar.icc.as_deref())?,
        exif: read_sidecar_blob(workdir, sidecar.exif.as_deref())?,
        xmp: read_sidecar_blob(workdir, sidecar.xmp.as_deref())?,
        iptc: read_sidecar_blob(workdir, sidecar.iptc.as_deref())?,
    }
    .normalized_orientation();
    if metadata.is_empty() {
        Ok(None)
    } else {
        Ok(Some(metadata))
    }
}

fn read_sidecar_blob(workdir: &Path, name: Option<&str>) -> Result<Option<Vec<u8>>, String> {
    let Some(name) = name.filter(|name| !name.trim().is_empty()) else {
        return Ok(None);
    };
    let path = sidecar_blob_path(workdir, name)?;
    let bytes = read_limited_file(&path, MAX_HEIC_METADATA_BLOB_BYTES)?;
    if bytes.is_empty() {
        Ok(None)
    } else {
        Ok(Some(bytes))
    }
}

fn sidecar_blob_path(workdir: &Path, name: &str) -> Result<PathBuf, String> {
    let path = Path::new(name);
    let mut components = path.components();
    if matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none() {
        return Ok(workdir.join(path));
    }
    Err(format!("HEIC metadata sidecar 路径非法: {name}"))
}

fn read_limited_file(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("无法读取 HEIC helper 输出 {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("HEIC helper 输出不是普通文件: {}", path.display()));
    }
    if metadata.len() > max_bytes as u64 {
        return Err(format!(
            "HEIC helper 输出超过上限 {} bytes: {}",
            max_bytes,
            path.display()
        ));
    }

    let file = File::open(path)
        .map_err(|error| format!("无法读取 HEIC helper 输出 {}: {error}", path.display()))?;
    let mut reader = file.take(max_bytes as u64 + 1);
    let mut bytes = Vec::with_capacity(metadata.len().min(max_bytes as u64) as usize);
    reader
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取 HEIC helper 输出 {}: {error}", path.display()))?;
    if bytes.len() > max_bytes {
        return Err(format!(
            "HEIC helper 输出超过上限 {} bytes: {}",
            max_bytes,
            path.display()
        ));
    }
    Ok(bytes)
}

fn read_capped<R: Read>(mut reader: R, max_bytes: usize) -> std::io::Result<CappedOutput> {
    let mut bytes = Vec::with_capacity(max_bytes.min(8 * 1024));
    let mut buffer = [0u8; 8 * 1024];
    let mut truncated = false;

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }

        let remaining = max_bytes.saturating_sub(bytes.len());
        if remaining > 0 {
            let stored = read.min(remaining);
            bytes.extend_from_slice(&buffer[..stored]);
        }
        if read > remaining {
            truncated = true;
        }
    }

    Ok(CappedOutput { bytes, truncated })
}

fn spawn_capped_reader<R>(reader: R, max_bytes: usize) -> CappedReader
where
    R: Read + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    let handle = thread::spawn(move || {
        let _ = sender.send(read_capped(reader, max_bytes));
    });
    CappedReader {
        receiver,
        handle,
        max_bytes,
    }
}

fn join_capped_reader(reader: CappedReader) -> String {
    match reader
        .receiver
        .recv_timeout(HEIC_HELPER_STDERR_DRAIN_TIMEOUT)
    {
        Ok(Ok(output)) => {
            let _ = reader.handle.join();
            capped_output_to_string(output, reader.max_bytes)
        }
        Ok(Err(error)) => {
            let _ = reader.handle.join();
            format!("无法读取 helper stderr: {error}")
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            "读取 helper stderr 超时(已忽略剩余输出)".to_string()
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => "读取 helper stderr 线程崩溃".to_string(),
    }
}

fn capped_output_to_string(output: CappedOutput, max_bytes: usize) -> String {
    let mut text = String::from_utf8_lossy(&output.bytes).to_string();
    if output.truncated {
        if !text.ends_with('\n') && !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&format!("[helper stderr 已截断到 {max_bytes} bytes]"));
    }
    text
}

fn stderr_suffix(stderr: &str) -> String {
    if stderr.trim().is_empty() {
        String::new()
    } else {
        format!(": {}", stderr.trim())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    static SELECTED_HELPER_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn unique_test_dir(name: &str) -> PathBuf {
        let counter = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        env::temp_dir().join(format!(
            "imgconvert-heic-test-{name}-{}-{counter}",
            std::process::id()
        ))
    }

    #[cfg(any(target_os = "linux", windows))]
    fn unique_manifest_test_dir(name: &str) -> PathBuf {
        let counter = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        #[cfg(windows)]
        {
            windows_local_codec_test_dir(&format!("{name}-{counter}"))
        }
        #[cfg(not(windows))]
        {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join(format!(
                    "imgconvert-heic-test-{name}-{}-{counter}",
                    std::process::id()
                ))
        }
    }

    #[cfg(windows)]
    fn windows_local_codec_test_dir(name: &str) -> PathBuf {
        PathBuf::from(env::var_os("LOCALAPPDATA").unwrap())
            .join("ImgConvert")
            .join("codecs")
            .join(format!(
                "imgconvert-heic-test-{name}-{}",
                std::process::id()
            ))
    }

    #[cfg(target_os = "linux")]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[cfg(target_os = "linux")]
    fn set_mode(path: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(mode);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[test]
    fn detects_heic_extensions_case_insensitively() {
        assert!(is_heic_path(Path::new("photo.HEIC")));
        assert!(is_heic_path(Path::new("photo.heif")));
        assert!(is_heic_path(Path::new("photo.hif")));
        assert!(!is_heic_path(Path::new("photo.avif")));
    }

    #[test]
    fn system_heic_dimensions_use_the_core_pixel_budget() {
        assert!(validate_system_heic_dimensions(8_000, 8_000).is_ok());
        let error = validate_system_heic_dimensions(8_001, 8_000).unwrap_err();
        assert!(error.contains("解码上限"));
    }

    #[test]
    fn heic_source_file_limit_rejects_oversized_input_before_decode() {
        let dir = unique_test_dir("oversized-heic-source");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("huge.heic");
        File::create(&input)
            .unwrap()
            .set_len(MAX_HEIC_SOURCE_FILE_BYTES + 1)
            .unwrap();

        let error = decode_heic(&input).unwrap_err();

        assert!(error.contains("HEIC 输入文件超过"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn detects_heic_magic_brands() {
        let mut bytes = vec![0, 0, 0, 24];
        bytes.extend_from_slice(b"ftyp");
        bytes.extend_from_slice(b"heic");
        bytes.extend_from_slice(&[0; 16]);

        assert!(is_heic_magic(&bytes));
        assert!(!is_heic_magic(b"not an image"));
    }

    #[test]
    fn external_codec_disable_flag_accepts_common_truthy_values() {
        assert!(disable_external_codecs_value(Some("1")));
        assert!(disable_external_codecs_value(Some("true")));
        assert!(disable_external_codecs_value(Some("YES")));
        assert!(disable_external_codecs_value(Some("on")));
        assert!(!disable_external_codecs_value(Some("0")));
        assert!(!disable_external_codecs_value(Some("false")));
        assert!(!disable_external_codecs_value(None));
    }

    #[test]
    fn diagnostic_messages_serialize_as_language_neutral_codes() {
        let message = ExternalCodecsDisabledReason::Environment.diagnostic(true);
        let value = serde_json::to_value(message).unwrap();

        assert_eq!(
            value["code"],
            "externalCodecsEnvironmentDisabledFlatpakEnabled"
        );
        assert_eq!(value["detail"], DISABLE_EXTERNAL_CODECS_ENV);
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn external_codec_discovery_is_enabled_on_linux_and_windows() {
        assert!(external_codec_discovery_supported());
    }

    #[cfg(not(any(target_os = "linux", windows)))]
    #[test]
    fn external_codec_discovery_is_disabled_on_other_platforms() {
        assert!(!external_codec_discovery_supported());
    }

    #[test]
    fn helper_search_rejects_relative_path_entries() {
        assert!(find_heic_helper_in_path(OsStr::new("relative/bin")).is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn helper_search_rejects_world_writable_ancestors() {
        // Do not infer `/tmp` permissions from the host. Containers commonly
        // mount it as 0755, while the trust rule must be exercised against an
        // explicitly unsafe ancestor in every test environment.
        let root = unique_test_dir("world-writable-parent");
        let dir = root.join("bin");
        fs::create_dir_all(&dir).unwrap();
        set_mode(&root, 0o777);
        let helper = dir.join("heif-convert");
        fs::write(&helper, b"#!/bin/sh\nexit 0\n").unwrap();
        make_executable(&helper);

        assert!(find_heic_helper_in_path(dir.as_os_str()).is_none());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn helper_search_rejects_writable_helper_file() {
        let dir = unique_manifest_test_dir("writable-helper").join("bin");
        fs::create_dir_all(&dir).unwrap();
        let helper = dir.join("heif-convert");
        fs::write(&helper, b"#!/bin/sh\nexit 0\n").unwrap();
        set_mode(&helper, 0o777);

        assert!(find_heic_helper_in_path(dir.as_os_str()).is_none());

        fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn selected_helper_accepts_explicit_executable_and_clears() {
        let _reset = SelectedHelperReset::new();
        let dir = unique_manifest_test_dir("selected-helper");
        fs::create_dir_all(&dir).unwrap();
        let helper = dir.join("heif-selected");
        fs::write(&helper, b"#!/bin/sh\nexit 0\n").unwrap();
        make_executable(&helper);

        let diagnostic =
            set_selected_heic_helper(Some(helper.to_string_lossy().to_string())).unwrap();
        if let Some(reason) = external_codec_discovery_disabled_reason() {
            let expected_message = reason.diagnostic(false);
            assert!(!diagnostic.available);
            assert_eq!(
                diagnostic.message.as_ref().map(|message| &message.code),
                Some(&expected_message.code)
            );
            assert!(find_heic_helper().is_none());
        } else {
            let found = find_heic_helper().unwrap();

            assert!(diagnostic.available);
            assert_eq!(
                diagnostic.provider.as_ref().unwrap().kind,
                "selected-helper"
            );
            assert_eq!(found.provider_info().kind, "selected-helper");
        }

        let diagnostic = set_selected_heic_helper(None).unwrap();
        assert!(!diagnostic.configured);

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn selected_helper_rejects_writable_file() {
        let dir = unique_manifest_test_dir("selected-writable-helper");
        fs::create_dir_all(&dir).unwrap();
        let helper = dir.join("heif-selected");
        fs::write(&helper, b"#!/bin/sh\nexit 0\n").unwrap();
        set_mode(&helper, 0o777);

        let err = selected_helper_from_path(&helper).unwrap_err();

        assert!(err.contains("HEIC_SELECTED_HELPER_UNTRUSTED"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn selected_helper_rejects_world_writable_parent() {
        let root = unique_test_dir("selected-world-writable-parent");
        let dir = root.join("bin");
        fs::create_dir_all(&dir).unwrap();
        set_mode(&root, 0o777);
        let helper = dir.join("heif-selected");
        fs::write(&helper, b"#!/bin/sh\nexit 0\n").unwrap();
        make_executable(&helper);

        let err = selected_helper_from_path(&helper).unwrap_err();

        assert!(err.contains("HEIC_SELECTED_HELPER_UNTRUSTED"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn selected_helper_command_keeps_invalid_path_for_diagnostics() {
        let _reset = SelectedHelperReset::new();
        let dir = unique_manifest_test_dir("selected-invalid-helper");
        fs::create_dir_all(&dir).unwrap();
        let helper = dir.join("heif-selected");
        fs::write(&helper, b"#!/bin/sh\nexit 0\n").unwrap();
        set_mode(&helper, 0o777);

        let diagnostic =
            set_selected_heic_helper(Some(helper.to_string_lossy().to_string())).unwrap();

        assert!(diagnostic.configured);
        assert!(!diagnostic.available);
        assert_eq!(
            diagnostic.path.as_deref(),
            Some(helper.to_string_lossy().as_ref())
        );
        let message = diagnostic.message.as_ref().unwrap();
        if let Some(reason) = external_codec_discovery_disabled_reason() {
            let expected_message = reason.diagnostic(false);
            assert_eq!(message.code, expected_message.code);
            assert!(message.detail.is_none());
        } else {
            assert_eq!(message.code, "selectedHelperUnavailable");
            assert!(message
                .detail
                .as_deref()
                .is_some_and(|detail| detail.contains("HEIC_SELECTED_HELPER_UNTRUSTED")));
        }

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    struct SelectedHelperReset {
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    #[cfg(target_os = "linux")]
    impl SelectedHelperReset {
        fn new() -> Self {
            let guard = SELECTED_HELPER_TEST_LOCK.lock().unwrap();
            let mut state = SELECTED_HEIC_HELPER.lock().unwrap();
            *state = None;
            Self { _guard: guard }
        }
    }

    #[cfg(target_os = "linux")]
    impl Drop for SelectedHelperReset {
        fn drop(&mut self) {
            if let Ok(mut state) = SELECTED_HEIC_HELPER.lock() {
                *state = None;
            }
        }
    }

    #[test]
    fn validate_header_rejects_non_heif_files() {
        let dir = unique_test_dir("header");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("fake.heic");
        fs::write(&input, b"not a heif file").unwrap();

        let err = validate_heic_header(&input).unwrap_err();

        assert!(err.contains("文件头不是受支持的 HEIF/HEIC"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_capped_marks_truncated_output() {
        let output = read_capped(&b"abcdefghijklmnop"[..], 4).unwrap();

        assert_eq!(output.bytes, b"abcd");
        assert!(output.truncated);
        assert_eq!(
            capped_output_to_string(output, 4),
            "abcd\n[helper stderr 已截断到 4 bytes]"
        );
    }

    #[test]
    fn read_decoded_png_rejects_oversized_output() {
        let dir = unique_test_dir("oversized-output");
        fs::create_dir_all(&dir).unwrap();
        let output = dir.join("decoded.png");
        let file = File::create(&output).unwrap();
        file.set_len(MAX_HEIC_DECODED_PNG_BYTES as u64 + 1).unwrap();

        let err = read_decoded_png(&dir, &output).unwrap_err();

        assert!(err.contains("HEIC helper 输出超过上限"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn workdir_uses_private_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let workdir = WorkDir::new().unwrap();
        let path = workdir.path.clone();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;

        assert_eq!(mode, 0o700);

        drop(workdir);
        assert!(!path.exists());
    }

    #[cfg(windows)]
    #[test]
    fn workdir_uses_local_app_data_on_windows() {
        let local_app_data = PathBuf::from(env::var_os("LOCALAPPDATA").unwrap());
        let expected_base = local_app_data.join("ImgConvert").join("Temp").join("heic");

        let workdir = WorkDir::new().unwrap();
        let path = workdir.path.clone();

        assert!(path_starts_with_case_insensitive(&path, &expected_base));

        drop(workdir);
        assert!(!path.exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn helper_search_accepts_executable_in_absolute_path() {
        let dir = unique_manifest_test_dir("path").join("bin");
        fs::create_dir_all(&dir).unwrap();
        let helper = dir.join("heif-convert");
        fs::write(&helper, b"#!/bin/sh\nexit 0\n").unwrap();
        make_executable(&helper);

        let found = find_heic_helper_in_path(dir.as_os_str()).unwrap();

        assert_eq!(found.command, "heif-convert");
        assert_eq!(found.path, helper);

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_helper_search_accepts_exe_in_local_app_data_codecs() {
        let dir = windows_local_codec_test_dir("path-helper");
        fs::create_dir_all(&dir).unwrap();
        let helper = dir.join("imgconvert-heic-helper.exe");
        fs::write(&helper, b"helper").unwrap();

        let found = find_executable_in_path("imgconvert-heic-helper", dir.as_os_str()).unwrap();

        assert_eq!(found, fs::canonicalize(&helper).unwrap());

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_helper_search_rejects_non_exe_helpers() {
        let dir = windows_local_codec_test_dir("path-non-exe-helper");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("imgconvert-heic-helper"), b"helper").unwrap();

        assert!(find_executable_in_path("imgconvert-heic-helper", dir.as_os_str()).is_none());

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_path_prefix_checks_are_case_insensitive_and_segment_safe() {
        assert!(path_starts_with_case_insensitive(
            Path::new(r"C:\Program Files\ImgConvert\codecs\helper"),
            Path::new(r"c:\program files\imgconvert\codecs"),
        ));
        assert!(path_starts_with_case_insensitive(
            Path::new(r"C:\ProgramData\ImgConvert\codecs\helper"),
            Path::new(r"c:\programdata\imgconvert\codecs"),
        ));
        assert!(!path_starts_with_case_insensitive(
            Path::new(r"C:\ProgramData\ImgConvert\codecsevil\helper"),
            Path::new(r"c:\programdata\imgconvert\codecs"),
        ));
    }

    #[cfg(windows)]
    #[test]
    fn windows_supported_helper_binary_requires_exe_extension() {
        assert!(is_supported_helper_binary(Path::new(
            r"C:\Program Files\ImgConvert\imgconvert-heic-helper.EXE"
        )));
        assert!(!is_supported_helper_binary(Path::new(
            r"C:\Program Files\ImgConvert\imgconvert-heic-helper.dll"
        )));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn decode_pipeline_reads_png_written_by_helper() {
        let dir = unique_test_dir("decode");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.heic");
        fs::write(&input, b"\0\0\0\x18ftypheic\0\0\0\0").unwrap();

        let helper_path = dir.join("heif-convert");
        let fixture_path = helper_path.with_extension("png");
        fs::write(&fixture_path, b"\x89PNG\r\n\x1a\nfake").unwrap();
        fs::write(&helper_path, b"#!/bin/sh\ncp \"$0.png\" \"$2\"\n").unwrap();
        make_executable(&helper_path);

        let helper = Helper::system("heif-convert", helper_path);
        let decoded = decode_heic_to_png_with_helper(&input, &helper).unwrap();

        assert!(decoded.image_bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        assert!(decoded.metadata.is_none());

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn helper_failure_stderr_is_bounded() {
        let dir = unique_test_dir("stderr-bound");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.heic");
        fs::write(&input, b"\0\0\0\x18ftypheic\0\0\0\0").unwrap();

        let helper_path = dir.join("heif-convert");
        fs::write(
            &helper_path,
            br#"#!/bin/sh
dd if=/dev/zero bs=1024 count=80 2>/dev/null | tr '\000' x >&2
exit 7
"#,
        )
        .unwrap();
        make_executable(&helper_path);

        let helper = Helper::system("heif-convert", helper_path);
        let err = decode_heic_to_png_with_helper(&input, &helper).unwrap_err();

        assert!(err.contains("HEIC helper heif-convert 解码失败"));
        assert!(err.contains("helper stderr 已截断"));
        assert!(err.len() < MAX_HEIC_HELPER_STDERR_BYTES + 4096);

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn manifest_provider_loads_relative_helper_and_expands_args() {
        let dir = unique_manifest_test_dir("manifest");
        let bin = dir.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let helper_path = bin.join("heic-helper");
        let fixture_path = helper_path.with_extension("png");
        fs::write(&fixture_path, b"\x89PNG\r\n\x1a\nmanifest").unwrap();
        fs::write(&helper_path, b"#!/bin/sh\ncp \"$0.png\" \"$3\"\n").unwrap();
        make_executable(&helper_path);
        write_manifest(
            &dir,
            r#""decode":{"kind":"heic-to-png-file","command":"bin/heic-helper","args":["--decode","{input}","{output}"],"output":"png"}"#,
            r#""writable":[]"#,
            "LGPL-3.0-or-later",
        );
        let input = dir.join("sample.heic");
        fs::write(&input, b"\0\0\0\x18ftypheic\0\0\0\0").unwrap();

        let helper = find_manifest_heic_helper_in_dirs(vec![dir.clone()]).unwrap();
        let info = helper.provider_info();
        let decoded = decode_heic_to_png_with_helper(&input, &helper).unwrap();

        assert_eq!(info.id, "imgconvert-heic-helper");
        assert_eq!(info.kind, "manifest");
        assert_eq!(info.license.as_deref(), Some("LGPL-3.0-or-later"));
        assert_eq!(
            info.readable,
            vec!["heic".to_string(), "heif".to_string(), "hif".to_string()]
        );
        assert!(info.writable.is_empty());
        assert!(decoded.image_bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        assert!(decoded.metadata.is_none());

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn manifest_provider_reads_optional_metadata_sidecar() {
        let dir = unique_manifest_test_dir("manifest-sidecar");
        let bin = dir.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let helper_path = bin.join("heic-helper");
        let fixture_path = helper_path.with_extension("png");
        fs::write(&fixture_path, b"\x89PNG\r\n\x1a\nmanifest").unwrap();
        fs::write(
            &helper_path,
            br#"#!/bin/sh
cp "$0.png" "$3"
workdir=$(dirname "$4")
printf 'ICC-SIDECAR' > "$workdir/icc.bin"
printf 'EXIF-SIDECAR' > "$workdir/exif.bin"
printf '<rdf:Description tiff:Orientation="6"><dc:title>ok</dc:title></rdf:Description>' > "$workdir/xmp.bin"
printf 'IPTC-SIDECAR' > "$workdir/iptc.bin"
printf '{"version":1,"icc":"icc.bin","exif":"exif.bin","xmp":"xmp.bin","iptc":"iptc.bin"}' > "$4"
"#,
        )
        .unwrap();
        make_executable(&helper_path);
        write_manifest(
            &dir,
            r#""decode":{"kind":"heic-to-png-file","command":"bin/heic-helper","args":["--decode","{input}","{output}","{metadata}"],"output":"png"}"#,
            r#""writable":[]"#,
            "LGPL-3.0-or-later",
        );
        let input = dir.join("sample.heic");
        fs::write(&input, b"\0\0\0\x18ftypheic\0\0\0\0").unwrap();

        let helper = find_manifest_heic_helper_in_dirs(vec![dir.clone()]).unwrap();
        assert!(helper.wants_metadata());
        let decoded = decode_heic_to_png_with_helper(&input, &helper).unwrap();
        let metadata = decoded.metadata.unwrap();

        assert!(decoded.image_bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        assert_eq!(metadata.icc, Some(b"ICC-SIDECAR".to_vec()));
        assert_eq!(metadata.exif, Some(b"EXIF-SIDECAR".to_vec()));
        assert_eq!(metadata.iptc, Some(b"IPTC-SIDECAR".to_vec()));
        assert!(!String::from_utf8(metadata.xmp.unwrap())
            .unwrap()
            .contains("tiff:Orientation"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn flatpak_extension_search_discovers_subdirectory_manifest() {
        let root = unique_manifest_test_dir("flatpak-extension-root");
        let extension_dir = root.join("heic");
        let bin = extension_dir.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let helper_path = bin.join("heic-helper");
        fs::write(&helper_path, b"#!/bin/sh\nexit 0\n").unwrap();
        make_executable(&helper_path);
        write_manifest(
            &extension_dir,
            r#""decode":{"kind":"heic-to-png-file","command":"bin/heic-helper","args":["{input}","{output}"],"output":"png"}"#,
            r#""writable":[]"#,
            "LGPL-3.0-or-later",
        );

        let helper = find_manifest_heic_helper_in_entries(
            flatpak_codec_extension_search_entries_for(root.clone()),
        )
        .unwrap();
        let info = helper.provider_info();

        assert_eq!(info.kind, "manifest");
        assert_eq!(info.id, "imgconvert-heic-helper");
        assert_eq!(helper.path, fs::canonicalize(helper_path).unwrap());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn manifest_rejects_partial_metadata_placeholder() {
        let args = vec![
            ARG_INPUT.to_string(),
            ARG_OUTPUT.to_string(),
            format!("--metadata={ARG_METADATA}"),
        ];
        let err = validate_manifest_args(&args).unwrap_err();

        assert!(err.contains("placeholders must be standalone"));
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn metadata_sidecar_rejects_nested_blob_paths() {
        let dir = unique_test_dir("sidecar-path");
        fs::create_dir_all(dir.join("nested")).unwrap();
        let sidecar = dir.join("metadata.json");
        fs::write(
            &sidecar,
            br#"{"version":1,"icc":"nested/icc.bin","exif":null,"xmp":null}"#,
        )
        .unwrap();
        fs::write(dir.join("nested").join("icc.bin"), b"ICC").unwrap();

        let err = read_metadata_sidecar(&dir, &sidecar).unwrap_err();

        assert!(err.contains("HEIC metadata sidecar 路径非法"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn manifest_rejects_gpl_license() {
        let dir = unique_manifest_test_dir("gpl");
        fs::create_dir_all(&dir).unwrap();
        write_manifest(
            &dir,
            r#""decode":{"kind":"heic-to-png-file","command":"helper","args":["{input}","{output}"],"output":"png"}"#,
            r#""writable":[]"#,
            "GPL-3.0-only",
        );

        let err = load_manifest_helper(&dir.join(HEIC_MANIFEST_NAME)).unwrap_err();

        assert!(err.contains("HEIC_PLUGIN_LICENSE_UNSUPPORTED"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn manifest_rejects_oversized_file() {
        let dir = unique_manifest_test_dir("oversized-manifest");
        fs::create_dir_all(&dir).unwrap();
        let manifest = dir.join(HEIC_MANIFEST_NAME);
        let file = File::create(&manifest).unwrap();
        file.set_len(MAX_PLUGIN_MANIFEST_BYTES as u64 + 1).unwrap();

        let err = load_manifest_helper(&manifest).unwrap_err();

        assert!(err.contains("HEIC_PLUGIN_MANIFEST_TOO_LARGE"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn manifest_rejects_writable_manifest_file() {
        let dir = unique_manifest_test_dir("writable-manifest");
        fs::create_dir_all(&dir).unwrap();
        write_manifest(
            &dir,
            r#""decode":{"kind":"heic-to-png-file","command":"helper","args":["{input}","{output}"],"output":"png"}"#,
            r#""writable":[]"#,
            "LGPL-3.0-or-later",
        );
        let manifest = dir.join(HEIC_MANIFEST_NAME);
        set_mode(&manifest, 0o666);

        let err = load_manifest_helper(&manifest).unwrap_err();

        assert!(err.contains("HEIC_PLUGIN_MANIFEST_UNTRUSTED"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn manifest_rejects_writable_heic() {
        let dir = unique_manifest_test_dir("writable");
        fs::create_dir_all(&dir).unwrap();
        write_manifest(
            &dir,
            r#""decode":{"kind":"heic-to-png-file","command":"helper","args":["{input}","{output}"],"output":"png"}"#,
            r#""writable":["heic"]"#,
            "LGPL-3.0-or-later",
        );

        let err = load_manifest_helper(&dir.join(HEIC_MANIFEST_NAME)).unwrap_err();

        assert!(err.contains("HEIC_PLUGIN_WRITABLE_UNSUPPORTED"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn manifest_rejects_helper_path_escape() {
        let dir = unique_manifest_test_dir("escape");
        fs::create_dir_all(&dir).unwrap();
        write_manifest(
            &dir,
            r#""decode":{"kind":"heic-to-png-file","command":"../helper","args":["{input}","{output}"],"output":"png"}"#,
            r#""writable":[]"#,
            "LGPL-3.0-or-later",
        );

        let err = load_manifest_helper(&dir.join(HEIC_MANIFEST_NAME)).unwrap_err();

        assert!(err.contains("HEIC_PLUGIN_HELPER_PATH_INVALID"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn manifest_dir_diagnostic_reports_rejected_manifest() {
        let dir = unique_manifest_test_dir("diagnostic-rejected");
        fs::create_dir_all(&dir).unwrap();
        write_manifest(
            &dir,
            r#""decode":{"kind":"heic-to-png-file","command":"helper","args":["{input}","{output}"],"output":"png"}"#,
            r#""writable":[]"#,
            "GPL-3.0-only",
        );

        let diagnostic = manifest_dir_diagnostic(&PluginSearchDir {
            source: "test",
            path: dir.clone(),
        });

        assert_eq!(diagnostic.status, "rejected");
        assert_eq!(diagnostic.manifests.len(), 1);
        assert_eq!(diagnostic.manifests[0].status, "rejected");
        let message = diagnostic.manifests[0].message.as_ref().unwrap();
        assert_eq!(message.code, "manifestRejected");
        assert!(message
            .detail
            .as_deref()
            .unwrap()
            .contains("HEIC_PLUGIN_LICENSE_UNSUPPORTED"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(any(target_os = "linux", windows))]
    fn write_manifest(dir: &Path, decode: &str, writable: &str, license: &str) {
        let manifest = format!(
            r#"{{
  "id":"imgconvert-heic-helper",
  "protocol":1,
  "license":"{license}",
  "readable":["heic","heif","hif"],
  {writable},
  "mode":"external-process",
  {decode}
}}"#
        );
        fs::write(dir.join(HEIC_MANIFEST_NAME), manifest).unwrap();
    }
}
