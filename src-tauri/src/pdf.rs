// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Bounded, one-way PDF rasterization for the desktop adapter.
//!
//! PDF is a document input rather than an `imgconvert-core::Format`: this module validates the
//! document/page selection and turns one page at a time into the core's trusted RGBA boundary.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::page::Page;
use hayro::hayro_syntax::{LoadPdfError, Pdf};
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{RenderCache, RenderSettings};
use imgconvert_core::{ImageData, MAX_PIXELS};
use serde::Deserialize;

pub const DEFAULT_PDF_DPI: u16 = 150;
pub const MIN_PDF_DPI: u16 = 72;
pub const MAX_PDF_DPI: u16 = 600;
pub const MAX_SELECTED_PDF_PAGES: usize = 500;
pub const MAX_PDF_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_PDF_PAGE_RANGE_CHARS: usize = 2048;
pub const PDF_PASSWORD_PROTECTED_PREFIX: &str = "PDF_PASSWORD_PROTECTED:";
pub const PDF_SETTINGS_INVALID_PREFIX: &str = "PDF_SETTINGS_INVALID:";
pub const PDF_RESOURCE_LIMIT_PREFIX: &str = "PDF_RESOURCE_LIMIT:";
pub const PDF_INVALID_PREFIX: &str = "PDF_INVALID:";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfConvertOptions {
    #[serde(default = "default_pdf_dpi")]
    pub dpi: u16,
    /// Empty/missing means every page. Otherwise accepts comma-separated pages/ranges such as
    /// `1-3, 5, 8-10`.
    #[serde(default)]
    pub page_range: Option<String>,
}

impl Default for PdfConvertOptions {
    fn default() -> Self {
        Self {
            dpi: DEFAULT_PDF_DPI,
            page_range: None,
        }
    }
}

fn default_pdf_dpi() -> u16 {
    DEFAULT_PDF_DPI
}

