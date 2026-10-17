// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Scenario presets (port of `src/lib/workflow-presets.ts`): the four
//! built-in presets, matching the current settings against every preset,
//! and creating a custom preset from the current settings.

use std::time::{SystemTime, UNIX_EPOCH};

use crate::settings::{
    js_trim, CustomWorkflowPreset, MetadataPolicy, ResizeMode, Settings, WorkflowPresetSnapshot,
    MAX_CUSTOM_PRESETS, MAX_PRESET_NAME_CHARS, WORKFLOW_SETTINGS_VERSION,
};

/// A preset that ships with the product. Label and description are message
/// keys so each shell renders them in its own locale.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct BuiltinWorkflowPreset {
    pub id: &'static str,
    pub label_key: &'static str,
    pub description_key: &'static str,
    pub snapshot: WorkflowPresetSnapshot,
}

/// Prefix of every custom preset id; anything else is rejected on load.
pub const CUSTOM_PRESET_ID_PREFIX: &str = "custom:";

/// The built-in presets in display order.
pub fn builtin_workflow_presets() -> Vec<BuiltinWorkflowPreset> {
    let base = WorkflowPresetSnapshot::default;
    vec![
        BuiltinWorkflowPreset {
            id: "builtin:web-sharing",
            label_key: "workflow.presets.web_sharing",
            description_key: "workflow.presets.web_sharing_description",
            snapshot: WorkflowPresetSnapshot {
                format: "webp".into(),
                quality: 82,
                resize_mode: ResizeMode::LongestEdge,
                resize_value: 2048,
                metadata_policy: MetadataPolicy::ColorOnly,
                ..base()
            },
        },
        BuiltinWorkflowPreset {
            id: "builtin:email",
            label_key: "workflow.presets.email",
            description_key: "workflow.presets.email_description",
            snapshot: WorkflowPresetSnapshot {
                format: "jpeg".into(),
                quality: 82,
                resize_mode: ResizeMode::LongestEdge,
                resize_value: 1600,
                target_size_enabled: true,
                target_size_kib: 1024,
                metadata_policy: MetadataPolicy::ColorOnly,
                ..base()
            },
        },
        BuiltinWorkflowPreset {
            id: "builtin:high-quality",
            label_key: "workflow.presets.high_quality",
            description_key: "workflow.presets.high_quality_description",
            snapshot: WorkflowPresetSnapshot {
                format: "avif".into(),
                quality: 90,
                metadata_policy: MetadataPolicy::PreserveAll,
                ..base()
            },
        },
        BuiltinWorkflowPreset {
            id: "builtin:private-sharing",
            label_key: "workflow.presets.private_sharing",
            description_key: "workflow.presets.private_sharing_description",
            snapshot: WorkflowPresetSnapshot {
                format: "jpeg".into(),
                quality: 85,
                resize_mode: ResizeMode::LongestEdge,
                resize_value: 2048,
                metadata_policy: MetadataPolicy::StripAll,
                ..base()
            },
        },
    ]
}

/// The id of the built-in or custom preset whose snapshot equals the current
/// workflow settings, if any.
pub fn matching_workflow_preset_id(settings: &Settings) -> Option<String> {
    let current = settings.workflow_snapshot();
    builtin_workflow_presets()
        .into_iter()
        .find(|preset| preset.snapshot == current)
        .map(|preset| preset.id.to_string())
        .or_else(|| {
            settings
                .custom_workflow_presets
                .iter()
                .find(|preset| preset.snapshot == current)
                .map(|preset| preset.id.clone())
        })
}

/// `name` trimmed to the preset-name limit, or `None` when nothing is left.
pub fn normalize_preset_name(name: &str) -> Option<String> {
    let trimmed: String = js_trim(name).chars().take(MAX_PRESET_NAME_CHARS).collect();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// A custom preset capturing the current workflow settings. `None` when the
/// id is not a custom id or the name is empty after trimming.
pub fn create_custom_workflow_preset(
    id: &str,
    name: &str,
    settings: &Settings,
) -> Option<CustomWorkflowPreset> {
    if !id.starts_with(CUSTOM_PRESET_ID_PREFIX) {
        return None;
    }
    Some(CustomWorkflowPreset {
        id: id.to_string(),
        name: normalize_preset_name(name)?,
        version: WORKFLOW_SETTINGS_VERSION,
        snapshot: settings.workflow_snapshot(),
    })
}

/// A fresh custom id (`custom:<base36 unix millis>-<n>`) that no existing
/// preset uses, as the Svelte shell generates them.
pub fn next_custom_preset_id(existing: &[CustomWorkflowPreset]) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let stamp = base36(millis);
    let mut sequence = existing.len();
    loop {
        let id = format!("{CUSTOM_PRESET_ID_PREFIX}{stamp}-{sequence}");
        if !existing.iter().any(|preset| preset.id == id) {
            return id;
        }
        sequence += 1;
    }
}

/// Whether another custom preset may be saved.
pub fn can_save_custom_preset(settings: &Settings) -> bool {
    settings.custom_workflow_presets.len() < MAX_CUSTOM_PRESETS
}

fn base36(mut value: u128) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("base36 digits are ASCII")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_presets_are_normalized_and_match_their_own_snapshots() {
        let presets = builtin_workflow_presets();
        assert_eq!(presets.len(), 4);
        for preset in &presets {
            let mut settings = Settings {
                out_dir: Some("/keep".into()),
                ..Settings::default()
            };
            settings.apply_workflow_snapshot(&preset.snapshot);
            assert_eq!(
                matching_workflow_preset_id(&settings).as_deref(),
                Some(preset.id),
                "{}",
                preset.id
            );
            assert_eq!(settings.out_dir.as_deref(), Some("/keep"));
        }
        // The email preset keeps target size because it is lossy JPEG.
        let email = &presets[1];
        assert!(email.snapshot.target_size_enabled && !email.snapshot.lossless);
        // Defaults match no built-in preset.
        assert_eq!(matching_workflow_preset_id(&Settings::default()), None);
    }

    #[test]
    fn custom_presets_round_trip_through_matching() {
        let mut settings = Settings {
            quality: 61,
            ..Settings::default()
        };
        let id = next_custom_preset_id(&settings.custom_workflow_presets);
        assert!(id.starts_with("custom:") && id.ends_with("-0"));
        let preset = create_custom_workflow_preset(&id, "  Mine  ", &settings).unwrap();
        assert_eq!(preset.name, "Mine");
        assert_eq!(preset.snapshot.quality, 61);
        settings.custom_workflow_presets.push(preset);
        assert_eq!(
            matching_workflow_preset_id(&settings).as_deref(),
            Some(id.as_str())
        );
        assert!(create_custom_workflow_preset("builtin:x", "name", &settings).is_none());
        assert!(create_custom_workflow_preset(&id, "   ", &settings).is_none());
        let next = next_custom_preset_id(&settings.custom_workflow_presets);
        assert_ne!(next, id);
        assert!(can_save_custom_preset(&settings));
    }

    #[test]
    fn base36_matches_javascript() {
        assert_eq!(base36(0), "0");
        assert_eq!(base36(35), "z");
        assert_eq!(base36(36), "10");
        assert_eq!(base36(1_700_000_000_000), "loyw3v28");
    }
}
