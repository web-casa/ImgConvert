// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Write-ahead journal for output writes (docs/GPUI_MACOS_LIFECYCLE_PLAN.md
//! §2.3, L5).
//!
//! An output write creates a hidden temporary file next to the output and,
//! when an existing output has to be staged aside (Windows), an
//! `imgconvert-backup-*` file. A forced quit, crash or shutdown timeout
//! between those steps leaves them behind, and in the staging case the
//! user's previous output only exists under the backup name.
//!
//! Before each of those files is created the path is appended to this
//! process's journal and synced; when the write is over a terminal record
//! follows. The journal lives in the application data directory, never in
//! the user's folders, and the user's folders are never scanned: recovery
//! only touches paths the journal names.
//!
//! The shell calls [`recover_and_install`] once at startup, after it holds
//! the single-instance marker and before any conversion: every journal it
//! finds then belongs to a process that has ended. Without an installed
//! journal (tests, the Tauri shell) recording does nothing.

use std::cell::Cell;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// The journal directory's name under the application data directory.
pub const JOURNAL_DIR_NAME: &str = "pending-writes";

static JOURNAL: OnceLock<Journal> = OnceLock::new();
static NEXT_OP: AtomicU64 = AtomicU64::new(1);

thread_local! {
    /// The write in progress on this thread (writes are synchronous).
    static CURRENT: Cell<Option<u64>> = const { Cell::new(None) };
    /// Set when the current write must stay unresolved.
    static RETAINED: Cell<bool> = const { Cell::new(false) };
}

struct Journal {
    file: Mutex<File>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Record {
    /// A temporary output is about to be created.
    Tmp { op: u64, path: PathBuf },
    /// `out` is about to be moved to `backup`.
    Backup {
        op: u64,
        out: PathBuf,
        path: PathBuf,
    },
    /// The write is over; nothing of it needs recovery.
    End { op: u64 },
}

impl Record {
    fn op(&self) -> u64 {
        match self {
            Record::Tmp { op, .. } | Record::Backup { op, .. } | Record::End { op } => *op,
        }
    }
}

fn append(record: &Record, sync: bool) {
    let Some(journal) = JOURNAL.get() else {
        return;
    };
    let Ok(mut line) = serde_json::to_vec(record) else {
        return;
    };
    line.push(b'\n');
    let Ok(mut file) = journal.file.lock() else {
        return;
    };
    // Best effort: a write that cannot be journaled still proceeds, as it
    // did before the journal existed.
    if file.write_all(&line).is_ok() && sync {
        let _ = file.sync_data();
    }
}

/// One output write. Dropping it records the end of the write unless
/// [`retain_current`] was called during it.
pub(crate) struct Op {
    id: Option<u64>,
}

impl Op {
    /// Starts a write on this thread.
    pub(crate) fn start() -> Self {
        if JOURNAL.get().is_none() {
            return Self { id: None };
        }
        let id = NEXT_OP.fetch_add(1, Ordering::Relaxed);
        CURRENT.with(|current| current.set(Some(id)));
        RETAINED.with(|retained| retained.set(false));
        Self { id: Some(id) }
    }
}

/// Leaves the current write unresolved: the previous output could not be
/// put back, and the next start retries.
pub(crate) fn retain_current() {
    RETAINED.with(|retained| retained.set(true));
}

impl Drop for Op {
    fn drop(&mut self) {
        let Some(op) = self.id else {
            return;
        };
        CURRENT.with(|current| current.set(None));
        if !RETAINED.with(Cell::take) {
            // Not synced: a lost end record only means recovery finds the
            // files already gone.
            append(&Record::End { op }, false);
        }
    }
}

fn current() -> Option<u64> {
    CURRENT.with(Cell::get)
}

/// Records a temporary output before it is created.
pub(crate) fn note_tmp(path: &Path) {
    if let Some(op) = current() {
        append(
            &Record::Tmp {
                op,
                path: path.to_path_buf(),
            },
            true,
        );
    }
}

/// Records that `out` is about to be staged aside as `backup`.
pub(crate) fn note_backup(out: &Path, backup: &Path) {
    if let Some(op) = current() {
        append(
            &Record::Backup {
                op,
                out: out.to_path_buf(),
                path: backup.to_path_buf(),
            },
            true,
        );
    }
}

/// Syncs a directory after a rename inside it (best effort; Unix only).
pub(crate) fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(handle) = File::open(dir) {
        let _ = handle.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

/// What recovery did, for the diagnostic log.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RecoveryReport {
    /// Previous outputs moved back from their backup name.
    pub restored: Vec<PathBuf>,
    /// Temporary outputs and stale backups removed.
    pub removed: Vec<PathBuf>,
    /// Entries left for a later start (inaccessible, or unexpected state).
    pub retained: usize,
}

/// Recovers every journal in `dir`, then starts this process's journal there.
/// Call once, while holding the single-instance marker, before any write.
pub fn recover_and_install(dir: &Path) -> io::Result<RecoveryReport> {
    fs::create_dir_all(dir)?;
    let report = recover(dir);
    let name = format!(
        "{}-{}.jsonl",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos())
    );
    let file = OpenOptions::new()
        .create_new(true)
        .append(true)
        .open(dir.join(name))?;
    let _ = JOURNAL.set(Journal {
        file: Mutex::new(file),
    });
    Ok(report)
}

