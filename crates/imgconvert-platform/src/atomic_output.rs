// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Commit a fully written temporary file to its final name without ever
//! exposing a half-written output and without replacing an existing entry.
//!
//! The caller writes and `fsync`s a temporary file in the destination's
//! directory, then calls [`commit_new_file`]. The commit is a single
//! no-replace rename so the destination either does not exist or holds the
//! complete bytes; a concurrent writer that wins the race makes this call
//! fail with [`CommitError::AlreadyExists`] instead of being overwritten.
//!
//! Per platform the rename is `renameat2(RENAME_NOREPLACE)` on Linux,
//! `renamex_np(RENAME_EXCL)` on macOS and `MoveFileExW` without
//! `MOVEFILE_REPLACE_EXISTING` (and without `MOVEFILE_COPY_ALLOWED`, so it
//! never degrades into a copy) on Windows. Only when the file system reports
//! that it cannot do such a rename does the commit fall back to
//! `hard_link` + unlink of the temporary name. There is no fallback to writing
//! the destination directly: a file system that supports neither returns
//! [`CommitError::Unsupported`] so the caller can tell the user to pick
//! another output directory.

use std::fmt;
use std::fs;
use std::io;
use std::path::Path;

/// How the destination received its bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitMethod {
    /// The temporary file was renamed onto the destination.
    Renamed,
    /// The destination was hard-linked to the temporary file because the
    /// file system has no no-replace rename.
    HardLinked,
}

/// A successful commit.
#[derive(Debug)]
pub struct Committed {
    pub method: CommitMethod,
    /// Set when the hard-link fallback committed the destination but could
    /// not remove the temporary name. The destination is complete; the
    /// temporary file is a leftover the caller may report.
    pub leftover_temp: Option<io::Error>,
}

/// Why a commit did not happen. In every variant the temporary file is left
/// in place so the caller decides whether to remove it.
#[derive(Debug)]
pub enum CommitError {
    /// Something already occupies the destination path (file, directory or
    /// dangling link). Nothing was changed.
    AlreadyExists,
    /// The file system supports neither a no-replace rename nor hard links.
    Unsupported { rename: io::Error, link: io::Error },
    /// Any other I/O failure, such as a permission error or a missing parent
    /// directory, from whichever primitive reported it.
    Io(io::Error),
}

