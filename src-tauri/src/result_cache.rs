// SPDX-License-Identifier: Apache-2.0

//! Bounded metadata-only result cache.
//!
//! Cache records never contain image pixels. They only bind an existing output
//! file's hash and size to a conversion key, so every failure safely degrades to
//! a cache miss.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime};

const CACHE_RECORD_VERSION: &str = "v3";
const CACHE_RECORD_EXTENSION: &str = "txt";
const MAX_CACHE_RECORD_BYTES: usize = 4 * 1024;
const MAX_CACHE_RECORDS: usize = 4_096;
const MAX_CACHE_RECORD_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const CACHE_PRUNE_INTERVAL: usize = 64;

static WRITES_SINCE_START: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResultCacheRecord {
    output_hash: String,
    output_size: u64,
    workflow: CachedWorkflowStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CachedWorkflowStatus {
    pub width: u32,
    pub height: u32,
    pub selected_quality: Option<u8>,
    pub target_size_met: Option<bool>,
    pub color_profile_converted_for_resize: bool,
    pub invalid_color_profile_discarded: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CacheHit {
    pub output_size: u64,
    pub workflow: CachedWorkflowStatus,
}

#[derive(Debug)]
struct CacheEntry {
    path: PathBuf,
    modified: SystemTime,
}

pub(crate) fn hit(out: &Path, key: &str) -> Option<CacheHit> {
    let record = read_record(key)?;
    if !fs::symlink_metadata(out).ok()?.file_type().is_file() {
        return None;
    }
    let (output_size, output_hash) = blake3_hash_file(out)?;
    if output_size == record.output_size && output_hash.to_hex().as_str() == record.output_hash {
        Some(CacheHit {
            output_size,
            workflow: record.workflow,
        })
    } else {
        None
    }
}

pub(crate) fn write_record(
    key: &str,
    output: &[u8],
    output_size: u64,
    workflow: CachedWorkflowStatus,
) {
    let Some(path) = record_path(key) else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() || !trusted_cache_directory(parent) {
        return;
    }
    let record = format!(
        "{CACHE_RECORD_VERSION}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n",
        blake3::hash(output).to_hex(),
        output_size,
        workflow.width,
        workflow.height,
        option_u8_record(workflow.selected_quality),
        option_bool_record(workflow.target_size_met),
        u8::from(workflow.color_profile_converted_for_resize),
        u8::from(workflow.invalid_color_profile_discarded),
    );
    if write_record_file(&path, &record)
        && WRITES_SINCE_START.fetch_add(1, Ordering::Relaxed) % CACHE_PRUNE_INTERVAL
            == CACHE_PRUNE_INTERVAL - 1
    {
        let _ = prune_directory(
            parent,
            SystemTime::now(),
            MAX_CACHE_RECORD_AGE,
            MAX_CACHE_RECORDS,
        );
    }
}

/// Replace only an existing regular record, then create the new file exclusively. `create_new`
/// refuses symlinks and closes the check/write race without following an attacker-controlled
/// cache entry. A partial record after an I/O failure is harmless because parsing fails closed.
fn write_record_file(path: &Path, record: &str) -> bool {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => {
            if fs::remove_file(path).is_err() {
                return false;
            }
        }
        Ok(_) => return false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return false,
    }

    let Ok(mut file) = OpenOptions::new().write(true).create_new(true).open(path) else {
        return false;
    };
    file.write_all(record.as_bytes())
        .and_then(|()| file.flush())
        .is_ok()
}

pub(crate) fn cleanup_best_effort() {
    let Some(dir) = cache_dir() else {
        return;
    };
    let _ = prune_directory(
        &dir,
        SystemTime::now(),
        MAX_CACHE_RECORD_AGE,
        MAX_CACHE_RECORDS,
    );
}

pub(crate) fn clear() -> Result<usize, String> {
    let Some(dir) = cache_dir() else {
        return Ok(0);
    };
    clear_directory(&dir)
}

fn read_record(key: &str) -> Option<ResultCacheRecord> {
    let path = record_path(key)?;
    read_record_file(&path, SystemTime::now())
}

fn read_record_file(path: &Path, now: SystemTime) -> Option<ResultCacheRecord> {
    if !fs::symlink_metadata(path).ok()?.file_type().is_file() {
        return None;
    }
    let file = File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.file_type().is_file()
        || metadata.len() > MAX_CACHE_RECORD_BYTES as u64
        || record_is_expired(metadata.modified().ok()?, now, MAX_CACHE_RECORD_AGE)
    {
        return None;
    }
    let mut bytes = Vec::new();
    file.take((MAX_CACHE_RECORD_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > MAX_CACHE_RECORD_BYTES {
        return None;
    }
    let data = String::from_utf8(bytes).ok()?;
    parse_record(&data)
}

fn record_is_expired(modified: SystemTime, now: SystemTime, max_age: Duration) -> bool {
    now.duration_since(modified)
        .map(|age| age > max_age)
        // A future timestamp can result from clock correction. Treat it as
        // fresh instead of turning every cache lookup into a miss.
        .unwrap_or(false)
}

fn parse_record(data: &str) -> Option<ResultCacheRecord> {
    let mut lines = data.lines();
    if lines.next()? != CACHE_RECORD_VERSION {
        return None;
    }
    let output_hash = lines.next()?.trim().to_string();
    let output_size = lines.next()?.trim().parse().ok()?;
    let width = lines.next()?.trim().parse().ok()?;
    let height = lines.next()?.trim().parse().ok()?;
    let selected_quality = parse_option_u8(lines.next()?.trim())?;
    let target_size_met = parse_option_bool(lines.next()?.trim())?;
    let color_profile_converted_for_resize = match lines.next()?.trim() {
        "0" => false,
        "1" => true,
        _ => return None,
    };
    let invalid_color_profile_discarded = match lines.next()?.trim() {
        "0" => false,
        "1" => true,
        _ => return None,
    };
    if (color_profile_converted_for_resize && invalid_color_profile_discarded)
        || (target_size_met.is_some() && selected_quality.is_none())
    {
        return None;
    }
    if lines.next().is_some() || width == 0 || height == 0 {
        return None;
    }
    if output_hash.len() != 64 || !output_hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(ResultCacheRecord {
        output_hash,
        output_size,
        workflow: CachedWorkflowStatus {
            width,
            height,
            selected_quality,
            target_size_met,
            color_profile_converted_for_resize,
            invalid_color_profile_discarded,
        },
    })
}

fn option_u8_record(value: Option<u8>) -> String {
    value.map_or_else(|| "-".to_string(), |value| value.to_string())
}

fn parse_option_u8(value: &str) -> Option<Option<u8>> {
    if value == "-" {
        return Some(None);
    }
    let value = value.parse::<u8>().ok()?;
    (1..=100).contains(&value).then_some(Some(value))
}

fn option_bool_record(value: Option<bool>) -> &'static str {
    match value {
        None => "-",
        Some(false) => "0",
        Some(true) => "1",
    }
}

fn parse_option_bool(value: &str) -> Option<Option<bool>> {
    match value {
        "-" => Some(None),
        "0" => Some(Some(false)),
        "1" => Some(Some(true)),
        _ => None,
    }
}

fn record_path(key: &str) -> Option<PathBuf> {
    if key.len() != 64 || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(cache_dir()?.join(format!("{key}.{CACHE_RECORD_EXTENSION}")))
}

fn trusted_cache_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_dir())
        .unwrap_or(false)
}

