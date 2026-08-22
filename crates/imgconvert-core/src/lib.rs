// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 The ImgConvert Authors

//! ImgConvert 进程内编解码核心。
//!
//! 设计(参考 slimg,MIT):统一中间表示 `ImageData`(`PixelBuffer`)+ `Codec` trait +
//! `Format` 检测 + 顶层 `convert` 管线。P0.5 已跑通 **JPEG / PNG / WebP / AVIF**。
//! HEIC(系统原生)、更深层的色彩/元数据语义处理为后续尖刺/阶段。
//!
//! 色彩管线:v2 支持 RGBA8/RGBA16/RGBAF32 中间表示、LittleCMS ICC→sRGB 转换、
//! 线性空间 resize 和 PNG16 保真。JPEG/WebP/AVIF 落盘仍是 RGBA8 SDR。

use std::borrow::Cow;
use std::fmt;
use std::io::{Cursor, Read, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::{Duration, Instant};

use flate2::{read::ZlibDecoder, write::ZlibEncoder, Compression};
use image::ImageDecoder;
use lcms2::{Flags, Intent, PixelFormat, Profile, Transform};
use md5::{Digest as Md5Digest, Md5};
use ssimulacra2::{compute_frame_ssimulacra2, ColorPrimaries, Rgb, TransferCharacteristic, Xyb};

/// 像素数上限(防超大分配 / C 层 OOM;~100MP,可后续配置)。
pub const MAX_PIXELS: usize = 100_000_000;

/// 单个原始 metadata blob 上限。与 HEIC helper sidecar 上限保持一致,防容器 metadata 炸弹。
pub const MAX_METADATA_BLOB_BYTES: usize = 16 * 1024 * 1024;

/// JPEG 不支持 alpha:透明像素合成到此背景色(P0.5 固定白底,背景色 P2 再配置)。
const JPEG_FLATTEN_BG: [u8; 3] = [255, 255, 255];

/// AVIF 编码器内部线程上限。文件级并发由 Tauri 层控制,避免两层并发叠加。
pub const AVIF_ENCODER_MAX_THREADS: i32 = 1;

/// 当前 AVIF 后端是否已验证像素级真无损。
pub const AVIF_LOSSLESS_SUPPORTED: bool = true;

/// 自动质量每次搜索的质量间隔。最终高位质量始终会被纳入候选。
pub const AUTO_QUALITY_STEP: u8 = 4;

/// 自动质量最坏情况下的 SSIMULACRA2 评分次数:JPEG 最多 6 次,WebP 额外比较一次 lossless。
pub const AUTO_QUALITY_MAX_SCORING_EVALUATIONS: usize = 7;

const JPEG_GRID_ARTIFACT_MIN_DIMENSION: u32 = 32;
const JPEG_GRID_ARTIFACT_MIN_BOUNDARY_DELTA: f64 = 2.0;
const JPEG_GRID_ARTIFACT_SCORE_THRESHOLD: f64 = 1.6;
const JPEG_CHROMA_GRID_ARTIFACT_MIN_BOUNDARY_DELTA: f64 = 6.0;
const JPEG_CHROMA_GRID_ARTIFACT_SCORE_THRESHOLD: f64 = 1.6;
const WEBP_BLOCK_ARTIFACT_MIN_DIMENSION: u32 = 32;
const WEBP_BLOCK_ARTIFACT_MIN_BOUNDARY_DELTA: f64 = 8.0;
const WEBP_BLOCK_ARTIFACT_SCORE_THRESHOLD: f64 = 1.5;
const ICC_TRANSFORM_CHUNK_PIXELS: usize = 65_536;

/// 校验尺寸并返回像素数(checked,拒绝 0 / 溢出 / 超上限)。
fn pixel_count(width: u32, height: u32) -> Result<usize> {
    if width == 0 || height == 0 {
        return Err(Error::Invalid("尺寸不能为 0".into()));
    }
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or_else(|| Error::Invalid("width*height 溢出".into()))?;
    if pixels > MAX_PIXELS {
        return Err(Error::Unsupported(format!(
            "像素数 {pixels} 超过上限 {MAX_PIXELS}"
        )));
    }
    Ok(pixels)
}

/// 校验尺寸并返回期望的 RGBA 采样数(checked,拒绝 0 / 溢出 / 超上限)。
fn rgba_sample_len(width: u32, height: u32) -> Result<usize> {
    pixel_count(width, height)?
        .checked_mul(4)
        .ok_or_else(|| Error::Invalid("RGBA 缓冲长度溢出".into()))
}

/// 校验尺寸并返回期望的 RGBA8 字节数(checked,拒绝 0 / 溢出 / 超上限)。
fn rgba_byte_len(width: u32, height: u32) -> Result<usize> {
    rgba_sample_len(width, height)
}

/// 像素采样类型。PNG 可保留 RGBA16;JPEG/WebP/AVIF 编码入口仍会显式降到 RGBA8。
#[derive(Debug, Clone, PartialEq)]
pub enum PixelBuffer {
    Rgba8(Vec<u8>),
    Rgba16(Vec<u16>),
    RgbaF32(Vec<f32>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelEncoding {
    Rgba8,
    Rgba16,
    RgbaF32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorManagementPolicy {
    /// 保留 ICC blob,不做像素变换。当前 v1/v2 兼容路径。
    PreserveEmbeddedProfile,
    /// 使用嵌入 ICC 做像素级 sRGB 转换;转换后会移除源 ICC,避免 stale profile。
    ConvertToSrgb,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColorPipelineCapabilities {
    pub rgba8: bool,
    pub rgba16: bool,
    pub rgba_f32: bool,
    pub linear_resize: bool,
    pub icc_transform: bool,
}

impl PixelBuffer {
    pub fn encoding(&self) -> PixelEncoding {
        match self {
            PixelBuffer::Rgba8(_) => PixelEncoding::Rgba8,
            PixelBuffer::Rgba16(_) => PixelEncoding::Rgba16,
            PixelBuffer::RgbaF32(_) => PixelEncoding::RgbaF32,
        }
    }

    fn sample_len(&self) -> usize {
        match self {
            PixelBuffer::Rgba8(samples) => samples.len(),
            PixelBuffer::Rgba16(samples) => samples.len(),
            PixelBuffer::RgbaF32(samples) => samples.len(),
        }
    }

    fn validate_dimensions(&self, width: u32, height: u32) -> Result<()> {
        let expected = rgba_sample_len(width, height)?;
        if self.sample_len() != expected {
            return Err(Error::Invalid(format!(
                "{:?} 长度 {} != 期望 {expected}（{width}x{height}）",
                self.encoding(),
                self.sample_len()
            )));
        }
        Ok(())
    }

    pub fn as_rgba8(&self) -> Option<&[u8]> {
        match self {
            PixelBuffer::Rgba8(samples) => Some(samples),
            PixelBuffer::Rgba16(_) | PixelBuffer::RgbaF32(_) => None,
        }
    }

    pub fn as_rgba8_mut(&mut self) -> Option<&mut [u8]> {
        match self {
            PixelBuffer::Rgba8(samples) => Some(samples),
            PixelBuffer::Rgba16(_) | PixelBuffer::RgbaF32(_) => None,
        }
    }

    pub fn as_rgba16(&self) -> Option<&[u16]> {
        match self {
            PixelBuffer::Rgba16(samples) => Some(samples),
            PixelBuffer::Rgba8(_) | PixelBuffer::RgbaF32(_) => None,
        }
    }

    pub fn as_rgba_f32(&self) -> Option<&[f32]> {
        match self {
            PixelBuffer::RgbaF32(samples) => Some(samples),
            PixelBuffer::Rgba8(_) | PixelBuffer::Rgba16(_) => None,
        }
    }

    pub fn to_rgba8(&self) -> Vec<u8> {
        match self {
            PixelBuffer::Rgba8(samples) => samples.clone(),
            PixelBuffer::Rgba16(samples) => {
                samples.iter().map(|sample| (sample >> 8) as u8).collect()
            }
            PixelBuffer::RgbaF32(samples) => samples
                .iter()
                .map(|sample| (sanitize_unit_f32(*sample) * 255.0).round() as u8)
                .collect(),
        }
    }

    pub fn to_rgba16(&self) -> Vec<u16> {
        match self {
            PixelBuffer::Rgba8(samples) => samples
                .iter()
                .map(|sample| u16::from(*sample) * 257)
                .collect(),
            PixelBuffer::Rgba16(samples) => samples.clone(),
            PixelBuffer::RgbaF32(samples) => samples
                .iter()
                .map(|sample| (sanitize_unit_f32(*sample) * 65_535.0).round() as u16)
                .collect(),
        }
    }

    pub fn to_rgba_f32(&self) -> Vec<f32> {
        match self {
            PixelBuffer::Rgba8(samples) => samples
                .iter()
                .map(|sample| f32::from(*sample) / 255.0)
                .collect(),
            PixelBuffer::Rgba16(samples) => samples
                .iter()
                .map(|sample| f32::from(*sample) / 65_535.0)
                .collect(),
            PixelBuffer::RgbaF32(samples) => samples
                .iter()
                .map(|sample| sanitize_unit_f32(*sample))
                .collect(),
        }
    }
}

pub fn color_pipeline_capabilities() -> ColorPipelineCapabilities {
    ColorPipelineCapabilities {
        rgba8: true,
        rgba16: true,
        rgba_f32: true,
        linear_resize: true,
        icc_transform: true,
    }
}

pub fn apply_color_management_policy(
    img: &ImageData,
    policy: ColorManagementPolicy,
) -> Result<ImageData> {
    match policy {
        ColorManagementPolicy::PreserveEmbeddedProfile => Ok(img.clone()),
        ColorManagementPolicy::ConvertToSrgb => convert_image_to_srgb(img),
    }
}

fn sanitize_unit_f32(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

fn convert_image_to_srgb(img: &ImageData) -> Result<ImageData> {
    let Some(icc) = img.icc.as_deref().filter(|icc| !icc.is_empty()) else {
        return Ok(img.clone());
    };
    img.validate()?;

    let source = Profile::new_icc(icc)
        .map_err(|e| Error::Unsupported(format!("ICC profile 无法解析: {e}")))?;
    let srgb = Profile::new_srgb();
    let pixels = match &img.pixels {
        PixelBuffer::Rgba8(samples) => {
            PixelBuffer::Rgba8(transform_rgba8_to_srgb(samples, &source, &srgb)?)
        }
        PixelBuffer::Rgba16(samples) => {
            PixelBuffer::Rgba16(transform_rgba16_to_srgb(samples, &source, &srgb)?)
        }
        PixelBuffer::RgbaF32(samples) => {
            PixelBuffer::RgbaF32(transform_rgba_f32_to_srgb(samples, &source, &srgb)?)
        }
    };

    Ok(ImageData {
        width: img.width,
        height: img.height,
        pixels,
        // Pixels are now in sRGB. Dropping the source profile avoids embedding a stale ICC.
        icc: None,
        exif: img.exif.clone(),
        xmp: img.xmp.clone(),
        iptc: img.iptc.clone(),
    })
}

fn transform_rgba8_to_srgb(samples: &[u8], source: &Profile, srgb: &Profile) -> Result<Vec<u8>> {
    let transform = Transform::<u8, u8>::new_flags(
        source,
        PixelFormat::RGBA_8,
        srgb,
        PixelFormat::RGBA_8,
        Intent::Perceptual,
        Flags::COPY_ALPHA,
    )
    .map_err(|e| Error::Unsupported(format!("ICC RGBA8→sRGB transform 初始化失败: {e}")))?;
    let mut out = vec![0u8; samples.len()];
    transform.transform_pixels(samples, &mut out);
    Ok(out)
}

fn transform_rgba16_to_srgb(samples: &[u16], source: &Profile, srgb: &Profile) -> Result<Vec<u16>> {
    let transform = Transform::<[u16; 4], [u16; 4]>::new_flags(
        source,
        PixelFormat::RGBA_16,
        srgb,
        PixelFormat::RGBA_16,
        Intent::Perceptual,
        Flags::COPY_ALPHA,
    )
    .map_err(|e| Error::Unsupported(format!("ICC RGBA16→sRGB transform 初始化失败: {e}")))?;
    if !samples.len().is_multiple_of(4) {
        return Err(Error::Invalid("RGBA16 缓冲长度不是 4 的倍数".into()));
    }
    let mut out = vec![0u16; samples.len()];
    let chunk_samples = ICC_TRANSFORM_CHUNK_PIXELS * 4;
    for (src_chunk, dst_chunk) in samples
        .chunks(chunk_samples)
        .zip(out.chunks_mut(chunk_samples))
    {
        let pixels = rgba16_pixels(src_chunk)?;
        let mut out_pixels = vec![[0u16; 4]; pixels.len()];
        transform.transform_pixels(&pixels, &mut out_pixels);
        for (dst, pixel) in dst_chunk.chunks_exact_mut(4).zip(out_pixels) {
            dst.copy_from_slice(&pixel);
        }
    }
    Ok(out)
}

fn transform_rgba_f32_to_srgb(
    samples: &[f32],
    source: &Profile,
    srgb: &Profile,
) -> Result<Vec<f32>> {
    let transform = Transform::<[f32; 4], [f32; 4]>::new_flags(
        source,
        PixelFormat::RGBA_FLT,
        srgb,
        PixelFormat::RGBA_FLT,
        Intent::Perceptual,
        Flags::COPY_ALPHA,
    )
    .map_err(|e| Error::Unsupported(format!("ICC RGBAF32→sRGB transform 初始化失败: {e}")))?;
    if !samples.len().is_multiple_of(4) {
        return Err(Error::Invalid("RGBAF32 缓冲长度不是 4 的倍数".into()));
    }
    let mut out = vec![0.0f32; samples.len()];
    let chunk_samples = ICC_TRANSFORM_CHUNK_PIXELS * 4;
    for (src_chunk, dst_chunk) in samples
        .chunks(chunk_samples)
        .zip(out.chunks_mut(chunk_samples))
    {
        let pixels = rgba_f32_pixels(src_chunk)?;
        let mut out_pixels = vec![[0.0f32; 4]; pixels.len()];
        transform.transform_pixels(&pixels, &mut out_pixels);
        for (dst, pixel) in dst_chunk.chunks_exact_mut(4).zip(out_pixels) {
            for (dst_sample, sample) in dst.iter_mut().zip(pixel) {
                *dst_sample = sanitize_unit_f32(sample);
            }
        }
    }
    Ok(out)
}

fn rgba16_pixels(samples: &[u16]) -> Result<Vec<[u16; 4]>> {
    if !samples.len().is_multiple_of(4) {
        return Err(Error::Invalid("RGBA16 缓冲长度不是 4 的倍数".into()));
    }
    Ok(samples
        .chunks_exact(4)
        .map(|pixel| [pixel[0], pixel[1], pixel[2], pixel[3]])
        .collect())
}

fn rgba_f32_pixels(samples: &[f32]) -> Result<Vec<[f32; 4]>> {
    if !samples.len().is_multiple_of(4) {
        return Err(Error::Invalid("RGBAF32 缓冲长度不是 4 的倍数".into()));
    }
    Ok(samples
        .chunks_exact(4)
        .map(|pixel| {
            [
                sanitize_unit_f32(pixel[0]),
                sanitize_unit_f32(pixel[1]),
                sanitize_unit_f32(pixel[2]),
                sanitize_unit_f32(pixel[3]),
            ]
        })
        .collect())
}

/// Raw container metadata, normalized to codec-independent payloads.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct RawMetadata {
    pub icc: Option<Vec<u8>>,
    /// EXIF TIFF payload, without JPEG `Exif\0\0` prefix.
    pub exif: Option<Vec<u8>>,
    /// Raw XMP packet bytes, without container-specific wrappers.
    pub xmp: Option<Vec<u8>>,
    /// Raw IPTC IIM payload. Currently written natively only into JPEG APP13 Photoshop IRB.
    pub iptc: Option<Vec<u8>>,
}

impl RawMetadata {
    pub fn is_empty(&self) -> bool {
        self.icc.as_ref().is_none_or(Vec::is_empty)
            && self.exif.as_ref().is_none_or(Vec::is_empty)
            && self.xmp.as_ref().is_none_or(Vec::is_empty)
            && self.iptc.as_ref().is_none_or(Vec::is_empty)
    }

    pub fn normalized_orientation(mut self) -> Self {
        if let Some(exif) = self.exif.take() {
            self.exif = Some(normalize_exif_orientation(exif));
        }
        if let Some(xmp) = self.xmp.take() {
            self.xmp = Some(normalize_xmp_orientation(xmp));
        }
        self
    }

    pub fn normalized_semantics(self) -> Self {
        self.normalized_orientation()
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct MetadataSemanticReport {
    pub exif_orientation: Option<u16>,
    pub exif_makernote: Option<ExifMakerNoteSummary>,
    pub iptc_datasets: Vec<IptcDatasetSummary>,
    pub xmp_has_orientation: bool,
    pub xmp_has_edit_history: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExifMakerNoteSummary {
    pub offset: usize,
    pub byte_len: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IptcDatasetSummary {
    pub record: u8,
    pub dataset: u8,
    pub name: Option<&'static str>,
    pub value_len: usize,
}

pub fn inspect_metadata_semantics(metadata: &RawMetadata) -> MetadataSemanticReport {
    let exif = metadata.exif.as_deref().and_then(inspect_exif_semantics);
    let xmp = metadata
        .xmp
        .as_deref()
        .and_then(|bytes| std::str::from_utf8(bytes).ok());
    MetadataSemanticReport {
        exif_orientation: exif.as_ref().and_then(|report| report.orientation),
        exif_makernote: exif.and_then(|report| report.makernote),
        iptc_datasets: metadata
            .iptc
            .as_deref()
            .map(parse_iptc_datasets)
            .unwrap_or_default(),
        xmp_has_orientation: xmp.is_some_and(xmp_contains_orientation_semantics),
        xmp_has_edit_history: xmp.is_some_and(xmp_contains_edit_history_semantics),
    }
}

pub fn normalize_metadata_semantics(metadata: RawMetadata) -> RawMetadata {
    metadata.normalized_semantics()
}

/// 统一中间像素表示:RGBA,行优先,长度 = width*height*4。
#[derive(Debug, Clone, PartialEq)]
pub struct ImageData {
    pub width: u32,
    pub height: u32,
    pub pixels: PixelBuffer,
    /// ICC profile bytes, without container-specific wrappers.
    pub icc: Option<Vec<u8>>,
    /// EXIF TIFF payload, without JPEG `Exif\0\0` prefix.
    pub exif: Option<Vec<u8>>,
    /// Raw XMP packet bytes, without container-specific wrappers.
    pub xmp: Option<Vec<u8>>,
    /// Raw IPTC IIM payload. Containers without native IPTC support preserve this in memory only.
    pub iptc: Option<Vec<u8>>,
}

impl ImageData {
    /// 校验后构造 RGBA8 图片(兼容现有解码器和测试)。
    pub fn new(width: u32, height: u32, rgba: Vec<u8>) -> Result<Self> {
        Self::from_pixels(width, height, PixelBuffer::Rgba8(rgba))
    }

    pub fn from_pixels(width: u32, height: u32, pixels: PixelBuffer) -> Result<Self> {
        pixels.validate_dimensions(width, height)?;
        Ok(Self {
            width,
            height,
            pixels,
            icc: None,
            exif: None,
            xmp: None,
            iptc: None,
        })
    }

    /// 校验当前不变量(编码入口在跨 C 边界前调用,防 panic/越界)。
    pub fn validate(&self) -> Result<()> {
        self.pixels.validate_dimensions(self.width, self.height)
    }

    pub fn pixel_encoding(&self) -> PixelEncoding {
        self.pixels.encoding()
    }

    pub fn rgba8(&self) -> Result<&[u8]> {
        self.pixels
            .as_rgba8()
            .ok_or_else(|| Error::Unsupported("该编码器当前只接受 RGBA8 输入".into()))
    }

    pub fn rgba8_mut(&mut self) -> Result<&mut [u8]> {
        self.pixels
            .as_rgba8_mut()
            .ok_or_else(|| Error::Unsupported("该操作当前只支持 RGBA8 输入".into()))
    }

    fn rgba8_cow(&self) -> Cow<'_, [u8]> {
        match self.pixels.as_rgba8() {
            Some(rgba) => Cow::Borrowed(rgba),
            None => Cow::Owned(self.pixels.to_rgba8()),
        }
    }

    pub fn raw_metadata(&self) -> RawMetadata {
        RawMetadata {
            icc: self.icc.clone(),
            exif: self.exif.clone(),
            xmp: self.xmp.clone(),
            iptc: self.iptc.clone(),
        }
    }

    pub fn apply_metadata_override(&mut self, metadata: &RawMetadata) {
        let metadata = metadata.clone().normalized_orientation();
        if metadata.icc.is_some() {
            self.icc = metadata.icc;
        }
        if metadata.exif.is_some() {
            self.exif = metadata.exif;
        }
        if metadata.xmp.is_some() {
            self.xmp = metadata.xmp;
        }
        if metadata.iptc.is_some() {
            self.iptc = metadata.iptc;
        }
    }

    /// 把 RGBA 合成到不透明背景,产出 RGB(供 JPEG 等无 alpha 格式使用)。
    fn flatten_to_rgb(&self, bg: [u8; 3]) -> Vec<u8> {
        let mut rgb = Vec::with_capacity(self.width as usize * self.height as usize * 3);
        let rgba = self.rgba8_cow();
        for px in rgba.chunks_exact(4) {
            let a = px[3] as u32;
            let inv = 255 - a;
            for c in 0..3 {
                // out = src*a/255 + bg*(255-a)/255,整数运算
                rgb.push(((px[c] as u32 * a + bg[c] as u32 * inv) / 255) as u8);
            }
        }
        rgb
    }
}

/// 不解码像素的图片头部探测结果。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImageProbe {
    pub format: Format,
    pub width: u32,
    pub height: u32,
    pub dpi: Option<Dpi>,
}

/// 图片声明的物理分辨率。并非所有容器都会提供该信息。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Dpi {
    pub x: f64,
    pub y: f64,
}

/// 缩略图编码结果。当前统一输出 PNG,便于前端以 Blob URL 直接显示。
#[derive(Debug, Clone, PartialEq)]
pub struct Thumbnail {
    pub width: u32,
    pub height: u32,
    pub png: Vec<u8>,
}

/// 支持的格式(P0.5 范围)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Jpeg,
    Png,
    WebP,
    Avif,
}

/// 进程内 core 当前可读格式。
pub const READABLE_FORMATS: &[Format] = &[Format::Jpeg, Format::Png, Format::WebP, Format::Avif];

/// 进程内 core 当前可写格式。
pub const WRITABLE_FORMATS: &[Format] = &[Format::Jpeg, Format::Png, Format::WebP, Format::Avif];

/// 支持真无损编码选项的格式(JPEG 当前实现不声明无损)。
pub const LOSSLESS_FORMATS: &[Format] = &[Format::Png, Format::WebP, Format::Avif];

impl Format {
    /// 稳定的前后端格式 id。
    pub const fn id(self) -> &'static str {
        match self {
            Format::Jpeg => "jpeg",
            Format::Png => "png",
            Format::WebP => "webp",
            Format::Avif => "avif",
        }
    }

    /// 默认输出文件扩展名。
    pub const fn default_extension(self) -> &'static str {
        match self {
            Format::Jpeg => "jpg",
            Format::Png => "png",
            Format::WebP => "webp",
            Format::Avif => "avif",
        }
    }

    /// 当前 encoder 是否支持无损选项。
    pub const fn supports_lossless(self) -> bool {
        matches!(self, Format::Png | Format::WebP | Format::Avif)
    }

    /// 按 magic bytes 检测(优先于扩展名)。
    pub fn from_magic(bytes: &[u8]) -> Option<Format> {
        if bytes.len() >= 3 && bytes[0..3] == [0xFF, 0xD8, 0xFF] {
            return Some(Format::Jpeg);
        }
        if bytes.len() >= 8 && bytes[0..8] == [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1A, b'\n'] {
            return Some(Format::Png);
        }
        // RIFF....WEBP + 首个 chunk FourCC(VP8 / VP8L / VP8X),避免误判普通 RIFF。
        if bytes.len() >= 16
            && &bytes[0..4] == b"RIFF"
            && &bytes[8..12] == b"WEBP"
            && matches!(&bytes[12..16], b"VP8 " | b"VP8L" | b"VP8X")
        {
            return Some(Format::WebP);
        }
        // AVIF:ISO-BMFF `ftyp` box,品牌列表含 avif/avis。
        if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
            let end = bytes.len().min(32);
            if bytes[8..end]
                .windows(4)
                .any(|w| w == b"avif" || w == b"avis")
            {
                return Some(Format::Avif);
            }
        }
        None
    }

    /// 按扩展名检测(magic 失败时的回退)。
    pub fn from_ext(ext: &str) -> Option<Format> {
        match ext.to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" => Some(Format::Jpeg),
            "png" => Some(Format::Png),
            "webp" => Some(Format::WebP),
            "avif" => Some(Format::Avif),
            _ => None,
        }
    }
}

/// 编码参数。
#[derive(Debug, Clone, Copy)]
pub struct EncodeOptions {
    /// 质量 1..=100(有损格式有效)。
    pub quality: u8,
    /// 真无损(对 WebP/AVIF 生效;PNG 恒无损;JPEG 当前忽略)。
    pub lossless: bool,
    /// JPEG 是否使用 progressive scan。
    pub jpeg_progressive: bool,
    /// oxipng 优化级别 0..=6。
    pub png_oxipng_level: u8,
    /// 实验性 PNG 有损限色。默认关闭。
    pub png_lossy_quantize: bool,
    /// PNG 限色颜色数 64..=256。
    pub png_quant_colors: u16,
    /// WebP method 0..=6。
    pub webp_method: u8,
    /// AVIF speed 0..=10(越大越快)。
    pub avif_speed: u8,
    /// AVIF 色度采样。默认 4:4:4 保持当前保真语义。
    pub avif_subsample: AvifSubsample,
    /// WebP near-lossless 0..=100。100 表示关闭;仅在无损模式生效。
    pub webp_near_lossless: u8,
    /// WebP 使用更慢但更锐利的 RGB→YUV 转换。
    pub webp_sharp_yuv: bool,
    /// MozJPEG trellis 是否把 progressive scans 纳入考虑。
    pub jpeg_trellis: bool,
    /// 是否保留 ICC/EXIF 等容器元数据。
    pub preserve_metadata: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AvifSubsample {
    Yuv444,
    Yuv420,
}

/// 自动质量搜索参数。
#[derive(Debug, Clone, Copy)]
pub struct AutoQualityOptions {
    /// 搜索最低质量。调用侧应传入全局/格式质量下限；内部会 clamp 到 1..=100。
    pub min_quality: u8,
    /// SSIMULACRA2 目标分。越高越接近源图。
    pub target_score: f64,
}

impl Default for AutoQualityOptions {
    fn default() -> Self {
        Self {
            min_quality: 30,
            target_score: 80.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AutoQualityResult {
    pub bytes: Vec<u8>,
    pub quality: u8,
    pub score: Option<f64>,
    pub used_lossless: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvifLosslessProbe {
    pub supported: bool,
    pub roundtrip_exact: bool,
    pub max_channel_abs_diff: u8,
    pub cases: Vec<AvifLosslessProbeCase>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvifLosslessProbeCase {
    pub name: &'static str,
    pub requested_subsample: AvifSubsample,
    pub has_alpha: bool,
    pub roundtrip_exact: bool,
    pub max_channel_abs_diff: u8,
    pub encoded_bytes: usize,
}

/// 对无损容器里疑似有损来源痕迹的轻量提示。当前检测 PNG 中的 JPEG 8x8 亮度/色度网格
/// 与 WebP-like 4x4 块边界。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LossyArtifactHint {
    pub format: Format,
    pub jpeg_grid_score: f64,
    pub jpeg_chroma_grid_score: f64,
    pub webp_block_score: f64,
}

impl Default for EncodeOptions {
    fn default() -> Self {
        Self {
            quality: 80,
            lossless: false,
            jpeg_progressive: true,
            png_oxipng_level: 4,
            png_lossy_quantize: false,
            png_quant_colors: 256,
            webp_method: 4,
            avif_speed: 8,
            avif_subsample: AvifSubsample::Yuv444,
            webp_near_lossless: 100,
            webp_sharp_yuv: false,
            jpeg_trellis: true,
            preserve_metadata: false,
        }
    }
}

impl EncodeOptions {
    fn quality_clamped(&self) -> f32 {
        self.quality.clamp(1, 100) as f32
    }

    fn png_oxipng_level_clamped(&self) -> u8 {
        self.png_oxipng_level.min(6)
    }

    fn png_quant_colors_clamped(&self) -> usize {
        usize::from(self.png_quant_colors.clamp(64, 256))
    }

    fn webp_method_clamped(&self) -> i32 {
        self.webp_method.min(6) as i32
    }

    fn avif_speed_clamped(&self) -> i32 {
        self.avif_speed.min(10) as i32
    }

    fn webp_near_lossless_clamped(&self) -> i32 {
        self.webp_near_lossless.min(100) as i32
    }

    fn avif_pixel_format(&self) -> avif::avifPixelFormat {
        match self.avif_subsample {
            AvifSubsample::Yuv444 => avif::AVIF_PIXEL_FORMAT_YUV444,
            AvifSubsample::Yuv420 => avif::AVIF_PIXEL_FORMAT_YUV420,
        }
    }
}

/// 核心错误。
#[derive(Debug)]
pub enum Error {
    Decode(String),
    Encode(String),
    Timeout(String),
    /// 输入不变量错误(尺寸/长度/溢出)。
    Invalid(String),
    Unsupported(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Decode(m) => write!(f, "解码失败: {m}"),
            Error::Encode(m) => write!(f, "编码失败: {m}"),
            Error::Timeout(m) => write!(f, "转换超时: {m}"),
            Error::Invalid(m) => write!(f, "非法输入: {m}"),
            Error::Unsupported(m) => write!(f, "不支持: {m}"),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
struct EncodeDeadline {
    started: Instant,
    timeout: Duration,
}

impl EncodeDeadline {
    fn from_timeout(timeout: Duration) -> Self {
        Self {
            started: Instant::now(),
            timeout,
        }
    }

    fn check(&self, stage: &str) -> Result<()> {
        let elapsed = self.started.elapsed();
        if elapsed >= self.timeout {
            Err(Error::Timeout(format!(
                "{stage} 已超过 wall-clock 限制 {:.1}s(实际 {:.1}s)",
                self.timeout.as_secs_f64(),
                elapsed.as_secs_f64()
            )))
        } else {
            Ok(())
        }
    }
}

fn check_deadline(deadline: Option<&EncodeDeadline>, stage: &str) -> Result<()> {
    if let Some(deadline) = deadline {
        deadline.check(stage)?;
    }
    Ok(())
}

/// 编解码器接口。
pub trait Codec {
    fn decode(&self, bytes: &[u8]) -> Result<ImageData>;
    fn encode(&self, img: &ImageData, opts: &EncodeOptions) -> Result<Vec<u8>>;
}

/// 取某格式的编解码器(ZST,Box 不实际堆分配)。
pub fn codec_for(format: Format) -> Box<dyn Codec> {
    match format {
        Format::Jpeg => Box::new(JpegCodec),
        Format::Png => Box::new(PngCodec),
        Format::WebP => Box::new(WebpCodec),
        Format::Avif => Box::new(AvifCodec),
    }
}

/// 顶层管线:输入字节 →(检测)→ 解码 → 编码到目标格式。
pub fn convert(input: &[u8], target: Format, opts: &EncodeOptions) -> Result<Vec<u8>> {
    convert_best_of(input, target, &[*opts])
}

/// 顶层管线,允许调用侧为外部 helper 解码路径补充 sidecar 元数据。
pub fn convert_with_metadata(
    input: &[u8],
    target: Format,
    opts: &EncodeOptions,
    metadata_override: Option<&RawMetadata>,
) -> Result<Vec<u8>> {
    convert_best_of_with_metadata(input, target, &[*opts], metadata_override)
}

/// 顶层管线,允许调用侧显式选择色彩管理策略。
pub fn convert_with_color_policy(
    input: &[u8],
    target: Format,
    opts: &EncodeOptions,
    metadata_override: Option<&RawMetadata>,
    color_policy: ColorManagementPolicy,
) -> Result<Vec<u8>> {
    convert_best_of_with_color_policy(input, target, &[*opts], metadata_override, color_policy)
}

/// 多候选管线:输入只解码一次,然后用多个编码参数竞争,返回体积最小的候选。
pub fn convert_best_of(input: &[u8], target: Format, options: &[EncodeOptions]) -> Result<Vec<u8>> {
    convert_best_of_with_metadata(input, target, options, None)
}

pub fn convert_best_of_with_metadata(
    input: &[u8],
    target: Format,
    options: &[EncodeOptions],
    metadata_override: Option<&RawMetadata>,
) -> Result<Vec<u8>> {
    convert_best_of_with_color_policy(
        input,
        target,
        options,
        metadata_override,
        ColorManagementPolicy::PreserveEmbeddedProfile,
    )
}

pub fn convert_best_of_with_color_policy(
    input: &[u8],
    target: Format,
    options: &[EncodeOptions],
    metadata_override: Option<&RawMetadata>,
    color_policy: ColorManagementPolicy,
) -> Result<Vec<u8>> {
    convert_best_of_with_color_policy_deadline(
        input,
        target,
        options,
        metadata_override,
        color_policy,
        None,
    )
}

pub fn convert_best_of_with_color_policy_timeout(
    input: &[u8],
    target: Format,
    options: &[EncodeOptions],
    metadata_override: Option<&RawMetadata>,
    color_policy: ColorManagementPolicy,
    timeout: Duration,
) -> Result<Vec<u8>> {
    let deadline = EncodeDeadline::from_timeout(timeout);
    convert_best_of_with_color_policy_deadline(
        input,
        target,
        options,
        metadata_override,
        color_policy,
        Some(&deadline),
    )
}

fn convert_best_of_with_color_policy_deadline(
    input: &[u8],
    target: Format,
    options: &[EncodeOptions],
    metadata_override: Option<&RawMetadata>,
    color_policy: ColorManagementPolicy,
    deadline: Option<&EncodeDeadline>,
) -> Result<Vec<u8>> {
    let img = decode_for_pipeline(input, metadata_override, color_policy)?;
    check_deadline(deadline, "解码完成")?;
    encode_best_of_with_deadline(&img, target, options, deadline)
}

/// 自动质量管线:仅 JPEG/WebP。输入只解码一次,按 SSIMULACRA2 找到达目标分的最低质量。
pub fn convert_auto_quality(
    input: &[u8],
    target: Format,
    options: &[EncodeOptions],
    auto: &AutoQualityOptions,
) -> Result<AutoQualityResult> {
    convert_auto_quality_with_metadata(input, target, options, auto, None)
}

pub fn convert_auto_quality_with_metadata(
    input: &[u8],
    target: Format,
    options: &[EncodeOptions],
    auto: &AutoQualityOptions,
    metadata_override: Option<&RawMetadata>,
) -> Result<AutoQualityResult> {
    convert_auto_quality_with_color_policy(
        input,
        target,
        options,
        auto,
        metadata_override,
        ColorManagementPolicy::PreserveEmbeddedProfile,
    )
}

pub fn convert_auto_quality_with_color_policy(
    input: &[u8],
    target: Format,
    options: &[EncodeOptions],
    auto: &AutoQualityOptions,
    metadata_override: Option<&RawMetadata>,
    color_policy: ColorManagementPolicy,
) -> Result<AutoQualityResult> {
    convert_auto_quality_with_color_policy_deadline(
        input,
        target,
        options,
        auto,
        metadata_override,
        color_policy,
        None,
    )
}

pub fn convert_auto_quality_with_color_policy_timeout(
    input: &[u8],
    target: Format,
    options: &[EncodeOptions],
    auto: &AutoQualityOptions,
    metadata_override: Option<&RawMetadata>,
    color_policy: ColorManagementPolicy,
    timeout: Duration,
) -> Result<AutoQualityResult> {
    let deadline = EncodeDeadline::from_timeout(timeout);
    convert_auto_quality_with_color_policy_deadline(
        input,
        target,
        options,
        auto,
        metadata_override,
        color_policy,
        Some(&deadline),
    )
}

fn convert_auto_quality_with_color_policy_deadline(
    input: &[u8],
    target: Format,
    options: &[EncodeOptions],
    auto: &AutoQualityOptions,
    metadata_override: Option<&RawMetadata>,
    color_policy: ColorManagementPolicy,
    deadline: Option<&EncodeDeadline>,
) -> Result<AutoQualityResult> {
    if !matches!(target, Format::Jpeg | Format::WebP) {
        return Err(Error::Unsupported("自动质量仅支持 JPEG/WebP".into()));
    }
    let img = decode_for_pipeline(input, metadata_override, color_policy)?;
    check_deadline(deadline, "自动质量解码完成")?;
    encode_auto_quality_with_deadline(&img, target, options, auto, deadline)
}

fn decode_for_pipeline(
    input: &[u8],
    metadata_override: Option<&RawMetadata>,
    color_policy: ColorManagementPolicy,
) -> Result<ImageData> {
    let src =
        Format::from_magic(input).ok_or_else(|| Error::Unsupported("无法识别输入格式".into()))?;
    let mut img = codec_for(src).decode(input)?;
    if let Some(metadata) = metadata_override.filter(|metadata| !metadata.is_empty()) {
        img.apply_metadata_override(metadata);
    }
    apply_color_management_policy(&img, color_policy)
}

fn encode_best_of_with_deadline(
    img: &ImageData,
    target: Format,
    options: &[EncodeOptions],
    deadline: Option<&EncodeDeadline>,
) -> Result<Vec<u8>> {
    if options.is_empty() {
        return Err(Error::Invalid("至少需要一个编码候选".into()));
    }

    let codec = codec_for(target);
    let mut best: Option<Vec<u8>> = None;
    for opts in options {
        check_deadline(deadline, "编码候选开始前")?;
        let candidate = codec.encode(img, opts)?;
        check_deadline(deadline, "编码候选完成后")?;
        if best
            .as_ref()
            .is_none_or(|current| candidate.len() < current.len())
        {
            best = Some(candidate);
        }
    }
    best.ok_or_else(|| Error::Invalid("没有可用编码候选".into()))
}

fn encode_auto_quality_with_deadline(
    img: &ImageData,
    target: Format,
    options: &[EncodeOptions],
    auto: &AutoQualityOptions,
    deadline: Option<&EncodeDeadline>,
) -> Result<AutoQualityResult> {
    if options.is_empty() {
        return Err(Error::Invalid("至少需要一个编码候选".into()));
    }

    if img.width < 8 || img.height < 8 {
        let bytes = encode_best_of_with_deadline(img, target, options, deadline)?;
        return Ok(AutoQualityResult {
            bytes,
            quality: highest_candidate_quality(options),
            score: None,
            used_lossless: options.iter().any(|opts| opts.lossless),
        });
    }

    let min_quality = auto.min_quality.clamp(1, 100);
    let max_quality = highest_candidate_quality(options).max(min_quality);
    let levels = auto_quality_levels(min_quality, max_quality);
    let mut low = 0usize;
    let mut high = levels.len();
    let mut best: Option<ScoredCandidate> = None;
    let mut max_candidate: Option<ScoredCandidate> = None;

    while low < high {
        check_deadline(deadline, "自动质量候选开始前")?;
        let mid = low + (high - low) / 2;
        let quality = levels[mid];
        let candidate =
            encode_scored_quality_candidate_with_deadline(img, target, options, quality, deadline)?;
        check_deadline(deadline, "自动质量候选评分后")?;
        if candidate.score >= auto.target_score {
            best = Some(candidate);
            high = mid;
        } else {
            if quality == max_quality {
                max_candidate = Some(candidate);
            }
            low = mid + 1;
        }
    }

    let mut selected = if let Some(best) = best {
        best
    } else if let Some(max_candidate) = max_candidate {
        max_candidate
    } else {
        encode_scored_quality_candidate_with_deadline(img, target, options, max_quality, deadline)?
    };

    if target == Format::WebP && !options.iter().any(|opts| opts.lossless) {
        check_deadline(deadline, "WebP 无损候选开始前")?;
        let lossless = encode_lossless_webp_candidate_with_deadline(img, options, deadline)?;
        check_deadline(deadline, "WebP 无损候选评分后")?;
        if lossless.bytes.len() < selected.bytes.len() {
            selected = lossless;
        }
    }

    Ok(AutoQualityResult {
        bytes: selected.bytes,
        quality: selected.quality,
        score: Some(selected.score),
        used_lossless: selected.used_lossless,
    })
}

#[derive(Debug)]
struct ScoredCandidate {
    bytes: Vec<u8>,
    quality: u8,
    score: f64,
    used_lossless: bool,
}

fn highest_candidate_quality(options: &[EncodeOptions]) -> u8 {
    options.iter().map(|opts| opts.quality).max().unwrap_or(80)
}

fn auto_quality_levels(min_quality: u8, max_quality: u8) -> Vec<u8> {
    let min_quality = min_quality.min(max_quality);
    let mut levels = Vec::new();
    let mut quality = min_quality;
    while quality < max_quality {
        levels.push(quality);
        quality = quality.saturating_add(AUTO_QUALITY_STEP).min(max_quality);
    }
    if levels.last().copied() != Some(max_quality) {
        levels.push(max_quality);
    }
    levels
}

fn auto_quality_lossy_scoring_evaluation_limit(min_quality: u8, max_quality: u8) -> usize {
    let level_count =
        auto_quality_levels(min_quality.clamp(1, 100), max_quality.clamp(1, 100)).len();
    if level_count <= 1 {
        return level_count;
    }

    let mut span = level_count;
    let mut evaluations = 0usize;
    while span > 0 {
        evaluations += 1;
        span /= 2;
    }
    evaluations.saturating_add(1).min(level_count)
}

pub fn auto_quality_scoring_evaluation_limit(
    target: Format,
    min_quality: u8,
    max_quality: u8,
) -> usize {
    let lossy = auto_quality_lossy_scoring_evaluation_limit(min_quality, max_quality);
    if target == Format::WebP {
        lossy.saturating_add(1)
    } else {
        lossy
    }
}

fn encode_scored_quality_candidate_with_deadline(
    img: &ImageData,
    target: Format,
    options: &[EncodeOptions],
    quality: u8,
    deadline: Option<&EncodeDeadline>,
) -> Result<ScoredCandidate> {
    let quality_options = options
        .iter()
        .map(|opts| {
            let mut candidate = *opts;
            candidate.quality = quality;
            candidate.lossless = false;
            candidate
        })
        .collect::<Vec<_>>();
    let bytes = encode_best_of_with_deadline(img, target, &quality_options, deadline)?;
    check_deadline(deadline, "自动质量候选解码前")?;
    let decoded = codec_for(target).decode(&bytes)?;
    check_deadline(deadline, "自动质量候选评分前")?;
    let score = ssimulacra2_score(img, &decoded)?;
    Ok(ScoredCandidate {
        bytes,
        quality,
        score,
        used_lossless: false,
    })
}

fn encode_lossless_webp_candidate_with_deadline(
    img: &ImageData,
    options: &[EncodeOptions],
    deadline: Option<&EncodeDeadline>,
) -> Result<ScoredCandidate> {
    let lossless_options = options
        .iter()
        .map(|opts| {
            let mut candidate = *opts;
            candidate.quality = 100;
            candidate.lossless = true;
            candidate.webp_near_lossless = 100;
            candidate
        })
        .collect::<Vec<_>>();
    let bytes = encode_best_of_with_deadline(img, Format::WebP, &lossless_options, deadline)?;
    check_deadline(deadline, "WebP 无损候选解码前")?;
    let decoded = WebpCodec.decode(&bytes)?;
    check_deadline(deadline, "WebP 无损候选评分前")?;
    let score = ssimulacra2_score(img, &decoded)?;
    Ok(ScoredCandidate {
        bytes,
        quality: 100,
        score,
        used_lossless: true,
    })
}

fn ssimulacra2_score(source: &ImageData, distorted: &ImageData) -> Result<f64> {
    if source.width != distorted.width || source.height != distorted.height {
        return Err(Error::Encode("自动质量评分要求候选尺寸与源图一致".into()));
    }
    let source_frame = ssimulacra2_frame(source)?;
    let distorted_frame = ssimulacra2_frame(distorted)?;
    compute_frame_ssimulacra2(source_frame, distorted_frame)
        .map_err(|e| Error::Encode(format!("SSIMULACRA2 评分失败: {e}")))
}

fn ssimulacra2_frame(img: &ImageData) -> Result<Xyb> {
    let data = composited_srgb_for_score(img);
    let rgb = Rgb::new(
        data,
        img.width as usize,
        img.height as usize,
        TransferCharacteristic::SRGB,
        ColorPrimaries::BT709,
    )
    .map_err(|e| Error::Encode(format!("构造 SSIMULACRA2 RGB 帧失败: {e:?}")))?;
    Xyb::try_from(rgb).map_err(|e| Error::Encode(format!("转换 SSIMULACRA2 XYB 帧失败: {e:?}")))
}

fn composited_srgb_for_score(img: &ImageData) -> Vec<[f32; 3]> {
    let rgba = img.rgba8_cow();
    let mut rgb = Vec::with_capacity(rgba.len() / 4);
    for pixel in rgba.chunks_exact(4) {
        let alpha = f32::from(pixel[3]) / 255.0;
        let inv_alpha = 1.0 - alpha;
        rgb.push([
            (f32::from(pixel[0]) * alpha + 255.0 * inv_alpha) / 255.0,
            (f32::from(pixel[1]) * alpha + 255.0 * inv_alpha) / 255.0,
            (f32::from(pixel[2]) * alpha + 255.0 * inv_alpha) / 255.0,
        ]);
    }
    rgb
}

/// 探测无损容器中是否有明显有损压缩痕迹。该结果只应作为保守策略 hint。
pub fn detect_lossy_artifacts(input: &[u8]) -> Result<Option<LossyArtifactHint>> {
    let format =
        Format::from_magic(input).ok_or_else(|| Error::Unsupported("无法识别输入格式".into()))?;
    if format != Format::Png {
        return Ok(None);
    }

    let img = codec_for(format).decode(input)?;
    let (jpeg_grid_score, jpeg_chroma_grid_score) =
        jpeg_chroma_grid_artifact_scores(&img).unwrap_or((0.0, 0.0));
    let webp_block_score = webp_block_artifact_score(&img).unwrap_or(0.0);
    Ok((jpeg_grid_score >= JPEG_GRID_ARTIFACT_SCORE_THRESHOLD
        || jpeg_chroma_grid_score >= JPEG_CHROMA_GRID_ARTIFACT_SCORE_THRESHOLD
        || webp_block_score >= WEBP_BLOCK_ARTIFACT_SCORE_THRESHOLD)
        .then_some(LossyArtifactHint {
            format,
            jpeg_grid_score,
            jpeg_chroma_grid_score,
            webp_block_score,
        }))
}

pub fn probe_avif_lossless_candidate() -> Result<AvifLosslessProbe> {
    let cases = [
        ("rgba-yuv444", AvifSubsample::Yuv444, true),
        ("opaque-yuv444", AvifSubsample::Yuv444, false),
        ("rgba-yuv420", AvifSubsample::Yuv420, true),
    ];
    let mut results = Vec::with_capacity(cases.len());
    for (name, requested_subsample, has_alpha) in cases {
        results.push(probe_avif_lossless_case(
            name,
            requested_subsample,
            has_alpha,
        )?);
    }

    let max_channel_abs_diff = results
        .iter()
        .map(|case| case.max_channel_abs_diff)
        .max()
        .unwrap_or(0);
    let roundtrip_exact = results.iter().all(|case| case.roundtrip_exact);
    let supported = AVIF_LOSSLESS_SUPPORTED && roundtrip_exact;
    let reason = if supported {
        "AVIF lossless candidate is exact and capability flag is enabled".to_string()
    } else if roundtrip_exact {
        "AVIF lossless probes are exact, but capability flag is disabled".to_string()
    } else {
        format!(
            "AVIF lossless probes are not pixel-exact with current AOM path; max channel delta {max_channel_abs_diff}"
        )
    };
    Ok(AvifLosslessProbe {
        supported,
        roundtrip_exact,
        max_channel_abs_diff,
        cases: results,
        reason,
    })
}

fn probe_avif_lossless_case(
    name: &'static str,
    requested_subsample: AvifSubsample,
    has_alpha: bool,
) -> Result<AvifLosslessProbeCase> {
    let mut rgba = Vec::with_capacity(16 * 16 * 4);
    for y in 0..16u8 {
        for x in 0..16u8 {
            rgba.extend_from_slice(&[
                x.wrapping_mul(17),
                y.wrapping_mul(13),
                x.wrapping_mul(11) ^ y.wrapping_mul(7),
                if has_alpha {
                    x.wrapping_mul(9).wrapping_add(y.wrapping_mul(5))
                } else {
                    255
                },
            ]);
        }
    }
    let source = ImageData::new(16, 16, rgba)?;
    let encoded = AvifCodec.encode(
        &source,
        &EncodeOptions {
            quality: 100,
            lossless: true,
            avif_speed: 10,
            avif_subsample: requested_subsample,
            ..EncodeOptions::default()
        },
    )?;
    let decoded = AvifCodec.decode(&encoded)?;
    let source_rgba = source.rgba8()?;
    let decoded_rgba = decoded.rgba8()?;
    let max_channel_abs_diff = source_rgba
        .iter()
        .zip(decoded_rgba)
        .map(|(left, right)| left.abs_diff(*right))
        .max()
        .unwrap_or(0);
    let roundtrip_exact = source.width == decoded.width
        && source.height == decoded.height
        && max_channel_abs_diff == 0;
    Ok(AvifLosslessProbeCase {
        name,
        requested_subsample,
        has_alpha,
        roundtrip_exact,
        max_channel_abs_diff,
        encoded_bytes: encoded.len(),
    })
}

fn jpeg_chroma_grid_artifact_scores(img: &ImageData) -> Option<(f64, f64)> {
    if img.width < JPEG_GRID_ARTIFACT_MIN_DIMENSION || img.height < JPEG_GRID_ARTIFACT_MIN_DIMENSION
    {
        return None;
    }

    let width = img.width as usize;
    let height = img.height as usize;
    let rgba = img.rgba8_cow();
    let mut luma_boundary_sum = 0u64;
    let mut chroma_boundary_sum = 0u64;
    let mut boundary_count = 0u64;
    let mut luma_interior_sum = 0u64;
    let mut chroma_interior_sum = 0u64;
    let mut interior_count = 0u64;

    for y in 0..height {
        for x in 1..width {
            let luma = luma_delta(&rgba, width, x, y, x - 1, y);
            let chroma = chroma_delta(&rgba, width, x, y, x - 1, y);
            if x % 8 == 0 {
                luma_boundary_sum += luma;
                chroma_boundary_sum += chroma;
                boundary_count += 1;
            } else {
                luma_interior_sum += luma;
                chroma_interior_sum += chroma;
                interior_count += 1;
            }
        }
    }

    for y in 1..height {
        for x in 0..width {
            let luma = luma_delta(&rgba, width, x, y, x, y - 1);
            let chroma = chroma_delta(&rgba, width, x, y, x, y - 1);
            if y % 8 == 0 {
                luma_boundary_sum += luma;
                chroma_boundary_sum += chroma;
                boundary_count += 1;
            } else {
                luma_interior_sum += luma;
                chroma_interior_sum += chroma;
                interior_count += 1;
            }
        }
    }

    Some((
        boundary_artifact_ratio(
            luma_boundary_sum,
            boundary_count,
            luma_interior_sum,
            interior_count,
            JPEG_GRID_ARTIFACT_MIN_BOUNDARY_DELTA,
        )
        .unwrap_or(0.0),
        boundary_artifact_ratio(
            chroma_boundary_sum,
            boundary_count,
            chroma_interior_sum,
            interior_count,
            JPEG_CHROMA_GRID_ARTIFACT_MIN_BOUNDARY_DELTA,
        )
        .unwrap_or(0.0),
    ))
}

fn webp_block_artifact_score(img: &ImageData) -> Option<f64> {
    block_boundary_artifact_score(
        img,
        4,
        WEBP_BLOCK_ARTIFACT_MIN_DIMENSION,
        WEBP_BLOCK_ARTIFACT_MIN_BOUNDARY_DELTA,
        luma_delta,
    )
}

fn block_boundary_artifact_score(
    img: &ImageData,
    block: usize,
    min_dimension: u32,
    min_boundary_delta: f64,
    delta_fn: fn(&[u8], usize, usize, usize, usize, usize) -> u64,
) -> Option<f64> {
    if block < 2 || img.width < min_dimension || img.height < min_dimension {
        return None;
    }

    let width = img.width as usize;
    let height = img.height as usize;
    let rgba = img.rgba8_cow();
    let mut boundary_sum = 0u64;
    let mut boundary_count = 0u64;
    let mut interior_sum = 0u64;
    let mut interior_count = 0u64;

    for y in 0..height {
        for x in 1..width {
            let delta = delta_fn(&rgba, width, x, y, x - 1, y);
            if x % block == 0 {
                boundary_sum += delta;
                boundary_count += 1;
            } else {
                interior_sum += delta;
                interior_count += 1;
            }
        }
    }

    for y in 1..height {
        for x in 0..width {
            let delta = delta_fn(&rgba, width, x, y, x, y - 1);
            if y % block == 0 {
                boundary_sum += delta;
                boundary_count += 1;
            } else {
                interior_sum += delta;
                interior_count += 1;
            }
        }
    }

    boundary_artifact_ratio(
        boundary_sum,
        boundary_count,
        interior_sum,
        interior_count,
        min_boundary_delta,
    )
}

fn boundary_artifact_ratio(
    boundary_sum: u64,
    boundary_count: u64,
    interior_sum: u64,
    interior_count: u64,
    min_boundary_delta: f64,
) -> Option<f64> {
    if boundary_count == 0 || interior_count == 0 {
        return None;
    }

    let boundary_avg = boundary_sum as f64 / boundary_count as f64;
    let interior_avg = interior_sum as f64 / interior_count as f64;
    if boundary_avg < min_boundary_delta || interior_avg <= 0.0 {
        return None;
    }
    Some(boundary_avg / interior_avg.max(1.0))
}

fn luma_delta(rgba: &[u8], width: usize, ax: usize, ay: usize, bx: usize, by: usize) -> u64 {
    let a = composited_luma(pixel_at_unchecked(rgba, width, ax, ay));
    let b = composited_luma(pixel_at_unchecked(rgba, width, bx, by));
    u64::from(a.abs_diff(b))
}

fn chroma_delta(rgba: &[u8], width: usize, ax: usize, ay: usize, bx: usize, by: usize) -> u64 {
    let a = composited_rgb(pixel_at_unchecked(rgba, width, ax, ay));
    let b = composited_rgb(pixel_at_unchecked(rgba, width, bx, by));
    let a_cb = -43 * i32::from(a[0]) - 85 * i32::from(a[1]) + 128 * i32::from(a[2]);
    let a_cr = 128 * i32::from(a[0]) - 107 * i32::from(a[1]) - 21 * i32::from(a[2]);
    let b_cb = -43 * i32::from(b[0]) - 85 * i32::from(b[1]) + 128 * i32::from(b[2]);
    let b_cr = 128 * i32::from(b[0]) - 107 * i32::from(b[1]) - 21 * i32::from(b[2]);
    ((a_cb - b_cb).unsigned_abs() + (a_cr - b_cr).unsigned_abs()) as u64 / 256
}

fn pixel_at_unchecked(rgba: &[u8], width: usize, x: usize, y: usize) -> &[u8] {
    let offset = (y * width + x) * 4;
    &rgba[offset..offset + 4]
}

fn composited_luma(pixel: &[u8]) -> u16 {
    let [r, g, b] = composited_rgb(pixel);
    ((77 * u32::from(r) + 150 * u32::from(g) + 29 * u32::from(b) + 128) / 256) as u16
}

fn composited_rgb(pixel: &[u8]) -> [u16; 3] {
    let alpha = u32::from(pixel[3]);
    let inv_alpha = 255 - alpha;
    let r = (u32::from(pixel[0]) * alpha + 255 * inv_alpha) / 255;
    let g = (u32::from(pixel[1]) * alpha + 255 * inv_alpha) / 255;
    let b = (u32::from(pixel[2]) * alpha + 255 * inv_alpha) / 255;
    [r as u16, g as u16, b as u16]
}

/// 读取图片头部元数据,用于导入阶段的尺寸/DPI ping。
pub fn probe(input: &[u8]) -> Result<ImageProbe> {
    let format =
        Format::from_magic(input).ok_or_else(|| Error::Unsupported("无法识别输入格式".into()))?;
    let (width, height, dpi) = match format {
        Format::Jpeg => probe_jpeg(input)?,
        Format::Png => probe_png(input)?,
        Format::WebP => probe_webp(input)?,
        Format::Avif => probe_avif(input)?,
    };
    rgba_byte_len(width, height)?;
    Ok(ImageProbe {
        format,
        width,
        height,
        dpi,
    })
}

/// 生成最长边不超过 `max_edge` 的 PNG 缩略图。全透明图片返回 `Ok(None)`。
pub fn thumbnail(input: &[u8], max_edge: u32) -> Result<Option<Thumbnail>> {
    let src =
        Format::from_magic(input).ok_or_else(|| Error::Unsupported("无法识别输入格式".into()))?;
    let img = codec_for(src).decode(input)?;
    let source = img.rgba8_cow();
    if source.chunks_exact(4).all(|pixel| pixel[3] == 0) {
        return Ok(None);
    }

    let max_edge = max_edge.clamp(32, 512);
    let (width, height) = thumbnail_dimensions(img.width, img.height, max_edge);
    let resized = if width == img.width && height == img.height {
        source.into_owned()
    } else {
        resize_rgba8_linear(&source, img.width, img.height, width, height)?
    };
    let png = encode_png_rgba(width, height, &resized)?;
    Ok(Some(Thumbnail { width, height, png }))
}

/// 主图线性空间 resize。输出保留输入的像素缓冲编码和 metadata。
pub fn resize_linear(img: &ImageData, dst_width: u32, dst_height: u32) -> Result<ImageData> {
    img.validate()?;
    if img.icc.as_ref().is_some_and(|icc| !icc.is_empty()) {
        return Err(Error::Unsupported(
            "resize_linear 只接受已转为 sRGB 或无 ICC 的输入;请先应用 ConvertToSrgb".into(),
        ));
    }
    rgba_sample_len(dst_width, dst_height)?;
    if img.width == dst_width && img.height == dst_height {
        return Ok(img.clone());
    }

    let pixels = match &img.pixels {
        PixelBuffer::Rgba8(samples) => PixelBuffer::Rgba8(resize_rgba8_linear(
            samples, img.width, img.height, dst_width, dst_height,
        )?),
        PixelBuffer::Rgba16(samples) => PixelBuffer::Rgba16(resize_rgba16_linear(
            samples, img.width, img.height, dst_width, dst_height,
        )?),
        PixelBuffer::RgbaF32(samples) => PixelBuffer::RgbaF32(resize_rgba_f32_linear(
            samples, img.width, img.height, dst_width, dst_height,
        )?),
    };

    Ok(ImageData {
        width: dst_width,
        height: dst_height,
        pixels,
        icc: img.icc.clone(),
        exif: img.exif.clone(),
        xmp: img.xmp.clone(),
        iptc: img.iptc.clone(),
    })
}

fn thumbnail_dimensions(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    if width <= max_edge && height <= max_edge {
        return (width, height);
    }

    if width >= height {
        let scaled_height = ((height as u64 * max_edge as u64) + (width as u64 / 2)) / width as u64;
        (max_edge, scaled_height.max(1) as u32)
    } else {
        let scaled_width = ((width as u64 * max_edge as u64) + (height as u64 / 2)) / height as u64;
        (scaled_width.max(1) as u32, max_edge)
    }
}

fn resize_rgba8_linear(
    rgba: &[u8],
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
) -> Result<Vec<u8>> {
    if src_width == dst_width && src_height == dst_height {
        return Ok(rgba.to_vec());
    }
    let expected = rgba_byte_len(src_width, src_height)?;
    if rgba.len() != expected {
        return Err(Error::Invalid("缩略图输入 RGBA 长度不匹配".into()));
    }
    let dst_len = rgba_byte_len(dst_width, dst_height)?;
    let mut out = vec![0u8; dst_len];
    let x_scale = src_width as f32 / dst_width as f32;
    let y_scale = src_height as f32 / dst_height as f32;

    for dst_y in 0..dst_height as usize {
        let src_y = ((dst_y as f32 + 0.5) * y_scale - 0.5).clamp(0.0, (src_height - 1) as f32);
        let y0 = src_y.floor() as usize;
        let y1 = (y0 + 1).min(src_height as usize - 1);
        let wy = src_y - y0 as f32;
        for dst_x in 0..dst_width as usize {
            let src_x = ((dst_x as f32 + 0.5) * x_scale - 0.5).clamp(0.0, (src_width - 1) as f32);
            let x0 = src_x.floor() as usize;
            let x1 = (x0 + 1).min(src_width as usize - 1);
            let wx = src_x - x0 as f32;
            let px = sample_linear_premul(
                rgba,
                src_width as usize,
                SampleQuad {
                    x0,
                    y0,
                    x1,
                    y1,
                    wx,
                    wy,
                },
            );
            let offset = (dst_y * dst_width as usize + dst_x) * 4;
            out[offset..offset + 4].copy_from_slice(&px);
        }
    }
    Ok(out)
}

fn resize_rgba16_linear(
    rgba: &[u16],
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
) -> Result<Vec<u16>> {
    if src_width == dst_width && src_height == dst_height {
        return Ok(rgba.to_vec());
    }
    let expected = rgba_sample_len(src_width, src_height)?;
    if rgba.len() != expected {
        return Err(Error::Invalid("RGBA16 resize 输入长度不匹配".into()));
    }
    let dst_len = rgba_sample_len(dst_width, dst_height)?;
    let mut out = vec![0u16; dst_len];
    let x_scale = src_width as f32 / dst_width as f32;
    let y_scale = src_height as f32 / dst_height as f32;

    for dst_y in 0..dst_height as usize {
        let src_y = ((dst_y as f32 + 0.5) * y_scale - 0.5).clamp(0.0, (src_height - 1) as f32);
        let y0 = src_y.floor() as usize;
        let y1 = (y0 + 1).min(src_height as usize - 1);
        let wy = src_y - y0 as f32;
        for dst_x in 0..dst_width as usize {
            let src_x = ((dst_x as f32 + 0.5) * x_scale - 0.5).clamp(0.0, (src_width - 1) as f32);
            let x0 = src_x.floor() as usize;
            let x1 = (x0 + 1).min(src_width as usize - 1);
            let wx = src_x - x0 as f32;
            let px = sample_linear_premul16(
                rgba,
                src_width as usize,
                SampleQuad {
                    x0,
                    y0,
                    x1,
                    y1,
                    wx,
                    wy,
                },
            );
            let offset = (dst_y * dst_width as usize + dst_x) * 4;
            out[offset..offset + 4].copy_from_slice(&px);
        }
    }
    Ok(out)
}

fn resize_rgba_f32_linear(
    rgba: &[f32],
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
) -> Result<Vec<f32>> {
    if src_width == dst_width && src_height == dst_height {
        return Ok(rgba
            .iter()
            .map(|sample| sanitize_unit_f32(*sample))
            .collect());
    }
    let expected = rgba_sample_len(src_width, src_height)?;
    if rgba.len() != expected {
        return Err(Error::Invalid("RGBAF32 resize 输入长度不匹配".into()));
    }
    let dst_len = rgba_sample_len(dst_width, dst_height)?;
    let mut out = vec![0.0f32; dst_len];
    let x_scale = src_width as f32 / dst_width as f32;
    let y_scale = src_height as f32 / dst_height as f32;

    for dst_y in 0..dst_height as usize {
        let src_y = ((dst_y as f32 + 0.5) * y_scale - 0.5).clamp(0.0, (src_height - 1) as f32);
        let y0 = src_y.floor() as usize;
        let y1 = (y0 + 1).min(src_height as usize - 1);
        let wy = src_y - y0 as f32;
        for dst_x in 0..dst_width as usize {
            let src_x = ((dst_x as f32 + 0.5) * x_scale - 0.5).clamp(0.0, (src_width - 1) as f32);
            let x0 = src_x.floor() as usize;
            let x1 = (x0 + 1).min(src_width as usize - 1);
            let wx = src_x - x0 as f32;
            let px = sample_linear_premul_f32(
                rgba,
                src_width as usize,
                SampleQuad {
                    x0,
                    y0,
                    x1,
                    y1,
                    wx,
                    wy,
                },
            );
            let offset = (dst_y * dst_width as usize + dst_x) * 4;
            out[offset..offset + 4].copy_from_slice(&px);
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Copy)]
struct SampleQuad {
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
    wx: f32,
    wy: f32,
}

fn sample_linear_premul(rgba: &[u8], width: usize, quad: SampleQuad) -> [u8; 4] {
    let weights = [
        ((quad.x0, quad.y0), (1.0 - quad.wx) * (1.0 - quad.wy)),
        ((quad.x1, quad.y0), quad.wx * (1.0 - quad.wy)),
        ((quad.x0, quad.y1), (1.0 - quad.wx) * quad.wy),
        ((quad.x1, quad.y1), quad.wx * quad.wy),
    ];
    let mut rgb = [0.0f32; 3];
    let mut alpha = 0.0f32;
    for ((x, y), weight) in weights {
        let offset = (y * width + x) * 4;
        let px = &rgba[offset..offset + 4];
        let a = f32::from(px[3]) / 255.0;
        alpha += a * weight;
        for channel in 0..3 {
            rgb[channel] += srgb8_to_linear(px[channel]) * a * weight;
        }
    }
    let mut out = [0u8; 4];
    if alpha > f32::EPSILON {
        for channel in 0..3 {
            out[channel] = linear_to_srgb8(rgb[channel] / alpha);
        }
    }
    out[3] = (alpha.clamp(0.0, 1.0) * 255.0).round() as u8;
    out
}

fn sample_linear_premul16(rgba: &[u16], width: usize, quad: SampleQuad) -> [u16; 4] {
    let weights = [
        ((quad.x0, quad.y0), (1.0 - quad.wx) * (1.0 - quad.wy)),
        ((quad.x1, quad.y0), quad.wx * (1.0 - quad.wy)),
        ((quad.x0, quad.y1), (1.0 - quad.wx) * quad.wy),
        ((quad.x1, quad.y1), quad.wx * quad.wy),
    ];
    let mut rgb = [0.0f32; 3];
    let mut alpha = 0.0f32;
    for ((x, y), weight) in weights {
        let offset = (y * width + x) * 4;
        let px = &rgba[offset..offset + 4];
        let a = f32::from(px[3]) / 65_535.0;
        alpha += a * weight;
        for channel in 0..3 {
            let encoded = f32::from(px[channel]) / 65_535.0;
            rgb[channel] += srgb_unit_to_linear(encoded) * a * weight;
        }
    }
    let mut out = [0u16; 4];
    if alpha > f32::EPSILON {
        for channel in 0..3 {
            out[channel] = linear_to_srgb16(rgb[channel] / alpha);
        }
    }
    out[3] = (alpha.clamp(0.0, 1.0) * 65_535.0).round() as u16;
    out
}

fn sample_linear_premul_f32(rgba: &[f32], width: usize, quad: SampleQuad) -> [f32; 4] {
    let weights = [
        ((quad.x0, quad.y0), (1.0 - quad.wx) * (1.0 - quad.wy)),
        ((quad.x1, quad.y0), quad.wx * (1.0 - quad.wy)),
        ((quad.x0, quad.y1), (1.0 - quad.wx) * quad.wy),
        ((quad.x1, quad.y1), quad.wx * quad.wy),
    ];
    let mut rgb = [0.0f32; 3];
    let mut alpha = 0.0f32;
    for ((x, y), weight) in weights {
        let offset = (y * width + x) * 4;
        let px = &rgba[offset..offset + 4];
        let a = sanitize_unit_f32(px[3]);
        alpha += a * weight;
        for channel in 0..3 {
            rgb[channel] += srgb_unit_to_linear(sanitize_unit_f32(px[channel])) * a * weight;
        }
    }
    let mut out = [0.0f32; 4];
    if alpha > f32::EPSILON {
        for channel in 0..3 {
            out[channel] = linear_to_srgb_unit(rgb[channel] / alpha);
        }
    }
    out[3] = alpha.clamp(0.0, 1.0);
    out
}

fn srgb8_to_linear(value: u8) -> f32 {
    srgb_unit_to_linear(f32::from(value) / 255.0)
}

fn srgb_unit_to_linear(value: f32) -> f32 {
    let value = sanitize_unit_f32(value);
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb8(value: f32) -> u8 {
    (linear_to_srgb_unit(value) * 255.0)
        .round()
        .clamp(0.0, 255.0) as u8
}

fn linear_to_srgb16(value: f32) -> u16 {
    (linear_to_srgb_unit(value) * 65_535.0)
        .round()
        .clamp(0.0, 65_535.0) as u16
}

fn linear_to_srgb_unit(value: f32) -> f32 {
    let value = sanitize_unit_f32(value);
    let encoded = if value <= 0.003_130_8 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    };
    sanitize_unit_f32(encoded)
}

fn encode_png_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>> {
    use image::ImageEncoder;
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(rgba, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| Error::Encode(e.to_string()))?;
    Ok(png)
}

fn encode_png_rgba16(width: u32, height: u32, rgba: &[u16]) -> Result<Vec<u8>> {
    use image::ImageEncoder;
    let mut bytes = Vec::with_capacity(
        rgba.len()
            .checked_mul(2)
            .ok_or_else(|| Error::Encode("RGBA16 PNG 输入长度溢出".into()))?,
    );
    for sample in rgba {
        bytes.extend_from_slice(&sample.to_ne_bytes());
    }

    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(&bytes, width, height, image::ExtendedColorType::Rgba16)
        .map_err(|e| Error::Encode(e.to_string()))?;
    Ok(png)
}

fn be_u16(bytes: &[u8]) -> Option<u16> {
    Some(u16::from_be_bytes(bytes.get(0..2)?.try_into().ok()?))
}

fn be_u32(bytes: &[u8]) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(0..4)?.try_into().ok()?))
}

fn le_u16(bytes: &[u8]) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(0..2)?.try_into().ok()?))
}

fn le_u32(bytes: &[u8]) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(0..4)?.try_into().ok()?))
}

