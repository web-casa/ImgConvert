// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 The ImgConvert Authors

use imgconvert_core::{
    codec_for, convert, detect_lossy_artifacts, probe, thumbnail, AvifSubsample, EncodeOptions,
    Format, ImageData, MAX_PIXELS,
};

// A 3×2 Adobe CMYK JPEG generated from a simple red-to-blue gradient. Keeping
// it inline makes the decoder regression portable without a runtime image tool.
const ADOBE_CMYK_JPEG_BASE64: &str = concat!(
    "/9j/7gAOQWRvYmUAZAAAAAAC/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcG",
    "CAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQF",
    "BAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU",
    "FBQUFBQUFBQUFBQU/8AAFAgAAgADBAERAAIRAQMRAQQRAP/EABUAAQEAAAAAAAAA",
    "AAAAAAAAAAgJ/8QAGxAAAQQDAAAAAAAAAAAAAAAAAAIEBRZVlNH/xAAVAQEBAAAA",
    "AAAAAAAAAAAAAAADCf/EABsRAAAHAQAAAAAAAAAAAAAAAAADBhZVk9IE/9oADgQB",
    "AAIRAxEEAAA/AHtXorGM9dHCcb8Vst03m6DMtMRhFJeRVM//2Q==",
);

#[test]
fn golden_lossless_formats_roundtrip_pixels_exactly() {
    let source = alpha_fixture(24, 18);
    let source_png = codec_for(Format::Png)
        .encode(&source, &EncodeOptions::default())
        .unwrap();

    for target in [Format::Png, Format::WebP, Format::Avif] {
        let options = lossless_options(target);
        let encoded = convert(&source_png, target, &options).unwrap();
        assert_eq!(Format::from_magic(&encoded), Some(target));

        let info = probe(&encoded).unwrap();
        assert_eq!((info.width, info.height), (source.width, source.height));

        let decoded = codec_for(target).decode(&encoded).unwrap();
        assert_eq!(
            decoded.rgba8().unwrap(),
            source.rgba8().unwrap(),
            "{target:?} changed pixels in lossless quality golden"
        );
    }
}

#[test]
fn golden_lossy_formats_stay_above_quality_floor() {
    let source = opaque_smooth_fixture(64, 48);
    let source_png = codec_for(Format::Png)
        .encode(&source, &EncodeOptions::default())
        .unwrap();

    for target in [Format::Jpeg, Format::WebP, Format::Avif] {
        let encoded = convert(&source_png, target, &high_quality_lossy_options(target)).unwrap();
        assert_eq!(Format::from_magic(&encoded), Some(target));

        let decoded = codec_for(target).decode(&encoded).unwrap();
        assert_eq!(
            (decoded.width, decoded.height),
            (source.width, source.height)
        );
        let metrics = rgba_metrics(source.rgba8().unwrap(), decoded.rgba8().unwrap());
        assert!(
            metrics.psnr >= 30.0,
            "{target:?} PSNR regressed below floor: {metrics:?}"
        );
        assert!(
            metrics.mean_abs_error <= 8.0,
            "{target:?} MAE regressed above floor: {metrics:?}"
        );
    }
}

#[test]
fn corrupted_inputs_fail_cleanly_without_successful_outputs() {
    let cases = [
        ("empty", Vec::new()),
        ("random", b"not an image".to_vec()),
        (
            "truncated-png",
            b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0".to_vec(),
        ),
        ("truncated-jpeg", vec![0xff, 0xd8, 0xff, 0xe0, 0, 16]),
        ("truncated-webp", b"RIFF\x10\0\0\0WEBPVP8 ".to_vec()),
        ("truncated-avif", b"\0\0\0\x18ftypavif\0\0\0\0".to_vec()),
    ];

    for (name, bytes) in cases {
        assert!(probe(&bytes).is_err(), "{name} unexpectedly probed");
        assert!(
            thumbnail(&bytes, 128).is_err(),
            "{name} unexpectedly produced a thumbnail"
        );
        assert!(
            convert(&bytes, Format::Png, &EncodeOptions::default()).is_err(),
            "{name} unexpectedly converted"
        );
    }

    let huge_png = png_header_with_dimensions((MAX_PIXELS as u32 / 2) + 1, 2);
    let err = probe(&huge_png).unwrap_err();
    assert!(
        err.to_string().contains("超过上限"),
        "huge header should trip pixel budget, got {err:?}"
    );
}

