// SPDX-License-Identifier: Apache-2.0

import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
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
  bundles: ["deb", "rpm", "appimage"],
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--target=")) {
    options.target = arg.slice("--target=".length);
  } else if (arg.startsWith("--bundles=")) {
    options.bundles = arg
      .slice("--bundles=".length)
      .split(",")
      .map((bundle) => bundle.trim().toLowerCase())
      .filter(Boolean);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!["debug", "release"].includes(options.profile)) {
  fail(`unsupported profile: ${options.profile}`);
}

const expectedExtensions = {
  deb: ".deb",
  rpm: ".rpm",
  appimage: ".AppImage",
};

for (const bundle of options.bundles) {
  if (!expectedExtensions[bundle]) {
    fail(`unsupported Linux bundle: ${bundle}`);
  }
}

const targetParts = ["src-tauri", "target"];
if (options.target) {
  targetParts.push(options.target);
}
targetParts.push(options.profile, "bundle");

const bundleRoot = path.join(repoRoot, ...targetParts);
const verified = [];
const failures = [];
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
// AppImageHub requires the oldest supported Ubuntu LTS. Ubuntu 22.04 ships
// GLIBC 2.35, so every ELF included in the AppImage must stay on that baseline.
const maxSupportedGlibc = "2.35";

for (const bundle of options.bundles) {
  const bundleDir = path.join(bundleRoot, bundle);
  const artifacts = collectFiles(bundleDir).filter((file) =>
    file.endsWith(expectedExtensions[bundle]),
  );

  if (artifacts.length === 0) {
    failures.push(`missing ${bundle} artifact under ${path.relative(repoRoot, bundleDir)}`);
    continue;
  }

  for (const artifact of artifacts) {
    const size = statSync(artifact).size;
    if (size <= 0) {
      failures.push(`empty artifact: ${path.relative(repoRoot, artifact)}`);
      continue;
    }
    if (!path.basename(artifact).includes(packageJson.version)) {
      failures.push(
        `artifact name does not contain version ${packageJson.version}: ${path.relative(repoRoot, artifact)}`,
      );
      continue;
    }
    const metadataFailures = inspectBundleArtifact(bundle, artifact);
    if (metadataFailures.length > 0) {
      failures.push(...metadataFailures);
      continue;
    }
    verified.push({ artifact, size });
  }
}

for (const item of verified) {
  console.log(`ok ${path.relative(repoRoot, item.artifact)} (${item.size} bytes)`);
}

