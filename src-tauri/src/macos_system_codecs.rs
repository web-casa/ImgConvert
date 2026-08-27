// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! macOS system codec bridge.
//!
//! HEIC remains outside the bundled Rust codec stack. On macOS we can use the
//! platform ImageIO framework for decode-only HEIC import without linking
//! libheif/x265 or changing the Apache-2.0 main dependency tree.

use std::path::Path;

use crate::external_codecs::{
    validate_system_heic_dimensions, CodecProviderDiagnostic, CodecProviderInfo,
};

const HEIC_EXTENSIONS: &[&str] = &["heic", "heif", "hif"];
const IMAGEIO_PROVIDER_ID: &str = "macos-imageio-heic";
const IMAGEIO_PROVIDER_KIND: &str = "system-imageio";
const IMAGEIO_FRAMEWORK_PATH: &str = "/System/Library/Frameworks/ImageIO.framework";

pub fn heic_available() -> bool {
    platform_heic_available()
}

pub fn heic_provider_info() -> Option<CodecProviderInfo> {
    heic_available().then(|| CodecProviderInfo {
        id: IMAGEIO_PROVIDER_ID.to_string(),
        kind: IMAGEIO_PROVIDER_KIND,
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
        command: "ImageIO.framework".to_string(),
        path: IMAGEIO_FRAMEWORK_PATH.to_string(),
        args: Vec::new(),
    })
}

pub fn decode_heic_to_png(input: &Path) -> Result<Vec<u8>, String> {
    platform_decode_heic_to_png(input)
}

/// Image conversion has one output image. Reject a sequence instead of silently
/// decoding frame zero and discarding the user's remaining HEIC frames.
pub(crate) fn require_single_heic_frame(input: &Path, frame_count: usize) -> Result<(), String> {
    if frame_count == 1 {
        return Ok(());
    }
    Err(format!(
        "多帧 HEIC/HEIF 暂不支持（检测到 {frame_count} 帧，未转换以避免丢失帧）: {}",
        input.display()
    ))
}

#[cfg(target_os = "macos")]
fn platform_heic_available() -> bool {
    Path::new(IMAGEIO_FRAMEWORK_PATH).exists()
}

#[cfg(not(target_os = "macos"))]
fn platform_heic_available() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
fn platform_decode_heic_to_png(input: &Path) -> Result<Vec<u8>, String> {
    Err(format!(
        "macOS ImageIO HEIC 解码仅在 macOS 可用: {}",
        input.display()
    ))
}

#[cfg(target_os = "macos")]
fn platform_decode_heic_to_png(input: &Path) -> Result<Vec<u8>, String> {
    imageio::decode_heic_to_png(input)
}

#[cfg(target_os = "macos")]
mod imageio {
    use std::ffi::{c_char, c_void};
    use std::fs::File;
    use std::io::Read;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::NonNull;
    use std::slice;

    use crate::external_codecs::{is_heic_magic, MAX_HEIC_DECODED_PNG_BYTES};

    use super::require_single_heic_frame;

    type Boolean = u8;
    type CFIndex = isize;
    type CFAllocatorRef = *const c_void;
    type CFMutableDataRef = *mut c_void;
    type CFStringRef = *const c_void;
    type CFURLRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFTypeRef = *const c_void;
    type CGImageSourceRef = *const c_void;
    type CGImageDestinationRef = *const c_void;
    type CGImageRef = *const c_void;
    type CFNumberType = i32;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const K_CF_NUMBER_SINT64_TYPE: CFNumberType = 4;
    const PNG_UTI: &[u8] = b"public.png\0";

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFDataCreateMutable(allocator: CFAllocatorRef, capacity: CFIndex) -> CFMutableDataRef;
        fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
        fn CFDataGetLength(data: *const c_void) -> CFIndex;
        fn CFDictionaryGetValue(dictionary: CFDictionaryRef, key: *const c_void) -> *const c_void;
        fn CFNumberGetValue(
            number: *const c_void,
            number_type: CFNumberType,
            value_ptr: *mut c_void,
        ) -> Boolean;
        fn CFRelease(cf: CFTypeRef);
        fn CFURLCreateFromFileSystemRepresentation(
            allocator: CFAllocatorRef,
            buffer: *const u8,
            buf_len: CFIndex,
            is_directory: Boolean,
        ) -> CFURLRef;
        fn CFStringCreateWithCString(
            allocator: CFAllocatorRef,
            c_str: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
    }

