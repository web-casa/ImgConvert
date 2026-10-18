// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Startup gate for the shared Tauri/GPUI data directory. No settings are read
//! here; the acquired lock must be retained as application state until exit.

use std::path::Path;

use imgconvert_backend::instance_lock::{self, AcquireOutcome, InstanceInfo, InstanceLock};

pub(crate) fn acquire_instance_lock(path: Option<&Path>) -> Result<InstanceLock, String> {
    let path = path.ok_or_else(|| {
        "Cannot locate the application data directory. ImgConvert cannot start safely.\n无法确定应用数据目录，ImgConvert 无法安全启动。".to_string()
    })?;
    match instance_lock::acquire(path, InstanceInfo::new("tauri", env!("CARGO_PKG_VERSION"))) {
        Ok(AcquireOutcome::Acquired(lock)) => Ok(lock),
        Ok(AcquireOutcome::HeldByOther(_)) => Err(
            "ImgConvert is already running. Quit the other instance before opening this version.\nImgConvert 已在运行。请先退出另一个实例，再打开此版本。".into(),
        ),
        Err(error) => Err(format!(
            "Cannot lock {}: {error}. ImgConvert cannot start safely.\n无法锁定应用数据目录，ImgConvert 无法安全启动。", path.display()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            static SEQUENCE: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "imgconvert-tauri-startup-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn marker(&self) -> PathBuf {
            self.0.join("instance.lock")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn tauri_guard_blocks_both_flavors_until_dropped() {
        let fixture = Fixture::new();
        let path = fixture.marker();
        let lock = acquire_instance_lock(Some(&path)).unwrap();
        assert_eq!(lock.info().flavor, "tauri");
        assert_eq!(lock.info().version, env!("CARGO_PKG_VERSION"));
        assert_eq!(lock.info().pid, std::process::id());
        assert!(matches!(
            instance_lock::acquire(&path, InstanceInfo::new("gpui", "test")).unwrap(),
            AcquireOutcome::HeldByOther(_)
        ));
        assert!(acquire_instance_lock(Some(&path)).is_err());
        drop(lock);
        assert!(path.exists(), "never unlink the shared lock inode");
        let next = instance_lock::acquire(&path, InstanceInfo::new("gpui", "test")).unwrap();
        assert!(matches!(next, AcquireOutcome::Acquired(_)));
    }

    #[test]
    fn a_gpui_holder_blocks_tauri_without_changing_settings_or_marker() {
        let fixture = Fixture::new();
        let path = fixture.marker();
        let settings = fixture.0.join("settings.json");
        fs::write(&settings, b"untouched shared settings").unwrap();
        let holder = instance_lock::acquire(&path, InstanceInfo::new("gpui", "test")).unwrap();
        assert!(matches!(holder, AcquireOutcome::Acquired(_)));
        assert!(acquire_instance_lock(Some(&path))
            .unwrap_err()
            .contains("already running"));
        assert_eq!(fs::read(&settings).unwrap(), b"untouched shared settings");
        // Windows denies reads of the locked marker, so inspect after release.
        drop(holder);
        assert_eq!(instance_lock::read_info(&path).unwrap().flavor, "gpui");
    }

    #[test]
    fn an_unlocked_stale_marker_does_not_block_tauri() {
        let fixture = Fixture::new();
        let path = fixture.marker();
        fs::write(&path, b"stale or truncated marker").unwrap();
        let lock = acquire_instance_lock(Some(&path)).unwrap();
        assert_eq!(lock.info().flavor, "tauri");
    }

    #[test]
    fn missing_data_directory_or_io_failure_does_not_allow_unlocked_startup() {
        assert!(acquire_instance_lock(None)
            .unwrap_err()
            .contains("data directory"));
        let fixture = Fixture::new();
        let path = fixture.marker();
        fs::create_dir(&path).unwrap();
        assert!(acquire_instance_lock(Some(&path))
            .unwrap_err()
            .contains("Cannot lock"));
    }
}