fn cache_entries(dir: &Path) -> Result<Vec<CacheEntry>, String> {
    match fs::symlink_metadata(dir) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => return Err(format!("结果缓存路径不是普通目录: {}", dir.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("无法检查结果缓存目录 {}: {error}", dir.display())),
    }

    let entries = fs::read_dir(dir)
        .map_err(|error| format!("无法读取结果缓存目录 {}: {error}", dir.display()))?;
    let mut records = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_file() || !is_record_file(&path) {
            continue;
        }
        records.push(CacheEntry {
            path,
            modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        });
    }
    Ok(records)
}

fn is_record_file(path: &Path) -> bool {
    if path.extension().and_then(|value| value.to_str()) != Some(CACHE_RECORD_EXTENSION) {
        return false;
    }
    let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    stem.len() == 64 && stem.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn prune_directory(
    dir: &Path,
    now: SystemTime,
    max_age: Duration,
    max_records: usize,
) -> Result<usize, String> {
    let mut entries = cache_entries(dir)?;
    let mut removed = 0usize;
    entries.retain(|entry| {
        let expired = record_is_expired(entry.modified, now, max_age);
        if expired && fs::remove_file(&entry.path).is_ok() {
            removed += 1;
            false
        } else {
            true
        }
    });

    entries.sort_by_key(|entry| entry.modified);
    let excess = entries.len().saturating_sub(max_records);
    for entry in entries.into_iter().take(excess) {
        if fs::remove_file(entry.path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

fn clear_directory(dir: &Path) -> Result<usize, String> {
    let entries = cache_entries(dir)?;
    let mut removed = 0usize;
    for entry in entries {
        fs::remove_file(&entry.path)
            .map_err(|error| format!("无法删除结果缓存记录 {}: {error}", entry.path.display()))?;
        removed += 1;
    }
    Ok(removed)
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

fn cache_dir() -> Option<PathBuf> {
    platform_cache_dir()
}

#[cfg(target_os = "windows")]
fn platform_cache_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|base| base.join("ImgConvert").join("Cache").join("results"))
}

#[cfg(target_os = "macos")]
fn platform_cache_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).map(|home| {
        home.join("Library")
            .join("Caches")
            .join("ImgConvert")
            .join("results")
    })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_cache_dir() -> Option<PathBuf> {
    if let Some(cache_home) = std::env::var_os("XDG_CACHE_HOME") {
        return Some(PathBuf::from(cache_home).join("imgconvert").join("results"));
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".cache").join("imgconvert").join("results"))
}

#[cfg(not(any(unix, target_os = "windows")))]
fn platform_cache_dir() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "imgconvert-result-cache-{label}-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn record_name(index: usize) -> String {
        format!("{index:064x}.txt")
    }

    #[test]
    fn record_parser_rejects_malformed_data() {
        let valid_hash = "a".repeat(64);
        let workflow = CachedWorkflowStatus {
            width: 320,
            height: 200,
            selected_quality: Some(82),
            target_size_met: Some(false),
            color_profile_converted_for_resize: true,
            invalid_color_profile_discarded: false,
        };
        let valid = format!("v3\n{valid_hash}\n42\n320\n200\n82\n0\n1\n0\n");
        assert_eq!(
            parse_record(&valid),
            Some(ResultCacheRecord {
                output_hash: valid_hash,
                output_size: 42,
                workflow,
            })
        );
        assert!(parse_record("v0\nabc\n42\n").is_none());
        assert!(parse_record("v3\nnot-hex\n42\n1\n1\n-\n-\n0\n0\n").is_none());
        assert!(parse_record("v3\nabc\nsize\n1\n1\n-\n-\n0\n0\n").is_none());
        assert!(parse_record(&format!("v3\n{}\n42\n1\n1\n0\n-\n0\n0\n", "a".repeat(64))).is_none());
        assert!(parse_record(&format!("v3\n{}\n42\n1\n1\n-\n1\n0\n0\n", "a".repeat(64))).is_none());
        assert!(parse_record(&format!("v3\n{}\n42\n1\n1\n-\n-\n1\n1\n", "a".repeat(64))).is_none());
        assert!(parse_record(&format!("v3\n{}\n42\n0\n1\n-\n-\n0\n0\n", "a".repeat(64))).is_none());
    }

    #[test]
    fn hash_file_reports_size_and_hash() {
        let dir = test_dir("hash-file");
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
    fn cache_record_expiry_is_checked_at_lookup_time() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(100_000);
        assert!(!record_is_expired(
            now - MAX_CACHE_RECORD_AGE,
            now,
            MAX_CACHE_RECORD_AGE
        ));
        assert!(record_is_expired(
            now - MAX_CACHE_RECORD_AGE - Duration::from_secs(1),
            now,
            MAX_CACHE_RECORD_AGE
        ));
        assert!(!record_is_expired(
            now + Duration::from_secs(1),
            now,
            MAX_CACHE_RECORD_AGE
        ));
    }

    #[test]
    fn cache_record_reader_rejects_oversized_files() {
        let dir = test_dir("oversized-read");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(record_name(1));
        fs::write(&path, vec![b'x'; MAX_CACHE_RECORD_BYTES + 1]).unwrap();

        assert!(read_record_file(&path, SystemTime::now()).is_none());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn record_writer_replaces_only_regular_files() {
        let dir = test_dir("safe-write");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(record_name(1));
        fs::write(&path, "old").unwrap();

        assert!(write_record_file(&path, "new"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn record_writer_does_not_follow_symlinks() {
        use std::os::unix::fs::symlink;

        let dir = test_dir("symlink-write");
        fs::create_dir_all(&dir).unwrap();
        let victim = dir.join("victim");
        let path = dir.join(record_name(1));
        fs::write(&victim, "keep").unwrap();
        symlink(&victim, &path).unwrap();

        assert!(!write_record_file(&path, "clobber"));
        assert_eq!(fs::read_to_string(&victim).unwrap(), "keep");
        assert!(fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn prune_enforces_age_and_count_without_deleting_unrelated_files() {
        let dir = test_dir("prune");
        fs::create_dir_all(&dir).unwrap();
        for index in 0..4 {
            fs::write(dir.join(record_name(index)), "v1\n").unwrap();
        }
        fs::write(dir.join("keep.me"), "unrelated").unwrap();

        let removed = prune_directory(&dir, SystemTime::now(), Duration::MAX, 2).unwrap();

        assert_eq!(removed, 2);
        assert!(dir.join("keep.me").exists());
        assert_eq!(cache_entries(&dir).unwrap().len(), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn clear_only_removes_valid_regular_cache_records() {
        let dir = test_dir("clear");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(record_name(1)), "v1\n").unwrap();
        fs::write(dir.join("notes.txt"), "keep").unwrap();
        let removed = clear_directory(&dir).unwrap();
        assert_eq!(removed, 1);
        assert!(dir.join("notes.txt").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