fn probe_png(bytes: &[u8]) -> Result<(u32, u32, Option<Dpi>)> {
    if bytes.len() < 33 || &bytes[12..16] != b"IHDR" {
        return Err(Error::Decode("PNG 头不完整".into()));
    }
    let width = be_u32(&bytes[16..20]).ok_or_else(|| Error::Decode("PNG 宽度缺失".into()))?;
    let height = be_u32(&bytes[20..24]).ok_or_else(|| Error::Decode("PNG 高度缺失".into()))?;

    let mut dpi = None;
    let mut offset = 8usize;
    while offset + 8 <= bytes.len() {
        let length = be_u32(&bytes[offset..offset + 4])
            .ok_or_else(|| Error::Decode("PNG chunk 长度缺失".into()))?
            as usize;
        let chunk = &bytes[offset + 4..offset + 8];
        let data_start = offset + 8;
        let Some(data_end) = data_start.checked_add(length) else {
            break;
        };
        let Some(next_offset) = data_end.checked_add(4) else {
            break;
        };
        if next_offset > bytes.len() {
            break;
        }

        if chunk == b"pHYs" && length == 9 {
            let data = &bytes[data_start..data_end];
            if data[8] == 1 {
                let pixels_per_meter_x = be_u32(&data[0..4]).unwrap_or(0);
                let pixels_per_meter_y = be_u32(&data[4..8]).unwrap_or(0);
                if pixels_per_meter_x > 0 && pixels_per_meter_y > 0 {
                    dpi = Some(Dpi {
                        x: pixels_per_meter_x as f64 * 0.0254,
                        y: pixels_per_meter_y as f64 * 0.0254,
                    });
                }
            }
        }
        if chunk == b"IDAT" || chunk == b"IEND" {
            break;
        }
        offset = next_offset;
    }

    Ok((width, height, dpi))
}

