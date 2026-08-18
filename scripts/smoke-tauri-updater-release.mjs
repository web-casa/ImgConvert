// SPDX-License-Identifier: Apache-2.0

import { chmodSync, createWriteStream, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  repo: process.env.GITHUB_REPOSITORY ?? "web-casa/ImgConvert",
  tag: "",
  platform: defaultPlatform(),
  outputDir: path.join(repoRoot, "target", "updater-smoke"),
  runArtifact: true,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--repo=")) {
    options.repo = arg.slice("--repo=".length);
  } else if (arg.startsWith("--tag=")) {
    options.tag = arg.slice("--tag=".length);
  } else if (arg.startsWith("--platform=")) {
    options.platform = arg.slice("--platform=".length);
  } else if (arg.startsWith("--output-dir=")) {
    options.outputDir = path.resolve(repoRoot, arg.slice("--output-dir=".length));
  } else if (arg === "--no-run") {
    options.runArtifact = false;
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

validateRepo(options.repo);
validatePlatform(options.platform);
mkdirSync(options.outputDir, { recursive: true });

const latestUrl = latestJsonUrl();
const manifest = await fetchJson(latestUrl);
const entry = validateManifest(manifest, options.platform);
const artifactName = artifactNameFromUrl(entry.url);
const artifactPath = path.join(options.outputDir, artifactName);
const signaturePath = path.join(options.outputDir, `${artifactName}.sig`);

await download(entry.url, artifactPath);
await download(`${entry.url}.sig`, signaturePath);

const downloadedSignature = readFileSync(signaturePath, "utf8").trim();
if (downloadedSignature !== entry.signature.trim()) {
  fail(`${artifactName}.sig does not match latest.json signature`);
}

if (statSync(artifactPath).size <= 0) {
  fail(`downloaded artifact is empty: ${artifactPath}`);
}

if (options.runArtifact) {
  runArtifactSmoke(artifactPath, options.platform);
}

console.log(
  `Tauri updater release smoke passed (${options.platform}; ${path.relative(repoRoot, artifactPath)})`,
);

function latestJsonUrl() {
  const suffix = options.tag
    ? `releases/download/${encodeURIComponent(options.tag)}/latest.json`
    : "releases/latest/download/latest.json";
  return `https://github.com/${options.repo}/${suffix}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "ImgConvert updater smoke" },
  });
  if (!response.ok) {
    fail(`failed to fetch ${url}: HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    fail(`latest.json is not valid JSON: ${error.message}`);
  }
}

async function download(url, output) {
  const response = await fetch(url, {
    headers: { "user-agent": "ImgConvert updater smoke" },
  });
  if (!response.ok || !response.body) {
    fail(`failed to download ${url}: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(output));
}

function validateManifest(manifest, platform) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("latest.json root must be an object");
  }
  if (!isSemver(manifest.version)) {
    fail(`latest.json version must be SemVer: ${String(manifest.version)}`);
  }
  if (!isValidDate(manifest.pub_date)) {
    fail(`latest.json pub_date must be RFC3339-compatible: ${String(manifest.pub_date)}`);
  }
  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) {
    fail("latest.json platforms must be an object");
  }
  const entry = platforms[platform];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    fail(`latest.json does not include ${platform}`);
  }
  if (typeof entry.signature !== "string" || entry.signature.trim().length < 40) {
    fail(`${platform} signature is missing or too short`);
  }
  validateHttpsUrl(entry.url, `${platform} URL`);
  return entry;
}

function runArtifactSmoke(artifactPath, platform) {
  const name = path.basename(artifactPath).toLowerCase();
  if (!platform.startsWith("linux-") || !name.endsWith(".appimage")) {
    console.log(`skip artifact execution for ${platform}; only Linux AppImage smoke is supported`);
    return;
  }
  if (platform !== defaultPlatform()) {
    console.log(`skip artifact execution for ${platform}; current host is ${defaultPlatform()}`);
    return;
  }
  chmodSync(artifactPath, 0o755);
  const result = spawnSync(artifactPath, [], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: "1",
      IMGCONVERT_PACKAGE_CONVERT_SMOKE: "1",
    },
  });
  if (result.error) {
    fail(`failed to start ${artifactPath}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`artifact smoke failed with exit code ${result.status ?? 1}`);
  }
}

function defaultPlatform() {
  const platform = process.platform === "darwin" ? "darwin" : process.platform;
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "ia32" ? "i686" : "x86_64";
  if (!["linux", "darwin", "win32"].includes(platform)) {
    return `linux-${arch}`;
  }
  return `${platform === "win32" ? "windows" : platform}-${arch}`;
}

function artifactNameFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  const name = path.posix.basename(url.pathname);
  try {
    return decodeURIComponent(name);
  } catch {
    fail(`artifact URL filename is not valid percent-encoding: ${rawUrl}`);
  }
}

function validateRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    fail(`repo must be owner/name: ${repo}`);
  }
}

function validatePlatform(platform) {
  if (!/^(linux|darwin|windows)-(x86_64|aarch64|i686)$/.test(platform)) {
    fail(`unsupported platform: ${platform}`);
  }
}

function validateHttpsUrl(rawUrl, label) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`${label} is invalid: ${rawUrl}`);
  }
  if (url.protocol !== "https:") {
    fail(`${label} must use HTTPS: ${rawUrl}`);
  }
}

function isSemver(version) {
  return typeof version === "string" && /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function printHelp() {
  console.log(`Usage: node scripts/smoke-tauri-updater-release.mjs [options]

Options:
  --repo=<owner/name>       GitHub repository, defaults to GITHUB_REPOSITORY or web-casa/ImgConvert.
  --tag=<tag>               Download latest.json from a specific release tag instead of latest.
  --platform=<target>       Platform key, for example linux-x86_64 or linux-aarch64.
  --output-dir=<path>       Download directory, defaults to target/updater-smoke.
  --no-run                  Only verify remote manifest/artifact/signature; do not execute AppImage.
`);
}

function fail(message) {
  console.error(`smoke-tauri-updater-release: ${message}`);
  process.exit(1);
}
