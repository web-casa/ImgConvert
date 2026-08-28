// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Windows system codec bridge.
//!
//! HEIC stays outside the bundled Rust codec stack. On Windows we can use WIC
//! when the user's system has the Microsoft HEIF/HEVC media extensions
//! installed, without bundling libheif/x265 or changing the main app license
//! boundary.

use std::path::Path;

use crate::external_codecs::{
    validate_system_heic_dimensions, CodecProviderDiagnostic, CodecProviderInfo, DiagnosticMessage,
};

const HEIC_EXTENSIONS: &[&str] = &["heic", "heif", "hif"];
const WIC_PROVIDER_ID: &str = "windows-wic-heic";
const WIC_PROVIDER_KIND: &str = "system-wic";
const WIC_PROVIDER_PATH: &str = "Windows Imaging Component";

#[derive(Debug, Clone)]
pub struct WindowsSystemCodecDiagnostic {
    pub id: String,
    pub kind: String,
    pub available: bool,
    pub readable: Vec<String>,
    pub message: DiagnosticMessage,
    pub install_hint: Option<DiagnosticMessage>,
}

pub fn heic_available() -> bool {
    heic_status().available
}

pub fn heic_provider_info() -> Option<CodecProviderInfo> {
    heic_available().then(|| CodecProviderInfo {
        id: WIC_PROVIDER_ID.to_string(),
        kind: WIC_PROVIDER_KIND,
        license: None,
        readable: HEIC_EXTENSIONS
            .iter()
            .map(|extension| (*extension).to_string())
            .collect(),
        writable: Vec::new(),
    })
}

pub fn heic_provider_diagnostic() -> Option<CodecProviderDiagnostic> {
    heic_provider_info().map(|info| CodecProviderDiagnostic {
        id: info.id,
        kind: info.kind.to_string(),
        license: info.license,
        readable: info.readable,
        writable: info.writable,
        command: "WIC HEIF decoder".to_string(),
        path: WIC_PROVIDER_PATH.to_string(),
        args: Vec::new(),
    })
}

pub fn heic_system_diagnostic() -> WindowsSystemCodecDiagnostic {
    let status = heic_status();
    WindowsSystemCodecDiagnostic {
        id: WIC_PROVIDER_ID.to_string(),
        kind: WIC_PROVIDER_KIND.to_string(),
        available: status.available,
        readable: HEIC_EXTENSIONS
            .iter()
            .map(|extension| (*extension).to_string())
            .collect(),
        message: status.message,
        install_hint: (!status.available).then(|| DiagnosticMessage::new("windowsHeifInstallHint")),
    }
}

pub fn decode_heic_to_png(input: &Path) -> Result<Vec<u8>, String> {
    platform::decode_heic_to_png(input)
}

fn require_single_heic_frame(input: &Path, frame_count: usize) -> Result<(), String> {
    if frame_count == 1 {
        return Ok(());
    }
    Err(format!(
        "多帧 HEIC/HEIF 暂不支持（检测到 {frame_count} 帧，未转换以避免丢失帧）: {}",
        input.display()
    ))
}

fn heic_status() -> HeicStatus {
    platform::heic_status()
}

#[derive(Debug, Clone)]
struct HeicStatus {
    available: bool,
    message: DiagnosticMessage,
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use std::path::Path;

    use super::{DiagnosticMessage, HeicStatus};

    pub fn heic_status() -> HeicStatus {
        HeicStatus {
            available: false,
            message: DiagnosticMessage::new("wicUnsupportedPlatform"),
        }
    }

    pub fn decode_heic_to_png(input: &Path) -> Result<Vec<u8>, String> {
        Err(format!(
            "Windows WIC HEIC 解码仅在 Windows 可用: {}",
            input.display()
        ))
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::ffi::OsStr;
    use std::fs::{self, File};
    use std::io::Read;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use windows::core::{IUnknown, Interface, PCWSTR};
    use windows::Win32::Foundation::{GENERIC_READ, RPC_E_CHANGED_MODE, S_FALSE, S_OK};
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_ContainerFormatHeif, GUID_ContainerFormatPng,
        GUID_WICPixelFormat32bppBGRA, IWICBitmapDecoderInfo, IWICImagingFactory,
        WICBitmapDitherTypeNone, WICBitmapEncoderNoCache, WICBitmapPaletteTypeCustom,
        WICComponentEnumerateDefault, WICDecodeMetadataCacheOnDemand, WICDecoder,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED, STGM_CREATE, STGM_WRITE,
    };

