// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Persisted user settings shared with the Tauri shell (migration plan §3.5).
//!
//! The on-disk document is the `tauri-plugin-store` file: a JSON object whose
//! `settings` key holds the [`Settings`] record. [`normalize`] is a port of
//! the Svelte shell's `normalizeSettings` (plus the suffix, conversion-policy
//! and workflow-preset helpers) so both shells repair the same input the same
//! way. Unknown keys, at the top level and inside `settings`, survive a
//! load/save round trip.
//!
//! Writing is atomic (temporary file + rename), serialized with a file lock,
//! and the first write backs the Tauri file up as `settings.json.pre-gpui`.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

/// Key under which the store keeps the settings record.
pub const SETTINGS_KEY: &str = "settings";
pub const CONVERSION_POLICY_VERSION: u64 = 2;
pub const WORKFLOW_SETTINGS_VERSION: u64 = 1;
pub const MAX_CUSTOM_PRESETS: usize = 20;
pub const MAX_PRESET_NAME_CHARS: usize = 64;
pub const MAX_RESIZE_PERCENT: i64 = 400;
pub const MIN_TARGET_SIZE_KIB: i64 = 16;
pub const MAX_TARGET_SIZE_KIB: i64 = 100 * 1024;
pub const OUTPUT_SUFFIX_MAX_CHARS: usize = 48;
pub const OUTPUT_SUFFIX_MAX_BYTES: usize = 128;
pub const DEFAULT_OUTPUT_SUFFIX: &str = "_done";
pub const MIN_PDF_DPI: i64 = 72;
pub const MAX_PDF_DPI: i64 = 600;
pub const DEFAULT_PDF_DPI: i64 = 150;
pub const MAX_PDF_PAGE_RANGE_CHARS: usize = 2048;
/// Formats the core can write; the first one is the fallback output format.
pub const WRITABLE_FORMATS: [&str; 4] = ["jpeg", "png", "webp", "avif"];
/// Suffix of the one-time backup taken before the GPUI shell first writes.
pub const PRE_GPUI_BACKUP_SUFFIX: &str = "pre-gpui";

macro_rules! string_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident = $text:literal),+ $(,)? }, default = $default:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            $(#[serde(rename = $text)] $variant),+
        }

        impl $name {
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }

            pub fn parse(text: &str) -> Option<Self> {
                match text { $($text => Some(Self::$variant),)+ _ => None }
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::$default
            }
        }
    };
}

string_enum!(OverwriteMode { Ask = "ask", Skip = "skip", Overwrite = "overwrite" }, default = Skip);
string_enum!(Theme { Light = "light", Dark = "dark", System = "system" }, default = System);
string_enum!(AppLocale { ZhCn = "zh-CN", EnUs = "en-US", ZhTw = "zh-TW", Ja = "ja", Ko = "ko", Fr = "fr", Es = "es", PtBr = "pt-BR", De = "de" }, default = ZhCn);
string_enum!(MetadataPolicy { StripAll = "stripAll", ColorOnly = "colorOnly", PreserveAll = "preserveAll" }, default = StripAll);
string_enum!(ResizeMode { None = "none", Fit = "fit", Width = "width", Height = "height", LongestEdge = "longestEdge", Percentage = "percentage" }, default = None);
string_enum!(ColorManagementPolicy { Preserve = "preserve", ConvertToSrgb = "convertToSrgb" }, default = Preserve);
string_enum!(AvifSubsample { Yuv420 = "yuv420", Yuv444 = "yuv444" }, default = Yuv444);

/// The fields a workflow preset captures. Paths and overwrite authority never
/// enter a preset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct WorkflowPresetSnapshot {
    pub format: String,
    pub quality: u8,
    pub jpeg_quality_floor: u8,
    pub webp_quality_floor: u8,
    pub avif_quality_floor: u8,
    pub lossless: bool,
    pub jpeg_progressive: bool,
    pub png_oxipng_level: u8,
    pub png_lossy_quantize: bool,
    pub png_quant_colors: u16,
    pub webp_method: u8,
    pub avif_speed: u8,
    pub avif_subsample: AvifSubsample,
    pub webp_near_lossless: u8,
    pub webp_sharp_yuv: bool,
    pub jpeg_trellis: bool,
    pub auto_quality: bool,
    pub auto_quality_score: u8,
    pub generation_loss_protection: bool,
    pub skip_if_larger: bool,
    pub multi_candidate: bool,
    pub resize_mode: ResizeMode,
    pub resize_width: u32,
    pub resize_height: u32,
    pub resize_value: u32,
    pub resize_allow_upscale: bool,
    pub target_size_enabled: bool,
    pub target_size_kib: u32,
    pub metadata_policy: MetadataPolicy,
    pub color_management_policy: ColorManagementPolicy,
}

