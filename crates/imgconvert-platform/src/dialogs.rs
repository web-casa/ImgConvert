// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! File picker interface. The platform layer only declares the contract; each
//! shell (Tauri plugin dialog, GPUI prompt, host-process picker) implements it.

use std::fmt;
use std::path::PathBuf;

/// What the picker should let the person choose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickKind {
    /// One or more files.
    Files,
    /// Exactly one directory.
    Directory,
}

/// A picker request. Fields are private so new options can be added without
/// breaking shells; use the builder methods.
#[derive(Debug, Clone)]
pub struct PickRequest {
    kind: PickKind,
    title: Option<String>,
    allowed_extensions: Vec<String>,
    multiple: bool,
}

impl PickRequest {
    pub fn files() -> Self {
        Self {
            kind: PickKind::Files,
            title: None,
            allowed_extensions: Vec::new(),
            multiple: true,
        }
    }

    pub fn directory() -> Self {
        Self {
            kind: PickKind::Directory,
            title: None,
            allowed_extensions: Vec::new(),
            multiple: false,
        }
    }

    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Lower-case extensions without a leading dot; empty means any file.
    pub fn with_allowed_extensions<I, S>(mut self, extensions: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.allowed_extensions = extensions.into_iter().map(Into::into).collect();
        self
    }

    pub fn with_multiple(mut self, multiple: bool) -> Self {
        self.multiple = multiple;
        self
    }

    pub fn kind(&self) -> PickKind {
        self.kind
    }

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    pub fn allowed_extensions(&self) -> &[String] {
        &self.allowed_extensions
    }

    pub fn multiple(&self) -> bool {
        self.multiple
    }
}

/// Why a pick produced no paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PickError {
    /// The person dismissed the picker. Not an error for the UI to surface.
    Cancelled,
    /// The picker cannot run in this environment (missing host tool, sandbox).
    Unavailable(String),
    /// The picker ran but failed.
    Failed(String),
}

impl fmt::Display for PickError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PickError::Cancelled => f.write_str("file picker cancelled"),
            PickError::Unavailable(detail) => write!(f, "file picker unavailable: {detail}"),
            PickError::Failed(detail) => write!(f, "file picker failed: {detail}"),
        }
    }
}

impl std::error::Error for PickError {}

/// A modal file or directory picker. Implementations may block the calling
/// thread; callers run them off the UI thread.
pub trait FilePicker: Send + Sync {
    fn pick(&self, request: &PickRequest) -> Result<Vec<PathBuf>, PickError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_builders_keep_defaults() {
        let files = PickRequest::files().with_allowed_extensions(["png", "jpg"]);
        assert_eq!(files.kind(), PickKind::Files);
        assert!(files.multiple());
        assert_eq!(files.allowed_extensions(), ["png", "jpg"]);
        let dir = PickRequest::directory().with_title("Output");
        assert_eq!(dir.kind(), PickKind::Directory);
        assert!(!dir.multiple());
        assert_eq!(dir.title(), Some("Output"));
    }
}
