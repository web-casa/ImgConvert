// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! macOS security-scoped resource lifecycle.
//!
//! This is intentionally a best-effort RAII hook. Direct Linux/Windows builds
//! use a no-op implementation. The current MAS design relies on a fresh
//! user-selected `NSOpenPanel` grant each process lifetime; it does not create
//! or restore macOS bookmark data. Any future cross-launch bookmark feature
//! must resolve real bookmark data to an NSURL before using this boundary.

use std::path::Path;

#[derive(Debug)]
pub struct ScopedResource {
    #[cfg(target_os = "macos")]
    #[allow(dead_code)]
    inner: Option<macos::SecurityScopedUrl>,
}

impl ScopedResource {
    pub fn start(path: &Path) -> Self {
        #[cfg(target_os = "macos")]
        {
            Self {
                inner: macos::SecurityScopedUrl::start(path),
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = path;
            Self {}
        }
    }

    #[cfg(all(test, not(target_os = "macos")))]
    pub fn started(&self) -> bool {
        false
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use std::os::raw::c_uchar;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::NonNull;

    type Boolean = c_uchar;
    type CFIndex = isize;
    type CFAllocatorRef = *const c_void;
    type CFURLRef = *const c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
        fn CFURLCreateFromFileSystemRepresentation(
            allocator: CFAllocatorRef,
            buffer: *const u8,
            buf_len: CFIndex,
            is_directory: Boolean,
        ) -> CFURLRef;
        fn CFURLStartAccessingSecurityScopedResource(url: CFURLRef) -> Boolean;
        fn CFURLStopAccessingSecurityScopedResource(url: CFURLRef);
    }

    #[derive(Debug)]
    pub struct SecurityScopedUrl {
        url: NonNull<c_void>,
        pub started: bool,
    }

    impl SecurityScopedUrl {
        pub fn start(path: &Path) -> Option<Self> {
            let bytes = path.as_os_str().as_bytes();
            if bytes.is_empty() || bytes.len() > CFIndex::MAX as usize {
                return None;
            }
            let is_directory = path
                .metadata()
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false);
            let url = unsafe {
                CFURLCreateFromFileSystemRepresentation(
                    std::ptr::null(),
                    bytes.as_ptr(),
                    bytes.len() as CFIndex,
                    Boolean::from(is_directory),
                )
            };
            let url = NonNull::new(url.cast_mut())?;
            let started = unsafe { CFURLStartAccessingSecurityScopedResource(url.as_ptr()) != 0 };
            Some(Self { url, started })
        }
    }

    impl Drop for SecurityScopedUrl {
        fn drop(&mut self) {
            unsafe {
                if self.started {
                    CFURLStopAccessingSecurityScopedResource(self.url.as_ptr());
                }
                CFRelease(self.url.as_ptr());
            }
        }
    }
}

#[cfg(all(test, not(target_os = "macos")))]
mod tests {
    use super::*;

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn scoped_resource_is_noop_off_macos() {
        let scope = ScopedResource::start(Path::new("/tmp"));
        assert!(!scope.started());
    }
}