fn recover(dir: &Path) -> RecoveryReport {
    let mut report = RecoveryReport::default();
    let Ok(entries) = fs::read_dir(dir) else {
        return report;
    };
    let mut journals: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .collect();
    journals.sort();
    let mut retained = Vec::new();
    for journal in &journals {
        for (_, records) in unresolved_ops(journal) {
            let mut keep = recover_op(&records, &mut report);
            retained.append(&mut keep);
        }
    }
    report.retained = retained
        .iter()
        .map(Record::op)
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    // Carry unresolved entries forward before removing the old journals, so
    // a crash here loses nothing.
    if !retained.is_empty() {
        let carried = dir.join(format!(
            "retained-{}.jsonl",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_nanos())
        ));
        let written = File::create(&carried).and_then(|mut file| {
            for record in &retained {
                let mut line = serde_json::to_vec(record).map_err(io::Error::other)?;
                line.push(b'\n');
                file.write_all(&line)?;
            }
            file.sync_all()
        });
        if written.is_err() {
            // Keep the originals rather than risk losing the entries.
            let _ = fs::remove_file(&carried);
            return report;
        }
    }
    for journal in journals {
        let _ = fs::remove_file(journal);
    }
    sync_dir(dir);
    report
}

/// The records of every operation in `journal` that has no end record. Op
/// ids are only unique within one journal.
fn unresolved_ops(journal: &Path) -> BTreeMap<u64, Vec<Record>> {
    let mut ops: BTreeMap<u64, Vec<Record>> = BTreeMap::new();
    let Ok(file) = File::open(journal) else {
        return ops;
    };
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else {
            break;
        };
        // A torn last line from a crash is skipped.
        let Ok(record) = serde_json::from_str::<Record>(&line) else {
            continue;
        };
        match record {
            Record::End { op } => {
                ops.remove(&op);
            }
            record => ops.entry(record.op()).or_default().push(record),
        }
    }
    ops
}

/// Resolves one interrupted write. Returns the records to keep for later.
fn recover_op(records: &[Record], report: &mut RecoveryReport) -> Vec<Record> {
    let mut keep = Vec::new();
    let tmp = records.iter().find_map(|record| match record {
        Record::Tmp { path, .. } => Some(path.as_path()),
        _ => None,
    });
    // Backups first: whether the new output was placed is read from the
    // temporary file, which the second pass removes.
    let mut backup_kept = false;
    for record in records {
        if let Record::Backup { out, path, .. } = record {
            match restore_backup(out, path, tmp) {
                Ok(Some(Outcome::Restored)) => report.restored.push(out.clone()),
                Ok(Some(Outcome::Removed)) => report.removed.push(path.clone()),
                Ok(None) => {}
                Err(()) => {
                    backup_kept = true;
                    keep.push(record.clone());
                }
            }
        }
    }
    for record in records {
        if let Record::Tmp { path, .. } = record {
            // While a backup is unresolved its temporary file is the
            // evidence that the new output was never placed; keep both.
            if backup_kept {
                keep.push(record.clone());
                continue;
            }
            match remove_temporary(path) {
                Ok(true) => report.removed.push(path.clone()),
                Ok(false) => {}
                Err(()) => keep.push(record.clone()),
            }
        }
    }
    keep
}

