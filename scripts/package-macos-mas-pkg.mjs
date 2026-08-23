// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { target: "" };

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--target=")) {
    options.target = arg.slice("--target=".length).trim();
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (process.platform !== "darwin") {
  fail("MAS pkg packaging requires macOS");
}
if (
  options.target &&
  !["aarch64-apple-darwin", "x86_64-apple-darwin", "universal-apple-darwin"].includes(
    options.target,
  )
) {
  fail(`unsupported macOS target: ${options.target}`);
}

const identity = process.env.IMGCONVERT_MAS_INSTALLER_IDENTITY?.trim();
if (!identity) {
  fail("IMGCONVERT_MAS_INSTALLER_IDENTITY is required to sign the MAS .pkg");
}

const packageJson = JSON.parse(readFileSyncText(path.join(repoRoot, "package.json")));
const app = findAppBundle();
const pkgDir = path.join(targetRoot(), "release", "bundle", "pkg");
const pkgPath = path.join(pkgDir, `ImgConvert_${packageJson.version}_mas.pkg`);

mkdirSync(pkgDir, { recursive: true });
run("xcrun", ["productbuild", "--sign", identity, "--component", app, "/Applications", pkgPath]);
verifyInstallerSignature(pkgPath);

console.log(`ok ${path.relative(repoRoot, pkgPath)} (${statSync(pkgPath).size} bytes)`);

function findAppBundle() {
  const appDir = path.join(targetRoot(), "release", "bundle", "macos");
  const apps = collectFiles(appDir).filter((file) => file.endsWith(".app"));
  if (apps.length !== 1) {
    fail(
      `expected exactly one .app artifact under ${path.relative(repoRoot, appDir)}, found ${apps.length}`,
    );
  }
  return apps[0];
}

function collectFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      files.push(entryPath);
    } else if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    }
  }
  return files;
}

function run(command, args) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status ?? 1}`);
  }
}

function verifyInstallerSignature(pkgPath) {
  const result = spawnSync("pkgutil", ["--check-signature", pkgPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (output) console.log(output);
  if (result.error) {
    fail(`pkgutil failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`pkgutil failed with exit code ${result.status ?? 1}`);
  }
  if (!/(Mac Installer Distribution|3rd Party Mac Developer Installer):/.test(output)) {
    fail("MAS .pkg is not signed by a Mac Installer Distribution certificate");
  }
}

function cargoTargetRoot() {
  return process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(repoRoot, "src-tauri", "target");
}

function targetRoot() {
  return path.join(cargoTargetRoot(), ...(options.target ? [options.target] : []));
}

function readFileSyncText(file) {
  return readFileSync(file, "utf8");
}

function printHelp() {
  console.log(`Usage: node scripts/package-macos-mas-pkg.mjs [options]

Options:
  --target=<target>  Optional Tauri target directory, for example universal-apple-darwin.
  --help             Show this help.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
