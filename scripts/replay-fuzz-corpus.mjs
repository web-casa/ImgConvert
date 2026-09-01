// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  prepare: true,
  requireReal: false,
  includeArtifacts: true,
  corpusRoot: path.join(repoRoot, "fuzz", "corpus"),
  artifactsRoot: path.join(repoRoot, "fuzz", "artifacts"),
  output: path.join(repoRoot, "target", "fuzz-corpus", "replay-report.json"),
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg === "--prepare") {
    options.prepare = true;
  } else if (arg === "--skip-prepare") {
    options.prepare = false;
  } else if (arg === "--require-real") {
    options.requireReal = true;
  } else if (arg === "--include-artifacts") {
    options.includeArtifacts = true;
  } else if (arg === "--no-artifacts") {
    options.includeArtifacts = false;
  } else if (arg.startsWith("--corpus-root=")) {
    options.corpusRoot = resolveFromRepo(arg.slice("--corpus-root=".length));
  } else if (arg.startsWith("--artifacts-root=")) {
    options.artifactsRoot = resolveFromRepo(arg.slice("--artifacts-root=".length));
  } else if (arg.startsWith("--output=")) {
    options.output = resolveFromRepo(arg.slice("--output=".length));
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (options.prepare) {
  const prepareArgs = ["scripts/prepare-fuzz-corpus.mjs"];
  if (options.requireReal) {
    prepareArgs.push("--require-real");
  }
  run(process.execPath, prepareArgs, "prepare fuzz corpus");
}

const coreReplayArgs = [
  "+1.96.0",
  "run",
  "--quiet",
  "-p",
  "imgconvert-core",
  "--example",
  "replay_fuzz_corpus",
  "--",
  "--corpus-root",
  options.corpusRoot,
  "--artifacts-root",
  options.artifactsRoot,
  options.includeArtifacts ? "--include-artifacts" : "--no-artifacts",
];

const coreReport = runJsonReplay("cargo", coreReplayArgs, "core fuzz corpus replay", [
  "decode_pipeline",
  "convert_pipeline",
  "metadata_semantics",
]);
const tauriReplayArgs = [
  "+1.96.0",
  "run",
  "--quiet",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--example",
  "replay_fuzz_corpus",
  "--no-default-features",
  "--features",
  "fuzzing",
  "--",
  "--corpus-root",
  path.join(repoRoot, "src-tauri", "fuzz", "corpus"),
  "--artifacts-root",
  path.join(repoRoot, "src-tauri", "fuzz", "artifacts"),
  options.includeArtifacts ? "--include-artifacts" : "--no-artifacts",
];
const tauriReport = runJsonReplay("cargo", tauriReplayArgs, "Tauri fuzz corpus replay", [
  "external_codec_manifest",
  "import_scanner",
  "pdf_document",
]);
const report = mergeReports(coreReport, tauriReport);

function runJsonReplay(command, args, label, expectedTargets) {
  const replay = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (replay.stderr) {
    process.stderr.write(replay.stderr);
  }
  if (replay.error) {
    fail(`failed to start ${label}: ${replay.error.message}`);
  }

  let report;
  try {
    report = JSON.parse(replay.stdout);
  } catch (error) {
    if (replay.stdout) {
      process.stdout.write(replay.stdout);
    }
    fail(`${label} did not emit valid JSON: ${error.message}`);
  }
  validateReportCoverage(report, label, expectedTargets);
  if ((replay.status ?? 1) !== 0 || report.failed > 0) {
    process.exit(replay.status ?? 1);
  }
  return report;
}

function validateReportCoverage(report, label, expectedTargets) {
  if (!report || typeof report !== "object" || !Array.isArray(report.targets)) {
    fail(`${label} emitted an invalid report shape`);
  }
  for (const metric of ["totalFiles", "passed", "skipped", "failed"]) {
    if (!Number.isInteger(report[metric]) || report[metric] < 0) {
      fail(`${label} emitted an invalid ${metric} total`);
    }
  }
  const targetCounts = new Map();
  for (const target of report.targets) {
    if (!target || typeof target.name !== "string") {
      fail(`${label} emitted an invalid target report`);
    }
    for (const metric of ["totalFiles", "passed", "skipped", "failed"]) {
      if (!Number.isInteger(target[metric]) || target[metric] < 0) {
        fail(`${label} target ${target.name} emitted an invalid ${metric} total`);
      }
    }
    if (target.passed + target.skipped + target.failed !== target.totalFiles) {
      fail(`${label} target ${target.name} emitted inconsistent totals`);
    }
    targetCounts.set(target.name, (targetCounts.get(target.name) ?? 0) + 1);
    if (target.totalFiles <= 0) {
      fail(`${label} target ${target.name} has no corpus inputs; run fuzz:prepare first`);
    }
  }
  for (const target of expectedTargets) {
    if (targetCounts.get(target) !== 1) {
      fail(`${label} must report target ${target} exactly once`);
    }
  }
  if (targetCounts.size !== expectedTargets.length) {
    fail(`${label} reported an unexpected target set`);
  }
  if (report.passed + report.skipped + report.failed !== report.totalFiles) {
    fail(`${label} emitted inconsistent aggregate totals`);
  }
}

function mergeReports(core, tauri) {
  return {
    schemaVersion: 2,
    totalFiles: core.totalFiles + tauri.totalFiles,
    passed: core.passed + tauri.passed,
    skipped: core.skipped + tauri.skipped,
    failed: core.failed + tauri.failed,
    targets: [...core.targets, ...tauri.targets],
    suites: {
      core: {
        totalFiles: core.totalFiles,
        passed: core.passed,
        skipped: core.skipped,
        failed: core.failed,
      },
      tauri: {
        totalFiles: tauri.totalFiles,
        passed: tauri.passed,
        skipped: tauri.skipped,
        failed: tauri.failed,
      },
    },
  };
}

const enrichedReport = {
  ...report,
  generatedAt: new Date().toISOString(),
  host: {
    platform: os.platform(),
    arch: os.arch(),
  },
  corpusRoot: reportPathLabel(options.corpusRoot),
  artifactsRoot: reportPathLabel(options.artifactsRoot),
  tauriCorpusRoot: "src-tauri/fuzz/corpus",
  tauriArtifactsRoot: "src-tauri/fuzz/artifacts",
  includedArtifacts: options.includeArtifacts,
};

mkdirSync(path.dirname(options.output), { recursive: true });
writeFileSync(options.output, `${JSON.stringify(enrichedReport, null, 2)}\n`);

const outputPath = path.relative(repoRoot, options.output);
console.log(
  `fuzz corpus replay: files=${report.totalFiles}, passed=${report.passed}, skipped=${report.skipped}, failed=${report.failed}, report=${outputPath}`,
);

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    fail(`failed to start ${label}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveFromRepo(value) {
  return path.resolve(repoRoot, value);
}

function reportPathLabel(value) {
  const relative = path.relative(repoRoot, value);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return path.basename(value);
}

function fail(message) {
  console.error(`replay fuzz corpus failed: ${message}`);
  process.exit(1);
}