fn probe_jpeg(bytes: &[u8]) -> Result<(u32, u32, Option<Dpi>)> {
    if bytes.len() < 4 || bytes[0..2] != [0xff, 0xd8] {
        return Err(Error::Decode("JPEG 头不完整".into()));
    }

    let mut offset = 2usize;
    let mut jfif_dpi = None;
    let mut exif_dpi = None;
    let mut dimensions = None;
    let mut orientation = image::metadata::Orientation::NoTransforms;
    while offset < bytes.len() {
        while offset < bytes.len() && bytes[offset] != 0xff {
            offset += 1;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        if offset >= bytes.len() {
            break;
        }

        let marker = bytes[offset];
        offset += 1;
        if marker == 0xda || marker == 0xd9 {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if offset + 2 > bytes.len() {
            break;
        }

        let segment_length = be_u16(&bytes[offset..offset + 2])
            .ok_or_else(|| Error::Decode("JPEG segment 长度缺失".into()))?
            as usize;
        if segment_length < 2 {
            return Err(Error::Decode("JPEG segment 长度非法".into()));
        }
        let data_start = offset + 2;
        let data_length = segment_length - 2;
        let Some(data_end) = data_start.checked_add(data_length) else {
            break;
        };
        if data_end > bytes.len() {
            break;
        }
        let data = &bytes[data_start..data_end];

        if marker == 0xe0 && jfif_dpi.is_none() {
            jfif_dpi = parse_jfif_dpi(data);
        }
        if marker == 0xe1 && data.len() > 6 && &data[0..6] == b"Exif\0\0" {
            if let Some(value) = image::metadata::Orientation::from_exif_chunk(&data[6..]) {
                orientation = value;
            }
            if exif_dpi.is_none() {
                exif_dpi = parse_exif_dpi(&data[6..]);
            }
        }
        if is_jpeg_sof(marker) {
            if data.len() < 5 {
                return Err(Error::Decode("JPEG SOF 数据不完整".into()));
            }
            let height =
                be_u16(&data[1..3]).ok_or_else(|| Error::Decode("JPEG 高度缺失".into()))?;
            let width = be_u16(&data[3..5]).ok_or_else(|| Error::Decode("JPEG 宽度缺失".into()))?;
            dimensions = Some((width as u32, height as u32));
        }

        offset = data_end;
    }

    let Some((width, height)) = dimensions else {
        return Err(Error::Decode("无法读取 JPEG 尺寸".into()));
    };
    let (width, height) = oriented_dimensions(width, height, orientation);
    Ok((width, height, exif_dpi.or(jfif_dpi)))
}

fn parse_jfif_dpi(data: &[u8]) -> Option<Dpi> {
    if data.len() < 12 || &data[0..5] != b"JFIF\0" {
        return None;
    }
    let unit = data[7];
    let x_density = be_u16(&data[8..10])?;
    let y_density = be_u16(&data[10..12])?;
    if x_density == 0 || y_density == 0 {
        return None;
    }
    match unit {
        1 => Some(Dpi {
            x: x_density as f64,
            y: y_density as f64,
        }),
        2 => Some(Dpi {
            x: x_density as f64 * 2.54,
            y: y_density as f64 * 2.54,
        }),
        _ => None,
    }
}

fn parse_exif_dpi(exif: &[u8]) -> Option<Dpi> {
    let exif = exif.strip_prefix(b"Exif\0\0").unwrap_or(exif);
    let (endian, ifd0_offset) = parse_tiff_header(exif)?;
    let entries = parse_tiff_ifd_entries(exif, endian, ifd0_offset)?;
    let unit = entries
        .iter()
        .find(|entry| entry.tag == 0x0128)
        .and_then(|entry| tiff_entry_short_value(entry, endian))?;
    let x = entries
        .iter()
        .find(|entry| entry.tag == 0x011a)
        .and_then(|entry| tiff_entry_rational_value(entry, endian, exif))?;
    let y = entries
        .iter()
        .find(|entry| entry.tag == 0x011b)
        .and_then(|entry| tiff_entry_rational_value(entry, endian, exif))?;
    if x <= 0.0 || y <= 0.0 {
        return None;
    }
    match unit {
        2 => Some(Dpi { x, y }),
        3 => Some(Dpi {
            x: x * 2.54,
            y: y * 2.54,
        }),
        _ => None,
    }
}

fn is_jpeg_sof(marker: u8) -> bool {
    matches!(
        marker,
        0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf
    )
}

fn probe_webp(bytes: &[u8]) -> Result<(u32, u32, Option<Dpi>)> {
    let feat =
        webp::BitstreamFeatures::new(bytes).ok_or_else(|| Error::Decode("非法 WebP 头".into()))?;
    if feat.has_animation() {
        return Err(Error::Unsupported("动画 WebP 暂不支持".into()));
    }
    Ok((feat.width(), feat.height(), probe_webp_exif_dpi(bytes)))
}

fn probe_webp_exif_dpi(bytes: &[u8]) -> Option<Dpi> {
    parse_webp_chunks(bytes)
        .ok()?
        .into_iter()
        .find(|chunk| chunk.fourcc == *b"EXIF" && !chunk.data.is_empty())
        .and_then(|chunk| parse_exif_dpi(chunk.data))
}

fn probe_avif(bytes: &[u8]) -> Result<(u32, u32, Option<Dpi>)> {
    unsafe {
        let decoder = DecoderGuard(avif::avifDecoderCreate());
        if decoder.0.is_null() {
            return Err(Error::Decode("avifDecoderCreate 返回 null".into()));
        }
        if avif::avifDecoderSetIOMemory(decoder.0, bytes.as_ptr(), bytes.len())
            != avif::AVIF_RESULT_OK
        {
            return Err(Error::Decode("avifDecoderSetIOMemory 失败".into()));
        }
        if avif::avifDecoderParse(decoder.0) != avif::AVIF_RESULT_OK {
            return Err(Error::Decode("avifDecoderParse 失败".into()));
        }
        let image = (*decoder.0).image;
        if image.is_null() {
            return Err(Error::Decode("decoder.image 为 null".into()));
        }
        Ok(((*image).width, (*image).height, probe_avif_exif_dpi(image)))
    }
}

fn probe_avif_exif_dpi(image: *const avif::avifImage) -> Option<Dpi> {
    if image.is_null() {
        return None;
    }
    let exif = unsafe {
        let exif_ref = &(*image).exif;
        avif_metadata_blob(exif_ref.data, exif_ref.size)
    }?;
    parse_exif_dpi(&exif)
}

// ---------- 通用解码(image crate)----------

fn decode_via_image(bytes: &[u8], format: image::ImageFormat) -> Result<ImageData> {
    let mut header_limits = image::Limits::default();
    header_limits.max_image_width = Some(MAX_PIXELS as u32);
    header_limits.max_image_height = Some(MAX_PIXELS as u32);
    let mut header_reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    header_reader.limits(header_limits);
    let (width, height) = header_reader
        .into_dimensions()
        .map_err(|e| Error::Decode(e.to_string()))?;
    let expected_rgba_len = rgba_byte_len(width, height)?;
    let max_decode_alloc = match format {
        image::ImageFormat::Png => (expected_rgba_len as u64)
            .saturating_mul(4)
            .max(1024 * 1024),
        _ => (expected_rgba_len as u64).max(1024 * 1024),
    };

    let mut decode_limits = image::Limits::default();
    decode_limits.max_image_width = Some(width);
    decode_limits.max_image_height = Some(height);
    decode_limits.max_alloc = Some(max_decode_alloc);
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(decode_limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| Error::Decode(e.to_string()))?;
    let source_color = decoder.color_type();
    let orientation = decoder
        .orientation()
        .map_err(|e| Error::Decode(e.to_string()))?;
    let mut img =
        image::DynamicImage::from_decoder(decoder).map_err(|e| Error::Decode(e.to_string()))?;
    img.apply_orientation(orientation);
    if format == image::ImageFormat::Png && is_16_bit_color(source_color) {
        let rgba = img.into_rgba16();
        ImageData::from_pixels(
            rgba.width(),
            rgba.height(),
            PixelBuffer::Rgba16(rgba.into_raw()),
        )
    } else {
        let rgba = img.to_rgba8();
        ImageData::new(rgba.width(), rgba.height(), rgba.into_raw())
    }
}

fn is_16_bit_color(color: image::ColorType) -> bool {
    matches!(
        color,
        image::ColorType::L16
            | image::ColorType::La16
            | image::ColorType::Rgb16
            | image::ColorType::Rgba16
    )
}

fn oriented_dimensions(
    width: u32,
    height: u32,
    orientation: image::metadata::Orientation,
) -> (u32, u32) {
    match orientation {
        image::metadata::Orientation::Rotate90
        | image::metadata::Orientation::Rotate270
        | image::metadata::Orientation::Rotate90FlipH
        | image::metadata::Orientation::Rotate270FlipH => (height, width),
        _ => (width, height),
    }
}

type Metadata = RawMetadata;

fn normalize_exif_orientation(mut exif: Vec<u8>) -> Vec<u8> {
    let _ = image::metadata::Orientation::remove_from_exif_chunk(&mut exif);
    exif
}

fn normalize_xmp_orientation(xmp: Vec<u8>) -> Vec<u8> {
    let text = match String::from_utf8(xmp) {
        Ok(text) => text,
        Err(err) => return err.into_bytes(),
    };
    normalize_xmp_semantics(&text).into_bytes()
}

fn normalize_xmp_semantics(input: &str) -> String {
    let mut text = input.to_string();
    for name in xmp_orientation_names(input) {
        text = remove_xml_attribute(&text, &name);
        text = remove_xml_element(&text, &name);
    }
    for name in xmp_edit_history_names(input) {
        text = remove_xml_element(&text, &name);
    }
    text
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExifSemanticProbe {
    orientation: Option<u16>,
    makernote: Option<ExifMakerNoteSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TiffEndian {
    Little,
    Big,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TiffEntry {
    tag: u16,
    field_type: u16,
    count: u32,
    value_or_offset: u32,
}

fn inspect_exif_semantics(exif: &[u8]) -> Option<ExifSemanticProbe> {
    let tiff = parse_tiff_header(exif)?;
    let ifd0_offset = tiff.1;
    let entries = parse_tiff_ifd_entries(exif, tiff.0, ifd0_offset)?;
    let orientation = entries
        .iter()
        .find(|entry| entry.tag == 0x0112)
        .and_then(|entry| tiff_entry_short_value(entry, tiff.0));
    let exif_ifd_offset = entries
        .iter()
        .find(|entry| entry.tag == 0x8769)
        .and_then(|entry| tiff_entry_offset(entry, exif));
    let makernote = exif_ifd_offset
        .and_then(|offset| parse_tiff_ifd_entries(exif, tiff.0, offset))
        .and_then(|entries| {
            entries
                .iter()
                .find(|entry| entry.tag == 0x927c)
                .and_then(|entry| tiff_entry_payload_range(entry, exif))
                .map(|range| ExifMakerNoteSummary {
                    offset: range.start,
                    byte_len: range.end - range.start,
                })
        });
    Some(ExifSemanticProbe {
        orientation,
        makernote,
    })
}

fn parse_tiff_header(bytes: &[u8]) -> Option<(TiffEndian, usize)> {
    let endian = match bytes.get(0..2)? {
        b"II" => TiffEndian::Little,
        b"MM" => TiffEndian::Big,
        _ => return None,
    };
    if read_tiff_u16(bytes.get(2..4)?, endian)? != 42 {
        return None;
    }
    let ifd0 = read_tiff_u32(bytes.get(4..8)?, endian)? as usize;
    (ifd0 < bytes.len()).then_some((endian, ifd0))
}

fn parse_tiff_ifd_entries(
    bytes: &[u8],
    endian: TiffEndian,
    ifd_offset: usize,
) -> Option<Vec<TiffEntry>> {
    let count = read_tiff_u16(bytes.get(ifd_offset..ifd_offset + 2)?, endian)? as usize;
    let entries_start = ifd_offset.checked_add(2)?;
    let entries_len = count.checked_mul(12)?;
    let entries_end = entries_start.checked_add(entries_len)?;
    let entries_bytes = bytes.get(entries_start..entries_end)?;
    let mut entries = Vec::with_capacity(count);
    for entry in entries_bytes.chunks_exact(12) {
        entries.push(TiffEntry {
            tag: read_tiff_u16(&entry[0..2], endian)?,
            field_type: read_tiff_u16(&entry[2..4], endian)?,
            count: read_tiff_u32(&entry[4..8], endian)?,
            value_or_offset: read_tiff_u32(&entry[8..12], endian)?,
        });
    }
    Some(entries)
}

fn read_tiff_u16(bytes: &[u8], endian: TiffEndian) -> Option<u16> {
    match endian {
        TiffEndian::Little => le_u16(bytes),
        TiffEndian::Big => be_u16(bytes),
    }
}

fn read_tiff_u32(bytes: &[u8], endian: TiffEndian) -> Option<u32> {
    match endian {
        TiffEndian::Little => le_u32(bytes),
        TiffEndian::Big => be_u32(bytes),
    }
}

fn tiff_entry_short_value(entry: &TiffEntry, endian: TiffEndian) -> Option<u16> {
    if entry.field_type != 3 || entry.count != 1 {
        return None;
    }
    let inline = entry.value_or_offset.to_be_bytes();
    match endian {
        TiffEndian::Little => Some(entry.value_or_offset as u16),
        TiffEndian::Big => be_u16(&inline[0..2]),
    }
}

fn tiff_entry_rational_value(entry: &TiffEntry, endian: TiffEndian, bytes: &[u8]) -> Option<f64> {
    if entry.field_type != 5 || entry.count != 1 {
        return None;
    }
    let offset = tiff_entry_offset(entry, bytes)?;
    let numerator_end = offset.checked_add(4)?;
    let denominator_end = offset.checked_add(8)?;
    let numerator = read_tiff_u32(bytes.get(offset..numerator_end)?, endian)?;
    let denominator = read_tiff_u32(bytes.get(numerator_end..denominator_end)?, endian)?;
    if denominator == 0 {
        return None;
    }
    Some(numerator as f64 / denominator as f64)
}

fn tiff_entry_offset(entry: &TiffEntry, bytes: &[u8]) -> Option<usize> {
    let offset = entry.value_or_offset as usize;
    (offset < bytes.len()).then_some(offset)
}

fn tiff_entry_payload_range(entry: &TiffEntry, bytes: &[u8]) -> Option<std::ops::Range<usize>> {
    let len = tiff_field_type_size(entry.field_type)?.checked_mul(entry.count as usize)?;
    if len <= 4 {
        return Some(0..len);
    }
    let start = tiff_entry_offset(entry, bytes)?;
    let end = start.checked_add(len)?;
    (end <= bytes.len()).then_some(start..end)
}

fn tiff_field_type_size(field_type: u16) -> Option<usize> {
    match field_type {
        1 | 2 | 6 | 7 => Some(1),
        3 | 8 => Some(2),
        4 | 9 | 11 => Some(4),
        5 | 10 | 12 => Some(8),
        _ => None,
    }
}

fn parse_iptc_datasets(bytes: &[u8]) -> Vec<IptcDatasetSummary> {
    let mut datasets = Vec::new();
    let mut cursor = 0usize;
    while cursor + 5 <= bytes.len() {
        if bytes[cursor] != 0x1c {
            cursor += 1;
            continue;
        }
        let record = bytes[cursor + 1];
        let dataset = bytes[cursor + 2];
        let Some((value_len, next_cursor)) = iptc_dataset_value_len(bytes, cursor + 3) else {
            break;
        };
        let Some(value_end) = next_cursor.checked_add(value_len) else {
            break;
        };
        if value_end > bytes.len() {
            break;
        }
        datasets.push(IptcDatasetSummary {
            record,
            dataset,
            name: iptc_dataset_name(record, dataset),
            value_len,
        });
        cursor = value_end;
    }
    datasets
}

fn iptc_dataset_value_len(bytes: &[u8], cursor: usize) -> Option<(usize, usize)> {
    let len_word = be_u16(bytes.get(cursor..cursor + 2)?)?;
    if len_word & 0x8000 == 0 {
        return Some((usize::from(len_word), cursor + 2));
    }
    let len_octets = usize::from(len_word & 0x7fff);
    if !(1..=4).contains(&len_octets) {
        return None;
    }
    let length_bytes = bytes.get(cursor + 2..cursor + 2 + len_octets)?;
    let mut value_len = 0usize;
    for byte in length_bytes {
        value_len = value_len
            .checked_mul(256)?
            .checked_add(usize::from(*byte))?;
    }
    Some((value_len, cursor + 2 + len_octets))
}

fn iptc_dataset_name(record: u8, dataset: u8) -> Option<&'static str> {
    match (record, dataset) {
        (2, 5) => Some("ObjectName"),
        (2, 10) => Some("Urgency"),
        (2, 15) => Some("Category"),
        (2, 20) => Some("SupplementalCategory"),
        (2, 25) => Some("Keywords"),
        (2, 55) => Some("DateCreated"),
        (2, 60) => Some("TimeCreated"),
        (2, 80) => Some("Byline"),
        (2, 85) => Some("BylineTitle"),
        (2, 90) => Some("City"),
        (2, 95) => Some("ProvinceState"),
        (2, 101) => Some("CountryName"),
        (2, 103) => Some("OriginalTransmissionReference"),
        (2, 105) => Some("Headline"),
        (2, 110) => Some("Credit"),
        (2, 115) => Some("Source"),
        (2, 116) => Some("CopyrightNotice"),
        (2, 120) => Some("Caption"),
        (2, 122) => Some("CaptionWriter"),
        _ => None,
    }
}

fn xmp_contains_orientation_semantics(input: &str) -> bool {
    xmp_orientation_names(input)
        .iter()
        .any(|name| xml_contains_attribute_or_element(input, name))
}

fn xmp_contains_edit_history_semantics(input: &str) -> bool {
    xmp_edit_history_names(input)
        .iter()
        .any(|name| xml_contains_element(input, name))
}

fn xmp_orientation_names(input: &str) -> Vec<String> {
    let mut names = semantic_xml_names(
        input,
        "http://ns.adobe.com/tiff/1.0/",
        &["tiff"],
        "Orientation",
    );
    names.extend(semantic_xml_names(
        input,
        "http://ns.adobe.com/exif/1.0/",
        &["exif"],
        "Orientation",
    ));
    dedup_strings(names)
}

fn xmp_edit_history_names(input: &str) -> Vec<String> {
    semantic_xml_names(
        input,
        "http://ns.adobe.com/xap/1.0/mm/",
        &["xmpMM"],
        "History",
    )
}

fn semantic_xml_names(
    input: &str,
    namespace: &str,
    builtin_prefixes: &[&str],
    local_name: &str,
) -> Vec<String> {
    let mut names = Vec::new();
    for prefix in builtin_prefixes {
        names.push(format!("{prefix}:{local_name}"));
    }
    for prefix in xml_prefixes_for_namespace(input, namespace) {
        match prefix {
            Some(prefix) => names.push(format!("{prefix}:{local_name}")),
            None => names.push(local_name.to_string()),
        }
    }
    dedup_strings(names)
}

fn xml_prefixes_for_namespace(input: &str, namespace: &str) -> Vec<Option<String>> {
    let mut prefixes = Vec::new();
    let mut cursor = 0usize;
    while let Some(relative) = input[cursor..].find("xmlns") {
        let start = cursor + relative;
        let after_xmlns = start + "xmlns".len();
        if start > 0 && is_xml_name_char(input.as_bytes()[start - 1]) {
            cursor = after_xmlns;
            continue;
        }
        let mut name_end = after_xmlns;
        let prefix = if input[after_xmlns..].starts_with(':') {
            name_end += 1;
            let prefix_start = name_end;
            while name_end < input.len() && is_xml_name_char(input.as_bytes()[name_end]) {
                name_end += 1;
            }
            if prefix_start == name_end {
                cursor = name_end;
                continue;
            }
            Some(input[prefix_start..name_end].to_string())
        } else {
            None
        };
        let Some(eq) = input[name_end..]
            .char_indices()
            .find_map(|(index, ch)| match ch {
                '=' => Some(name_end + index),
                ch if ch.is_whitespace() => None,
                _ => Some(usize::MAX),
            })
        else {
            break;
        };
        if eq == usize::MAX {
            cursor = name_end;
            continue;
        }
        let Some(quote_start) = input[eq + 1..]
            .char_indices()
            .find(|(_, ch)| !ch.is_whitespace())
            .map(|(index, _)| eq + 1 + index)
        else {
            break;
        };
        let quote = input.as_bytes()[quote_start];
        if quote != b'\'' && quote != b'"' {
            cursor = quote_start + 1;
            continue;
        }
        let Some(value_end_relative) = input[quote_start + 1..].find(quote as char) else {
            break;
        };
        let value_start = quote_start + 1;
        let value_end = value_start + value_end_relative;
        if &input[value_start..value_end] == namespace {
            prefixes.push(prefix);
        }
        cursor = value_end + 1;
    }
    prefixes
}

fn dedup_strings(names: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    for name in names {
        if !deduped.contains(&name) {
            deduped.push(name);
        }
    }
    deduped
}

fn xml_contains_attribute_or_element(input: &str, name: &str) -> bool {
    input.contains(&format!("<{name}"))
        || input.contains(&format!(" {name}="))
        || input.contains(&format!("\n{name}="))
        || input.contains(&format!("\t{name}="))
        || input.contains(&format!("\r{name}="))
}

fn xml_contains_element(input: &str, name: &str) -> bool {
    input.contains(&format!("<{name}"))
}

fn is_xml_name_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':')
}

fn remove_xml_attribute(input: &str, name: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0usize;
    while let Some(relative) = input[cursor..].find(name) {
        let name_start = cursor + relative;
        let Some(eq_relative) = input[name_start + name.len()..].find('=') else {
            break;
        };
        let eq = name_start + name.len() + eq_relative;
        if !input[name_start + name.len()..eq]
            .chars()
            .all(char::is_whitespace)
        {
            out.push_str(&input[cursor..name_start + name.len()]);
            cursor = name_start + name.len();
            continue;
        }
        let quote_start = input[eq + 1..]
            .char_indices()
            .find(|(_, ch)| !ch.is_whitespace())
            .map(|(index, _)| eq + 1 + index);
        let Some(quote_start) = quote_start else {
            break;
        };
        let quote = input.as_bytes()[quote_start];
        if quote != b'\'' && quote != b'"' {
            out.push_str(&input[cursor..name_start + name.len()]);
            cursor = name_start + name.len();
            continue;
        }
        let Some(value_end_relative) = input[quote_start + 1..].find(quote as char) else {
            break;
        };
        let mut remove_start = name_start;
        while remove_start > cursor && input.as_bytes()[remove_start - 1].is_ascii_whitespace() {
            remove_start -= 1;
        }
        out.push_str(&input[cursor..remove_start]);
        cursor = quote_start + 1 + value_end_relative + 1;
    }
    out.push_str(&input[cursor..]);
    out
}

fn remove_xml_element(input: &str, name: &str) -> String {
    let close = format!("</{name}>");
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0usize;
    while let Some(start_relative) = input[cursor..].find(&format!("<{name}")) {
        let start = cursor + start_relative;
        let name_end = start + 1 + name.len();
        let Some(after_name) = input[name_end..].chars().next() else {
            break;
        };
        if !matches!(after_name, '>' | '/' | ' ' | '\t' | '\r' | '\n') {
            out.push_str(&input[cursor..name_end]);
            cursor = name_end;
            continue;
        }
        let Some(open_end_relative) = input[name_end..].find('>') else {
            break;
        };
        let open_end = name_end + open_end_relative + 1;
        if input[start..open_end].trim_end().ends_with("/>") {
            out.push_str(&input[cursor..start]);
            cursor = open_end;
            continue;
        }
        let Some(close_relative) = input[open_end..].find(&close) else {
            break;
        };
        let end = open_end + close_relative + close.len();
        out.push_str(&input[cursor..start]);
        cursor = end;
    }
    out.push_str(&input[cursor..]);
    out
}

fn metadata_from_image_format(bytes: &[u8], format: Format) -> Metadata {
    match format {
        Format::Jpeg => extract_jpeg_metadata(bytes, true),
        Format::Png => extract_png_metadata(bytes, true),
        Format::WebP => extract_webp_metadata(bytes),
        Format::Avif => extract_avif_metadata(bytes),
    }
}

fn metadata_blob(bytes: &[u8]) -> Option<Vec<u8>> {
    (!bytes.is_empty() && bytes.len() <= MAX_METADATA_BLOB_BYTES).then(|| bytes.to_vec())
}

fn read_zlib_metadata_limited(compressed: &[u8]) -> Option<Vec<u8>> {
    let decoder = ZlibDecoder::new(compressed);
    let mut limited = decoder.take((MAX_METADATA_BLOB_BYTES + 1) as u64);
    let mut out = Vec::new();
    limited.read_to_end(&mut out).ok()?;
    (!out.is_empty() && out.len() <= MAX_METADATA_BLOB_BYTES).then_some(out)
}

fn validate_metadata_blob_for_encode(label: &str, bytes: &[u8]) -> Result<()> {
    if bytes.len() > MAX_METADATA_BLOB_BYTES {
        Err(Error::Encode(format!(
            "{label} metadata 超过 {} 字节上限",
            MAX_METADATA_BLOB_BYTES
        )))
    } else {
        Ok(())
    }
}

// ---------- JPEG metadata ----------

const JPEG_EXIF_PREFIX: &[u8; 6] = b"Exif\0\0";
const JPEG_ICC_PREFIX: &[u8; 12] = b"ICC_PROFILE\0";
const JPEG_XMP_PREFIX: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const JPEG_EXTENDED_XMP_PREFIX: &[u8] = b"http://ns.adobe.com/xmp/extension/\0";
const JPEG_PHOTOSHOP_PREFIX: &[u8] = b"Photoshop 3.0\0";
const JPEG_IPTC_RESOURCE_ID: u16 = 0x0404;
const JPEG_EXTENDED_XMP_GUID_LEN: usize = 32;
const JPEG_APP_DATA_LIMIT: usize = 65_533;
const JPEG_ICC_CHUNK_HEADER: usize = JPEG_ICC_PREFIX.len() + 2;
const JPEG_ICC_CHUNK_PAYLOAD_LIMIT: usize = JPEG_APP_DATA_LIMIT - JPEG_ICC_CHUNK_HEADER;
const JPEG_EXTENDED_XMP_CHUNK_HEADER: usize =
    JPEG_EXTENDED_XMP_PREFIX.len() + JPEG_EXTENDED_XMP_GUID_LEN + 8;
const JPEG_EXTENDED_XMP_CHUNK_PAYLOAD_LIMIT: usize =
    JPEG_APP_DATA_LIMIT - JPEG_EXTENDED_XMP_CHUNK_HEADER;

struct JpegExtendedXmpSegment {
    guid: [u8; JPEG_EXTENDED_XMP_GUID_LEN],
    total_size: usize,
    offset: usize,
    data: Vec<u8>,
}

fn extract_jpeg_metadata(bytes: &[u8], normalize_exif: bool) -> Metadata {
    let mut metadata = Metadata::default();
    if bytes.len() < 4 || bytes[0..2] != [0xff, 0xd8] {
        return metadata;
    }

    let mut icc_chunks: Vec<Option<Vec<u8>>> = Vec::new();
    let mut icc_count = 0usize;
    let mut extended_xmp_segments = Vec::new();
    let mut offset = 2usize;
    while offset < bytes.len() {
        while offset < bytes.len() && bytes[offset] != 0xff {
            offset += 1;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        if offset >= bytes.len() {
            break;
        }

        let marker = bytes[offset];
        offset += 1;
        if marker == 0xda || marker == 0xd9 {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if offset + 2 > bytes.len() {
            break;
        }

        let Some(segment_length) = be_u16(&bytes[offset..offset + 2]).map(usize::from) else {
            break;
        };
        if segment_length < 2 {
            break;
        }
        let data_start = offset + 2;
        let data_length = segment_length - 2;
        let Some(data_end) = data_start.checked_add(data_length) else {
            break;
        };
        if data_end > bytes.len() {
            break;
        }
        let data = &bytes[data_start..data_end];

        if marker == 0xe1 && metadata.exif.is_none() && data.starts_with(JPEG_EXIF_PREFIX) {
            let Some(exif) = metadata_blob(&data[JPEG_EXIF_PREFIX.len()..]) else {
                offset = data_end;
                continue;
            };
            metadata.exif = Some(if normalize_exif {
                normalize_exif_orientation(exif)
            } else {
                exif
            });
        } else if marker == 0xe1 && metadata.xmp.is_none() && data.starts_with(JPEG_XMP_PREFIX) {
            metadata.xmp = metadata_blob(&data[JPEG_XMP_PREFIX.len()..]);
        } else if marker == 0xe1 && data.starts_with(JPEG_EXTENDED_XMP_PREFIX) {
            if let Some(segment) = parse_jpeg_extended_xmp_segment(data) {
                extended_xmp_segments.push(segment);
            }
        } else if marker == 0xe2
            && data.len() >= JPEG_ICC_CHUNK_HEADER
            && &data[..JPEG_ICC_PREFIX.len()] == JPEG_ICC_PREFIX
        {
            let seq = data[JPEG_ICC_PREFIX.len()] as usize;
            let count = data[JPEG_ICC_PREFIX.len() + 1] as usize;
            if seq > 0 && count > 0 && seq <= count {
                if icc_count != count {
                    icc_count = count;
                    icc_chunks = vec![None; count];
                }
                if icc_chunks[seq - 1].is_none() {
                    icc_chunks[seq - 1] = Some(data[JPEG_ICC_CHUNK_HEADER..].to_vec());
                }
            }
        } else if marker == 0xed
            && metadata.iptc.is_none()
            && data.starts_with(JPEG_PHOTOSHOP_PREFIX)
        {
            metadata.iptc = extract_jpeg_photoshop_iptc(data);
        }

        offset = data_end;
    }

    if icc_count > 0 && icc_chunks.iter().all(Option::is_some) {
        let total = icc_chunks
            .iter()
            .filter_map(Option::as_ref)
            .map(Vec::len)
            .sum();
        if total <= MAX_METADATA_BLOB_BYTES {
            let mut icc = Vec::with_capacity(total);
            for chunk in icc_chunks.into_iter().flatten() {
                icc.extend_from_slice(&chunk);
            }
            if !icc.is_empty() {
                metadata.icc = Some(icc);
            }
        }
    }

    if let Some(xmp) = reassemble_jpeg_extended_xmp(&extended_xmp_segments) {
        metadata.xmp = Some(xmp);
    }

    metadata
}

fn parse_jpeg_extended_xmp_segment(data: &[u8]) -> Option<JpegExtendedXmpSegment> {
    if !data.starts_with(JPEG_EXTENDED_XMP_PREFIX) {
        return None;
    }
    let mut cursor = JPEG_EXTENDED_XMP_PREFIX.len();
    let guid = data.get(cursor..cursor + JPEG_EXTENDED_XMP_GUID_LEN)?;
    let guid: [u8; JPEG_EXTENDED_XMP_GUID_LEN] = guid.try_into().ok()?;
    cursor += JPEG_EXTENDED_XMP_GUID_LEN;
    let total_size = be_u32(data.get(cursor..cursor + 4)?)? as usize;
    cursor += 4;
    let offset = be_u32(data.get(cursor..cursor + 4)?)? as usize;
    cursor += 4;
    let payload = data.get(cursor..)?.to_vec();
    if total_size == 0 || total_size > MAX_METADATA_BLOB_BYTES || payload.is_empty() {
        return None;
    }
    let end = offset.checked_add(payload.len())?;
    if end > total_size {
        return None;
    }

    Some(JpegExtendedXmpSegment {
        guid,
        total_size,
        offset,
        data: payload,
    })
}

fn reassemble_jpeg_extended_xmp(segments: &[JpegExtendedXmpSegment]) -> Option<Vec<u8>> {
    let first = segments.first()?;
    if first.total_size == 0 || first.total_size > MAX_METADATA_BLOB_BYTES {
        return None;
    }
    let mut xmp = vec![0u8; first.total_size];
    let mut coverage = vec![false; first.total_size];

    for segment in segments {
        if segment.guid != first.guid || segment.total_size != first.total_size {
            return None;
        }
        let end = segment.offset.checked_add(segment.data.len())?;
        if end > first.total_size
            || segment.data.is_empty()
            || coverage[segment.offset..end].iter().any(|covered| *covered)
        {
            return None;
        }
        xmp[segment.offset..end].copy_from_slice(&segment.data);
        coverage[segment.offset..end].fill(true);
    }

    coverage.iter().all(|covered| *covered).then_some(xmp)
}

fn extract_jpeg_photoshop_iptc(data: &[u8]) -> Option<Vec<u8>> {
    let mut cursor = JPEG_PHOTOSHOP_PREFIX.len();
    while cursor + 12 <= data.len() {
        let signature = data.get(cursor..cursor + 4)?;
        if signature != b"8BIM" && signature != b"8B64" {
            return None;
        }
        cursor += 4;
        let resource_id = be_u16(data.get(cursor..cursor + 2)?)?;
        cursor += 2;

        let name_len = usize::from(*data.get(cursor)?);
        cursor += 1;
        cursor = cursor.checked_add(name_len)?;
        if cursor > data.len() {
            return None;
        }
        if (1 + name_len) % 2 == 1 {
            cursor += 1;
        }

        let resource_len = be_u32(data.get(cursor..cursor + 4)?)? as usize;
        cursor += 4;
        let resource_end = cursor.checked_add(resource_len)?;
        if resource_end > data.len() {
            return None;
        }
        if resource_id == JPEG_IPTC_RESOURCE_ID {
            return metadata_blob(&data[cursor..resource_end]);
        }
        cursor = resource_end + (resource_len % 2);
    }
    None
}

fn insert_jpeg_metadata(mut jpeg: Vec<u8>, metadata: &Metadata) -> Result<Vec<u8>> {
    if metadata.is_empty() {
        return Ok(jpeg);
    }
    if jpeg.len() < 2 || jpeg[0..2] != [0xff, 0xd8] {
        return Err(Error::Encode("JPEG SOI 缺失,无法写入元数据".into()));
    }

    let mut app_segments = Vec::new();
    if let Some(exif) = metadata.exif.as_deref().filter(|exif| !exif.is_empty()) {
        validate_metadata_blob_for_encode("EXIF", exif)?;
        let data_len = JPEG_EXIF_PREFIX.len() + exif.len();
        if data_len > JPEG_APP_DATA_LIMIT {
            return Err(Error::Encode("EXIF 超过 JPEG APP1 上限".into()));
        }
        app_segments.extend_from_slice(&[0xff, 0xe1]);
        app_segments.extend_from_slice(&((data_len + 2) as u16).to_be_bytes());
        app_segments.extend_from_slice(JPEG_EXIF_PREFIX);
        app_segments.extend_from_slice(exif);
    }
    if let Some(xmp) = metadata.xmp.as_deref().filter(|xmp| !xmp.is_empty()) {
        write_jpeg_xmp_segments(&mut app_segments, xmp)?;
    }
    if let Some(iptc) = metadata.iptc.as_deref().filter(|iptc| !iptc.is_empty()) {
        write_jpeg_iptc_segment(&mut app_segments, iptc)?;
    }
    if let Some(icc) = metadata.icc.as_deref().filter(|icc| !icc.is_empty()) {
        validate_metadata_blob_for_encode("ICC", icc)?;
        let chunk_count = icc.len().div_ceil(JPEG_ICC_CHUNK_PAYLOAD_LIMIT);
        if chunk_count == 0 || chunk_count > 255 {
            return Err(Error::Encode("ICC 超过 JPEG APP2 分块上限".into()));
        }
        for (index, chunk) in icc.chunks(JPEG_ICC_CHUNK_PAYLOAD_LIMIT).enumerate() {
            let data_len = JPEG_ICC_CHUNK_HEADER + chunk.len();
            app_segments.extend_from_slice(&[0xff, 0xe2]);
            app_segments.extend_from_slice(&((data_len + 2) as u16).to_be_bytes());
            app_segments.extend_from_slice(JPEG_ICC_PREFIX);
            app_segments.push((index + 1) as u8);
            app_segments.push(chunk_count as u8);
            app_segments.extend_from_slice(chunk);
        }
    }

    let mut out = Vec::with_capacity(jpeg.len() + app_segments.len());
    out.extend_from_slice(&jpeg[..2]);
    out.extend_from_slice(&app_segments);
    out.append(&mut jpeg.split_off(2));
    Ok(out)
}

fn write_jpeg_iptc_segment(out: &mut Vec<u8>, iptc: &[u8]) -> Result<()> {
    validate_metadata_blob_for_encode("IPTC", iptc)?;
    let mut data = Vec::with_capacity(JPEG_PHOTOSHOP_PREFIX.len() + 12 + iptc.len());
    data.extend_from_slice(JPEG_PHOTOSHOP_PREFIX);
    data.extend_from_slice(b"8BIM");
    data.extend_from_slice(&JPEG_IPTC_RESOURCE_ID.to_be_bytes());
    data.push(0); // empty Pascal resource name
    data.push(0); // pad Pascal name to even length including the length byte
    let iptc_len = u32::try_from(iptc.len())
        .map_err(|_| Error::Encode("IPTC 超过 JPEG APP13 资源长度上限".into()))?;
    data.extend_from_slice(&iptc_len.to_be_bytes());
    data.extend_from_slice(iptc);
    if iptc.len() % 2 == 1 {
        data.push(0);
    }
    if data.len() > JPEG_APP_DATA_LIMIT {
        return Err(Error::Encode("IPTC 超过 JPEG APP13 上限".into()));
    }
    write_jpeg_app_segment(out, 0xed, &[], &data)
}

fn write_jpeg_xmp_segments(out: &mut Vec<u8>, xmp: &[u8]) -> Result<()> {
    validate_metadata_blob_for_encode("XMP", xmp)?;
    let data_len = JPEG_XMP_PREFIX.len() + xmp.len();
    if data_len <= JPEG_APP_DATA_LIMIT {
        write_jpeg_app_segment(out, 0xe1, JPEG_XMP_PREFIX, xmp)?;
        return Ok(());
    }

    let total_size = u32::try_from(xmp.len())
        .map_err(|_| Error::Encode("XMP 超过 JPEG Extended XMP 总长上限".into()))?;
    let guid = jpeg_extended_xmp_guid(xmp);
    let stub = jpeg_extended_xmp_stub(&guid)?;
    write_jpeg_app_segment(out, 0xe1, JPEG_XMP_PREFIX, &stub)?;

    let mut offset = 0usize;
    for chunk in xmp.chunks(JPEG_EXTENDED_XMP_CHUNK_PAYLOAD_LIMIT) {
        let offset_u32 = u32::try_from(offset)
            .map_err(|_| Error::Encode("XMP Extended XMP 偏移超过 u32 上限".into()))?;
        let mut payload = Vec::with_capacity(JPEG_EXTENDED_XMP_CHUNK_HEADER + chunk.len());
        payload.extend_from_slice(JPEG_EXTENDED_XMP_PREFIX);
        payload.extend_from_slice(&guid);
        payload.extend_from_slice(&total_size.to_be_bytes());
        payload.extend_from_slice(&offset_u32.to_be_bytes());
        payload.extend_from_slice(chunk);
        write_jpeg_app_segment(out, 0xe1, &[], &payload)?;
        offset += chunk.len();
    }
    Ok(())
}

fn jpeg_extended_xmp_guid(xmp: &[u8]) -> [u8; JPEG_EXTENDED_XMP_GUID_LEN] {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let digest = Md5::digest(xmp);
    let mut guid = [0u8; JPEG_EXTENDED_XMP_GUID_LEN];
    for (index, byte) in digest.iter().enumerate() {
        guid[index * 2] = HEX[(byte >> 4) as usize];
        guid[index * 2 + 1] = HEX[(byte & 0x0f) as usize];
    }
    guid
}

fn jpeg_extended_xmp_stub(guid: &[u8; JPEG_EXTENDED_XMP_GUID_LEN]) -> Result<Vec<u8>> {
    let guid = std::str::from_utf8(guid)
        .map_err(|_| Error::Encode("JPEG Extended XMP GUID 非 UTF-8".into()))?;
    Ok(format!(
        r#"<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmpNote="http://ns.adobe.com/xmp/note/" xmpNote:HasExtendedXMP="{guid}"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>"#
    )
    .into_bytes())
}

fn write_jpeg_app_segment(
    out: &mut Vec<u8>,
    marker: u8,
    prefix: &[u8],
    payload: &[u8],
) -> Result<()> {
    let data_len = prefix
        .len()
        .checked_add(payload.len())
        .ok_or_else(|| Error::Encode("JPEG APP segment 长度溢出".into()))?;
    if data_len > JPEG_APP_DATA_LIMIT {
        return Err(Error::Encode("JPEG APP segment 超过长度上限".into()));
    }
    out.extend_from_slice(&[0xff, marker]);
    out.extend_from_slice(&((data_len + 2) as u16).to_be_bytes());
    out.extend_from_slice(prefix);
    out.extend_from_slice(payload);
    Ok(())
}

// ---------- PNG metadata ----------

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const PNG_XMP_KEYWORD: &[u8] = b"XML:com.adobe.xmp";

fn extract_png_metadata(bytes: &[u8], normalize_exif: bool) -> Metadata {
    let mut metadata = Metadata::default();
    if bytes.len() < PNG_SIGNATURE.len() || &bytes[..PNG_SIGNATURE.len()] != PNG_SIGNATURE {
        return metadata;
    }

    let mut offset = PNG_SIGNATURE.len();
    while offset + 8 <= bytes.len() {
        let Some(length) = be_u32(&bytes[offset..offset + 4]).map(|value| value as usize) else {
            break;
        };
        let chunk = &bytes[offset + 4..offset + 8];
        let data_start = offset + 8;
        let Some(data_end) = data_start.checked_add(length) else {
            break;
        };
        let Some(next_offset) = data_end.checked_add(4) else {
            break;
        };
        if next_offset > bytes.len() {
            break;
        }
        let data = &bytes[data_start..data_end];

        if chunk == b"iCCP" && metadata.icc.is_none() {
            metadata.icc = extract_png_iccp(data);
        } else if chunk == b"eXIf" && metadata.exif.is_none() && !data.is_empty() {
            if let Some(exif) = metadata_blob(data) {
                metadata.exif = Some(if normalize_exif {
                    normalize_exif_orientation(exif)
                } else {
                    exif
                });
            }
        } else if chunk == b"iTXt" && metadata.xmp.is_none() {
            metadata.xmp = extract_png_xmp_itxt(data);
        }
        if chunk == b"IEND" {
            break;
        }

        offset = next_offset;
    }

    metadata
}

fn extract_png_iccp(data: &[u8]) -> Option<Vec<u8>> {
    let name_end = data.iter().position(|byte| *byte == 0)?;
    let compression_method = *data.get(name_end + 1)?;
    if compression_method != 0 {
        return None;
    }
    let compressed = data.get(name_end + 2..)?;
    read_zlib_metadata_limited(compressed)
}

fn extract_png_xmp_itxt(data: &[u8]) -> Option<Vec<u8>> {
    let keyword_end = data.iter().position(|byte| *byte == 0)?;
    if &data[..keyword_end] != PNG_XMP_KEYWORD {
        return None;
    }

    let rest = data.get(keyword_end + 1..)?;
    let compression_flag = *rest.first()?;
    let compression_method = *rest.get(1)?;
    if compression_method != 0 {
        return None;
    }

    let language_start = 2usize;
    let language_len = rest
        .get(language_start..)?
        .iter()
        .position(|byte| *byte == 0)?;
    let translated_start = language_start + language_len + 1;
    let translated_len = rest
        .get(translated_start..)?
        .iter()
        .position(|byte| *byte == 0)?;
    let xmp_start = translated_start + translated_len + 1;
    let payload = rest.get(xmp_start..)?;
    let xmp = match compression_flag {
        0 => metadata_blob(payload)?,
        1 => read_zlib_metadata_limited(payload)?,
        _ => return None,
    };
    Some(xmp)
}

fn insert_png_metadata(png: Vec<u8>, metadata: &Metadata) -> Result<Vec<u8>> {
    if metadata.is_empty() {
        return Ok(png);
    }
    if png.len() < PNG_SIGNATURE.len() || &png[..PNG_SIGNATURE.len()] != PNG_SIGNATURE {
        return Err(Error::Encode("PNG signature 缺失,无法写入元数据".into()));
    }

    let mut out = Vec::with_capacity(
        png.len()
            + metadata.icc.as_ref().map_or(0, Vec::len)
            + metadata.xmp.as_ref().map_or(0, Vec::len),
    );
    out.extend_from_slice(PNG_SIGNATURE);

    let mut inserted = false;
    let mut offset = PNG_SIGNATURE.len();
    while offset + 8 <= png.len() {
        let length = be_u32(&png[offset..offset + 4])
            .ok_or_else(|| Error::Encode("PNG chunk 长度缺失".into()))?
            as usize;
        let chunk = &png[offset + 4..offset + 8];
        let data_start = offset + 8;
        let data_end = data_start
            .checked_add(length)
            .ok_or_else(|| Error::Encode("PNG chunk 长度溢出".into()))?;
        let next_offset = data_end
            .checked_add(4)
            .ok_or_else(|| Error::Encode("PNG chunk 偏移溢出".into()))?;
        if next_offset > png.len() {
            return Err(Error::Encode("PNG chunk 截断,无法写入元数据".into()));
        }

        if !is_replaced_png_metadata_chunk(chunk, &png[data_start..data_end]) {
            out.extend_from_slice(&png[offset..next_offset]);
        }
        if chunk == b"IHDR" && !inserted {
            write_png_metadata_chunks(&mut out, metadata)?;
            inserted = true;
        }
        if chunk == b"IEND" {
            break;
        }

        offset = next_offset;
    }

    if !inserted {
        return Err(Error::Encode("PNG IHDR 缺失,无法写入元数据".into()));
    }
    Ok(out)
}

fn is_replaced_png_metadata_chunk(chunk: &[u8], data: &[u8]) -> bool {
    chunk == b"iCCP" || chunk == b"eXIf" || (chunk == b"iTXt" && is_png_xmp_itxt(data))
}

fn is_png_xmp_itxt(data: &[u8]) -> bool {
    data.get(..PNG_XMP_KEYWORD.len()) == Some(PNG_XMP_KEYWORD)
        && data.get(PNG_XMP_KEYWORD.len()) == Some(&0)
}

fn write_png_metadata_chunks(out: &mut Vec<u8>, metadata: &Metadata) -> Result<()> {
    if let Some(icc) = metadata.icc.as_deref().filter(|icc| !icc.is_empty()) {
        validate_metadata_blob_for_encode("ICC", icc)?;
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(icc)
            .map_err(|e| Error::Encode(format!("压缩 PNG iCCP: {e}")))?;
        let compressed = encoder
            .finish()
            .map_err(|e| Error::Encode(format!("压缩 PNG iCCP: {e}")))?;
        let mut data = Vec::with_capacity("ICC Profile".len() + 2 + compressed.len());
        data.extend_from_slice(b"ICC Profile");
        data.push(0);
        data.push(0);
        data.extend_from_slice(&compressed);
        write_png_chunk(out, b"iCCP", &data)?;
    }
    if let Some(exif) = metadata.exif.as_deref().filter(|exif| !exif.is_empty()) {
        validate_metadata_blob_for_encode("EXIF", exif)?;
        write_png_chunk(out, b"eXIf", exif)?;
    }
    if let Some(xmp) = metadata.xmp.as_deref().filter(|xmp| !xmp.is_empty()) {
        validate_metadata_blob_for_encode("XMP", xmp)?;
        let mut data = Vec::with_capacity(PNG_XMP_KEYWORD.len() + 5 + xmp.len());
        data.extend_from_slice(PNG_XMP_KEYWORD);
        data.push(0);
        data.push(0); // uncompressed
        data.push(0); // zlib compression method field, ignored when uncompressed
        data.push(0); // empty language tag
        data.push(0); // empty translated keyword
        data.extend_from_slice(xmp);
        write_png_chunk(out, b"iTXt", &data)?;
    }
    Ok(())
}

fn write_png_chunk(out: &mut Vec<u8>, name: &[u8; 4], data: &[u8]) -> Result<()> {
    let length = u32::try_from(data.len())
        .map_err(|_| Error::Encode("PNG metadata chunk 超过 u32 上限".into()))?;
    out.extend_from_slice(&length.to_be_bytes());
    out.extend_from_slice(name);
    out.extend_from_slice(data);
    let mut crc_input = Vec::with_capacity(name.len() + data.len());
    crc_input.extend_from_slice(name);
    crc_input.extend_from_slice(data);
    out.extend_from_slice(&crc32fast::hash(&crc_input).to_be_bytes());
    Ok(())
}

// ---------- WebP metadata ----------

const WEBP_HEADER_LEN: usize = 12;
const WEBP_FLAG_ICC: u8 = 0x20;
const WEBP_FLAG_ALPHA: u8 = 0x10;
const WEBP_FLAG_EXIF: u8 = 0x08;
const WEBP_FLAG_XMP: u8 = 0x04;

fn extract_webp_metadata(bytes: &[u8]) -> Metadata {
    let mut metadata = Metadata::default();
    let Ok(chunks) = parse_webp_chunks(bytes) else {
        return metadata;
    };
    for chunk in chunks {
        if chunk.fourcc == *b"ICCP" && metadata.icc.is_none() && !chunk.data.is_empty() {
            metadata.icc = metadata_blob(chunk.data);
        } else if chunk.fourcc == *b"EXIF" && metadata.exif.is_none() && !chunk.data.is_empty() {
            metadata.exif = metadata_blob(chunk.data);
        } else if chunk.fourcc == *b"XMP " && metadata.xmp.is_none() && !chunk.data.is_empty() {
            metadata.xmp = metadata_blob(chunk.data);
        }
    }
    metadata
}

#[derive(Clone, Copy)]
struct WebpChunk<'a> {
    fourcc: [u8; 4],
    data: &'a [u8],
}

fn parse_webp_chunks(bytes: &[u8]) -> Result<Vec<WebpChunk<'_>>> {
    if bytes.len() < WEBP_HEADER_LEN || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return Err(Error::Decode("WebP RIFF 头不完整".into()));
    }

    let mut chunks = Vec::new();
    let mut offset = WEBP_HEADER_LEN;
    while offset + 8 <= bytes.len() {
        let fourcc: [u8; 4] = bytes[offset..offset + 4]
            .try_into()
            .map_err(|_| Error::Decode("WebP chunk fourcc 缺失".into()))?;
        let length = le_u32(&bytes[offset + 4..offset + 8])
            .ok_or_else(|| Error::Decode("WebP chunk 长度缺失".into()))?
            as usize;
        let data_start = offset + 8;
        let data_end = data_start
            .checked_add(length)
            .ok_or_else(|| Error::Decode("WebP chunk 长度溢出".into()))?;
        let next_offset = data_end
            .checked_add(length % 2)
            .ok_or_else(|| Error::Decode("WebP chunk padding 溢出".into()))?;
        if next_offset > bytes.len() {
            return Err(Error::Decode("WebP chunk 截断".into()));
        }
        chunks.push(WebpChunk {
            fourcc,
            data: &bytes[data_start..data_end],
        });
        offset = next_offset;
    }
    Ok(chunks)
}

fn insert_webp_metadata(
    webp: Vec<u8>,
    width: u32,
    height: u32,
    has_alpha: bool,
    metadata: &Metadata,
) -> Result<Vec<u8>> {
    if metadata.is_empty() {
        return Ok(webp);
    }
    let chunks = parse_webp_chunks(&webp).map_err(|e| Error::Encode(e.to_string()))?;
    let existing_vp8x = chunks
        .iter()
        .find(|chunk| chunk.fourcc == *b"VP8X")
        .map(|chunk| chunk.data);

    let mut vp8x = if let Some(data) = existing_vp8x {
        if data.len() != 10 {
            return Err(Error::Encode("WebP VP8X chunk 长度非法".into()));
        }
        data.to_vec()
    } else {
        make_vp8x_data(width, height, has_alpha)?
    };
    vp8x[0] &= !(WEBP_FLAG_ICC | WEBP_FLAG_ALPHA | WEBP_FLAG_EXIF | WEBP_FLAG_XMP);
    if has_alpha {
        vp8x[0] |= WEBP_FLAG_ALPHA;
    }
    if metadata.icc.as_ref().is_some_and(|icc| !icc.is_empty()) {
        vp8x[0] |= WEBP_FLAG_ICC;
    }
    if metadata.exif.as_ref().is_some_and(|exif| !exif.is_empty()) {
        vp8x[0] |= WEBP_FLAG_EXIF;
    }
    if metadata.xmp.as_ref().is_some_and(|xmp| !xmp.is_empty()) {
        vp8x[0] |= WEBP_FLAG_XMP;
    }

    let mut out = Vec::with_capacity(
        webp.len()
            + metadata.icc.as_ref().map_or(0, Vec::len)
            + metadata.xmp.as_ref().map_or(0, Vec::len),
    );
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(b"WEBP");
    write_webp_chunk(&mut out, b"VP8X", &vp8x)?;
    if let Some(icc) = metadata.icc.as_deref().filter(|icc| !icc.is_empty()) {
        validate_metadata_blob_for_encode("ICC", icc)?;
        write_webp_chunk(&mut out, b"ICCP", icc)?;
    }
    for chunk in chunks {
        if matches!(&chunk.fourcc, b"VP8X" | b"ICCP" | b"EXIF" | b"XMP ") {
            continue;
        }
        write_webp_chunk(&mut out, &chunk.fourcc, chunk.data)?;
    }
    if let Some(exif) = metadata.exif.as_deref().filter(|exif| !exif.is_empty()) {
        validate_metadata_blob_for_encode("EXIF", exif)?;
        write_webp_chunk(&mut out, b"EXIF", exif)?;
    }
    if let Some(xmp) = metadata.xmp.as_deref().filter(|xmp| !xmp.is_empty()) {
        validate_metadata_blob_for_encode("XMP", xmp)?;
        write_webp_chunk(&mut out, b"XMP ", xmp)?;
    }

    let riff_size = u32::try_from(out.len() - 8)
        .map_err(|_| Error::Encode("WebP RIFF 超过 u32 上限".into()))?;
    out[4..8].copy_from_slice(&riff_size.to_le_bytes());
    Ok(out)
}

fn make_vp8x_data(width: u32, height: u32, has_alpha: bool) -> Result<Vec<u8>> {
    if width == 0 || height == 0 || width > 16_777_216 || height > 16_777_216 {
        return Err(Error::Encode("WebP VP8X canvas 尺寸非法".into()));
    }
    let mut data = vec![0u8; 10];
    if has_alpha {
        data[0] |= WEBP_FLAG_ALPHA;
    }
    write_u24_le(&mut data[4..7], width - 1);
    write_u24_le(&mut data[7..10], height - 1);
    Ok(data)
}

fn write_u24_le(dst: &mut [u8], value: u32) {
    dst[0] = (value & 0xff) as u8;
    dst[1] = ((value >> 8) & 0xff) as u8;
    dst[2] = ((value >> 16) & 0xff) as u8;
}

fn write_webp_chunk(out: &mut Vec<u8>, fourcc: &[u8; 4], data: &[u8]) -> Result<()> {
    let length = u32::try_from(data.len())
        .map_err(|_| Error::Encode("WebP metadata chunk 超过 u32 上限".into()))?;
    out.extend_from_slice(fourcc);
    out.extend_from_slice(&length.to_le_bytes());
    out.extend_from_slice(data);
    if data.len() % 2 == 1 {
        out.push(0);
    }
    Ok(())
}

// ---------- JPEG ----------

struct JpegCodec;

impl Codec for JpegCodec {
    fn decode(&self, bytes: &[u8]) -> Result<ImageData> {
        let mut img = decode_via_image(bytes, image::ImageFormat::Jpeg)?;
        let metadata = metadata_from_image_format(bytes, Format::Jpeg);
        img.icc = metadata.icc;
        img.exif = metadata.exif;
        img.xmp = metadata.xmp;
        img.iptc = metadata.iptc;
        Ok(img)
    }

    fn encode(&self, img: &ImageData, opts: &EncodeOptions) -> Result<Vec<u8>> {
        img.validate()?;
        let quality = opts.quality_clamped();
        let width = img.width as usize;
        let height = img.height as usize;
        // JPEG 无 alpha:先把透明像素合成到背景,产出 RGB(避免透明区写入隐藏 RGB)。
        let rgb = img.flatten_to_rgb(JPEG_FLATTEN_BG);

        // catch_unwind 仅截 Rust panic;C 侧 segfault/abort 不在此列(靠 MAX_PIXELS 等约束)。
        let result = catch_unwind(AssertUnwindSafe(|| -> std::io::Result<Vec<u8>> {
            let mut comp = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_EXT_RGB);
            if !opts.jpeg_progressive {
                comp.set_fastest_defaults();
            }
            comp.set_size(width, height);
            comp.set_quality(quality);
            if opts.jpeg_progressive {
                comp.set_progressive_mode();
            }
            comp.set_use_scans_in_trellis(opts.jpeg_trellis);
            let mut started = comp.start_compress(Vec::new())?;
            started.write_scanlines(&rgb)?;
            started.finish()
        }));

        match result {
            Ok(Ok(data)) => {
                if opts.preserve_metadata {
                    insert_jpeg_metadata(
                        data,
                        &Metadata {
                            icc: img.icc.clone(),
                            exif: img.exif.clone(),
                            xmp: img.xmp.clone(),
                            iptc: img.iptc.clone(),
                        },
                    )
                } else {
                    Ok(data)
                }
            }
            Ok(Err(e)) => Err(Error::Encode(format!("mozjpeg: {e}"))),
            Err(payload) => {
                let msg = payload
                    .downcast_ref::<&str>()
                    .map(|s| s.to_string())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "未知 panic".into());
                Err(Error::Encode(format!("mozjpeg panic: {msg}")))
            }
        }
    }
}

