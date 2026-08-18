// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = os.platform() === "win32";

const STORE_ASSETS = [
  { file: "StoreLogo.png", width: 50, height: 50 },
  { file: "Square150x150Logo.png", width: 150, height: 150 },
  { file: "Square44x44Logo.png", width: 44, height: 44 },
];

const options = {
  profile: "release",
  allowNonWindows: false,
  allowMissingStoreEnv: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg === "--allow-non-windows") {
    options.allowNonWindows = true;
  } else if (arg === "--allow-missing-store-env") {
    options.allowMissingStoreEnv = true;
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!isWindows && !options.allowNonWindows) {
  fail(
    "Windows MSIX packaging must run on Windows. Pass --allow-non-windows only for layout preflight.",
  );
}
if (!["debug", "release"].includes(options.profile)) {
  fail(`unsupported profile: ${options.profile}`);
}
if (!truthy(process.env.IMGCONVERT_DISABLE_EXTERNAL_CODECS)) {
  fail("MSIX/Store packaging requires IMGCONVERT_DISABLE_EXTERNAL_CODECS=1");
}

const msixRoot = path.join(repoRoot, "src-tauri", "target", "windows-msix");
const layoutDir = path.join(msixRoot, "layout");

runPrepareManifest();
stageLayout();
packMsix();

function runPrepareManifest() {
  const args = [path.join("scripts", "prepare-windows-msix-release.mjs")];
  if (options.allowNonWindows) {
    args.push("--allow-non-windows");
  }
  if (options.allowMissingStoreEnv) {
    args.push("--allow-missing-store-env");
  }
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    fail(`Store manifest preparation failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`Store manifest preparation failed with exit code ${result.status ?? 1}`);
  }
}

function stageLayout() {
  const manifestPath = path.join(msixRoot, "AppxManifest.xml");
  if (!existsSync(manifestPath)) {
    fail("prepared AppxManifest.xml was not found; manifest preparation did not complete");
  }
  const executable = path.join(cargoTargetRoot(), options.profile, "imgconvert.exe");
  if (!existsSync(executable)) {
    if (isWindows) {
      fail(
        `${path.relative(repoRoot, executable)} was not found; run pnpm tauri build --ci --no-bundle first`,
      );
    }
    console.warn(
      `preflight: ${path.relative(repoRoot, executable)} does not exist on this host; staging manifest/assets only`,
    );
  }

  rmSync(layoutDir, { recursive: true, force: true });
  mkdirSync(path.join(layoutDir, "Assets"), { recursive: true });
  copyFileSync(manifestPath, path.join(layoutDir, "AppxManifest.xml"));
  if (existsSync(executable)) {
    copyFileSync(executable, path.join(layoutDir, "ImgConvert.exe"));
  }
  for (const asset of STORE_ASSETS) {
    const source = path.join(repoRoot, "src-tauri", "icons", asset.file);
    if (!existsSync(source)) {
      fail(`Store asset ${asset.file} is missing from src-tauri/icons`);
    }
    const size = pngSize(source);
    if (size.width !== asset.width || size.height !== asset.height) {
      fail(
        `Store asset ${asset.file} must be ${asset.width}x${asset.height}, got ${size.width}x${size.height}`,
      );
    }
    copyFileSync(source, path.join(layoutDir, "Assets", asset.file));
  }
  console.log(`staged ${path.relative(repoRoot, layoutDir)}`);
}

function packMsix() {
  if (!isWindows) {
    console.log("preflight complete; makeappx.exe packaging requires Windows.");
    return;
  }
  const makeappx = findWindowsSdkTool("makeappx.exe");
  if (!makeappx) {
    fail("makeappx.exe was not found; install the Windows 10/11 SDK before MSIX packaging");
  }
  const manifest = readFileSync(path.join(layoutDir, "AppxManifest.xml"), "utf8");
  const version = manifest.match(/<Identity[^>]*\sVersion="([^"]+)"/)?.[1];
  if (!version) {
    fail("could not read the package version from the prepared AppxManifest.xml");
  }
  mkdirSync(msixRoot, { recursive: true });
  const output = path.join(msixRoot, `ImgConvert_${version}_x64.msix`);
  rmSync(output, { force: true });
  const result = spawnSync(makeappx, ["pack", "/o", "/d", layoutDir, "/p", output], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    fail(`makeappx.exe pack failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`makeappx.exe pack failed with exit code ${result.status ?? 1}`);
  }
  if (!existsSync(output) || statSync(output).size === 0) {
    fail("makeappx.exe reported success but the .msix artifact is missing or empty");
  }
  console.log(`packed ${path.relative(repoRoot, output)}`);
}

function findWindowsSdkTool(tool) {
  const pathDirs = String(process.env.Path ?? process.env.PATH ?? "").split(path.delimiter);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, tool);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  const kitsRoot = process.env["ProgramFiles(x86)"]
    ? path.join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin")
    : null;
  if (kitsRoot && existsSync(kitsRoot)) {
    const versions = readdirSync(kitsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^10\.\d+\.\d+\.\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const candidate = path.join(kitsRoot, version, "x64", tool);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function pngSize(file) {
  const header = readFileSync(file).subarray(0, 24);
  if (header.length < 24 || header.toString("latin1", 1, 4) !== "PNG") {
    fail(`${path.basename(file)} is not a PNG file`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

function cargoTargetRoot() {
  return process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(repoRoot, "src-tauri", "target");
}

function printHelp() {
  console.log(`Usage: node scripts/pack-windows-msix.mjs [options]

Stages the Store MSIX layout (ImgConvert.exe, AppxManifest.xml, Assets) and
packs it with makeappx.exe. The release binary must be built first with
IMGCONVERT_DISABLE_EXTERNAL_CODECS=1, e.g. pnpm tauri build --ci --no-bundle.

Options:
  --profile=<profile>          release or debug, defaults to release.
  --allow-non-windows          Allow non-Windows layout preflight (no makeappx).
  --allow-missing-store-env    Legacy no-op; committed identity defaults are always used.

Environment:
  IMGCONVERT_DISABLE_EXTERNAL_CODECS=1
  WINDOWS_STORE_IDENTITY_NAME
  WINDOWS_STORE_PUBLISHER
  WINDOWS_STORE_PUBLISHER_DISPLAY_NAME
  WINDOWS_STORE_VERSION
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
