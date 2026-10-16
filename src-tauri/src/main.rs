// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri_app_lib::perf_probe_init();
    tauri_app_lib::perf_probe_mark_native("main_start", None);
    if std::env::var_os("IMGCONVERT_PATH_CONVERT_SMOKE").is_some() {
        if let Err(error) = run_path_conversion_smoke() {
            eprintln!("imgconvert path conversion smoke failed: {error}");
            std::process::exit(70);
        }
        return;
    }
    if std::env::var_os("IMGCONVERT_PACKAGE_CONVERT_SMOKE").is_some() {
        if let Err(error) = run_package_conversion_smoke() {
            eprintln!("imgconvert package conversion smoke failed: {error}");
            std::process::exit(70);
        }
        return;
    }
    if std::env::var_os("IMGCONVERT_PLATFORM_BENCHMARK").is_some()
        || std::env::var_os("IMGCONVERT_AVIF_BENCHMARK").is_some()
    {
        if let Err(error) = run_platform_benchmark() {
            eprintln!("imgconvert platform benchmark failed: {error}");
            std::process::exit(70);
        }
        return;
    }
    tauri_app_lib::perf_probe_mark_native("rust_run", None);
    tauri_app_lib::run()
}

fn run_package_conversion_smoke() -> Result<(), String> {
    use imgconvert_core::{codec_for, convert, EncodeOptions, Format, ImageData};

    let source = ImageData::new(16, 16, smoke_rgba()).map_err(|error| error.to_string())?;
    let source_png = codec_for(Format::Png)
        .encode(&source, &EncodeOptions::default())
        .map_err(|error| error.to_string())?;
    let formats = smoke_formats()?;
    let out_dir = smoke_output_dir()?;
    let mut verified = Vec::new();

    for format in formats {
        let options = EncodeOptions {
            quality: 82,
            avif_speed: 10,
            ..Default::default()
        };
        let encoded = convert(&source_png, format, &options).map_err(|error| error.to_string())?;
        if Format::from_magic(&encoded) != Some(format) {
            return Err(format!("{} output magic mismatch", format.id()));
        }
        let probe = imgconvert_core::probe(&encoded).map_err(|error| error.to_string())?;
        if probe.width != 16 || probe.height != 16 {
            return Err(format!(
                "{} output dimensions mismatch: {}x{}",
                format.id(),
                probe.width,
                probe.height
            ));
        }
        let output = out_dir.join(format!("smoke.{}", format.default_extension()));
        std::fs::write(&output, encoded)
            .map_err(|error| format!("write {} failed: {error}", output.display()))?;
        verified.push(format.id());
    }

    println!(
        "imgconvert package conversion smoke passed: {}",
        verified.join(",")
    );
    Ok(())
}

fn smoke_rgba() -> Vec<u8> {
    let mut rgba = Vec::with_capacity(16 * 16 * 4);
    for y in 0..16u8 {
        for x in 0..16u8 {
            rgba.extend_from_slice(&[
                x.saturating_mul(16),
                y.saturating_mul(16),
                x.wrapping_add(y).saturating_mul(8),
                255,
            ]);
        }
    }
    rgba
}

fn smoke_formats() -> Result<Vec<imgconvert_core::Format>, String> {
    let raw = std::env::var("IMGCONVERT_PACKAGE_CONVERT_SMOKE_FORMATS")
        .unwrap_or_else(|_| "jpeg,webp,png,avif".to_string());
    let mut formats = Vec::new();
    for item in raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        let format = parse_smoke_format(item)?;
        if !formats.contains(&format) {
            formats.push(format);
        }
    }
    if formats.is_empty() {
        return Err("no smoke formats requested".to_string());
    }
    Ok(formats)
}

fn parse_smoke_format(value: &str) -> Result<imgconvert_core::Format, String> {
    match value.to_ascii_lowercase().as_str() {
        "jpeg" | "jpg" => Ok(imgconvert_core::Format::Jpeg),
        "png" => Ok(imgconvert_core::Format::Png),
        "webp" => Ok(imgconvert_core::Format::WebP),
        "avif" => Ok(imgconvert_core::Format::Avif),
        other => Err(format!("unsupported smoke format: {other}")),
    }
}

fn smoke_output_dir() -> Result<std::path::PathBuf, String> {
    let dir = std::env::var_os("IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::temp_dir().join(format!("imgconvert-package-smoke-{}", std::process::id()))
        });
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("create smoke output dir {} failed: {error}", dir.display()))?;
    Ok(dir)
}