// ---------- PNG ----------

struct PngCodec;

impl Codec for PngCodec {
    fn decode(&self, bytes: &[u8]) -> Result<ImageData> {
        let mut img = decode_via_image(bytes, image::ImageFormat::Png)?;
        let metadata = metadata_from_image_format(bytes, Format::Png);
        img.icc = metadata.icc;
        img.exif = metadata.exif;
        img.xmp = metadata.xmp;
        img.iptc = metadata.iptc;
        Ok(img)
    }

    fn encode(&self, img: &ImageData, opts: &EncodeOptions) -> Result<Vec<u8>> {
        img.validate()?;
        let preserves_rgba16 =
            matches!(&img.pixels, PixelBuffer::Rgba16(_)) && !opts.png_lossy_quantize;
        let raw = match &img.pixels {
            PixelBuffer::Rgba16(rgba16) if !opts.png_lossy_quantize => {
                encode_png_rgba16(img.width, img.height, rgba16)?
            }
            _ => {
                let source = img.rgba8_cow();
                let rgba = if opts.png_lossy_quantize {
                    quantize_rgba_for_png(&source, opts.png_quant_colors_clamped())
                } else {
                    source.into_owned()
                };
                encode_png_rgba(img.width, img.height, &rgba)?
            }
        };
        // 先用 image 编出基础 PNG,再用 oxipng 无损优化。
        let mut oxipng_options = oxipng::Options::from_preset(opts.png_oxipng_level_clamped());
        if preserves_rgba16 {
            oxipng_options.bit_depth_reduction = false;
        }
        let optimized = oxipng::optimize_from_memory(&raw, &oxipng_options)
            .map_err(|e| Error::Encode(format!("oxipng: {e}")))?;
        if opts.preserve_metadata {
            insert_png_metadata(
                optimized,
                &Metadata {
                    icc: img.icc.clone(),
                    exif: img.exif.clone(),
                    xmp: img.xmp.clone(),
                    iptc: img.iptc.clone(),
                },
            )
        } else {
            Ok(optimized)
        }
    }
}