impl fmt::Display for CommitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CommitError::AlreadyExists => write!(f, "destination already exists"),
            CommitError::Unsupported { rename, link } => write!(
                f,
                "file system supports neither a no-replace rename ({rename}) nor hard links ({link})"
            ),
            CommitError::Io(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for CommitError {}

/// Move `tmp` to `out` without replacing anything that is already there.
///
/// `tmp` must be a complete, flushed regular file in the same directory as
/// `out` (or at least on the same volume). See the module documentation for
/// the guarantees and the fallback policy.
pub fn commit_new_file(tmp: &Path, out: &Path) -> Result<Committed, CommitError> {
    commit_with(tmp, out, rename_noreplace, hard_link, remove_file)
}

// Non-generic wrappers: `std::fs`'s generic fn items do not coerce to the
// higher-ranked `FnMut(&Path, &Path)` the policy takes.
fn hard_link(from: &Path, to: &Path) -> io::Result<()> {
    fs::hard_link(from, to)
}

fn remove_file(path: &Path) -> io::Result<()> {
    fs::remove_file(path)
}

/// The commit policy with every file-system primitive injected, so the
/// fallback and its error handling can be exercised on file systems that do
/// support the no-replace rename.
fn commit_with<R, L, U>(
    tmp: &Path,
    out: &Path,
    mut rename: R,
    mut link: L,
    mut unlink: U,
) -> Result<Committed, CommitError>
where
    R: FnMut(&Path, &Path) -> io::Result<()>,
    L: FnMut(&Path, &Path) -> io::Result<()>,
    U: FnMut(&Path) -> io::Result<()>,
{
    let rename_error = match rename(tmp, out) {
        Ok(()) => {
            return Ok(Committed {
                method: CommitMethod::Renamed,
                leftover_temp: None,
            })
        }
        Err(error) => error,
    };

    match classify_rename(&rename_error) {
        Failure::AlreadyExists => Err(CommitError::AlreadyExists),
        Failure::Other => Err(CommitError::Io(rename_error)),
        Failure::Unsupported => match link(tmp, out) {
            Ok(()) => Ok(Committed {
                method: CommitMethod::HardLinked,
                leftover_temp: unlink(tmp).err(),
            }),
            Err(link_error) => match classify_link(&link_error) {
                Failure::AlreadyExists => Err(CommitError::AlreadyExists),
                Failure::Unsupported => Err(CommitError::Unsupported {
                    rename: rename_error,
                    link: link_error,
                }),
                Failure::Other => Err(CommitError::Io(link_error)),
            },
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Failure {
    AlreadyExists,
    Unsupported,
    Other,
}

/// Sort a rename failure into the three outcomes the policy distinguishes.
/// Only a file system that cannot perform a no-replace rename at all counts
/// as `Unsupported`; an existing destination and permission problems never
/// enter the fallback path.
fn classify_rename(error: &io::Error) -> Failure {
    if error.kind() == io::ErrorKind::AlreadyExists {
        return Failure::AlreadyExists;
    }
    if error.kind() == io::ErrorKind::Unsupported || is_unsupported_rename_os_error(error) {
        return Failure::Unsupported;
    }
    Failure::Other
}

/// Sort a hard-link failure. A file system that cannot link reports it
/// differently from a rename it cannot do (`EPERM` on Linux FAT/exFAT,
/// `ERROR_INVALID_FUNCTION` on Windows FAT32), so the extra codes here apply
/// to the link step only; everything else keeps its own meaning so a denied
/// or vanished directory is still reported as such.
fn classify_link(error: &io::Error) -> Failure {
    if error.kind() == io::ErrorKind::AlreadyExists {
        return Failure::AlreadyExists;
    }
    if error.kind() == io::ErrorKind::Unsupported
        || is_unsupported_rename_os_error(error)
        || is_unsupported_link_os_error(error)
    {
        return Failure::Unsupported;
    }
    Failure::Other
}

#[cfg(unix)]
fn is_unsupported_rename_os_error(error: &io::Error) -> bool {
    // EINVAL: the kernel or file system rejects the flag (old kernels, FUSE,
    // some network file systems). ENOTSUP/EOPNOTSUPP: the file system says so
    // explicitly (macOS SMB, NFS). ENOSYS: the syscall itself is missing.
    // EXDEV: the temporary file is not on the destination's volume; the
    // hard-link attempt then fails with the same error and surfaces it.
    let Some(code) = error.raw_os_error() else {
        return false;
    };
    // EOPNOTSUPP aliases ENOTSUP on Linux but is a distinct value on macOS.
    [libc::EINVAL, libc::ENOTSUP, libc::ENOSYS, libc::EXDEV].contains(&code)
        || code == libc::EOPNOTSUPP
}

#[cfg(unix)]
fn is_unsupported_link_os_error(error: &io::Error) -> bool {
    // link(2): "the file system containing oldpath and newpath does not
    // support the creation of hard links" (FAT/exFAT and friends). The
    // temporary file is our own freshly created regular file, so of the other
    // EPERM causes only a policy that forbids link() outright (seccomp,
    // protected_hardlinks on a foreign file) remains; that ambiguity is
    // accepted because the result is a clear error that quotes the errno, not
    // a further fallback.
    error.raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
fn is_unsupported_rename_os_error(error: &io::Error) -> bool {
    const ERROR_NOT_SAME_DEVICE: i32 = 17;
    const ERROR_NOT_SUPPORTED: i32 = 50;
    matches!(
        error.raw_os_error(),
        Some(ERROR_NOT_SAME_DEVICE | ERROR_NOT_SUPPORTED)
    )
}

#[cfg(windows)]
fn is_unsupported_link_os_error(error: &io::Error) -> bool {
    // CreateHardLinkW on FAT/exFAT and on volumes without link support fails
    // with ERROR_INVALID_FUNCTION.
    const ERROR_INVALID_FUNCTION: i32 = 1;
    error.raw_os_error() == Some(ERROR_INVALID_FUNCTION)
}

#[cfg(not(any(unix, windows)))]
fn is_unsupported_rename_os_error(_error: &io::Error) -> bool {
    false
}

#[cfg(not(any(unix, windows)))]
fn is_unsupported_link_os_error(_error: &io::Error) -> bool {
    false
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn c_path(path: &Path) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;

    std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "path contains an interior NUL byte",
        )
    })
}

#[cfg(target_os = "linux")]
fn rename_noreplace(from: &Path, to: &Path) -> io::Result<()> {
    let from = c_path(from)?;
    let to = c_path(to)?;
    // The raw syscall rather than the glibc wrapper so musl and older glibc
    // builds link the same way; RENAME_NOREPLACE has been in the kernel since 3.15.
    // SAFETY: both pointers are valid NUL-terminated strings that outlive the call.
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
fn rename_noreplace(from: &Path, to: &Path) -> io::Result<()> {
    let from = c_path(from)?;
    let to = c_path(to)?;
    // SAFETY: both pointers are valid NUL-terminated strings that outlive the call.
    let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_noreplace(from: &Path, to: &Path) -> io::Result<()> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS};

    let from = verbatim_wide(from)?;
    let to = verbatim_wide(to)?;
    // No MOVEFILE_REPLACE_EXISTING, so an existing destination fails the call,
    // and no MOVEFILE_COPY_ALLOWED, so a cross-volume move is refused instead of
    // being turned into a non-atomic copy.
    // SAFETY: both buffers are NUL-terminated and outlive the call.
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVE_FILE_FLAGS(0),
        )
    }
    .map_err(win32_io_error)
}

