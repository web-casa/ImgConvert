// SPDX-License-Identifier: Apache-2.0

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const options = {
  profile: "release",
  artifact: "",
  output: path.join(repoRoot, "target", "appimagehub"),
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--artifact=")) {
    options.artifact = path.resolve(repoRoot, arg.slice("--artifact=".length));
  } else if (arg.startsWith("--output=")) {
    options.output = path.resolve(repoRoot, arg.slice("--output=".length));
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!/^[A-Za-z0-9_.-]+$/.test(options.profile)) {
  fail(`invalid profile: ${options.profile}`);
}

const artifact = options.artifact || findAppImage();
if (!existsSync(artifact) || statSync(artifact).size === 0) {
  fail(`AppImage is missing or empty: ${artifact}`);
}
if (!path.basename(artifact).includes(packageJson.version)) {
  fail(`AppImage name must contain version ${packageJson.version}: ${path.basename(artifact)}`);
}

const architecture = appImageArchitecture(artifact);
const canonicalName = `ImgConvert-${packageJson.version}-${architecture}.AppImage`;
const destination = path.join(options.output, canonicalName);
mkdirSync(options.output, { recursive: true });
copyFileSync(artifact, destination);
chmodSync(destination, statSync(destination).mode | 0o111);

const copied = [destination];
const signature = `${artifact}.sig`;
if (existsSync(signature) && statSync(signature).size > 0) {
  const signatureDestination = `${destination}.sig`;
  copyFileSync(signature, signatureDestination);
  copied.push(signatureDestination);
}

const checksumLines = copied.map((file) => `${sha256(file)}  ${path.basename(file)}`);
writeFileSync(path.join(options.output, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, "utf8");

console.log(`AppImageHub asset prepared: ${path.relative(repoRoot, destination)}`);

function findAppImage() {
  const directory = path.join(
    repoRoot,
    "src-tauri",
    "target",
    options.profile,
    "bundle",
    "appimage",
  );
  const artifacts = collectFiles(directory).filter((file) => file.endsWith(".AppImage"));
  if (artifacts.length !== 1) {
    fail(
      `expected one AppImage under ${path.relative(repoRoot, directory)}, found ${artifacts.length}`,
    );
  }
  return artifacts[0];
}

function appImageArchitecture(file) {
  const basename = path.basename(file).toLowerCase();
  if (basename.includes("amd64") || basename.includes("x86_64")) {
    return "x86_64";
  }
  if (basename.includes("arm64") || basename.includes("aarch64")) {
    return "aarch64";
  }
  fail(`cannot determine AppImage architecture from ${path.basename(file)}`);
}

function collectFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  });
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fail(message) {
  console.error(`prepare-appimagehub-release: ${message}`);
  process.exit(1);
}
