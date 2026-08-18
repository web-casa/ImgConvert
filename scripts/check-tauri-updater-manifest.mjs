// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const options = {
  profile: "release",
  bundleRoot: "",
  manifest: path.join(repoRoot, "target", "updater", "latest.json"),
  baseUrl: process.env.TAURI_UPDATER_ARTIFACT_BASE_URL ?? defaultArtifactBaseUrl(),
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--bundle-root=")) {
    options.bundleRoot = path.resolve(repoRoot, arg.slice("--bundle-root=".length));
  } else if (arg.startsWith("--manifest=")) {
    options.manifest = path.resolve(repoRoot, arg.slice("--manifest=".length));
  } else if (arg.startsWith("--base-url=")) {
    options.baseUrl = arg.slice("--base-url=".length);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

const bundleRoot =
  options.bundleRoot || path.join(repoRoot, "src-tauri", "target", options.profile, "bundle");
const baseUrl = options.baseUrl.trim() ? validateBaseUrl(options.baseUrl) : "";
const manifest = readManifest(options.manifest);
const expectedPlatforms = collectExpectedPlatforms(bundleRoot);
const manifestPlatforms = validateManifestShape(manifest);
const failures = [];

for (const target of Object.keys(manifestPlatforms)) {
  if (!expectedPlatforms[target]) {
    failures.push(`manifest includes ${target}, but no matching local updater artifact exists`);
  }
}

for (const [target, artifact] of Object.entries(expectedPlatforms)) {
  const entry = manifestPlatforms[target];
  if (!entry) {
    failures.push(`manifest is missing ${target} for ${path.relative(repoRoot, artifact.path)}`);
    continue;
  }

  const artifactName = path.basename(artifact.path);
  const manifestArtifactName = artifactNameFromUrl(entry.url, target);
  if (manifestArtifactName !== artifactName) {
    failures.push(`${target} URL points to ${manifestArtifactName}, expected ${artifactName}`);
  }
  if (baseUrl && !entry.url.startsWith(`${baseUrl}/`)) {
    failures.push(`${target} URL must start with ${baseUrl}/`);
  }
  if (entry.signature !== artifact.signature) {
    failures.push(`${target} signature does not match ${path.relative(repoRoot, artifact.sig)}`);
  }
}

if (failures.length > 0) {
  console.error("Tauri updater manifest check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Tauri updater manifest check passed (${Object.keys(expectedPlatforms).length} platform(s)).`,
);

function readManifest(file) {
  if (!existsSync(file)) {
    fail(`manifest does not exist: ${path.relative(repoRoot, file)}`);
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`manifest is not valid JSON: ${error.message}`);
  }
}

function validateManifestShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("manifest root must be an object");
  }
  if (!isSemver(value.version)) {
    fail(`manifest version must be SemVer: ${String(value.version)}`);
  }
  if (!isValidDate(value.pub_date)) {
    fail(`manifest pub_date must be RFC3339-compatible: ${String(value.pub_date)}`);
  }
  if (!value.platforms || typeof value.platforms !== "object" || Array.isArray(value.platforms)) {
    fail("manifest platforms must be an object");
  }

  const platforms = {};
  for (const [target, entry] of Object.entries(value.platforms)) {
    if (!/^(linux|darwin|windows)-(x86_64|aarch64|i686)$/.test(target)) {
      fail(`unsupported platform target: ${target}`);
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${target} entry must be an object`);
    }
    if (typeof entry.signature !== "string" || entry.signature.trim().length < 40) {
      fail(`${target} signature is missing or too short`);
    }
    platforms[target] = {
      signature: entry.signature.trim(),
      url: validateArtifactUrl(entry.url, target),
    };
  }

  if (Object.keys(platforms).length === 0) {
    fail("manifest platforms must not be empty");
  }

  return platforms;
}

function collectExpectedPlatforms(root) {
  if (!existsSync(root)) {
    fail(`bundle root does not exist: ${path.relative(repoRoot, root)}`);
  }

  const platforms = {};
  for (const file of collectFiles(root).filter(isUpdaterBundle).sort()) {
    const signaturePath = `${file}.sig`;
    if (!existsSync(signaturePath)) {
      fail(`missing updater signature: ${path.relative(repoRoot, signaturePath)}`);
    }
    const target = inferPlatformTarget(file);
    const priority = artifactPriority(file);
    if (platforms[target] && priority <= platforms[target].priority) {
      continue;
    }
    const signature = readFileSync(signaturePath, "utf8").trim();
    if (signature.length < 40) {
      fail(`signature looks too short: ${path.relative(repoRoot, signaturePath)}`);
    }
    platforms[target] = {
      path: file,
      sig: signaturePath,
      signature,
      priority,
    };
  }

  if (Object.keys(platforms).length === 0) {
    fail(`no Tauri updater artifacts found under ${path.relative(repoRoot, root)}`);
  }

  return platforms;
}

function collectFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(file);
    }
    if (entry.isFile()) {
      return [file];
    }
    return [];
  });
}

function isUpdaterBundle(file) {
  if (statSync(file).size <= 0) {
    return false;
  }
  const name = path.basename(file).toLowerCase();
  return (
    name.endsWith(".appimage") ||
    name.endsWith(".appimage.tar.gz") ||
    name.endsWith(".app.tar.gz") ||
    name.endsWith(".msi") ||
    name.endsWith(".exe") ||
    name.endsWith(".msi.zip") ||
    name.endsWith(".nsis.zip")
  );
}

function inferPlatformTarget(file) {
  const name = path.basename(file).toLowerCase();
  const arch = inferArch(name);
  if (name.endsWith(".appimage") || name.endsWith(".appimage.tar.gz")) {
    return `linux-${arch}`;
  }
  if (name.endsWith(".app.tar.gz")) {
    return `darwin-${arch}`;
  }
  if (
    name.endsWith(".msi") ||
    name.endsWith(".exe") ||
    name.endsWith(".msi.zip") ||
    name.endsWith(".nsis.zip")
  ) {
    return `windows-${arch}`;
  }
  fail(`cannot infer updater platform for ${path.relative(repoRoot, file)}`);
}

function inferArch(name) {
  if (/(aarch64|arm64)/.test(name)) {
    return "aarch64";
  }
  if (/(i686|x86)/.test(name) && !/(x86_64|amd64)/.test(name)) {
    return "i686";
  }
  return "x86_64";
}

function artifactPriority(file) {
  const name = path.basename(file).toLowerCase();
  if (name.endsWith(".exe")) return 40;
  if (name.endsWith(".nsis.zip")) return 30;
  if (name.endsWith(".msi")) return 25;
  if (name.endsWith(".msi.zip")) return 20;
  if (name.endsWith(".appimage")) return 15;
  return 10;
}

function artifactNameFromUrl(rawUrl, target) {
  const url = new URL(rawUrl);
  const name = path.posix.basename(url.pathname);
  try {
    return decodeURIComponent(name);
  } catch {
    fail(`${target} URL artifact name is not valid percent-encoding: ${rawUrl}`);
  }
}

function validateArtifactUrl(rawUrl, target) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    fail(`${target} URL is required`);
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`${target} URL is invalid: ${rawUrl}`);
  }
  if (url.protocol !== "https:") {
    fail(`${target} URL must use HTTPS: ${rawUrl}`);
  }
  return rawUrl;
}

function validateBaseUrl(raw) {
  const value = raw.trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`invalid artifact base URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    fail(`artifact base URL must use HTTPS: ${raw}`);
  }
  return value;
}

function defaultArtifactBaseUrl() {
  const repo = process.env.GITHUB_REPOSITORY?.trim() || "web-casa/ImgConvert";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    fail(`GITHUB_REPOSITORY must be owner/name: ${repo}`);
  }
  return `https://github.com/${repo}/releases/download/v${packageJson.version}`;
}

function isSemver(version) {
  return typeof version === "string" && /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function fail(message) {
  console.error(`check-tauri-updater-manifest: ${message}`);
  process.exit(1);
}
