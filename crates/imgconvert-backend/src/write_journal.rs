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
use std::collections::{BTreeMap, BTreeSet};
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
/// One recovery at a time: two would read and delete each other's carried
/// files.
static RECOVERY: Mutex<()> = Mutex::new(());
static NEXT_OP: AtomicU64 = AtomicU64::new(1);

thread_local! {
    /// The write in progress on this thread (writes are synchronous).
    static CURRENT: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
    /// Set when the current write must stay unresolved.
    static RETAINED: Cell<bool> = const { Cell::new(false) };
    /// Set when the current write staged a backup; its end is then synced.
    static STAGED: Cell<bool> = const { Cell::new(false) };
}

struct Journal {
    dir: PathBuf,
    path: PathBuf,
    /// Prefix that makes op ids unique across processes and carried files.
    id: String,
    file: Mutex<File>,
}

/// Op ids are `<journal id>:<n>`, unique across every journal, so records
/// carried forward from several journals never merge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Record {
    /// A temporary output is about to be created.
    Tmp { op: String, path: PathBuf },
    /// `out` is about to be moved to `backup`.
    Backup {
        op: String,
        out: PathBuf,
        path: PathBuf,
    },
    /// The write is over; nothing of it needs recovery.
    End { op: String },
}

impl Record {
    fn op(&self) -> &str {
        match self {
            Record::Tmp { op, .. } | Record::Backup { op, .. } | Record::End { op } => op,
        }
    }
}

fn unique_suffix() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos())
    )
}

fn append(record: &Record, sync: bool) -> io::Result<()> {
    let Some(journal) = JOURNAL.get() else {
        return Ok(());
    };
    let mut line = serde_json::to_vec(record).map_err(io::Error::other)?;
    line.push(b'\n');
    let mut file = journal
        .file
        .lock()
        .map_err(|_| io::Error::other("write journal lock poisoned"))?;
    file.write_all(&line)?;
    if sync {
        file.sync_data()?;
    }
    Ok(())
}

/// One output write. Dropping it records the end of the write unless
/// [`retain_current`] was called during it.
pub(crate) struct Op {
    id: Option<String>,
}

impl Op {
    /// Starts a write on this thread.
    pub(crate) fn start() -> Self {
        let Some(journal) = JOURNAL.get() else {
            return Self { id: None };
        };
        let id = format!("{}:{}", journal.id, NEXT_OP.fetch_add(1, Ordering::Relaxed));
        CURRENT.with(|current| *current.borrow_mut() = Some(id.clone()));
        RETAINED.with(|retained| retained.set(false));
        STAGED.with(|staged| staged.set(false));
        Self { id: Some(id) }
    }
}

/// Leaves the current write unresolved so the next start retries it.
pub(crate) fn retain_current() {
    RETAINED.with(|retained| retained.set(true));
}

impl Drop for Op {
    fn drop(&mut self) {
        let Some(op) = self.id.take() else {
            return;
        };
        CURRENT.with(|current| *current.borrow_mut() = None);
        let staged = STAGED.with(Cell::take);
        if !RETAINED.with(Cell::take) {
            // Unsynced unless a backup was staged: a lost end record then
            // only means recovery finds the files already gone. With a
            // backup the end is the commit marker and must not outlive a
            // rename that did not reach the disk.
            let _ = append(&Record::End { op }, staged);
        }
    }
}

fn current() -> Option<String> {
    CURRENT.with(|current| current.borrow().clone())
}

/// Records a temporary output before it is created. Best effort: an
/// unrecorded temporary can only be left behind, never lose data.
pub(crate) fn note_tmp(path: &Path) {
    if let Some(op) = current() {
        let _ = append(
            &Record::Tmp {
                op,
                path: path.to_path_buf(),
            },
            true,
        );
    }
}

/// Records that `out` is about to be staged aside as `backup`. The caller
/// must not stage when this fails: the previous output would otherwise only
/// exist under a name nothing points to.
pub(crate) fn note_backup(out: &Path, backup: &Path) -> io::Result<()> {
    let Some(op) = current() else {
        return Ok(());
    };
    append(
        &Record::Backup {
            op,
            out: out.to_path_buf(),
            path: backup.to_path_buf(),
        },
        true,
    )?;
    STAGED.with(|staged| staged.set(true));
    Ok(())
}