pub struct PdfDocument {
    pdf: Pdf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfSelection {
    /// Zero-based indexes in the user's requested order.
    pub pages: Vec<usize>,
    pub page_count: usize,
    pub dpi: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PdfPageDimensions {
    pub width: u32,
    pub height: u32,
}

/// A rendered page plus non-fatal interpreter warnings emitted while drawing it.
/// Hayro otherwise discards these warnings by default, which could silently hide missing content.
pub struct RenderedPdfPage {
    pub image: ImageData,
    pub warning_count: usize,
}

pub struct RenderedPdfThumbnail {
    pub png: Vec<u8>,
    pub warning_count: usize,
}

impl PdfDocument {
    pub fn load(bytes: Vec<u8>) -> Result<Self, String> {
        let loaded = catch_pdf_unwind("解析 PDF", || Pdf::new(bytes)).map_err(pdf_invalid)?;
        let pdf = loaded.map_err(pdf_load_error)?;
        if pdf.pages().is_empty() {
            return Err(pdf_invalid("PDF 不包含可渲染页面"));
        }
        Ok(Self { pdf })
    }

    pub fn page_count(&self) -> usize {
        self.pdf.pages().len()
    }

    pub fn selection(&self, options: Option<&PdfConvertOptions>) -> Result<PdfSelection, String> {
        let options = options.cloned().unwrap_or_default();
        validate_pdf_dpi(options.dpi).map_err(pdf_settings_invalid)?;
        let pages = parse_page_range(options.page_range.as_deref(), self.page_count())
            .map_err(pdf_settings_invalid)?;
        Ok(PdfSelection {
            pages,
            page_count: self.page_count(),
            dpi: options.dpi,
        })
    }

    pub fn first_page_dimensions_at_default_dpi(&self) -> Result<PdfPageDimensions, String> {
        let page = self
            .pdf
            .pages()
            .first()
            .ok_or_else(|| pdf_invalid("PDF 不包含可渲染页面"))?;
        page_dimensions(page, DEFAULT_PDF_DPI)
    }

    pub fn page_dimensions(
        &self,
        page_index: usize,
        dpi: u16,
    ) -> Result<PdfPageDimensions, String> {
        validate_pdf_dpi(dpi).map_err(pdf_settings_invalid)?;
        let page = self.pdf.pages().get(page_index).ok_or_else(|| {
            pdf_settings_invalid(format!(
                "PDF 页码超出范围: {}（文档共 {} 页）",
                page_index.saturating_add(1),
                self.page_count()
            ))
        })?;
        page_dimensions(page, dpi)
    }

    pub fn new_render_cache(&self) -> RenderCache<'_> {
        RenderCache::new()
    }

    pub fn render_page<'a>(
        &'a self,
        page_index: usize,
        dpi: u16,
        cache: &RenderCache<'a>,
    ) -> Result<RenderedPdfPage, String> {
        validate_pdf_dpi(dpi).map_err(pdf_settings_invalid)?;
        let page = self.pdf.pages().get(page_index).ok_or_else(|| {
            pdf_settings_invalid(format!(
                "PDF 页码超出范围: {}（文档共 {} 页）",
                page_index.saturating_add(1),
                self.page_count()
            ))
        })?;
        let dimensions = page_dimensions(page, dpi)?;
        let scale = f32::from(dpi) / 72.0;
        let width = u16::try_from(dimensions.width).map_err(|_| {
            pdf_resource_limit(format!("PDF 第 {} 页宽度超过渲染器上限", page_index + 1))
        })?;
        let height = u16::try_from(dimensions.height).map_err(|_| {
            pdf_resource_limit(format!("PDF 第 {} 页高度超过渲染器上限", page_index + 1))
        })?;
        let settings = RenderSettings {
            x_scale: scale,
            y_scale: scale,
            width: Some(width),
            height: Some(height),
            // Image outputs do not have a portable notion of PDF page transparency. White is the
            // least surprising page background and avoids premultiplied-alpha conversion loss.
            bg_color: WHITE,
        };
        let warning_count = Arc::new(AtomicUsize::new(0));
        let warning_counter = warning_count.clone();
        let interpreter = InterpreterSettings {
            warning_sink: Arc::new(move |_| {
                warning_counter.fetch_add(1, Ordering::Relaxed);
            }),
            ..InterpreterSettings::default()
        };
        let pixmap = catch_pdf_unwind("渲染 PDF 页面", || {
            hayro::render(page, cache, &interpreter, &settings)
        })
        .map_err(pdf_invalid)?;
        let image = ImageData::new(
            dimensions.width,
            dimensions.height,
            pixmap.data_as_u8_slice().to_vec(),
        )
        .map_err(|error| pdf_invalid(format!("PDF 渲染像素无效: {error}")))?;
        Ok(RenderedPdfPage {
            image,
            warning_count: warning_count.load(Ordering::Relaxed),
        })
    }

    pub fn render_first_page_thumbnail(
        &self,
        max_edge: u32,
    ) -> Result<RenderedPdfThumbnail, String> {
        let page = self
            .pdf
            .pages()
            .first()
            .ok_or_else(|| pdf_invalid("PDF 不包含可渲染页面"))?;
        let (width_points, height_points) = page.render_dimensions();
        validate_page_points(width_points, height_points)?;
        let longest = width_points.max(height_points);
        let scale = (max_edge as f32 / longest).min(1.0);
        let width = scaled_dimension(width_points, scale, "宽度")?;
        let height = scaled_dimension(height_points, scale, "高度")?;
        validate_pixel_budget(u32::from(width), u32::from(height))?;
        let cache = RenderCache::new();
        let warning_count = Arc::new(AtomicUsize::new(0));
        let warning_counter = warning_count.clone();
        let interpreter = InterpreterSettings {
            warning_sink: Arc::new(move |_| {
                warning_counter.fetch_add(1, Ordering::Relaxed);
            }),
            ..InterpreterSettings::default()
        };
        let settings = RenderSettings {
            x_scale: scale,
            y_scale: scale,
            width: Some(width),
            height: Some(height),
            bg_color: WHITE,
        };
        let pixmap = catch_pdf_unwind("渲染 PDF 缩略图", || {
            hayro::render(page, &cache, &interpreter, &settings)
        })
        .map_err(pdf_invalid)?;
        let png = pixmap
            .into_png()
            .map_err(|error| pdf_invalid(format!("无法编码 PDF 缩略图: {error}")))?;
        Ok(RenderedPdfThumbnail {
            png,
            warning_count: warning_count.load(Ordering::Relaxed),
        })
    }
}

