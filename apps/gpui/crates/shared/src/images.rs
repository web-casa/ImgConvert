// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Decoding backend PNG bytes into GPUI render images. Shared by thumbnails
//! and the comparison preview so both produce the same BGRA frames.

use std::io::Cursor;
use std::sync::Arc;

use gpui_kit::RenderImage;
use image::{DynamicImage, Frame, ImageReader};

/// Decodes PNG bytes into a GPUI render image (BGRA, straight alpha).
pub fn decode_png(bytes: &[u8]) -> Result<Arc<RenderImage>, String> {
    let decoded = ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png)
        .decode()
        .map_err(|error| format!("image decode failed: {error}"))?;
    Ok(render_image_from(decoded))
}

fn render_image_from(image: DynamicImage) -> Arc<RenderImage> {
    let mut data = image.into_rgba8();
    for pixel in data.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    Arc::new(RenderImage::new(vec![Frame::new(data)]))
}

/// Human-readable size with one decimal above 1 KB (the Svelte `fmtSize`).
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_format_like_the_svelte_shell() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(1023), "1023 B");
        assert_eq!(format_bytes(1024), "1.0 KB");
        assert_eq!(format_bytes(1_536_000), "1.5 MB");
    }
}
