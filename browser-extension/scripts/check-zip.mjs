// SPDX-License-Identifier: Apache-2.0
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const browser = process.argv
  .find((argument) => argument.startsWith("--browser="))
  ?.slice("--browser=".length);

if (browser !== "chrome" && browser !== "edge") {
  throw new Error("Expected --browser=chrome or --browser=edge");
}

const archivePath = join(
  projectRoot,
  ".output",
  `imgconvert-${browser}-mv3-${packageJson.version}.zip`,
);
const buildRoot = join(projectRoot, ".output", `${browser}-mv3`);
const archive = await readFile(archivePath);

function findEndOfCentralDirectory(bytes) {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end-of-central-directory record is missing");
}

function listZipEntries(bytes) {
  const end = findEndOfCentralDirectory(bytes);
  const entryCount = bytes.readUInt16LE(end + 10);
  const centralDirectorySize = bytes.readUInt32LE(end + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(end + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  if (centralDirectoryEnd > end) throw new Error("ZIP central directory exceeds its bounds");

  const entries = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`ZIP central-directory entry ${index} is invalid`);
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (offset !== centralDirectoryEnd) throw new Error("ZIP central-directory size does not match");
  return entries;
}

async function buildFiles(directory, root = directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await buildFiles(path, root)));
    else if (entry.isFile()) result.push(relative(root, path).split(sep).join("/"));
  }
  return result;
}

const entries = listZipEntries(archive);
const uniqueEntries = new Set(entries);
if (entries.length !== uniqueEntries.size) throw new Error("ZIP contains duplicate entry names");
for (const entry of entries) {
  if (entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes("..")) {
    throw new Error(`ZIP contains an unsafe entry path: ${entry}`);
  }
}

const expectedFiles = (await buildFiles(buildRoot)).sort();
const actualFiles = entries.filter((entry) => !entry.endsWith("/")).sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error("ZIP file list does not exactly match the unpacked vendor build");
}

for (const required of ["manifest.json", "converter.html"]) {
  if (!uniqueEntries.has(required)) throw new Error(`ZIP is missing ${required}`);
}

const archiveBytes = (await stat(archivePath)).size;
if (archiveBytes > 8 * 1024 * 1024) throw new Error("ZIP exceeds the 8 MiB EXT budget");

console.log(
  `${browser}: ZIP structure matches the unpacked build (${actualFiles.length} files, ${archiveBytes} bytes)`,
);
