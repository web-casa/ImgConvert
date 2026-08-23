// SPDX-License-Identifier: Apache-2.0

import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  profile: "release",
  target: "",
  bundles: ["dmg"],
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--target=")) {
    options.target = arg.slice("--target=".length).trim();
  } else if (arg.startsWith("--bundles=")) {
    options.bundles = arg
      .slice("--bundles=".length)
      .split(",")
      .map((bundle) => bundle.trim().toLowerCase())
      .filter(Boolean);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!["debug", "release"].includes(options.profile)) {
  fail(`unsupported profile: ${options.profile}`);
}
if (
  options.target &&
  !["aarch64-apple-darwin", "x86_64-apple-darwin", "universal-apple-darwin"].includes(
    options.target,
  )
) {
  fail(`unsupported macOS target: ${options.target}`);
}

for (const bundle of options.bundles) {
  if (!["app", "dmg"].includes(bundle)) {
    fail(`unsupported macOS bundle: ${bundle}`);
  }
}

const bundleRoot = path.join(
  cargoTargetRoot(),
  ...(options.target ? [options.target] : []),
  options.profile,
  "bundle",
);

for (const bundle of options.bundles) {
  const bundleDir = path.join(bundleRoot, bundle === "app" ? "macos" : bundle);
  rmSync(bundleDir, { force: true, recursive: true });
  console.log(`cleaned ${path.relative(repoRoot, bundleDir)}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function cargoTargetRoot() {
  return process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(repoRoot, "src-tauri", "target");
}
