// SPDX-License-Identifier: Apache-2.0

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  profile: "release",
  bundleRoot: "",
  bundles: ["appimage", "macos", "msi", "nsis"],
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--bundle-root=")) {
    options.bundleRoot = path.resolve(repoRoot, arg.slice("--bundle-root=".length));
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

const bundleRoot =
  options.bundleRoot || path.join(repoRoot, "src-tauri", "target", options.profile, "bundle");

validateSigningEnvironment();

const artifacts = collectUpdaterArtifacts(bundleRoot).filter((artifact) =>
  options.bundles.some((bundle) => artifact.includes(`${path.sep}${bundle}${path.sep}`)),
);
if (artifacts.length === 0) {
  fail(`no updater artifacts found under ${path.relative(repoRoot, bundleRoot)}`);
}

for (const artifact of artifacts) {
  const signaturePath = `${artifact}.sig`;
  rmSync(signaturePath, { force: true });

  const args = ["tauri", "signer", "sign", artifact];
  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      // Tauri CLI reads the optional passphrase from the environment, avoiding argv exposure.
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    fail(`tauri signer failed for ${path.relative(repoRoot, artifact)}`);
  }
  if (!existsSync(signaturePath)) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    fail(`tauri signer did not create ${path.relative(repoRoot, signaturePath)}`);
  }
  const signature = readFileSync(signaturePath, "utf8").trim();
  if (signature.length < 40) {
    fail(`signature looks too short: ${path.relative(repoRoot, signaturePath)}`);
  }
  console.log(`signed ${path.relative(repoRoot, artifact)}`);
}

function collectUpdaterArtifacts(root) {
  if (!existsSync(root)) {
    fail(`bundle root does not exist: ${path.relative(repoRoot, root)}`);
  }
  return collectFiles(root)
    .filter(isUpdaterBundle)
    .sort((left, right) => left.localeCompare(right));
}

function collectFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(file);
    }
    if (entry.isFile()) {
      return [file];
    }
    return [];
  });
}

function isUpdaterBundle(file) {
  const name = path.basename(file).toLowerCase();
  if (statSync(file).size <= 0) {
    return false;
  }
  return (
    name.endsWith(".appimage") ||
    name.endsWith(".appimage.tar.gz") ||
    name.endsWith(".app.tar.gz") ||
    name.endsWith(".msi") ||
    name.endsWith(".exe") ||
    name.endsWith(".msi.zip") ||
    name.endsWith(".nsis.zip")
  );
}

function validateSigningEnvironment() {
  if (
    !process.env.TAURI_SIGNING_PRIVATE_KEY?.trim() &&
    !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH?.trim()
  ) {
    fail("TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH is required");
  }
}

function fail(message) {
  console.error(`sign-tauri-updater-artifacts: ${message}`);
  process.exit(1);
}