    #[link(name = "ImageIO", kind = "framework")]
    extern "C" {
        fn CGImageSourceCreateWithURL(url: CFURLRef, options: CFDictionaryRef) -> CGImageSourceRef;
        fn CGImageSourceGetCount(source: CGImageSourceRef) -> usize;
        fn CGImageSourceCopyPropertiesAtIndex(
            source: CGImageSourceRef,
            index: usize,
            options: CFDictionaryRef,
        ) -> CFDictionaryRef;
        fn CGImageSourceCreateImageAtIndex(
            source: CGImageSourceRef,
            index: usize,
            options: CFDictionaryRef,
        ) -> CGImageRef;
        fn CGImageDestinationCreateWithData(
            data: CFMutableDataRef,
            type_identifier: CFStringRef,
            count: usize,
            options: CFDictionaryRef,
        ) -> CGImageDestinationRef;
        fn CGImageDestinationAddImage(
            destination: CGImageDestinationRef,
            image: CGImageRef,
            properties: CFDictionaryRef,
        );
        fn CGImageDestinationFinalize(destination: CGImageDestinationRef) -> Boolean;
        static kCGImagePropertyPixelWidth: CFStringRef;
        static kCGImagePropertyPixelHeight: CFStringRef;
    }

    struct CfGuard(NonNull<c_void>);

    impl CfGuard {
        fn new(ptr: *const c_void, label: &str) -> Result<Self, String> {
            NonNull::new(ptr.cast_mut())
                .map(Self)
                .ok_or_else(|| format!("macOS ImageIO 创建 {label} 失败"))
        }

        fn as_cf(&self) -> *const c_void {
            self.0.as_ptr()
        }

        fn as_mut_cf(&self) -> *mut c_void {
            self.0.as_ptr()
        }
    }

    impl Drop for CfGuard {
        fn drop(&mut self) {
            unsafe {
                CFRelease(self.0.as_ptr());
            }
        }
    }

    pub fn decode_heic_to_png(input: &Path) -> Result<Vec<u8>, String> {
        validate_heic_header(input)?;

        unsafe {
            let input_url = cf_url_from_path(input)?;
            let source = CfGuard::new(
                CGImageSourceCreateWithURL(input_url.as_cf(), std::ptr::null()),
                "图像源",
            )?;
            require_single_heic_frame(input, CGImageSourceGetCount(source.as_cf()))?;
            validate_source_dimensions(source.as_cf())?;
            let image = CfGuard::new(
                CGImageSourceCreateImageAtIndex(source.as_cf(), 0, std::ptr::null()),
                "HEIC 帧",
            )?;
            let output_data = CfGuard::new(CFDataCreateMutable(std::ptr::null(), 0), "输出缓冲区")?;
            let png_type = CfGuard::new(
                CFStringCreateWithCString(
                    std::ptr::null(),
                    PNG_UTI.as_ptr().cast::<c_char>(),
                    K_CF_STRING_ENCODING_UTF8,
                ),
                "PNG UTI",
            )?;
            let destination = CfGuard::new(
                CGImageDestinationCreateWithData(
                    output_data.as_mut_cf(),
                    png_type.as_cf(),
                    1,
                    std::ptr::null(),
                ),
                "PNG 目标",
            )?;

            CGImageDestinationAddImage(destination.as_cf(), image.as_cf(), std::ptr::null());
            if CGImageDestinationFinalize(destination.as_cf()) == 0 {
                return Err(format!(
                    "macOS ImageIO 无法把 HEIC 转码为 PNG: {}",
                    input.display()
                ));
            }

            let len = CFDataGetLength(output_data.as_cf());
            if len < 0 {
                return Err("macOS ImageIO 返回了无效 PNG 长度".to_string());
            }
            let len = len as usize;
            if len > MAX_HEIC_DECODED_PNG_BYTES {
                return Err(format!(
                    "macOS ImageIO PNG 输出超过上限 {} bytes: {}",
                    MAX_HEIC_DECODED_PNG_BYTES,
                    input.display()
                ));
            }
            let ptr = CFDataGetBytePtr(output_data.as_cf());
            if ptr.is_null() && len > 0 {
                return Err("macOS ImageIO PNG 输出指针为空".to_string());
            }
            Ok(slice::from_raw_parts(ptr, len).to_vec())
        }
    }

