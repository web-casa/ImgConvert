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

    /// Whether Core Foundation actually started a security-scoped session.
    ///
    /// A plain file URL may exist without carrying a scope. `false` is not an
    /// access-denied result: NSOpenPanel can grant sandbox access independently,
    /// and direct builds need no security scope. Do not use this as a file I/O gate.
    pub fn started(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            self.inner.as_ref().is_some_and(|resource| resource.started)
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
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

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn allocated_url_without_start_does_not_report_an_active_session() {
            // Allocate a real CFURL but deliberately do not start a scope.
            // No file needs to exist and Drop must only release the URL.
            let bytes = b"/imgconvert-unstarted-scope-fixture";
            let url = unsafe {
                CFURLCreateFromFileSystemRepresentation(
                    std::ptr::null(),
                    bytes.as_ptr(),
                    bytes.len() as CFIndex,
                    0,
                )
            };
            let resource = super::super::ScopedResource {
                inner: Some(SecurityScopedUrl {
                    url: NonNull::new(url.cast_mut()).expect("native CFURL allocation"),
                    started: false,
                }),
            };
            assert!(
                !resource.started(),
                "an allocated URL is not a started session"
            );
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

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    use super::*;

    #[test]
    fn reported_status_matches_the_native_start_result() {
        // Core Foundation may return true or false for a plain file URL across
        // macOS versions. Report its actual result; do not infer it from the path.
        let directory = std::env::temp_dir().join(format!(
            "imgconvert-scope-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("owned-fixture.txt");
        std::fs::write(&path, b"scope regression fixture").unwrap();
        let resource = ScopedResource::start(&path);
        let expected = resource
            .inner
            .as_ref()
            .expect("native CFURL allocation")
            .started;
        let reported = resource.started();
        // The reporting API is observational and must not prevent ordinary I/O.
        let contents = std::fs::read(&path).unwrap();
        drop(resource);
        std::fs::remove_dir_all(directory).unwrap();
        assert_eq!(reported, expected);
        assert_eq!(contents, b"scope regression fixture");
    }

    #[test]
    fn empty_path_does_not_report_an_active_security_scope() {
        assert!(!ScopedResource::start(Path::new("")).started());
    }
}
