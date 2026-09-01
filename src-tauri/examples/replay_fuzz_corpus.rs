// SPDX-License-Identifier: Apache-2.0

use std::env;
use std::ffi::OsString;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Serialize;
use tauri_app_lib::{fuzz_external_codec_manifest, fuzz_import_scan_bytes, fuzz_pdf_document};

fn main() -> ExitCode {
    match run() {
        Ok(report) => match serde_json::to_string(&report) {
            Ok(json) => {
                println!("{json}");
                if report.failed == 0 {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::from(1)
                }
            }
            Err(error) => {
                eprintln!("Tauri fuzz corpus replay could not serialize its report: {error}");
                ExitCode::from(1)
            }
        },
        Err(error) => {
            eprintln!("Tauri fuzz corpus replay failed: {error}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<ReplayReport, String> {
    let config = Config::parse(env::args_os().skip(1))?;
    let targets = [
        Target::new(
            "external_codec_manifest",
            64 * 1024,
            fuzz_external_codec_manifest,
        ),
        Target::new("import_scanner", 4096, fuzz_import_scan_bytes),
        Target::new("pdf_document", 1024 * 1024, fuzz_pdf_document),
    ];
    let reports = targets
        .into_iter()
        .map(|target| replay_target(target, &config))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ReplayReport::from_targets(reports))
}

struct Config {
    corpus_root: PathBuf,
    artifacts_root: PathBuf,
    include_artifacts: bool,
}

impl Config {
    fn parse(args: impl Iterator<Item = OsString>) -> Result<Self, String> {
        let mut config = Self {
            corpus_root: PathBuf::from("src-tauri/fuzz/corpus"),
            artifacts_root: PathBuf::from("src-tauri/fuzz/artifacts"),
            include_artifacts: true,
        };
        let mut args = args.peekable();
        while let Some(argument) = args.next() {
            let argument = argument
                .into_string()
                .map_err(|_| "arguments must be valid UTF-8".to_string())?;
            match argument.as_str() {
                "--include-artifacts" => config.include_artifacts = true,
                "--no-artifacts" => config.include_artifacts = false,
                "--corpus-root" => {
                    config.corpus_root = next_path_arg(&mut args, "--corpus-root")?;
                }
                "--artifacts-root" => {
                    config.artifacts_root = next_path_arg(&mut args, "--artifacts-root")?;
                }
                _ => return Err(format!("unknown argument: {argument}")),
            }
        }
        Ok(config)
    }
}

fn next_path_arg(
    args: &mut std::iter::Peekable<impl Iterator<Item = OsString>>,
    label: &str,
) -> Result<PathBuf, String> {
    args.next()
        .map(PathBuf::from)
        .ok_or_else(|| format!("{label} requires a path"))
}

#[derive(Clone, Copy)]
struct Target {
    name: &'static str,
    max_bytes: u64,
    replay: fn(&[u8]),
}

impl Target {
    const fn new(name: &'static str, max_bytes: u64, replay: fn(&[u8])) -> Self {
        Self {
            name,
            max_bytes,
            replay,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayReport {
    schema_version: u8,
    total_files: u64,
    passed: u64,
    skipped: u64,
    failed: u64,
    targets: Vec<TargetReport>,
}

impl ReplayReport {
    fn from_targets(targets: Vec<TargetReport>) -> Self {
        Self {
            schema_version: 1,
            total_files: targets.iter().map(|target| target.total_files).sum(),
            passed: targets.iter().map(|target| target.passed).sum(),
            skipped: targets.iter().map(|target| target.skipped).sum(),
            failed: targets.iter().map(|target| target.failed).sum(),
            targets,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetReport {
    name: &'static str,
    total_files: u64,
    passed: u64,
    skipped: u64,
    failed: u64,
    failures: Vec<Failure>,
}

#[derive(Serialize)]
struct Failure {
    path: String,
    kind: &'static str,
    message: String,
}

fn replay_target(target: Target, config: &Config) -> Result<TargetReport, String> {
    let mut inputs = Vec::new();
    collect_files(&config.corpus_root.join(target.name), &mut inputs)?;
    if config.include_artifacts {
        collect_files(&config.artifacts_root.join(target.name), &mut inputs)?;
    }
    inputs.sort();
    inputs.dedup();

    let mut report = TargetReport {
        name: target.name,
        total_files: 0,
        passed: 0,
        skipped: 0,
        failed: 0,
        failures: Vec::new(),
    };
    for path in inputs {
        report.total_files += 1;
        let report_path = report_path(&path, config);
        match replay_file(target, &path, &report_path) {
            Ok(ReplayOutcome::Passed) => report.passed += 1,
            Ok(ReplayOutcome::Skipped) => report.skipped += 1,
            Err(failure) => {
                report.failed += 1;
                report.failures.push(failure);
            }
        }
    }
    Ok(report)
}

enum ReplayOutcome {
    Passed,
    Skipped,
}

fn replay_file(target: Target, path: &Path, report_path: &str) -> Result<ReplayOutcome, Failure> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| failure(report_path, "read", error))?;
    if !metadata.file_type().is_file() || metadata.len() > target.max_bytes {
        return Ok(ReplayOutcome::Skipped);
    }
    let bytes = fs::read(path).map_err(|error| failure(report_path, "read", error))?;
    match catch_unwind(AssertUnwindSafe(|| (target.replay)(&bytes))) {
        Ok(()) => Ok(ReplayOutcome::Passed),
        Err(_) => Err(Failure {
            path: report_path.to_string(),
            kind: "panic",
            message: "target panicked".to_string(),
        }),
    }
}

fn failure(path: &str, kind: &'static str, error: impl std::fmt::Display) -> Failure {
    Failure {
        path: path.to_string(),
        kind,
        message: error.to_string(),
    }
}

fn report_path(path: &Path, config: &Config) -> String {
    for (label, root) in [
        ("corpus", &config.corpus_root),
        ("artifacts", &config.artifacts_root),
    ] {
        if let Ok(relative) = path.strip_prefix(root) {
            return format!("{label}/{}", relative.display());
        }
    }
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "<input>".to_string())
}

fn collect_files(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let Ok(metadata) = fs::symlink_metadata(root) else {
        return Ok(());
    };
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    if metadata.is_file() {
        files.push(root.to_path_buf());
        return Ok(());
    }
    if !metadata.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|error| format!("{}: {error}", root.display()))? {
        let entry = entry.map_err(|error| format!("{}: {error}", root.display()))?;
        collect_files(&entry.path(), files)?;
    }
    Ok(())
}