impl Default for WorkflowPresetSnapshot {
    fn default() -> Self {
        Self {
            format: "avif".to_string(),
            quality: 80,
            jpeg_quality_floor: 30,
            webp_quality_floor: 30,
            avif_quality_floor: 30,
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
            auto_quality: false,
            auto_quality_score: 80,
            generation_loss_protection: false,
            skip_if_larger: false,
            multi_candidate: true,
            resize_mode: ResizeMode::None,
            resize_width: 1920,
            resize_height: 1080,
            resize_value: 2048,
            resize_allow_upscale: false,
            target_size_enabled: false,
            target_size_kib: 1024,
            metadata_policy: MetadataPolicy::StripAll,
            color_management_policy: ColorManagementPolicy::Preserve,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CustomWorkflowPreset {
    pub id: String,
    pub name: String,
    pub version: u64,
    pub snapshot: WorkflowPresetSnapshot,
}

/// The persisted settings record. Field names and defaults mirror the Svelte
/// shell's `Settings`; `extra` keeps keys this version does not know.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Settings {
    pub format: String,
    pub quality: u8,
    pub jpeg_quality_floor: u8,
    pub webp_quality_floor: u8,
    pub avif_quality_floor: u8,
    pub lossless: bool,
    pub jpeg_progressive: bool,
    pub png_oxipng_level: u8,
    pub png_lossy_quantize: bool,
    pub png_quant_colors: u16,
    pub webp_method: u8,
    pub avif_speed: u8,
    pub avif_subsample: AvifSubsample,
    pub webp_near_lossless: u8,
    pub webp_sharp_yuv: bool,
    pub jpeg_trellis: bool,
    pub auto_quality: bool,
    pub auto_quality_score: u8,
    pub generation_loss_protection: bool,
    pub result_cache: bool,
    pub skip_if_larger: bool,
    pub conversion_policy_version: u64,
    pub multi_candidate: bool,
    pub overwrite: OverwriteMode,
    pub out_dir: Option<String>,
    pub heic_helper_path: Option<String>,
    pub file_name_template: String,
    pub output_suffix_enabled: bool,
    pub output_suffix: String,
    pub preserve_metadata: bool,
    pub metadata_policy: MetadataPolicy,
    pub resize_mode: ResizeMode,
    pub resize_width: u32,
    pub resize_height: u32,
    pub resize_value: u32,
    pub resize_allow_upscale: bool,
    pub target_size_enabled: bool,
    pub target_size_kib: u32,
    pub workflow_settings_version: u64,
    pub custom_workflow_presets: Vec<CustomWorkflowPreset>,
    pub color_management_policy: ColorManagementPolicy,
    pub pdf_dpi: u16,
    pub pdf_page_range: String,
    pub concurrency: u8,
    pub theme: Theme,
    pub reduce_motion: bool,
    pub locale: AppLocale,
    /// Keys written by another version; preserved verbatim.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Settings {
    fn default() -> Self {
        let snapshot = WorkflowPresetSnapshot::default();
        Self {
            format: snapshot.format.clone(),
            quality: snapshot.quality,
            jpeg_quality_floor: snapshot.jpeg_quality_floor,
            webp_quality_floor: snapshot.webp_quality_floor,
            avif_quality_floor: snapshot.avif_quality_floor,
            lossless: snapshot.lossless,
            jpeg_progressive: snapshot.jpeg_progressive,
            png_oxipng_level: snapshot.png_oxipng_level,
            png_lossy_quantize: snapshot.png_lossy_quantize,
            png_quant_colors: snapshot.png_quant_colors,
            webp_method: snapshot.webp_method,
            avif_speed: snapshot.avif_speed,
            avif_subsample: snapshot.avif_subsample,
            webp_near_lossless: snapshot.webp_near_lossless,
            webp_sharp_yuv: snapshot.webp_sharp_yuv,
            jpeg_trellis: snapshot.jpeg_trellis,
            auto_quality: snapshot.auto_quality,
            auto_quality_score: snapshot.auto_quality_score,
            generation_loss_protection: snapshot.generation_loss_protection,
            result_cache: true,
            skip_if_larger: snapshot.skip_if_larger,
            conversion_policy_version: CONVERSION_POLICY_VERSION,
            multi_candidate: snapshot.multi_candidate,
            overwrite: OverwriteMode::Skip,
            out_dir: None,
            heic_helper_path: None,
            file_name_template: "%name%".to_string(),
            output_suffix_enabled: true,
            output_suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
            preserve_metadata: false,
            metadata_policy: snapshot.metadata_policy,
            resize_mode: snapshot.resize_mode,
            resize_width: snapshot.resize_width,
            resize_height: snapshot.resize_height,
            resize_value: snapshot.resize_value,
            resize_allow_upscale: snapshot.resize_allow_upscale,
            target_size_enabled: snapshot.target_size_enabled,
            target_size_kib: snapshot.target_size_kib,
            workflow_settings_version: WORKFLOW_SETTINGS_VERSION,
            custom_workflow_presets: Vec::new(),
            color_management_policy: snapshot.color_management_policy,
            pdf_dpi: DEFAULT_PDF_DPI as u16,
            pdf_page_range: String::new(),
            concurrency: 0,
            theme: Theme::System,
            reduce_motion: false,
            locale: AppLocale::ZhCn,
            extra: Map::new(),
        }
    }
}

impl Settings {
    /// The defaults with `locale` as the detected interface locale; the
    /// record a shell starts from when nothing is persisted yet.
    pub fn defaults_for(locale: AppLocale) -> Self {
        Self {
            locale,
            ..Self::default()
        }
    }

    /// The workflow fields of these settings, as a preset would capture them.
    pub fn workflow_snapshot(&self) -> WorkflowPresetSnapshot {
        normalize_workflow_snapshot(&serde_json::to_value(self).unwrap_or(Value::Null))
    }

    /// Applies a preset's workflow fields; everything else is untouched.
    pub fn apply_workflow_snapshot(&mut self, snapshot: &WorkflowPresetSnapshot) {
        let snapshot =
            normalize_workflow_snapshot(&serde_json::to_value(snapshot).unwrap_or(Value::Null));
        self.format = snapshot.format;
        self.quality = snapshot.quality;
        self.jpeg_quality_floor = snapshot.jpeg_quality_floor;
        self.webp_quality_floor = snapshot.webp_quality_floor;
        self.avif_quality_floor = snapshot.avif_quality_floor;
        self.lossless = snapshot.lossless;
        self.jpeg_progressive = snapshot.jpeg_progressive;
        self.png_oxipng_level = snapshot.png_oxipng_level;
        self.png_lossy_quantize = snapshot.png_lossy_quantize;
        self.png_quant_colors = snapshot.png_quant_colors;
        self.webp_method = snapshot.webp_method;
        self.avif_speed = snapshot.avif_speed;
        self.avif_subsample = snapshot.avif_subsample;
        self.webp_near_lossless = snapshot.webp_near_lossless;
        self.webp_sharp_yuv = snapshot.webp_sharp_yuv;
        self.jpeg_trellis = snapshot.jpeg_trellis;
        self.auto_quality = snapshot.auto_quality;
        self.auto_quality_score = snapshot.auto_quality_score;
        self.generation_loss_protection = snapshot.generation_loss_protection;
        self.skip_if_larger = snapshot.skip_if_larger;
        self.multi_candidate = snapshot.multi_candidate;
        self.resize_mode = snapshot.resize_mode;
        self.resize_width = snapshot.resize_width;
        self.resize_height = snapshot.resize_height;
        self.resize_value = snapshot.resize_value;
        self.resize_allow_upscale = snapshot.resize_allow_upscale;
        self.target_size_enabled = snapshot.target_size_enabled;
        self.target_size_kib = snapshot.target_size_kib;
        self.metadata_policy = snapshot.metadata_policy;
        self.preserve_metadata = snapshot.metadata_policy == MetadataPolicy::PreserveAll;
        self.color_management_policy = snapshot.color_management_policy;
    }
}

// ---- normalization (port of normalizeSettings and friends) ----

/// Result of [`normalize`].
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Normalized {
    pub settings: Settings,
    /// Whether the repaired record differs from what was read, or a policy
    /// migration ran: the caller should persist it once.
    pub changed: bool,
}

/// Repairs a persisted `settings` value exactly like the Svelte shell: start
/// from the defaults (with `fallback_locale` as the detected locale), overlay
/// the persisted keys, then constrain every field. `None` means no record was
/// stored yet.
pub fn normalize(persisted: Option<&Value>, fallback_locale: AppLocale) -> Normalized {
    // The defaults carry the detected locale, as `detectLocale()` does in
    // the Svelte shell, so a record without a `locale` key follows the system.
    let defaults = to_map(&Settings {
        locale: fallback_locale,
        ..Settings::default()
    });
    let persisted_map = persisted.and_then(Value::as_object);
    let mut map = defaults;
    if let Some(persisted) = persisted_map {
        for (key, value) in persisted {
            map.insert(key.clone(), value.clone());
        }
    }
    let before = Value::Object(map.clone());

    let overwrite = match map.get("overwrite") {
        Some(Value::String(text)) if OverwriteMode::parse(text).is_some() => text.clone(),
        Some(Value::Bool(true)) => "overwrite".to_string(),
        _ => "skip".to_string(),
    };
    set(&mut map, "overwrite", json!(overwrite));
    constrain_enum(&mut map, "theme", &["light", "dark", "system"], "system");
    if !matches!(map.get("locale"), Some(Value::String(text)) if AppLocale::parse(text).is_some()) {
        set(&mut map, "locale", json!(fallback_locale.as_str()));
    }
    if !matches!(map.get("format"), Some(Value::String(text)) if !js_trim(text).is_empty()) {
        set(&mut map, "format", json!(WRITABLE_FORMATS[0]));
    }
    for key in ["outDir", "heicHelperPath"] {
        if !matches!(map.get(key), Some(Value::String(_)) | Some(Value::Null)) {
            set(&mut map, key, Value::Null);
        }
    }
    if !matches!(map.get("fileNameTemplate"), Some(Value::String(text)) if !js_trim(text).is_empty())
    {
        set(&mut map, "fileNameTemplate", json!("%name%"));
    }
    let suffix = normalize_persisted_output_suffix_settings(
        persisted_map,
        map.get("outputSuffixEnabled"),
        map.get("outputSuffix"),
    );
    set(&mut map, "outputSuffixEnabled", json!(suffix.enabled));
    set(&mut map, "outputSuffix", json!(suffix.suffix));
    constrain_bool(&mut map, "preserveMetadata", false);
    let persisted_policy = persisted_map
        .and_then(|persisted| persisted.get("metadataPolicy"))
        .and_then(Value::as_str)
        .and_then(MetadataPolicy::parse);
    if persisted_policy.is_none() {
        let preserve = map
            .get("preserveMetadata")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let policy = if preserve {
            MetadataPolicy::PreserveAll
        } else {
            MetadataPolicy::StripAll
        };
        set(&mut map, "metadataPolicy", json!(policy.as_str()));
    }
    let policy = map
        .get("metadataPolicy")
        .and_then(Value::as_str)
        .and_then(MetadataPolicy::parse)
        .unwrap_or_default();
    set(
        &mut map,
        "preserveMetadata",
        json!(policy == MetadataPolicy::PreserveAll),
    );
    constrain_enum(
        &mut map,
        "resizeMode",
        &[
            "none",
            "fit",
            "width",
            "height",
            "longestEdge",
            "percentage",
        ],
        "none",
    );
    let percentage = map.get("resizeMode").and_then(Value::as_str) == Some("percentage");
    constrain_integer(&mut map, "resizeWidth", 1, 65_535, 1920);
    constrain_integer(&mut map, "resizeHeight", 1, 65_535, 1080);
    constrain_integer(
        &mut map,
        "resizeValue",
        1,
        if percentage {
            MAX_RESIZE_PERCENT
        } else {
            65_535
        },
        if percentage { 100 } else { 2048 },
    );
    constrain_bool(&mut map, "resizeAllowUpscale", false);
    constrain_bool(&mut map, "targetSizeEnabled", false);
    constrain_integer(
        &mut map,
        "targetSizeKib",
        MIN_TARGET_SIZE_KIB,
        MAX_TARGET_SIZE_KIB,
        1024,
    );
    set(
        &mut map,
        "workflowSettingsVersion",
        json!(WORKFLOW_SETTINGS_VERSION),
    );
    let presets = normalize_custom_workflow_presets(map.get("customWorkflowPresets"));
    set(
        &mut map,
        "customWorkflowPresets",
        serde_json::to_value(&presets).unwrap_or(Value::Array(Vec::new())),
    );
    constrain_enum(
        &mut map,
        "colorManagementPolicy",
        &["preserve", "convertToSrgb"],
        "preserve",
    );
    constrain_integer(
        &mut map,
        "pdfDpi",
        MIN_PDF_DPI,
        MAX_PDF_DPI,
        DEFAULT_PDF_DPI,
    );
    match map.get("pdfPageRange") {
        Some(Value::String(text)) => {
            let truncated = slice_utf16(text, MAX_PDF_PAGE_RANGE_CHARS);
            set(&mut map, "pdfPageRange", json!(truncated));
        }
        _ => set(&mut map, "pdfPageRange", json!("")),
    }
    constrain_integer(&mut map, "concurrency", 0, 8, 0);
    constrain_bool(&mut map, "lossless", false);
    constrain_bool(&mut map, "jpegProgressive", true);
    constrain_integer(&mut map, "pngOxipngLevel", 0, 6, 4);
    constrain_bool(&mut map, "pngLossyQuantize", false);
    constrain_integer(&mut map, "pngQuantColors", 64, 256, 256);
    constrain_integer(&mut map, "webpMethod", 0, 6, 4);
    constrain_integer(&mut map, "avifSpeed", 0, 10, 8);
    constrain_enum(&mut map, "avifSubsample", &["yuv420", "yuv444"], "yuv444");
    constrain_integer(&mut map, "webpNearLossless", 0, 100, 100);
    constrain_bool(&mut map, "webpSharpYuv", false);
    constrain_bool(&mut map, "jpegTrellis", true);
    constrain_bool(&mut map, "autoQuality", false);
    let target_size_enabled = map
        .get("targetSizeEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if target_size_enabled {
        set(&mut map, "autoQuality", json!(false));
        set(&mut map, "lossless", json!(false));
    }
    constrain_integer(&mut map, "autoQualityScore", 50, 95, 80);
    constrain_bool(&mut map, "resultCache", true);
    let policy = normalize_persisted_conversion_policy_settings(
        persisted_map,
        map.get("generationLossProtection"),
        map.get("skipIfLarger"),
    );
    set(
        &mut map,
        "generationLossProtection",
        json!(policy.generation_loss_protection),
    );
    set(&mut map, "skipIfLarger", json!(policy.skip_if_larger));
    set(
        &mut map,
        "conversionPolicyVersion",
        json!(policy.conversion_policy_version),
    );
    constrain_bool(&mut map, "multiCandidate", true);
    constrain_bool(&mut map, "reduceMotion", false);
    let quality = clamp_quality(map.get("quality"));
    set(&mut map, "quality", json!(quality));
    for key in ["jpegQualityFloor", "webpQualityFloor", "avifQualityFloor"] {
        let value = normalize_quality_floor(map.get(key), 30);
        set(&mut map, key, json!(value));
    }

    let after = Value::Object(map.clone());
    let settings: Settings = serde_json::from_value(after.clone()).unwrap_or_else(|_| {
        // Every known key was constrained above; a failure here would be a
        // schema bug, so fall back to the defaults rather than panic.
        Settings {
            locale: fallback_locale,
            ..Settings::default()
        }
    });
    Normalized {
        settings,
        changed: policy.migrated || before != after,
    }
}

/// Outcome of [`normalize_persisted_output_suffix_settings`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputSuffixSettings {
    pub enabled: bool,
    pub suffix: String,
}

/// Older persisted settings only have the template; the suffix switch stays
/// off until the person enables it. Mirrors the Svelte helper.
pub fn normalize_persisted_output_suffix_settings(
    persisted: Option<&Map<String, Value>>,
    enabled: Option<&Value>,
    suffix: Option<&Value>,
) -> OutputSuffixSettings {
    let normalized = suffix
        .and_then(Value::as_str)
        .map(|text| normalize_output_suffix_input(text).value)
        .unwrap_or_default();
    let enabled = match persisted {
        Some(persisted) if !persisted.contains_key("outputSuffixEnabled") => false,
        _ => enabled.and_then(Value::as_bool).unwrap_or(true),
    };
    OutputSuffixSettings {
        enabled,
        suffix: if normalized.is_empty() {
            DEFAULT_OUTPUT_SUFFIX.to_string()
        } else {
            normalized
        },
    }
}

/// Outcome of [`normalize_output_suffix_input`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedSuffix {
    pub value: String,
    pub adjusted: bool,
}

