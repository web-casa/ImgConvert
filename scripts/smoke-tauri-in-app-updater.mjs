// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  repo: process.env.GITHUB_REPOSITORY ?? "web-casa/ImgConvert",
  fromTag: "v0.1.0",
  toTag: "",
  platform: "linux-x86_64",
  outputDir: path.join(repoRoot, "target", "updater-upgrade-smoke"),
  eligibilityOnly: false,
  requireGui: false,
  timeoutMs: 240_000,
  downloadTimeoutMs: 600_000,
  initialSettleMs: 8_000,
  updateDialogWaitMs: 15_000,
  updateButtonOffsetX: 70,
  updateButtonOffsetY: 30,
  installButtonOffsetX: 200,
  installButtonOffsetY: 82,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--repo=")) {
    options.repo = arg.slice("--repo=".length);
  } else if (arg.startsWith("--from-tag=")) {
    options.fromTag = arg.slice("--from-tag=".length);
  } else if (arg.startsWith("--to-tag=")) {
    options.toTag = arg.slice("--to-tag=".length);
  } else if (arg.startsWith("--platform=")) {
    options.platform = arg.slice("--platform=".length);
  } else if (arg.startsWith("--output-dir=")) {
    options.outputDir = path.resolve(repoRoot, arg.slice("--output-dir=".length));
  } else if (arg === "--eligibility-only") {
    options.eligibilityOnly = true;
  } else if (arg === "--require-gui") {
    options.requireGui = true;
  } else if (arg.startsWith("--timeout-ms=")) {
    options.timeoutMs = positiveInteger(arg.slice("--timeout-ms=".length), "--timeout-ms");
  } else if (arg.startsWith("--download-timeout-ms=")) {
    options.downloadTimeoutMs = positiveInteger(
      arg.slice("--download-timeout-ms=".length),
      "--download-timeout-ms",
    );
  } else if (arg.startsWith("--update-button-offset-x=")) {
    options.updateButtonOffsetX = positiveInteger(
      arg.slice("--update-button-offset-x=".length),
      "--update-button-offset-x",
    );
  } else if (arg.startsWith("--update-button-offset-y=")) {
    options.updateButtonOffsetY = positiveInteger(
      arg.slice("--update-button-offset-y=".length),
      "--update-button-offset-y",
    );
  } else if (arg.startsWith("--install-button-offset-x=")) {
    options.installButtonOffsetX = positiveInteger(
      arg.slice("--install-button-offset-x=".length),
      "--install-button-offset-x",
    );
  } else if (arg.startsWith("--install-button-offset-y=")) {
    options.installButtonOffsetY = positiveInteger(
      arg.slice("--install-button-offset-y=".length),
      "--install-button-offset-y",
    );
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

validateRepo(options.repo);
validateTag(options.fromTag, "--from-tag");
if (options.toTag) validateTag(options.toTag, "--to-tag");
validatePlatform(options.platform);

rmSync(options.outputDir, { force: true, recursive: true });
mkdirSync(options.outputDir, { recursive: true });

try {
  await main();
} catch (error) {
  fail(errorMessage(error));
}

async function main() {
  const oldManifest = await fetchJson(releaseLatestJsonUrl(options.fromTag));
  const oldEntry = validateManifest(oldManifest, options.platform, options.fromTag);
  const latestManifest = await fetchJson(updaterEndpointUrl());
  const latestEntry = validateManifest(latestManifest, options.platform, "latest");
  if (
    options.toTag &&
    normalizeVersion(latestManifest.version) !== normalizeVersion(options.toTag)
  ) {
    fail(
      `latest updater endpoint is ${latestManifest.version}, expected ${normalizeVersion(options.toTag)}`,
    );
  }
  if (!isVersionGreater(latestManifest.version, oldManifest.version)) {
    fail(`latest version ${latestManifest.version} is not newer than ${oldManifest.version}`);
  }

  const oldArtifact = await downloadSignedArtifact(oldEntry, "old");
  const latestArtifact = await downloadSignedArtifact(latestEntry, "latest");
  const oldHash = sha256File(oldArtifact.path);
  const latestHash = sha256File(latestArtifact.path);
  if (oldHash === latestHash) {
    fail("old and latest updater artifacts have the same SHA256");
  }

  console.log(
    `updater eligibility passed: ${oldManifest.version} -> ${latestManifest.version} (${options.platform})`,
  );

  if (options.eligibilityOnly) {
    return;
  }

  if (!guiSmokeSupported()) {
    const message = `real in-app updater smoke requires linux-x64 with Xvfb and xdotool; current host is ${process.platform}/${process.arch}`;
    if (options.requireGui) fail(message);
    console.log(`skip GUI updater smoke: ${message}`);
    return;
  }

  await runGuiUpdaterSmoke(oldArtifact.path, latestHash);
  console.log(
    `Tauri in-app updater smoke passed: ${oldManifest.version} -> ${latestManifest.version}`,
  );
}

function releaseLatestJsonUrl(tag) {
  return `https://github.com/${options.repo}/releases/download/${encodeURIComponent(tag)}/latest.json`;
}

function updaterEndpointUrl() {
  return `https://github.com/${options.repo}/releases/latest/download/latest.json`;
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "ImgConvert in-app updater smoke" },
      signal: AbortSignal.timeout(options.downloadTimeoutMs),
    });
    if (!response.ok) {
      fail(`failed to fetch ${url}: HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch (error) {
      fail(`latest.json is not valid JSON: ${error.message}`);
    }
  } catch (error) {
    fail(`failed to fetch ${url}: ${errorMessage(error)}`);
  }
}

function validateManifest(manifest, platform, label) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(`${label} latest.json root must be an object`);
  }
  if (!isSemver(manifest.version)) {
    fail(`${label} latest.json version must be SemVer: ${String(manifest.version)}`);
  }
  if (!isValidDate(manifest.pub_date)) {
    fail(`${label} latest.json pub_date must be RFC3339-compatible`);
  }
  const entry = manifest.platforms?.[platform];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    fail(`${label} latest.json does not include ${platform}`);
  }
  if (typeof entry.signature !== "string" || entry.signature.trim().length < 40) {
    fail(`${label} ${platform} signature is missing or too short`);
  }
  validateHttpsUrl(entry.url, `${label} ${platform} URL`);
  return entry;
}

async function downloadSignedArtifact(entry, prefix) {
  const artifactName = artifactNameFromUrl(entry.url);
  const artifactPath = path.join(options.outputDir, `${prefix}-${artifactName}`);
  const signaturePath = `${artifactPath}.sig`;

  console.log(`downloading ${prefix} artifact: ${artifactName}`);
  await download(entry.url, artifactPath);
  await download(`${entry.url}.sig`, signaturePath);

  const downloadedSignature = readFileSync(signaturePath, "utf8").trim();
  if (downloadedSignature !== entry.signature.trim()) {
    fail(`${prefix} ${artifactName}.sig does not match latest.json signature`);
  }
  if (statSync(artifactPath).size <= 0) {
    fail(`downloaded artifact is empty: ${artifactPath}`);
  }
  chmodSync(artifactPath, 0o755);
  return { name: artifactName, path: artifactPath };
}

async function download(url, output) {
  const signal = AbortSignal.timeout(options.downloadTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "ImgConvert in-app updater smoke" },
      signal,
    });
    if (!response.ok || !response.body) {
      fail(`failed to download ${url}: HTTP ${response.status}`);
    }
    await pipeline(response.body, createWriteStream(output), { signal });
  } catch (error) {
    rmSync(output, { force: true });
    fail(`failed to download ${url}: ${errorMessage(error)}`);
  }
}

async function runGuiUpdaterSmoke(oldArtifactPath, expectedHash) {
  const display = await startXvfb();
  const appEnv = {
    ...process.env,
    APPIMAGE_EXTRACT_AND_RUN: "1",
    DISPLAY: display.name,
    IMGCONVERT_DISABLE_EXTERNAL_CODECS: "1",
  };
  const app = spawn(oldArtifactPath, [], {
    cwd: options.outputDir,
    env: appEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  app.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  app.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const windowId = await waitForWindow(appEnv);
    await sleep(options.initialSettleMs);
    const geometry = windowGeometry(windowId, appEnv);
    clickUpdateButton(windowId, geometry, appEnv);
    await sleep(options.updateDialogWaitMs);
    captureScreenshot(appEnv, "after-update-click.png");
    clickInstallButton(windowId, geometry, appEnv);
    await sleep(2_000);
    captureScreenshot(appEnv, "after-install-click.png");
    await waitForUpdatedArtifact(oldArtifactPath, expectedHash, app, stdout, stderr, appEnv);
    closeImgConvertWindows(appEnv);
    runUpdatedArtifactSmoke(oldArtifactPath);
  } catch (error) {
    captureScreenshot(appEnv);
    throw error;
  } finally {
    closeImgConvertWindows(appEnv);
    if (!app.killed) app.kill("SIGTERM");
    display.stop();
  }
}

async function startXvfb() {
  for (let displayNumber = 90; displayNumber < 130; displayNumber += 1) {
    const displayName = `:${displayNumber}`;
    if (existsSync(`/tmp/.X11-unix/X${displayNumber}`)) {
      continue;
    }
    const child = spawn("Xvfb", [displayName, "-screen", "0", "1280x900x24", "-nolisten", "tcp"], {
      stdio: "ignore",
    });
    await sleep(500);
    if (child.exitCode !== null) {
      continue;
    }
    return {
      name: displayName,
      stop() {
        if (!child.killed) child.kill("SIGTERM");
      },
    };
  }
  fail("failed to start Xvfb on a free display");
}

async function waitForWindow(env) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const result = runTool("xdotool", ["search", "--onlyvisible", "--name", "ImgConvert"], env, {
      allowFailure: true,
    });
    const ids = result.stdout
      .trim()
      .split(/\s+/)
      .map((id) => id.trim())
      .filter(Boolean);
    for (const id of ids.reverse()) {
      const geometry = windowGeometry(id, env, { allowFailure: true });
      if (geometry && geometry.WIDTH >= 640 && geometry.HEIGHT >= 480) {
        console.log(`using ImgConvert window ${id}: ${geometry.WIDTH}x${geometry.HEIGHT}`);
        return id;
      }
    }
    await sleep(500);
  }
  fail("timed out waiting for ImgConvert window");
}

function windowGeometry(windowId, env, { allowFailure = false } = {}) {
  const result = runTool("xdotool", ["getwindowgeometry", "--shell", windowId], env, {
    allowFailure,
  });
  if (allowFailure && result.status !== 0) {
    return null;
  }
  const fields = Object.fromEntries(
    result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split("="))
      .filter((parts) => parts.length === 2)
      .map(([key, value]) => [key, Number(value)]),
  );
  for (const key of ["WIDTH", "HEIGHT"]) {
    if (!Number.isFinite(fields[key]) || fields[key] <= 0) {
      if (allowFailure) {
        return null;
      }
      fail(`xdotool returned invalid window geometry: ${result.stdout}`);
    }
  }
  return fields;
}

function clickUpdateButton(windowId, geometry, env) {
  const x = relativeCoordinate(geometry.WIDTH - options.updateButtonOffsetX, geometry.WIDTH);
  const y = relativeCoordinate(options.updateButtonOffsetY, geometry.HEIGHT);
  focusWindow(windowId, env);
  console.log(`clicking update button at ${x},${y}`);
  runTool(
    "xdotool",
    ["mousemove", "--sync", "--window", windowId, String(x), String(y), "click", "1"],
    env,
  );
}

function clickInstallButton(windowId, geometry, env) {
  const x = relativeCoordinate(
    Math.round(geometry.WIDTH / 2 + options.installButtonOffsetX),
    geometry.WIDTH,
  );
  const y = relativeCoordinate(
    Math.round(geometry.HEIGHT / 2 + options.installButtonOffsetY),
    geometry.HEIGHT,
  );
  focusWindow(windowId, env);
  console.log(`clicking install button at ${x},${y}`);
  runTool(
    "xdotool",
    ["mousemove", "--sync", "--window", windowId, String(x), String(y), "click", "1"],
    env,
  );
}

function relativeCoordinate(value, max) {
  return Math.min(Math.max(1, value), Math.max(1, max - 1));
}

function focusWindow(windowId, env) {
  runTool("xdotool", ["windowactivate", "--sync", windowId], env, { allowFailure: true });
  runTool("xdotool", ["windowfocus", "--sync", windowId], env, { allowFailure: true });
}

async function waitForUpdatedArtifact(artifactPath, expectedHash, app, stdout, stderr, env) {
  const started = Date.now();
  while (Date.now() - started < options.timeoutMs) {
    if (existsSync(artifactPath) && sha256File(artifactPath) === expectedHash) {
      return;
    }
    await sleep(2_000);
  }
  captureScreenshot(env);
  fail(
    [
      `timed out waiting for updater to replace ${path.basename(artifactPath)}`,
      app.exitCode !== null ? `ImgConvert exit code: ${app.exitCode}` : "",
      stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
      stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function runUpdatedArtifactSmoke(artifactPath) {
  chmodSync(artifactPath, 0o755);
  const result = spawnSync(artifactPath, [], {
    cwd: options.outputDir,
    env: {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: "1",
      IMGCONVERT_PACKAGE_CONVERT_SMOKE: "1",
    },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    fail(
      [
        `updated artifact package smoke failed with exit code ${result.status ?? 1}`,
        result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : "",
        result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function closeImgConvertWindows(env) {
  runTool("xdotool", ["search", "--name", "ImgConvert", "windowkill"], env, {
    allowFailure: true,
  });
}

function captureScreenshot(env, name = "in-app-updater-failure.png") {
  if (!commandExists("import")) {
    return;
  }
  const output = path.join(options.outputDir, name);
  runTool("import", ["-window", "root", output], env, { allowFailure: true });
}

function runTool(command, args, env, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: options.outputDir,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!allowFailure && result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result;
}

function guiSmokeSupported() {
  return (
    process.platform === "linux" &&
    process.arch === "x64" &&
    options.platform === "linux-x86_64" &&
    commandExists("Xvfb") &&
    commandExists("xdotool")
  );
}

function commandExists(command) {
  return (
    spawnSync("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", command], {
      stdio: "ignore",
    }).status === 0
  );
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

function sha256File(file) {
  const hash = createHash("sha256");
  hash.update(readFileSync(file));
  return hash.digest("hex");
}

function isVersionGreater(candidate, current) {
  const left = semverParts(candidate);
  const right = semverParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return false;
}

function semverParts(version) {
  return normalizeVersion(version)
    .split(".")
    .slice(0, 3)
    .map((part) => Number(part.replace(/\D.*$/u, "")));
}

function normalizeVersion(version) {
  return String(version).trim().replace(/^v/u, "");
}

function validateRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    fail(`repo must be owner/name: ${repo}`);
  }
}

function validateTag(tag, label) {
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
    fail(`${label} must be a SemVer tag: ${tag}`);
  }
}

function validatePlatform(platform) {
  if (!/^(linux|darwin|windows)-(x86_64|aarch64|i686)$/.test(platform)) {
    fail(`unsupported platform: ${platform}`);
  }
  if (platform !== "linux-x86_64") {
    fail("in-app updater GUI smoke currently supports only linux-x86_64 AppImage releases");
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

function positiveInteger(raw, label) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${label} must be a positive integer`);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage: node scripts/smoke-tauri-in-app-updater.mjs [options]

Downloads an old AppImage release, verifies that the public latest updater
endpoint points to a newer release, then optionally runs a real X11 GUI smoke
that clicks the old app's update dialog and waits for the AppImage to be
replaced by the latest artifact.

Options:
  --repo=<owner/name>                GitHub repository, defaults to GITHUB_REPOSITORY or web-casa/ImgConvert.
  --from-tag=<tag>                   Old release tag, defaults to v0.1.0.
  --to-tag=<tag>                     Expected version at releases/latest/download/latest.json.
  --platform=<target>                Currently only linux-x86_64 is supported.
  --output-dir=<path>                Download directory, defaults to target/updater-upgrade-smoke.
  --eligibility-only                 Verify release metadata/artifacts only; skip GUI updater.
  --require-gui                      Fail instead of skipping when GUI smoke prerequisites are missing.
  --timeout-ms=<ms>                  Time to wait for AppImage replacement, defaults to 240000.
  --download-timeout-ms=<ms>         Time to wait for each GitHub download, defaults to 600000.
  --update-button-offset-x=<px>      X offset from the right edge for the topbar update button.
  --update-button-offset-y=<px>      Y offset from the top edge for the topbar update button.
  --install-button-offset-x=<px>     X offset from window center for the install button.
  --install-button-offset-y=<px>     Y offset from window center for the install button.
`);
}

function fail(message) {
  console.error(`smoke-tauri-in-app-updater: ${message}`);
  process.exit(1);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