enum Outcome {
    Restored,
    Removed,
}

/// The backup holds the previous output. Put it back when the new output
/// never arrived; drop it when the new output is in place. Anything else is
/// left alone and kept.
fn restore_backup(out: &Path, backup: &Path, tmp: Option<&Path>) -> Result<Option<Outcome>, ()> {
    if !is_named(backup, is_backup_name) {
        return Ok(None);
    }
    match fs::symlink_metadata(backup) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
        Ok(_) => {}
    }
    match fs::symlink_metadata(out) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::rename(backup, out).map_err(|_| ())?;
            if let Some(parent) = out.parent() {
                sync_dir(parent);
            }
            Ok(Some(Outcome::Restored))
        }
        Err(_) => Err(()),
        Ok(_) => {
            // The new output was placed only if its temporary file is gone.
            let placed = tmp.is_none_or(|tmp| {
                matches!(fs::symlink_metadata(tmp), Err(error) if error.kind() == io::ErrorKind::NotFound)
            });
            if placed {
                fs::remove_file(backup).map_err(|_| ())?;
                Ok(Some(Outcome::Removed))
            } else {
                Err(())
            }
        }
    }
}

/// Removes a leftover temporary output. Only a regular file with the
/// temporary-name pattern is removed.
fn remove_temporary(path: &Path) -> Result<bool, ()> {
    if !is_named(path, is_temporary_name) {
        return Ok(false);
    }
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(()),
        Ok(metadata) if metadata.file_type().is_file() => {
            fs::remove_file(path).map_err(|_| ())?;
            Ok(true)
        }
        // Not ours to touch.
        Ok(_) => Ok(false),
    }
}

fn is_named(path: &Path, rule: fn(&str) -> bool) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(rule)
}

/// `.imgconvert-<pid>-<nanos>-<counter>.tmp`
fn is_temporary_name(name: &str) -> bool {
    name.strip_prefix(".imgconvert-")
        .and_then(|rest| rest.strip_suffix(".tmp"))
        .is_some_and(three_numbers)
}

/// `imgconvert-backup-<pid>-<nanos>-<counter>`
fn is_backup_name(name: &str) -> bool {
    name.strip_prefix("imgconvert-backup-")
        .is_some_and(three_numbers)
}