/// Custom suffixes remain literal text: NFC-normalize, trim, replace path and
/// control characters, cap at 48 characters / 128 bytes.
pub fn normalize_output_suffix_input(value: &str) -> NormalizedSuffix {
    let input: String = value.nfc().collect();
    let trimmed = js_trim(&input);
    let mut adjusted = input != value || trimmed != input;
    let mut normalized = String::new();
    for (chars, character) in trimmed.chars().enumerate() {
        let code = character as u32;
        let is_control = code <= 0x1f || (0x7f..=0x9f).contains(&code);
        let safe = if is_control
            || matches!(
                character,
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            ) {
            '_'
        } else {
            character
        };
        if safe != character {
            adjusted = true;
        }
        if chars >= OUTPUT_SUFFIX_MAX_CHARS
            || normalized.len() + safe.len_utf8() > OUTPUT_SUFFIX_MAX_BYTES
        {
            adjusted = true;
            break;
        }
        normalized.push(safe);
    }
    NormalizedSuffix {
        value: normalized,
        adjusted,
    }
}

/// Outcome of [`normalize_persisted_conversion_policy_settings`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversionPolicySettings {
    pub generation_loss_protection: bool,
    pub skip_if_larger: bool,
    pub conversion_policy_version: u64,
    pub migrated: bool,
}

