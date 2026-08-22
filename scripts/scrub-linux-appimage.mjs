// SPDX-License-Identifier: Apache-2.0

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  profile: "release",
  target: "",
};

const deniedAppImageLibraries = new Set(["libgcrypt.so.20"]);

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--target=")) {
    options.target = arg.slice("--target=".length);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!["debug", "release"].includes(options.profile)) {
  fail(`unsupported profile: ${options.profile}`);
}

const appImageDir = bundleDir("appimage");
const appDir = path.join(appImageDir, "ImgConvert.AppDir");
const artifacts = collectFiles(appImageDir)
  .filter((file) => file.endsWith(".AppImage"))
  .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

if (!existsSync(appDir)) {
  fail(`missing AppDir: ${path.relative(repoRoot, appDir)}`);
}
if (artifacts.length === 0) {
  fail(`missing AppImage artifact under ${path.relative(repoRoot, appImageDir)}`);
}
if (artifacts.length > 1) {
  fail(
    `expected one AppImage artifact under ${path.relative(repoRoot, appImageDir)}, found ${artifacts.length}`,
  );
}

const removed = scrubAppDir(appDir);
if (removed.length === 0) {
  console.log("AppImage AppDir scrub: no denied libraries found.");
} else {
  console.log(`AppImage AppDir scrub removed: ${removed.join(", ")}`);
}

injectAppStreamMetadata(appDir);
repackAppImage(appDir, artifacts[0]);

function bundleDir(bundle) {
  const parts = ["src-tauri", "target"];
  if (options.target) {
    parts.push(options.target);
  }
  parts.push(options.profile, "bundle", bundle);
  return path.join(repoRoot, ...parts);
}

function scrubAppDir(root) {
  const libDir = path.join(root, "usr", "lib");
  if (!existsSync(libDir)) {
    return [];
  }

  const removed = [];
  for (const entry of readdirSync(libDir, { withFileTypes: true })) {
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }
    if (!deniedAppImageLibraries.has(entry.name)) {
      continue;
    }
    rmSync(path.join(libDir, entry.name), { force: true });
    removed.push(entry.name);
  }
  return removed;
}

function injectAppStreamMetadata(root) {
  const source = path.join(
    repoRoot,
    "packaging",
    "appimagehub",
    "com.ivmm.imgconvert.metainfo.xml",
  );
  if (!existsSync(source)) {
    fail(`missing AppImage AppStream metadata: ${path.relative(repoRoot, source)}`);
  }

  const destination = path.join(
    root,
    "usr",
    "share",
    "metainfo",
    "com.ivmm.imgconvert.metainfo.xml",
  );
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  console.log(`AppImage AppStream metadata injected: ${path.relative(repoRoot, source)}`);
}

function repackAppImage(root, artifact) {
  const plugin = resolveAppImagePlugin();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "imgconvert-appimage-repack-"));
  const appDirCopy = path.join(tempDir, "ImgConvert.AppDir");
  const outputName = `ImgConvert-${appImageArch(artifact)}.AppImage`;
  const outputPath = path.join(tempDir, outputName);

  try {
    copyDir(root, appDirCopy);
    chmodSync(plugin, statSync(plugin).mode | 0o111);

    const result = spawnSync(plugin, [`--appdir=${appDirCopy}`], {
      cwd: tempDir,
      encoding: "utf8",
      env: {
        ...process.env,
        ARCH: appImageArch(artifact),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.status !== 0) {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      fail(`linuxdeploy appimage plugin failed with exit code ${result.status}`);
    }
    if (!existsSync(outputPath)) {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      fail(`linuxdeploy appimage plugin did not create ${outputName}`);
    }

    copyFileSync(outputPath, artifact);
    rmSync(outputPath, { force: true });
    chmodSync(artifact, statSync(artifact).mode | 0o111);
    console.log(`AppImage repacked: ${path.relative(repoRoot, artifact)}`);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function resolveAppImagePlugin() {
  const configured = process.env.IMGCONVERT_APPIMAGE_PLUGIN?.trim();
  const candidates = [
    configured,
    path.join(os.homedir(), ".cache", "tauri", "linuxdeploy-plugin-appimage.AppImage"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  fail(
    "linuxdeploy-plugin-appimage.AppImage was not found; run Tauri AppImage build once or set IMGCONVERT_APPIMAGE_PLUGIN",
  );
}

function appImageArch(artifact) {
  const basename = path.basename(artifact).toLowerCase();
  if (basename.includes("aarch64") || basename.includes("arm64")) {
    return "aarch64";
  }
  if (basename.includes("x86_64") || basename.includes("amd64")) {
    return "x86_64";
  }

  const uname = spawnSync("uname", ["-m"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (uname.status === 0) {
    const arch = uname.stdout.trim();
    if (arch === "aarch64" || arch === "x86_64") {
      return arch;
    }
  }

  if (process.arch === "arm64") {
    return "aarch64";
  }
  if (process.arch === "x64") {
    return "x86_64";
  }
  fail(`unsupported AppImage architecture for ${path.relative(repoRoot, artifact)}`);
}

function collectFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function copyDir(source, destination) {
  cpSync(source, destination, {
    dereference: false,
    force: true,
    recursive: true,
    verbatimSymlinks: true,
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
