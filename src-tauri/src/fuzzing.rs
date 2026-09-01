// SPDX-License-Identifier: Apache-2.0

//! Shared cargo-fuzz and deterministic-corpus bridges. Keeping the input
//! adapters here ensures CI replay exercises the same bounded harness as
//! libFuzzer instead of a weaker approximation.

use std::fs;
use std::path::Path;

use crate::import::ScanImportOptions;

const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_IMPORT_FUZZ_BYTES: usize = 4096;
const MAX_SYNTHETIC_ENTRIES: usize = 16;
const MAX_PDF_BYTES: usize = 1024 * 1024;

/// Cargo-fuzz bridge for the exact production manifest parser and validators.
/// It is not a Tauri command and cannot mutate codec configuration.
pub fn fuzz_external_codec_manifest(bytes: &[u8]) {
    if bytes.len() <= MAX_MANIFEST_BYTES {
        crate::external_codecs::fuzz_manifest_bytes(bytes);
    }
}

/// Builds the same bounded synthetic directory tree for libFuzzer and corpus
/// replay, then invokes the production authorized import scanner.
pub fn fuzz_import_scan_bytes(data: &[u8]) {
    if data.is_empty() || data.len() > MAX_IMPORT_FUZZ_BYTES {
        return;
    }
    let Ok(temp) = tempfile::Builder::new()
        .prefix("imgconvert-import-fuzz-")
        .tempdir()
    else {
        return;
    };
    build_bounded_tree(temp.path(), data);
    let _ = crate::import::scan_import_paths(
        ScanImportOptions {
            paths: vec![temp.path().to_string_lossy().to_string()],
            recursive: data[0] & 1 == 0,
            max_files: Some(usize::from(data[0] % 16) + 1),
            max_entries: Some(usize::from(data.get(1).copied().unwrap_or(0) % 32) + 1),
            max_depth: Some(usize::from(data.get(2).copied().unwrap_or(0) % 6) + 1),
        },
        tokio_util::sync::CancellationToken::new(),
    );
}

/// Cargo-fuzz bridge for the production PDF parser and bounded page
/// validation. Rendering stays out of the per-input loop so malformed
/// documents remain cheap enough for deterministic CI replay.
pub fn fuzz_pdf_document(bytes: &[u8]) {
    if bytes.len() <= MAX_PDF_BYTES {
        crate::pdf::fuzz_document_bytes(bytes);
    }
}

fn build_bounded_tree(root: &Path, data: &[u8]) {
    let mut cursor = 1;
    let count = usize::from(data[0])
        .min(MAX_SYNTHETIC_ENTRIES)
        .min(data.len().saturating_sub(1));
    for index in 0..count {
        if cursor >= data.len() {
            break;
        }
        let selector = data[cursor];
        cursor = cursor.saturating_add(1);
        let depth = usize::from(selector >> 5).min(4);
        let mut parent = root.to_path_buf();
        for level in 0..depth {
            parent.push(format!("d{index}-{level}"));
        }
        if fs::create_dir_all(&parent).is_err() {
            continue;
        }

        let extension = match selector & 0b1111 {
            0 => "png",
            1 => "jpg",
            2 => "webp",
            3 => "avif",
            4 => "svg",
            5 => "gif",
            6 => "bmp",
            7 => "pdf",
            _ => "txt",
        };
        let file = parent.join(format!("f{index}.{extension}"));
        let remaining = data.len().saturating_sub(cursor);
        let selectors_to_reserve = count.saturating_sub(index.saturating_add(1));
        let payload_len = remaining.saturating_sub(selectors_to_reserve).min(32);
        let end = cursor.saturating_add(payload_len).min(data.len());
        let _ = fs::write(file, &data[cursor..end]);
        cursor = end;
    }

    #[cfg(unix)]
    if data[0] & 0b10 != 0 {
        use std::os::unix::fs::symlink;

        let _ = symlink(root, root.join("directory-loop"));
        let _ = symlink(root.join("missing.png"), root.join("dangling.png"));
    }
}