/// Releases before policy version 2 enabled the skip policies by default, so
/// a persisted `true` is not evidence of an informed opt-in: legacy profiles
/// migrate to the conversion-first defaults once.
pub fn normalize_persisted_conversion_policy_settings(
    persisted: Option<&Map<String, Value>>,
    generation_loss_protection: Option<&Value>,
    skip_if_larger: Option<&Value>,
) -> ConversionPolicySettings {
    let uses_current = persisted
        .and_then(|persisted| persisted.get("conversionPolicyVersion"))
        .and_then(Value::as_f64)
        == Some(CONVERSION_POLICY_VERSION as f64);
    let pick = |value: Option<&Value>| uses_current && value.and_then(Value::as_bool) == Some(true);
    ConversionPolicySettings {
        generation_loss_protection: pick(generation_loss_protection),
        skip_if_larger: pick(skip_if_larger),
        conversion_policy_version: CONVERSION_POLICY_VERSION,
        migrated: persisted.is_some() && !uses_current,
    }
}

/// Keeps only well-formed custom presets (`custom:` ids, non-empty names,
/// first 20, unique ids) and constrains their snapshots.
pub fn normalize_custom_workflow_presets(value: Option<&Value>) -> Vec<CustomWorkflowPreset> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    let mut presets = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for candidate in items {
        if presets.len() >= MAX_CUSTOM_PRESETS {
            break;
        }
        let Some(candidate) = candidate.as_object() else {
            continue;
        };
        let id: String = candidate
            .get("id")
            .and_then(Value::as_str)
            .map(|id| slice_utf16(js_trim(id), 128))
            .unwrap_or_default();
        let name = normalize_preset_name(candidate.get("name"));
        if !id.starts_with("custom:") || name.is_empty() || !ids.insert(id.clone()) {
            continue;
        }
        presets.push(CustomWorkflowPreset {
            id,
            name,
            version: WORKFLOW_SETTINGS_VERSION,
            snapshot: normalize_workflow_snapshot(
                candidate.get("snapshot").unwrap_or(&Value::Null),
            ),
        });
    }
    presets
}