#[test]
fn cmyk_jpeg_decodes_and_converts_without_panicking() {
    let source = decode_test_base64(ADOBE_CMYK_JPEG_BASE64);
    let info = probe(&source).unwrap();
    assert_eq!((info.format, info.width, info.height), (Format::Jpeg, 3, 2));

    let decoded = codec_for(Format::Jpeg).decode(&source).unwrap();
    assert_eq!((decoded.width, decoded.height), (3, 2));
    assert_eq!(decoded.rgba8().unwrap().len(), 3 * 2 * 4);

    let png = convert(&source, Format::Png, &EncodeOptions::default()).unwrap();
    assert_eq!(Format::from_magic(&png), Some(Format::Png));
    assert_eq!(probe(&png).unwrap().format, Format::Png);
}

#[test]
fn animated_webp_is_rejected_before_decode_or_thumbnail() {
    let animated = animated_webp_fixture();
    for (label, operation) in [
        ("probe", probe(&animated).map(|_| ())),
        ("thumbnail", thumbnail(&animated, 128).map(|_| ())),
        (
            "convert",
            convert(&animated, Format::Png, &EncodeOptions::default()).map(|_| ()),
        ),
    ] {
        let error = operation.expect_err(&format!("{label} must reject animated WebP"));
        assert!(
            error.to_string().contains("动画 WebP 暂不支持"),
            "{label} returned an unexpected error: {error}"
        );
    }
}

#[test]
fn ten_thousand_square_png_is_rejected_before_any_pixel_allocation() {
    let ten_thousand_square = png_header_with_dimensions(10_000, 10_000);
    let error = probe(&ten_thousand_square).unwrap_err();
    assert!(
        error.to_string().contains("超过上限"),
        "10000×10000 PNG must trip the decoded-pixel ceiling, got {error}"
    );
}

#[test]
fn deterministic_quality_outputs_are_byte_stable() {
    let source = opaque_smooth_fixture(32, 24);
    let source_png = codec_for(Format::Png)
        .encode(&source, &EncodeOptions::default())
        .unwrap();
    let cases = [
        ("png", Format::Png, EncodeOptions::default()),
        (
            "jpeg-baseline",
            Format::Jpeg,
            EncodeOptions {
                quality: 90,
                jpeg_progressive: false,
                ..EncodeOptions::default()
            },
        ),
        (
            "webp-lossless",
            Format::WebP,
            EncodeOptions {
                lossless: true,
                webp_method: 0,
                ..EncodeOptions::default()
            },
        ),
        (
            "avif-lossless",
            Format::Avif,
            lossless_options(Format::Avif),
        ),
    ];

    for (name, target, options) in cases {
        let first = convert(&source_png, target, &options).unwrap();
        let second = convert(&source_png, target, &options).unwrap();
        assert_eq!(first, second, "{name} output is not byte deterministic");
    }
}

#[test]
fn quality_artifact_hint_detects_block_artifact_corpus_fixtures() {
    let smooth_png = codec_for(Format::Png)
        .encode(&opaque_smooth_fixture(64, 64), &EncodeOptions::default())
        .unwrap();
    assert_eq!(detect_lossy_artifacts(&smooth_png).unwrap(), None);

    let grid_png = codec_for(Format::Png)
        .encode(&jpeg_grid_fixture(64, 64), &EncodeOptions::default())
        .unwrap();
    let hint = detect_lossy_artifacts(&grid_png).unwrap();
    assert!(
        hint.is_some(),
        "JPEG-grid corpus fixture should trigger lossy artifact hint"
    );

    let webp_like_png = codec_for(Format::Png)
        .encode(&webp_like_block_fixture(64, 64), &EncodeOptions::default())
        .unwrap();
    let hint = detect_lossy_artifacts(&webp_like_png).unwrap();
    assert!(
        hint.is_some_and(|hint| hint.webp_block_score >= 1.5),
        "WebP-like block corpus fixture should trigger lossy artifact hint"
    );

    let chroma_grid_png = codec_for(Format::Png)
        .encode(&jpeg_chroma_grid_fixture(64, 64), &EncodeOptions::default())
        .unwrap();
    let hint = detect_lossy_artifacts(&chroma_grid_png).unwrap();
    assert!(
        hint.is_some_and(|hint| hint.jpeg_chroma_grid_score >= 1.5),
        "JPEG chroma-grid corpus fixture should trigger lossy artifact hint"
    );
}