/// Syncs a directory after a rename inside it (best effort; Unix only, as
/// Windows offers no directory handle to flush).
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
    /// Operations left for a later attempt (inaccessible, unmounted, or in
    /// an unexpected state).
    pub retained: usize,
    /// Journals that could not be read completely; renamed `*.unreadable`
    /// and kept.
    pub unreadable: usize,
}

/// Recovers every journal in `dir`, then starts this process's journal there.
/// Call once, while holding the single-instance marker, before any write.
pub fn recover_and_install(dir: &Path) -> io::Result<RecoveryReport> {
    fs::create_dir_all(dir)?;
    let report = recover(dir, None);
    let id = unique_suffix();
    let path = dir.join(format!("{id}.jsonl"));
    let file = OpenOptions::new()
        .create_new(true)
        .append(true)
        .open(&path)?;
    let _ = JOURNAL.set(Journal {
        dir: dir.to_path_buf(),
        path,
        id,
        file: Mutex::new(file),
    });
    Ok(report)
}

/// Retries what earlier runs left unresolved, for example after the user
/// grants access to an output folder again (the Mac App Store sandbox keeps
/// no access across launches). This run's own journal is never touched.
pub fn retry_retained() -> RecoveryReport {
    match JOURNAL.get() {
        Some(journal) => recover(&journal.dir, Some(&journal.path)),
        None => RecoveryReport::default(),
    }
}

fn recover(dir: &Path, own: Option<&Path>) -> RecoveryReport {
    let _serialized = RECOVERY
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut report = RecoveryReport::default();
    let Ok(entries) = fs::read_dir(dir) else {
        return report;
    };
    let mut journals: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .filter(|path| Some(path.as_path()) != own)
        .collect();
    journals.sort();
    let mut ops: BTreeMap<String, Vec<Record>> = BTreeMap::new();
    let mut ended = BTreeSet::new();
    let mut consumed = Vec::new();
    let mut damaged = Vec::new();
    for journal in &journals {
        let records = match read_journal(journal) {
            Ok(records) => {
                consumed.push(journal.clone());
                records
            }
            Err(Unreadable::Missing) => continue,
            // Every readable record is still recovered; the file is kept
            // under another name for inspection instead of retried.
            Err(Unreadable::Partly(records)) => {
                damaged.push(journal.clone());
                records
            }
        };
        for record in records {
            match record {
                Record::End { op } => {
                    ended.insert(op);
                }
                record => ops.entry(record.op().to_string()).or_default().push(record),
            }
        }
    }
    let mut retained = Vec::new();
    for (op, records) in &ops {
        if ended.contains(op) {
            continue;
        }
        let mut keep = recover_op(records, &mut report);
        if !keep.is_empty() {
            report.retained += 1;
            retained.append(&mut keep);
        }
    }
    // Carry unresolved entries forward before removing the sources, so a
    // crash here loses nothing; a source that cannot be removed only
    // repeats idempotent work next time.
    if !retained.is_empty() {
        // Written under a name recovery ignores, then renamed into place.
        let name = format!("retained-{}", unique_suffix());
        let staging = dir.join(format!("{name}.partial"));
        let written = File::create(&staging).and_then(|mut file| {
            for record in &retained {
                let mut line = serde_json::to_vec(record).map_err(io::Error::other)?;
                line.push(b'\n');
                file.write_all(&line)?;
            }
            file.sync_all()
        });
        if written
            .and_then(|()| fs::rename(&staging, dir.join(format!("{name}.jsonl"))))
            .is_err()
        {
            let _ = fs::remove_file(&staging);
            return report;
        }
    }
    for journal in consumed {
        let _ = fs::remove_file(journal);
    }
    for journal in damaged {
        report.unreadable += 1;
        let _ = fs::rename(&journal, journal.with_extension("unreadable"));
    }
    sync_dir(dir);
    report
}

enum Unreadable {
    /// Gone between listing and reading.
    Missing,
    /// Not fully readable; the records before the damage.
    Partly(Vec<Record>),
}

/// Reads a journal. A torn final line (a crash mid-append) is normal; any
/// other damage marks the journal unreadable, with every parseable record
/// still returned.
fn read_journal(journal: &Path) -> Result<Vec<Record>, Unreadable> {
    let file = match File::open(journal) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Err(Unreadable::Missing),
        Err(_) => return Err(Unreadable::Partly(Vec::new())),
    };
    let mut records = Vec::new();
    let mut pending_damage = false;
    let mut damaged = false;
    for line in BufReader::new(file).split(b'\n') {
        let Ok(line) = line else {
            damaged = true;
            break;
        };
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        // A bad line followed by more lines is not a torn tail.
        damaged |= pending_damage;
        match serde_json::from_slice::<Record>(&line) {
            Ok(record) => {
                records.push(record);
                pending_damage = false;
            }
            Err(_) => pending_damage = true,
        }
    }
    if damaged {
        Err(Unreadable::Partly(records))
    } else {
        Ok(records)
    }
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

