// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! 队列缩略图生成。
//!
//! 前端只传用户已显式导入的本机路径；这里读取文件并调用 core 生成小 PNG。

use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::external_codecs;

const DEFAULT_THUMBNAIL_EDGE: u32 = 180;
const MIN_THUMBNAIL_EDGE: u32 = 32;
const MAX_THUMBNAIL_EDGE: u32 = 512;
const MAX_THUMBNAIL_SOURCE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailOptions {
    pub input: String,
    pub max_edge: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResult {
    pub input: String,
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}

pub fn generate_thumbnail(options: ThumbnailOptions) -> Result<Option<ThumbnailResult>, String> {
    let input = Path::new(&options.input);
    let metadata = fs::metadata(input).map_err(|e| format!("无法读取输入文件信息: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("输入路径不是文件: {}", options.input));
    }
    if metadata.len() > MAX_THUMBNAIL_SOURCE_BYTES {
        return Ok(None);
    }

    let source = if external_codecs::is_heic_path(input) {
        external_codecs::decode_heic_to_png(input)?
    } else {
        let Some(bytes) = read_limited_thumbnail_source(input)? else {
            return Ok(None);
        };
        bytes
    };
    let max_edge = options
        .max_edge
        .unwrap_or(DEFAULT_THUMBNAIL_EDGE)
        .clamp(MIN_THUMBNAIL_EDGE, MAX_THUMBNAIL_EDGE);
    let Some(thumbnail) =
        imgconvert_core::thumbnail(&source, max_edge).map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };

    Ok(Some(ThumbnailResult {
        input: options.input,
        mime: "image/png",
        width: thumbnail.width,
        height: thumbnail.height,
        bytes: thumbnail.png,
    }))
}

/// The metadata preflight above handles ordinary files; this second cap closes
/// the race where a selected file grows between that check and the read.
fn read_limited_thumbnail_source(input: &Path) -> Result<Option<Vec<u8>>, String> {
    let file = File::open(input).map_err(|error| format!("无法读取输入文件: {error}"))?;
    let mut reader = file.take(MAX_THUMBNAIL_SOURCE_BYTES.saturating_add(1));
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取输入文件: {error}"))?;
    if bytes.len() as u64 > MAX_THUMBNAIL_SOURCE_BYTES {
        return Ok(None);
    }
    Ok(Some(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_test_dir(name: &str) -> std::path::PathBuf {
        let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "imgconvert-thumbnail-{name}-{}-{counter}",
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

    fn one_by_one_png(rgba: [u8; 4]) -> Vec<u8> {
        let scanline = [0, rgba[0], rgba[1], rgba[2], rgba[3]];
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

    #[test]
    fn thumbnail_command_returns_png_bytes() {
        let dir = unique_test_dir("opaque");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("sample.png");
        fs::write(&input, one_by_one_png([255, 255, 255, 255])).unwrap();

        let result = generate_thumbnail(ThumbnailOptions {
            input: input.to_string_lossy().to_string(),
            max_edge: Some(180),
        })
        .unwrap()
        .unwrap();

        assert_eq!(result.mime, "image/png");
        assert_eq!((result.width, result.height), (1, 1));
        assert!(result.bytes.starts_with(&[0x89, b'P', b'N', b'G']));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn thumbnail_command_skips_fully_transparent_images() {
        let dir = unique_test_dir("transparent");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("transparent.png");
        fs::write(&input, one_by_one_png([255, 255, 255, 0])).unwrap();

        let result = generate_thumbnail(ThumbnailOptions {
            input: input.to_string_lossy().to_string(),
            max_edge: None,
        })
        .unwrap();

        assert!(result.is_none());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn thumbnail_command_skips_oversized_source_files_before_reading() {
        let dir = unique_test_dir("oversized");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("huge.png");
        fs::File::create(&input)
            .unwrap()
            .set_len(MAX_THUMBNAIL_SOURCE_BYTES + 1)
            .unwrap();

        let result = generate_thumbnail(ThumbnailOptions {
            input: input.to_string_lossy().to_string(),
            max_edge: None,
        })
        .unwrap();

        assert!(result.is_none());
        assert!(read_limited_thumbnail_source(&input).unwrap().is_none());

        fs::remove_dir_all(dir).unwrap();
    }
}