fn lossless_options(target: Format) -> EncodeOptions {
    let mut options = EncodeOptions {
        quality: 100,
        lossless: true,
        png_oxipng_level: 0,
        webp_method: 0,
        avif_speed: 10,
        avif_subsample: AvifSubsample::Yuv420,
        ..EncodeOptions::default()
    };
    if target == Format::Png {
        options.lossless = false;
    }
    options
}

fn high_quality_lossy_options(target: Format) -> EncodeOptions {
    let mut options = EncodeOptions {
        quality: 92,
        lossless: false,
        jpeg_progressive: true,
        webp_method: 4,
        avif_speed: 10,
        avif_subsample: AvifSubsample::Yuv444,
        ..EncodeOptions::default()
    };
    if target == Format::Png {
        options.lossless = false;
    }
    options
}

#[derive(Debug)]
struct RgbaMetrics {
    mean_abs_error: f64,
    psnr: f64,
}

fn rgba_metrics(source: &[u8], decoded: &[u8]) -> RgbaMetrics {
    assert_eq!(source.len(), decoded.len());
    let mut abs_sum = 0u64;
    let mut squared_sum = 0f64;
    let mut samples = 0u64;

    for (left, right) in source.iter().zip(decoded) {
        let diff = left.abs_diff(*right);
        abs_sum += u64::from(diff);
        squared_sum += f64::from(diff).powi(2);
        samples += 1;
    }

    let mean_abs_error = abs_sum as f64 / samples as f64;
    let mean_squared_error = squared_sum / samples as f64;
    let psnr = if mean_squared_error == 0.0 {
        f64::INFINITY
    } else {
        20.0 * (255.0 / mean_squared_error.sqrt()).log10()
    };
    RgbaMetrics {
        mean_abs_error,
        psnr,
    }
}

fn alpha_fixture(width: u32, height: u32) -> ImageData {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            rgba.extend_from_slice(&[
                ((x * 17 + y * 3) & 0xff) as u8,
                ((x * 5 + y * 19) & 0xff) as u8,
                ((x * 11) ^ (y * 7)) as u8,
                (((x * 13 + y * 29) % 255) + 1) as u8,
            ]);
        }
    }
    ImageData::new(width, height, rgba).unwrap()
}

fn opaque_smooth_fixture(width: u32, height: u32) -> ImageData {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    let max_x = width.saturating_sub(1).max(1);
    let max_y = height.saturating_sub(1).max(1);
    let max_xy = max_x + max_y;
    for y in 0..height {
        for x in 0..width {
            rgba.extend_from_slice(&[
                ((x * 255) / max_x) as u8,
                ((y * 255) / max_y) as u8,
                (((x + y) * 255) / max_xy) as u8,
                255,
            ]);
        }
    }
    ImageData::new(width, height, rgba).unwrap()
}

fn jpeg_grid_fixture(width: u32, height: u32) -> ImageData {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let base = ((x + y) * 2).min(220) as u8;
            let block_bias = if ((x / 8) + (y / 8)) % 2 == 0 { 0 } else { 18 };
            let value = base.saturating_add(block_bias);
            rgba.extend_from_slice(&[value, value.saturating_add(2), value, 255]);
        }
    }
    ImageData::new(width, height, rgba).unwrap()
}