/// Whether `path` is absent from a folder that can be inspected. An
/// unmounted volume or a folder without access is not "absent": the entry
/// is then kept.
fn absent(path: &Path) -> Result<bool, ()> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or(())?;
            match fs::metadata(parent) {
                Ok(metadata) if metadata.is_dir() => Ok(true),
                _ => Err(()),
            }
        }
        Err(_) => Err(()),
    }
}

/// The backup holds the previous output. Put it back when the new output
/// never arrived; drop it when the new output is in place. Anything else is
/// left alone and kept.
fn restore_backup(out: &Path, backup: &Path, tmp: Option<&Path>) -> Result<Option<Outcome>, ()> {
    if !is_named(backup, is_backup_name) {
        return Ok(None);
    }
    if absent(backup)? {
        // Done only with positive evidence: the output is there. A missing
        // backup and a missing output may be an unmounted volume whose
        // mount point is an empty folder.
        return if absent(out)? { Err(()) } else { Ok(None) };
    }
    if absent(out)? {
        fs::rename(backup, out).map_err(|_| ())?;
        if let Some(parent) = out.parent() {
            sync_dir(parent);
        }
        return Ok(Some(Outcome::Restored));
    }
    // The new output was placed only if its temporary file is gone.
    let placed = match tmp {
        None => true,
        Some(tmp) => absent(tmp)?,
    };
    if !placed {
        return Err(());
    }
    // A staged directory link (Windows) is removed as a directory entry,
    // as the regular cleanup does; nothing is removed recursively.
    fs::remove_file(backup)
        .or_else(|_| fs::remove_dir(backup))
        .map_err(|_| ())?;
    Ok(Some(Outcome::Removed))
}

