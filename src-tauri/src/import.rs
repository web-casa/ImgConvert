// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! 用户显式授权路径的导入扫描。
//!
//! 当前阶段只处理 Tauri 拖拽/文件选择返回的本机路径；后续 Flatpak portal
//! 与 macOS security-scoped bookmark 应接在这一层之下，而不是散落到前端。

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use imgconvert_core::{probe, Format, READABLE_FORMATS};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::access::{self, AuthorizedPath};
use crate::command_error::CommandError;
use crate::external_codecs;

const DEFAULT_MAX_FILES: usize = 20_000;
const DEFAULT_MAX_ENTRIES: usize = 100_000;
const DEFAULT_MAX_DEPTH: usize = 64;
const HARD_MAX_FILES: usize = 100_000;
const HARD_MAX_ENTRIES: usize = 500_000;
const HARD_MAX_DEPTH: usize = 256;
const PROBE_MAX_BYTES: u64 = 512 * 1024;
const MAX_CLIPBOARD_IMAGE_BYTES: usize = 128 * 1024 * 1024;
const CLIPBOARD_TEMP_PREFIX: &str = "imgconvert-clipboard-";
const CLIPBOARD_FILE_PREFIX: &str = "clipboard-";

static CLIPBOARD_TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanImportOptions {
    pub paths: Vec<String>,
    #[serde(default = "default_recursive")]
    pub recursive: bool,
    #[serde(default)]
    pub max_files: Option<usize>,
    #[serde(default)]
    pub max_entries: Option<usize>,
    #[serde(default)]
    pub max_depth: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportScanResult {
    pub files: Vec<ImportScanFile>,
    pub skipped: usize,
    pub errors: Vec<ImportScanError>,
    pub truncated: bool,
    pub cancelled: bool,
    pub limit_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportScanFile {
    pub path: String,
    pub key: String,
    pub relative_dir: Option<String>,
    pub metadata: Option<ImportImageMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportImageMetadata {
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub dpi_x: Option<f64>,
    pub dpi_y: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportScanError {
    pub path: String,
    pub error: CommandError,
}

#[derive(Debug)]
pub struct ClipboardImageImport {
    pub file: ImportScanFile,
    pub managed_path: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImageImportOptions {
    pub bytes: Vec<u8>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub suggested_name: Option<String>,
}

#[derive(Default)]
pub struct ImportScanState {
    current: Mutex<Option<ImportScanHandle>>,
    next_id: AtomicU64,
}

#[derive(Default)]
pub struct ClipboardImportState {
    managed_files: Mutex<BTreeSet<PathBuf>>,
}

struct ImportScanHandle {
    id: u64,
    token: CancellationToken,
}

pub struct ImportScanRegistration {
    id: u64,
    token: CancellationToken,
}

#[derive(Debug, Clone, Copy)]
struct ScanLimits {
    max_files: usize,
    max_entries: usize,
    max_depth: usize,
}

struct PendingPath {
    path: PathBuf,
    depth: usize,
    relative_base: Option<PathBuf>,
}

struct ScannedFile {
    path: PathBuf,
    relative_dir: Option<PathBuf>,
    metadata: Option<ImportImageMetadata>,
}

struct Scanner {
    allowed_extensions: BTreeSet<String>,
    recursive: bool,
    limits: ScanLimits,
    cancel: CancellationToken,
    files: BTreeMap<PathBuf, ScannedFile>,
    entries_seen: usize,
    skipped: usize,
    errors: Vec<ImportScanError>,
    truncated: bool,
    cancelled: bool,
    limit_reason: Option<String>,
}

impl ImportScanState {
    pub fn begin(&self) -> Result<ImportScanRegistration, String> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "导入扫描状态锁已损坏".to_string())?;
        if current.is_some() {
            return Err("已有导入扫描正在运行".to_string());
        }

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let token = CancellationToken::new();
        *current = Some(ImportScanHandle {
            id,
            token: token.clone(),
        });
        Ok(ImportScanRegistration { id, token })
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

impl ImportScanRegistration {
    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

impl ClipboardImportState {
    pub(crate) fn register(&self, path: PathBuf) -> Result<(), String> {
        let mut managed_files = self
            .managed_files
            .lock()
            .map_err(|_| "剪贴板临时文件状态锁已损坏".to_string())?;
        managed_files.insert(path);
        Ok(())
    }

    fn managed_path_for(&self, path: &Path) -> Result<Option<PathBuf>, String> {
        let managed_files = self
            .managed_files
            .lock()
            .map_err(|_| "剪贴板临时文件状态锁已损坏".to_string())?;
        if let Some(path) = managed_files.get(path) {
            return Ok(Some(path.clone()));
        }

        if let Ok(canonical_path) = fs::canonicalize(path) {
            if let Some(path) = managed_files.get(&canonical_path) {
                return Ok(Some(path.clone()));
            }
        }

        Ok(None)
    }

    fn unregister(&self, path: &Path) -> Result<(), String> {
        let mut managed_files = self
            .managed_files
            .lock()
            .map_err(|_| "剪贴板临时文件状态锁已损坏".to_string())?;
        managed_files.remove(path);
        Ok(())
    }
}

fn default_recursive() -> bool {
    true
}

pub fn scan_import_paths(
    options: ScanImportOptions,
    cancel: CancellationToken,
) -> ImportScanResult {
    let mut scanner = Scanner {
        allowed_extensions: readable_extensions(),
        recursive: options.recursive,
        limits: ScanLimits::from_options(&options),
        cancel,
        files: BTreeMap::new(),
        entries_seen: 0,
        skipped: 0,
        errors: Vec::new(),
        truncated: false,
        cancelled: false,
        limit_reason: None,
    };

    scanner.scan(access::user_selected_paths(options.paths));
    scanner.finish()
}

pub fn import_clipboard_image(
    options: ClipboardImageImportOptions,
) -> Result<ClipboardImageImport, String> {
    if options.bytes.is_empty() {
        return Err("剪贴板图片为空".to_string());
    }
    if options.bytes.len() > MAX_CLIPBOARD_IMAGE_BYTES {
        return Err(format!(
            "剪贴板图片超过上限 {} bytes",
            MAX_CLIPBOARD_IMAGE_BYTES
        ));
    }

    if let Some(mime_type) = options.mime_type.as_deref() {
        validate_clipboard_mime_type(mime_type)?;
    }

    let info = probe(&options.bytes)
        .map_err(|error| format!("剪贴板内容不是支持的图片或文件已损坏: {error}"))?;
    let temp_dir = create_clipboard_temp_dir()?;
    let extension = format_extension(info.format);
    let file_name = clipboard_file_name(options.suggested_name.as_deref(), extension);
    let path = temp_dir.join(file_name);

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("无法创建剪贴板临时图片 {}: {error}", path.display()))?;
    file.write_all(&options.bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("无法写入剪贴板临时图片 {}: {error}", path.display()))?;

    let key = match fs::canonicalize(&path) {
        Ok(path) => path,
        Err(error) => {
            cleanup_clipboard_file_best_effort(&path);
            return Err(format!(
                "无法解析剪贴板临时图片路径 {}: {error}",
                path.display()
            ));
        }
    };
    let grant = access::clipboard_temp_path(path);
    let path_text = match grant.path().to_str() {
        Some(path) => path.to_string(),
        None => {
            cleanup_clipboard_file_best_effort(grant.path());
            return Err(format!(
                "剪贴板临时图片路径不是有效 UTF-8: {}",
                grant.path().display()
            ));
        }
    };
    Ok(ClipboardImageImport {
        file: ImportScanFile {
            path: path_text,
            key: key.to_string_lossy().to_string(),
            relative_dir: None,
            metadata: Some(ImportImageMetadata {
                format: info.format.id().to_string(),
                width: info.width,
                height: info.height,
                dpi_x: info.dpi.map(|dpi| dpi.x),
                dpi_y: info.dpi.map(|dpi| dpi.y),
            }),
        },
        managed_path: key,
    })
}

pub fn cleanup_imported_temp_file(
    path: String,
    state: &ClipboardImportState,
) -> Result<bool, String> {
    let path = PathBuf::from(path);
    let Some(managed_path) = state.managed_path_for(&path)? else {
        return Ok(false);
    };
    if !is_managed_clipboard_temp_file(&managed_path) {
        return Ok(false);
    }

    let Ok(metadata) = fs::symlink_metadata(&managed_path) else {
        state.unregister(&managed_path)?;
        return Ok(false);
    };
    if !metadata.is_file() {
        state.unregister(&managed_path)?;
        return Ok(false);
    }

    fs::remove_file(&managed_path)
        .map_err(|error| format!("无法清理剪贴板临时图片 {}: {error}", managed_path.display()))?;
    state.unregister(&managed_path)?;
    if let Some(parent) = managed_path.parent() {
        let _ = fs::remove_dir(parent);
    }
    Ok(true)
}

fn readable_extensions() -> BTreeSet<String> {
    readable_extensions_with_heic(external_codecs::heic_available())
}

fn readable_extensions_with_heic(heic_available: bool) -> BTreeSet<String> {
    let mut extensions = BTreeSet::new();
    for format in READABLE_FORMATS {
        match format {
            Format::Jpeg => {
                extensions.insert("jpg".to_string());
                extensions.insert("jpeg".to_string());
            }
            Format::Png => {
                extensions.insert("png".to_string());
            }
            Format::WebP => {
                extensions.insert("webp".to_string());
            }
            Format::Avif => {
                extensions.insert("avif".to_string());
            }
        }
    }
    if heic_available {
        for extension in external_codecs::heic_extensions() {
            extensions.insert((*extension).to_string());
        }
    }
    extensions
}

impl ScanLimits {
    fn from_options(options: &ScanImportOptions) -> Self {
        Self {
            max_files: normalize_limit(options.max_files, DEFAULT_MAX_FILES, HARD_MAX_FILES),
            max_entries: normalize_limit(
                options.max_entries,
                DEFAULT_MAX_ENTRIES,
                HARD_MAX_ENTRIES,
            ),
            max_depth: normalize_limit(options.max_depth, DEFAULT_MAX_DEPTH, HARD_MAX_DEPTH),
        }
    }
}

fn normalize_limit(value: Option<usize>, default: usize, hard_max: usize) -> usize {
    value.unwrap_or(default).clamp(1, hard_max)
}

impl Scanner {
    fn scan(&mut self, paths: Vec<AuthorizedPath>) {
        let _scopes = paths
            .iter()
            .map(AuthorizedPath::scoped_access)
            .collect::<Vec<_>>();
        let mut stack = Vec::new();
        for grant in paths.into_iter().rev() {
            if !self.push_path(&mut stack, grant.into_path_buf(), 0, None) {
                break;
            }
        }

        while let Some(pending) = stack.pop() {
            if self.should_stop() {
                break;
            }
            self.scan_path(pending, &mut stack);
        }
    }

    fn push_path(
        &mut self,
        stack: &mut Vec<PendingPath>,
        path: PathBuf,
        depth: usize,
        relative_base: Option<PathBuf>,
    ) -> bool {
        if self.should_stop() {
            return false;
        }
        if depth > self.limits.max_depth {
            self.skipped += 1;
            self.truncate("目录深度超过上限");
            return false;
        }
        if self.entries_seen >= self.limits.max_entries {
            self.truncate("扫描条目达到上限");
            return false;
        }

        self.entries_seen += 1;
        stack.push(PendingPath {
            path,
            depth,
            relative_base,
        });
        true
    }

    fn scan_path(&mut self, pending: PendingPath, stack: &mut Vec<PendingPath>) {
        let metadata = match fs::symlink_metadata(&pending.path) {
            Ok(metadata) => metadata,
            Err(error) => {
                self.error(&pending.path, format!("无法读取路径: {error}"));
                return;
            }
        };

        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            self.scan_symlink(pending.path, pending.relative_base.as_deref());
        } else if file_type.is_file() {
            self.consider_file(pending.path, pending.relative_base.as_deref());
        } else if file_type.is_dir() {
            self.scan_dir(pending.path, pending.depth, pending.relative_base, stack);
        } else {
            self.skipped += 1;
        }
    }

    fn scan_symlink(&mut self, path: PathBuf, relative_base: Option<&Path>) {
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                self.error(&path, format!("无法读取符号链接目标: {error}"));
                return;
            }
        };

        if metadata.is_file() {
            self.consider_file(path, relative_base);
        } else {
            // 不递归符号链接目录，避免循环和越过用户明确选择的目录边界。
            self.skipped += 1;
        }
    }

    fn scan_dir(
        &mut self,
        path: PathBuf,
        depth: usize,
        relative_base: Option<PathBuf>,
        stack: &mut Vec<PendingPath>,
    ) {
        if !self.recursive {
            self.skipped += 1;
            return;
        }

        let child_depth = depth.saturating_add(1);
        if child_depth > self.limits.max_depth {
            self.skipped += 1;
            self.truncate("目录深度超过上限");
            return;
        }

        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(error) => {
                self.error(&path, format!("无法读取目录: {error}"));
                return;
            }
        };

        let child_relative_base = relative_base.unwrap_or_else(|| path.clone());
        for entry in entries {
            if self.should_stop() {
                break;
            }
            match entry {
                Ok(entry) => {
                    if !self.push_path(
                        stack,
                        entry.path(),
                        child_depth,
                        Some(child_relative_base.clone()),
                    ) {
                        break;
                    }
                }
                Err(error) => self.error(&path, format!("无法读取目录项: {error}")),
            }
        }
    }

    fn consider_file(&mut self, path: PathBuf, relative_base: Option<&Path>) {
        if !self.has_allowed_extension(&path) {
            self.skipped += 1;
            return;
        }

        let key = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if self.files.contains_key(&key) {
            return;
        }
        if self.files.len() >= self.limits.max_files {
            self.truncate("文件数量达到上限");
            return;
        }

        let metadata = probe_file_metadata(&path);
        let relative_dir = relative_dir_for(&path, relative_base);
        self.files.insert(
            key,
            ScannedFile {
                path,
                relative_dir,
                metadata,
            },
        );
        if self.files.len() >= self.limits.max_files {
            self.truncate("文件数量达到上限");
        }
    }

    fn has_allowed_extension(&self, path: &Path) -> bool {
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| {
                self.allowed_extensions
                    .contains(&extension.to_ascii_lowercase())
            })
            .unwrap_or(false)
    }

    fn should_stop(&mut self) -> bool {
        if self.cancel.is_cancelled() {
            self.cancelled = true;
        }
        self.cancelled || self.truncated
    }

    fn truncate(&mut self, reason: impl Into<String>) {
        if !self.truncated {
            self.truncated = true;
            self.limit_reason = Some(reason.into());
        }
    }

    fn finish(mut self) -> ImportScanResult {
        let scanned_files = std::mem::take(&mut self.files);
        let mut files = Vec::with_capacity(scanned_files.len());
        for (key, file) in scanned_files {
            match file.path.to_str() {
                Some(path) => files.push(ImportScanFile {
                    path: path.to_string(),
                    key: key.to_string_lossy().to_string(),
                    relative_dir: file
                        .relative_dir
                        .as_ref()
                        .map(|relative_dir| relative_dir.to_string_lossy().to_string()),
                    metadata: file.metadata,
                }),
                None => {
                    self.skipped += 1;
                    self.error(&file.path, "路径不是有效 UTF-8");
                }
            }
        }

        ImportScanResult {
            files,
            skipped: self.skipped,
            errors: self.errors,
            truncated: self.truncated,
            cancelled: self.cancelled,
            limit_reason: self.limit_reason,
        }
    }

    fn error(&mut self, path: &Path, message: impl Into<String>) {
        let path = path.to_string_lossy().to_string();
        self.errors.push(ImportScanError {
            error: CommandError::import_failed(Some(&path), message),
            path,
        });
    }
}

