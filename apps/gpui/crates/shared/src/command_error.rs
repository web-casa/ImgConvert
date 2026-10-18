// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Presentation of the shared backend contract. Diagnostic detail never becomes
//! interface text. Keep errors structured until render so locale changes apply.

use crate::i18n::{tr, tr_with};
use gpui_kit::SharedString;
use imgconvert_backend::command_error::{CommandError, ErrorCode};

pub fn format_command_error(error: &CommandError) -> SharedString {
    let (key, required) = match error.code {
        ErrorCode::FileNotFound => ("errors.fileNotFound", Some("path")),
        ErrorCode::PermissionDenied => ("errors.permissionDenied", Some("path")),
        ErrorCode::OutputPermissionDenied => ("errors.outputPermissionDenied", Some("path")),
        ErrorCode::UnsupportedFormat => ("errors.unsupportedFormat", Some("format")),
        ErrorCode::OutputExists => ("errors.outputExists", Some("path")),
        ErrorCode::InvalidOutputSuffix => ("errors.invalidOutputSuffix", None),
        ErrorCode::SourceOverwriteConfirmationRequired => {
            ("errors.sourceOverwriteConfirmationRequired", Some("path"))
        }
        ErrorCode::OutputConflictsWithInput => ("errors.outputConflictsWithInput", Some("path")),
        ErrorCode::OutputSafetyCheckFailed => ("errors.outputSafetyCheckFailed", Some("path")),
        ErrorCode::OutputNotSmaller => ("errors.outputNotSmaller", Some("path")),
        ErrorCode::PdfPasswordProtected => ("errors.pdfPasswordProtected", Some("path")),
        ErrorCode::PdfSettingsInvalid => ("errors.pdfSettingsInvalid", Some("path")),
        ErrorCode::PdfResourceLimit => ("errors.pdfResourceLimit", Some("path")),
        ErrorCode::PdfInvalid => ("errors.pdfInvalid", Some("path")),
        ErrorCode::ConversionFailed => ("errors.conversionFailed", Some("path")),
        ErrorCode::BatchFailed => ("errors.batchFailed", None),
        ErrorCode::ImportFailed => ("errors.importFailed", None),
        ErrorCode::ClipboardImportFailed => ("errors.clipboardImportFailed", None),
        ErrorCode::NativeDialogFailed => ("errors.nativeDialogFailed", None),
        ErrorCode::ThumbnailFailed => ("errors.thumbnailFailed", Some("path")),
        ErrorCode::PreviewFailed => ("errors.previewFailed", Some("path")),
        ErrorCode::CodecConfigurationFailed => ("errors.codecConfigurationFailed", None),
        ErrorCode::TaskFailed => ("errors.taskFailed", None),
    };
    if let Some(name) = required {
        let value = error.params.as_ref().and_then(|params| params.get(name));
        let value = match value {
            Some(serde_json::Value::String(value)) if !value.is_empty() => value.clone(),
            Some(serde_json::Value::Number(value)) => value.to_string(),
            Some(serde_json::Value::Bool(value)) => value.to_string(),
            _ => return tr("errors.taskFailed"),
        };
        tr_with(key, &[(name, &value)])
    } else {
        tr(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{LOCALE_LOCK, Locale, set_locale};

    #[test]
    fn command_errors_translate_without_diagnostic_detail_and_validate_parameters() {
        let _guard = LOCALE_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let error = CommandError::file_not_found("/images/%{format}.png", "PRIVATE diagnostic");
        for (locale, prefix) in [
            (Locale::English, "File not found: "),
            (Locale::SimplifiedChinese, "找不到文件："),
        ] {
            set_locale(locale);
            assert_eq!(
                format_command_error(&error).as_ref(),
                format!("{prefix}/images/%{{format}}.png")
            );
            for code in [
                ErrorCode::FileNotFound,
                ErrorCode::PermissionDenied,
                ErrorCode::OutputPermissionDenied,
                ErrorCode::UnsupportedFormat,
                ErrorCode::OutputExists,
                ErrorCode::InvalidOutputSuffix,
                ErrorCode::SourceOverwriteConfirmationRequired,
                ErrorCode::OutputConflictsWithInput,
                ErrorCode::OutputSafetyCheckFailed,
                ErrorCode::OutputNotSmaller,
                ErrorCode::PdfPasswordProtected,
                ErrorCode::PdfSettingsInvalid,
                ErrorCode::PdfResourceLimit,
                ErrorCode::PdfInvalid,
                ErrorCode::ConversionFailed,
                ErrorCode::BatchFailed,
                ErrorCode::ImportFailed,
                ErrorCode::ClipboardImportFailed,
                ErrorCode::NativeDialogFailed,
                ErrorCode::ThumbnailFailed,
                ErrorCode::PreviewFailed,
                ErrorCode::CodecConfigurationFailed,
                ErrorCode::TaskFailed,
            ] {
                let error = CommandError::new(
                    code,
                    Some(serde_json::json!({"path":"/test", "format":"heic"})),
                    "PRIVATE diagnostic",
                );
                let text = format_command_error(&error);
                assert!(!text.starts_with("errors."), "{text}");
                assert!(!text.contains("PRIVATE"), "{text}");
                assert!(!text.contains("%{"), "{text}");
            }
            for params in [
                None,
                Some(serde_json::json!({"path":null})),
                Some(serde_json::json!({"path":[]})),
                Some(serde_json::json!({"path":""})),
            ] {
                assert_eq!(
                    format_command_error(&CommandError::new(
                        ErrorCode::PdfInvalid,
                        params,
                        "PRIVATE"
                    )),
                    tr("errors.taskFailed")
                );
            }
        }
        set_locale(Locale::English);
    }
}
