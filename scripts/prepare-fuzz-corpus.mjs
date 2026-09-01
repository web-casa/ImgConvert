// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fuzzCorpusRoot = path.join(repoRoot, "fuzz", "corpus");
const tauriFuzzCorpusRoot = path.join(repoRoot, "src-tauri", "fuzz", "corpus");
const targetManifestDir = path.join(repoRoot, "target", "fuzz-corpus");

const options = {
  realDirs: realDirsFromEnv(),
  maxBytes: numberFromEnv("IMGCONVERT_REAL_CORPUS_MAX_BYTES", 32 * 1024 * 1024),
  maxFiles: numberFromEnv("IMGCONVERT_REAL_CORPUS_MAX_FILES", 256),
  requireReal: false,
  skipGenerated: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg === "--require-real") {
    options.requireReal = true;
  } else if (arg === "--skip-generated") {
    options.skipGenerated = true;
  } else if (arg.startsWith("--real-dir=")) {
    options.realDirs.push(path.resolve(repoRoot, arg.slice("--real-dir=".length)));
  } else if (arg.startsWith("--max-bytes=")) {
    options.maxBytes = parsePositiveInteger(arg.slice("--max-bytes=".length), "--max-bytes");
  } else if (arg.startsWith("--max-files=")) {
    options.maxFiles = parsePositiveInteger(arg.slice("--max-files=".length), "--max-files");
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

options.realDirs = unique(options.realDirs);

if (!options.skipGenerated) {
  runCargoSeedGenerator();
  writeTauriFuzzSeeds();
}

function writeTauriFuzzSeeds() {
  const manifestRoot = path.join(tauriFuzzCorpusRoot, "external_codec_manifest");
  const scannerRoot = path.join(tauriFuzzCorpusRoot, "import_scanner");
  const pdfRoot = path.join(tauriFuzzCorpusRoot, "pdf_document");
  for (const directory of [manifestRoot, scannerRoot, pdfRoot]) {
    mkdirSync(directory, { recursive: true });
  }

  writeFileSync(
    path.join(manifestRoot, "valid.json"),
    `${JSON.stringify({
      id: "ci-seed",
      protocol: 1,
      license: "MIT",
      readable: ["heic", "heif"],
      writable: [],
      mode: "external-process",
      decode: {
        kind: "heic-to-png-file",
        command: "bin/helper",
        output: "png",
      },
    })}\n`,
  );
  writeFileSync(path.join(manifestRoot, "malformed.json"), '{"decode":{"args":["{input}"]');

  writeFileSync(
    path.join(scannerRoot, "nested-and-symlinks.bin"),
    Uint8Array.from([10, 0x62, 0x03, 0xe7, 0x25, 0x46, 0x07, 0x88, 1, 2, 3, 4, 5, 6]),
  );
  writeFileSync(
    path.join(scannerRoot, "pdf-and-limits.bin"),
    Uint8Array.from([7, 0x07, 0xff, 0x47, 0x27, 0x67, 0x87, 0xa7, 0xc7, 0xe7]),
  );

  writeFileSync(path.join(pdfRoot, "minimal.pdf"), minimalPdf());
  writeFileSync(path.join(pdfRoot, "truncated.pdf"), "%PDF-1.7\n1 0 obj\n<< /Type /Catalog");
}

function minimalPdf() {
  const stream = "q 1 0 0 rg 0 0 72 72 re f Q\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

const imported = importRealCorpus();
writeManifest(imported);

if (options.requireReal && imported.length === 0) {
  fail(
    "no real corpus images were imported; add files under corpus/real or set IMGCONVERT_REAL_CORPUS_DIRS",
  );
}

console.log(
  `fuzz corpus prepared: generated=${options.skipGenerated ? "skipped" : "yes"}, real=${imported.length}`,
);

function runCargoSeedGenerator() {
  const result = spawnSync(
    "cargo",
    [
      "+1.96.0",
      "run",
      "-p",
      "imgconvert-core",
      "--example",
      "generate_fuzz_corpus",
      "--",
      fuzzCorpusRoot,
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.error) {
    fail(`failed to start cargo seed generator: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function importRealCorpus() {
  mkdirSync(path.join(fuzzCorpusRoot, "decode_pipeline"), { recursive: true });
  mkdirSync(path.join(fuzzCorpusRoot, "convert_pipeline"), { recursive: true });

  const imported = [];
  for (const realDir of options.realDirs) {
    if (!existsSync(realDir)) {
      continue;
    }
    for (const file of walkFiles(realDir)) {
      if (imported.length >= options.maxFiles) {
        return imported;
      }
      const stat = statSync(file);
      if (!stat.isFile() || stat.size === 0 || stat.size > options.maxBytes) {
        continue;
      }
      const head = readHead(file, 64 * 1024);
      const format = formatFromMagic(head);
      if (!format) {
        continue;
      }
      const bytes = readFileSync(file);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const importedName = `real-${format}-${sha256.slice(0, 16)}.${extensionForFormat(format)}`;
      const decodePath = path.join(fuzzCorpusRoot, "decode_pipeline", importedName);
      const convertPath = path.join(fuzzCorpusRoot, "convert_pipeline", importedName);
      copyFileSync(file, decodePath);
      copyFileSync(file, convertPath);
      imported.push({
        sourceName: path.basename(file),
        format,
        bytes: stat.size,
        sha256,
        decodeSeed: path.relative(repoRoot, decodePath),
        convertSeed: path.relative(repoRoot, convertPath),
      });
    }
  }
  return imported;
}

function* walkFiles(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      let info;
      try {
        info = lstatSync(fullPath);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) {
        continue;
      }
      if (info.isDirectory()) {
        stack.push(fullPath);
      } else if (info.isFile()) {
        yield fullPath;
      }
    }
  }
}

function writeManifest(imported) {
  mkdirSync(targetManifestDir, { recursive: true });
  const manifestPath = path.join(targetManifestDir, "real-corpus-manifest.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        host: {
          platform: os.platform(),
          arch: os.arch(),
        },
        realDirCount: options.realDirs.length,
        maxBytes: options.maxBytes,
        maxFiles: options.maxFiles,
        imported,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`real corpus manifest: ${path.relative(repoRoot, manifestPath)}`);
}

function realDirsFromEnv() {
  const envDirs = (process.env.IMGCONVERT_REAL_CORPUS_DIRS ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(repoRoot, item));
  return [path.join(repoRoot, "corpus", "real"), ...envDirs];
}

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  return parsePositiveInteger(raw, name);
}

function parsePositiveInteger(raw, label) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`${label} must be a positive integer`);
  }
  return parsed;
}

function readHead(file, bytes) {
  const data = readFileSync(file);
  return data.subarray(0, bytes);
}

function formatFromMagic(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes.subarray(1, 4).toString("ascii") === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
    return "gif";
  }
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString("ascii") === "BM") {
    return "bmp";
  }
  if (
    bytes.length >= 16 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(bytes.subarray(12, 16).toString("ascii"))
  ) {
    return "webp";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
    (bytes.subarray(8).includes(Buffer.from("avif")) ||
      bytes.subarray(8).includes(Buffer.from("avis")))
  ) {
    return "avif";
  }
  if (/<svg(?=[\s/>:])/i.test(bytes.toString("latin1"))) {
    return "svg";
  }
  return undefined;
}

function extensionForFormat(format) {
  return format === "jpeg" ? "jpg" : format;
}

function unique(values) {
  return [...new Set(values)];
}

function fail(message) {
  console.error(`prepare fuzz corpus failed: ${message}`);
  process.exit(1);
}