fn run_path_conversion_smoke() -> Result<(), String> {
    let input = std::env::var("IMGCONVERT_PATH_CONVERT_SMOKE_INPUT")
        .map_err(|_| "IMGCONVERT_PATH_CONVERT_SMOKE_INPUT is required".to_string())?;
    let format =
        std::env::var("IMGCONVERT_PATH_CONVERT_SMOKE_FORMAT").unwrap_or_else(|_| "png".to_string());
    let target = parse_smoke_format(&format)?;
    let out_dir = path_smoke_output_dir()?;

    let result = tauri_app_lib::run_path_conversion_smoke(
        input,
        Some(out_dir.to_string_lossy().to_string()),
        format,
    )?;
    let output = std::path::PathBuf::from(&result.output);
    let bytes = std::fs::read(&output)
        .map_err(|error| format!("read smoke output {} failed: {error}", output.display()))?;
    if imgconvert_core::Format::from_magic(&bytes) != Some(target) {
        return Err(format!("{} output magic mismatch", target.id()));
    }
    let probe = imgconvert_core::probe(&bytes).map_err(|error| error.to_string())?;
    if probe.width == 0 || probe.height == 0 {
        return Err(format!("{} output has invalid dimensions", target.id()));
    }

    println!(
        "imgconvert path conversion smoke passed: input={} output={} format={} size={} dimensions={}x{}",
        result.input, result.output, target.id(), result.out_size, probe.width, probe.height
    );
    Ok(())
}

fn path_smoke_output_dir() -> Result<std::path::PathBuf, String> {
    let dir = std::env::var_os("IMGCONVERT_PATH_CONVERT_SMOKE_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::temp_dir().join(format!("imgconvert-path-smoke-{}", std::process::id()))
        });
    std::fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "create path smoke output dir {} failed: {error}",
            dir.display()
        )
    })?;
    Ok(dir)
}

const MAX_PLATFORM_BENCHMARK_PIXELS: u64 = 33_177_600;
const MAX_PLATFORM_BENCHMARK_ITERATIONS: u32 = 100;

fn run_platform_benchmark() -> Result<(), String> {
    use imgconvert_core::{codec_for, EncodeOptions, Format, ImageData};

    let legacy_avif = std::env::var_os("IMGCONVERT_AVIF_BENCHMARK").is_some()
        && std::env::var_os("IMGCONVERT_PLATFORM_BENCHMARK").is_none();
    let width = env_u32_first(
        &[
            "IMGCONVERT_PLATFORM_BENCHMARK_WIDTH",
            "IMGCONVERT_AVIF_BENCHMARK_WIDTH",
        ],
        1024,
    )?;
    let height = env_u32_first(
        &[
            "IMGCONVERT_PLATFORM_BENCHMARK_HEIGHT",
            "IMGCONVERT_AVIF_BENCHMARK_HEIGHT",
        ],
        768,
    )?;
    validate_benchmark_dimensions(width, height)?;
    let iterations = env_u32_first(
        &[
            "IMGCONVERT_PLATFORM_BENCHMARK_ITERATIONS",
            "IMGCONVERT_AVIF_BENCHMARK_ITERATIONS",
        ],
        3,
    )?
    .min(MAX_PLATFORM_BENCHMARK_ITERATIONS);
    let quality = env_u8_in_range("IMGCONVERT_PLATFORM_BENCHMARK_QUALITY", 82, 1, 100)?;
    let formats = env_benchmark_formats(if legacy_avif { "avif" } else { "avif,webp" })?;
    let avif_speeds = env_u8_list_first(
        &[
            "IMGCONVERT_PLATFORM_BENCHMARK_AVIF_SPEEDS",
            "IMGCONVERT_AVIF_BENCHMARK_SPEEDS",
        ],
        &[8, 10],
        10,
        "speed",
    )?;
    let webp_methods = env_u8_list_first(
        &["IMGCONVERT_PLATFORM_BENCHMARK_WEBP_METHODS"],
        &[4, 6],
        6,
        "method",
    )?;
    let source = ImageData::new(width, height, benchmark_rgba(width, height)?)
        .map_err(|error| error.to_string())?;
    let source_png = codec_for(Format::Png)
        .encode(&source, &EncodeOptions::default())
        .map_err(|error| error.to_string())?;

    println!(
        "{}",
        serde_json::json!({
            "event": "start",
            "width": width,
            "height": height,
            "iterations": iterations,
            "quality": quality,
            "formats": formats.iter().map(|format| format.id()).collect::<Vec<_>>(),
            "avifSpeeds": avif_speeds,
            "webpMethods": webp_methods,
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        })
    );

    for format in formats {
        match format {
            Format::Avif => {
                for speed in &avif_speeds {
                    for iteration in 1..=iterations {
                        let options = EncodeOptions {
                            quality,
                            avif_speed: *speed,
                            ..Default::default()
                        };
                        let sample = benchmark_convert_sample(&source_png, format, &options)?;
                        println!(
                            "{}",
                            serde_json::json!({
                                "event": "sample",
                                "format": format.id(),
                                "speed": speed,
                                "iteration": iteration,
                                "milliseconds": sample.milliseconds,
                                "megapixelsPerSecond": sample.megapixels_per_second(width, height),
                                "bytes": sample.bytes,
                                "quality": quality,
                            })
                        );
                    }
                }
            }
            Format::WebP => {
                for method in &webp_methods {
                    for iteration in 1..=iterations {
                        let options = EncodeOptions {
                            quality,
                            webp_method: *method,
                            ..Default::default()
                        };
                        let sample = benchmark_convert_sample(&source_png, format, &options)?;
                        println!(
                            "{}",
                            serde_json::json!({
                                "event": "sample",
                                "format": format.id(),
                                "method": method,
                                "iteration": iteration,
                                "milliseconds": sample.milliseconds,
                                "megapixelsPerSecond": sample.megapixels_per_second(width, height),
                                "bytes": sample.bytes,
                                "quality": quality,
                            })
                        );
                    }
                }
            }
            _ => return Err(format!("unsupported benchmark format: {}", format.id())),
        }
    }

    println!("{}", serde_json::json!({"event": "finished"}));
    Ok(())
}

