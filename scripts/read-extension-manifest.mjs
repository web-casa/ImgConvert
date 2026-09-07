// SPDX-License-Identifier: Apache-2.0
import { lstatSync, readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// Release verification runs with Node alone. Read only a bounded manifest,
// without extracting archive paths or trusting the declared uncompressed size.
export function readExtensionManifest(archivePath) {
  const stat = lstatSync(archivePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) {
    throw new Error("extension ZIP must be a regular file within the 8 MiB budget");
  }
  const bytes = readFileSync(archivePath);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("extension ZIP end record is missing");
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt32LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    count === 0xffff ||
    offset + size !== end
  ) {
    throw new Error("unsupported extension ZIP directory");
  }
  const directoryStart = offset;
  const names = new Set();
  let manifest;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("invalid extension ZIP directory entry");
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const next =
      offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    if (next > end) throw new Error("extension ZIP entry exceeds directory bounds");
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (
      names.has(name) ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..")
    ) {
      throw new Error("duplicate or unsafe extension ZIP entry");
    }
    names.add(name);
    if (name === "manifest.json") {
      const unixType = (bytes.readUInt32LE(offset + 38) >>> 16) & 0xf000;
      if (unixType !== 0 && unixType !== 0x8000)
        throw new Error("extension manifest must be a regular file");
      const flags = bytes.readUInt16LE(offset + 8);
      const method = bytes.readUInt16LE(offset + 10);
      const compressed = bytes.readUInt32LE(offset + 20);
      const uncompressed = bytes.readUInt32LE(offset + 24);
      const local = bytes.readUInt32LE(offset + 42);
      if (
        flags & 1 ||
        ![0, 8].includes(method) ||
        uncompressed > 65_536 ||
        compressed > 65_536 ||
        local + 30 > directoryStart ||
        bytes.readUInt32LE(local) !== 0x04034b50
      ) {
        throw new Error("unsupported or oversized extension manifest");
      }
      const localNameLength = bytes.readUInt16LE(local + 26);
      const start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
      if (
        start + compressed > directoryStart ||
        bytes.readUInt16LE(local + 6) !== flags ||
        bytes.readUInt16LE(local + 8) !== method ||
        bytes.subarray(local + 30, local + 30 + localNameLength).toString("utf8") !== name
      ) {
        throw new Error("extension manifest local header mismatch");
      }
      const data = bytes.subarray(start, start + compressed);
      const decoded = method === 0 ? data : inflateRawSync(data, { maxOutputLength: 65_536 });
      if (decoded.length !== uncompressed) throw new Error("extension manifest size mismatch");
      let crc = 0xffffffff;
      for (const byte of decoded) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if ((crc ^ 0xffffffff) >>> 0 !== bytes.readUInt32LE(offset + 16)) {
        throw new Error("extension manifest CRC mismatch");
      }
      manifest = JSON.parse(decoded.toString("utf8"));
    }
    offset = next;
  }
  if (offset !== end || !manifest || manifest.manifest_version !== 3) {
    throw new Error("extension ZIP must contain one Manifest V3 manifest.json");
  }
  return manifest;
}