fn webp_like_block_fixture(width: u32, height: u32) -> ImageData {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let base = ((x * 3 + y * 2) % 180) as u8;
            let block_bias = if ((x / 4) + (y / 4)) % 2 == 0 { 0 } else { 16 };
            let value = base.saturating_add(block_bias);
            rgba.extend_from_slice(&[
                value,
                value.saturating_add((x % 4) as u8),
                value.saturating_add((y % 4) as u8),
                255,
            ]);
        }
    }
    ImageData::new(width, height, rgba).unwrap()
}

fn jpeg_chroma_grid_fixture(width: u32, height: u32) -> ImageData {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let local_chroma = ((x % 8) + (y % 3)) as u8;
            let odd_block = ((x / 8) + (y / 8)) % 2 == 1;
            let pixel = if odd_block {
                [
                    168u8.saturating_add(local_chroma),
                    96u8.saturating_add(y as u8 % 2),
                    120u8,
                    255,
                ]
            } else {
                [
                    120u8.saturating_add(local_chroma),
                    120u8,
                    120u8.saturating_add(y as u8 % 2),
                    255,
                ]
            };
            rgba.extend_from_slice(&pixel);
        }
    }
    ImageData::new(width, height, rgba).unwrap()
}

fn png_header_with_dimensions(width: u32, height: u32) -> Vec<u8> {
    let mut png = Vec::new();
    png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    png.extend_from_slice(&13u32.to_be_bytes());
    png.extend_from_slice(b"IHDR");
    png.extend_from_slice(&width.to_be_bytes());
    png.extend_from_slice(&height.to_be_bytes());
    png.extend_from_slice(&[8, 6, 0, 0, 0]);
    png.extend_from_slice(&0u32.to_be_bytes());
    png
}

fn animated_webp_fixture() -> Vec<u8> {
    let source = opaque_smooth_fixture(2, 2);
    let still = codec_for(Format::WebP)
        .encode(&source, &lossless_options(Format::WebP))
        .unwrap();
    assert!(still.starts_with(b"RIFF"));
    assert_eq!(&still[8..12], b"WEBP");

    let mut animated = b"RIFF\0\0\0\0WEBP".to_vec();
    let mut vp8x = vec![0u8; 10];
    vp8x[0] = 0x02; // animation flag in the VP8X feature bitfield
    write_u24_le(&mut vp8x[4..7], source.width - 1);
    write_u24_le(&mut vp8x[7..10], source.height - 1);
    write_webp_chunk(&mut animated, b"VP8X", &vp8x);
    write_webp_chunk(&mut animated, b"ANIM", &[0, 0, 0, 0, 0, 0]);

    let mut frame = vec![0u8; 16];
    write_u24_le(&mut frame[6..9], source.width - 1);
    write_u24_le(&mut frame[9..12], source.height - 1);
    write_u24_le(&mut frame[12..15], 100);
    frame.extend_from_slice(&still[12..]);
    write_webp_chunk(&mut animated, b"ANMF", &frame);
    let riff_size = u32::try_from(animated.len() - 8).unwrap();
    animated[4..8].copy_from_slice(&riff_size.to_le_bytes());
    animated
}

fn write_webp_chunk(output: &mut Vec<u8>, fourcc: &[u8; 4], data: &[u8]) {
    output.extend_from_slice(fourcc);
    output.extend_from_slice(&(data.len() as u32).to_le_bytes());
    output.extend_from_slice(data);
    if data.len() % 2 == 1 {
        output.push(0);
    }
}

fn write_u24_le(output: &mut [u8], value: u32) {
    output[0] = (value & 0xff) as u8;
    output[1] = ((value >> 8) & 0xff) as u8;
    output[2] = ((value >> 16) & 0xff) as u8;
}

fn decode_test_base64(input: &str) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let mut bits = 0u32;
    let mut bit_count = 0u8;
    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\r' | b'\n' | b' ' | b'\t' => continue,
            _ => panic!("invalid base64 byte in test fixture: {byte}"),
        };
        bits = (bits << 6) | u32::from(value);
        bit_count += 6;
        while bit_count >= 8 {
            bit_count -= 8;
            output.push((bits >> bit_count) as u8);
        }
    }
    output
}