fn quantize_rgba_for_png(rgba: &[u8], colors: usize) -> Vec<u8> {
    if rgba.len() < 4 {
        return rgba.to_vec();
    }
    let quantizer = color_quant::NeuQuant::new(10, colors.clamp(64, 256), rgba);
    let mut out = rgba.to_vec();
    for pixel in out.chunks_exact_mut(4) {
        quantizer.map_pixel(pixel);
    }
    out
}

// ---------- WebP ----------

struct WebpCodec;

impl Codec for WebpCodec {
    fn decode(&self, bytes: &[u8]) -> Result<ImageData> {
        // 预读头部:校验尺寸/上限、拒绝动画,避免直接把超大流喂给 libwebp。
        let feat = webp::BitstreamFeatures::new(bytes)
            .ok_or_else(|| Error::Decode("非法 WebP 头".into()))?;
        if feat.has_animation() {
            return Err(Error::Unsupported("动画 WebP 暂不支持".into()));
        }
        rgba_byte_len(feat.width(), feat.height())?; // 尺寸/上限守卫

        let decoded = webp::Decoder::new(bytes)
            .decode()
            .ok_or_else(|| Error::Decode("libwebp 解码失败".into()))?;
        let rgba = decoded.to_image().to_rgba8();
        let mut img = ImageData::new(rgba.width(), rgba.height(), rgba.into_raw())?;
        let metadata = metadata_from_image_format(bytes, Format::WebP);
        img.icc = metadata.icc;
        img.exif = metadata.exif;
        img.xmp = metadata.xmp;
        img.iptc = metadata.iptc;
        Ok(img)
    }