if (failures.length > 0) {
  console.error("Linux bundle artifact check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Linux bundle artifact check passed (${verified.length} artifact(s)).`);

function collectFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function inspectBundleArtifact(bundle, artifact) {
  switch (bundle) {
    case "deb":
      return inspectDeb(artifact);
    case "rpm":
      return inspectRpm(artifact);
    case "appimage":
      return inspectAppImage(artifact);
    default:
      return [];
  }
}

function inspectDeb(artifact) {
  if (!commandExists("dpkg-deb")) {
    return ["dpkg-deb is required to inspect .deb artifacts"];
  }

  const failures = [];
  const fields = commandOutput("dpkg-deb", ["-f", artifact]);
  if (!fields.ok) {
    return [`dpkg-deb failed for ${path.relative(repoRoot, artifact)}: ${fields.stderr}`];
  }
  const metadata = parseDebFields(fields.stdout);
  if (metadata.Version !== packageJson.version) {
    failures.push(
      `deb version mismatch: expected ${packageJson.version}, got ${metadata.Version ?? "<missing>"}`,
    );
  }
  const depends = metadata.Depends ?? "";
  for (const dep of ["libwebkit2gtk-4.1-0", "libgtk-3-0"]) {
    if (!depends.includes(dep)) {
      failures.push(`deb missing dependency ${dep}`);
    }
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), "imgconvert-deb-"));
  try {
    const extract = spawnSync("dpkg-deb", ["-x", artifact, tmp], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (extract.status !== 0) {
      failures.push(`dpkg-deb extract failed: ${extract.stderr.trim()}`);
    } else {
      failures.push(...inspectExtractedLinuxBundle(tmp, "deb"));
    }
  } finally {
    rmSync(tmp, { force: true, recursive: true });
  }
  return failures;
}

function inspectRpm(artifact) {
  if (!commandExists("rpm")) {
    return ["rpm is required to inspect .rpm artifacts"];
  }

  const query = commandOutput("rpm", ["-qpl", artifact]);
  if (!query.ok) {
    return [`rpm -qpl failed for ${path.relative(repoRoot, artifact)}: ${query.stderr}`];
  }
  const files = query.stdout.split(/\r?\n/).filter(Boolean);
  const failures = [];
  if (!files.includes("/usr/bin/imgconvert")) {
    failures.push("rpm missing /usr/bin/imgconvert");
  }
  if (!files.some((file) => file.endsWith("/usr/share/applications/ImgConvert.desktop"))) {
    failures.push("rpm missing ImgConvert.desktop");
  }
  return failures;
}

function inspectAppImage(artifact) {
  const failures = [];
  const mode = statSync(artifact).mode;
  if (!(mode & 0o111)) {
    failures.push(`AppImage is not executable: ${path.relative(repoRoot, artifact)}`);
  }

  failures.push(...inspectAppImageContents(artifact));
  return failures;
}

function inspectAppImageContents(artifact) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "imgconvert-appimage-"));
  try {
    const extract = spawnSync(artifact, ["--appimage-extract"], {
      cwd: tmp,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (extract.status !== 0) {
      return [
        `AppImage extract failed for ${path.relative(repoRoot, artifact)}: ${extract.stderr.trim()}`,
      ];
    }

    const root = path.join(tmp, "squashfs-root");
    return inspectExtractedAppImage(root);
  } finally {
    rmSync(tmp, { force: true, recursive: true });
  }
}

function inspectExtractedAppImage(root) {
  const failures = inspectExtractedLinuxBundle(root, "AppImage");
  failures.push(...inspectGlibcTree(root, "AppImage"));
  const deniedLibraries = ["libgcrypt.so.20"];
  const libDir = path.join(root, "usr", "lib");
  for (const library of deniedLibraries) {
    if (existsSync(path.join(libDir, library))) {
      failures.push(
        `AppImage bundles ${library}; scrub it so Ubuntu/Debian use a matching system libgcrypt/libgpg-error pair`,
      );
    }
  }
  for (const link of [".DirIcon", "ImgConvert.desktop", "imgconvert.png"]) {
    const linkPath = path.join(root, link);
    if (!existsSync(linkPath)) {
      failures.push(`AppImage missing root ${link}`);
      continue;
    }
    const stat = lstatSync(linkPath);
    if (stat.isSymbolicLink() && path.isAbsolute(readlinkSync(linkPath))) {
      failures.push(`AppImage root ${link} symlink must be relative, not host-absolute`);
    }
  }
  const metainfoPath = path.join(
    root,
    "usr",
    "share",
    "metainfo",
    "com.ivmm.imgconvert.metainfo.xml",
  );
  if (!existsSync(metainfoPath)) {
    failures.push("AppImage missing usr/share/metainfo/com.ivmm.imgconvert.metainfo.xml");
  } else {
    const metainfo = readFileSync(metainfoPath, "utf8");
    for (const marker of [
      "<id>com.ivmm.imgconvert</id>",
      '<launchable type="desktop-id">ImgConvert.desktop</launchable>',
      `<release version="${packageJson.version}"`,
    ]) {
      if (!metainfo.includes(marker)) {
        failures.push(`AppImage AppStream metadata missing marker: ${marker}`);
      }
    }
  }
  return failures;
}

function inspectExtractedLinuxBundle(root, source) {
  const failures = [];
  const binary = path.join(root, "usr", "bin", "imgconvert");
  if (!existsSync(binary)) {
    failures.push(`${source} missing usr/bin/imgconvert`);
  } else {
    failures.push(...inspectGlibcBaseline(binary, source));
  }

  const desktopPath = path.join(root, "usr", "share", "applications", "ImgConvert.desktop");
  if (!existsSync(desktopPath)) {
    failures.push(`${source} missing ImgConvert.desktop`);
    return failures;
  }

  const desktop = parseDesktopEntry(readFileSync(desktopPath, "utf8"));
  const categories = desktop.Categories ?? "";
  if (!desktop.Name?.trim()) {
    failures.push(`${source} desktop entry missing Name`);
  } else if (desktop.Name !== "ImgConvert") {
    failures.push(`${source} desktop entry default Name must be ImgConvert`);
  }
  if (desktop.Type !== "Application") {
    failures.push(`${source} desktop entry Type must be Application`);
  }
  if (!desktop.Exec?.includes("imgconvert")) {
    failures.push(`${source} desktop entry Exec must launch imgconvert`);
  }
  if (!categories.trim()) {
    failures.push(`${source} desktop entry Categories must not be empty`);
  }
  if (desktop.Comment && /[\u3400-\u9fff]/u.test(desktop.Comment)) {
    failures.push(`${source} desktop entry default Comment must be English; use Comment[zh_CN]`);
  }
  return failures;
}

function inspectGlibcTree(root, source) {
  if (!commandExists("readelf")) {
    return ["readelf is required to inspect Linux binary GLIBC baseline"];
  }

  let maximum = "0.0";
  let maximumFile = "";
  for (const file of collectFiles(root)) {
    if (!isElf(file)) {
      continue;
    }
    const result = commandOutput("readelf", ["--version-info", file]);
    if (!result.ok) {
      continue;
    }
    const versions = [...result.stdout.matchAll(/GLIBC_(\d+\.\d+)/g)].map((match) => match[1]);
    const fileMaximum = versions.sort(compareVersions).at(-1);
    if (fileMaximum && compareVersions(fileMaximum, maximum) > 0) {
      maximum = fileMaximum;
      maximumFile = path.relative(root, file);
    }
  }

  if (maximum === "0.0") {
    return [`${source} GLIBC version requirements were not found in bundled ELF files`];
  }
  if (compareVersions(maximum, maxSupportedGlibc) > 0) {
    return [
      `${source} contains ${maximumFile} requiring GLIBC_${maximum}; AppImageHub baseline is GLIBC_${maxSupportedGlibc} (Ubuntu 22.04)`,
    ];
  }
  return [];
}

function isElf(file) {
  let descriptor;
  try {
    descriptor = openSync(file, "r");
    const magic = Buffer.alloc(4);
    return (
      readSync(descriptor, magic, 0, magic.length, 0) === 4 &&
      magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    );
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function inspectGlibcBaseline(binary, source) {
  if (!commandExists("readelf")) {
    return ["readelf is required to inspect Linux binary GLIBC baseline"];
  }

  const result = commandOutput("readelf", ["--version-info", binary]);
  if (!result.ok) {
    return [`readelf failed for ${source} binary: ${result.stderr}`];
  }

  const versions = [...result.stdout.matchAll(/GLIBC_(\d+\.\d+)/g)].map((match) => match[1]);
  if (versions.length === 0) {
    return [`${source} binary GLIBC version requirements were not found`];
  }

  const maxVersion = versions.sort(compareVersions).at(-1);
  if (compareVersions(maxVersion, maxSupportedGlibc) > 0) {
    return [
      `${source} binary requires GLIBC_${maxVersion}; release baseline is GLIBC_${maxSupportedGlibc} (Ubuntu 22.04 LTS)`,
    ];
  }
  return [];
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function parseDebFields(text) {
  const fields = {};
  let current = "";
  for (const line of text.split(/\r?\n/)) {
    if (/^\s/.test(line) && current) {
      fields[current] += `\n${line.trim()}`;
      continue;
    }
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    current = match[1];
    fields[current] = match[2];
  }
  return fields;
}

function parseDesktopEntry(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("[") || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    fields[line.slice(0, index)] = line.slice(index + 1);
  }
  return fields;
}

function commandExists(command) {
  const result = spawnSync("sh", ["-c", `command -v ${quoteShell(command)} >/dev/null 2>&1`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
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
  console.error(message);
  process.exit(1);
}
