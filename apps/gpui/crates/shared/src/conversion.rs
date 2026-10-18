// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The one place the GPUI shell turns a queue item plus the persisted
//! settings into backend `ConvertOptions`, for batches and previews alike.
//! Everything else goes through `imgconvert_backend::conversion_request`.

use gpui_kit::SharedString;
use imgconvert_backend::conversion_request::{
    self, ConversionItem, output_suffix_for_request, quality_floor_for,
};
use imgconvert_backend::convert::{self, ConvertOptions, ConvertWarning};
use imgconvert_backend::settings::Settings;

use crate::i18n::{tr, tr_with};
use crate::images::format_bytes;
use crate::queue_model::QueueItem;

/// Conversion options for one queue item. `out_dir` overrides the record's
/// folder (a folder picked at start time applies before the record is
/// written); `format` supplies the global fallback (including the perf probe).
/// A per-item format takes precedence in both batches and previews.
pub fn options_for_item(
    settings: &Settings,
    item: &QueueItem,
    out_dir: Option<&str>,
    format: Option<&str>,
) -> ConvertOptions {
    let mut settings = settings.clone();
    if let Some(dir) = out_dir {
        settings.out_dir = Some(dir.to_string());
    }
    let format = item
        .target_format
        .as_deref()
        .unwrap_or_else(|| format.unwrap_or(settings.format.as_str()))
        .to_string();
    let lossless_supported = convert::capabilities().lossless.contains(&format.as_str());
    let conversion_item = ConversionItem::new(item.path.to_string())
        .with_relative_dir(item.relative_dir.as_ref().map(ToString::to_string))
        .with_source(
            item.source_format.as_ref().map(ToString::to_string),
            item.source_width,
            item.source_height,
        );
    conversion_request::conversion_options_for(
        &settings,
        &conversion_item,
        &format,
        quality_floor_for(&settings, &format),
        lossless_supported,
        output_suffix_for_request(&settings).as_deref(),
    )
}

/// The sentences a conversion warning turns into (port of
/// `formatConvertWarning`); one warning can carry two.
pub fn warning_texts(warning: &ConvertWarning) -> Vec<SharedString> {
    match warning {
        ConvertWarning::BitDepthReduced { from, to } => vec![tr_with(
            "warning.bit_depth_reduced",
            &[("from", from), ("to", to)],
        )],
        ConvertWarning::AlphaFlattened => vec![tr("warning.alpha_flattened")],
        ConvertWarning::PreviousOutputBackupRetained { path } => {
            vec![tr_with("warning.output_backup_retained", &[("path", path)])]
        }
        ConvertWarning::ModifiedTimeNotPreserved { path } => {
            vec![tr_with(
                "warning.modified_time_not_preserved",
                &[("path", path)],
            )]
        }
        ConvertWarning::OutputBackupRetainedAndModifiedTimeNotPreserved {
            backup_path,
            output_path,
        } => vec![
            tr_with("warning.output_backup_retained", &[("path", backup_path)]),
            tr_with(
                "warning.modified_time_not_preserved",
                &[("path", output_path)],
            ),
        ],
        ConvertWarning::ColorProfileConvertedForResize => {
            vec![tr("warning.color_profile_converted_for_resize")]
        }
        ConvertWarning::InvalidColorProfileDiscarded => {
            vec![tr("warning.invalid_color_profile_discarded")]
        }
        ConvertWarning::InvalidColorProfileIgnoredForPreview => {
            vec![tr("warning.invalid_color_profile_ignored_for_preview")]
        }
        ConvertWarning::TargetSizeNotMet {
            target_bytes,
            actual_bytes,
        } => vec![tr_with(
            "warning.target_size_not_met",
            &[
                ("target", &format_bytes(*target_bytes)),
                ("actual", &format_bytes(*actual_bytes)),
            ],
        )],
        ConvertWarning::PdfPagesSkippedExisting { count } => {
            vec![tr_with(
                "warning.pdf_pages_skipped_existing",
                &[("count", count)],
            )]
        }
        ConvertWarning::PdfRenderWarnings { page, count } => vec![tr_with(
            "warning.pdf_render_warnings",
            &[("page", page), ("count", count)],
        )],
        ConvertWarning::TemporaryFileRetained { path } => {
            vec![tr_with(
                "warning.temporary_file_retained",
                &[("path", path)],
            )]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use imgconvert_backend::import::ImportScanFile;

    use crate::queue_model::QueueModel;

    fn item(path: &str) -> QueueItem {
        let mut model = QueueModel::default();
        model.add_files(vec![ImportScanFile {
            path: path.to_string(),
            key: "k".into(),
            relative_dir: Some("sub".into()),
            metadata: None,
        }]);
        model.item_at(0).unwrap().clone()
    }

    #[test]
    fn options_follow_the_record_with_folder_and_format_overrides() {
        let mut settings = Settings::default();
        settings.quality = 66;
        settings.output_suffix_enabled = true;
        settings.output_suffix = "_web".into();
        let options = options_for_item(&settings, &item("/in/a.png"), Some("/out"), Some("webp"));
        assert_eq!(options.input, "/in/a.png");
        assert_eq!(options.out_dir.as_deref(), Some("/out"));
        assert_eq!(options.relative_dir.as_deref(), Some("sub"));
        assert_eq!(options.format, "webp");
        assert_eq!(options.quality, 66);
        assert_eq!(options.quality_floor, 30);
        assert_eq!(options.output_suffix.as_deref(), Some("_web"));
        assert!(!options.allow_source_overwrite);
        assert_eq!(options.overwrite_mode.as_deref(), Some("skip"));

        // No overrides: the record's format and folder.
        let options = options_for_item(&settings, &item("/in/a.png"), None, None);
        assert_eq!(options.format, "avif");
        assert_eq!(options.out_dir, None);
        assert_eq!(options.relative_dir, None, "no folder, no mirrored tree");
    }

    #[test]
    fn item_format_controls_preview_batch_quality_and_lossless_together() {
        let mut settings = Settings::default();
        settings.lossless = true;
        let mut item = item("/in/a.png");
        item.target_format = Some("jpeg".into());
        let preview = options_for_item(&settings, &item, None, None);
        let batch = options_for_item(&settings, &item, None, Some("webp"));
        assert_eq!(preview.format, "jpeg");
        assert_eq!(batch.format, preview.format);
        assert_eq!(batch.quality_floor, quality_floor_for(&settings, "jpeg"));
        assert!(!batch.lossless);
        settings.format = "png".into();
        assert_eq!(
            options_for_item(&settings, &item, None, None).format,
            "jpeg"
        );
        item.target_format = None;
        assert_eq!(options_for_item(&settings, &item, None, None).format, "png");
    }

    #[test]
    fn lossless_needs_core_support_for_the_format() {
        let mut settings = Settings::default();
        settings.lossless = true;
        let webp = options_for_item(&settings, &item("/in/a.png"), None, Some("webp"));
        let jpeg = options_for_item(&settings, &item("/in/a.png"), None, Some("jpeg"));
        assert!(webp.lossless);
        assert!(!jpeg.lossless);
    }
}