    fn encode(&self, img: &ImageData, opts: &EncodeOptions) -> Result<Vec<u8>> {
        img.validate()?;
        let rgba = img.rgba8_cow();
        let encoder = webp::Encoder::from_rgba(&rgba, img.width, img.height);
        let mut config =
            webp::WebPConfig::new().map_err(|_| Error::Encode("WebPConfig 初始化失败".into()))?;
        config.lossless = if opts.lossless { 1 } else { 0 };
        config.alpha_compression = if opts.lossless { 0 } else { 1 };
        config.quality = opts.quality_clamped();
        config.method = opts.webp_method_clamped();
        // libwebp applies near-lossless preprocessing only in its lossless mode.
        // Keep lossy encodes explicitly neutral even for direct core API callers.
        config.near_lossless = if opts.lossless {
            opts.webp_near_lossless_clamped()
        } else {
            100
        };
        config.use_sharp_yuv = i32::from(opts.webp_sharp_yuv);
        // encode_advanced 返回 Result(避免 encode()/encode_lossless() 内部 unwrap 直接 panic)。
        let mem = encoder
            .encode_advanced(&config)
            .map_err(|e| Error::Encode(format!("libwebp: {e:?}")))?;
        let encoded = mem.to_vec();
        if opts.preserve_metadata {
            let has_alpha = rgba.chunks_exact(4).any(|pixel| pixel[3] < 255);
            insert_webp_metadata(
                encoded,
                img.width,
                img.height,
                has_alpha,
                &Metadata {
                    icc: img.icc.clone(),
                    exif: img.exif.clone(),
                    xmp: img.xmp.clone(),
                    iptc: img.iptc.clone(),
                },
            )
        } else {
            Ok(encoded)
        }
    }
}

// ---------- AVIF(libavif-sys:rav1e 有损编码 + aom 无损编码 + dav1d 解码)----------

use libavif_sys as avif;

struct AvifCodec;

/// RAII:保证 C 资源在任何返回路径都被释放(替代 IIFE 清理,clippy 友好)。
struct ImageGuard(*mut avif::avifImage);
impl Drop for ImageGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { avif::avifImageDestroy(self.0) }
        }
    }
}
struct EncoderGuard(*mut avif::avifEncoder);
impl Drop for EncoderGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { avif::avifEncoderDestroy(self.0) }
        }
    }
}
struct DecoderGuard(*mut avif::avifDecoder);
impl Drop for DecoderGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { avif::avifDecoderDestroy(self.0) }
        }
    }
}
struct RwDataGuard(avif::avifRWData);
impl Drop for RwDataGuard {
    fn drop(&mut self) {
        unsafe { avif::avifRWDataFree(&mut self.0) }
    }
}

impl Codec for AvifCodec {
    fn decode(&self, bytes: &[u8]) -> Result<ImageData> {
        unsafe {
            let decoder = DecoderGuard(avif::avifDecoderCreate());
            if decoder.0.is_null() {
                return Err(Error::Decode("avifDecoderCreate 返回 null".into()));
            }
            if avif::avifDecoderSetIOMemory(decoder.0, bytes.as_ptr(), bytes.len())
                != avif::AVIF_RESULT_OK
            {
                return Err(Error::Decode("avifDecoderSetIOMemory 失败".into()));
            }
            if avif::avifDecoderParse(decoder.0) != avif::AVIF_RESULT_OK {
                return Err(Error::Decode("avifDecoderParse 失败".into()));
            }
            if avif::avifDecoderNextImage(decoder.0) != avif::AVIF_RESULT_OK {
                return Err(Error::Decode("avifDecoderNextImage 失败".into()));
            }
            let image = (*decoder.0).image; // 归 decoder 所有,随其一起释放
            if image.is_null() {
                return Err(Error::Decode("decoder.image 为 null".into()));
            }
            let (width, height) = ((*image).width, (*image).height);
            rgba_byte_len(width, height)?; // 尺寸/上限守卫,防超大分配

            let mut rgb: avif::avifRGBImage = std::mem::zeroed();
            avif::avifRGBImageSetDefaults(&mut rgb, image);
            rgb.format = avif::AVIF_RGB_FORMAT_RGBA;
            rgb.depth = 8;
            if avif::avifRGBImageAllocatePixels(&mut rgb) != avif::AVIF_RESULT_OK {
                return Err(Error::Decode("avifRGBImageAllocatePixels 失败".into()));
            }
            // Allocate 与 Free 之间不早返回:先无条件转换+拷贝,再 free,最后判错。
            let rgba = {
                let ok = avif::avifImageYUVToRGB(image, &mut rgb) == avif::AVIF_RESULT_OK;
                let buf = if ok {
                    // 按行拷成紧凑 RGBA(rowBytes 可能含填充)。
                    let row = width as usize * 4;
                    let mut buf = Vec::with_capacity(row * height as usize);
                    for y in 0..height as usize {
                        let src = rgb.pixels.add(y * rgb.rowBytes as usize);
                        buf.extend_from_slice(std::slice::from_raw_parts(src, row));
                    }
                    Some(buf)
                } else {
                    None
                };
                avif::avifRGBImageFreePixels(&mut rgb);
                buf.ok_or_else(|| Error::Decode("avifImageYUVToRGB 失败".into()))?
            };

            // ICC/EXIF 提取。EXIF 存为 TIFF payload,与 JPEG/PNG/WebP 路径保持一致。
            let metadata = avif_metadata_from_image(image);
            let mut id = ImageData::new(width, height, rgba)?;
            id.icc = metadata.icc;
            id.exif = metadata.exif;
            id.xmp = metadata.xmp;
            Ok(id)
        }
    }

    fn encode(&self, img: &ImageData, opts: &EncodeOptions) -> Result<Vec<u8>> {
        img.validate()?;
        let quality: i32 = if opts.lossless {
            100
        } else {
            opts.quality.clamp(1, 100)
        } as i32;
        let rgba = img.rgba8_cow();
        unsafe {
            let pixel_format = if opts.lossless {
                avif::AVIF_PIXEL_FORMAT_YUV444
            } else {
                opts.avif_pixel_format()
            };
            let image = ImageGuard(avif::avifImageCreate(
                img.width,
                img.height,
                8,
                pixel_format,
            ));
            if image.0.is_null() {
                return Err(Error::Encode("avifImageCreate 返回 null".into()));
            }
            if opts.lossless {
                (*image.0).matrixCoefficients = avif::AVIF_MATRIX_COEFFICIENTS_IDENTITY as u16;
                (*image.0).yuvRange = avif::AVIF_RANGE_FULL;
            }
            if opts.preserve_metadata {
                if let Some(icc) = img.icc.as_ref() {
                    validate_metadata_blob_for_encode("ICC", icc)?;
                    if !icc.is_empty()
                        && avif::avifImageSetProfileICC(image.0, icc.as_ptr(), icc.len())
                            != avif::AVIF_RESULT_OK
                    {
                        return Err(Error::Encode("avifImageSetProfileICC 失败".into()));
                    }
                }
                if let Some(exif) = img.exif.as_ref() {
                    validate_metadata_blob_for_encode("EXIF", exif)?;
                    if !exif.is_empty()
                        && avif::avifImageSetMetadataExif(image.0, exif.as_ptr(), exif.len())
                            != avif::AVIF_RESULT_OK
                    {
                        return Err(Error::Encode("avifImageSetMetadataExif 失败".into()));
                    }
                }
                if let Some(xmp) = img.xmp.as_ref() {
                    validate_metadata_blob_for_encode("XMP", xmp)?;
                    if !xmp.is_empty()
                        && avif::avifImageSetMetadataXMP(image.0, xmp.as_ptr(), xmp.len())
                            != avif::AVIF_RESULT_OK
                    {
                        return Err(Error::Encode("avifImageSetMetadataXMP 失败".into()));
                    }
                }
            }
            let mut rgb: avif::avifRGBImage = std::mem::zeroed();
            avif::avifRGBImageSetDefaults(&mut rgb, image.0);
            rgb.format = avif::AVIF_RGB_FORMAT_RGBA;
            rgb.depth = 8;
            rgb.pixels = rgba.as_ptr() as *mut u8; // RGBToYUV 只读此缓冲
            rgb.rowBytes = img.width * 4;
            if avif::avifImageRGBToYUV(image.0, &rgb) != avif::AVIF_RESULT_OK {
                return Err(Error::Encode("avifImageRGBToYUV 失败".into()));
            }
            let encoder = EncoderGuard(avif::avifEncoderCreate());
            if encoder.0.is_null() {
                return Err(Error::Encode("avifEncoderCreate 返回 null".into()));
            }
            (*encoder.0).codecChoice = if opts.lossless {
                avif::AVIF_CODEC_CHOICE_AOM
            } else {
                avif::AVIF_CODEC_CHOICE_RAV1E
            };
            (*encoder.0).maxThreads = AVIF_ENCODER_MAX_THREADS; // 防 oversubscribe(评审 #4 / Claude N3)
            (*encoder.0).speed = opts.avif_speed_clamped();
            (*encoder.0).quality = quality;
            (*encoder.0).qualityAlpha = quality;
            if opts.lossless {
                (*encoder.0).minQuantizer = avif::AVIF_QUANTIZER_LOSSLESS as i32;
                (*encoder.0).maxQuantizer = avif::AVIF_QUANTIZER_LOSSLESS as i32;
                (*encoder.0).minQuantizerAlpha = avif::AVIF_QUANTIZER_LOSSLESS as i32;
                (*encoder.0).maxQuantizerAlpha = avif::AVIF_QUANTIZER_LOSSLESS as i32;
            }
            let mut output = RwDataGuard(avif::avifRWData::default());
            let r = avif::avifEncoderWrite(encoder.0, image.0, &mut output.0);
            if r == avif::AVIF_RESULT_OK && !output.0.data.is_null() {
                Ok(std::slice::from_raw_parts(output.0.data, output.0.size).to_vec())
            } else {
                Err(Error::Encode(format!("avifEncoderWrite (code {r})")))
            }
        }
    }
}

fn avif_metadata_blob(data: *const u8, size: usize) -> Option<Vec<u8>> {
    if data.is_null() || size == 0 || size > MAX_METADATA_BLOB_BYTES {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(data, size).to_vec() })
}

fn avif_metadata_from_image(image: *const avif::avifImage) -> Metadata {
    if image.is_null() {
        return Metadata::default();
    }
    unsafe {
        let image = &*image;
        Metadata {
            icc: avif_metadata_blob(image.icc.data, image.icc.size),
            exif: avif_metadata_blob(image.exif.data, image.exif.size),
            xmp: avif_metadata_blob(image.xmp.data, image.xmp.size),
            iptc: None,
        }
    }
}