/// Constrains an arbitrary value to a valid preset snapshot.
pub fn normalize_workflow_snapshot(value: &Value) -> WorkflowPresetSnapshot {
    let empty = Map::new();
    let source = value.as_object().unwrap_or(&empty);
    let defaults = WorkflowPresetSnapshot::default();
    let get = |key: &str| source.get(key);
    let resize_mode = get("resizeMode")
        .and_then(Value::as_str)
        .and_then(ResizeMode::parse)
        .unwrap_or(defaults.resize_mode);
    let percentage = resize_mode == ResizeMode::Percentage;
    let mut snapshot = WorkflowPresetSnapshot {
        format: match string_like(get("format")) {
            Some(format) if WRITABLE_FORMATS.contains(&format.as_str()) => format,
            _ => defaults.format.clone(),
        },
        quality: integer(get("quality"), 1, 100, i64::from(defaults.quality)) as u8,
        jpeg_quality_floor: quality_floor(get("jpegQualityFloor"), defaults.jpeg_quality_floor),
        webp_quality_floor: quality_floor(get("webpQualityFloor"), defaults.webp_quality_floor),
        avif_quality_floor: quality_floor(get("avifQualityFloor"), defaults.avif_quality_floor),
        lossless: boolean(get("lossless"), defaults.lossless),
        jpeg_progressive: boolean(get("jpegProgressive"), defaults.jpeg_progressive),
        png_oxipng_level: integer(
            get("pngOxipngLevel"),
            0,
            6,
            i64::from(defaults.png_oxipng_level),
        ) as u8,
        png_lossy_quantize: boolean(get("pngLossyQuantize"), defaults.png_lossy_quantize),
        png_quant_colors: integer(
            get("pngQuantColors"),
            64,
            256,
            i64::from(defaults.png_quant_colors),
        ) as u16,
        webp_method: integer(get("webpMethod"), 0, 6, i64::from(defaults.webp_method)) as u8,
        avif_speed: integer(get("avifSpeed"), 0, 10, i64::from(defaults.avif_speed)) as u8,
        avif_subsample: if get("avifSubsample").and_then(Value::as_str) == Some("yuv420") {
            AvifSubsample::Yuv420
        } else {
            AvifSubsample::Yuv444
        },
        webp_near_lossless: integer(
            get("webpNearLossless"),
            0,
            100,
            i64::from(defaults.webp_near_lossless),
        ) as u8,
        webp_sharp_yuv: boolean(get("webpSharpYuv"), defaults.webp_sharp_yuv),
        jpeg_trellis: boolean(get("jpegTrellis"), defaults.jpeg_trellis),
        auto_quality: boolean(get("autoQuality"), defaults.auto_quality),
        auto_quality_score: integer(
            get("autoQualityScore"),
            50,
            95,
            i64::from(defaults.auto_quality_score),
        ) as u8,
        generation_loss_protection: boolean(
            get("generationLossProtection"),
            defaults.generation_loss_protection,
        ),
        skip_if_larger: boolean(get("skipIfLarger"), defaults.skip_if_larger),
        multi_candidate: boolean(get("multiCandidate"), defaults.multi_candidate),
        resize_mode,
        resize_width: integer(
            get("resizeWidth"),
            1,
            65_535,
            i64::from(defaults.resize_width),
        ) as u32,
        resize_height: integer(
            get("resizeHeight"),
            1,
            65_535,
            i64::from(defaults.resize_height),
        ) as u32,
        resize_value: integer(
            get("resizeValue"),
            1,
            if percentage {
                MAX_RESIZE_PERCENT
            } else {
                65_535
            },
            if percentage {
                100
            } else {
                i64::from(defaults.resize_value)
            },
        ) as u32,
        resize_allow_upscale: boolean(get("resizeAllowUpscale"), defaults.resize_allow_upscale),
        target_size_enabled: boolean(get("targetSizeEnabled"), defaults.target_size_enabled),
        target_size_kib: integer(
            get("targetSizeKib"),
            MIN_TARGET_SIZE_KIB,
            MAX_TARGET_SIZE_KIB,
            i64::from(defaults.target_size_kib),
        ) as u32,
        metadata_policy: get("metadataPolicy")
            .and_then(Value::as_str)
            .and_then(MetadataPolicy::parse)
            .unwrap_or(defaults.metadata_policy),
        color_management_policy: if get("colorManagementPolicy").and_then(Value::as_str)
            == Some("convertToSrgb")
        {
            ColorManagementPolicy::ConvertToSrgb
        } else {
            ColorManagementPolicy::Preserve
        },
    };
    if snapshot.target_size_enabled {
        if matches!(snapshot.format.as_str(), "jpeg" | "webp") {
            snapshot.auto_quality = false;
            snapshot.lossless = false;
        } else {
            snapshot.target_size_enabled = false;
        }
    }
    snapshot
}

fn normalize_preset_name(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(|name| js_trim(name).chars().take(MAX_PRESET_NAME_CHARS).collect())
        .unwrap_or_default()
}

/// ECMAScript `WhiteSpace` + `LineTerminator`: what `String.prototype.trim`
/// removes. Differs from Rust's `str::trim` (which also strips U+0085 and
/// keeps U+FEFF), and the difference changes output file names.
fn is_js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{9}' | '\u{A}' | '\u{B}' | '\u{C}' | '\u{D}' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// `String.prototype.trim`.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

/// `text.slice(0, max_units)`: the prefix that fits in `max_units` UTF-16
/// code units, never splitting a surrogate pair.
fn slice_utf16(text: &str, max_units: usize) -> String {
    let mut units = 0usize;
    text.chars()
        .take_while(|character| {
            units += character.len_utf16();
            units <= max_units
        })
        .collect()
}

/// `String(value)` for the shapes that can name a format: a string, or a
/// one-element array of a string (`String(["webp"]) === "webp"`).
fn string_like(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => match items.as_slice() {
            [Value::String(text)] => Some(text.clone()),
            _ => None,
        },
        _ => None,
    }
}

