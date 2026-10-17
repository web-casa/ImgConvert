// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The one settings/item → [`ConvertOptions`] builder, ported from the Svelte
//! shell's `buildConvertRequest`. Planning, batch conversion and preview all
//! go through here so workflow fields cannot drift between those paths.

use imgconvert_platform::settings::{js_trim, MetadataPolicy, OverwriteMode, ResizeMode, Settings};

use crate::convert::{Capabilities, ConvertOptions, ResizeOptions};
use crate::pdf::PdfConvertOptions;

/// The queue item facts the builder needs.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[non_exhaustive]
pub struct ConversionItem {
    pub path: String,
    pub relative_dir: Option<String>,
    /// Import-time metadata when the scan produced it.
    pub source_format: Option<String>,
    pub source_width: Option<u32>,
    pub source_height: Option<u32>,
}

impl ConversionItem {
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            ..Self::default()
        }
    }

    /// The folder of the item relative to its import root, used to mirror
    /// the source tree under the output folder.
    #[must_use]
    pub fn with_relative_dir(mut self, relative_dir: Option<String>) -> Self {
        self.relative_dir = relative_dir;
        self
    }

    /// Import-time format and pixel size, when the scan produced them.
    #[must_use]
    pub fn with_source(
        mut self,
        format: Option<String>,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Self {
        self.source_format = format;
        self.source_width = width;
        self.source_height = height;
        self
    }

    pub fn is_pdf(&self) -> bool {
        self.source_format.as_deref() == Some("pdf")
            || std::path::Path::new(&self.path)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
    }
}

/// The per-format quality floor stored in the settings.
pub fn quality_floor_for(settings: &Settings, format: &str) -> u8 {
    match format {
        "jpeg" => settings.jpeg_quality_floor,
        "webp" => settings.webp_quality_floor,
        "avif" => settings.avif_quality_floor,
        _ => 0,
    }
}

pub fn supports_lossless(capabilities: &Capabilities, format: &str) -> bool {
    capabilities.lossless.contains(&format)
}

/// Target size only applies to lossy jpeg/webp output.
pub fn target_size_supported(settings: &Settings, format: &str) -> bool {
    matches!(format, "jpeg" | "webp") && !settings.lossless
}

/// The quality the encoder will actually use once the per-format floor is
/// applied (`effectiveQualityFor`): floors below 30 are off.
pub fn effective_quality_for(settings: &Settings, format: &str, lossless_supported: bool) -> u8 {
    let requested = settings.quality.clamp(1, 100);
    if format == "png" || (settings.lossless && lossless_supported) {
        return requested;
    }
    let floor = quality_floor_for(settings, format);
    if floor >= 30 {
        requested.max(floor)
    } else {
        requested
    }
}

/// Target size is on but cannot apply: auto quality or lossless is also on,
/// or the output format is not lossy JPEG/WebP. Start must refuse this.
pub fn has_invalid_target_size_configuration(settings: &Settings, formats: &[&str]) -> bool {
    if !settings.target_size_enabled {
        return false;
    }
    if settings.auto_quality || settings.lossless {
        return true;
    }
    formats
        .iter()
        .any(|format| !target_size_supported(settings, format))
}

/// Most pages one job may rasterize.
pub const MAX_PDF_PAGES_PER_JOB: usize = 500;

/// Why a page range is rejected. The shells translate these.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum PdfPageRangeError {
    /// A large document needs an explicit selection of at most `limit` pages.
    SelectionRequired {
        limit: usize,
    },
    TooLong,
    Invalid,
    OutOfBounds {
        page_count: usize,
    },
    TooManyPages {
        limit: usize,
    },
}