fn extract_avif_metadata(bytes: &[u8]) -> Metadata {
    unsafe {
        let decoder = DecoderGuard(avif::avifDecoderCreate());
        if decoder.0.is_null() {
            return Metadata::default();
        }
        if avif::avifDecoderSetIOMemory(decoder.0, bytes.as_ptr(), bytes.len())
            != avif::AVIF_RESULT_OK
        {
            return Metadata::default();
        }
        if avif::avifDecoderParse(decoder.0) != avif::AVIF_RESULT_OK {
            return Metadata::default();
        }
        avif_metadata_from_image((*decoder.0).image)
    }
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    fn synth(width: u32, height: u32) -> ImageData {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                rgba.extend_from_slice(&[
                    (x.wrapping_mul(4)) as u8,
                    (y.wrapping_mul(5)) as u8,
                    128,
                    255,
                ]);
            }
        }
        ImageData::new(width, height, rgba).unwrap()
    }

    fn quadrant_image(width: u32, height: u32) -> ImageData {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let rgb = match (x < width / 2, y < height / 2) {
                    (true, true) => [255, 0, 0],
                    (false, true) => [0, 255, 0],
                    (true, false) => [0, 0, 255],
                    (false, false) => [255, 255, 0],
                };
                rgba.extend_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
            }
        }
        ImageData::new(width, height, rgba).unwrap()
    }

    fn jpeg_grid_artifact_image(width: u32, height: u32) -> ImageData {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let base = ((x + y) * 2).min(220) as u8;
                let block_bias = if ((x / 8) + (y / 8)) % 2 == 0 { 0 } else { 18 };
                let value = base.saturating_add(block_bias);
                rgba.extend_from_slice(&[value, value.saturating_add(2), value, 255]);
            }
        }
        ImageData::new(width, height, rgba).unwrap()
    }

    fn webp_block_artifact_image(width: u32, height: u32) -> ImageData {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let base = ((x * 3 + y * 2) % 180) as u8;
                let block_bias = if ((x / 4) + (y / 4)) % 2 == 0 { 0 } else { 16 };
                let value = base.saturating_add(block_bias);
                rgba.extend_from_slice(&[
                    value,
                    value.saturating_add((x % 4) as u8),
                    value.saturating_add((y % 4) as u8),
                    255,
                ]);
            }
        }
        ImageData::new(width, height, rgba).unwrap()
    }

    fn jpeg_chroma_grid_artifact_image(width: u32, height: u32) -> ImageData {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let local_chroma = ((x % 8) + (y % 3)) as u8;
                let odd_block = ((x / 8) + (y / 8)) % 2 == 1;
                let pixel = if odd_block {
                    [
                        168u8.saturating_add(local_chroma),
                        96u8.saturating_add(y as u8 % 2),
                        120u8,
                        255,
                    ]
                } else {
                    [
                        120u8.saturating_add(local_chroma),
                        120u8,
                        120u8.saturating_add(y as u8 % 2),
                        255,
                    ]
                };
                rgba.extend_from_slice(&pixel);
            }
        }
        ImageData::new(width, height, rgba).unwrap()
    }

    fn exif_with_orientation(orientation: u16) -> Vec<u8> {
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"MM");
        tiff.extend_from_slice(&42u16.to_be_bytes());
        tiff.extend_from_slice(&8u32.to_be_bytes());
        tiff.extend_from_slice(&1u16.to_be_bytes());
        tiff.extend_from_slice(&0x0112u16.to_be_bytes()); // Orientation
        tiff.extend_from_slice(&3u16.to_be_bytes()); // SHORT
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&orientation.to_be_bytes());
        tiff.extend_from_slice(&0u16.to_be_bytes());
        tiff.extend_from_slice(&0u32.to_be_bytes());
        tiff
    }

    fn exif_with_resolution(unit: u16, x_num: u32, x_den: u32, y_num: u32, y_den: u32) -> Vec<u8> {
        let ifd0_offset = 8u32;
        let ifd0_count = 3u16;
        let rational_offset = ifd0_offset + 2 + u32::from(ifd0_count) * 12 + 4;
        let x_offset = rational_offset;
        let y_offset = rational_offset + 8;

        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"MM");
        tiff.extend_from_slice(&42u16.to_be_bytes());
        tiff.extend_from_slice(&ifd0_offset.to_be_bytes());
        tiff.extend_from_slice(&ifd0_count.to_be_bytes());
        tiff.extend_from_slice(&0x011au16.to_be_bytes()); // XResolution
        tiff.extend_from_slice(&5u16.to_be_bytes()); // RATIONAL
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&x_offset.to_be_bytes());
        tiff.extend_from_slice(&0x011bu16.to_be_bytes()); // YResolution
        tiff.extend_from_slice(&5u16.to_be_bytes()); // RATIONAL
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&y_offset.to_be_bytes());
        tiff.extend_from_slice(&0x0128u16.to_be_bytes()); // ResolutionUnit
        tiff.extend_from_slice(&3u16.to_be_bytes()); // SHORT
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&unit.to_be_bytes());
        tiff.extend_from_slice(&0u16.to_be_bytes());
        tiff.extend_from_slice(&0u32.to_be_bytes());
        tiff.extend_from_slice(&x_num.to_be_bytes());
        tiff.extend_from_slice(&x_den.to_be_bytes());
        tiff.extend_from_slice(&y_num.to_be_bytes());
        tiff.extend_from_slice(&y_den.to_be_bytes());
        tiff
    }

    fn xmp_packet(label: &str) -> Vec<u8> {
        format!(
            r#"<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:imgconvert="https://ivmm.dev/imgconvert/" imgconvert:label="{label}"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>"#
        )
        .into_bytes()
    }

    fn iptc_dataset(record: u8, dataset: u8, value: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(5 + value.len());
        bytes.push(0x1c);
        bytes.push(record);
        bytes.push(dataset);
        bytes.extend_from_slice(&(value.len() as u16).to_be_bytes());
        bytes.extend_from_slice(value);
        bytes
    }

    fn iptc_fixture() -> Vec<u8> {
        let mut iptc = iptc_dataset(2, 5, b"ImgConvert sample");
        iptc.extend_from_slice(&iptc_dataset(2, 25, b"metadata"));
        iptc
    }

    fn exif_with_makernote(orientation: u16, makernote: &[u8]) -> Vec<u8> {
        let ifd0_offset = 8u32;
        let ifd0_count = 2u16;
        let exif_ifd_offset = ifd0_offset + 2 + u32::from(ifd0_count) * 12 + 4;
        let maker_offset = exif_ifd_offset + 2 + 12 + 4;

        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"MM");
        tiff.extend_from_slice(&42u16.to_be_bytes());
        tiff.extend_from_slice(&ifd0_offset.to_be_bytes());
        tiff.extend_from_slice(&ifd0_count.to_be_bytes());
        tiff.extend_from_slice(&0x0112u16.to_be_bytes()); // Orientation
        tiff.extend_from_slice(&3u16.to_be_bytes()); // SHORT
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&orientation.to_be_bytes());
        tiff.extend_from_slice(&0u16.to_be_bytes());
        tiff.extend_from_slice(&0x8769u16.to_be_bytes()); // ExifIFDPointer
        tiff.extend_from_slice(&4u16.to_be_bytes()); // LONG
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&exif_ifd_offset.to_be_bytes());
        tiff.extend_from_slice(&0u32.to_be_bytes());
        tiff.extend_from_slice(&1u16.to_be_bytes());
        tiff.extend_from_slice(&0x927cu16.to_be_bytes()); // MakerNote
        tiff.extend_from_slice(&7u16.to_be_bytes()); // UNDEFINED
        tiff.extend_from_slice(&(makernote.len() as u32).to_be_bytes());
        tiff.extend_from_slice(&maker_offset.to_be_bytes());
        tiff.extend_from_slice(&0u32.to_be_bytes());
        tiff.extend_from_slice(makernote);
        tiff
    }

    fn jpeg_with_exif_orientation(jpeg: &[u8], orientation: u16) -> Vec<u8> {
        jpeg_with_exif(jpeg, &exif_with_orientation(orientation))
    }

    fn jpeg_with_exif(jpeg: &[u8], tiff: &[u8]) -> Vec<u8> {
        jpeg_with_exif_at(jpeg, tiff, 2)
    }

    fn jpeg_with_exif_after_first_segment(jpeg: &[u8], tiff: &[u8]) -> Vec<u8> {
        assert!(jpeg.len() >= 6 && jpeg[0..2] == [0xff, 0xd8]);
        let insert_at = if jpeg[2] == 0xff && jpeg[3] != 0xda && jpeg[3] != 0xd9 {
            let segment_len = be_u16(&jpeg[4..6]).unwrap() as usize;
            (4 + segment_len).min(jpeg.len())
        } else {
            2
        };
        jpeg_with_exif_at(jpeg, tiff, insert_at)
    }

    fn jpeg_with_exif_at(jpeg: &[u8], tiff: &[u8], insert_at: usize) -> Vec<u8> {
        assert!(jpeg.len() >= 2 && jpeg[0..2] == [0xff, 0xd8]);
        assert!((2..=jpeg.len()).contains(&insert_at));

        let mut app1 = Vec::new();
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend_from_slice(tiff);
        let segment_len = (app1.len() + 2) as u16;

        let mut out = Vec::with_capacity(jpeg.len() + app1.len() + 4);
        out.extend_from_slice(&jpeg[..insert_at]);
        out.extend_from_slice(&[0xff, 0xe1]);
        out.extend_from_slice(&segment_len.to_be_bytes());
        out.extend_from_slice(&app1);
        out.extend_from_slice(&jpeg[insert_at..]);
        out
    }

    fn preserve_metadata_options() -> EncodeOptions {
        EncodeOptions {
            preserve_metadata: true,
            ..EncodeOptions::default()
        }
    }

    fn exif_orientation(exif: &[u8]) -> Option<image::metadata::Orientation> {
        image::metadata::Orientation::from_exif_chunk(exif)
    }

    fn pixel_at(img: &ImageData, x: u32, y: u32) -> &[u8] {
        let rgba = img.rgba8().unwrap();
        let offset = ((y * img.width + x) * 4) as usize;
        &rgba[offset..offset + 4]
    }

    fn dominant_rgb_channel(pixel: &[u8]) -> usize {
        pixel[0..3]
            .iter()
            .enumerate()
            .max_by_key(|(_, value)| *value)
            .map(|(index, _)| index)
            .unwrap()
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

    fn png_with_dimensions(width: u32, height: u32) -> Vec<u8> {
        png_with_optional_phys(width, height, None)
    }

    fn png_with_optional_phys(width: u32, height: u32, phys: Option<(u32, u32)>) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&width.to_be_bytes());
        data.extend_from_slice(&height.to_be_bytes());
        data.extend_from_slice(&[8, 6, 0, 0, 0]); // RGBA8, deflate, standard filter/interlace

        let mut png = Vec::new();
        png.extend_from_slice(&[0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n']);
        append_png_chunk(&mut png, b"IHDR", &data);
        if let Some((x, y)) = phys {
            let mut phys_data = Vec::new();
            phys_data.extend_from_slice(&x.to_be_bytes());
            phys_data.extend_from_slice(&y.to_be_bytes());
            phys_data.push(1);
            append_png_chunk(&mut png, b"pHYs", &phys_data);
        }
        append_png_chunk(&mut png, b"IDAT", &[]);
        append_png_chunk(&mut png, b"IEND", &[]);
        png
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

    fn insert_png_chunk_after_ihdr(png: &[u8], name: &[u8; 4], data: &[u8]) -> Vec<u8> {
        assert!(png.len() >= PNG_SIGNATURE.len() + 12);
        assert_eq!(&png[..PNG_SIGNATURE.len()], PNG_SIGNATURE);
        assert_eq!(&png[12..16], b"IHDR");
        let ihdr_len = be_u32(&png[8..12]).unwrap() as usize;
        let ihdr_end = PNG_SIGNATURE.len() + 8 + ihdr_len + 4;
        assert!(ihdr_end <= png.len());

        let mut out = Vec::with_capacity(png.len() + 12 + data.len());
        out.extend_from_slice(&png[..ihdr_end]);
        append_png_chunk(&mut out, name, data);
        out.extend_from_slice(&png[ihdr_end..]);
        out
    }

    fn jpeg_has_marker(bytes: &[u8], marker: u8) -> bool {
        bytes.windows(2).any(|window| window == [0xff, marker])
    }

    const DISPLAY_P3_ICC_DESC: &str = "ImgConvert Display P3 ICC fixture";

    fn display_p3_icc_profile() -> Vec<u8> {
        let tags: Vec<([u8; 4], Vec<u8>)> = vec![
            (*b"desc", icc_desc_tag(DISPLAY_P3_ICC_DESC)),
            (*b"wtpt", icc_xyz_tag(0.9642, 1.0, 0.8249)),
            (*b"rXYZ", icc_xyz_tag(0.515102, 0.241182, -0.001049)),
            (*b"gXYZ", icc_xyz_tag(0.291965, 0.692236, 0.041882)),
            (*b"bXYZ", icc_xyz_tag(0.157153, 0.066582, 0.784378)),
            (*b"rTRC", icc_curve_tag(2.2)),
            (*b"gTRC", icc_curve_tag(2.2)),
            (*b"bTRC", icc_curve_tag(2.2)),
        ];
        let tag_table_len = 4 + tags.len() * 12;
        let mut profile = vec![0u8; 128 + tag_table_len];
        let mut records = Vec::with_capacity(tags.len());

        for (signature, data) in tags {
            pad_to_4(&mut profile);
            let offset = u32::try_from(profile.len()).unwrap();
            let size = u32::try_from(data.len()).unwrap();
            profile.extend_from_slice(&data);
            pad_to_4(&mut profile);
            records.push((signature, offset, size));
        }

        let profile_size = u32::try_from(profile.len()).unwrap();
        profile[0..4].copy_from_slice(&profile_size.to_be_bytes());
        profile[8..12].copy_from_slice(&0x0430_0000u32.to_be_bytes());
        profile[12..16].copy_from_slice(b"mntr");
        profile[16..20].copy_from_slice(b"RGB ");
        profile[20..24].copy_from_slice(b"XYZ ");
        write_icc_datetime(&mut profile[24..36]);
        profile[36..40].copy_from_slice(b"acsp");
        profile[68..80].copy_from_slice(&icc_xyz_number_bytes(0.9642, 1.0, 0.8249));
        profile[80..84].copy_from_slice(b"ImgC");
        profile[128..132].copy_from_slice(&(records.len() as u32).to_be_bytes());
        for (index, (signature, offset, size)) in records.iter().enumerate() {
            let base = 132 + index * 12;
            profile[base..base + 4].copy_from_slice(signature);
            profile[base + 4..base + 8].copy_from_slice(&offset.to_be_bytes());
            profile[base + 8..base + 12].copy_from_slice(&size.to_be_bytes());
        }

        profile
    }

    fn write_icc_datetime(dst: &mut [u8]) {
        for (index, value) in [2026u16, 7, 2, 0, 0, 0].into_iter().enumerate() {
            dst[index * 2..index * 2 + 2].copy_from_slice(&value.to_be_bytes());
        }
    }

    fn icc_desc_tag(text: &str) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(b"desc");
        data.extend_from_slice(&[0; 4]);
        let mut ascii = text.as_bytes().to_vec();
        ascii.push(0);
        data.extend_from_slice(&(ascii.len() as u32).to_be_bytes());
        data.extend_from_slice(&ascii);
        pad_to_4(&mut data);
        data
    }

    fn icc_xyz_tag(x: f64, y: f64, z: f64) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(b"XYZ ");
        data.extend_from_slice(&[0; 4]);
        data.extend_from_slice(&icc_xyz_number_bytes(x, y, z));
        data
    }

    fn icc_curve_tag(gamma: f64) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(b"curv");
        data.extend_from_slice(&[0; 4]);
        data.extend_from_slice(&1u32.to_be_bytes());
        data.extend_from_slice(&((gamma * 256.0).round() as u16).to_be_bytes());
        pad_to_4(&mut data);
        data
    }

    fn icc_xyz_number_bytes(x: f64, y: f64, z: f64) -> [u8; 12] {
        let mut bytes = [0u8; 12];
        bytes[0..4].copy_from_slice(&s15_fixed16(x).to_be_bytes());
        bytes[4..8].copy_from_slice(&s15_fixed16(y).to_be_bytes());
        bytes[8..12].copy_from_slice(&s15_fixed16(z).to_be_bytes());
        bytes
    }

    fn s15_fixed16(value: f64) -> i32 {
        (value * 65_536.0).round() as i32
    }

    fn pad_to_4(bytes: &mut Vec<u8>) {
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
    }

    #[test]
    fn imagedata_validation() {
        assert!(ImageData::new(2, 2, vec![0u8; 16]).is_ok());
        assert!(ImageData::new(2, 2, vec![0u8; 10]).is_err()); // 长度不符
        assert!(ImageData::new(0, 2, vec![]).is_err()); // 0 尺寸
        assert!(ImageData::new(u32::MAX, u32::MAX, vec![]).is_err()); // 溢出/超上限
    }

    #[test]
    fn pixel_buffer_accepts_wider_internal_representations() {
        let img16 =
            ImageData::from_pixels(1, 1, PixelBuffer::Rgba16(vec![0xffff, 0x8000, 0, 0xffff]))
                .unwrap();
        assert_eq!(img16.pixel_encoding(), PixelEncoding::Rgba16);
        assert_eq!(img16.rgba8_cow().as_ref(), &[255, 128, 0, 255]);

        let imgf =
            ImageData::from_pixels(1, 1, PixelBuffer::RgbaF32(vec![1.0, 0.5, 0.0, 1.0])).unwrap();
        assert_eq!(imgf.pixel_encoding(), PixelEncoding::RgbaF32);
        assert_eq!(imgf.rgba8_cow().as_ref(), &[255, 128, 0, 255]);

        let caps = color_pipeline_capabilities();
        assert!(caps.rgba8 && caps.rgba16 && caps.rgba_f32 && caps.linear_resize);
        assert!(caps.icc_transform);
        assert_eq!(
            apply_color_management_policy(&img16, ColorManagementPolicy::ConvertToSrgb).unwrap(),
            img16
        );
    }

    #[test]
    fn convert_to_srgb_transforms_embedded_icc_pixels() {
        let mut img = ImageData::new(2, 1, vec![220, 96, 32, 255, 40, 220, 150, 128]).unwrap();
        img.icc = Some(display_p3_icc_profile());

        let converted =
            apply_color_management_policy(&img, ColorManagementPolicy::ConvertToSrgb).unwrap();

        assert_eq!(converted.pixel_encoding(), PixelEncoding::Rgba8);
        assert!(converted.icc.is_none());
        assert_ne!(converted.rgba8().unwrap(), img.rgba8().unwrap());
        assert_eq!(converted.rgba8().unwrap()[3], 255);
        assert_eq!(converted.rgba8().unwrap()[7], 128);
    }

    #[test]
    fn convert_to_srgb_preserves_wide_pixel_encoding() {
        let mut img16 = ImageData::from_pixels(
            2,
            1,
            PixelBuffer::Rgba16(vec![
                48_000, 16_000, 4_000, 65_535, 6_000, 48_000, 24_000, 40_000,
            ]),
        )
        .unwrap();
        img16.icc = Some(display_p3_icc_profile());

        let converted16 =
            apply_color_management_policy(&img16, ColorManagementPolicy::ConvertToSrgb).unwrap();

        assert_eq!(converted16.pixel_encoding(), PixelEncoding::Rgba16);
        assert!(converted16.icc.is_none());
        assert_ne!(
            converted16.pixels.as_rgba16().unwrap(),
            img16.pixels.as_rgba16().unwrap()
        );
        assert_eq!(converted16.pixels.as_rgba16().unwrap()[3], 65_535);

        let imgf =
            ImageData::from_pixels(1, 1, PixelBuffer::RgbaF32(vec![1.0, 0.5, 0.0, 1.0])).unwrap();
        assert_eq!(
            apply_color_management_policy(&imgf, ColorManagementPolicy::ConvertToSrgb).unwrap(),
            imgf
        );
    }

    #[test]
    fn resize_linear_preserves_encoding_and_metadata() {
        let mut img = ImageData::from_pixels(
            2,
            2,
            PixelBuffer::Rgba16(vec![
                65_535, 0, 0, 65_535, 0, 65_535, 0, 65_535, 0, 0, 65_535, 65_535, 32_000, 32_000,
                0, 32_000,
            ]),
        )
        .unwrap();
        img.xmp = Some(xmp_packet("resize"));

        let resized = resize_linear(&img, 1, 1).unwrap();

        assert_eq!((resized.width, resized.height), (1, 1));
        assert_eq!(resized.pixel_encoding(), PixelEncoding::Rgba16);
        assert_eq!(resized.icc, img.icc);
        assert_eq!(resized.xmp, img.xmp);
        assert_eq!(resized.pixels.as_rgba16().unwrap().len(), 4);
    }

    #[test]
    fn resize_linear_rejects_non_srgb_icc_input() {
        let mut img = synth(2, 2);
        img.icc = Some(display_p3_icc_profile());

        let err = resize_linear(&img, 1, 1).unwrap_err();

        assert!(matches!(err, Error::Unsupported(message) if message.contains("ConvertToSrgb")));
    }

    #[test]
    fn png_rgba16_roundtrip_preserves_16_bit_samples() {
        let samples = vec![1, 257, 32_769, 65_535, 10_001, 20_003, 30_007, 40_009];
        let img = ImageData::from_pixels(2, 1, PixelBuffer::Rgba16(samples.clone())).unwrap();

        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let back = PngCodec.decode(&png).unwrap();

        assert_eq!(back.pixel_encoding(), PixelEncoding::Rgba16);
        assert_eq!(back.pixels.as_rgba16().unwrap(), samples.as_slice());

        let reducible = vec![0, 257, 65_280, 65_535];
        let reducible_img =
            ImageData::from_pixels(1, 1, PixelBuffer::Rgba16(reducible.clone())).unwrap();
        let reducible_png = PngCodec
            .encode(&reducible_img, &EncodeOptions::default())
            .unwrap();
        let reducible_back = PngCodec.decode(&reducible_png).unwrap();
        assert_eq!(reducible_back.pixel_encoding(), PixelEncoding::Rgba16);
        assert_eq!(
            reducible_back.pixels.as_rgba16().unwrap(),
            reducible.as_slice()
        );
    }

    #[test]
    fn convert_with_color_policy_drops_stale_icc_after_srgb_transform() {
        let mut img = ImageData::new(2, 1, vec![220, 96, 32, 255, 40, 220, 150, 255]).unwrap();
        img.icc = Some(display_p3_icc_profile());
        let source = PngCodec.encode(&img, &preserve_metadata_options()).unwrap();

        let encoded = convert_with_color_policy(
            &source,
            Format::Png,
            &preserve_metadata_options(),
            None,
            ColorManagementPolicy::ConvertToSrgb,
        )
        .unwrap();
        let back = PngCodec.decode(&encoded).unwrap();

        assert!(back.icc.is_none());
        assert_ne!(back.rgba8().unwrap(), img.rgba8().unwrap());
    }

    #[test]
    fn timed_convert_reports_wall_clock_timeout() {
        let source = PngCodec
            .encode(&synth(16, 16), &EncodeOptions::default())
            .unwrap();

        let err = convert_best_of_with_color_policy_timeout(
            &source,
            Format::WebP,
            &[EncodeOptions::default()],
            None,
            ColorManagementPolicy::PreserveEmbeddedProfile,
            Duration::ZERO,
        )
        .unwrap_err();

        assert!(matches!(err, Error::Timeout(message) if message.contains("wall-clock")));
    }

    #[test]
    fn lossless_capability_is_true_lossless_only() {
        assert_eq!(LOSSLESS_FORMATS, &[Format::Png, Format::WebP, Format::Avif]);
        assert!(Format::Png.supports_lossless());
        assert!(Format::WebP.supports_lossless());
        assert!(Format::Avif.supports_lossless());
        assert!(!Format::Jpeg.supports_lossless());
    }

    #[test]
    fn avif_lossless_capability_is_enabled_for_verified_aom_path() {
        assert!(LOSSLESS_FORMATS.contains(&Format::Avif));
        assert!(Format::Avif.supports_lossless());
        assert_eq!(AVIF_ENCODER_MAX_THREADS, 1);
        assert_eq!(
            AVIF_LOSSLESS_SUPPORTED,
            LOSSLESS_FORMATS.contains(&Format::Avif)
        );
    }

    #[test]
    fn avif_lossless_probe_supports_verified_cases() {
        let probe = probe_avif_lossless_candidate().unwrap();
        assert!(probe.supported, "{}", probe.reason);
        assert!(!probe.reason.is_empty());
        assert!(probe.cases.len() >= 3);
        assert!(probe
            .cases
            .iter()
            .any(|case| case.name == "rgba-yuv444" && case.has_alpha));
        assert!(probe
            .cases
            .iter()
            .any(|case| case.name == "opaque-yuv444" && !case.has_alpha));
        assert!(probe.cases.iter().all(|case| case.encoded_bytes > 0));
        assert_eq!(
            probe.max_channel_abs_diff,
            probe
                .cases
                .iter()
                .map(|case| case.max_channel_abs_diff)
                .max()
                .unwrap_or(0)
        );
        assert!(probe.cases.iter().all(|case| case.roundtrip_exact));
    }

    #[test]
    fn avif_lossless_encode_roundtrips_rgba_pixels_exactly() {
        let mut rgba = Vec::with_capacity(16 * 16 * 4);
        for y in 0..16u8 {
            for x in 0..16u8 {
                rgba.extend_from_slice(&[
                    x.wrapping_mul(17),
                    y.wrapping_mul(19),
                    x.wrapping_mul(31) ^ y.wrapping_mul(11),
                    x.wrapping_mul(7).wrapping_add(y.wrapping_mul(13)),
                ]);
            }
        }
        let source = ImageData::new(16, 16, rgba).unwrap();

        for requested_subsample in [AvifSubsample::Yuv444, AvifSubsample::Yuv420] {
            let encoded = AvifCodec
                .encode(
                    &source,
                    &EncodeOptions {
                        quality: 1,
                        lossless: true,
                        avif_speed: 10,
                        avif_subsample: requested_subsample,
                        ..EncodeOptions::default()
                    },
                )
                .unwrap();
            let decoded = AvifCodec.decode(&encoded).unwrap();

            assert_eq!(
                (decoded.width, decoded.height),
                (source.width, source.height)
            );
            assert_eq!(
                decoded.rgba8().unwrap(),
                source.rgba8().unwrap(),
                "AVIF lossless changed pixels for requested subsample {requested_subsample:?}"
            );
        }
    }

    #[test]
    fn encode_options_defaults_match_p2_baseline() {
        let opts = EncodeOptions::default();

        assert_eq!(opts.quality, 80);
        assert!(opts.jpeg_progressive);
        assert_eq!(opts.png_oxipng_level, 4);
        assert!(!opts.png_lossy_quantize);
        assert_eq!(opts.png_quant_colors, 256);
        assert_eq!(opts.webp_method, 4);
        assert_eq!(opts.avif_speed, 8);
        assert_eq!(opts.avif_subsample, AvifSubsample::Yuv444);
        assert_eq!(opts.webp_near_lossless, 100);
        assert!(!opts.webp_sharp_yuv);
        assert!(opts.jpeg_trellis);
        assert!(!opts.preserve_metadata);
        assert_eq!(AVIF_ENCODER_MAX_THREADS, 1);
    }

    #[test]
    fn auto_quality_levels_include_requested_ceiling() {
        assert_eq!(auto_quality_levels(30, 38), vec![30, 34, 38]);
        assert_eq!(auto_quality_levels(82, 82), vec![82]);
    }

    #[test]
    fn auto_quality_scoring_evaluation_limit_is_bounded() {
        assert_eq!(AUTO_QUALITY_MAX_SCORING_EVALUATIONS, 7);
        assert_eq!(
            auto_quality_scoring_evaluation_limit(Format::Jpeg, 1, 100),
            6
        );
        assert_eq!(
            auto_quality_scoring_evaluation_limit(Format::WebP, 1, 100),
            AUTO_QUALITY_MAX_SCORING_EVALUATIONS
        );
        assert!(auto_quality_scoring_evaluation_limit(Format::Jpeg, 30, 80) <= 6);
    }

    #[test]
    fn lossy_artifact_hint_detects_png_jpeg_grid_without_flagging_smooth_png() {
        let smooth = PngCodec
            .encode(&synth(64, 64), &EncodeOptions::default())
            .unwrap();
        assert_eq!(detect_lossy_artifacts(&smooth).unwrap(), None);

        let blocky = PngCodec
            .encode(&jpeg_grid_artifact_image(64, 64), &EncodeOptions::default())
            .unwrap();
        let hint = detect_lossy_artifacts(&blocky).unwrap().unwrap();
        assert_eq!(hint.format, Format::Png);
        assert!(hint.jpeg_grid_score >= JPEG_GRID_ARTIFACT_SCORE_THRESHOLD);
        assert!(hint.webp_block_score >= 0.0);
    }

    #[test]
    fn lossy_artifact_hint_detects_png_webp_like_blocks() {
        let blocky = PngCodec
            .encode(
                &webp_block_artifact_image(64, 64),
                &EncodeOptions::default(),
            )
            .unwrap();
        let hint = detect_lossy_artifacts(&blocky).unwrap().unwrap();
        assert_eq!(hint.format, Format::Png);
        assert!(hint.webp_block_score >= WEBP_BLOCK_ARTIFACT_SCORE_THRESHOLD);
    }

    #[test]
    fn lossy_artifact_hint_detects_png_jpeg_chroma_grid() {
        let blocky = PngCodec
            .encode(
                &jpeg_chroma_grid_artifact_image(64, 64),
                &EncodeOptions::default(),
            )
            .unwrap();
        let hint = detect_lossy_artifacts(&blocky).unwrap().unwrap();
        assert_eq!(hint.format, Format::Png);
        assert!(hint.jpeg_chroma_grid_score >= JPEG_CHROMA_GRID_ARTIFACT_SCORE_THRESHOLD);
    }

    #[test]
    fn image_decode_rejects_huge_dimensions_before_pixel_decode() {
        let png = png_with_dimensions((MAX_PIXELS as u32 / 2) + 1, 2);
        let err = match decode_via_image(&png, image::ImageFormat::Png) {
            Ok(_) => panic!("huge PNG dimensions should be rejected"),
            Err(err) => err,
        };
        assert!(
            matches!(err, Error::Unsupported(ref message) if message.contains("超过上限")),
            "{err:?}"
        );
    }

    #[test]
    fn probe_png_dimensions_and_dpi_without_pixel_decode() {
        let png = png_with_optional_phys(320, 240, Some((11_811, 11_811))); // ~300 DPI
        let info = probe(&png).unwrap();

        assert_eq!(info.format, Format::Png);
        assert_eq!((info.width, info.height), (320, 240));
        let dpi = info.dpi.unwrap();
        assert!((dpi.x - 300.0).abs() < 0.1);
        assert!((dpi.y - 300.0).abs() < 0.1);
    }

    #[test]
    fn probe_encoded_formats_dimensions() {
        let img = synth(32, 24);
        let jpg = JpegCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let webp = WebpCodec
            .encode(
                &img,
                &EncodeOptions {
                    quality: 80,
                    lossless: true,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();

        let jpg_probe = probe(&jpg).unwrap();
        let webp_probe = probe(&webp).unwrap();

        assert_eq!(jpg_probe.format, Format::Jpeg);
        assert_eq!((jpg_probe.width, jpg_probe.height), (32, 24));
        assert_eq!(webp_probe.format, Format::WebP);
        assert_eq!((webp_probe.width, webp_probe.height), (32, 24));
    }

    #[test]
    fn jpeg_decode_applies_exif_orientation() {
        let img = quadrant_image(16, 24);
        let jpg = JpegCodec
            .encode(
                &img,
                &EncodeOptions {
                    quality: 100,
                    lossless: false,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        let oriented = jpeg_with_exif_orientation(&jpg, 6);

        let decoded = JpegCodec.decode(&oriented).unwrap();

        assert_eq!((decoded.width, decoded.height), (24, 16));
        assert_eq!(dominant_rgb_channel(pixel_at(&decoded, 2, 2)), 2);
        assert_eq!(dominant_rgb_channel(pixel_at(&decoded, 21, 2)), 0);
    }

    #[test]
    fn probe_jpeg_reports_exif_oriented_dimensions() {
        let img = quadrant_image(16, 24);
        let jpg = JpegCodec
            .encode(
                &img,
                &EncodeOptions {
                    quality: 90,
                    lossless: false,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        let oriented = jpeg_with_exif_orientation(&jpg, 6);

        let info = probe(&oriented).unwrap();

        assert_eq!(info.format, Format::Jpeg);
        assert_eq!((info.width, info.height), (24, 16));
    }

    #[test]
    fn probe_jpeg_reads_exif_resolution_dpi() {
        let img = synth(32, 24);
        let jpg = JpegCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let with_inches =
            jpeg_with_exif_after_first_segment(&jpg, &exif_with_resolution(2, 300, 1, 240, 1));
        let with_centimeters =
            jpeg_with_exif_after_first_segment(&jpg, &exif_with_resolution(3, 100, 1, 50, 1));

        let inches = probe(&with_inches).unwrap().dpi.unwrap();
        assert!((inches.x - 300.0).abs() < f64::EPSILON);
        assert!((inches.y - 240.0).abs() < f64::EPSILON);

        let centimeters = probe(&with_centimeters).unwrap().dpi.unwrap();
        assert!((centimeters.x - 254.0).abs() < f64::EPSILON);
        assert!((centimeters.y - 127.0).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_exif_dpi_accepts_optional_exif_prefix() {
        let exif = exif_with_resolution(2, 72, 1, 144, 1);
        let mut prefixed = b"Exif\0\0".to_vec();
        prefixed.extend_from_slice(&exif);

        let dpi = parse_exif_dpi(&prefixed).unwrap();

        assert!((dpi.x - 72.0).abs() < f64::EPSILON);
        assert!((dpi.y - 144.0).abs() < f64::EPSILON);
    }

    #[test]
    fn probe_webp_reads_exif_resolution_dpi() {
        let mut img = synth(32, 24);
        img.exif = Some(exif_with_resolution(3, 100, 1, 50, 1));

        let webp = WebpCodec
            .encode(
                &img,
                &EncodeOptions {
                    lossless: true,
                    ..preserve_metadata_options()
                },
            )
            .unwrap();
        let probe = probe(&webp).unwrap();
        let dpi = probe.dpi.unwrap();

        assert_eq!(probe.format, Format::WebP);
        assert_eq!((probe.width, probe.height), (32, 24));
        assert!((dpi.x - 254.0).abs() < f64::EPSILON);
        assert!((dpi.y - 127.0).abs() < f64::EPSILON);
    }

    #[test]
    fn probe_avif_reads_exif_resolution_dpi() {
        let mut img = synth(32, 24);
        img.exif = Some(exif_with_resolution(2, 144, 1, 72, 1));

        let avif = AvifCodec
            .encode(
                &img,
                &EncodeOptions {
                    avif_speed: 10,
                    preserve_metadata: true,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        let probe = probe(&avif).unwrap();
        let dpi = probe.dpi.unwrap();

        assert_eq!(probe.format, Format::Avif);
        assert_eq!((probe.width, probe.height), (32, 24));
        assert!((dpi.x - 144.0).abs() < f64::EPSILON);
        assert!((dpi.y - 72.0).abs() < f64::EPSILON);
    }

    #[test]
    fn jpeg_metadata_is_stripped_by_default_and_preserved_when_requested() {
        let mut img = synth(32, 24);
        let icc = (0..70_000)
            .map(|value| (value % 251) as u8)
            .collect::<Vec<_>>();
        let exif = exif_with_orientation(1);
        let xmp = xmp_packet("jpeg");
        let iptc = iptc_fixture();
        img.icc = Some(icc.clone());
        img.exif = Some(exif.clone());
        img.xmp = Some(xmp.clone());
        img.iptc = Some(iptc.clone());

        let stripped = JpegCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let stripped_metadata = extract_jpeg_metadata(&stripped, false);
        assert!(stripped_metadata.icc.is_none());
        assert!(stripped_metadata.exif.is_none());
        assert!(stripped_metadata.xmp.is_none());
        assert!(stripped_metadata.iptc.is_none());

        let preserved = JpegCodec
            .encode(&img, &preserve_metadata_options())
            .unwrap();
        let metadata = extract_jpeg_metadata(&preserved, false);

        assert_eq!(metadata.icc, Some(icc.clone()));
        assert_eq!(metadata.exif, Some(exif.clone()));
        assert_eq!(metadata.xmp, Some(xmp.clone()));
        assert_eq!(metadata.iptc, Some(iptc.clone()));
        let decoded = JpegCodec.decode(&preserved).unwrap();
        assert_eq!(decoded.icc, Some(icc));
        assert_eq!(decoded.exif, Some(exif));
        assert_eq!(decoded.xmp, Some(xmp));
        assert_eq!(decoded.iptc, Some(iptc));
    }

    #[test]
    fn jpeg_extended_xmp_preserves_large_packet() {
        let mut img = synth(32, 24);
        let xmp = xmp_packet(&"jpeg-extended".repeat(6_000));
        assert!(JPEG_XMP_PREFIX.len() + xmp.len() > JPEG_APP_DATA_LIMIT);
        img.xmp = Some(xmp.clone());

        let encoded = JpegCodec
            .encode(&img, &preserve_metadata_options())
            .unwrap();
        assert!(encoded
            .windows(JPEG_EXTENDED_XMP_PREFIX.len())
            .any(|window| window == JPEG_EXTENDED_XMP_PREFIX));

        let metadata = extract_jpeg_metadata(&encoded, false);
        assert_eq!(metadata.xmp, Some(xmp.clone()));

        let decoded = JpegCodec.decode(&encoded).unwrap();
        assert_eq!(decoded.xmp, Some(xmp));
    }

    #[test]
    fn jpeg_extended_xmp_rejects_declared_oversized_total() {
        let mut data = Vec::new();
        data.extend_from_slice(JPEG_EXTENDED_XMP_PREFIX);
        data.extend_from_slice(b"0123456789ABCDEF0123456789ABCDEF");
        data.extend_from_slice(&((MAX_METADATA_BLOB_BYTES as u32) + 1).to_be_bytes());
        data.extend_from_slice(&0u32.to_be_bytes());
        data.push(b'x');

        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe1];
        jpeg.extend_from_slice(&((data.len() + 2) as u16).to_be_bytes());
        jpeg.extend_from_slice(&data);
        jpeg.extend_from_slice(&[0xff, 0xd9]);

        let metadata = extract_jpeg_metadata(&jpeg, false);
        assert!(metadata.xmp.is_none());
    }

    #[test]
    fn metadata_zlib_reader_enforces_expanded_size_limit() {
        let oversized = vec![0u8; MAX_METADATA_BLOB_BYTES + 1];
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&oversized).unwrap();
        let compressed = encoder.finish().unwrap();

        assert!(read_zlib_metadata_limited(&compressed).is_none());
    }

    #[test]
    fn metadata_encode_rejects_oversized_raw_xmp() {
        let mut img = synth(8, 8);
        img.xmp = Some(vec![b'x'; MAX_METADATA_BLOB_BYTES + 1]);

        let err = JpegCodec
            .encode(&img, &preserve_metadata_options())
            .unwrap_err();
        assert!(matches!(err, Error::Encode(message) if message.contains("XMP metadata 超过")));
    }

    #[test]
    fn jpeg_preserved_exif_orientation_is_normalized_after_pixel_rotation() {
        let img = quadrant_image(16, 24);
        let jpg = JpegCodec
            .encode(
                &img,
                &EncodeOptions {
                    quality: 100,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        let oriented = jpeg_with_exif_orientation(&jpg, 6);

        let decoded = JpegCodec.decode(&oriented).unwrap();
        let decoded_exif = decoded.exif.as_deref().unwrap();
        assert_eq!(
            exif_orientation(decoded_exif),
            Some(image::metadata::Orientation::NoTransforms)
        );

        let reencoded = JpegCodec
            .encode(&decoded, &preserve_metadata_options())
            .unwrap();
        let metadata = extract_jpeg_metadata(&reencoded, false);
        assert_eq!(
            metadata.exif.as_deref().and_then(exif_orientation),
            Some(image::metadata::Orientation::NoTransforms)
        );
    }

    #[test]
    fn raw_metadata_normalizes_xmp_orientation_semantics() {
        let metadata = RawMetadata {
            icc: None,
            exif: None,
            xmp: Some(
                r#"<rdf:Description tiff:Orientation="6" exif:Orientation='3'><tiff:Orientation rdf:datatype="xmp:Integer">6</tiff:Orientation><exif:Orientation>3</exif:Orientation><dc:title>ok</dc:title><xmpMM:History><rdf:Seq><rdf:li>edit</rdf:li></rdf:Seq></xmpMM:History></rdf:Description>"#
                    .as_bytes()
                    .to_vec(),
            ),
            iptc: None,
        }
        .normalized_orientation();
        let xmp = String::from_utf8(metadata.xmp.unwrap()).unwrap();
        assert!(!xmp.contains("tiff:Orientation"));
        assert!(!xmp.contains("exif:Orientation"));
        assert!(!xmp.contains("xmpMM:History"));
        assert!(xmp.contains("<dc:title>ok</dc:title>"));
    }

    #[test]
    fn xmp_semantic_cleanup_handles_self_closing_orientation() {
        let cleaned = normalize_xmp_semantics(
            r#"<rdf:Description><tiff:Orientation/><dc:title>ok</dc:title></rdf:Description>"#,
        );

        assert!(!cleaned.contains("tiff:Orientation"));
        assert!(cleaned.contains("<dc:title>ok</dc:title>"));
    }

    #[test]
    fn xmp_semantic_cleanup_handles_namespace_aliases() {
        let metadata = RawMetadata {
            icc: None,
            exif: None,
            xmp: Some(
                r#"<rdf:Description xmlns:cam="http://ns.adobe.com/tiff/1.0/" xmlns:mm="http://ns.adobe.com/xap/1.0/mm/" cam:Orientation="6"><cam:Orientation>6</cam:Orientation><mm:History><rdf:Seq><rdf:li>edit</rdf:li></rdf:Seq></mm:History><dc:title>ok</dc:title></rdf:Description>"#
                    .as_bytes()
                    .to_vec(),
            ),
            iptc: None,
        };

        let report = inspect_metadata_semantics(&metadata);
        assert!(report.xmp_has_orientation);
        assert!(report.xmp_has_edit_history);

        let cleaned = normalize_metadata_semantics(metadata);
        let xmp = String::from_utf8(cleaned.xmp.unwrap()).unwrap();
        assert!(!xmp.contains("cam:Orientation"));
        assert!(!xmp.contains("mm:History"));
        assert!(xmp.contains("<dc:title>ok</dc:title>"));
    }

    #[test]
    fn metadata_semantics_report_detects_iptc_and_makernote_without_rewriting_private_bytes() {
        let makernote = b"Nikon\x00private-maker-note";
        let metadata = RawMetadata {
            icc: None,
            exif: Some(exif_with_makernote(6, makernote)),
            xmp: None,
            iptc: Some(iptc_fixture()),
        };

        let report = inspect_metadata_semantics(&metadata);

        assert_eq!(report.exif_orientation, Some(6));
        let maker = report.exif_makernote.unwrap();
        assert_eq!(maker.byte_len, makernote.len());
        assert_eq!(
            &metadata.exif.as_deref().unwrap()[maker.offset..maker.offset + maker.byte_len],
            makernote
        );
        assert_eq!(report.iptc_datasets.len(), 2);
        assert_eq!(report.iptc_datasets[0].name, Some("ObjectName"));
        assert_eq!(report.iptc_datasets[1].name, Some("Keywords"));

        let normalized = normalize_metadata_semantics(metadata.clone());
        assert_eq!(normalized.iptc, metadata.iptc);
        assert!(normalized
            .exif
            .as_deref()
            .unwrap()
            .windows(makernote.len())
            .any(|window| window == makernote));
    }

    #[test]
    fn convert_with_metadata_override_preserves_helper_sidecar_metadata() {
        let img = synth(16, 16);
        let source = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let metadata = RawMetadata {
            icc: Some(b"SIDECAR-ICC".to_vec()),
            exif: Some(exif_with_orientation(6)),
            xmp: Some(
                r#"<rdf:Description tiff:Orientation="6"><dc:title>sidecar</dc:title></rdf:Description>"#
                    .as_bytes()
                    .to_vec(),
            ),
            iptc: None,
        };

        let encoded = convert_with_metadata(
            &source,
            Format::Png,
            &preserve_metadata_options(),
            Some(&metadata),
        )
        .unwrap();
        let back = PngCodec.decode(&encoded).unwrap();

        assert_eq!(back.icc, Some(b"SIDECAR-ICC".to_vec()));
        assert_eq!(
            back.exif.as_deref().and_then(exif_orientation),
            Some(image::metadata::Orientation::NoTransforms)
        );
        assert!(!String::from_utf8(back.xmp.unwrap())
            .unwrap()
            .contains("tiff:Orientation"));
    }

    #[test]
    fn thumbnail_downscales_to_max_edge_png() {
        let img = synth(320, 160);
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let thumb = thumbnail(&png, 96).unwrap().unwrap();

        assert_eq!((thumb.width, thumb.height), (96, 48));
        assert_eq!(Format::from_magic(&thumb.png), Some(Format::Png));
        let decoded = PngCodec.decode(&thumb.png).unwrap();
        assert_eq!((decoded.width, decoded.height), (96, 48));
    }

    #[test]
    fn thumbnail_skips_fully_transparent_images() {
        let mut img = synth(32, 32);
        for pixel in img.rgba8_mut().unwrap().chunks_exact_mut(4) {
            pixel[3] = 0;
        }
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();

        assert!(thumbnail(&png, 96).unwrap().is_none());
    }

    #[test]
    fn magic_detection() {
        let img = synth(8, 8);
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let jpg = JpegCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let webp = WebpCodec
            .encode(
                &img,
                &EncodeOptions {
                    quality: 80,
                    lossless: true,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        assert_eq!(Format::from_magic(&png), Some(Format::Png));
        assert_eq!(Format::from_magic(&jpg), Some(Format::Jpeg));
        assert_eq!(Format::from_magic(&webp), Some(Format::WebP));
        assert_eq!(Format::from_magic(b"not an image"), None);
        assert_eq!(Format::from_magic(b"RIFFxxxxWEBPxxxx"), None); // 错误 FourCC 不误判
    }

    #[test]
    fn bad_invariant_errors_not_panics() {
        // 绕过 new() 直接构造破坏不变量的 ImageData,编码入口应返回 Err 而非 panic。
        let bad = ImageData {
            width: 4,
            height: 4,
            pixels: PixelBuffer::Rgba8(vec![0u8; 10]),
            icc: None,
            exif: None,
            xmp: None,
            iptc: None,
        };
        assert!(PngCodec.encode(&bad, &EncodeOptions::default()).is_err());
        assert!(WebpCodec.encode(&bad, &EncodeOptions::default()).is_err());
        assert!(JpegCodec.encode(&bad, &EncodeOptions::default()).is_err());
    }

    #[test]
    fn png_is_lossless() {
        let img = synth(64, 48);
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let back = PngCodec.decode(&png).unwrap();
        assert_eq!((back.width, back.height), (64, 48));
        assert_eq!(back.rgba8().unwrap(), img.rgba8().unwrap()); // PNG 无损:逐字节一致
    }

    #[test]
    fn png_lossy_quantization_limits_colors_when_enabled() {
        let img = synth(64, 48);
        let png = PngCodec
            .encode(
                &img,
                &EncodeOptions {
                    png_lossy_quantize: true,
                    png_quant_colors: 64,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        let back = PngCodec.decode(&png).unwrap();
        let unique = back
            .rgba8()
            .unwrap()
            .chunks_exact(4)
            .map(|pixel| [pixel[0], pixel[1], pixel[2], pixel[3]])
            .collect::<std::collections::HashSet<_>>();

        assert!(unique.len() <= 64);
    }

    #[test]
    fn png_metadata_is_stripped_by_default_and_preserved_when_requested() {
        let mut img = synth(32, 24);
        let icc = b"PNG-ICC-PROFILE".to_vec();
        let exif = exif_with_orientation(1);
        let xmp = xmp_packet("png");
        img.icc = Some(icc.clone());
        img.exif = Some(exif.clone());
        img.xmp = Some(xmp.clone());

        let stripped = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let stripped_metadata = extract_png_metadata(&stripped, false);
        assert!(stripped_metadata.icc.is_none());
        assert!(stripped_metadata.exif.is_none());
        assert!(stripped_metadata.xmp.is_none());

        let preserved = PngCodec.encode(&img, &preserve_metadata_options()).unwrap();
        let metadata = extract_png_metadata(&preserved, false);
        assert_eq!(metadata.icc, Some(icc.clone()));
        assert_eq!(metadata.exif, Some(exif.clone()));
        assert_eq!(metadata.xmp, Some(xmp.clone()));

        let decoded = PngCodec.decode(&preserved).unwrap();
        assert_eq!(decoded.icc, Some(icc));
        assert_eq!(decoded.exif, Some(exif));
        assert_eq!(decoded.xmp, Some(xmp));
        assert_eq!(decoded.rgba8().unwrap(), img.rgba8().unwrap());
    }

    #[test]
    fn png_reads_compressed_itxt_xmp() {
        let img = synth(16, 12);
        let xmp = xmp_packet("png-compressed-itxt");
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&xmp).unwrap();
        let compressed = encoder.finish().unwrap();
        let mut data = Vec::with_capacity(PNG_XMP_KEYWORD.len() + 5 + compressed.len());
        data.extend_from_slice(PNG_XMP_KEYWORD);
        data.push(0);
        data.push(1); // compressed
        data.push(0); // zlib compression method
        data.push(0); // empty language tag
        data.push(0); // empty translated keyword
        data.extend_from_slice(&compressed);

        let with_xmp = insert_png_chunk_after_ihdr(&png, b"iTXt", &data);
        let metadata = extract_png_metadata(&with_xmp, false);
        assert_eq!(metadata.xmp, Some(xmp.clone()));

        let decoded = PngCodec.decode(&with_xmp).unwrap();
        assert_eq!(decoded.xmp, Some(xmp));
    }

    #[test]
    fn webp_lossless_roundtrip() {
        let img = synth(64, 48);
        let wp = WebpCodec
            .encode(
                &img,
                &EncodeOptions {
                    quality: 80,
                    lossless: true,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        let back = WebpCodec.decode(&wp).unwrap();
        assert_eq!((back.width, back.height), (64, 48));
        assert_eq!(back.rgba8().unwrap(), img.rgba8().unwrap()); // libwebp 无损
    }

    #[test]
    fn webp_lossy_ignores_near_lossless_setting() {
        let img = synth(64, 48);
        let mut options = EncodeOptions {
            quality: 75,
            lossless: false,
            webp_near_lossless: 0,
            ..EncodeOptions::default()
        };
        let with_near_lossless = WebpCodec.encode(&img, &options).unwrap();

        options.webp_near_lossless = 100;
        let without_near_lossless = WebpCodec.encode(&img, &options).unwrap();

        assert_eq!(with_near_lossless, without_near_lossless);
    }

    #[test]
    fn auto_quality_returns_jpeg_within_quality_bounds() {
        let img = synth(32, 32);
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let result = convert_auto_quality(
            &png,
            Format::Jpeg,
            &[EncodeOptions {
                quality: 72,
                ..EncodeOptions::default()
            }],
            &AutoQualityOptions {
                min_quality: 40,
                target_score: 50.0,
            },
        )
        .unwrap();

        assert_eq!(Format::from_magic(&result.bytes), Some(Format::Jpeg));
        assert!((40..=72).contains(&result.quality));
        assert!(result.score.is_some());
        assert!(!result.used_lossless);
    }

    #[test]
    fn auto_quality_rejects_unsupported_targets() {
        let img = synth(16, 16);
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let err = convert_auto_quality(
            &png,
            Format::Png,
            &[EncodeOptions::default()],
            &AutoQualityOptions::default(),
        )
        .unwrap_err();

        assert!(matches!(err, Error::Unsupported(_)));
    }

    #[test]
    fn webp_metadata_is_stripped_by_default_and_preserved_when_requested() {
        let mut img = synth(32, 24);
        let icc = b"WEBP-ICC-PROFILE".to_vec();
        let exif = exif_with_orientation(1);
        let xmp = xmp_packet("webp");
        img.icc = Some(icc.clone());
        img.exif = Some(exif.clone());
        img.xmp = Some(xmp.clone());

        let opts = EncodeOptions {
            lossless: true,
            ..EncodeOptions::default()
        };
        let stripped = WebpCodec.encode(&img, &opts).unwrap();
        let stripped_metadata = extract_webp_metadata(&stripped);
        assert!(stripped_metadata.icc.is_none());
        assert!(stripped_metadata.exif.is_none());
        assert!(stripped_metadata.xmp.is_none());

        let preserved = WebpCodec
            .encode(
                &img,
                &EncodeOptions {
                    lossless: true,
                    preserve_metadata: true,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        let metadata = extract_webp_metadata(&preserved);
        assert_eq!(metadata.icc, Some(icc.clone()));
        assert_eq!(metadata.exif, Some(exif.clone()));
        assert_eq!(metadata.xmp, Some(xmp.clone()));

        let decoded = WebpCodec.decode(&preserved).unwrap();
        assert_eq!(decoded.icc, Some(icc));
        assert_eq!(decoded.exif, Some(exif));
        assert_eq!(decoded.xmp, Some(xmp));
        assert_eq!(decoded.rgba8().unwrap(), img.rgba8().unwrap());
    }

    #[test]
    fn jpeg_alpha_flatten() {
        // 全透明图转 JPEG:应合成到白底、不 panic、尺寸正确。
        let mut img = synth(32, 32);
        for px in img.rgba8_mut().unwrap().chunks_exact_mut(4) {
            px[3] = 0;
        }
        let jpg = JpegCodec
            .encode(
                &img,
                &EncodeOptions {
                    quality: 90,
                    lossless: false,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        let back = JpegCodec.decode(&jpg).unwrap();
        assert_eq!((back.width, back.height), (32, 32));
        // 透明区合成白底 → 解出应接近白色(取中心像素,留有损余量)。
        let center = ((16 * 32 + 16) * 4) as usize;
        let back_rgba = back.rgba8().unwrap();
        assert!(back_rgba[center] > 230 && back_rgba[center + 1] > 230);
    }

    #[test]
    fn jpeg_progressive_option_controls_sof_marker() {
        let img = synth(32, 32);
        let progressive = JpegCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let baseline = JpegCodec
            .encode(
                &img,
                &EncodeOptions {
                    jpeg_progressive: false,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();

        assert!(jpeg_has_marker(&progressive, 0xc2));
        assert_eq!(Format::from_magic(&baseline), Some(Format::Jpeg));
        assert!(!jpeg_has_marker(&baseline, 0xc2));
    }

    #[test]
    fn format_specific_encoder_options_are_clamped_and_valid() {
        let img = synth(32, 32);
        let png = PngCodec
            .encode(
                &img,
                &EncodeOptions {
                    png_oxipng_level: 99,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        let webp = WebpCodec
            .encode(
                &img,
                &EncodeOptions {
                    webp_method: 99,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();

        assert_eq!(Format::from_magic(&png), Some(Format::Png));
        assert_eq!(Format::from_magic(&webp), Some(Format::WebP));
    }

    #[test]
    fn convert_best_of_returns_smallest_candidate() {
        let img = synth(48, 32);
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let progressive_opts = EncodeOptions::default();
        let baseline_opts = EncodeOptions {
            jpeg_progressive: false,
            ..EncodeOptions::default()
        };
        let progressive = convert(&png, Format::Jpeg, &progressive_opts).unwrap();
        let baseline = convert(&png, Format::Jpeg, &baseline_opts).unwrap();

        let best = convert_best_of(&png, Format::Jpeg, &[progressive_opts, baseline_opts]).unwrap();

        assert_eq!(Format::from_magic(&best), Some(Format::Jpeg));
        assert_eq!(best.len(), progressive.len().min(baseline.len()));
    }

    #[test]
    fn convert_best_of_rejects_empty_candidates() {
        let img = synth(8, 8);
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();

        let err = convert_best_of(&png, Format::Jpeg, &[]).unwrap_err();

        assert!(matches!(err, Error::Invalid(message) if message.contains("编码候选")));
    }

    #[test]
    fn cross_convert_png_webp_jpeg() {
        let img = synth(100, 80);
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();

        let webp = convert(
            &png,
            Format::WebP,
            &EncodeOptions {
                quality: 80,
                lossless: false,
                ..EncodeOptions::default()
            },
        )
        .unwrap();
        assert_eq!(Format::from_magic(&webp), Some(Format::WebP));

        let jpg = convert(
            &webp,
            Format::Jpeg,
            &EncodeOptions {
                quality: 85,
                lossless: false,
                ..EncodeOptions::default()
            },
        )
        .unwrap();
        assert_eq!(Format::from_magic(&jpg), Some(Format::Jpeg));

        let back = convert(&jpg, Format::Png, &EncodeOptions::default()).unwrap();
        let final_img = PngCodec.decode(&back).unwrap();
        assert_eq!((final_img.width, final_img.height), (100, 80));
    }

    #[test]
    fn convert_preserves_metadata_only_when_requested() {
        let mut img = synth(32, 24);
        let icc = b"PIPELINE-ICC".to_vec();
        let exif = exif_with_orientation(1);
        let xmp = xmp_packet("pipeline");
        img.icc = Some(icc.clone());
        img.exif = Some(exif.clone());
        img.xmp = Some(xmp.clone());
        let png = PngCodec.encode(&img, &preserve_metadata_options()).unwrap();

        let stripped = convert(&png, Format::Jpeg, &EncodeOptions::default()).unwrap();
        let stripped_metadata = extract_jpeg_metadata(&stripped, false);
        assert!(stripped_metadata.icc.is_none());
        assert!(stripped_metadata.exif.is_none());
        assert!(stripped_metadata.xmp.is_none());

        let preserved = convert(&png, Format::Jpeg, &preserve_metadata_options()).unwrap();
        let metadata = extract_jpeg_metadata(&preserved, false);
        assert_eq!(metadata.icc, Some(icc));
        assert_eq!(metadata.exif, Some(exif));
        assert_eq!(metadata.xmp, Some(xmp));
    }

    #[test]
    fn convert_preserves_xmp_between_supported_containers_when_requested() {
        let mut img = synth(24, 18);
        let xmp = xmp_packet("cross-format");
        img.xmp = Some(xmp.clone());
        let source = PngCodec.encode(&img, &preserve_metadata_options()).unwrap();

        for target in [Format::Jpeg, Format::Png, Format::WebP, Format::Avif] {
            let mut options = preserve_metadata_options();
            options.quality = 90;
            if target == Format::WebP {
                options.lossless = true;
            } else if target == Format::Avif {
                options.avif_speed = 10;
            }

            let encoded = convert(&source, target, &options).unwrap();
            let decoded = codec_for(target).decode(&encoded).unwrap();
            assert_eq!(decoded.xmp, Some(xmp.clone()), "{target:?} lost XMP");
        }
    }

    #[test]
    fn display_p3_icc_is_preserved_from_png_to_all_writable_formats() {
        let mut img = synth(17, 13);
        let icc = display_p3_icc_profile();
        assert_eq!(&icc[36..40], b"acsp");
        assert!(icc
            .windows(DISPLAY_P3_ICC_DESC.len())
            .any(|window| window == DISPLAY_P3_ICC_DESC.as_bytes()));
        img.icc = Some(icc.clone());

        let source = PngCodec.encode(&img, &preserve_metadata_options()).unwrap();
        let source_back = PngCodec.decode(&source).unwrap();
        assert_eq!(source_back.icc, Some(icc.clone()));
        assert_eq!(source_back.rgba8().unwrap(), img.rgba8().unwrap());

        for target in WRITABLE_FORMATS {
            let mut options = preserve_metadata_options();
            options.quality = 92;
            options.avif_speed = 10;
            if *target == Format::WebP {
                options.lossless = true;
                options.webp_method = 0;
            }

            let encoded = convert(&source, *target, &options).unwrap();
            assert_eq!(Format::from_magic(&encoded), Some(*target));
            let decoded = codec_for(*target).decode(&encoded).unwrap();
            assert_eq!((decoded.width, decoded.height), (img.width, img.height));
            assert_eq!(decoded.icc, Some(icc.clone()), "{target:?} lost ICC");
            if matches!(*target, Format::Png | Format::WebP) {
                assert_eq!(
                    decoded.rgba8().unwrap(),
                    img.rgba8().unwrap(),
                    "{target:?} changed lossless pixels"
                );
            }
        }
    }

    #[test]
    fn avif_roundtrip_dims() {
        let img = synth(48, 40);
        let av = AvifCodec
            .encode(
                &img,
                &EncodeOptions {
                    quality: 80,
                    lossless: false,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        assert_eq!(Format::from_magic(&av), Some(Format::Avif));
        let back = AvifCodec.decode(&av).unwrap();
        assert_eq!((back.width, back.height), (48, 40));
    }

    #[test]
    fn avif_preserves_icc() {
        // 尖刺核心验证:libavif 容器逐字节保留 ICC(这正是弃用裸 ravif 的主因)。
        let mut img = synth(32, 32);
        let fake_icc = b"FAKE-ICC-PROFILE-BLOB-0123456789".to_vec();
        let exif = exif_with_orientation(1);
        let xmp = xmp_packet("avif");
        img.icc = Some(fake_icc.clone());
        img.exif = Some(exif.clone());
        img.xmp = Some(xmp.clone());
        let stripped = AvifCodec
            .encode(
                &img,
                &EncodeOptions {
                    quality: 85,
                    ..EncodeOptions::default()
                },
            )
            .unwrap();
        let stripped_back = AvifCodec.decode(&stripped).unwrap();
        assert_eq!(stripped_back.icc, None);
        assert_eq!(stripped_back.exif, None);
        assert_eq!(stripped_back.xmp, None);

        let av = AvifCodec
            .encode(
                &img,
                &EncodeOptions {
                    quality: 85,
                    ..preserve_metadata_options()
                },
            )
            .unwrap();
        let extracted = extract_avif_metadata(&av);
        assert_eq!(extracted.icc, Some(fake_icc.clone()));
        assert_eq!(extracted.exif, Some(exif.clone()));
        assert_eq!(extracted.xmp, Some(xmp.clone()));
        assert_eq!(metadata_from_image_format(&av, Format::Avif), extracted);

        let back = AvifCodec.decode(&av).unwrap();
        assert_eq!(back.icc, Some(fake_icc));
        assert_eq!(back.exif, Some(exif));
        assert_eq!(back.xmp, Some(xmp));
    }

    #[test]
    fn convert_png_to_avif_and_back() {
        let img = synth(64, 64);
        let png = PngCodec.encode(&img, &EncodeOptions::default()).unwrap();
        let av = convert(
            &png,
            Format::Avif,
            &EncodeOptions {
                quality: 80,
                lossless: false,
                ..EncodeOptions::default()
            },
        )
        .unwrap();
        assert_eq!(Format::from_magic(&av), Some(Format::Avif));
        let back = convert(&av, Format::Png, &EncodeOptions::default()).unwrap();
        assert_eq!(PngCodec.decode(&back).unwrap().width, 64);
    }
}
