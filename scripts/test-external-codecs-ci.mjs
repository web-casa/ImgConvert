// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempParent = join(root, "target");
mkdirSync(tempParent, { recursive: true });
const tempRoot = mkdtempSync(join(tempParent, "external-codecs-ci-"));
const externalCodecsPath = resolve(root, "src-tauri", "src", "external_codecs.rs");
const windowsSystemCodecsPath = resolve(root, "src-tauri", "src", "windows_system_codecs.rs");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? tempRoot,
    stdio: "inherit",
    env: process.env,
  });
}

try {
  writeFileSync(
    join(tempRoot, "Cargo.toml"),
    `[package]
name = "imgconvert-external-codecs-ci"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
path = "lib.rs"

[workspace]

[dependencies]
imgconvert-core = { path = "../../crates/imgconvert-core" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.61.3", features = [
  "Win32_Foundation",
  "Win32_Graphics_Imaging",
  "Win32_System_Com",
  "Win32_System_Com_StructuredStorage",
] }
`,
  );

  const source = readFileSync(externalCodecsPath, "utf8").replace(/^\/\/!/gm, "//");
  const windowsSystemCodecs = readFileSync(windowsSystemCodecsPath, "utf8").replace(
    /^\/\/!/gm,
    "//",
  );
  writeFileSync(
    join(tempRoot, "lib.rs"),
    `#![allow(dead_code)]
pub mod external_codecs {
${source}
}
#[cfg(target_os = "windows")]
#[path = "windows_system_codecs.rs"]
pub mod windows_system_codecs;
`,
  );
  writeFileSync(join(tempRoot, "windows_system_codecs.rs"), windowsSystemCodecs);

  run("cargo", ["test", "--lib", "--", "--nocapture"]);
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