/// Encode a path for a raw Win32 call the way `std::fs` does: absolute, with
/// the `\\?\` (or `\\?\UNC\`) prefix so paths past `MAX_PATH` work without
/// the long-path policy, and rejected if it contains an interior NUL.
#[cfg(windows)]
fn verbatim_wide(path: &Path) -> io::Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;

    let absolute = std::path::absolute(path)?;
    let verbatim = verbatim_path(&absolute);
    let wide: Vec<u16> = verbatim.encode_wide().collect();
    if wide.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path contains an interior NUL character",
        ));
    }
    Ok(wide.into_iter().chain(Some(0)).collect())
}

/// Prefix an absolute Windows path with `\\?\`, keeping paths that already
/// carry a verbatim or device prefix untouched.
#[cfg(windows)]
fn verbatim_path(absolute: &Path) -> std::ffi::OsString {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Component, Prefix};

    let kind = match absolute.components().next() {
        Some(Component::Prefix(prefix)) => prefix.kind(),
        _ => return absolute.as_os_str().to_os_string(),
    };
    match kind {
        Prefix::Verbatim(_)
        | Prefix::VerbatimUNC(..)
        | Prefix::VerbatimDisk(_)
        | Prefix::DeviceNS(_) => absolute.as_os_str().to_os_string(),
        Prefix::UNC(..) => {
            // `\\server\share\...` becomes `\\?\UNC\server\share\...`.
            let raw: Vec<u16> = absolute.as_os_str().encode_wide().collect();
            let mut out: Vec<u16> = r"\\?\UNC\".encode_utf16().collect();
            out.extend_from_slice(&raw[2..]);
            OsString::from_wide(&out)
        }
        Prefix::Disk(_) => {
            let mut out = OsString::from(r"\\?\");
            out.push(absolute.as_os_str());
            out
        }
    }
}