struct BenchmarkSample {
    milliseconds: f64,
    bytes: usize,
}

impl BenchmarkSample {
    fn megapixels_per_second(&self, width: u32, height: u32) -> f64 {
        let megapixels = f64::from(width) * f64::from(height) / 1_000_000.0;
        if self.milliseconds > 0.0 {
            megapixels / (self.milliseconds / 1000.0)
        } else {
            0.0
        }
    }
}

fn benchmark_convert_sample(
    source_png: &[u8],
    format: imgconvert_core::Format,
    options: &imgconvert_core::EncodeOptions,
) -> Result<BenchmarkSample, String> {
    let started = std::time::Instant::now();
    let encoded =
        imgconvert_core::convert(source_png, format, options).map_err(|error| error.to_string())?;
    Ok(BenchmarkSample {
        milliseconds: started.elapsed().as_secs_f64() * 1000.0,
        bytes: encoded.len(),
    })
}

fn benchmark_rgba(width: u32, height: u32) -> Result<Vec<u8>, String> {
    validate_benchmark_dimensions(width, height)?;
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| usize::try_from(pixels).ok())
        .ok_or_else(|| "benchmark dimensions overflow".to_string())?;
    let mut rgba = Vec::with_capacity(
        pixels
            .checked_mul(4)
            .ok_or_else(|| "benchmark RGBA buffer overflow".to_string())?,
    );
    for y in 0..height {
        for x in 0..width {
            let gradient = ((x ^ y) & 0xff) as u8;
            rgba.extend_from_slice(&[
                ((u64::from(x) * 255) / u64::from(width)) as u8,
                ((u64::from(y) * 255) / u64::from(height)) as u8,
                gradient,
                255,
            ]);
        }
    }
    Ok(rgba)
}

fn validate_benchmark_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("benchmark dimensions must be positive".to_string());
    }
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| "benchmark dimensions overflow".to_string())?;
    if pixels > MAX_PLATFORM_BENCHMARK_PIXELS {
        return Err(format!(
            "benchmark image is too large: {pixels} pixels > {MAX_PLATFORM_BENCHMARK_PIXELS}"
        ));
    }
    Ok(())
}

fn env_u32_first(names: &[&str], default: u32) -> Result<u32, String> {
    for name in names {
        if std::env::var_os(name).is_some() {
            return env_u32(name, default);
        }
    }
    Ok(default)
}

fn env_u32(name: &str, default: u32) -> Result<u32, String> {
    match std::env::var(name) {
        Ok(value) => {
            let parsed = value
                .trim()
                .parse::<u32>()
                .map_err(|error| format!("{name} must be a positive integer: {error}"))?;
            if parsed == 0 {
                Err(format!("{name} must be a positive integer"))
            } else {
                Ok(parsed)
            }
        }
        Err(_) => Ok(default),
    }
}

