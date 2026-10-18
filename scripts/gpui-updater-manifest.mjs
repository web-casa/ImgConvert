// SPDX-License-Identifier: Apache-2.0

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function assertLegacyUpdaterVersion(version) {
  if (!/^v?0\.3\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("The legacy latest.json endpoint must never advertise GPUI 0.4.x or later");
  }
}

function numericVersion(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(value)) {
    throw new Error("minimum_system_version must contain numeric dotted versions");
  }
  const parts = value.split(".").map(Number);
  if (parts.some((n) => !Number.isSafeInteger(n) || n > 0xffffffff))
    throw new Error("System version is out of range");
  return [...parts, 0, 0].slice(0, 3);
}

export function createGpuiManifest(input) {
  const parsed =
    typeof input?.version === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/.exec(input.version);
  if (!parsed || (Number(parsed[1]) === 0 && Number(parsed[2]) < 4)) {
    throw new Error("GPUI manifests must use SemVer 0.4.0 or later");
  }
  const minimum = input.minimum_system_version;
  if (!minimum || typeof minimum !== "object")
    throw new Error("minimum_system_version is required");
  for (const [os, floor] of Object.entries({
    linux: [0, 0, 0],
    macos: [12, 0, 0],
    windows: [10, 0, 18362],
  })) {
    if (!(os in minimum)) continue;
    const actual = numericVersion(minimum[os]);
    const first = actual.findIndex((n, i) => n !== floor[i]);
    if (first >= 0 && actual[first] < floor[first])
      throw new Error("System version lowers the GPUI baseline");
  }
  const platforms = {};
  for (const [target, entry] of Object.entries(input.platforms ?? {})) {
    const match = /^(linux|macos|darwin|windows)-(x86_64|aarch64)$/.exec(target);
    if (!match) throw new Error(`Unsupported updater target: ${target}`);
    const os = match[1] === "darwin" ? "macos" : match[1];
    numericVersion(minimum[os]);
    const formats = { linux: ["appimage"], macos: ["app"], windows: ["nsis", "wix"] };
    if (!formats[os].includes(entry.format)) throw new Error(`Invalid update format for ${target}`);
    const url = new URL(entry.url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new Error("Package URLs must use credential-free HTTPS");
    if (typeof entry.signature !== "string" || !entry.signature.trim())
      throw new Error("An updater signature is required");
    const normalized = { url: url.href, signature: entry.signature.trim(), format: entry.format };
    // Tauri uses darwin-*; cargo-packager-updater uses macos-*.
    const aliases = os === "macos" ? [`macos-${match[2]}`, `darwin-${match[2]}`] : [target];
    for (const alias of aliases) {
      if (platforms[alias] && JSON.stringify(platforms[alias]) !== JSON.stringify(normalized))
        throw new Error(`Conflicting updater aliases for ${alias}`);
      platforms[alias] = normalized;
    }
  }
  if (!Object.keys(platforms).length) throw new Error("At least one updater platform is required");
  return {
    version: input.version,
    ...(input.notes ? { notes: input.notes } : {}),
    minimum_system_version: minimum,
    platforms,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination || !destination.endsWith("latest-v2.json"))
    throw new Error("Usage: node scripts/gpui-updater-manifest.mjs INPUT OUTPUT/latest-v2.json");
  const manifest = createGpuiManifest(JSON.parse(readFileSync(source, "utf8")));
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
}
