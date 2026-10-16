// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Thumbnail decoding for the queue rows.
//!
//! The backend renders a bounded PNG; this module turns it into the BGRA
//! frame GPUI paints directly (`ImageSource::Render`), mirroring GPUI's own
//! static-image decoder so colours match images loaded through its asset
//! system. The model keeps the decoded frames under a byte budget and hands
//! evicted images back so the view can release their GPU textures.

use std::io::Cursor;
use std::sync::Arc;

use gpui_kit::RenderImage;
use image::{DynamicImage, Frame, ImageReader};
use imgconvert_backend::thumbnail::{self, ThumbnailOptions};

/// Longest edge requested from the backend. Rows show thumbnails at 2.5 rem,
/// so 96 px covers 2x displays at the default base font.
pub const THUMBNAIL_EDGE: u32 = 96;

/// Decodes PNG bytes into a GPUI render image (BGRA, straight alpha).
pub fn decode_png(bytes: &[u8]) -> Result<Arc<RenderImage>, String> {
    let decoded = ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png)
        .decode()
        .map_err(|error| format!("thumbnail decode failed: {error}"))?;
    Ok(render_image_from(decoded))
}

fn render_image_from(image: DynamicImage) -> Arc<RenderImage> {
    let mut data = image.into_rgba8();
    for pixel in data.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    Arc::new(RenderImage::new(vec![Frame::new(data)]))
}

/// Generates and decodes the thumbnail for `input`. Runs on a background
/// thread; `Ok(None)` means the backend has no raster preview for the file.
pub fn load_thumbnail(input: String) -> Result<Option<Arc<RenderImage>>, String> {
    let result = thumbnail::generate_thumbnail(ThumbnailOptions {
        input,
        max_edge: Some(THUMBNAIL_EDGE),
    })?;
    match result {
        Some(thumbnail) if thumbnail.mime == "image/png" => decode_png(&thumbnail.bytes).map(Some),
        Some(thumbnail) => Err(format!("unexpected thumbnail format {}", thumbnail.mime)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    #[test]
    fn decoded_thumbnails_are_bgra_frames_of_the_source_size() {
        let mut png = Vec::new();
        let source: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(3, 2, Rgba([10, 20, 30, 255]));
        DynamicImage::ImageRgba8(source)
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let rendered = decode_png(&png).unwrap();
        assert_eq!(rendered.frame_count(), 1);
        let size = rendered.size(0);
        assert_eq!((size.width.0, size.height.0), (3, 2));
        let bytes = rendered.as_bytes(0).unwrap();
        assert_eq!(&bytes[..4], &[30, 20, 10, 255]);
    }

    #[test]
    fn garbage_is_rejected_with_a_message() {
        assert!(decode_png(b"not a png").unwrap_err().contains("decode"));
    }
}
