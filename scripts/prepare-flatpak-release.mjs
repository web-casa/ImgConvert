// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const packageManager = packageJson.packageManager;
const flatpakDir = path.join(repoRoot, "packaging", "flatpak");
const manifestPath = path.join(flatpakDir, "io.github.yeagoo.imgconvert.yml");
const workRoot = path.join(repoRoot, "target", "flatpak");
const stagingRoot = mkdtempSync(path.join(os.tmpdir(), "imgconvert-flatpak-"));
const stagingDir = path.join(stagingRoot, `imgconvert-${packageJson.version}`);
const sourceDir = path.join(workRoot, "sources");
const archiveName = `imgconvert-${packageJson.version}-source.tar.gz`;
const archivePath = path.join(sourceDir, archiveName);

const options = {
  skipFetch: false,
  sourceUrl: "",
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg === "--skip-fetch") {
    options.skipFetch = true;
  } else if (arg.startsWith("--source-url=")) {
    options.sourceUrl = arg.slice("--source-url=".length).trim();
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!existsSync(manifestPath)) {
  fail(`missing ${path.relative(repoRoot, manifestPath)}`);
}
if (!/^pnpm@\d+\.\d+\.\d+$/.test(packageManager ?? "")) {
  fail("package.json packageManager must pin pnpm as pnpm@x.y.z");
}
if (options.sourceUrl) {
  validateSourceUrl(options.sourceUrl);
}

try {
  rmSync(stagingDir, { force: true, recursive: true });
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });

  copySourceTree();
  vendorCargo();
  patchVendoredDav1dAarch64Meson();
  vendorCorepack();
  if (options.skipFetch) {
    restorePnpmStore();
  } else {
    vendorPnpm();
  }
  writeFlatpakBuildNotes();
  createArchive();
  updateManifest();
} finally {
  rmSync(stagingRoot, { force: true, recursive: true });
}

console.log(`Flatpak source archive prepared: ${path.relative(repoRoot, archivePath)}`);

