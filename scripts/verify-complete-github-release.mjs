// SPDX-License-Identifier: Apache-2.0

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyWindowsReleaseAssetNames } from "./windows-release-assets.mjs";
import { githubReleaseAssetGroups, releaseEvidenceName } from "./github-release-assets.mjs";
import { readExtensionManifest } from "./read-extension-manifest.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const safeAssetName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const result = verifyCompleteGithubRelease(options);
      console.log(
        `complete GitHub Release candidate verified (${result.assets.length} assets, ${result.releaseTag})`,
      );
    }
  } catch (error) {
    console.error(
      `verify-complete-github-release: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

export function parseOptions(argv) {
  const options = {
    assetsDir: "",
    releaseNotes: "",
    releaseTag: "",
    extensionVersion: "",
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--assets-dir=")) {
      options.assetsDir = arg.slice("--assets-dir=".length).trim();
    } else if (arg.startsWith("--release-notes=")) {
      options.releaseNotes = arg.slice("--release-notes=".length).trim();
    } else if (arg.startsWith("--extension-version=")) {
      options.extensionVersion = arg.slice("--extension-version=".length).trim();
    } else if (arg.startsWith("--release-tag=")) {
      options.releaseTag = arg.slice("--release-tag=".length).trim();
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!options.help) {
    if (!options.extensionVersion)
      throw new Error("--extension-version=<tagged extension version> is required");
    if (!options.assetsDir) throw new Error("--assets-dir=<directory> is required");
    if (!options.releaseTag) throw new Error("--release-tag=v<version> is required");
    if (!options.releaseNotes) throw new Error("--release-notes=<file> is required");
  }
  return options;
}

export function verifyCompleteGithubRelease({
  assetsDir,
  releaseNotes,
  releaseTag,
  extensionVersion,
}) {
  if (!/^v\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.-]+)?$/u.test(releaseTag)) {
    throw new Error("release tag must be a semantic v-prefixed version");
  }
  if (
    typeof extensionVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:\.\d+)?$/u.test(extensionVersion)
  ) {
    throw new Error("extension version must be the numeric version from the release tag");
  }
  const version = releaseTag.slice(1);
  const directory = path.resolve(assetsDir);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error(`asset directory does not exist: ${directory}`);
  }

  const assets = readdirSync(directory, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort();
  for (const name of assets) {
    const assetPath = path.join(directory, name);
    if (!safeAssetName.test(name)) throw new Error(`unsafe release asset name: ${name}`);
    const stat = lstatSync(assetPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
      throw new Error(`release asset must be a non-empty regular file: ${name}`);
    }
  }

  verifyWindowsReleaseAssetNames(assets, version);
  for (const browser of ["chrome", "edge"]) {
    const expected = `imgconvert-${browser}-mv3-${extensionVersion}.zip`;
    const candidates = assets.filter(
      (name) => name.startsWith(`imgconvert-${browser}-mv3-`) && /\.zip$/iu.test(name),
    );
    if (candidates.length !== 1 || candidates[0] !== expected) {
      throw new Error(`${browser} extension ZIP must match tagged version ${extensionVersion}`);
    }
    const manifest = readExtensionManifest(path.join(directory, expected));
    if (manifest.version !== extensionVersion) {
      throw new Error(`${browser} extension manifest version does not match ${extensionVersion}`);
    }
  }

  const groups = githubReleaseAssetGroups(version, extensionVersion);
  const expectedAssets = new Set([
    ...Object.values(groups).flat(),
    ...Object.keys(groups).map(releaseEvidenceName),
    "SHA256SUMS",
  ]);
  for (const name of expectedAssets) {
    if (!assets.includes(name)) throw new Error(`missing required release asset: ${name}`);
  }
  for (const name of assets) {
    if (!expectedAssets.has(name)) throw new Error(`unexpected release asset: ${name}`);
  }
  const checksumsForAliases = parseChecksumManifest(
    readFileSync(path.join(directory, "SHA256SUMS"), "utf8"),
  );
  for (const suffix of ["", ".sig"]) {
    const original = `ImgConvert_${version}_amd64.AppImage${suffix}`;
    const alias = `ImgConvert-${version}-x86_64.AppImage${suffix}`;
    if (checksumsForAliases.get(original) !== checksumsForAliases.get(alias)) {
      throw new Error(`AppImageHub alias must have the same digest as ${original}`);
    }
  }

  const checksumPath = path.join(directory, "SHA256SUMS");
  if (!assets.includes("SHA256SUMS")) throw new Error("SHA256SUMS is missing");
  const checksums = parseChecksumManifest(readFileSync(checksumPath, "utf8"));
  const expectedChecksumNames = assets.filter((name) => name !== "SHA256SUMS");
  if (
    checksums.size !== expectedChecksumNames.length ||
    expectedChecksumNames.some((name) => !checksums.has(name))
  ) {
    throw new Error("SHA256SUMS does not cover exactly every release asset");
  }

  const notesPath = path.resolve(releaseNotes);
  if (!existsSync(notesPath) || !lstatSync(notesPath).isFile()) {
    throw new Error(`release notes do not exist: ${notesPath}`);
  }
  const notes = readFileSync(notesPath, "utf8");
  if (!/SmartScreen/iu.test(notes) || !/(unsigned|未签名)/iu.test(notes)) {
    throw new Error(
      "release notes must visibly warn that Windows installers are unsigned and may trigger SmartScreen",
    );
  }

  return { assets, releaseTag };
}

function parseChecksumManifest(contents) {
  if (!contents.endsWith("\n")) throw new Error("SHA256SUMS must end with a newline");
  const rows = contents.slice(0, -1).split("\n");
  const result = new Map();
  for (const row of rows) {
    const match = row.match(/^([0-9a-f]{64}) {2}([A-Za-z0-9][A-Za-z0-9._-]*)$/iu);
    if (!match || result.has(match[2])) throw new Error("invalid SHA256SUMS entry");
    result.set(match[2], match[1].toLowerCase());
  }
  return result;
}

function printHelp() {
  console.log(`Usage: node scripts/verify-complete-github-release.mjs \\
  --assets-dir=<directory> --release-tag=v<version> --release-notes=<file> --extension-version=<version>

Verifies the mandatory Linux, macOS, Windows, Chrome-extension, and
Edge-extension direct-download matrix, the merged checksum manifest, and the
required Windows SmartScreen warning.
`);
}