fn relative_dir_for(path: &Path, relative_base: Option<&Path>) -> Option<PathBuf> {
    let base = relative_base?;
    let parent = path.parent()?;
    let relative = parent.strip_prefix(base).ok()?;
    if relative.as_os_str().is_empty() {
        None
    } else {
        Some(relative.to_path_buf())
    }
}

fn probe_file_metadata(path: &Path) -> Option<ImportImageMetadata> {
    if external_codecs::is_heic_path(path) {
        return None;
    }
    let mut file = File::open(path).ok()?;
    let mut bytes = Vec::with_capacity(16 * 1024);
    std::io::Read::by_ref(&mut file)
        .take(PROBE_MAX_BYTES)
        .read_to_end(&mut bytes)
        .ok()?;
    let info = probe(&bytes).ok()?;
    Some(ImportImageMetadata {
        format: info.format.id().to_string(),
        width: info.width,
        height: info.height,
        dpi_x: info.dpi.map(|dpi| dpi.x),
        dpi_y: info.dpi.map(|dpi| dpi.y),
    })
}

fn validate_clipboard_mime_type(mime_type: &str) -> Result<(), String> {
    let normalized = mime_type
        .split(';')
        .next()
        .unwrap_or(mime_type)
        .trim()
        .to_ascii_lowercase();
    if normalized.is_empty()
        || matches!(
            normalized.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/avif"
        )
    {
        Ok(())
    } else {
        Err(format!("剪贴板图片类型暂不支持: {mime_type}"))
    }
}

