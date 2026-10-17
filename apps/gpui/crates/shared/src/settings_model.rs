// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The retained settings record and its autosave (migration plan §3.5).
//!
//! One `Entity<SettingsModel>` per application owns the normalized
//! [`Settings`] and the surrounding store document. Edits go through
//! [`SettingsModel::update`], which notifies observers and schedules a write:
//! writes coalesce for [`AUTOSAVE_DELAY`] after the last edit and never wait
//! longer than [`AUTOSAVE_MAX_LATENCY`], matching the Tauri store's 300 ms
//! `autoSave`. [`flush`] writes synchronously; the shell calls it on quit.
//!
//! Writes happen on the foreground because they are a few kilobytes and one
//! atomic rename; this keeps ordering trivial (the last edit always wins).

use std::future::ready;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use gpui_kit::{App, Context, Task};
use imgconvert_backend::paths;
use imgconvert_backend::settings::{self, AppLocale, Settings, SettingsError};
use serde_json::{Map, Value};

use crate::services::AppModels;

/// Quiet time after the last edit before the file is written.
pub const AUTOSAVE_DELAY: Duration = Duration::from_millis(300);
/// Upper bound between the first unsaved edit and the write, so continuous
/// edits (a slider drag) still reach the disk.
pub const AUTOSAVE_MAX_LATENCY: Duration = Duration::from_secs(2);

#[derive(Debug)]
enum Store {
    Disk(PathBuf),
    /// Tests and the case where the platform reports no data directory.
    Memory,
}

pub struct SettingsModel {
    settings: Settings,
    document: Map<String, Value>,
    store: Store,
    dirty: bool,
    dirty_since: Option<Instant>,
    pending_save: Option<Task<()>>,
    last_error: Option<String>,
    saves: u64,
}

impl SettingsModel {
    /// Loads the store at the shared per-channel path, or runs in memory
    /// when the platform has no data directory.
    pub fn from_data_dir(fallback_locale: AppLocale) -> Self {
        if let Some(path) = paths::settings_file() {
            return Self::from_disk(path, fallback_locale);
        }
        eprintln!("imgconvert: no data directory; settings will not be saved");
        Self::in_memory(Settings::defaults_for(fallback_locale))
    }

    /// Loads and normalizes `path`. A repaired or migrated record is marked
    /// dirty so the caller can schedule its write. When the file cannot be
    /// read (not "does not exist": permissions, I/O) the shell runs on the
    /// defaults **without persistence** for this session and shows the
    /// error, so a transient read failure can never overwrite the profile
    /// with defaults.
    pub fn from_disk(path: PathBuf, fallback_locale: AppLocale) -> Self {
        match settings::load(&path, fallback_locale) {
            Ok(loaded) => {
                if let Some(aside) = &loaded.quarantined {
                    eprintln!(
                        "imgconvert: settings file was unreadable and moved to {}",
                        aside.display()
                    );
                }
                Self {
                    settings: loaded.settings,
                    document: loaded.document,
                    store: Store::Disk(path),
                    dirty: loaded.changed,
                    dirty_since: loaded.changed.then(Instant::now),
                    pending_save: None,
                    last_error: None,
                    saves: 0,
                }
            }
            Err(error) => {
                eprintln!(
                    "imgconvert: cannot read settings at {}: {error}",
                    path.display()
                );
                Self {
                    last_error: Some(error.to_string()),
                    ..Self::in_memory(Settings::defaults_for(fallback_locale))
                }
            }
        }
    }

    /// A model that never touches the disk.
    pub fn in_memory(settings: Settings) -> Self {
        Self {
            settings,
            document: Map::new(),
            store: Store::Memory,
            dirty: false,
            dirty_since: None,
            pending_save: None,
            last_error: None,
            saves: 0,
        }
    }

    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    /// The file behind this model, if any.
    pub fn path(&self) -> Option<&Path> {
        match &self.store {
            Store::Disk(path) => Some(path),
            Store::Memory => None,
        }
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// The last write failure, cleared by the next successful write.
    pub fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    /// Successful writes so far (tests observe coalescing through this).
    pub fn save_count(&self) -> u64 {
        self.saves
    }

    /// Applies `edit`. When it changed anything, observers are notified, a
    /// write is scheduled and `true` is returned.
    pub fn update(&mut self, cx: &mut Context<Self>, edit: impl FnOnce(&mut Settings)) -> bool {
        let before = self.settings.clone();
        edit(&mut self.settings);
        if self.settings == before {
            return false;
        }
        self.schedule_save(cx);
        cx.notify();
        true
    }

    /// Marks the record dirty and (re)arms the coalescing timer.
    pub fn schedule_save(&mut self, cx: &mut Context<Self>) {
        self.dirty = true;
        let now = Instant::now();
        let since = *self.dirty_since.get_or_insert(now);
        if matches!(self.store, Store::Memory) {
            return;
        }
        let remaining = AUTOSAVE_MAX_LATENCY.saturating_sub(now.duration_since(since));
        let delay = AUTOSAVE_DELAY.min(remaining);
        // Dropping the previous task cancels its timer: edits coalesce.
        self.pending_save = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            let _ = this.update(cx, |this, cx| {
                this.pending_save = None;
                let _ = this.flush(cx);
            });
        }));
    }

    /// Writes now when dirty. A failure is kept in [`last_error`] for the
    /// interface and returned; the record stays dirty for the next attempt.
    pub fn flush(&mut self, cx: &mut Context<Self>) -> Result<(), SettingsError> {
        self.pending_save = None;
        if !self.dirty {
            return Ok(());
        }
        let Store::Disk(path) = &self.store else {
            self.dirty = false;
            self.dirty_since = None;
            return Ok(());
        };
        match settings::save(path, &self.settings, &mut self.document) {
            Ok(()) => {
                self.dirty = false;
                self.dirty_since = None;
                self.saves += 1;
                if self.last_error.take().is_some() {
                    cx.notify();
                }
                Ok(())
            }
            Err(error) => {
                eprintln!(
                    "imgconvert: cannot save settings to {}: {error}",
                    path.display()
                );
                self.last_error = Some(error.to_string());
                cx.notify();
                Err(error)
            }
        }
    }
}

/// Writes the application's settings now if they changed. Used on quit.
pub fn flush(cx: &mut App) {
    if let Some(models) = cx.try_global::<AppModels>() {
        let settings = models.settings().clone();
        settings.update(cx, |model, cx| {
            let _ = model.flush(cx);
        });
    }
}

/// Registers the quit-time flush. The subscription lives for the process.
pub fn flush_on_quit(cx: &mut App) {
    cx.on_app_quit(|cx| {
        flush(cx);
        ready(())
    })
    .detach();
}
