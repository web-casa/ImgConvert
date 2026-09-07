import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

export function createFixture(omitted: string[] = [], additions: string[] = []) {
  const root = mkdtempSync(path.join(tmpdir(), "imgconvert-complete-release-"));
  fixtures.push(root);
  const assetsDir = path.join(root, "assets");
  mkdirSync(assetsDir);
  const assets = [
    "ImgConvert_1.2.3_amd64.deb",
    "ImgConvert_1.2.3_arm64.deb",
    "ImgConvert-1.2.3-1.x86_64.rpm",
    "ImgConvert-1.2.3-1.aarch64.rpm",
    "ImgConvert_1.2.3_amd64.AppImage",
    "ImgConvert_1.2.3_aarch64.AppImage",
    "ImgConvert-1.2.3-x86_64.AppImage",
    "ImgConvert_1.2.3_amd64.AppImage.sig",
    "ImgConvert-1.2.3-x86_64.AppImage.sig",
    "latest.json",
    "release-evidence-linux.json",
    "release-evidence-windows.json",
    "release-evidence-macos-x64.json",
    "release-evidence-macos-arm64.json",
    "release-evidence-extensions.json",
    "release-evidence-updater.json",
    "ImgConvert_1.2.3_x64.dmg",
    "ImgConvert_1.2.3_arm64.dmg",
    "ImgConvert_1.2.3_x64_en-US.msi",
    "ImgConvert_1.2.3_x64_zh-CN.msi",
    "ImgConvert_1.2.3_arm64_en-US.msi",
    "ImgConvert_1.2.3_arm64_zh-CN.msi",
    "ImgConvert_1.2.3_x64-setup.exe",
    "ImgConvert_1.2.3_arm64-setup.exe",
    "imgconvert-chrome-mv3-0.3.2.zip",
    "imgconvert-edge-mv3-0.3.2.zip",
    ...additions,
  ].filter((name) => !omitted.includes(name));
  const rows = [];
  for (const name of assets) {
    const content = name.endsWith(".zip")
      ? manifestZip("0.3.2", name.includes("chrome") ? 8 : 0)
      : Buffer.from(
          `fixture:${name.replace("ImgConvert-1.2.3-x86_64.AppImage", "ImgConvert_1.2.3_amd64.AppImage")}`,
        );
    writeFileSync(path.join(assetsDir, name), content);
    rows.push(`${createHash("sha256").update(content).digest("hex")}  ${name}`);
  }
  writeFileSync(path.join(assetsDir, "SHA256SUMS"), `${rows.join("\n")}\n`);
  const releaseNotes = path.join(root, "release-notes.md");
  writeFileSync(
    releaseNotes,
    "Windows installers are intentionally unsigned and may trigger Microsoft Defender SmartScreen.\n",
  );
  return { assetsDir, releaseTag: "v1.2.3", releaseNotes, extensionVersion: "0.3.2" };
}

// Small real ZIP fixtures exercise stored and DEFLATE manifests without an extractor.
export function manifestZip(version: string, method = 0, duplicate = false, padding = ""): Buffer {
  const data = Buffer.from(JSON.stringify({ manifest_version: 3, version, padding }));
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const compressed = method === 8 ? deflateRawSync(data) : data;
  const name = Buffer.from("manifest.json");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const entry = Buffer.concat([local, name, compressed]);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const directoryEntry = Buffer.concat([central, name]);
  const directory = duplicate ? Buffer.concat([directoryEntry, directoryEntry]) : directoryEntry;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(duplicate ? 2 : 1, 8);
  end.writeUInt16LE(duplicate ? 2 : 1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(entry.length, 16);
  return Buffer.concat([entry, directory, end]);
}