fn three_numbers(text: &str) -> bool {
    let parts: Vec<_> = text.split('-').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn journal_with(dir: &Path, records: &[Record]) {
        let mut file = File::create(dir.join("1-1.jsonl")).unwrap();
        for record in records {
            writeln!(file, "{}", serde_json::to_string(record).unwrap()).unwrap();
        }
    }

    fn scratch(name: &str) -> (PathBuf, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("imgconvert-journal-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let journal = root.join("journal");
        let out = root.join("out");
        fs::create_dir_all(&journal).unwrap();
        fs::create_dir_all(&out).unwrap();
        (journal, out)
    }

    #[test]
    fn names_match_only_the_generated_patterns() {
        assert!(is_temporary_name(".imgconvert-12-345-6.tmp"));
        assert!(!is_temporary_name(".imgconvert-12-345.tmp"));
        assert!(!is_temporary_name(".imgconvert-a-345-6.tmp"));
        assert!(!is_temporary_name("photo.tmp"));
        assert!(is_backup_name("imgconvert-backup-1-2-3"));
        assert!(!is_backup_name("imgconvert-backup-1-2-3.png"));
        assert!(!is_backup_name("photo.png"));
    }

    #[test]
    fn a_leftover_temporary_is_removed_and_a_finished_write_is_left_alone() {
        let (journal, out) = scratch("tmp");
        let leftover = out.join(".imgconvert-1-1-1.tmp");
        let finished = out.join(".imgconvert-1-1-2.tmp");
        let unrelated = out.join(".imgconvert-1-1-3.tmp");
        for path in [&leftover, &finished, &unrelated] {
            fs::write(path, b"x").unwrap();
        }
        journal_with(
            &journal,
            &[
                Record::Tmp {
                    op: 1,
                    path: leftover.clone(),
                },
                Record::Tmp {
                    op: 2,
                    path: finished.clone(),
                },
                Record::End { op: 2 },
                Record::Tmp {
                    op: 3,
                    path: out.join("photo.png"),
                },
            ],
        );
        fs::write(out.join("photo.png"), b"user").unwrap();
        let report = recover(&journal);
        assert_eq!(report.removed, vec![leftover.clone()]);
        assert!(!leftover.exists());
        assert!(finished.exists(), "ended writes are not touched");
        assert!(unrelated.exists(), "unjournaled files are not touched");
        assert!(
            out.join("photo.png").exists(),
            "names outside the pattern are not touched"
        );
        assert_eq!(fs::read_dir(&journal).unwrap().count(), 0);
    }

    #[test]
    fn an_interrupted_replacement_puts_the_previous_output_back() {
        let (journal, out) = scratch("restore");
        let target = out.join("photo.avif");
        let backup = out.join("imgconvert-backup-1-1-1");
        let tmp = out.join(".imgconvert-1-1-1.tmp");
        fs::write(&backup, b"previous").unwrap();
        fs::write(&tmp, b"new").unwrap();
        journal_with(
            &journal,
            &[
                Record::Tmp {
                    op: 1,
                    path: tmp.clone(),
                },
                Record::Backup {
                    op: 1,
                    out: target.clone(),
                    path: backup.clone(),
                },
            ],
        );
        let report = recover(&journal);
        assert_eq!(report.restored, vec![target.clone()]);
        assert_eq!(fs::read(&target).unwrap(), b"previous");
        assert!(!backup.exists());
        assert!(!tmp.exists());
    }

    #[test]
    fn a_placed_replacement_drops_the_stale_backup() {
        let (journal, out) = scratch("placed");
        let target = out.join("photo.avif");
        let backup = out.join("imgconvert-backup-1-1-1");
        fs::write(&target, b"new").unwrap();
        fs::write(&backup, b"previous").unwrap();
        journal_with(
            &journal,
            &[
                Record::Tmp {
                    op: 1,
                    path: out.join(".imgconvert-1-1-1.tmp"),
                },
                Record::Backup {
                    op: 1,
                    out: target.clone(),
                    path: backup.clone(),
                },
            ],
        );
        let report = recover(&journal);
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(!backup.exists());
        assert_eq!(report.removed, vec![backup]);
    }

    #[test]
    fn an_ambiguous_replacement_is_kept_for_later() {
        let (journal, out) = scratch("ambiguous");
        let target = out.join("photo.avif");
        let backup = out.join("imgconvert-backup-1-1-1");
        let tmp = out.join(".imgconvert-1-1-1.tmp");
        // An output exists again, yet the new one was never placed.
        fs::write(&target, b"other").unwrap();
        fs::write(&backup, b"previous").unwrap();
        fs::write(&tmp, b"new").unwrap();
        journal_with(
            &journal,
            &[
                Record::Tmp {
                    op: 1,
                    path: tmp.clone(),
                },
                Record::Backup {
                    op: 1,
                    out: target.clone(),
                    path: backup.clone(),
                },
            ],
        );
        let report = recover(&journal);
        assert_eq!(
            fs::read(&backup).unwrap(),
            b"previous",
            "never deleted while ambiguous"
        );
        assert!(tmp.exists());
        assert_eq!(report.retained, 1);
        let carried: Vec<_> = fs::read_dir(&journal)
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert_eq!(carried.len(), 1, "unresolved entries are carried forward");
        // The next start sees the same state and keeps it again.
        assert_eq!(recover(&journal).retained, 1);
        assert!(backup.exists());
    }

    #[test]
    fn a_torn_last_line_is_ignored() {
        let (journal, out) = scratch("torn");
        let leftover = out.join(".imgconvert-1-1-1.tmp");
        fs::write(&leftover, b"x").unwrap();
        journal_with(
            &journal,
            &[Record::Tmp {
                op: 1,
                path: leftover.clone(),
            }],
        );
        let mut file = OpenOptions::new()
            .append(true)
            .open(journal.join("1-1.jsonl"))
            .unwrap();
        write!(file, "{{\"kind\":\"end\",\"op\"").unwrap();
        recover(&journal);
        assert!(!leftover.exists());
    }
}