fn to_map<T: Serialize>(value: &T) -> Map<String, Value> {
    match serde_json::to_value(value) {
        Ok(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

fn set(map: &mut Map<String, Value>, key: &str, value: Value) {
    map.insert(key.to_string(), value);
}

fn constrain_bool(map: &mut Map<String, Value>, key: &str, fallback: bool) {
    if !matches!(map.get(key), Some(Value::Bool(_))) {
        set(map, key, json!(fallback));
    }
}

fn constrain_enum(map: &mut Map<String, Value>, key: &str, allowed: &[&str], fallback: &str) {
    let valid =
        matches!(map.get(key), Some(Value::String(text)) if allowed.contains(&text.as_str()));
    if !valid {
        set(map, key, json!(fallback));
    }
}

fn constrain_integer(map: &mut Map<String, Value>, key: &str, min: i64, max: i64, fallback: i64) {
    let value = integer(map.get(key), min, max, fallback);
    set(map, key, json!(value));
}

/// `Math.round` of a finite number clamped to `min..=max`; anything else
/// yields `fallback`.
fn integer(value: Option<&Value>, min: i64, max: i64, fallback: i64) -> i64 {
    match value.and_then(Value::as_f64) {
        Some(number) if number.is_finite() => (js_round(number) as i64).clamp(min, max),
        _ => fallback,
    }
}

/// `Math.round`: half away from zero for positive numbers, half towards +∞
/// for negative ones, and exact for values like 0.49999999999999994 where
/// `floor(x + 0.5)` would be off by one.
fn js_round(number: f64) -> f64 {
    let rounded = number.round();
    if number < 0.0 && (number - number.trunc()).abs() == 0.5 {
        rounded + 1.0
    } else {
        rounded
    }
}

fn boolean(value: Option<&Value>, fallback: bool) -> bool {
    value.and_then(Value::as_bool).unwrap_or(fallback)
}

fn quality_floor(value: Option<&Value>, fallback: u8) -> u8 {
    let normalized = integer(value, 0, 100, i64::from(fallback));
    if normalized < 30 {
        0
    } else {
        normalized as u8
    }
}

fn clamp_quality(value: Option<&Value>) -> u8 {
    integer(value, 1, 100, 80) as u8
}

fn normalize_quality_floor(value: Option<&Value>, fallback: u8) -> u8 {
    quality_floor(value, fallback)
}

// ---- file store ----

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("settings I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("settings could not be serialized: {0}")]
    Json(#[from] serde_json::Error),
}

/// What [`load`] found on disk.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct LoadedSettings {
    pub settings: Settings,
    /// A repair or migration happened; persist once so the next start is clean.
    pub changed: bool,
    /// The whole store document (other top-level keys included) to write back.
    pub document: Map<String, Value>,
    /// Set when an unreadable file was moved aside and defaults were used.
    pub quarantined: Option<PathBuf>,
}

/// Reads the store document at `path` and normalizes its `settings` record.
/// A pending temporary file from an interrupted write is renamed into place
/// first; an unparsable file is moved to `.corrupt-<unix seconds>`.
pub fn load(path: &Path, fallback_locale: AppLocale) -> Result<LoadedSettings, SettingsError> {
    recover_pending_write(path);
    let mut quarantined = None;
    let document = match fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(Value::Object(map)) => map,
            _ => {
                let aside = quarantine_path(path);
                fs::rename(path, &aside)?;
                quarantined = Some(aside);
                Map::new()
            }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => Map::new(),
        Err(error) => return Err(error.into()),
    };
    let normalized = normalize(document.get(SETTINGS_KEY), fallback_locale);
    Ok(LoadedSettings {
        settings: normalized.settings,
        changed: normalized.changed,
        document,
        quarantined,
    })
}

/// A `.tmp` left by an interrupted [`save`] is promoted when it is a complete
/// JSON object (the temporary file is fully written and synced before the
/// rename, so a parsable one is a finished write) and not older than the
/// destination (the Tauri shell may have written since); anything else is a
/// partial write and is removed.
fn recover_pending_write(path: &Path) {
    let temp = temp_path(path);
    let Ok(temp_meta) = fs::metadata(&temp) else {
        return;
    };
    let complete = fs::read(&temp)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|value| value.is_object());
    let newer = match (
        temp_meta.modified(),
        fs::metadata(path).and_then(|m| m.modified()),
    ) {
        (Ok(temp_time), Ok(dest_time)) => temp_time >= dest_time,
        (Ok(_), Err(_)) => true,
        (Err(_), _) => false,
    };
    if complete && newer {
        let _ = fs::rename(&temp, path);
    } else {
        let _ = fs::remove_file(&temp);
    }
}

/// Writes `settings` into `document[SETTINGS_KEY]` and the document to `path`
/// atomically. The first write keeps a `settings.json.pre-gpui` copy of the
/// Tauri file; it is never overwritten later. A failed rename leaves the
/// temporary file for the next start to retry.
pub fn save(
    path: &Path,
    settings: &Settings,
    document: &mut Map<String, Value>,
) -> Result<(), SettingsError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let lock_file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(lock_path(path))?;
    let mut lock = fd_lock::RwLock::new(lock_file);
    let _guard = acquire_write_lock(&mut lock)?;

    // The backup is published by rename so a crash mid-copy cannot leave a
    // partial file that later saves would treat as the established backup.
    let backup = backup_path(path);
    if path.exists() && !backup.exists() {
        let staging = with_suffix(&backup, "tmp");
        fs::copy(path, &staging)?;
        File::open(&staging)?.sync_all()?;
        fs::rename(&staging, &backup)?;
    }
    document.insert(SETTINGS_KEY.to_string(), serde_json::to_value(settings)?);
    let bytes = serde_json::to_vec_pretty(&Value::Object(document.clone()))?;
    let temp = temp_path(path);
    {
        let mut file = File::create(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    fs::rename(&temp, path)?;
    Ok(())
}

/// How long [`save`] waits for another writer before giving up. Contention
/// is rare (one instance per data directory), so the bound only guards the
/// foreground against a wedged holder.
pub const LOCK_WAIT: Duration = Duration::from_millis(500);
const LOCK_POLL: Duration = Duration::from_millis(10);

fn acquire_write_lock(
    lock: &mut fd_lock::RwLock<File>,
) -> io::Result<fd_lock::RwLockWriteGuard<'_, File>> {
    let deadline = Instant::now() + LOCK_WAIT;
    loop {
        let busy = match lock.try_write() {
            Ok(_) => false,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => true,
            Err(error) => return Err(error),
        };
        if !busy {
            return lock.try_write();
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "another process is writing the settings file",
            ));
        }
        std::thread::sleep(LOCK_POLL);
    }
}

pub fn temp_path(path: &Path) -> PathBuf {
    with_suffix(path, "tmp")
}

pub fn backup_path(path: &Path) -> PathBuf {
    with_suffix(path, PRE_GPUI_BACKUP_SUFFIX)
}

fn lock_path(path: &Path) -> PathBuf {
    with_suffix(path, "lock")
}

