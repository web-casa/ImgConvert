// SPDX-License-Identifier: Apache-2.0

import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const checksumName = "SHA256SUMS";
const safeAssetName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const result = options.verify
        ? await verifyGithubReleaseChecksums(options.assetsDir)
        : await refreshGithubReleaseChecksums(options.assetsDir);
      console.log(
        `${options.verify ? "verified" : "refreshed"} ${result.outputPath} (${result.files.length} asset(s))`,
      );
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

export function parseOptions(argv) {
  const options = { assetsDir: "", help: false, verify: false };
  for (const arg of argv) {
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--verify") {
      options.verify = true;
      continue;
    }
    if (arg.startsWith("--assets-dir=")) {
      options.assetsDir = arg.slice("--assets-dir=".length).trim();
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.assetsDir) {
    throw new Error("--assets-dir=<directory> is required");
  }
  return options;
}

export async function refreshGithubReleaseChecksums(assetsDir) {
  const { directory, files } = collectReleaseAssets(assetsDir);

  const manifestRows = [];
  for (const entry of files) {
    const assetPath = path.join(directory, entry.name);
    manifestRows.push(`${await sha256File(assetPath)}  ${entry.name}`);
  }

  const outputPath = path.join(directory, checksumName);
  const temporaryPath = path.join(directory, `.${checksumName}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temporaryPath, `${manifestRows.join("\n")}\n`, { mode: 0o644 });
  renameSync(temporaryPath, outputPath);
  return { outputPath, files: files.map((entry) => entry.name) };
}

export async function verifyGithubReleaseChecksums(assetsDir) {
  const { directory, files } = collectReleaseAssets(assetsDir);
  const outputPath = path.join(directory, checksumName);
  if (!existsSync(outputPath)) {
    throw new Error(`missing ${checksumName}`);
  }
  const checksumStat = lstatSync(outputPath);
  if (!checksumStat.isFile() || checksumStat.isSymbolicLink() || checksumStat.size <= 0) {
    throw new Error(`${checksumName} must be a non-empty regular file`);
  }

  const manifest = parseChecksumManifest(readFileSync(outputPath, "utf8"));
  if (manifest.size !== files.length) {
    throw new Error(`${checksumName} does not contain exactly the release asset set`);
  }
  for (const entry of files) {
    const expected = manifest.get(entry.name);
    if (!expected) {
      throw new Error(`${checksumName} is missing ${entry.name}`);
    }
    const actual = await sha256File(path.join(directory, entry.name));
    if (actual !== expected) {
      throw new Error(`${checksumName} hash mismatch for ${entry.name}`);
    }
  }
  return { outputPath, files: files.map((entry) => entry.name) };
}

function collectReleaseAssets(assetsDir) {
  const directory = path.resolve(assetsDir);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error(`asset directory does not exist or is not a directory: ${directory}`);
  }

  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name !== checksumName)
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  if (files.length === 0) {
    throw new Error("asset directory has no release assets");
  }
  for (const entry of files) {
    if (!safeAssetName.test(entry.name)) {
      throw new Error(`unsafe release asset name: ${entry.name}`);
    }
    const assetPath = path.join(directory, entry.name);
    const stat = lstatSync(assetPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
      throw new Error(`release asset must be a non-empty regular file: ${entry.name}`);
    }
  }
  return { directory, files };
}

function parseChecksumManifest(contents) {
  if (!contents.endsWith("\n")) {
    throw new Error(`${checksumName} must end with a newline`);
  }
  const entries = contents.slice(0, -1).split("\n");
  const manifest = new Map();
  for (const entry of entries) {
    const match = entry.match(/^([0-9a-f]{64}) {2}([A-Za-z0-9][A-Za-z0-9._-]*)$/i);
    if (!match || manifest.has(match[2])) {
      throw new Error(`invalid ${checksumName} entry`);
    }
    manifest.set(match[2], match[1].toLowerCase());
  }
  return manifest;
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function printHelp() {
  console.log(`Usage: node scripts/refresh-github-release-checksums.mjs --assets-dir=<directory> [--verify]

Rebuilds <directory>/SHA256SUMS from every non-empty, safe, flat release asset.
The previous SHA256SUMS file is intentionally excluded from its own manifest.
Pass --verify to check the manifest exactly matches every downloaded release asset.
`);
}

function fail(message) {
  console.error(`refresh-github-release-checksums: ${message}`);
  process.exit(1);
}