    /// `CGImageSourceCopyPropertiesAtIndex` exposes HEIC dimensions without
    /// constructing a decoded `CGImage`. Apple documents the values as
    /// CFNumbers keyed by `kCGImagePropertyPixelWidth/Height`.
    unsafe fn validate_source_dimensions(source: CFTypeRef) -> Result<(), String> {
        let properties = CfGuard::new(
            CGImageSourceCopyPropertiesAtIndex(source, 0, std::ptr::null()),
            "HEIC 图像属性",
        )?;
        let width = image_property_u32(
            properties.as_cf(),
            kCGImagePropertyPixelWidth,
            "宽度",
        )?;
        let height = image_property_u32(
            properties.as_cf(),
            kCGImagePropertyPixelHeight,
            "高度",
        )?;
        super::validate_system_heic_dimensions(width, height)
    }

    unsafe fn image_property_u32(
        properties: CFDictionaryRef,
        key: CFStringRef,
        label: &str,
    ) -> Result<u32, String> {
        let value = CFDictionaryGetValue(properties, key);
        if value.is_null() {
            return Err(format!("macOS ImageIO 未提供 HEIC {label}"));
        }

        let mut value_i64 = 0i64;
        if CFNumberGetValue(
            value,
            K_CF_NUMBER_SINT64_TYPE,
            (&mut value_i64 as *mut i64).cast::<c_void>(),
        ) == 0
            || value_i64 <= 0
            || value_i64 > i64::from(u32::MAX)
        {
            return Err(format!("macOS ImageIO 返回了无效 HEIC {label}"));
        }
        Ok(value_i64 as u32)
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

    fn cf_url_from_path(input: &Path) -> Result<CfGuard, String> {
        let bytes = input.as_os_str().as_bytes();
        if bytes.is_empty() || bytes.len() > CFIndex::MAX as usize {
            return Err(format!("HEIC 输入路径无效: {}", input.display()));
        }

        unsafe {
            CfGuard::new(
                CFURLCreateFromFileSystemRepresentation(
                    std::ptr::null(),
                    bytes.as_ptr(),
                    bytes.len() as CFIndex,
                    0,
                ),
                "输入 URL",
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_imageio_provider_is_read_only() {
        if let Some(provider) = heic_provider_info() {
            assert_eq!(provider.kind, IMAGEIO_PROVIDER_KIND);
            assert!(provider.readable.contains(&"heic".to_string()));
            assert!(provider.writable.is_empty());
        } else {
            assert!(!heic_available());
        }
    }

    #[test]
    fn multiframe_heic_is_rejected_before_frame_zero_is_decoded() {
        let input = Path::new("/tmp/animated.heic");
        assert!(require_single_heic_frame(input, 1).is_ok());
        let error = require_single_heic_frame(input, 2).unwrap_err();
        assert!(error.contains("多帧 HEIC/HEIF 暂不支持"));
        assert!(error.contains("2 帧"));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn macos_imageio_is_unavailable_off_macos() {
        assert!(!heic_available());
        assert!(heic_provider_info().is_none());
    }
}
