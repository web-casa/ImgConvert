// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Native clipboard reads. Call only on a background worker. File lists win
//! over bitmap previews, then bitmap pixels over text, on every platform.
//! Wayland requires data-control or the compositor's XWayland clipboard bridge.

use std::path::PathBuf;

use imgconvert_core::{codec_for, EncodeOptions, Format, ImageData};

#[derive(Debug)]
pub enum ClipboardContent {
    Files(Vec<PathBuf>),
    Png(Vec<u8>),
    Text(String),
    Empty,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ClipboardError {
    #[error("clipboard access is unavailable or busy")]
    Unavailable,
    #[error("clipboard image could not be read or exceeds the image limits")]
    InvalidImage,
}

/// Gets a fresh clipboard connection for one serialized import. No platform
/// object or GPUI context crosses threads. Content absence falls through to the
/// next representation; read errors must not silently select a different one.
pub fn read() -> Result<ClipboardContent, ClipboardError> {
    let mut clipboard = arboard::Clipboard::new().map_err(|_| ClipboardError::Unavailable)?;
    if let Some(paths) = available(clipboard.get().file_list(), ClipboardError::Unavailable)? {
        return Ok(ClipboardContent::Files(paths));
    }
    if let Some(image) = available(clipboard.get_image(), ClipboardError::InvalidImage)? {
        return png_from_pixels(image).map(ClipboardContent::Png);
    }
    if let Some(text) = available(clipboard.get_text(), ClipboardError::Unavailable)? {
        return Ok(ClipboardContent::Text(text));
    }
    Ok(ClipboardContent::Empty)
}

fn available<T>(
    result: Result<T, arboard::Error>,
    failure: ClipboardError,
) -> Result<Option<T>, ClipboardError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(_) => Err(failure),
    }
}

fn png_from_pixels(image: arboard::ImageData<'_>) -> Result<Vec<u8>, ClipboardError> {
    let width = u32::try_from(image.width).map_err(|_| ClipboardError::InvalidImage)?;
    let height = u32::try_from(image.height).map_err(|_| ClipboardError::InvalidImage)?;
    // The OS/library owns raster acquisition. Validate dimensions and length
    // before our own pixel copy and PNG encoding, using the core's 64 MP cap.
    imgconvert_core::validate_image_dimensions(width, height)
        .map_err(|_| ClipboardError::InvalidImage)?;
    if image.bytes.len() != image.width * image.height * 4 {
        return Err(ClipboardError::InvalidImage);
    }
    let image = ImageData::new(width, height, image.bytes.into_owned())
        .map_err(|_| ClipboardError::InvalidImage)?;
    let options = EncodeOptions {
        png_oxipng_level: 0,
        ..EncodeOptions::default()
    };
    codec_for(Format::Png)
        .encode(&image, &options)
        .map_err(|_| ClipboardError::InvalidImage)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::borrow::Cow;

    #[test]
    fn clipboard_pixels_preserve_rgba_and_reject_invalid_dimensions_or_length() {
        let rgba = vec![10, 20, 30, 128];
        let png = png_from_pixels(arboard::ImageData {
            width: 1,
            height: 1,
            bytes: Cow::Borrowed(&rgba),
        })
        .unwrap();
        let decoded = codec_for(Format::Png).decode(&png).unwrap();
        assert_eq!(decoded.rgba8().unwrap(), rgba);
        for (width, height, bytes) in [(0, 1, vec![]), (1, 1, vec![0]), (64_000_001, 1, vec![])] {
            assert_eq!(
                png_from_pixels(arboard::ImageData {
                    width,
                    height,
                    bytes: Cow::Owned(bytes)
                }),
                Err(ClipboardError::InvalidImage)
            );
        }
    }

    #[test]
    fn clipboard_errors_do_not_fall_through_as_missing_content() {
        assert_eq!(
            available::<()>(
                Err(arboard::Error::ContentNotAvailable),
                ClipboardError::Unavailable
            ),
            Ok(None)
        );
        assert_eq!(
            available::<()>(
                Err(arboard::Error::ClipboardOccupied),
                ClipboardError::Unavailable
            ),
            Err(ClipboardError::Unavailable)
        );
    }

    #[test]
    #[ignore = "requires an isolated native clipboard; run under xvfb-run on Linux"]
    fn native_clipboard_round_trips_files_bitmap_and_text() {
        let mut owner = arboard::Clipboard::new().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("clipboard photo.png");
        std::fs::write(&path, b"clipboard fixture").unwrap();
        let paths = vec![std::fs::canonicalize(path).unwrap()];
        owner.set().file_list(&paths).unwrap();
        let ClipboardContent::Files(actual) = read().unwrap() else {
            panic!("expected files");
        };
        // CF_HDROP removes the verbatim prefix on Windows. Compare canonical
        // paths instead of two valid spellings of the same file.
        let actual = actual
            .into_iter()
            .map(std::fs::canonicalize)
            .collect::<std::io::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(actual, paths);
        let rgba = vec![10, 20, 30, 128];
        owner
            .set_image(arboard::ImageData {
                width: 1,
                height: 1,
                bytes: Cow::Borrowed(&rgba),
            })
            .unwrap();
        let ClipboardContent::Png(png) = read().unwrap() else {
            panic!("expected bitmap");
        };
        assert_eq!(
            codec_for(Format::Png)
                .decode(&png)
                .unwrap()
                .rgba8()
                .unwrap(),
            rgba
        );
        owner.set_text("file:///tmp/a%20b.png").unwrap();
        assert!(
            matches!(read().unwrap(), ClipboardContent::Text(text) if text == "file:///tmp/a%20b.png")
        );
    }
}