fn format_extension(format: Format) -> &'static str {
    match format {
        Format::Jpeg => "jpg",
        Format::Png => "png",
        Format::WebP => "webp",
        Format::Avif => "avif",
    }
}

fn clipboard_file_name(suggested_name: Option<&str>, extension: &str) -> String {
    let stem = suggested_name
        .and_then(|name| Path::new(name).file_stem())
        .and_then(|stem| stem.to_str())
        .map(sanitize_file_stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "image".to_string());
    let counter = CLIPBOARD_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{CLIPBOARD_FILE_PREFIX}{stem}-{counter}.{extension}")
}

fn sanitize_file_stem(stem: &str) -> String {
    stem.chars()
        .filter_map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                Some(ch)
            } else if ch.is_whitespace() {
                Some('-')
            } else {
                None
            }
        })
        .take(64)
        .collect()
}

fn create_clipboard_temp_dir() -> Result<PathBuf, String> {
    let pid = std::process::id();
    for _ in 0..64 {
        let counter = CLIPBOARD_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path =
            std::env::temp_dir().join(format!("{CLIPBOARD_TEMP_PREFIX}{pid}-{nanos}-{counter}"));
        match create_private_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "无法创建剪贴板临时目录 {}: {error}",
                    path.display()
                ));
            }
        }
    }
    Err("无法创建唯一剪贴板临时目录".to_string())
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