/// Removes a leftover temporary output. Only a regular file with the
/// temporary-name pattern is removed.
fn remove_temporary(path: &Path) -> Result<bool, ()> {
    if !is_named(path, is_temporary_name) {
        return Ok(false);
    }
    if absent(path)? {
        return Ok(false);
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
    if !metadata.file_type().is_file() {
        // Not ours to touch.
        return Ok(false);
    }
    fs::remove_file(path).map_err(|_| ())?;
    Ok(true)
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
                    op: "j:1".into(),
                    path: leftover.clone(),
                },
                Record::Tmp {
                    op: "j:2".into(),
                    path: finished.clone(),
                },
                Record::End { op: "j:2".into() },
                Record::Tmp {
                    op: "j:3".into(),
                    path: out.join("photo.png"),
                },
            ],
        );
        fs::write(out.join("photo.png"), b"user").unwrap();
        let report = recover(&journal, None);
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
                    op: "j:1".into(),
                    path: tmp.clone(),
                },
                Record::Backup {
                    op: "j:1".into(),
                    out: target.clone(),
                    path: backup.clone(),
                },
            ],
        );
        let report = recover(&journal, None);
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
                    op: "j:1".into(),
                    path: out.join(".imgconvert-1-1-1.tmp"),
                },
                Record::Backup {
                    op: "j:1".into(),
                    out: target.clone(),
                    path: backup.clone(),
                },
            ],
        );
        let report = recover(&journal, None);
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
                    op: "j:1".into(),
                    path: tmp.clone(),
                },
                Record::Backup {
                    op: "j:1".into(),
                    out: target.clone(),
                    path: backup.clone(),
                },
            ],
        );
        let report = recover(&journal, None);
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
        assert_eq!(recover(&journal, None).retained, 1);
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
                op: "j:1".into(),
                path: leftover.clone(),
            }],
        );
        let mut file = OpenOptions::new()
            .append(true)
            .open(journal.join("1-1.jsonl"))
            .unwrap();
        write!(file, "{{\"kind\":\"end\",\"op\"").unwrap();
        recover(&journal, None);
        assert!(!leftover.exists());
    }

    #[test]
    fn an_unavailable_output_folder_keeps_the_entries() {
        let (journal, out) = scratch("unmounted");
        let gone = out.join("unmounted-volume");
        journal_with(
            &journal,
            &[
                Record::Tmp {
                    op: "j:1".into(),
                    path: gone.join(".imgconvert-1-1-1.tmp"),
                },
                Record::Backup {
                    op: "j:1".into(),
                    out: gone.join("photo.avif"),
                    path: gone.join("imgconvert-backup-1-1-1"),
                },
            ],
        );
        let report = recover(&journal, None);
        assert_eq!(
            report.retained, 1,
            "a missing folder is not proof of completion"
        );
        assert!(report.removed.is_empty() && report.restored.is_empty());
        assert_eq!(fs::read_dir(&journal).unwrap().count(), 1);
    }

    #[test]
    fn damage_before_the_last_line_keeps_the_journal() {
        let (journal, out) = scratch("damaged");
        let leftover = out.join(".imgconvert-1-1-1.tmp");
        fs::write(&leftover, b"x").unwrap();
        let mut file = File::create(journal.join("1-1.jsonl")).unwrap();
        writeln!(file, "not json").unwrap();
        writeln!(
            file,
            "{}",
            serde_json::to_string(&Record::Tmp {
                op: "j:1".into(),
                path: leftover.clone(),
            })
            .unwrap()
        )
        .unwrap();
        drop(file);
        let report = recover(&journal, None);
        assert_eq!(report.unreadable, 1);
        assert!(
            !leftover.exists(),
            "records after the damage are still recovered"
        );
        assert!(
            journal.join("1-1.unreadable").exists(),
            "kept for inspection"
        );
        assert!(!journal.join("1-1.jsonl").exists(), "not retried forever");
    }

    #[test]
    fn operations_of_different_journals_never_merge() {
        let (journal, out) = scratch("ids");
        let target = out.join("photo.avif");
        let backup = out.join("imgconvert-backup-1-1-1");
        let other_tmp = out.join(".imgconvert-2-2-2.tmp");
        fs::write(&target, b"other").unwrap();
        fs::write(&backup, b"previous").unwrap();
        // The backup's own write left its temporary behind (never placed);
        // an unrelated journal's finished write must not count as placement.
        fs::write(out.join(".imgconvert-1-1-1.tmp"), b"new").unwrap();
        let mut a = File::create(journal.join("a.jsonl")).unwrap();
        for record in [
            Record::Tmp {
                op: "a:1".into(),
                path: out.join(".imgconvert-1-1-1.tmp"),
            },
            Record::Backup {
                op: "a:1".into(),
                out: target.clone(),
                path: backup.clone(),
            },
        ] {
            writeln!(a, "{}", serde_json::to_string(&record).unwrap()).unwrap();
        }
        let mut b = File::create(journal.join("b.jsonl")).unwrap();
        writeln!(
            b,
            "{}",
            serde_json::to_string(&Record::Tmp {
                op: "b:1".into(),
                path: other_tmp,
            })
            .unwrap()
        )
        .unwrap();
        drop((a, b));
        recover(&journal, None);
        assert_eq!(fs::read(&backup).unwrap(), b"previous");
    }

    #[test]
    fn retrying_skips_nothing_but_this_runs_journal() {
        let (journal, out) = scratch("retry");
        let leftover = out.join(".imgconvert-1-1-1.tmp");
        fs::write(&leftover, b"x").unwrap();
        journal_with(
            &journal,
            &[Record::Tmp {
                op: "j:1".into(),
                path: leftover.clone(),
            }],
        );
        let own = journal.join("1-1.jsonl");
        assert_eq!(recover(&journal, Some(&own)), RecoveryReport::default());
        assert!(leftover.exists());
        assert!(!recover(&journal, None).removed.is_empty());
    }

    /// The real write path journals every operation and ends each one. The
    /// journal is process-wide; other tests in this binary then journal into
    /// the same scratch folder, which changes nothing they observe.
    #[test]
    fn real_writes_are_journaled_and_ended() {
        let (journal, out) = scratch("e2e");
        recover_and_install(&journal).unwrap();
        let own = JOURNAL.get().unwrap().path.clone();
        let input = out.join("in.png");
        fs::write(&input, crate::convert::tests::one_by_one_png()).unwrap();
        let mut options = crate::convert::default_conversion_options(
            input.to_string_lossy().into_owned(),
            Some(out.join("converted").to_string_lossy().into_owned()),
            "png".into(),
        );
        options.overwrite = true;
        options.overwrite_mode = Some("overwrite".into());
        crate::convert::convert(&options).unwrap();
        crate::convert::convert(&options).unwrap();
        let records = read_journal(&own).ok().unwrap();
        let mine: Vec<_> = records
            .iter()
            .filter(|record| match record {
                Record::Tmp { path, .. } => path.starts_with(out.join("converted")),
                _ => false,
            })
            .map(|record| record.op().to_string())
            .collect();
        assert_eq!(mine.len(), 2, "one temporary per write: {records:?}");
        for op in &mine {
            assert!(
                records
                    .iter()
                    .any(|record| matches!(record, Record::End { op: ended } if ended == op)),
                "{op} has an end record"
            );
        }
        assert_eq!(
            retry_retained(),
            RecoveryReport::default(),
            "own journal untouched"
        );
    }

    #[test]
    fn an_end_before_the_damage_still_ends_its_write() {
        let (journal, out) = scratch("damaged-end");
        let target = out.join("photo.avif");
        let backup = out.join("imgconvert-backup-1-1-1");
        fs::write(&target, b"new").unwrap();
        fs::write(&backup, b"kept on purpose").unwrap();
        let mut file = File::create(journal.join("1-1.jsonl")).unwrap();
        for record in [
            Record::Backup {
                op: "j:1".into(),
                out: target.clone(),
                path: backup.clone(),
            },
            Record::End { op: "j:1".into() },
        ] {
            writeln!(file, "{}", serde_json::to_string(&record).unwrap()).unwrap();
        }
        writeln!(file, "damage").unwrap();
        writeln!(file, "{{}}").unwrap();
        drop(file);
        recover(&journal, None);
        assert!(backup.exists(), "an ended write is not replayed");
    }

    #[test]
    fn a_missing_backup_without_its_output_is_kept() {
        // An unmounted volume whose mount point stays as an empty folder.
        let (journal, out) = scratch("mountpoint");
        journal_with(
            &journal,
            &[Record::Backup {
                op: "j:1".into(),
                out: out.join("photo.avif"),
                path: out.join("imgconvert-backup-1-1-1"),
            }],
        );
        assert_eq!(recover(&journal, None).retained, 1);
        // With the output present the write is known to be done.
        fs::write(out.join("photo.avif"), b"x").unwrap();
        assert_eq!(recover(&journal, None).retained, 0);
        assert_eq!(fs::read_dir(&journal).unwrap().count(), 0);
    }

    #[test]
    fn carried_operations_stay_separate_across_recoveries() {
        let (journal, out) = scratch("carry");
        let gone = out.join("unmounted");
        let mut records = Vec::new();
        for n in 1..=2 {
            records.push(Record::Backup {
                op: format!("j:{n}"),
                out: gone.join(format!("photo{n}.avif")),
                path: gone.join(format!("imgconvert-backup-1-1-{n}")),
            });
        }
        journal_with(&journal, &records);
        assert_eq!(recover(&journal, None).retained, 2);
        assert_eq!(
            recover(&journal, None).retained,
            2,
            "ids survive being carried"
        );
        // The volume returns with both previous outputs staged aside.
        fs::create_dir_all(&gone).unwrap();
        for n in 1..=2 {
            fs::write(
                gone.join(format!("imgconvert-backup-1-1-{n}")),
                format!("{n}"),
            )
            .unwrap();
        }
        let report = recover(&journal, None);
        assert_eq!(report.restored.len(), 2);
        assert_eq!(fs::read(gone.join("photo2.avif")).unwrap(), b"2");
    }

    #[test]
    fn retrying_recovers_other_journals_and_skips_this_runs() {
        let (journal, out) = scratch("retry-other");
        let mine = out.join(".imgconvert-1-1-1.tmp");
        let theirs = out.join(".imgconvert-2-2-2.tmp");
        fs::write(&mine, b"x").unwrap();
        fs::write(&theirs, b"x").unwrap();
        for (name, path) in [("own", &mine), ("old", &theirs)] {
            let mut file = File::create(journal.join(format!("{name}.jsonl"))).unwrap();
            let record = Record::Tmp {
                op: format!("{name}:1"),
                path: path.clone(),
            };
            writeln!(file, "{}", serde_json::to_string(&record).unwrap()).unwrap();
        }
        let report = recover(&journal, Some(&journal.join("own.jsonl")));
        assert_eq!(report.removed, vec![theirs.clone()]);
        assert!(mine.exists());
        assert!(journal.join("own.jsonl").exists());
    }
}
