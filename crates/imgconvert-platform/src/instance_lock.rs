// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Single-instance marker shared by the Tauri and GPUI shells (migration
//! plan §3.5). Only one ImgConvert process may run per data directory,
//! because the Tauri store cannot take part in a file-lock protocol and two
//! writers of one `settings.json` would lose each other's updates.
//!
//! Liveness is the operating system's file lock, not a pid: the holder keeps
//! `instance.lock` open with an exclusive advisory lock ([`File::try_lock`],
//! `flock` on Unix, `LockFileEx` on Windows) for its whole lifetime. A crash
//! releases the lock with the file descriptor, so no stale-marker or
//! pid-reuse reasoning is needed, and acquisition is atomic: two starters
//! cannot both win. The file's JSON content (`{pid, flavor, version}`) is
//! descriptive only, for the "already running" message.
//!
//! The file is never deleted: unlinking a file another starter already opened
//! would let that starter lock an orphaned inode while a third process
//! creates a fresh one, admitting two instances.

use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{self, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Who holds the marker. Written by the holder, read by a blocked starter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct InstanceInfo {
    pub pid: u32,
    /// `tauri` or `gpui`.
    pub flavor: String,
    pub version: String,
}

impl InstanceInfo {
    pub fn new(flavor: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            pid: std::process::id(),
            flavor: flavor.into(),
            version: version.into(),
        }
    }
}

/// The held marker. Dropping it closes the file, which releases the lock.
#[derive(Debug)]
pub struct InstanceLock {
    _file: File,
    path: PathBuf,
    info: InstanceInfo,
}

impl InstanceLock {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn info(&self) -> &InstanceInfo {
        &self.info
    }
}

#[derive(Debug)]
pub enum AcquireOutcome {
    Acquired(InstanceLock),
    /// Another process holds the lock. Its description is `None` when the
    /// marker could not be read (on Windows the exclusive lock also blocks
    /// readers) or was not valid JSON.
    HeldByOther(Option<InstanceInfo>),
}

/// Takes the marker at `path` or reports who holds it. I/O errors other than
/// contention (missing permissions, read-only volume) are returned so the
/// caller can decide whether to start without the marker.
pub fn acquire(path: &Path, info: InstanceInfo) -> io::Result<AcquireOutcome> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    match file.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => return Ok(AcquireOutcome::HeldByOther(read_info(path))),
        Err(TryLockError::Error(error)) => return Err(error),
    }
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&serde_json::to_vec_pretty(&info)?)?;
    file.sync_all()?;
    Ok(AcquireOutcome::Acquired(InstanceLock {
        _file: file,
        path: path.to_path_buf(),
        info,
    }))
}

/// The marker's description, read through a separate handle.
pub fn read_info(path: &Path) -> Option<InstanceInfo> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "imgconvert-instance-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        dir.join("instance.lock")
    }

    #[test]
    fn the_first_starter_wins_and_the_lock_outlives_nothing_but_the_holder() {
        let path = temp_path("first");
        let first = match acquire(&path, InstanceInfo::new("gpui", "1")).unwrap() {
            AcquireOutcome::Acquired(lock) => lock,
            AcquireOutcome::HeldByOther(other) => panic!("unexpected holder {other:?}"),
        };
        assert_eq!(first.info().flavor, "gpui");
        assert_eq!(read_info(&path).unwrap().version, "1");

        // Any second starter is refused, same flavor or not.
        match acquire(&path, InstanceInfo::new("tauri", "0.3.1")).unwrap() {
            AcquireOutcome::HeldByOther(other) => {
                if cfg!(unix) {
                    assert_eq!(other.unwrap().flavor, "gpui");
                }
            }
            AcquireOutcome::Acquired(_) => panic!("two holders"),
        }
        match acquire(&path, InstanceInfo::new("gpui", "2")).unwrap() {
            AcquireOutcome::HeldByOther(_) => {}
            AcquireOutcome::Acquired(_) => panic!("two holders of the same flavor"),
        }

        // Closing the holder (a clean exit or a crash) frees the marker.
        drop(first);
        match acquire(&path, InstanceInfo::new("tauri", "0.3.1")).unwrap() {
            AcquireOutcome::Acquired(_lock) => {
                assert_eq!(read_info(&path).unwrap().flavor, "tauri")
            }
            AcquireOutcome::HeldByOther(other) => panic!("stale hold {other:?}"),
        }
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_leftover_unlocked_marker_is_simply_overwritten() {
        let path = temp_path("stale");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            b"{\"pid\": 1, \"flavor\": \"tauri\", \"version\": \"0.3.0\"} trailing",
        )
        .unwrap();
        assert!(
            read_info(&path).is_none(),
            "malformed content is not a holder"
        );
        match acquire(&path, InstanceInfo::new("gpui", "1")).unwrap() {
            AcquireOutcome::Acquired(lock) => {
                assert_eq!(read_info(&path).unwrap().pid, std::process::id());
                assert_eq!(lock.path(), path);
            }
            AcquireOutcome::HeldByOther(other) => panic!("dead marker blocked start: {other:?}"),
        }
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
