// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = readJson("package.json");
const snapcraftPath = path.join(repoRoot, "snap", "snapcraft.yaml");
const desktopPath = path.join(repoRoot, "snap", "gui", "imgconvert.desktop");
let artifact = "";

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  }
  if (arg.startsWith("--artifact=")) {
    artifact = path.resolve(repoRoot, arg.slice("--artifact=".length));
    continue;
  }
  fail(`unknown argument: ${arg}`);
}

const snapcraft = readText(snapcraftPath);
const desktop = readText(desktopPath);
const failures = [];

for (const marker of [
  "name: imgconvert",
  `version: "${packageJson.version}"`,
  "base: core24",
  "grade: stable",
  "confinement: strict",
  "plugin: nil",
  "- rustup/latest/stable",
  "- node/24/stable",
  "extensions:",
  "- gnome",
  "- home",
  "- removable-media",
  "IMGCONVERT_DISABLE_EXTERNAL_CODECS=1",
  "IMGCONVERT_DISABLE_UPDATER=1",
  "unset LD_LIBRARY_PATH",
  "rustup toolchain install 1.96.0 --profile minimal",
  "cargo +1.96.0 build --release --locked",
  "--features tauri/custom-protocol",
  "--manifest-path src-tauri/Cargo.toml",
  "install -Dm755 src-tauri/target/release/imgconvert",
]) {
  if (!snapcraft.includes(marker)) {
    failures.push(`snap/snapcraft.yaml missing marker: ${marker}`);
  }
}

for (const denied of [
  "confinement: classic",
  "confinement: devmode",
  "- network",
  "- network-bind",
  "- system-files",
  "- personal-files",
  "daemon:",
  "plugin: rust",
  "rust-channel:",
  "craftctl default",
]) {
  if (snapcraft.includes(denied)) {
    failures.push(`snap/snapcraft.yaml contains denied marker: ${denied}`);
  }
}

const unsetLibraryPathIndex = snapcraft.indexOf("unset LD_LIBRARY_PATH");
const rustupInstallIndex = snapcraft.indexOf("rustup toolchain install 1.96.0");
const cargoBuildIndex = snapcraft.indexOf("cargo +1.96.0 build");
const productionProtocolIndex = snapcraft.indexOf("--features tauri/custom-protocol");
const cargoManifestIndex = snapcraft.indexOf("--manifest-path src-tauri/Cargo.toml");
if (
  unsetLibraryPathIndex < 0 ||
  rustupInstallIndex < 0 ||
  cargoBuildIndex < 0 ||
  productionProtocolIndex < 0 ||
  cargoManifestIndex < 0 ||
  unsetLibraryPathIndex > rustupInstallIndex ||
  rustupInstallIndex > cargoBuildIndex ||
  cargoBuildIndex > productionProtocolIndex ||
  productionProtocolIndex > cargoManifestIndex
) {
  failures.push(
    "Snap build must clear LD_LIBRARY_PATH, pin Rustup, and enable Tauri's production protocol",
  );
}

for (const marker of [
  "Name=ImgConvert",
  "Comment=Local-first batch image converter",
  "Comment[zh_CN]=",
  "Exec=imgconvert",
  "Icon=${SNAP}/usr/share/icons/hicolor/256x256/apps/imgconvert.png",
]) {
  if (!desktop.includes(marker)) {
    failures.push(`snap desktop entry missing marker: ${marker}`);
  }
}

if (/^Name=[^\n]*[\u3400-\u9fff]/mu.test(desktop)) {
  failures.push("snap desktop default Name must not be Chinese");
}

if (commandExists("desktop-file-validate")) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "imgconvert-snap-desktop-"));
  const normalizedDesktop = path.join(temporary, "imgconvert.desktop");
  try {
    writeFileSync(
      normalizedDesktop,
      desktop.replaceAll("${SNAP}", "/snap/imgconvert/current"),
      "utf8",
    );
    const result = spawnSync("desktop-file-validate", [normalizedDesktop], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      failures.push(`snap desktop entry is invalid: ${(result.stderr || result.stdout).trim()}`);
    }
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

if (artifact) {
  inspectArtifact(artifact, failures);
}

if (failures.length > 0) {
  console.error("Snap package check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Snap package check passed${artifact ? `: ${path.relative(repoRoot, artifact)}` : "."}`,
);

function inspectArtifact(file, artifactFailures) {
  if (!existsSync(file) || statSync(file).size === 0) {
    artifactFailures.push(`snap artifact is missing or empty: ${file}`);
    return;
  }
  if (!file.endsWith(".snap")) {
    artifactFailures.push(`snap artifact must end with .snap: ${file}`);
    return;
  }
  if (!commandExists("unsquashfs")) {
    artifactFailures.push("unsquashfs is required to inspect a snap artifact");
    return;
  }

  const metadata = commandOutput("unsquashfs", ["-cat", file, "meta/snap.yaml"]);
  if (!metadata.ok) {
    artifactFailures.push(`cannot read meta/snap.yaml: ${metadata.stderr}`);
    return;
  }
  for (const marker of [
    "name: imgconvert",
    `version: ${packageJson.version}`,
    "base: core24",
    "confinement: strict",
  ]) {
    if (!metadata.stdout.includes(marker)) {
      artifactFailures.push(`snap artifact metadata missing marker: ${marker}`);
    }
  }
  for (const requiredPath of [
    "usr/bin/imgconvert",
    "usr/share/metainfo/com.ivmm.imgconvert.metainfo.xml",
    "usr/share/icons/hicolor/256x256/apps/imgconvert.png",
  ]) {
    const listing = commandOutput("unsquashfs", ["-ll", file, requiredPath]);
    if (!listing.ok || !listing.stdout.includes(requiredPath)) {
      artifactFailures.push(`snap artifact missing ${requiredPath}`);
    }
  }
}

function readJson(relative) {
  return JSON.parse(readText(path.join(repoRoot, relative)));
}

function readText(file) {
  if (!existsSync(file)) {
    fail(`missing file: ${path.relative(repoRoot, file)}`);
  }
  return readFileSync(file, "utf8");
}

function commandExists(command) {
  return (
    spawnSync("sh", ["-c", `command -v ${quoteShell(command)} >/dev/null 2>&1`], {
      stdio: "ignore",
    }).status === 0
  );
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr.trim(),
  };
}

function quoteShell(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fail(message) {
  console.error(`check-snap-package: ${message}`);
  process.exit(1);
}
