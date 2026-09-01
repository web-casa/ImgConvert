// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Shared workflow contracts and checked resize calculations.

use crate::{AutoQualityOptions, ColorManagementPolicy, EncodeOptions, Error, Result, MAX_PIXELS};

pub const MAX_RESIZE_PERCENT: u32 = 400;
pub const MIN_TARGET_SIZE_BYTES: u64 = 16 * 1024;
pub const MAX_TARGET_SIZE_BYTES: u64 = 100 * 1024 * 1024;
pub const TARGET_SIZE_QUALITY_STEP: u8 = 5;
pub const MIN_WORKFLOW_PREVIEW_EDGE: u32 = 256;
pub const MAX_WORKFLOW_PREVIEW_EDGE: u32 = 1600;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResizeMode {
    None,
    Fit,
    Width,
    Height,
    LongestEdge,
    Percentage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResizeRule {
    pub mode: ResizeMode,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub value: Option<u32>,
    pub allow_upscale: bool,
}

impl Default for ResizeRule {
    fn default() -> Self {
        Self {
            mode: ResizeMode::None,
            width: None,
            height: None,
            value: None,
            allow_upscale: false,
        }
    }
}

impl ResizeRule {
    pub fn dimensions(&self, source_width: u32, source_height: u32) -> Result<(u32, u32)> {
        validate_dimensions(source_width, source_height)?;
        let proposed = match self.mode {
            ResizeMode::None => (source_width, source_height),
            ResizeMode::Fit => fit_dimensions(
                source_width,
                source_height,
                required_dimension(self.width, "fit width")?,
                required_dimension(self.height, "fit height")?,
            )?,
            ResizeMode::Width => dimensions_for_width(
                source_width,
                source_height,
                required_dimension(self.width, "width")?,
            )?,
            ResizeMode::Height => dimensions_for_height(
                source_width,
                source_height,
                required_dimension(self.height, "height")?,
            )?,
            ResizeMode::LongestEdge => {
                let edge = required_dimension(self.value, "longest edge")?;
                if source_width >= source_height {
                    dimensions_for_width(source_width, source_height, edge)?
                } else {
                    dimensions_for_height(source_width, source_height, edge)?
                }
            }
            ResizeMode::Percentage => {
                let percent = required_dimension(self.value, "percentage")?;
                if percent > MAX_RESIZE_PERCENT {
                    return Err(Error::Invalid(format!(
                        "缩放百分比 {percent} 超过上限 {MAX_RESIZE_PERCENT}"
                    )));
                }
                (
                    rounded_ratio(source_width, u64::from(percent), 100)?,
                    rounded_ratio(source_height, u64::from(percent), 100)?,
                )
            }
        };

        let output =
            if !self.allow_upscale && (proposed.0 > source_width || proposed.1 > source_height) {
                (source_width, source_height)
            } else {
                proposed
            };
        validate_dimensions(output.0, output.1)?;
        Ok(output)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetadataPolicy {
    StripAll,
    ColorOnly,
    PreserveAll,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TargetSizeOptions {
    pub max_bytes: u64,
    pub min_quality: u8,
}

#[derive(Debug, Clone)]
pub struct WorkflowOptions {
    pub encoders: Vec<EncodeOptions>,
    pub auto_quality: Option<AutoQualityOptions>,
    pub resize: ResizeRule,
    pub metadata_policy: MetadataPolicy,
    pub target_size: Option<TargetSizeOptions>,
    pub color_policy: ColorManagementPolicy,
    /// Optional exact-workflow display render. Normal file conversions leave this disabled.
    pub preview_max_edge: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkflowWarning {
    ColorProfileConvertedForResize,
    InvalidColorProfileDiscarded,
    InvalidColorProfileIgnoredForPreview,
    TargetSizeNotMet {
        target_bytes: u64,
        actual_bytes: u64,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkflowResult {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub selected_quality: Option<u8>,
    pub target_size_met: Option<bool>,
    pub warnings: Vec<WorkflowWarning>,
    pub source_preview_png: Option<Vec<u8>>,
    pub output_preview_png: Option<Vec<u8>>,
}

pub(crate) fn target_quality_levels(min_quality: u8, max_quality: u8) -> Vec<u8> {
    let min_quality = min_quality.clamp(1, 100);
    let max_quality = max_quality.clamp(1, 100).max(min_quality);
    let mut levels = vec![max_quality];
    let mut quality = max_quality;
    while quality > min_quality {
        quality = quality
            .saturating_sub(TARGET_SIZE_QUALITY_STEP)
            .max(min_quality);
        if levels.last().copied() != Some(quality) {
            levels.push(quality);
        }
    }
    levels
}

pub(crate) fn target_refinement_levels(
    passing_quality: u8,
    previous_failed_quality: Option<u8>,
    max_quality: u8,
) -> Vec<u8> {
    let upper = previous_failed_quality
        .map(|quality| quality.saturating_sub(1))
        .unwrap_or(max_quality)
        .min(max_quality);
    if passing_quality >= upper {
        return Vec::new();
    }
    (passing_quality.saturating_add(1)..=upper).rev().collect()
}

fn required_dimension(value: Option<u32>, name: &str) -> Result<u32> {
    match value {
        Some(value) if value > 0 => Ok(value),
        _ => Err(Error::Invalid(format!("resize {name} 必须大于 0"))),
    }
}

fn validate_dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 {
        return Err(Error::Invalid("尺寸不能为 0".into()));
    }
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| Error::Invalid("width*height 溢出".into()))?;
    if pixels > MAX_PIXELS as u64 {
        return Err(Error::Unsupported(format!(
            "像素数 {pixels} 超过上限 {MAX_PIXELS}"
        )));
    }
    Ok(())
}

fn rounded_ratio(source: u32, numerator: u64, denominator: u64) -> Result<u32> {
    let value = u64::from(source)
        .checked_mul(numerator)
        .and_then(|value| value.checked_add(denominator / 2))
        .ok_or_else(|| Error::Invalid("resize 尺寸计算溢出".into()))?
        / denominator;
    u32::try_from(value.max(1)).map_err(|_| Error::Invalid("resize 尺寸超过 u32 上限".into()))
}

fn dimensions_for_width(source_width: u32, source_height: u32, width: u32) -> Result<(u32, u32)> {
    Ok((
        width,
        rounded_ratio(source_height, u64::from(width), u64::from(source_width))?,
    ))
}

fn dimensions_for_height(source_width: u32, source_height: u32, height: u32) -> Result<(u32, u32)> {
    Ok((
        rounded_ratio(source_width, u64::from(height), u64::from(source_height))?,
        height,
    ))
}

fn fit_dimensions(
    source_width: u32,
    source_height: u32,
    box_width: u32,
    box_height: u32,
) -> Result<(u32, u32)> {
    if u64::from(box_width) * u64::from(source_height)
        <= u64::from(box_height) * u64::from(source_width)
    {
        dimensions_for_width(source_width, source_height, box_width)
    } else {
        dimensions_for_height(source_width, source_height, box_height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(mode: ResizeMode) -> ResizeRule {
        ResizeRule {
            mode,
            ..ResizeRule::default()
        }
    }

    #[test]
    fn resize_modes_preserve_aspect_ratio() {
        assert_eq!(
            ResizeRule::default().dimensions(4000, 3000).unwrap(),
            (4000, 3000)
        );
        assert_eq!(
            ResizeRule {
                width: Some(1000),
                ..rule(ResizeMode::Width)
            }
            .dimensions(4000, 3000)
            .unwrap(),
            (1000, 750)
        );
        assert_eq!(
            ResizeRule {
                height: Some(600),
                ..rule(ResizeMode::Height)
            }
            .dimensions(4000, 3000)
            .unwrap(),
            (800, 600)
        );
        assert_eq!(
            ResizeRule {
                width: Some(1000),
                height: Some(1000),
                ..rule(ResizeMode::Fit)
            }
            .dimensions(4000, 3000)
            .unwrap(),
            (1000, 750)
        );
        assert_eq!(
            ResizeRule {
                value: Some(900),
                ..rule(ResizeMode::LongestEdge)
            }
            .dimensions(3000, 4000)
            .unwrap(),
            (675, 900)
        );
        assert_eq!(
            ResizeRule {
                value: Some(25),
                ..rule(ResizeMode::Percentage)
            }
            .dimensions(4000, 3000)
            .unwrap(),
            (1000, 750)
        );
    }

    #[test]
    fn resize_disallows_upscale_by_default() {
        let no_upscale = ResizeRule {
            width: Some(2000),
            ..rule(ResizeMode::Width)
        };
        assert_eq!(no_upscale.dimensions(1000, 500).unwrap(), (1000, 500));

        let upscale = ResizeRule {
            allow_upscale: true,
            ..no_upscale
        };
        assert_eq!(upscale.dimensions(1000, 500).unwrap(), (2000, 1000));
    }

    #[test]
    fn resize_rejects_invalid_values_and_pixel_budget() {
        let missing = rule(ResizeMode::Width);
        assert!(missing.dimensions(100, 100).is_err());

        let too_large_percent = ResizeRule {
            value: Some(MAX_RESIZE_PERCENT + 1),
            allow_upscale: true,
            ..rule(ResizeMode::Percentage)
        };
        assert!(too_large_percent.dimensions(100, 100).is_err());

        let over_budget = ResizeRule {
            width: Some(10_000),
            height: Some(10_000),
            allow_upscale: true,
            ..rule(ResizeMode::Fit)
        };
        assert!(over_budget.dimensions(100, 100).is_err());
    }

    #[test]
    fn target_quality_levels_are_descending_and_bounded() {
        let levels = target_quality_levels(30, 100);
        assert_eq!(levels.first(), Some(&100));
        assert_eq!(levels.last(), Some(&30));
        assert_eq!(levels.len(), 15);
        assert!(levels.windows(2).all(|pair| pair[0] > pair[1]));
    }

    #[test]
    fn target_refinement_does_not_repeat_the_previous_failed_boundary() {
        assert_eq!(target_refinement_levels(1, Some(5), 100), vec![4, 3, 2]);
        assert_eq!(
            target_refinement_levels(95, Some(100), 100),
            vec![99, 98, 97, 96]
        );
        assert!(target_refinement_levels(100, None, 100).is_empty());
    }
}
