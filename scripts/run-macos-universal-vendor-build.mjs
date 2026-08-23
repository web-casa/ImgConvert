// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "src-tauri", "Cargo.toml");
const lockPath = path.join(repoRoot, "src-tauri", "Cargo.lock");
const temporaryPrefix = "imgconvert-macos-universal-vendor-";

const command = commandFromArguments(process.argv.slice(2));
if (!command) {
  printHelp();
  process.exit(0);
}

if (process.platform !== "darwin") {
  fail("this wrapper is only for a macOS universal build");
}
if (!existsSync(manifestPath) || !existsSync(lockPath)) {
  fail("src-tauri Cargo manifest or lockfile is missing");
}
if (readFileSync(lockPath, "utf8").includes('source = "git+')) {
  fail("unhandled git dependency in src-tauri/Cargo.lock; extend the vendor configuration first");
}

const workRoot = mkdtempSync(path.join(os.tmpdir(), temporaryPrefix));
try {
  const vendorDir = path.join(workRoot, "vendor");
  const cargoHome = path.join(workRoot, "cargo-home");
  mkdirSync(cargoHome, { recursive: true });

  vendorLockedDependencies(vendorDir);
  patchVendoredDav1dForMacosUniversalBuild(vendorDir);
  writeVendorCargoConfig(cargoHome, vendorDir);
  runRequestedBuild(command, cargoHome);
} finally {
  removeOwnTemporaryDirectory(workRoot);
}

function commandFromArguments(args) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return null;
  }
  const separator = args.indexOf("--");
  if (separator !== 0 || args.length < 2) {
    fail("expected a command after -- (for example: -- pnpm tauri build ...)");
  }
  return args.slice(1);
}

function vendorLockedDependencies(vendorDir) {
  const result = spawnSync(
    "cargo",
    [
      "vendor",
      "--locked",
      "--versioned-dirs",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      vendorDir,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error) {
    fail(`cargo vendor failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    fail(`cargo vendor failed with exit code ${result.status ?? "unknown"}`);
  }
  if (!existsSync(vendorDir)) {
    fail("cargo vendor did not create the expected dependency directory");
  }
}

function patchVendoredDav1dForMacosUniversalBuild(vendorDir) {
  const buildScriptPath = findVendoredDav1dBuildScript(vendorDir);
  const updated = patchedDav1dBuildScript(readFileSync(buildScriptPath, "utf8"));

  writeFileSync(buildScriptPath, updated);
  updateCargoChecksum(buildScriptPath, "build.rs", sha256File(buildScriptPath));
}

function findVendoredDav1dBuildScript(vendorDir) {
  const crates = readdirSync(vendorDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("libdav1d-sys-"))
    .map((entry) => path.join(vendorDir, entry.name));
  if (crates.length !== 1) {
    fail(`expected one vendored libdav1d-sys crate, found ${crates.length}`);
  }
  return path.join(crates[0], "build.rs");
}

function patchedDav1dBuildScript(original) {
  const targetMarker = '    let target = env::var("TARGET").expect("TARGET");\n';
  const buildMarker = "\n    let s = meson\n";
  if (
    !original.includes(targetMarker) ||
    !original.includes(buildMarker) ||
    original.includes("imgconvert-macos-dav1d-cross.meson")
  ) {
    fail(
      "unexpected libdav1d-sys build.rs; review the universal macOS overlay before upgrading it",
    );
  }

  const withHost = original.replace(
    targetMarker,
    `${targetMarker}    let host = env::var("HOST").expect("HOST");\n`,
  );
  const updated =
    withHost.replace(buildMarker, `${macosCrossSetup()}${buildMarker}`) + macosCrossTargetHelper();
  if (updated === original || !updated.includes("imgconvert_macos_cross_target")) {
    fail("failed to apply the libdav1d-sys macOS universal-build overlay");
  }
  return updated;
}

function macosCrossSetup() {
  return `
    if let Some((arch, cpu_family, cpu)) = imgconvert_macos_cross_target(&target, &host) {
        let cross_file = out_dir.join("imgconvert-macos-dav1d-cross.meson");
        let cross_file_contents = format!(
            r#"[binaries]
c = ['xcrun', '--sdk', 'macosx', 'clang', '-arch', '{arch}']
ar = 'ar'
strip = 'strip'

[properties]
needs_exe_wrapper = true

[host_machine]
system = 'darwin'
cpu_family = '{cpu_family}'
cpu = '{cpu}'
endian = 'little'
"#,
        );
        std::fs::write(&cross_file, cross_file_contents)
            .expect("failed to write the ImgConvert macOS dav1d Meson cross file");
        meson.arg("--cross-file").arg(cross_file);
    }
`;
}

function macosCrossTargetHelper() {
  return `

fn imgconvert_macos_cross_target(
    target: &str,
    host: &str,
) -> Option<(&'static str, &'static str, &'static str)> {
    match (target, host) {
        ("x86_64-apple-darwin", "aarch64-apple-darwin") => {
            Some(("x86_64", "x86_64", "x86_64"))
        }
        ("aarch64-apple-darwin", "x86_64-apple-darwin") => {
            Some(("arm64", "aarch64", "arm64"))
        }
        _ => None,
    }
}
`;
}

function writeVendorCargoConfig(cargoHome, vendorDir) {
  const configPath = path.join(cargoHome, "config.toml");
  const directory = tomlString(vendorDir);
  writeFileSync(
    configPath,
    `[source.crates-io]\nreplace-with = "imgconvert-universal-vendor"\n\n[source.imgconvert-universal-vendor]\ndirectory = ${directory}\n\n[net]\noffline = true\n`,
  );
}

function runRequestedBuild(commandArgs, cargoHome) {
  const [executable, ...args] = commandArgs;
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      CARGO_HOME: cargoHome,
      CARGO_NET_OFFLINE: "true",
    },
    stdio: "inherit",
  });
  if (result.error) {
    fail(`${executable} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${executable} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function updateCargoChecksum(buildScriptPath, relativePath, sha) {
  const checksumPath = path.join(path.dirname(buildScriptPath), ".cargo-checksum.json");
  const checksum = JSON.parse(readFileSync(checksumPath, "utf8"));
  if (!checksum.files || typeof checksum.files !== "object" || !(relativePath in checksum.files)) {
    fail(`vendored checksum is missing ${relativePath}`);
  }
  checksum.files[relativePath] = sha;
  writeFileSync(checksumPath, `${JSON.stringify(checksum)}\n`);
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function tomlString(value) {
  return JSON.stringify(value);
}

function removeOwnTemporaryDirectory(directory) {
  const parent = path.resolve(os.tmpdir());
  const resolved = path.resolve(directory);
  const relative = path.relative(parent, resolved);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !path.basename(resolved).startsWith(temporaryPrefix)
  ) {
    console.error(`refusing to remove unexpected temporary directory: ${resolved}`);
    return;
  }
  rmSync(resolved, { recursive: true, force: true });
}

function printHelp() {
  console.log(`Usage: node scripts/run-macos-universal-vendor-build.mjs -- COMMAND [ARGS...]

Creates an isolated, locked Cargo vendor directory for a macOS universal build,
adds the missing libdav1d-sys Meson cross configuration only to that temporary
copy, then runs COMMAND with the temporary vendor configured as CARGO_HOME.
`);
}

function fail(message) {
  throw new Error(`run-macos-universal-vendor-build: ${message}`);
}
