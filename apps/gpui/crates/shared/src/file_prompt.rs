// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Native file prompts. GPUI's `prompt_for_paths` is the platform picker, so
//! macOS gets an `NSOpenPanel` whose selection is the only write grant the
//! sandboxed build has (plan §3.6).

use std::path::PathBuf;

use gpui_kit::{App, PathPromptOptions, SharedString};

/// What the user is asked to choose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptKind {
    /// Files and folders to import, many at once.
    ImportPaths,
    /// One output folder.
    OutputFolder,
}

pub fn options_for(kind: PromptKind, prompt: SharedString) -> PathPromptOptions {
    match kind {
        PromptKind::ImportPaths => PathPromptOptions {
            files: true,
            directories: true,
            multiple: true,
            prompt: Some(prompt),
        },
        PromptKind::OutputFolder => PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some(prompt),
        },
    }
}

/// Opens the platform picker. Resolves to `None` when the user cancels or
/// the platform could not show a picker.
pub fn prompt_paths(
    kind: PromptKind,
    prompt: SharedString,
    cx: &App,
) -> impl Future<Output = Option<Vec<PathBuf>>> + use<> {
    let receiver = cx.prompt_for_paths(options_for(kind, prompt));
    async move {
        match receiver.await {
            Ok(Ok(Some(paths))) if !paths.is_empty() => Some(paths),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_prompt_allows_many_files_and_folders() {
        let options = options_for(PromptKind::ImportPaths, "Add".into());
        assert!(options.files && options.directories && options.multiple);
        let options = options_for(PromptKind::OutputFolder, "Choose".into());
        assert!(!options.files && options.directories && !options.multiple);
    }
}