pub fn read_pdf_file(path: &Path) -> Result<Vec<u8>, String> {
    read_pdf_file_with_limit(path, MAX_PDF_SOURCE_BYTES)?.ok_or_else(|| {
        pdf_resource_limit(format!(
            "PDF 文件超过 {} MiB 上限: {}",
            MAX_PDF_SOURCE_BYTES / (1024 * 1024),
            path.display()
        ))
    })
}

/// Reads a PDF only when it fits inside a caller-specific budget. Returning
/// `None` lets lightweight callers such as import scanning defer expensive
/// document parsing without rejecting a file that remains valid for conversion.
/// The bounded second read closes the race where the file grows after metadata
/// inspection.
pub fn read_pdf_file_with_limit(path: &Path, max_bytes: u64) -> Result<Option<Vec<u8>>, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("无法读取 PDF 文件 {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(pdf_invalid(format!(
            "PDF 输入路径不是文件: {}",
            path.display()
        )));
    }
    if metadata.len() > max_bytes {
        return Ok(None);
    }
    let file = File::open(path)
        .map_err(|error| format!("无法读取 PDF 文件 {}: {error}", path.display()))?;
    read_pdf_source_with_limit(file.take(max_bytes.saturating_add(1)), path, max_bytes)
}

fn read_pdf_source_with_limit(
    mut reader: impl Read,
    path: &Path,
    max_bytes: u64,
) -> Result<Option<Vec<u8>>, String> {
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取 PDF 文件 {}: {error}", path.display()))?;
    if bytes.len() as u64 > max_bytes {
        return Ok(None);
    }
    Ok(Some(bytes))
}

pub fn is_pdf_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

#[cfg(feature = "fuzzing")]
pub(crate) fn fuzz_document_bytes(bytes: &[u8]) {
    // Keep allocations below the production source cap while leaving enough room for xref/object
    // graph edge cases. Cargo-fuzz can generate larger inputs, so bound this exact public bridge.
    const MAX_FUZZ_PDF_BYTES: usize = 1024 * 1024;
    if bytes.len() > MAX_FUZZ_PDF_BYTES {
        return;
    }
    let Ok(document) = PdfDocument::load(bytes.to_vec()) else {
        return;
    };
    for page_index in 0..document.page_count().min(16) {
        let _ = document.page_dimensions(page_index, DEFAULT_PDF_DPI);
    }
}

pub fn parse_page_range(raw: Option<&str>, page_count: usize) -> Result<Vec<usize>, String> {
    if page_count == 0 {
        return Err("PDF 不包含可渲染页面".to_string());
    }
    let raw = raw.map(str::trim).filter(|value| !value.is_empty());
    if raw.is_some_and(|value| value.chars().count() > MAX_PDF_PAGE_RANGE_CHARS) {
        return Err("PDF 页码范围输入过长".to_string());
    }
    if raw.is_none() {
        if page_count > MAX_SELECTED_PDF_PAGES {
            return Err(format!(
                "PDF 共 {page_count} 页；一次最多转换 {MAX_SELECTED_PDF_PAGES} 页，请填写页码范围"
            ));
        }
        return Ok((0..page_count).collect());
    }

    let mut pages = Vec::new();
    let mut seen = HashSet::new();
    for token in raw.unwrap_or_default().split(',') {
        let token = token.trim();
        if token.is_empty() {
            return Err("PDF 页码范围包含空片段".to_string());
        }
        let (start, end) = match token.split_once('-') {
            Some((start, end)) if !end.contains('-') => {
                (parse_page_number(start)?, parse_page_number(end)?)
            }
            Some(_) => return Err(format!("PDF 页码范围格式无效: {token}")),
            None => {
                let page = parse_page_number(token)?;
                (page, page)
            }
        };
        if start > end {
            return Err(format!("PDF 页码范围不能倒序: {token}"));
        }
        if end > page_count {
            return Err(format!("PDF 页码 {end} 超出范围（文档共 {page_count} 页）"));
        }
        for page in start..=end {
            if seen.insert(page) {
                pages.push(page - 1);
                if pages.len() > MAX_SELECTED_PDF_PAGES {
                    return Err(format!("一次最多转换 {MAX_SELECTED_PDF_PAGES} 个 PDF 页面"));
                }
            }
        }
    }
    if pages.is_empty() {
        return Err("PDF 页码范围不能为空".to_string());
    }
    Ok(pages)
}

