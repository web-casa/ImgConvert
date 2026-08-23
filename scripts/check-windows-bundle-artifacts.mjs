// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  profile: "release",
  bundles: ["msi", "nsis"],
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
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
  msi: ".msi",
  nsis: ".exe",
};

for (const bundle of options.bundles) {
  if (!expectedExtensions[bundle]) {
    fail(`unsupported Windows bundle: ${bundle}`);
  }
}

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const bundleRoot = path.join(cargoTargetRoot(), options.profile, "bundle");
const failures = [];
const verified = [];

for (const bundle of options.bundles) {
  const bundleDir = path.join(bundleRoot, bundle);
  const artifacts = collectFiles(bundleDir).filter((file) =>
    file.toLowerCase().endsWith(expectedExtensions[bundle]),
  );
  if (artifacts.length === 0) {
    failures.push(`missing ${bundle} artifact under ${path.relative(repoRoot, bundleDir)}`);
    continue;
  }
  for (const artifact of artifacts) {
    const basename = path.basename(artifact);
    const size = statSync(artifact).size;
    if (size <= 0) {
      failures.push(`empty artifact: ${path.relative(repoRoot, artifact)}`);
      continue;
    }
    if (!basename.includes(packageJson.version)) {
      failures.push(
        `artifact name does not contain version ${packageJson.version}: ${path.relative(repoRoot, artifact)}`,
      );
      continue;
    }
    if (!basename.toLowerCase().includes("imgconvert")) {
      failures.push(`artifact name must include ImgConvert: ${path.relative(repoRoot, artifact)}`);
      continue;
    }
    verified.push({ artifact, size });
  }
}

verifyMainExecutableArchitecture();

for (const item of verified) {
  console.log(`ok ${path.relative(repoRoot, item.artifact)} (${item.size} bytes)`);
}

if (failures.length > 0) {
  console.error("Windows bundle artifact check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Windows bundle artifact check passed (${verified.length} artifact(s)).`);

function verifyMainExecutableArchitecture() {
  if (process.platform !== "win32") {
    return;
  }
  const executable = path.join(cargoTargetRoot(), options.profile, "imgconvert.exe");
  if (!existsSync(executable)) {
    failures.push(
      `missing built ImgConvert.exe for architecture verification: ${path.relative(repoRoot, executable)}`,
    );
    return;
  }
  const expected = expectedWindowsArchitecture();
  const actual = peProcessorArchitecture(executable);
  if (actual !== expected) {
    failures.push(
      `ImgConvert.exe architecture mismatch: expected ${expected} native build, got ${actual}`,
    );
    return;
  }
  console.log(`ok ${path.relative(repoRoot, executable)} (${actual})`);
}

function peProcessorArchitecture(file) {
  const binary = readFileSync(file);
  if (binary.length < 0x40 || binary.readUInt16LE(0) !== 0x5a4d) {
    fail(`${path.relative(repoRoot, file)} is not a valid PE executable (missing MZ header)`);
  }
  const peOffset = binary.readUInt32LE(0x3c);
  if (peOffset > binary.length - 6 || binary.readUInt32LE(peOffset) !== 0x00004550) {
    fail(`${path.relative(repoRoot, file)} is not a valid PE executable (missing PE header)`);
  }
  const machine = binary.readUInt16LE(peOffset + 4);
  if (machine === 0x8664) return "x64";
  if (machine === 0xaa64) return "arm64";
  fail(
    `${path.relative(repoRoot, file)} uses unsupported PE machine type 0x${machine.toString(16).padStart(4, "0")}`,
  );
}

function expectedWindowsArchitecture() {
  const configured = String(process.env.WINDOWS_STORE_PROCESSOR_ARCHITECTURE ?? "")
    .trim()
    .toLowerCase();
  if (configured) {
    if (["x64", "arm64"].includes(configured)) {
      return configured;
    }
    fail(`unsupported WINDOWS_STORE_PROCESSOR_ARCHITECTURE: ${configured}`);
  }
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  fail(`unsupported Windows Node architecture: ${process.arch}`);
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

function cargoTargetRoot() {
  return process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(repoRoot, "src-tauri", "target");
}
