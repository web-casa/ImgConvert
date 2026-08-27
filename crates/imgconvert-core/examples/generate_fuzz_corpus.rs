// SPDX-License-Identifier: Apache-2.0

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use imgconvert_core::{codec_for, AvifSubsample, EncodeOptions, Format, ImageData};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out_root = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("fuzz/corpus"));
    let decode_dir = out_root.join("decode_pipeline");
    let convert_dir = out_root.join("convert_pipeline");
    let metadata_dir = out_root.join("metadata_semantics");
    fs::create_dir_all(&decode_dir)?;
    fs::create_dir_all(&convert_dir)?;
    fs::create_dir_all(&metadata_dir)?;

    let fixtures = [
        ("alpha-gradient", alpha_gradient(32, 24)?),
        ("photo-like", photo_like(40, 28)?),
        ("hard-edges", hard_edges(32, 32)?),
    ];
    for (name, image) in fixtures {
        for format in [Format::Png, Format::Jpeg, Format::WebP, Format::Avif] {
            let encoded = codec_for(format).encode(&image, &seed_options(format))?;
            let file_name = format!("{name}.{}", format.default_extension());
            write_seed(&decode_dir.join(&file_name), &encoded)?;
            write_seed(&convert_dir.join(&file_name), &encoded)?;
        }
    }

    for (name, bytes) in [
        ("vector.svg", simple_svg()),
        ("static.gif", static_gif()),
        // A multi-frame GIF is a valid input shape but intentionally unsupported;
        // keep it in both targets to guard against a future first-frame fallback.
        ("animated.gif", animated_gif()),
        ("one-pixel.bmp", one_pixel_bmp()?),
    ] {
        write_seed(&decode_dir.join(name), &bytes)?;
        write_seed(&convert_dir.join(name), &bytes)?;
    }

    write_seed(
        &decode_dir.join("truncated-png.bin"),
        b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR",
    )?;
    write_seed(
        &decode_dir.join("truncated-jpeg.bin"),
        &[0xff, 0xd8, 0xff, 0xe1, 0, 8],
    )?;
    write_seed(
        &decode_dir.join("truncated-webp.bin"),
        b"RIFF\x10\0\0\0WEBPVP8 ",
    )?;
    write_seed(
        &decode_dir.join("truncated-avif.bin"),
        b"\0\0\0\x18ftypavif\0\0\0\0",
    )?;

    write_seed(
        &metadata_dir.join("exif-orientation.tiff"),
        &exif_orientation(6),
    )?;
    write_seed(&metadata_dir.join("iptc-iim.bin"), &iptc_fixture())?;
    write_seed(
        &metadata_dir.join("xmp-orientation-history.xml"),
        XMP_ORIENTATION_HISTORY.as_bytes(),
    )?;

    println!("generated fuzz corpus seeds in {}", out_root.display());
    Ok(())
}

fn write_seed(path: &Path, bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    fs::write(path, bytes)?;
    Ok(())
}

fn seed_options(format: Format) -> EncodeOptions {
    EncodeOptions {
        quality: 82,
        lossless: matches!(format, Format::Png | Format::WebP | Format::Avif),
        png_oxipng_level: 0,
        webp_method: 0,
        avif_speed: 10,
        avif_subsample: AvifSubsample::Yuv444,
        ..EncodeOptions::default()
    }
}

fn simple_svg() -> Vec<u8> {
    br##"<svg xmlns="http://www.w3.org/2000/svg" width="6" height="4"><rect width="6" height="4" fill="#f06"/></svg>"##.to_vec()
}

fn static_gif() -> Vec<u8> {
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02L\x01\x00;".to_vec()
}

fn animated_gif() -> Vec<u8> {
    let mut gif = static_gif();
    assert_eq!(gif.pop(), Some(b';'));
    gif.extend_from_slice(b",\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02L\x01\x00;");
    gif
}

fn one_pixel_bmp() -> Result<Vec<u8>, image::ImageError> {
    let mut bmp = Vec::new();
    image::codecs::bmp::BmpEncoder::new(&mut bmp).encode(
        &[255, 0, 0, 255],
        1,
        1,
        image::ExtendedColorType::Rgba8,
    )?;
    Ok(bmp)
}

fn alpha_gradient(width: u32, height: u32) -> Result<ImageData, imgconvert_core::Error> {
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
    ImageData::new(width, height, rgba)
}

fn photo_like(width: u32, height: u32) -> Result<ImageData, imgconvert_core::Error> {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    let max_x = width.saturating_sub(1).max(1);
    let max_y = height.saturating_sub(1).max(1);
    for y in 0..height {
        for x in 0..width {
            let grain = ((x * 37 + y * 53 + (x ^ y) * 11) & 0x1f) as u8;
            rgba.extend_from_slice(&[
                (((x * 220) / max_x) as u8).saturating_add(grain),
                (((y * 210) / max_y) as u8).saturating_add(grain / 2),
                (((x + y) * 120 / (max_x + max_y)) as u8).saturating_add(80),
                255,
            ]);
        }
    }
    ImageData::new(width, height, rgba)
}

fn hard_edges(width: u32, height: u32) -> Result<ImageData, imgconvert_core::Error> {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let [r, g, b] = match (x < width / 2, y < height / 2) {
                (true, true) => [255, 255, 255],
                (false, true) => [255, 0, 64],
                (true, false) => [0, 128, 255],
                (false, false) => [20, 20, 20],
            };
            rgba.extend_from_slice(&[r, g, b, 255]);
        }
    }
    ImageData::new(width, height, rgba)
}

fn exif_orientation(orientation: u16) -> Vec<u8> {
    let mut tiff = Vec::new();
    tiff.extend_from_slice(b"MM");
    tiff.extend_from_slice(&42u16.to_be_bytes());
    tiff.extend_from_slice(&8u32.to_be_bytes());
    tiff.extend_from_slice(&1u16.to_be_bytes());
    tiff.extend_from_slice(&0x0112u16.to_be_bytes());
    tiff.extend_from_slice(&3u16.to_be_bytes());
    tiff.extend_from_slice(&1u32.to_be_bytes());
    tiff.extend_from_slice(&orientation.to_be_bytes());
    tiff.extend_from_slice(&0u16.to_be_bytes());
    tiff.extend_from_slice(&0u32.to_be_bytes());
    tiff
}

fn iptc_fixture() -> Vec<u8> {
    let mut iptc = iptc_dataset(2, 5, b"ImgConvert fuzz seed");
    iptc.extend_from_slice(&iptc_dataset(2, 25, b"fuzz"));
    iptc
}

fn iptc_dataset(record: u8, dataset: u8, value: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(5 + value.len());
    bytes.push(0x1c);
    bytes.push(record);
    bytes.push(dataset);
    bytes.extend_from_slice(&(value.len() as u16).to_be_bytes());
    bytes.extend_from_slice(value);
    bytes
}

const XMP_ORIENTATION_HISTORY: &str = r#"<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:t="http://ns.adobe.com/tiff/1.0/" xmlns:mm="http://ns.adobe.com/xap/1.0/mm/" t:Orientation="6"><mm:History><rdf:Seq><rdf:li>edited</rdf:li></rdf:Seq></mm:History></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>"#;
