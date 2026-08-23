// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "imgconvert-windows-smoke-"));
const isWindows = os.platform() === "win32";

const options = {
  allowNonWindows: false,
  buildDirect: false,
  profile: "release",
  bundles: "msi,nsis",
  signDirect: false,
  installSmoke: false,
  skipConvertSmoke: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg === "--allow-non-windows") {
    options.allowNonWindows = true;
  } else if (arg === "--build-direct") {
    options.buildDirect = true;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--bundles=")) {
    options.bundles = arg.slice("--bundles=".length);
  } else if (arg === "--sign-direct") {
    options.signDirect = true;
  } else if (arg === "--install-smoke") {
    options.installSmoke = true;
  } else if (arg === "--skip-convert-smoke") {
    options.skipConvertSmoke = true;
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!isWindows && !options.allowNonWindows) {
  fail(
    "Windows runtime smoke must run on Windows. Pass --allow-non-windows only for script preflight.",
  );
}
if (!["debug", "release"].includes(options.profile)) {
  fail(`unsupported profile: ${options.profile}`);
}
if ((options.signDirect || options.installSmoke) && !options.buildDirect) {
  fail("--sign-direct and --install-smoke require --build-direct");
}

run("pnpm", ["run", "release:windows:direct:check"], "Windows direct guardrails");
run("pnpm", ["run", "release:windows:store:check"], "Windows store guardrails", {
  IMGCONVERT_DISABLE_EXTERNAL_CODECS: "1",
});

if (!options.skipConvertSmoke) {
  runPackageConversionSmoke();
}

if (options.buildDirect) {
  requireWindows("--build-direct");
  run(
    "node",
    [
      "scripts/clean-windows-bundles.mjs",
      `--profile=${options.profile}`,
      `--bundles=${options.bundles}`,
    ],
    "clean stale Windows bundles",
  );
  const buildArgs = ["tauri", "build", "--ci", "--bundles", options.bundles];
  if (options.profile === "debug") {
    buildArgs.splice(2, 0, "--debug");
  }
  run("pnpm", buildArgs, "Windows direct installer build");
  run(
    "node",
    [
      "scripts/check-windows-bundle-artifacts.mjs",
      `--profile=${options.profile}`,
      `--bundles=${options.bundles}`,
    ],
    "Windows installer artifact check",
  );
  if (options.signDirect) {
    run(
      "node",
      [
        "scripts/sign-windows-installers.mjs",
        `--profile=${options.profile}`,
        `--bundles=${options.bundles}`,
      ],
      "Windows installer signing",
    );
  }
  if (options.installSmoke) {
    run(
      "node",
      [
        "scripts/smoke-windows-installers.mjs",
        `--profile=${options.profile}`,
        `--bundles=${options.bundles}`,
      ],
      "Windows installer install smoke",
    );
  }
}

console.log("Windows runtime smoke completed.");

function runPackageConversionSmoke() {
  requireWindows("Windows package conversion smoke");
  const executable = path.join(
    cargoTargetRoot(),
    "debug",
    process.platform === "win32" ? "imgconvert.exe" : "imgconvert",
  );
  if (!existsSync(executable)) {
    run(
      "cargo",
      ["+1.96.0", "build", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "imgconvert"],
      "build Windows smoke binary",
    );
  }
  run(executable, [], "Windows package conversion smoke", {
    IMGCONVERT_PACKAGE_CONVERT_SMOKE: "1",
    IMGCONVERT_PACKAGE_CONVERT_SMOKE_FORMATS: "jpeg,webp,png,avif",
    IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR: path.join(tmpRoot, "convert"),
  });
}

function run(command, args, label, extraEnv = {}) {
  console.log(`\n> ${label}`);
  const resolved = resolveCommand(command, args);
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  if (result.error) {
    fail(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${label} failed with exit code ${result.status ?? 1}`);
  }
}

function resolveCommand(command, args) {
  if (command === "node") {
    return { command: process.execPath, args };
  }
  if (command === "pnpm" && process.env.npm_execpath) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  if (isWindows && command === "pnpm") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", ["pnpm", ...args].map(cmdQuote).join(" ")],
    };
  }
  return { command, args };
}

function cmdQuote(value) {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:=,+-]+$/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '\\"')}"`;
}

function requireWindows(feature) {
  if (!isWindows) {
    fail(`${feature} requires Windows`);
  }
}

function cargoTargetRoot() {
  return process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(repoRoot, "src-tauri", "target");
}

function printHelp() {
  console.log(`Usage: node scripts/smoke-windows-runtime.mjs [options]

Options:
  --allow-non-windows     Allow non-Windows script preflight.
  --build-direct          Build direct .msi/.exe installers with Tauri.
  --profile=<profile>     release or debug, defaults to release.
  --bundles=<list>        Comma-separated Tauri bundles, defaults to msi,nsis.
  --sign-direct           Sign direct installers after --build-direct.
  --install-smoke         Install built installers and run hidden app smoke.
  --skip-convert-smoke    Skip hidden package conversion smoke.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
