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
    /// Folders to scan recursively, many at once.
    ImportFolders,
    /// One output folder.
    OutputFolder,
    /// One file, such as a helper executable.
    SingleFile,
}

pub fn options_for(kind: PromptKind, prompt: SharedString) -> PathPromptOptions {
    match kind {
        PromptKind::ImportPaths => PathPromptOptions {
            files: true,
            directories: true,
            multiple: true,
            prompt: Some(prompt),
        },
        PromptKind::ImportFolders => PathPromptOptions {
            files: false,
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
        PromptKind::SingleFile => PathPromptOptions {
            files: true,
            directories: false,
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
            Ok(Ok(Some(paths))) => keep_picked(kind, paths),
            _ => None,
        }
    }
}

/// The picked paths a caller can use. macOS hands back a file typed into
/// "Go to Folder" even from a folder-only panel, so an output folder that is
/// not a directory counts as no choice rather than becoming the output path.
fn keep_picked(kind: PromptKind, paths: Vec<PathBuf>) -> Option<Vec<PathBuf>> {
    let paths: Vec<PathBuf> = match kind {
        PromptKind::OutputFolder => paths.into_iter().filter(|path| path.is_dir()).collect(),
        _ => paths,
    };
    (!paths.is_empty()).then_some(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_prompt_allows_many_files_and_folders() {
        let options = options_for(PromptKind::ImportPaths, "Add".into());
        assert!(options.files && options.directories && options.multiple);
        let folders = options_for(PromptKind::ImportFolders, "Add folders".into());
        assert!(!folders.files && folders.directories && folders.multiple);
        let options = options_for(PromptKind::OutputFolder, "Choose".into());
        assert!(!options.files && options.directories && !options.multiple);
        let options = options_for(PromptKind::SingleFile, "Choose".into());
        assert!(options.files && !options.directories && !options.multiple);
    }

    #[test]
    fn an_output_folder_must_be_a_directory() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let file = dir.join("Cargo.toml");
        assert_eq!(
            keep_picked(PromptKind::OutputFolder, vec![dir.clone()]),
            Some(vec![dir.clone()])
        );
        assert_eq!(
            keep_picked(PromptKind::OutputFolder, vec![file.clone()]),
            None
        );
        assert_eq!(keep_picked(PromptKind::OutputFolder, vec![]), None);
        // Imports take files and folders alike.
        assert_eq!(
            keep_picked(PromptKind::ImportPaths, vec![file.clone()]),
            Some(vec![file])
        );
    }
}
