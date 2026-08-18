#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = path.join(repoRoot, "src-tauri");

// Keep this list in sync with src-tauri/deny.toml.
//
// These are explicit upstream exceptions, not a broad RustSec bypass:
// - Tauri 2.11.x still uses the GTK3/WebKitGTK Linux stack.
// - plist 1.9.0 still pins quick-xml 0.39.x via tauri-utils; quick-xml is not on
//   the user image decoding path in ImgConvert.
// - rav1e/libavif and Tauri build-time macro chains currently carry a few
//   unmaintained-only advisories with no direct replacement in our dependency graph.
// - bincode 1.x is pinned by tauri-plugin-persisted-scope and has no safe upgrade.
const ignoredAdvisories = [
  "RUSTSEC-2024-0370",
  "RUSTSEC-2024-0411",
  "RUSTSEC-2024-0412",
  "RUSTSEC-2024-0413",
  "RUSTSEC-2024-0414",
  "RUSTSEC-2024-0415",
  "RUSTSEC-2024-0416",
  "RUSTSEC-2024-0417",
  "RUSTSEC-2024-0418",
  "RUSTSEC-2024-0419",
  "RUSTSEC-2024-0420",
  "RUSTSEC-2024-0436",
  "RUSTSEC-2025-0075",
  "RUSTSEC-2025-0080",
  "RUSTSEC-2025-0081",
  "RUSTSEC-2025-0098",
  "RUSTSEC-2025-0100",
  "RUSTSEC-2026-0194",
  "RUSTSEC-2026-0195",
  "RUSTSEC-2025-0141",
];

const args = ["audit", ...ignoredAdvisories.flatMap((id) => ["--ignore", id])];
const result = spawnSync("cargo", args, {
  cwd: tauriDir,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
