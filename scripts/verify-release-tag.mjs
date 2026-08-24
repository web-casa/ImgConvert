// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = {
  allowUntagged: false,
  tag: null,
};

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--") {
    continue;
  } else if (arg === "--allow-untagged") {
    options.allowUntagged = true;
  } else if (arg === "--tag") {
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("--tag requires a value");
    }
    options.tag = value;
    index += 1;
  } else if (arg.startsWith("--tag=")) {
    options.tag = arg.slice("--tag=".length);
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!options.tag) {
  fail("--tag is required");
}
if (!/^v\d+\.\d+\.\d+$/.test(options.tag)) {
  fail(`release tag must use v<major>.<minor>.<patch>: ${options.tag}`);
}

const expectedVersion = options.tag.slice(1);
const versions = [
  ["package.json", readJson("package.json").version],
  ["docs-site/package.json", readJson("docs-site/package.json").version],
  ["src-tauri/tauri.conf.json", readJson("src-tauri/tauri.conf.json").version],
  ["src-tauri/Cargo.toml", cargoPackageVersion("src-tauri/Cargo.toml")],
  ["src-tauri/Cargo.lock", cargoLockPackageVersion("src-tauri/Cargo.lock")],
];

for (const [file, version] of versions) {
  if (version !== expectedVersion) {
    fail(`${file} version ${version ?? "<missing>"} does not match ${options.tag}`);
  }
}

if (!options.allowUntagged) {
  verifyHeadIsExactTag(options.tag);
}

console.log(
  `ok release tag ${options.tag} matches ${versions.length} version fields${
    options.allowUntagged ? " (Git tag check skipped)" : ""
  }`,
);

function verifyHeadIsExactTag(tag) {
  const tagRef = `refs/tags/${tag}`;
  const showRef = runGit(["show-ref", "--verify", "--quiet", tagRef]);
  if (showRef.status !== 0) {
    fail(`required Git tag does not exist locally: ${tagRef}`);
  }

  const tagType = gitOutput(["cat-file", "-t", tagRef], `inspect ${tag}`);
  if (tagType !== "tag") {
    fail(`release tag must be annotated, not lightweight: ${tag}`);
  }

  const tagCommit = gitOutput(["rev-parse", "--verify", `${tag}^{commit}`], `resolve ${tag}`);
  const headCommit = gitOutput(["rev-parse", "--verify", "HEAD"], "resolve HEAD");
  if (tagCommit !== headCommit) {
    fail(`HEAD ${headCommit} is not the commit tagged by ${tag} (${tagCommit})`);
  }
}

function cargoPackageVersion(relativePath) {
  const text = readText(relativePath);
  let inPackage = false;
  let version = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "[package]") {
      inPackage = true;
      continue;
    }
    if (inPackage && /^\[.+\]$/.test(line.trim())) {
      break;
    }
    if (inPackage) {
      version = line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/)?.[1] ?? version;
    }
  }
  if (!version) {
    fail(`${relativePath} is missing [package].version`);
  }
  return version;
}

function cargoLockPackageVersion(relativePath) {
  const lock = readText(relativePath);
  const entry = lock.match(/^\[\[package\]\]\r?\nname = "imgconvert"\r?\nversion = "([^"]+)"$/m);
  const version = entry?.[1];
  if (!version) {
    fail(`${relativePath} is missing the imgconvert package version`);
  }
  return version;
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function gitOutput(args, label) {
  const result = runGit(args);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    fail(`unable to ${label}${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim();
}

function runGit(args) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function printHelp() {
  console.log(`Usage: node scripts/verify-release-tag.mjs --tag=v<major>.<minor>.<patch> [options]

Verifies that the requested release tag exactly matches package.json,
docs-site/package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml.
By default, it also requires an annotated tag whose commit exactly matches HEAD.

Options:
  --tag=<tag>         Required release tag.
  --allow-untagged     Check version fields only; intended for local pre-tag preflight.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
