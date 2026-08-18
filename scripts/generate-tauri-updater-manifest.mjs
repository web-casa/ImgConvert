// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const options = {
  profile: "release",
  bundleRoot: "",
  baseUrl: process.env.TAURI_UPDATER_ARTIFACT_BASE_URL ?? defaultArtifactBaseUrl(),
  output: path.join(repoRoot, "target", "updater", "latest.json"),
  version: packageJson.version,
  notes: "",
  pubDate: new Date().toISOString(),
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--bundle-root=")) {
    options.bundleRoot = path.resolve(repoRoot, arg.slice("--bundle-root=".length));
  } else if (arg.startsWith("--base-url=")) {
    options.baseUrl = arg.slice("--base-url=".length);
  } else if (arg.startsWith("--output=")) {
    options.output = path.resolve(repoRoot, arg.slice("--output=".length));
  } else if (arg.startsWith("--version=")) {
    options.version = arg.slice("--version=".length);
  } else if (arg.startsWith("--notes=")) {
    options.notes = arg.slice("--notes=".length);
  } else if (arg.startsWith("--pub-date=")) {
    options.pubDate = arg.slice("--pub-date=".length);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

const bundleRoot =
  options.bundleRoot || path.join(repoRoot, "src-tauri", "target", options.profile, "bundle");
const baseUrl = validateBaseUrl(options.baseUrl);
validateVersion(options.version);
validatePubDate(options.pubDate);

const artifacts = collectUpdaterArtifacts(bundleRoot);
if (artifacts.length === 0) {
  fail(`no Tauri updater artifacts found under ${path.relative(repoRoot, bundleRoot)}`);
}

const platforms = {};
for (const artifact of artifacts) {
  const target = inferPlatformTarget(artifact);
  if (platforms[target] && artifactPriority(artifact.path) <= platforms[target].priority) {
    continue;
  }
  platforms[target] = {
    signature: readFileSync(`${artifact.path}.sig`, "utf8").trim(),
    url: `${baseUrl}/${encodeURI(path.basename(artifact.path))}`,
    priority: artifactPriority(artifact.path),
  };
}

for (const value of Object.values(platforms)) {
  delete value.priority;
}

const manifest = {
  version: options.version,
  notes: options.notes,
  pub_date: options.pubDate,
  platforms,
};

mkdirSync(path.dirname(options.output), { recursive: true });
writeFileSync(options.output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Tauri updater manifest written: ${path.relative(repoRoot, options.output)}`);

function collectUpdaterArtifacts(root) {
  if (!existsSync(root)) {
    fail(`bundle root does not exist: ${path.relative(repoRoot, root)}`);
  }
  const artifacts = [];
  for (const file of collectFiles(root)) {
    if (!isUpdaterBundle(file)) {
      continue;
    }
    const signature = `${file}.sig`;
    if (!existsSync(signature)) {
      fail(`missing updater signature: ${path.relative(repoRoot, signature)}`);
    }
    artifacts.push({ path: file });
  }
  artifacts.sort((a, b) => a.path.localeCompare(b.path));
  return artifacts;
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

function inferPlatformTarget(artifact) {
  const normalized = artifact.path.replaceAll(path.sep, "/").toLowerCase();
  const name = path.basename(normalized);
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
  fail(`cannot infer updater platform for ${path.relative(repoRoot, artifact.path)}`);
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

function validateBaseUrl(raw) {
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) {
    fail("TAURI_UPDATER_ARTIFACT_BASE_URL or --base-url is required");
  }
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

function validateVersion(version) {
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`updater manifest version must be SemVer: ${version}`);
  }
}

function validatePubDate(pubDate) {
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) {
    fail(`pub-date must be RFC3339-compatible: ${pubDate}`);
  }
}

function fail(message) {
  console.error(`generate-tauri-updater-manifest: ${message}`);
  process.exit(1);
}