/// Validates a page-range expression such as `1-3, 5, 8-10` the way the
/// Svelte shell does (`validatePdfPageRange`). `page_count` is the
/// document's page count when known.
pub fn validate_pdf_page_range(
    value: &str,
    page_count: Option<usize>,
) -> Result<(), PdfPageRangeError> {
    use imgconvert_platform::settings::MAX_PDF_PAGE_RANGE_CHARS;
    let range = js_trim(value);
    if range.is_empty() {
        return match page_count {
            Some(count) if count > MAX_PDF_PAGES_PER_JOB => {
                Err(PdfPageRangeError::SelectionRequired {
                    limit: MAX_PDF_PAGES_PER_JOB,
                })
            }
            _ => Ok(()),
        };
    }
    if range.encode_utf16().count() > MAX_PDF_PAGE_RANGE_CHARS {
        return Err(PdfPageRangeError::TooLong);
    }
    let mut selected = std::collections::HashSet::new();
    for raw_token in range.split(',') {
        let token = js_trim(raw_token);
        if token.is_empty() {
            return Err(PdfPageRangeError::Invalid);
        }
        let (start, end) = parse_page_token(token).ok_or(PdfPageRangeError::Invalid)?;
        if start < 1 || start > end {
            return Err(PdfPageRangeError::Invalid);
        }
        if let Some(count) = page_count {
            if end > count {
                return Err(PdfPageRangeError::OutOfBounds { page_count: count });
            }
        }
        if end - start + 1 > MAX_PDF_PAGES_PER_JOB {
            return Err(PdfPageRangeError::TooManyPages {
                limit: MAX_PDF_PAGES_PER_JOB,
            });
        }
        for page in start..=end {
            selected.insert(page);
            if selected.len() > MAX_PDF_PAGES_PER_JOB {
                return Err(PdfPageRangeError::TooManyPages {
                    limit: MAX_PDF_PAGES_PER_JOB,
                });
            }
        }
    }
    Ok(())
}

/// `^(\d+)(?:\s*-\s*(\d+))?$` with JavaScript safe-integer bounds.
fn parse_page_token(token: &str) -> Option<(usize, usize)> {
    const MAX_SAFE: u64 = 9_007_199_254_740_991;
    let digits = |text: &str| -> Option<u64> {
        if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let value: u64 = text.parse().ok()?;
        (value <= MAX_SAFE).then_some(value)
    };
    let (start, end) = match token.split_once('-') {
        Some((start, end)) => (digits(js_trim(start))?, digits(js_trim(end))?),
        None => {
            let page = digits(token)?;
            (page, page)
        }
    };
    Some((usize::try_from(start).ok()?, usize::try_from(end).ok()?))
}

/// The suffix sent with a request: only while the switch is on.
pub fn output_suffix_for_request(settings: &Settings) -> Option<String> {
    settings
        .output_suffix_enabled
        .then(|| settings.output_suffix.clone())
}