fn parse_page_number(raw: &str) -> Result<usize, String> {
    let value = raw.trim();
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("PDF 页码必须是正整数: {raw}"));
    }
    let page = value
        .parse::<usize>()
        .map_err(|_| format!("PDF 页码过大: {value}"))?;
    if page == 0 {
        return Err("PDF 页码从 1 开始".to_string());
    }
    Ok(page)
}

fn validate_pdf_dpi(dpi: u16) -> Result<(), String> {
    if !(MIN_PDF_DPI..=MAX_PDF_DPI).contains(&dpi) {
        return Err(format!(
            "PDF 分辨率必须在 {MIN_PDF_DPI}..={MAX_PDF_DPI} DPI 之间"
        ));
    }
    Ok(())
}

fn page_dimensions(page: &Page<'_>, dpi: u16) -> Result<PdfPageDimensions, String> {
    let (width_points, height_points) = page.render_dimensions();
    validate_page_points(width_points, height_points)?;
    let scale = f32::from(dpi) / 72.0;
    let width = u32::from(scaled_dimension(width_points, scale, "宽度")?);
    let height = u32::from(scaled_dimension(height_points, scale, "高度")?);
    validate_pixel_budget(width, height)?;
    Ok(PdfPageDimensions { width, height })
}

fn validate_page_points(width: f32, height: f32) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(pdf_invalid("PDF 页面尺寸无效"));
    }
    Ok(())
}

fn scaled_dimension(points: f32, scale: f32, label: &str) -> Result<u16, String> {
    let scaled = (points * scale).ceil().max(1.0);
    if !scaled.is_finite() || scaled > f32::from(u16::MAX) {
        return Err(pdf_resource_limit(format!(
            "PDF 页面{label}超过 65535 像素渲染上限"
        )));
    }
    Ok(scaled as u16)
}

fn validate_pixel_budget(width: u32, height: u32) -> Result<(), String> {
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| pdf_resource_limit("PDF 页面像素数溢出"))?;
    if pixels > MAX_PIXELS as u64 {
        return Err(pdf_resource_limit(format!(
            "PDF 页面在所选 DPI 下为 {width}×{height}（{pixels} 像素），超过 {MAX_PIXELS} 像素上限；请降低 DPI"
        )));
    }
    Ok(())
}

fn pdf_load_error(error: LoadPdfError) -> String {
    match error {
        LoadPdfError::Decryption(_) => {
            format!("{PDF_PASSWORD_PROTECTED_PREFIX} PDF 已加密或受密码保护，当前不支持")
        }
        LoadPdfError::Invalid => pdf_invalid("PDF 文件无效或包含暂不支持的结构"),
    }
}

fn pdf_settings_invalid(detail: impl std::fmt::Display) -> String {
    format!("{PDF_SETTINGS_INVALID_PREFIX} {detail}")
}

fn pdf_resource_limit(detail: impl std::fmt::Display) -> String {
    format!("{PDF_RESOURCE_LIMIT_PREFIX} {detail}")
}

fn pdf_invalid(detail: impl std::fmt::Display) -> String {
    format!("{PDF_INVALID_PREFIX} {detail}")
}