    use crate::external_codecs::{is_heic_magic, MAX_HEIC_DECODED_PNG_BYTES};

    use super::{require_single_heic_frame, DiagnosticMessage, HeicStatus};

    static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct ComGuard {
        initialized: bool,
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.initialized {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    struct TempPng {
        directory: PathBuf,
        path: PathBuf,
    }

    impl Drop for TempPng {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    pub fn heic_status() -> HeicStatus {
        match detect_heic_decoder() {
            Ok(Some(decoder)) => HeicStatus {
                available: true,
                message: DiagnosticMessage::with_detail("wicAvailable", decoder),
            },
            Ok(None) => HeicStatus {
                available: false,
                message: DiagnosticMessage::new("wicMissing"),
            },
            Err(error) => HeicStatus {
                available: false,
                message: DiagnosticMessage::with_detail("wicProbeFailed", error),
            },
        }
    }

    pub fn decode_heic_to_png(input: &Path) -> Result<Vec<u8>, String> {
        validate_heic_header(input)?;
        let temp = create_temp_png()?;
        decode_heic_to_png_file(input, &temp.path)?;
        read_limited_png(&temp.path)
    }

    fn detect_heic_decoder() -> Result<Option<String>, String> {
        unsafe {
            let _com = init_com()?;
            let factory = wic_factory()?;
            let enumerator = factory
                .CreateComponentEnumerator(
                    WICDecoder.0 as u32,
                    WICComponentEnumerateDefault.0 as u32,
                )
                .map_err(|error| format!("unable to enumerate WIC decoders: {error}"))?;

            loop {
                let mut fetched = 0u32;
                let mut item = [None];
                let hr = enumerator.Next(&mut item, Some(&mut fetched));
                if hr == S_FALSE || fetched == 0 {
                    break;
                }
                hr.ok().map_err(|error| {
                    format!("unable to advance WIC decoder enumeration: {error}")
                })?;
                let Some(unknown) = item[0].take() else {
                    continue;
                };
                let Ok(info) = unknown.cast::<IWICBitmapDecoderInfo>() else {
                    continue;
                };
                if decoder_supports_heif(&info)? {
                    return Ok(Some(decoder_label(&info)));
                }
            }
        }

        Ok(None)
    }

    unsafe fn decoder_supports_heif(info: &IWICBitmapDecoderInfo) -> Result<bool, String> {
        let container = info
            .GetContainerFormat()
            .map_err(|error| format!("unable to read WIC decoder container format: {error}"))?;
        if container == GUID_ContainerFormatHeif {
            return Ok(true);
        }

        let mime_types = wic_string(|buffer, actual| info.GetMimeTypes(buffer, actual))
            .unwrap_or_default()
            .to_ascii_lowercase();
        let extensions = wic_string(|buffer, actual| info.GetFileExtensions(buffer, actual))
            .unwrap_or_default()
            .to_ascii_lowercase();
        Ok(mime_types.contains("image/heic")
            || mime_types.contains("image/heif")
            || extensions
                .split(',')
                .map(str::trim)
                .any(|extension| matches!(extension, ".heic" | ".heif" | ".hif")))
    }

    unsafe fn decoder_label(info: &IWICBitmapDecoderInfo) -> String {
        let friendly_name =
            wic_string(|buffer, actual| info.GetFriendlyName(buffer, actual)).unwrap_or_default();
        if friendly_name.trim().is_empty() {
            "WIC HEIF decoder".to_string()
        } else {
            friendly_name
        }
    }

    fn decode_heic_to_png_file(input: &Path, output: &Path) -> Result<(), String> {
        unsafe {
            let _com = init_com()?;
            let factory = wic_factory()?;
            let input_w = wide_path(input);
            let decoder = factory
                .CreateDecoderFromFilename(
                    PCWSTR(input_w.as_ptr()),
                    None,
                    GENERIC_READ,
                    WICDecodeMetadataCacheOnDemand,
                )
                .map_err(|error| {
                    format!(
                        "Windows WIC 无法创建 HEIC decoder {}: {error}",
                        input.display()
                    )
                })?;
            let frame_count = decoder
                .GetFrameCount()
                .map_err(|error| format!("Windows WIC 无法读取 HEIC 帧数: {error}"))?;
            require_single_heic_frame(input, frame_count as usize)?;
            let frame = decoder
                .GetFrame(0)
                .map_err(|error| format!("Windows WIC 无法读取 HEIC 首帧: {error}"))?;
            let mut width = 0u32;
            let mut height = 0u32;
            frame
                .GetSize(&mut width, &mut height)
                .map_err(|error| format!("Windows WIC 无法读取 HEIC 尺寸: {error}"))?;
            super::validate_system_heic_dimensions(width, height)?;

            let converter = factory
                .CreateFormatConverter()
                .map_err(|error| format!("Windows WIC 无法创建格式转换器: {error}"))?;
            converter
                .Initialize(
                    &frame,
                    &GUID_WICPixelFormat32bppBGRA,
                    WICBitmapDitherTypeNone,
                    None::<&windows::Win32::Graphics::Imaging::IWICPalette>,
                    0.0,
                    WICBitmapPaletteTypeCustom,
                )
                .map_err(|error| format!("Windows WIC 无法转换 HEIC 像素格式: {error}"))?;

            let output_w = wide_path(output);
            let stream = factory
                .CreateStream()
                .map_err(|error| format!("Windows WIC 无法创建 PNG 输出流: {error}"))?;
            stream
                .InitializeFromFilename(PCWSTR(output_w.as_ptr()), (STGM_CREATE | STGM_WRITE).0)
                .map_err(|error| {
                    format!(
                        "Windows WIC 无法打开 PNG 输出 {}: {error}",
                        output.display()
                    )
                })?;

            let encoder = factory
                .CreateEncoder(&GUID_ContainerFormatPng, std::ptr::null())
                .map_err(|error| format!("Windows WIC 无法创建 PNG encoder: {error}"))?;
            encoder
                .Initialize(&stream, WICBitmapEncoderNoCache)
                .map_err(|error| format!("Windows WIC 无法初始化 PNG encoder: {error}"))?;

            let mut frame_encode = None;
            let mut encoder_options = None;
            encoder
                .CreateNewFrame(&mut frame_encode, &mut encoder_options)
                .map_err(|error| format!("Windows WIC 无法创建 PNG 帧: {error}"))?;
            let frame_encode = frame_encode.ok_or_else(|| "Windows WIC PNG 帧为空".to_string())?;
            frame_encode
                .Initialize(encoder_options.as_ref())
                .map_err(|error| format!("Windows WIC 无法初始化 PNG 帧: {error}"))?;
            frame_encode
                .SetSize(width, height)
                .map_err(|error| format!("Windows WIC 无法设置 PNG 尺寸: {error}"))?;
            let mut pixel_format = GUID_WICPixelFormat32bppBGRA;
            frame_encode
                .SetPixelFormat(&mut pixel_format)
                .map_err(|error| format!("Windows WIC 无法设置 PNG 像素格式: {error}"))?;
            frame_encode
                .WriteSource(&converter, std::ptr::null())
                .map_err(|error| format!("Windows WIC 无法写入 PNG 像素: {error}"))?;
            frame_encode
                .Commit()
                .map_err(|error| format!("Windows WIC 无法提交 PNG 帧: {error}"))?;
            encoder
                .Commit()
                .map_err(|error| format!("Windows WIC 无法提交 PNG 输出: {error}"))?;
        }

        Ok(())
    }

    unsafe fn init_com() -> Result<ComGuard, String> {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr == S_OK || hr == S_FALSE {
            return Ok(ComGuard { initialized: true });
        }
        if hr == RPC_E_CHANGED_MODE {
            return Ok(ComGuard { initialized: false });
        }
        Err(format!("COM initialization failed: {hr:?}"))
    }

    unsafe fn wic_factory() -> Result<IWICImagingFactory, String> {
        CoCreateInstance::<_, IWICImagingFactory>(
            &CLSID_WICImagingFactory,
            None::<&IUnknown>,
            CLSCTX_INPROC_SERVER,
        )
        .map_err(|error| format!("unable to create WIC imaging factory: {error}"))
    }

    unsafe fn wic_string<F>(mut read: F) -> Result<String, String>
    where
        F: FnMut(&mut [u16], *mut u32) -> windows::core::Result<()>,
    {
        let mut actual = 0u32;
        let mut buffer = vec![0u16; 512];
        read(&mut buffer, &mut actual).map_err(|error| format!("读取 WIC 字符串失败: {error}"))?;
        if actual as usize > buffer.len() {
            buffer.resize(actual as usize, 0);
            read(&mut buffer, &mut actual)
                .map_err(|error| format!("读取 WIC 字符串失败: {error}"))?;
        }
        let actual = actual as usize;
        let len = actual.min(buffer.len());
        let trimmed = if len > 0 && buffer[len - 1] == 0 {
            &buffer[..len - 1]
        } else {
            &buffer[..len]
        };
        Ok(String::from_utf16_lossy(trimmed))
    }

    fn validate_heic_header(input: &Path) -> Result<(), String> {
        let mut file = File::open(input)
            .map_err(|error| format!("无法读取 HEIC 输入 {}: {error}", input.display()))?;
        let mut header = [0u8; 64];
        let len = file
            .read(&mut header)
            .map_err(|error| format!("无法读取 HEIC 文件头 {}: {error}", input.display()))?;
        if !is_heic_magic(&header[..len]) {
            return Err(format!(
                "输入文件扩展名为 HEIC/HEIF,但文件头不是受支持的 HEIF/HEIC: {}",
                input.display()
            ));
        }
        Ok(())
    }

    fn read_limited_png(output: &Path) -> Result<Vec<u8>, String> {
        let metadata = fs::metadata(output).map_err(|error| {
            format!(
                "无法读取 Windows WIC PNG 输出 {}: {error}",
                output.display()
            )
        })?;
        if !metadata.is_file() {
            return Err(format!(
                "Windows WIC PNG 输出不是普通文件: {}",
                output.display()
            ));
        }
        if metadata.len() > MAX_HEIC_DECODED_PNG_BYTES as u64 {
            return Err(format!(
                "Windows WIC PNG 输出超过上限 {} bytes: {}",
                MAX_HEIC_DECODED_PNG_BYTES,
                output.display()
            ));
        }
        // Keep the post-encode read bounded as well. The metadata check is a
        // fast path, but the output can still change between that check and
        // opening the file.
        let file = File::open(output).map_err(|error| {
            format!(
                "无法读取 Windows WIC PNG 输出 {}: {error}",
                output.display()
            )
        })?;
        let mut reader = file.take(MAX_HEIC_DECODED_PNG_BYTES as u64 + 1);
        let mut bytes =
            Vec::with_capacity(metadata.len().min(MAX_HEIC_DECODED_PNG_BYTES as u64) as usize);
        reader.read_to_end(&mut bytes).map_err(|error| {
            format!(
                "无法读取 Windows WIC PNG 输出 {}: {error}",
                output.display()
            )
        })?;
        if bytes.len() > MAX_HEIC_DECODED_PNG_BYTES {
            return Err(format!(
                "Windows WIC PNG 输出超过上限 {} bytes: {}",
                MAX_HEIC_DECODED_PNG_BYTES,
                output.display()
            ));
        }
        Ok(bytes)
    }

    fn create_temp_png() -> Result<TempPng, String> {
        let root = std::env::temp_dir().join("ImgConvert").join("wic-heic");
        fs::create_dir_all(&root).map_err(|error| {
            format!("无法创建 Windows WIC 临时目录 {}: {error}", root.display())
        })?;
        let pid = std::process::id();
        for _ in 0..64 {
            let counter = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            let directory = root.join(format!("imgconvert-wic-{pid}-{nanos}-{counter}"));
            match fs::create_dir(&directory) {
                Ok(()) => {
                    return Ok(TempPng {
                        path: directory.join("decoded.png"),
                        directory,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!(
                        "无法创建 Windows WIC 临时目录 {}: {error}",
                        directory.display()
                    ));
                }
            }
        }
        Err("无法创建唯一 Windows WIC 临时输出目录".to_string())
    }

    fn wide_path(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    #[allow(dead_code)]
    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn wic_png_uses_an_atomically_created_unique_directory() {
            let temp = create_temp_png().unwrap();
            let directory = temp.directory.clone();

            assert!(directory.is_dir());
            assert_eq!(temp.path.parent(), Some(directory.as_path()));
            assert!(!temp.path.exists());

            drop(temp);
            assert!(!directory.exists());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_wic_provider_is_read_only() {
        if let Some(provider) = heic_provider_info() {
            assert_eq!(provider.kind, WIC_PROVIDER_KIND);
            assert!(provider.readable.contains(&"heic".to_string()));
            assert!(provider.writable.is_empty());
        } else {
            assert!(!heic_available());
        }
    }

    #[test]
    fn multiframe_heic_is_rejected_before_frame_zero_is_decoded() {
        let input = Path::new(r"C:\\fixtures\\animated.heic");
        assert!(require_single_heic_frame(input, 1).is_ok());
        let error = require_single_heic_frame(input, 3).unwrap_err();
        assert!(error.contains("多帧 HEIC/HEIF 暂不支持"));
        assert!(error.contains("3 帧"));
    }
}