pub(crate) fn cleanup_clipboard_file_best_effort(path: &Path) {
    let _ = fs::remove_file(path);
    if let Some(parent) = path.parent() {
        let _ = fs::remove_dir(parent);
    }
}

fn is_managed_clipboard_temp_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|file_name| file_name.to_str()) else {
        return false;
    };
    if !file_name.starts_with(CLIPBOARD_FILE_PREFIX) {
        return false;
    }

    let Some(parent) = path.parent() else {
        return false;
    };
    let Some(parent_name) = parent.file_name().and_then(|file_name| file_name.to_str()) else {
        return false;
    };
    if !parent_name.starts_with(CLIPBOARD_TEMP_PREFIX) {
        return false;
    }

    let Ok(canonical_parent) = fs::canonicalize(parent) else {
        return false;
    };
    let Ok(canonical_temp) = fs::canonicalize(std::env::temp_dir()) else {
        return false;
    };
    canonical_parent.parent() == Some(canonical_temp.as_path())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "imgconvert-import-{name}-{}-{nanos}",
            std::process::id()
        ))
    }

    fn options(paths: Vec<PathBuf>) -> ScanImportOptions {
        ScanImportOptions {
            paths: paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
            recursive: true,
            max_files: None,
            max_entries: None,
            max_depth: None,
        }
    }

    fn scan(options: ScanImportOptions) -> ImportScanResult {
        scan_import_paths(options, CancellationToken::new())
    }

    fn result_paths(result: &ImportScanResult) -> Vec<String> {
        result.files.iter().map(|file| file.path.clone()).collect()
    }

    fn png_with_dimensions(width: u32, height: u32) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&width.to_be_bytes());
        data.extend_from_slice(&height.to_be_bytes());
        data.extend_from_slice(&[8, 6, 0, 0, 0]);

        let mut png = Vec::new();
        png.extend_from_slice(&[0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n']);
        append_png_chunk(&mut png, b"IHDR", &data);
        append_png_chunk(&mut png, b"IDAT", &[]);
        append_png_chunk(&mut png, b"IEND", &[]);
        png
    }

    fn append_png_chunk(png: &mut Vec<u8>, name: &[u8; 4], data: &[u8]) {
        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        png.extend_from_slice(name);
        png.extend_from_slice(data);
        let mut crc = 0xffff_ffffu32;
        for &byte in name.iter().chain(data.iter()) {
            crc ^= byte as u32;
            for _ in 0..8 {
                if crc & 1 == 1 {
                    crc = (crc >> 1) ^ 0xedb8_8320;
                } else {
                    crc >>= 1;
                }
            }
        }
        png.extend_from_slice(&(!crc).to_be_bytes());
    }

    #[test]
    fn readable_extensions_add_heic_only_when_helper_is_available() {
        let without_heic = readable_extensions_with_heic(false);
        let with_heic = readable_extensions_with_heic(true);

        assert!(!without_heic.contains("heic"));
        assert!(with_heic.contains("heic"));
        assert!(with_heic.contains("heif"));
        assert!(with_heic.contains("hif"));
    }

    #[test]
    fn scans_nested_directories_filters_extensions_and_reports_skips() {
        let dir = unique_test_dir("nested");
        let nested = dir.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let jpg = dir.join("a.jpg");
        let png = nested.join("b.PNG");
        let txt = nested.join("notes.txt");
        fs::write(&jpg, b"jpg").unwrap();
        fs::write(&png, b"png").unwrap();
        fs::write(&txt, b"text").unwrap();

        let result = scan(options(vec![dir.clone()]));
        let paths = result_paths(&result);

        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&jpg.to_string_lossy().to_string()));
        assert!(paths.contains(&png.to_string_lossy().to_string()));
        assert_eq!(result.skipped, 1);
        assert!(!result.truncated);
        assert!(!result.cancelled);
        assert!(result.errors.is_empty());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn deduplicates_direct_files_also_found_through_directory_scan() {
        let dir = unique_test_dir("dedupe");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("same.webp");
        fs::write(&file, b"webp").unwrap();

        let result = scan(options(vec![file.clone(), dir.clone()]));

        assert_eq!(
            result_paths(&result),
            vec![file.to_string_lossy().to_string()]
        );
        assert_eq!(
            result.files[0].key,
            fs::canonicalize(&file).unwrap().to_string_lossy()
        );
        assert_eq!(result.skipped, 0);
        assert!(result.errors.is_empty());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn directory_scan_reports_relative_output_directories() {
        let dir = unique_test_dir("relative-dir");
        let nested = dir.join("album").join("day-1");
        fs::create_dir_all(&nested).unwrap();
        let file = nested.join("image.png");
        fs::write(&file, png_with_dimensions(4, 3)).unwrap();

        let result = scan(options(vec![dir.clone()]));

        assert_eq!(result.files.len(), 1);
        assert_eq!(
            result.files[0].relative_dir.as_deref(),
            Some(Path::new("album").join("day-1").to_string_lossy().as_ref())
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn scan_pings_image_dimensions_when_header_is_available() {
        let dir = unique_test_dir("metadata");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sample.png");
        fs::write(&file, png_with_dimensions(64, 48)).unwrap();

        let result = scan(options(vec![file.clone()]));

        assert_eq!(result.files.len(), 1);
        let metadata = result.files[0].metadata.as_ref().unwrap();
        assert_eq!(metadata.format, "png");
        assert_eq!((metadata.width, metadata.height), (64, 48));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn clipboard_import_writes_temp_file_and_returns_metadata() {
        let state = ClipboardImportState::default();
        let clipboard_import = import_clipboard_image(ClipboardImageImportOptions {
            bytes: png_with_dimensions(32, 18),
            mime_type: Some("image/png".to_string()),
            suggested_name: Some("screen shot.png".to_string()),
        })
        .unwrap();
        state.register(clipboard_import.managed_path).unwrap();
        let file = clipboard_import.file;

        assert!(file.path.contains(CLIPBOARD_TEMP_PREFIX));
        assert!(file.path.ends_with(".png"));
        assert_eq!(file.relative_dir, None);
        assert_eq!(file.metadata.as_ref().unwrap().format, "png");
        assert_eq!(
            (
                file.metadata.as_ref().unwrap().width,
                file.metadata.as_ref().unwrap().height
            ),
            (32, 18)
        );
        assert!(Path::new(&file.path).is_file());

        assert!(cleanup_imported_temp_file(file.path.clone(), &state).unwrap());
        assert!(!Path::new(&file.path).exists());
        assert!(!cleanup_imported_temp_file(file.path, &state).unwrap());
    }

    #[test]
    fn clipboard_import_rejects_unsupported_mime() {
        let err = import_clipboard_image(ClipboardImageImportOptions {
            bytes: png_with_dimensions(1, 1),
            mime_type: Some("image/bmp".to_string()),
            suggested_name: None,
        })
        .unwrap_err();

        assert!(err.contains("剪贴板图片类型暂不支持"));
    }

    #[test]
    fn cleanup_imported_temp_file_ignores_unmanaged_file() {
        let state = ClipboardImportState::default();
        let dir = unique_test_dir("cleanup-ignore");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clipboard-image.png");
        fs::write(&file, b"not managed").unwrap();

        assert!(!cleanup_imported_temp_file(file.to_string_lossy().to_string(), &state).unwrap());
        assert!(file.exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cleanup_imported_temp_file_rejects_forged_prefixed_temp_path() {
        let state = ClipboardImportState::default();
        let dir = std::env::temp_dir().join(format!(
            "{CLIPBOARD_TEMP_PREFIX}forged-{}",
            CLIPBOARD_TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(format!("{CLIPBOARD_FILE_PREFIX}image.png"));
        fs::write(&file, b"not managed").unwrap();

        assert!(!cleanup_imported_temp_file(file.to_string_lossy().to_string(), &state).unwrap());
        assert!(file.exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_imported_temp_file_accepts_alias_without_losing_registration() {
        let state = ClipboardImportState::default();
        let clipboard_import = import_clipboard_image(ClipboardImageImportOptions {
            bytes: png_with_dimensions(8, 8),
            mime_type: Some("image/png".to_string()),
            suggested_name: Some("alias.png".to_string()),
        })
        .unwrap();
        let managed_path = clipboard_import.managed_path.clone();
        let file = clipboard_import.file;
        state.register(managed_path.clone()).unwrap();

        let alias_dir = unique_test_dir("clipboard-alias");
        fs::create_dir_all(&alias_dir).unwrap();
        let alias = alias_dir.join("alias.png");
        std::os::unix::fs::symlink(&managed_path, &alias).unwrap();

        assert!(cleanup_imported_temp_file(alias.to_string_lossy().to_string(), &state).unwrap());
        assert!(!managed_path.exists());
        assert!(!cleanup_imported_temp_file(file.path, &state).unwrap());

        let _ = fs::remove_file(alias);
        fs::remove_dir_all(alias_dir).unwrap();
    }

    #[test]
    fn missing_paths_are_reported_without_failing_the_scan() {
        let missing = unique_test_dir("missing").join("gone.png");

        let result = scan(options(vec![missing.clone()]));

        assert!(result.files.is_empty());
        assert_eq!(result.skipped, 0);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].path, missing.to_string_lossy().to_string());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_file_uses_canonical_key_for_deduplication() {
        let dir = unique_test_dir("symlink-file");
        fs::create_dir_all(&dir).unwrap();
        let real = dir.join("real.png");
        let link = dir.join("link.png");
        fs::write(&real, b"png").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let result = scan(options(vec![link.clone(), real.clone()]));

        assert_eq!(result.files.len(), 1);
        assert_eq!(
            result.files[0].key,
            fs::canonicalize(&real).unwrap().to_string_lossy()
        );
        assert!(result.errors.is_empty());

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn does_not_recurse_into_symlink_directories() {
        let dir = unique_test_dir("symlink-dir");
        let real = dir.join("real");
        let link = dir.join("link");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("hidden.png"), b"png").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let result = scan(options(vec![link]));

        assert!(result.files.is_empty());
        assert_eq!(result.skipped, 1);
        assert!(result.errors.is_empty());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn max_files_truncates_scan() {
        let dir = unique_test_dir("max-files");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.png"), b"png").unwrap();
        fs::write(dir.join("b.png"), b"png").unwrap();

        let mut options = options(vec![dir.clone()]);
        options.max_files = Some(1);
        let result = scan(options);

        assert_eq!(result.files.len(), 1);
        assert!(result.truncated);
        assert_eq!(result.limit_reason.as_deref(), Some("文件数量达到上限"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn max_entries_truncates_before_unbounded_stack_growth() {
        let dir = unique_test_dir("max-entries");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.png"), b"png").unwrap();
        fs::write(dir.join("b.png"), b"png").unwrap();

        let mut options = options(vec![dir.clone()]);
        options.max_entries = Some(1);
        let result = scan(options);

        assert!(result.files.is_empty());
        assert!(result.truncated);
        assert_eq!(result.limit_reason.as_deref(), Some("扫描条目达到上限"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cancellation_stops_scan_without_erroring() {
        let dir = unique_test_dir("cancel");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.png"), b"png").unwrap();
        let token = CancellationToken::new();
        token.cancel();

        let result = scan_import_paths(options(vec![dir.clone()]), token);

        assert!(result.files.is_empty());
        assert!(result.cancelled);
        assert!(!result.truncated);

        fs::remove_dir_all(dir).unwrap();
    }
}
