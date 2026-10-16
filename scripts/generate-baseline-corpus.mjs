// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors
//
// Generates a deterministic PNG corpus for desktop baseline measurements
// (docs/GPUI_BASELINE.md). Every image is a different gradient so thumbnails
// are not trivially identical, while files stay small enough to create 10,000
// of them in seconds. A sibling `<out>.manifest.json` records the SHA-256 of
// every file so a corpus copied to another machine can be verified.
//
//   node scripts/generate-baseline-corpus.mjs --out=/tmp/imgconvert-corpus-10k --count=10000

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const GENERATOR_VERSION = 1;
const FILE_PATTERN = /^baseline-\d+\.png$/;

const options = {
  out: undefined,
  count: 1000,
  size: 512,
  clean: false,
};

for (const arg of process.argv.slice(2).filter((value) => value !== "--")) {
  if (arg.startsWith("--out=")) {
    options.out = arg.slice("--out=".length);
  } else if (arg.startsWith("--count=")) {
    options.count = Number.parseInt(arg.slice("--count=".length), 10);
  } else if (arg.startsWith("--size=")) {
    options.size = Number.parseInt(arg.slice("--size=".length), 10);
  } else if (arg === "--clean") {
    options.clean = true;
  } else {
    console.error(`unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!options.out) {
  console.error(
    "usage: generate-baseline-corpus.mjs --out=<dir> [--count=N] [--size=PX] [--clean]",
  );
  process.exit(2);
}
if (!Number.isInteger(options.count) || options.count < 1 || options.count > 100_000) {
  console.error("--count must be an integer between 1 and 100000");
  process.exit(2);
}
if (!Number.isInteger(options.size) || options.size < 16 || options.size > 4096) {
  console.error("--size must be an integer between 16 and 4096");
  process.exit(2);
}

const outDir = path.resolve(options.out);
const manifestPath = `${outDir}.manifest.json`;
if (existsSync(outDir)) {
  const entries = readdirSync(outDir);
  if (entries.length > 0) {
    if (!options.clean) {
      console.error(`${outDir} is not empty; pass --clean to recreate it`);
      process.exit(2);
    }
    // Only delete a directory this generator created: every entry must be a
    // baseline file and the sibling manifest must exist.
    if (!existsSync(manifestPath) || !entries.every((name) => FILE_PATTERN.test(name))) {
      console.error(`${outDir} does not look like a generated corpus; refusing to delete it`);
      process.exit(2);
    }
    rmSync(outDir, { recursive: true, force: true });
  }
}
mkdirSync(outDir, { recursive: true });

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Integer-only gradient so the pixel data is identical on every runtime.
function gradient(index, size) {
  const rgb = Buffer.alloc(size * size * 3);
  const hue = (index * 137) % 360;
  const [r0, g0, b0] = hslToRgb(hue, 60, 45);
  const [r1, g1, b1] = hslToRgb((hue + 120) % 360, 60, 55);
  const span = 2 * (size - 1);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = x + y; // 0 … span
      const offset = (y * size + x) * 3;
      rgb[offset] = r0 + Math.floor(((r1 - r0) * t) / span);
      rgb[offset + 1] = g0 + Math.floor(((g1 - g0) * t) / span);
      rgb[offset + 2] = b0 + Math.floor(((b1 - b0) * t) / span);
    }
  }
  // A small index-dependent marker so no two files are byte-identical.
  const mx = (index * 7) % size;
  const my = (index * 13) % size;
  const marker = (my * size + mx) * 3;
  rgb[marker] = 255 - rgb[marker];
  return rgb;
}

/** HSL (degrees, percent, percent) → RGB using integer arithmetic only. */
function hslToRgb(h, sPercent, lPercent) {
  // Work in thousandths to stay in integers.
  const s = sPercent * 10;
  const l = lPercent * 10;
  const c = ((1000 - Math.abs(2 * l - 1000)) * s) / 1000;
  const hp = h % 360;
  const sector = Math.floor(hp / 60);
  // Distance from the sector midpoint, mirrored every 120°: 0 at sector edges, 60 at the centre.
  const x = (c * (60 - Math.abs((hp % 120) - 60))) / 60;
  let rgb;
  if (sector === 0) rgb = [c, x, 0];
  else if (sector === 1) rgb = [x, c, 0];
  else if (sector === 2) rgb = [0, c, x];
  else if (sector === 3) rgb = [0, x, c];
  else if (sector === 4) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return rgb.map((value) => Math.min(255, Math.max(0, Math.round(((value + m) * 255) / 1000))));
}

const digits = String(options.count).length;
let totalBytes = 0;
const files = [];
for (let index = 0; index < options.count; index += 1) {
  const png = encodePng(options.size, options.size, gradient(index, options.size));
  const name = `baseline-${String(index + 1).padStart(digits, "0")}.png`;
  totalBytes += png.length;
  writeFileSync(path.join(outDir, name), png);
  files.push({ name, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex") });
}

const manifest = {
  generator: GENERATOR_VERSION,
  node: process.version,
  count: options.count,
  size: options.size,
  totalBytes,
  files,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  JSON.stringify({
    out: outDir,
    manifest: manifestPath,
    count: options.count,
    size: options.size,
    totalBytes,
  }),
);