fn env_u8_in_range(name: &str, default: u8, min: u8, max: u8) -> Result<u8, String> {
    let raw = match std::env::var(name) {
        Ok(value) => value,
        Err(_) => return Ok(default),
    };
    let value = raw
        .trim()
        .parse::<u8>()
        .map_err(|error| format!("{name} must be an integer {min}-{max}: {error}"))?;
    if (min..=max).contains(&value) {
        Ok(value)
    } else {
        Err(format!("{name} must be {min}-{max}: {value}"))
    }
}

fn env_u8_list_first(
    names: &[&str],
    default: &[u8],
    max: u8,
    label: &str,
) -> Result<Vec<u8>, String> {
    let Some((name, raw)) = names
        .iter()
        .find_map(|name| std::env::var(name).ok().map(|raw| (*name, raw)))
    else {
        return Ok(default.to_vec());
    };
    let mut values = Vec::new();
    for item in raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        let value = item
            .parse::<u8>()
            .map_err(|error| format!("{name} contains invalid {label} {item}: {error}"))?;
        if value > max {
            return Err(format!("{name} {label} must be 0-{max}: {value}"));
        }
        if !values.contains(&value) {
            values.push(value);
        }
    }
    if values.is_empty() {
        Err(format!("{name} must include at least one {label}"))
    } else {
        Ok(values)
    }
}

fn env_benchmark_formats(default: &str) -> Result<Vec<imgconvert_core::Format>, String> {
    let raw =
        std::env::var("IMGCONVERT_PLATFORM_BENCHMARK_FORMATS").unwrap_or_else(|_| default.into());
    let mut formats = Vec::new();
    for item in raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        let format = parse_smoke_format(item)?;
        if !matches!(
            format,
            imgconvert_core::Format::Avif | imgconvert_core::Format::WebP
        ) {
            return Err(format!("unsupported benchmark format: {}", format.id()));
        }
        if !formats.contains(&format) {
            formats.push(format);
        }
    }
    if formats.is_empty() {
        Err("IMGCONVERT_PLATFORM_BENCHMARK_FORMATS must include at least one format".to_string())
    } else {
        Ok(formats)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_format_parser_accepts_current_writable_formats() {
        assert_eq!(
            parse_smoke_format("jpg").unwrap(),
            imgconvert_core::Format::Jpeg
        );
        assert_eq!(
            parse_smoke_format("png").unwrap(),
            imgconvert_core::Format::Png
        );
        assert!(parse_smoke_format("heic").is_err());
    }

    #[test]
    fn benchmark_rgba_rejects_invalid_or_excessive_dimensions() {
        assert!(benchmark_rgba(0, 1).is_err());
        assert!(benchmark_rgba(64, 64).is_ok());
        assert!(validate_benchmark_dimensions(100_000, 100_000).is_err());
    }

    #[test]
    fn env_speeds_deduplicates_and_rejects_out_of_range_values() {
        const OK_ENV: &str = "IMGCONVERT_TEST_BENCH_SPEEDS_OK";
        const BAD_ENV: &str = "IMGCONVERT_TEST_BENCH_SPEEDS_BAD";

        std::env::set_var(OK_ENV, "8,10,8");
        std::env::set_var(BAD_ENV, "11");

        assert_eq!(
            env_u8_list_first(&[OK_ENV], &[6], 10, "speed").unwrap(),
            vec![8, 10]
        );
        assert!(env_u8_list_first(&[BAD_ENV], &[6], 10, "speed").is_err());

        std::env::remove_var(OK_ENV);
        std::env::remove_var(BAD_ENV);
    }

    #[test]
    fn benchmark_formats_are_limited_to_avif_and_webp() {
        const FORMATS_ENV: &str = "IMGCONVERT_PLATFORM_BENCHMARK_FORMATS";

        std::env::set_var(FORMATS_ENV, "avif,webp,avif");
        assert_eq!(
            env_benchmark_formats("avif").unwrap(),
            vec![imgconvert_core::Format::Avif, imgconvert_core::Format::WebP]
        );

        std::env::set_var(FORMATS_ENV, "jpeg");
        assert!(env_benchmark_formats("avif").is_err());

        std::env::remove_var(FORMATS_ENV);
    }
}