function copySourceTree() {
  const sourceTreeArchive = path.join(stagingRoot, "source-tree.tar");
  const result = spawnSync(
    "git",
    ["archive", "--format=tar", "--output", sourceTreeArchive, "HEAD"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    fail(`git archive failed with exit code ${result.status}`);
  }

  run("tar", ["-xf", sourceTreeArchive, "-C", stagingDir]);
  rmSync(sourceTreeArchive, { force: true });
  rmSync(path.join(stagingDir, "packaging", "flatpak", "io.github.yeagoo.imgconvert.yml"), {
    force: true,
  });
}

function vendorCargo() {
  const cargoConfigDir = path.join(stagingDir, ".cargo");
  mkdirSync(cargoConfigDir, { recursive: true });
  const result = spawnSync(
    "cargo",
    [
      "vendor",
      "--locked",
      "--versioned-dirs",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      ".flatpak-vendor/cargo",
    ],
    {
      cwd: stagingDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    fail(`cargo vendor failed with exit code ${result.status}`);
  }
  writeFileSync(path.join(cargoConfigDir, "config.toml"), result.stdout);
}

function patchVendoredDav1dAarch64Meson() {
  const cargoVendorDir = path.join(stagingDir, ".flatpak-vendor", "cargo");
  if (!existsSync(cargoVendorDir)) {
    fail("cargo vendor output missing");
  }

  let patched = false;
  for (const entry of readdirSync(cargoVendorDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("libdav1d-sys-")) {
      continue;
    }
    const crateDir = path.join(cargoVendorDir, entry.name);
    const crossFile = path.join(crateDir, "aarch64-unknown-linux-gnu.meson");
    if (!existsSync(crossFile)) {
      continue;
    }

    const original = readFileSync(crossFile, "utf8");
    const updated = original
      .replaceAll("'aarch64-linux-gnu-gcc'", "'cc'")
      .replaceAll("'aarch64-linux-gnu-g++'", "'c++'")
      .replaceAll("'aarch64-linux-gnu-ar'", "'ar'")
      .replaceAll("'aarch64-linux-gnu-strip'", "'strip'")
      .replaceAll("'aarch64-linux-gnu-pkg-config'", "'pkg-config'");
    if (updated === original) {
      continue;
    }

    writeFileSync(crossFile, updated);
    updateCargoChecksum(crateDir, "aarch64-unknown-linux-gnu.meson", sha256File(crossFile));
    patched = true;
  }

  if (!patched) {
    fail("failed to patch libdav1d-sys aarch64 Meson cross file for Flatpak SDK");
  }
}

function updateCargoChecksum(crateDir, relativePath, sha) {
  const checksumPath = path.join(crateDir, ".cargo-checksum.json");
  const checksum = JSON.parse(readFileSync(checksumPath, "utf8"));
  if (!checksum.files || typeof checksum.files !== "object") {
    fail(`${path.relative(repoRoot, checksumPath)} has no files checksum map`);
  }
  if (!(relativePath in checksum.files)) {
    fail(`${path.relative(repoRoot, checksumPath)} missing ${relativePath}`);
  }
  checksum.files[relativePath] = sha;
  writeFileSync(checksumPath, `${JSON.stringify(checksum)}\n`);
}

function vendorCorepack() {
  const vendorDir = path.join(stagingDir, ".flatpak-vendor");
  const generatedArchive = path.join(stagingDir, "corepack.tgz");
  const vendorArchive = path.join(vendorDir, "corepack.tgz");
  mkdirSync(vendorDir, { recursive: true });
  rmSync(generatedArchive, { force: true });
  rmSync(vendorArchive, { force: true });

  const result = spawnSync("corepack", ["prepare", packageManager, "--output", "--json"], {
    cwd: stagingDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    fail(`corepack prepare ${packageManager} failed with exit code ${result.status}`);
  }

  const preparedArchive = parseCorepackArchivePath(result.stdout.trim());
  if (!preparedArchive || !existsSync(preparedArchive)) {
    fail(`corepack did not generate an archive for ${packageManager}`);
  }
  renameSync(preparedArchive, vendorArchive);
}

function vendorPnpm() {
  run("pnpm", ["fetch", "--frozen-lockfile", "--store-dir", ".flatpak-vendor/pnpm-store"]);
}

function restorePnpmStore() {
  if (!existsSync(archivePath)) {
    fail("--skip-fetch requires an existing Flatpak source archive");
  }
  run("tar", ["-xzf", archivePath, "-C", stagingDir, "./.flatpak-vendor/pnpm-store"]);
  if (!existsSync(path.join(stagingDir, ".flatpak-vendor", "pnpm-store"))) {
    fail("existing Flatpak source archive does not contain .flatpak-vendor/pnpm-store");
  }
}

function writeFlatpakBuildNotes() {
  writeFileSync(
    path.join(stagingDir, ".flatpak-vendor", "README.md"),
    [
      "# Flatpak vendored inputs",
      "",
      "Generated by `pnpm run release:flatpak:prepare`.",
      "",
      `- \`.flatpak-vendor/corepack.tgz\` vendors \`${packageManager}\` for offline Corepack activation.`,
      "- `.flatpak-vendor/cargo` is produced by `cargo vendor --locked`.",
      "- `.flatpak-vendor/pnpm-store` is produced by `pnpm fetch --frozen-lockfile`.",
      "- The Flatpak manifest builds with offline Corepack, `CARGO_NET_OFFLINE=1`, and `pnpm install --offline`.",
      "",
    ].join("\n"),
  );
}

function createArchive() {
  rmSync(archivePath, { force: true });
  run("tar", [
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-czf",
    archivePath,
    "-C",
    stagingDir,
    ".",
  ]);
  writeFileSync(`${archivePath}.sha256`, `${sha256File(archivePath)}  ${archiveName}\n`);
}

function updateManifest() {
  const sourceLine = options.sourceUrl
    ? `url: ${options.sourceUrl}`
    : `path: ../../target/flatpak/sources/${archiveName}`;
  const sha = sha256File(archivePath);
  const text = readFileSync(manifestPath, "utf8");
  const updated = text
    .replace(/(type:\s+archive\s*\n\s+)(?:path|url):\s+\S+/, `$1${sourceLine}`)
    .replace(/sha256:\s+[a-f0-9]{64}/, `sha256: ${sha}`);
  if (updated === text) {
    fail("failed to update Flatpak manifest archive path or sha256");
  }
  writeFileSync(manifestPath, updated);
}

function sha256File(file) {
  const hash = createHash("sha256");
  hash.update(readFileSync(file));
  return hash.digest("hex");
}

function parseCorepackArchivePath(output) {
  if (!output) {
    return "";
  }
  try {
    const parsed = JSON.parse(output);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return output;
  }
}

function validateSourceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`invalid --source-url: ${value}`);
  }
  if (url.protocol !== "https:") {
    fail("--source-url must use https");
  }
  if (/\s/.test(value)) {
    fail("--source-url must not contain whitespace");
  }
  if (!url.pathname.endsWith(`/${archiveName}`)) {
    fail(`--source-url must end with /${archiveName}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: stagingDir,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