fn catch_pdf_unwind<T>(label: &str, operation: impl FnOnce() -> T) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(operation))
        .map_err(|_| format!("{label}时内部组件异常，已安全终止当前文件"))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn minimal_pdf(page_count: usize) -> Vec<u8> {
        assert!(page_count > 0);
        let first_content_id = 3 + page_count;
        let kids = (0..page_count)
            .map(|index| format!("{} 0 R", 3 + index))
            .collect::<Vec<_>>()
            .join(" ");
        let mut objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            format!("<< /Type /Pages /Kids [{kids}] /Count {page_count} >>"),
        ];
        for index in 0..page_count {
            objects.push(format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents {} 0 R >>",
                first_content_id + index
            ));
        }
        for index in 0..page_count {
            let red = if index % 2 == 0 { "1" } else { "0" };
            let blue = if index % 2 == 0 { "0" } else { "1" };
            let stream = format!("q {red} 0 {blue} rg 0 0 72 72 re f Q\n");
            objects.push(format!(
                "<< /Length {} >>\nstream\n{}endstream",
                stream.len(),
                stream
            ));
        }

        let mut bytes = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
        let mut offsets = vec![0usize];
        for (index, object) in objects.iter().enumerate() {
            offsets.push(bytes.len());
            bytes
                .extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
        }
        let xref = bytes.len();
        bytes.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
        bytes.extend_from_slice(b"0000000000 65535 f \n");
        for offset in offsets.into_iter().skip(1) {
            bytes.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        bytes.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                objects.len() + 1
            )
            .as_bytes(),
        );
        bytes
    }

    #[test]
    fn page_range_defaults_to_all_pages() {
        assert_eq!(parse_page_range(None, 4).unwrap(), vec![0, 1, 2, 3]);
        assert_eq!(parse_page_range(Some("  "), 2).unwrap(), vec![0, 1]);
    }

    #[test]
    fn page_range_rejects_oversized_text_before_parsing() {
        let oversized = "1,".repeat(MAX_PDF_PAGE_RANGE_CHARS);
        let error = parse_page_range(Some(&oversized), 10).unwrap_err();
        assert!(error.contains("输入过长"));
    }

    #[test]
    fn page_range_preserves_request_order_and_deduplicates() {
        assert_eq!(
            parse_page_range(Some("3, 1-2, 2, 5"), 5).unwrap(),
            vec![2, 0, 1, 4]
        );
    }

    #[test]
    fn page_range_rejects_malformed_and_out_of_bounds_values() {
        for value in ["0", "2-1", "1,,2", "1-2-3", "+1", "4"] {
            assert!(
                parse_page_range(Some(value), 3).is_err(),
                "{value} should fail"
            );
        }
    }

    #[test]
    fn implicit_all_requires_an_explicit_range_for_huge_documents() {
        let error = parse_page_range(None, MAX_SELECTED_PDF_PAGES + 1).unwrap_err();
        assert!(error.contains("请填写页码范围"));
    }

    #[test]
    fn invalid_pdf_is_rejected_without_panicking() {
        assert!(PdfDocument::load(b"not a pdf".to_vec()).is_err());
    }

    #[test]
    fn valid_pdf_reports_pages_and_renders_bounded_rgba() {
        let document = PdfDocument::load(minimal_pdf(2)).unwrap();
        assert_eq!(document.page_count(), 2);
        let selection = document
            .selection(Some(&PdfConvertOptions {
                dpi: 72,
                page_range: Some("2".to_string()),
            }))
            .unwrap();
        assert_eq!(selection.pages, vec![1]);
        let cache = document.new_render_cache();
        let rendered = document.render_page(1, 72, &cache).unwrap();
        assert_eq!((rendered.image.width, rendered.image.height), (72, 72));
        let rgba = rendered.image.rgba8().unwrap();
        assert_eq!(rgba.len(), 72 * 72 * 4);
        let center = (36 * 72 + 36) * 4;
        assert_eq!(&rgba[center..center + 4], &[0, 0, 255, 255]);
        assert_eq!(rendered.warning_count, 0);
        let thumbnail = document.render_first_page_thumbnail(48).unwrap();
        assert!(thumbnail.png.starts_with(&[0x89, b'P', b'N', b'G']));
        assert_eq!(thumbnail.warning_count, 0);
    }

    #[test]
    fn bounded_pdf_reader_rejects_growth_past_the_caller_budget() {
        let bytes = vec![0u8; 9];
        let result =
            read_pdf_source_with_limit(std::io::Cursor::new(bytes), Path::new("growing.pdf"), 8)
                .unwrap();

        assert!(result.is_none());
    }
}