#[cfg(windows)]
fn win32_io_error(error: windows::core::Error) -> io::Error {
    // Win32 failures arrive as HRESULT_FROM_WIN32(code); unwrap them so
    // `raw_os_error` and `kind` match what `std::fs` would have reported.
    let hresult = error.code().0 as u32;
    let code = if hresult & 0xFFFF_0000 == 0x8007_0000 {
        hresult & 0xFFFF
    } else {
        hresult
    };
    io::Error::from_raw_os_error(code as i32)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn rename_noreplace(_from: &Path, _to: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "no no-replace rename primitive on this platform",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "imgconvert-atomic-output-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn unsupported_rename_error() -> io::Error {
        #[cfg(unix)]
        {
            io::Error::from_raw_os_error(libc::ENOTSUP)
        }
        #[cfg(windows)]
        {
            io::Error::from_raw_os_error(50)
        }
        #[cfg(not(any(unix, windows)))]
        {
            io::Error::from(io::ErrorKind::Unsupported)
        }
    }

    fn unsupported_link_error() -> io::Error {
        #[cfg(unix)]
        {
            io::Error::from_raw_os_error(libc::EPERM)
        }
        #[cfg(windows)]
        {
            io::Error::from_raw_os_error(1)
        }
        #[cfg(not(any(unix, windows)))]
        {
            io::Error::from(io::ErrorKind::Unsupported)
        }
    }

    fn unsupported_rename(_: &Path, _: &Path) -> io::Result<()> {
        Err(unsupported_rename_error())
    }

    #[test]
    fn a_new_destination_receives_the_bytes_and_the_temp_name_disappears() {
        let dir = temp_dir("fresh");
        let tmp = dir.join(".imgconvert-1.tmp");
        let out = dir.join("photo.webp");
        fs::write(&tmp, b"complete").unwrap();

        let committed = commit_new_file(&tmp, &out).unwrap();

        assert_eq!(committed.method, CommitMethod::Renamed);
        assert!(committed.leftover_temp.is_none());
        assert_eq!(fs::read(&out).unwrap(), b"complete");
        assert!(!tmp.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_destination_stays_invisible_until_the_commit() {
        let dir = temp_dir("invisible");
        let tmp = dir.join(".imgconvert-2.tmp");
        let out = dir.join("photo.webp");

        // An interrupted writer leaves only the temporary name behind.
        fs::write(&tmp, b"half").unwrap();
        assert!(out.symlink_metadata().is_err());
        fs::write(&tmp, b"complete").unwrap();
        assert!(out.symlink_metadata().is_err());

        commit_new_file(&tmp, &out).unwrap();

        assert_eq!(fs::read(&out).unwrap(), b"complete");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_existing_file_is_never_replaced() {
        let dir = temp_dir("existing-file");
        let tmp = dir.join(".imgconvert-3.tmp");
        let out = dir.join("photo.webp");
        fs::write(&tmp, b"new").unwrap();
        fs::write(&out, b"old").unwrap();

        let error = commit_new_file(&tmp, &out).unwrap_err();

        assert!(matches!(error, CommitError::AlreadyExists), "{error:?}");
        assert_eq!(fs::read(&out).unwrap(), b"old");
        assert_eq!(fs::read(&tmp).unwrap(), b"new");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_existing_directory_is_never_replaced() {
        let dir = temp_dir("existing-dir");
        let tmp = dir.join(".imgconvert-4.tmp");
        let out = dir.join("photo.webp");
        fs::write(&tmp, b"new").unwrap();
        fs::create_dir(&out).unwrap();

        let error = commit_new_file(&tmp, &out).unwrap_err();

        assert!(matches!(error, CommitError::AlreadyExists), "{error:?}");
        assert!(out.is_dir());
        assert!(tmp.is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_symlink_at_the_destination_counts_as_existing() {
        let dir = temp_dir("dangling");
        let tmp = dir.join(".imgconvert-10.tmp");
        let out = dir.join("photo.webp");
        fs::write(&tmp, b"new").unwrap();
        std::os::unix::fs::symlink(dir.join("missing-target"), &out).unwrap();

        let error = commit_new_file(&tmp, &out).unwrap_err();

        assert!(matches!(error, CommitError::AlreadyExists), "{error:?}");
        assert!(out.symlink_metadata().unwrap().file_type().is_symlink());
        assert!(tmp.is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_missing_parent_is_a_plain_io_error() {
        let dir = temp_dir("missing-parent");
        let tmp = dir.join(".imgconvert-5.tmp");
        let out = dir.join("nowhere").join("photo.webp");
        fs::write(&tmp, b"new").unwrap();

        let error = commit_new_file(&tmp, &out).unwrap_err();

        match error {
            CommitError::Io(error) => assert_eq!(error.kind(), io::ErrorKind::NotFound),
            other => panic!("expected an I/O error, got {other:?}"),
        }
        assert!(tmp.is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_unsupported_rename_falls_back_to_a_hard_link_and_removes_the_temp_name() {
        let dir = temp_dir("fallback");
        let tmp = dir.join(".imgconvert-6.tmp");
        let out = dir.join("photo.webp");
        fs::write(&tmp, b"complete").unwrap();

        let committed =
            commit_with(&tmp, &out, unsupported_rename, hard_link, remove_file).unwrap();

        assert_eq!(committed.method, CommitMethod::HardLinked);
        assert!(committed.leftover_temp.is_none());
        assert_eq!(fs::read(&out).unwrap(), b"complete");
        assert!(!tmp.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_hard_link_fallback_still_refuses_an_existing_destination() {
        let dir = temp_dir("fallback-existing");
        let tmp = dir.join(".imgconvert-7.tmp");
        let out = dir.join("photo.webp");
        fs::write(&tmp, b"new").unwrap();
        fs::write(&out, b"old").unwrap();

        let error =
            commit_with(&tmp, &out, unsupported_rename, hard_link, remove_file).unwrap_err();

        assert!(matches!(error, CommitError::AlreadyExists), "{error:?}");
        assert_eq!(fs::read(&out).unwrap(), b"old");
        assert!(tmp.is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_hard_link_commit_whose_temp_name_survives_is_still_a_commit() {
        let dir = temp_dir("fallback-leftover");
        let tmp = dir.join(".imgconvert-11.tmp");
        let out = dir.join("photo.webp");
        fs::write(&tmp, b"complete").unwrap();

        let committed = commit_with(&tmp, &out, unsupported_rename, hard_link, |_| {
            Err(io::Error::from(io::ErrorKind::PermissionDenied))
        })
        .unwrap();

        assert_eq!(committed.method, CommitMethod::HardLinked);
        assert_eq!(
            committed.leftover_temp.as_ref().map(io::Error::kind),
            Some(io::ErrorKind::PermissionDenied)
        );
        assert_eq!(fs::read(&out).unwrap(), b"complete");
        assert!(tmp.is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_permission_failure_never_enters_the_fallback() {
        let dir = temp_dir("permission");
        let tmp = dir.join(".imgconvert-8.tmp");
        let out = dir.join("photo.webp");
        fs::write(&tmp, b"new").unwrap();

        let error = commit_with(
            &tmp,
            &out,
            |_, _| Err(io::Error::from(io::ErrorKind::PermissionDenied)),
            hard_link,
            remove_file,
        )
        .unwrap_err();

        match error {
            CommitError::Io(error) => assert_eq!(error.kind(), io::ErrorKind::PermissionDenied),
            other => panic!("expected an I/O error, got {other:?}"),
        }
        assert!(
            out.symlink_metadata().is_err(),
            "no hard link may be created"
        );
        assert!(tmp.is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_hard_link_io_failure_keeps_its_own_meaning() {
        let dir = temp_dir("link-io");
        let tmp = dir.join(".imgconvert-12.tmp");
        // A destination whose parent is missing makes a real hard link fail with NotFound.
        let out = dir.join("nowhere").join("photo.webp");
        fs::write(&tmp, b"new").unwrap();

        let error =
            commit_with(&tmp, &out, unsupported_rename, hard_link, remove_file).unwrap_err();

        match error {
            CommitError::Io(error) => assert_eq!(error.kind(), io::ErrorKind::NotFound),
            other => panic!("expected an I/O error, got {other:?}"),
        }
        assert!(tmp.is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn when_neither_primitive_works_the_error_names_both_failures() {
        let dir = temp_dir("neither");
        let tmp = dir.join(".imgconvert-9.tmp");
        let out = dir.join("photo.webp");
        fs::write(&tmp, b"new").unwrap();

        let error = commit_with(
            &tmp,
            &out,
            unsupported_rename,
            |_, _| Err(unsupported_link_error()),
            remove_file,
        )
        .unwrap_err();

        match &error {
            CommitError::Unsupported { rename, link } => {
                assert_eq!(classify_rename(rename), Failure::Unsupported);
                assert_eq!(classify_link(link), Failure::Unsupported);
            }
            other => panic!("expected Unsupported, got {other:?}"),
        }
        assert!(error.to_string().contains("neither"));
        assert!(out.symlink_metadata().is_err());
        assert!(tmp.is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn classification_separates_exists_unsupported_and_other() {
        assert_eq!(
            classify_rename(&io::Error::from(io::ErrorKind::AlreadyExists)),
            Failure::AlreadyExists
        );
        assert_eq!(
            classify_rename(&io::Error::from(io::ErrorKind::Unsupported)),
            Failure::Unsupported
        );
        assert_eq!(
            classify_rename(&unsupported_rename_error()),
            Failure::Unsupported
        );
        assert_eq!(
            classify_rename(&io::Error::from(io::ErrorKind::PermissionDenied)),
            Failure::Other
        );
        // The link-only codes do not make a rename look unsupported.
        assert_eq!(classify_rename(&unsupported_link_error()), Failure::Other);
        assert_eq!(
            classify_link(&unsupported_link_error()),
            Failure::Unsupported
        );
        assert_eq!(
            classify_link(&io::Error::from(io::ErrorKind::AlreadyExists)),
            Failure::AlreadyExists
        );
        assert_eq!(
            classify_link(&io::Error::from(io::ErrorKind::NotFound)),
            Failure::Other
        );
        #[cfg(unix)]
        {
            assert_eq!(
                classify_rename(&io::Error::from_raw_os_error(libc::EEXIST)),
                Failure::AlreadyExists
            );
            assert_eq!(
                classify_rename(&io::Error::from_raw_os_error(libc::EINVAL)),
                Failure::Unsupported
            );
            assert_eq!(
                classify_rename(&io::Error::from_raw_os_error(libc::EXDEV)),
                Failure::Unsupported
            );
            assert_eq!(
                classify_rename(&io::Error::from_raw_os_error(libc::EACCES)),
                Failure::Other
            );
            assert_eq!(
                classify_link(&io::Error::from_raw_os_error(libc::EACCES)),
                Failure::Other
            );
        }
        #[cfg(windows)]
        {
            assert_eq!(
                classify_rename(&io::Error::from_raw_os_error(183)),
                Failure::AlreadyExists
            );
            assert_eq!(
                classify_rename(&io::Error::from_raw_os_error(80)),
                Failure::AlreadyExists
            );
            assert_eq!(
                classify_rename(&io::Error::from_raw_os_error(17)),
                Failure::Unsupported
            );
            assert_eq!(
                classify_rename(&io::Error::from_raw_os_error(5)),
                Failure::Other
            );
            assert_eq!(
                classify_link(&io::Error::from_raw_os_error(5)),
                Failure::Other
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_are_passed_in_verbatim_form() {
        use std::ffi::OsString;

        assert_eq!(
            verbatim_path(Path::new(r"C:\images\out\photo.webp")),
            OsString::from(r"\\?\C:\images\out\photo.webp")
        );
        assert_eq!(
            verbatim_path(Path::new(r"\\server\share\out\photo.webp")),
            OsString::from(r"\\?\UNC\server\share\out\photo.webp")
        );
        assert_eq!(
            verbatim_path(Path::new(r"\\?\C:\already\verbatim.webp")),
            OsString::from(r"\\?\C:\already\verbatim.webp")
        );
        assert_eq!(
            verbatim_path(Path::new(r"\\?\UNC\server\share\verbatim.webp")),
            OsString::from(r"\\?\UNC\server\share\verbatim.webp")
        );

        let long = Path::new(r"C:\images").join("x".repeat(300));
        let wide = verbatim_wide(&long).unwrap();
        assert!(wide.len() > 300);
        assert_eq!(wide.last(), Some(&0));
        assert!(String::from_utf16_lossy(&wide[..wide.len() - 1]).starts_with(r"\\?\C:\images\"));

        let with_nul = OsString::from("C:\\images\\bad\0name.webp");
        let error = verbatim_wide(Path::new(&with_nul)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }
}
