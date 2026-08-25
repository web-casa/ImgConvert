// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Stable, locale-neutral errors returned by Tauri commands.
//!
//! The `detail` field is deliberately kept separate from the user-facing code
//! and parameters. Frontend callers localize only `code` and `params`.

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    FileNotFound,
    PermissionDenied,
    OutputPermissionDenied,
    UnsupportedFormat,
    OutputExists,
    InvalidOutputSuffix,
    SourceOverwriteConfirmationRequired,
    OutputConflictsWithInput,
    OutputSafetyCheckFailed,
    OutputNotSmaller,
    ConversionFailed,
    BatchFailed,
    ImportFailed,
    ClipboardImportFailed,
    NativeDialogFailed,
    ThumbnailFailed,
    CodecConfigurationFailed,
    TaskFailed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: ErrorCode,
    pub params: Option<Value>,
    pub detail: Option<String>,
}

impl CommandError {
    pub fn new(code: ErrorCode, params: Option<Value>, detail: impl Into<String>) -> Self {
        Self {
            code,
            params,
            detail: Some(detail.into()),
        }
    }

    pub fn with_path(code: ErrorCode, path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::new(code, Some(json!({ "path": path.into() })), detail)
    }

    pub fn file_not_found(path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::with_path(ErrorCode::FileNotFound, path, detail)
    }

    pub fn permission_denied(path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::with_path(ErrorCode::PermissionDenied, path, detail)
    }

    pub fn output_permission_denied(path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::with_path(ErrorCode::OutputPermissionDenied, path, detail)
    }

    pub fn unsupported_format(format: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::new(
            ErrorCode::UnsupportedFormat,
            Some(json!({ "format": format.into() })),
            detail,
        )
    }

    pub fn output_exists(path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::with_path(ErrorCode::OutputExists, path, detail)
    }

    pub fn invalid_output_suffix(detail: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidOutputSuffix, None, detail)
    }

    pub fn source_overwrite_confirmation_required(
        path: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self::with_path(ErrorCode::SourceOverwriteConfirmationRequired, path, detail)
    }

    pub fn output_conflicts_with_input(path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::with_path(ErrorCode::OutputConflictsWithInput, path, detail)
    }

    pub fn output_safety_check_failed(path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::with_path(ErrorCode::OutputSafetyCheckFailed, path, detail)
    }

    pub fn output_not_smaller(path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::with_path(ErrorCode::OutputNotSmaller, path, detail)
    }

    pub fn conversion_failed(path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::with_path(ErrorCode::ConversionFailed, path, detail)
    }

    pub fn batch_failed(detail: impl Into<String>) -> Self {
        Self::new(ErrorCode::BatchFailed, None, detail)
    }

    pub fn import_failed(path: Option<&str>, detail: impl Into<String>) -> Self {
        let params = path.map(|path| json!({ "path": path }));
        Self::new(ErrorCode::ImportFailed, params, detail)
    }

    pub fn clipboard_import_failed(detail: impl Into<String>) -> Self {
        Self::new(ErrorCode::ClipboardImportFailed, None, detail)
    }

    pub fn native_dialog_failed(detail: impl Into<String>) -> Self {
        Self::new(ErrorCode::NativeDialogFailed, None, detail)
    }

    pub fn thumbnail_failed(path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::with_path(ErrorCode::ThumbnailFailed, path, detail)
    }

    pub fn codec_configuration_failed(path: Option<&str>, detail: impl Into<String>) -> Self {
        let params = path.map(|path| json!({ "path": path }));
        Self::new(ErrorCode::CodecConfigurationFailed, params, detail)
    }

    pub fn task_failed(detail: impl Into<String>) -> Self {
        Self::new(ErrorCode::TaskFailed, None, detail)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_the_stable_camel_case_contract() {
        let error = CommandError::file_not_found("/images/missing.png", "source file is missing");

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({
                "code": "fileNotFound",
                "params": { "path": "/images/missing.png" },
                "detail": "source file is missing",
            })
        );
    }

    #[test]
    fn serializes_null_params_when_a_code_has_no_ui_values() {
        let error = CommandError::batch_failed("progress channel closed");
        let serialized = serde_json::to_value(error).unwrap();

        assert_eq!(serialized["code"], "batchFailed");
        assert!(serialized["params"].is_null());
    }

    #[test]
    fn serializes_output_directory_permission_errors() {
        let error = CommandError::output_permission_denied(
            "/images/output",
            "cannot create output file: Permission denied",
        );

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({
                "code": "outputPermissionDenied",
                "params": { "path": "/images/output" },
                "detail": "cannot create output file: Permission denied",
            })
        );
    }
}