/// `settings.json.corrupt-<unix seconds>`, with `-<n>` appended while the
/// name is taken so an earlier quarantine is never overwritten.
fn quarantine_path(path: &Path) -> PathBuf {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let first = with_suffix(path, &format!("corrupt-{seconds}"));
    if !first.exists() {
        return first;
    }
    (1u32..)
        .map(|n| with_suffix(path, &format!("corrupt-{seconds}-{n}")))
        .find(|candidate| !candidate.exists())
        .expect("an unused quarantine name exists")
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".");
    name.push(suffix);
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "imgconvert-settings-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn defaults_round_trip_through_json_with_camel_case_keys() {
        let value = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(value["format"], "avif");
        assert_eq!(value["outputSuffixEnabled"], true);
        assert_eq!(value["customWorkflowPresets"], json!([]));
        assert_eq!(value["conversionPolicyVersion"], CONVERSION_POLICY_VERSION);
        assert!(
            value.get("extra").is_none(),
            "flattened map must not appear as a key"
        );
        let back: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(back, Settings::default());
    }

    #[test]
    fn missing_record_uses_defaults_with_the_fallback_locale() {
        let normalized = normalize(None, AppLocale::EnUs);
        assert_eq!(normalized.settings.locale, AppLocale::EnUs);
        assert!(!normalized.changed);
        let expected = Settings {
            locale: AppLocale::EnUs,
            ..Settings::default()
        };
        assert_eq!(normalized.settings, expected);
    }

    #[test]
    fn invalid_values_are_repaired_like_the_svelte_shell() {
        let persisted = json!({
            "overwrite": true,
            "theme": "sepia",
            "locale": "fr-FR",
            "format": "  ",
            "outDir": 42,
            "fileNameTemplate": "",
            "quality": 250.7,
            "pngQuantColors": 3,
            "avifSubsample": "yuv422",
            "resizeMode": "percentage",
            "resizeValue": 9000,
            "pdfPageRange": 7,
            "concurrency": 99,
            "autoQualityScore": 10,
            "jpegQualityFloor": 12,
            "futureKey": {"keep": "me"}
        });
        let normalized = normalize(Some(&persisted), AppLocale::EnUs);
        let s = &normalized.settings;
        assert!(normalized.changed);
        assert_eq!(s.overwrite, OverwriteMode::Overwrite);
        assert_eq!(s.theme, Theme::System);
        assert_eq!(s.locale, AppLocale::EnUs);
        assert_eq!(s.format, "jpeg");
        assert_eq!(s.out_dir, None);
        assert_eq!(s.file_name_template, "%name%");
        assert_eq!(s.quality, 100);
        assert_eq!(s.png_quant_colors, 64);
        assert_eq!(s.avif_subsample, AvifSubsample::Yuv444);
        assert_eq!(s.resize_mode, ResizeMode::Percentage);
        assert_eq!(s.resize_value, 400);
        assert_eq!(s.pdf_page_range, "");
        assert_eq!(s.concurrency, 8);
        assert_eq!(s.auto_quality_score, 50);
        assert_eq!(s.jpeg_quality_floor, 0, "floors below 30 collapse to 0");
        assert_eq!(s.extra["futureKey"], json!({"keep": "me"}));
        // A legacy record without the suffix switch keeps template-only behaviour.
        assert!(!s.output_suffix_enabled);
        assert_eq!(s.output_suffix, DEFAULT_OUTPUT_SUFFIX);
    }

    #[test]
    fn a_current_record_is_reported_unchanged() {
        let defaults = Settings::default();
        let value = serde_json::to_value(&defaults).unwrap();
        let normalized = normalize(Some(&value), AppLocale::EnUs);
        assert!(!normalized.changed, "{:?}", normalized.settings);
        assert_eq!(normalized.settings, defaults);
    }

    #[test]
    fn suffix_settings_follow_the_svelte_rules() {
        let empty = Map::new();
        assert_eq!(
            normalize_persisted_output_suffix_settings(
                Some(&empty),
                Some(&json!(true)),
                Some(&json!("_done"))
            ),
            OutputSuffixSettings {
                enabled: false,
                suffix: "_done".into()
            }
        );
        let mut with_switch = Map::new();
        with_switch.insert("outputSuffixEnabled".into(), json!(false));
        assert_eq!(
            normalize_persisted_output_suffix_settings(
                Some(&with_switch),
                Some(&json!(false)),
                Some(&json!("_custom"))
            ),
            OutputSuffixSettings {
                enabled: false,
                suffix: "_custom".into()
            }
        );
        assert_eq!(
            normalize_persisted_output_suffix_settings(
                None,
                Some(&json!("invalid")),
                Some(&json!(""))
            ),
            OutputSuffixSettings {
                enabled: true,
                suffix: "_done".into()
            }
        );
    }

    #[test]
    fn suffix_input_is_sanitized_and_bounded() {
        assert_eq!(
            normalize_output_suffix_input(" _done%100 "),
            NormalizedSuffix {
                value: "_done%100".into(),
                adjusted: true
            }
        );
        assert_eq!(
            normalize_output_suffix_input("_done/path"),
            NormalizedSuffix {
                value: "_done_path".into(),
                adjusted: true
            }
        );
        assert_eq!(
            normalize_output_suffix_input("..."),
            NormalizedSuffix {
                value: "...".into(),
                adjusted: false
            }
        );
        let emoji = normalize_output_suffix_input(&"😀".repeat(48));
        assert!(emoji.value.chars().count() <= OUTPUT_SUFFIX_MAX_CHARS);
        assert!(emoji.value.len() <= OUTPUT_SUFFIX_MAX_BYTES);
        assert!(emoji.adjusted);
    }

    #[test]
    fn legacy_skip_policies_migrate_to_conversion_first() {
        let mut legacy = Map::new();
        legacy.insert("skipIfLarger".into(), json!(true));
        let policy = normalize_persisted_conversion_policy_settings(
            Some(&legacy),
            Some(&json!(true)),
            Some(&json!(true)),
        );
        assert_eq!(
            policy,
            ConversionPolicySettings {
                generation_loss_protection: false,
                skip_if_larger: false,
                conversion_policy_version: CONVERSION_POLICY_VERSION,
                migrated: true
            }
        );
        let mut current = Map::new();
        current.insert("generationLossProtection".into(), json!(true));
        current.insert("skipIfLarger".into(), json!(true));
        current.insert(
            "conversionPolicyVersion".into(),
            json!(CONVERSION_POLICY_VERSION),
        );
        let policy = normalize_persisted_conversion_policy_settings(
            Some(&current),
            Some(&json!(true)),
            Some(&json!(true)),
        );
        assert!(policy.generation_loss_protection && policy.skip_if_larger && !policy.migrated);
    }

    #[test]
    fn custom_presets_are_filtered_and_constrained() {
        let presets = normalize_custom_workflow_presets(Some(&json!([
            {"id": "custom:a", "name": "  Web  ", "snapshot": {"format": "webp", "quality": 500, "targetSizeEnabled": true}},
            {"id": "builtin:x", "name": "nope"},
            {"id": "custom:a", "name": "duplicate"},
            {"id": "custom:b", "name": "", "snapshot": {}},
            {"id": "custom:c", "name": "Lossless target", "snapshot": {"format": "png", "targetSizeEnabled": true, "lossless": true}}
        ])));
        assert_eq!(presets.len(), 2);
        assert_eq!(presets[0].name, "Web");
        assert_eq!(presets[0].snapshot.quality, 100);
        assert!(presets[0].snapshot.target_size_enabled && !presets[0].snapshot.lossless);
        // Target size is only meaningful for jpeg/webp.
        assert!(!presets[1].snapshot.target_size_enabled);
        assert!(presets[1].snapshot.lossless);
    }

    #[test]
    fn store_round_trip_preserves_foreign_keys_and_backs_up_once() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("settings.json");
        // A Tauri-era document: other top-level keys, a legacy settings record.
        fs::write(
            &path,
            serde_json::to_vec_pretty(&json!({
                "windowState": {"w": 1},
                "settings": {"format": "png", "quality": 70, "skipIfLarger": true, "plugin": "keep"}
            }))
            .unwrap(),
        )
        .unwrap();
        let mut loaded = load(&path, AppLocale::EnUs).unwrap();
        assert!(loaded.changed, "policy migration must request a write");
        assert_eq!(loaded.settings.format, "png");
        assert_eq!(loaded.settings.quality, 70);
        assert!(!loaded.settings.skip_if_larger);
        assert_eq!(loaded.settings.extra["plugin"], "keep");
        assert_eq!(
            loaded.settings.locale,
            AppLocale::EnUs,
            "no locale key falls back"
        );

        loaded.settings.quality = 55;
        save(&path, &loaded.settings, &mut loaded.document).unwrap();
        assert!(backup_path(&path).exists());
        let backup: Value = serde_json::from_slice(&fs::read(backup_path(&path)).unwrap()).unwrap();
        assert_eq!(backup["settings"]["quality"], 70);

        let written: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(written["windowState"], json!({"w": 1}));
        assert_eq!(written["settings"]["quality"], 55);
        assert_eq!(written["settings"]["plugin"], "keep");
        assert_eq!(
            written["settings"]["conversionPolicyVersion"],
            CONVERSION_POLICY_VERSION
        );

        // A second save never touches the backup.
        loaded.settings.quality = 44;
        save(&path, &loaded.settings, &mut loaded.document).unwrap();
        let backup: Value = serde_json::from_slice(&fs::read(backup_path(&path)).unwrap()).unwrap();
        assert_eq!(backup["settings"]["quality"], 70);
        assert!(!temp_path(&path).exists());

        let reloaded = load(&path, AppLocale::ZhCn).unwrap();
        assert!(!reloaded.changed);
        assert_eq!(reloaded.settings.quality, 44);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_files_are_quarantined_and_pending_temp_files_retried() {
        let dir = temp_dir("corrupt");
        let path = dir.join("settings.json");
        fs::write(&path, b"{ definitely not json").unwrap();
        let loaded = load(&path, AppLocale::EnUs).unwrap();
        assert!(loaded.quarantined.is_some());
        assert!(!path.exists());
        assert_eq!(
            loaded.settings,
            Settings {
                locale: AppLocale::EnUs,
                ..Settings::default()
            }
        );

        // An interrupted write left only the temporary file behind.
        fs::write(
            temp_path(&path),
            serde_json::to_vec(&json!({"settings": {"quality": 33, "conversionPolicyVersion": 2}}))
                .unwrap(),
        )
        .unwrap();
        let loaded = load(&path, AppLocale::EnUs).unwrap();
        assert_eq!(loaded.settings.quality, 33);
        assert!(path.exists() && !temp_path(&path).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn javascript_string_and_number_semantics_are_matched() {
        // String.prototype.trim: U+0085 stays, U+FEFF goes.
        assert_eq!(js_trim("\u{85}x\u{85}"), "\u{85}x\u{85}");
        assert_eq!(js_trim("\u{FEFF} x \u{3000}"), "x");
        assert_eq!(
            normalize_output_suffix_input("\u{85}x\u{85}").value,
            "_x_",
            "NEL is a control character, not whitespace, in JavaScript"
        );
        // slice(0, n) counts UTF-16 units; an astral character is two.
        assert_eq!(slice_utf16("a😀b", 2), "a");
        assert_eq!(slice_utf16("a😀b", 3), "a😀");
        // Math.round.
        assert_eq!(js_round(0.499_999_999_999_999_94), 0.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(integer(Some(&json!(-2.5)), -10, 10, 0), -2);
        // conversionPolicyVersion === 2 accepts 2.0.
        let mut current = Map::new();
        current.insert("conversionPolicyVersion".into(), json!(2.0));
        let policy = normalize_persisted_conversion_policy_settings(
            Some(&current),
            Some(&json!(true)),
            None,
        );
        assert!(policy.generation_loss_protection && !policy.migrated);
        // String(["webp"]) names a format.
        assert_eq!(
            normalize_workflow_snapshot(&json!({"format": ["webp"]})).format,
            "webp"
        );
        assert_eq!(
            normalize_workflow_snapshot(&json!({"format": ["webp", "png"]})).format,
            "avif"
        );
    }

    #[test]
    fn pending_writes_are_promoted_only_when_complete_and_newer() {
        let dir = temp_dir("pending");
        let path = dir.join("settings.json");
        // Partial temporary file next to a good destination: dropped.
        fs::write(
            &path,
            serde_json::to_vec(&json!({"settings": {"quality": 40}})).unwrap(),
        )
        .unwrap();
        fs::write(temp_path(&path), b"{\"settings\": {\"qual").unwrap();
        let loaded = load(&path, AppLocale::EnUs).unwrap();
        assert_eq!(loaded.settings.quality, 40);
        assert!(!temp_path(&path).exists());
        // Complete temporary file newer than the destination: promoted.
        std::thread::sleep(Duration::from_millis(20));
        fs::write(
            temp_path(&path),
            serde_json::to_vec(&json!({"settings": {"quality": 41, "conversionPolicyVersion": 2}}))
                .unwrap(),
        )
        .unwrap();
        let loaded = load(&path, AppLocale::EnUs).unwrap();
        assert_eq!(loaded.settings.quality, 41);
        assert!(!temp_path(&path).exists());
        // Two corrupt files in one second get distinct quarantine names.
        fs::write(&path, b"nope").unwrap();
        let first = load(&path, AppLocale::EnUs).unwrap().quarantined.unwrap();
        fs::write(&path, b"nope again").unwrap();
        let second = load(&path, AppLocale::EnUs).unwrap().quarantined.unwrap();
        assert_ne!(first, second);
        assert!(first.exists() && second.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn workflow_snapshot_capture_and_apply_are_allowlisted() {
        let mut settings = Settings {
            out_dir: Some("/keep/me".into()),
            overwrite: OverwriteMode::Overwrite,
            ..Settings::default()
        };
        let mut snapshot = settings.workflow_snapshot();
        snapshot.format = "webp".into();
        snapshot.metadata_policy = MetadataPolicy::PreserveAll;
        settings.apply_workflow_snapshot(&snapshot);
        assert_eq!(settings.format, "webp");
        assert!(settings.preserve_metadata);
        assert_eq!(settings.out_dir.as_deref(), Some("/keep/me"));
        assert_eq!(settings.overwrite, OverwriteMode::Overwrite);
    }
}