/// Builds the backend options for one item from the current settings.
pub fn conversion_options_for(
    settings: &Settings,
    item: &ConversionItem,
    format: &str,
    quality_floor: u8,
    lossless_supported: bool,
    output_suffix: Option<&str>,
) -> ConvertOptions {
    let lossless = settings.lossless && lossless_supported;
    let pdf_input = item.is_pdf();
    let resize_mode = settings.resize_mode;
    let uses = |modes: &[ResizeMode]| modes.contains(&resize_mode);
    ConvertOptions {
        input: item.path.clone(),
        out_dir: settings.out_dir.clone(),
        // `settings.outDir ? item.relativeDir : null`: an empty string is
        // falsy in the Svelte shell and normalization permits it.
        relative_dir: if settings
            .out_dir
            .as_deref()
            .is_some_and(|dir| !dir.is_empty())
        {
            item.relative_dir.clone()
        } else {
            None
        },
        source_width: item.source_width,
        source_height: item.source_height,
        format: format.to_string(),
        quality: settings.quality,
        quality_floor,
        lossless,
        jpeg_progressive: settings.jpeg_progressive,
        png_oxipng_level: settings.png_oxipng_level,
        png_lossy_quantize: settings.png_lossy_quantize,
        png_quant_colors: settings.png_quant_colors,
        webp_method: settings.webp_method,
        avif_speed: settings.avif_speed,
        avif_subsample: settings.avif_subsample.as_str().to_string(),
        webp_near_lossless: if format == "webp" && lossless {
            settings.webp_near_lossless
        } else {
            100
        },
        webp_sharp_yuv: settings.webp_sharp_yuv,
        jpeg_trellis: settings.jpeg_trellis,
        auto_quality: settings.auto_quality,
        auto_quality_score: f64::from(settings.auto_quality_score),
        generation_loss_protection: !pdf_input && settings.generation_loss_protection,
        result_cache: !pdf_input && settings.result_cache,
        skip_if_larger: !pdf_input && settings.skip_if_larger,
        multi_candidate: settings.multi_candidate,
        overwrite: settings.overwrite == OverwriteMode::Overwrite,
        overwrite_mode: Some(settings.overwrite.as_str().to_string()),
        file_name_template: Some(settings.file_name_template.clone()),
        output_suffix: output_suffix.map(str::to_string),
        allow_source_overwrite: false,
        preserve_metadata: Some(settings.metadata_policy == MetadataPolicy::PreserveAll),
        metadata_policy: Some(settings.metadata_policy.as_str().to_string()),
        resize: Some(ResizeOptions {
            mode: Some(resize_mode.as_str().to_string()),
            width: uses(&[ResizeMode::Fit, ResizeMode::Width]).then_some(settings.resize_width),
            height: uses(&[ResizeMode::Fit, ResizeMode::Height]).then_some(settings.resize_height),
            value: uses(&[ResizeMode::LongestEdge, ResizeMode::Percentage])
                .then_some(settings.resize_value),
            allow_upscale: settings.resize_allow_upscale,
        }),
        target_size_bytes: settings
            .target_size_enabled
            .then(|| u64::from(settings.target_size_kib) * 1024),
        color_management_policy: Some(settings.color_management_policy.as_str().to_string()),
        pdf: pdf_input.then(|| PdfConvertOptions {
            dpi: settings.pdf_dpi,
            page_range: {
                let range = js_trim(&settings.pdf_page_range);
                (!range.is_empty()).then(|| range.to_string())
            },
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use imgconvert_platform::settings::ColorManagementPolicy;

    fn settings() -> Settings {
        let mut s = Settings::default();
        s.quality = 82;
        s.out_dir = Some("/tmp/out".into());
        s.metadata_policy = MetadataPolicy::ColorOnly;
        s.resize_mode = ResizeMode::Fit;
        s.resize_width = 1280;
        s.resize_height = 720;
        s.target_size_enabled = true;
        s.target_size_kib = 640;
        s.color_management_policy = ColorManagementPolicy::Preserve;
        s
    }

    fn item() -> ConversionItem {
        ConversionItem {
            path: "/tmp/source.png".into(),
            relative_dir: Some("nested".into()),
            source_format: Some("png".into()),
            source_width: Some(4000),
            source_height: Some(3000),
        }
    }

    #[test]
    fn builds_the_shared_plan_batch_and_preview_fields() {
        let options =
            conversion_options_for(&settings(), &item(), "jpeg", 30, false, Some("_done"));
        assert_eq!(options.input, "/tmp/source.png");
        assert_eq!(options.relative_dir.as_deref(), Some("nested"));
        assert_eq!(
            (options.source_width, options.source_height),
            (Some(4000), Some(3000))
        );
        assert_eq!(options.metadata_policy.as_deref(), Some("colorOnly"));
        assert_eq!(options.preserve_metadata, Some(false));
        let resize = options.resize.unwrap();
        assert_eq!(resize.mode.as_deref(), Some("fit"));
        assert_eq!(
            (resize.width, resize.height, resize.value),
            (Some(1280), Some(720), None)
        );
        assert_eq!(options.target_size_bytes, Some(640 * 1024));
        assert!(!options.allow_source_overwrite);
        assert_eq!(options.overwrite_mode.as_deref(), Some("skip"));
        assert!(!options.overwrite);
        assert_eq!(options.output_suffix.as_deref(), Some("_done"));
    }

    #[test]
    fn inactive_resize_fields_are_cleared_and_webp_near_lossless_carried() {
        let mut s = settings();
        s.lossless = true;
        s.webp_near_lossless = 65;
        s.resize_mode = ResizeMode::None;
        s.target_size_enabled = false;
        let options = conversion_options_for(&s, &item(), "webp", 0, true, None);
        assert!(options.lossless);
        assert_eq!(options.webp_near_lossless, 65);
        let resize = options.resize.unwrap();
        assert_eq!(
            (resize.width, resize.height, resize.value),
            (None, None, None)
        );
        assert_eq!(options.target_size_bytes, None);
        assert_eq!(options.output_suffix, None);
        // Near-lossless is only meaningful for lossless WebP.
        let lossy = conversion_options_for(&s, &item(), "jpeg", 30, false, None);
        assert_eq!(lossy.webp_near_lossless, 100);
    }

    #[test]
    fn single_axis_resize_uses_its_dedicated_field() {
        for (mode, expected) in [
            (ResizeMode::Width, (Some(1440), None, None)),
            (ResizeMode::Height, (None, Some(810), None)),
            (ResizeMode::LongestEdge, (None, None, Some(3333))),
        ] {
            let mut s = settings();
            s.resize_mode = mode;
            s.resize_width = 1440;
            s.resize_height = 810;
            s.resize_value = 3333;
            let resize = conversion_options_for(&s, &item(), "jpeg", 30, false, Some("_done"))
                .resize
                .unwrap();
            assert_eq!(resize.mode.as_deref(), Some(mode.as_str()));
            assert_eq!((resize.width, resize.height, resize.value), expected);
        }
    }

    #[test]
    fn pdf_inputs_get_raster_settings_and_lose_source_size_policies() {
        let mut s = settings();
        s.pdf_dpi = 300;
        s.pdf_page_range = "1-3, 5".into();
        s.generation_loss_protection = true;
        s.skip_if_larger = true;
        let pdf = ConversionItem {
            path: "/tmp/document.pdf".into(),
            relative_dir: None,
            source_format: Some("pdf".into()),
            source_width: Some(2480),
            source_height: Some(3508),
        };
        let options = conversion_options_for(&s, &pdf, "png", 0, true, Some("_done"));
        let pdf_options = options.pdf.unwrap();
        assert_eq!(pdf_options.dpi, 300);
        assert_eq!(pdf_options.page_range.as_deref(), Some("1-3, 5"));
        assert!(!options.generation_loss_protection);
        assert!(!options.skip_if_larger);
        assert!(!options.result_cache);
        // Extension alone also marks a PDF.
        assert!(ConversionItem::new("/x/scan.PDF").is_pdf());
    }

    #[test]
    fn effective_quality_applies_floors_only_to_lossy_output() {
        let mut s = Settings::default();
        s.quality = 20;
        s.jpeg_quality_floor = 40;
        assert_eq!(effective_quality_for(&s, "jpeg", false), 40);
        assert_eq!(effective_quality_for(&s, "png", false), 20);
        s.lossless = true;
        assert_eq!(effective_quality_for(&s, "webp", true), 20);
        // Lossless requested but unsupported for this format: the default
        // WebP floor (30) still applies.
        assert_eq!(effective_quality_for(&s, "webp", false), 30);
    }

    #[test]
    fn target_size_configuration_validity() {
        let mut s = Settings::default();
        assert!(!has_invalid_target_size_configuration(&s, &["avif"]));
        s.target_size_enabled = true;
        assert!(has_invalid_target_size_configuration(&s, &["avif"]));
        assert!(!has_invalid_target_size_configuration(
            &s,
            &["jpeg", "webp"]
        ));
        s.auto_quality = true;
        assert!(has_invalid_target_size_configuration(&s, &["jpeg"]));
    }

    #[test]
    fn pdf_page_ranges_are_validated_like_the_svelte_shell() {
        assert_eq!(validate_pdf_page_range("", None), Ok(()));
        assert_eq!(validate_pdf_page_range("  ", Some(12)), Ok(()));
        assert_eq!(
            validate_pdf_page_range("", Some(501)),
            Err(PdfPageRangeError::SelectionRequired { limit: 500 })
        );
        assert_eq!(validate_pdf_page_range("1-3, 5, 8 - 10", Some(10)), Ok(()));
        assert_eq!(
            validate_pdf_page_range("1-3,,5", None),
            Err(PdfPageRangeError::Invalid)
        );
        assert_eq!(
            validate_pdf_page_range("3-1", None),
            Err(PdfPageRangeError::Invalid)
        );
        assert_eq!(
            validate_pdf_page_range("0", None),
            Err(PdfPageRangeError::Invalid)
        );
        assert_eq!(
            validate_pdf_page_range("a-b", None),
            Err(PdfPageRangeError::Invalid)
        );
        assert_eq!(
            validate_pdf_page_range("1-12", Some(10)),
            Err(PdfPageRangeError::OutOfBounds { page_count: 10 })
        );
        assert_eq!(
            validate_pdf_page_range("1-600", None),
            Err(PdfPageRangeError::TooManyPages { limit: 500 })
        );
        assert_eq!(
            validate_pdf_page_range("1-300, 301-600", None),
            Err(PdfPageRangeError::TooManyPages { limit: 500 })
        );
        assert_eq!(
            validate_pdf_page_range(&"1,".repeat(2000), None),
            Err(PdfPageRangeError::TooLong)
        );
    }

    #[test]
    fn relative_dir_only_applies_with_an_output_folder() {
        let mut s = settings();
        s.out_dir = None;
        let options = conversion_options_for(&s, &item(), "jpeg", 30, false, None);
        assert_eq!(options.relative_dir, None);
        s.out_dir = Some(String::new());
        let options = conversion_options_for(&s, &item(), "jpeg", 30, false, None);
        assert_eq!(options.relative_dir, None, "an empty outDir is falsy");
        assert_eq!(quality_floor_for(&s, "avif"), 30);
        assert_eq!(quality_floor_for(&s, "png"), 0);
        assert!(target_size_supported(&s, "jpeg"));
        s.lossless = true;
        assert!(!target_size_supported(&s, "jpeg"));
        assert_eq!(output_suffix_for_request(&s).as_deref(), Some("_done"));
        s.output_suffix_enabled = false;
        assert_eq!(output_suffix_for_request(&s), None);
    }
}
