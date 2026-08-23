// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error("Mac App Store validation and upload require macOS");
  }

  const pkg = options.pkg ? path.resolve(options.pkg) : findMasPkg(options.target);
  requirePkg(pkg);
  const credentials = appStoreCredentials(process.env);

  runAltool("validate", pkg, credentials);
  console.log(`ok ${path.relative(repoRoot, pkg)} validated by App Store Connect`);

  if (options.upload) {
    runAltool("upload", pkg, credentials);
    console.log(`ok ${path.relative(repoRoot, pkg)} uploaded to App Store Connect`);
  }
}

function parseOptions(args) {
  const options = { help: false, pkg: null, target: "", upload: false };
  for (const arg of args) {
    if (arg === "--") {
      continue;
    } else if (arg.startsWith("--pkg=")) {
      options.pkg = requiredText(arg.slice("--pkg=".length), "package path");
    } else if (arg.startsWith("--target=")) {
      options.target = validateTarget(arg.slice("--target=".length));
    } else if (arg === "--upload") {
      options.upload = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function appStoreCredentials(env) {
  return {
    appleId: requiredText(env.APPLE_ID, "APPLE_ID"),
    password: requiredText(env.APPLE_PASSWORD, "APPLE_PASSWORD"),
    provider: optionalText(env.APPLE_PROVIDER_SHORT_NAME, "APPLE_PROVIDER_SHORT_NAME"),
  };
}

function buildAltoolArgs(mode, pkg, credentials) {
  if (!["validate", "upload"].includes(mode)) {
    throw new Error(`unsupported App Store operation: ${mode}`);
  }
  const operation = mode === "validate" ? "--validate-app" : "--upload-app";
  const args = [
    "altool",
    operation,
    "-f",
    pkg,
    "-t",
    "macos",
    "-u",
    credentials.appleId,
    "-p",
    credentials.password,
    "--output-format",
    "xml",
  ];
  if (credentials.provider) args.push("--asc-provider", credentials.provider);
  return args;
}

function runAltool(mode, pkg, credentials) {
  console.log(`> xcrun altool ${mode} (credentials redacted)`);
  const result = spawnSync("xcrun", buildAltoolArgs(mode, pkg, credentials), {
    cwd: repoRoot,
    stdio: "inherit",
    timeout: 30 * 60 * 1000,
  });
  if (result.error) {
    throw new Error(`altool ${mode} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`altool ${mode} failed with exit code ${result.status ?? 1}`);
  }
}

function findMasPkg(target) {
  const packageVersion = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ).version;
  const pkgDir = path.join(
    cargoTargetRoot(),
    ...(target ? [target] : []),
    "release",
    "bundle",
    "pkg",
  );
  const expectedName = `ImgConvert_${packageVersion}_mas.pkg`;
  const candidates = existsSync(pkgDir)
    ? readdirSync(pkgDir)
        .filter((entry) => entry === expectedName)
        .map((entry) => path.join(pkgDir, entry))
    : [];
  if (candidates.length !== 1) {
    throw new Error(
      `expected exactly one ${expectedName} under ${path.relative(repoRoot, pkgDir)}`,
    );
  }
  return candidates[0];
}

function requirePkg(pkg) {
  if (path.extname(pkg).toLowerCase() !== ".pkg") {
    throw new Error(`App Store artifact must be a .pkg: ${pkg}`);
  }
  if (!existsSync(pkg)) {
    throw new Error(`missing or empty App Store .pkg: ${pkg}`);
  }
  const details = statSync(pkg);
  if (!details.isFile() || details.size === 0) {
    throw new Error(`missing or empty App Store .pkg: ${pkg}`);
  }
}

function requiredText(value, label) {
  const text = optionalText(value, label);
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function optionalText(value, label) {
  const text = String(value ?? "").trim();
  if (text.length > 512 || /[\r\n\0]/.test(text)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return text || null;
}

function validateTarget(value) {
  const target = requiredText(value, "target");
  if (!["aarch64-apple-darwin", "x86_64-apple-darwin", "universal-apple-darwin"].includes(target)) {
    throw new Error(`unsupported macOS target: ${target}`);
  }
  return target;
}

function cargoTargetRoot() {
  return process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(repoRoot, "src-tauri", "target");
}

function printHelp() {
  console.log(`Usage: node scripts/submit-macos-mas-pkg.mjs [options]

Validates a signed Mac Installer Distribution .pkg with App Store Connect.
Validation is the default and never uploads a build.

Options:
  --pkg=<path>  Exact MAS .pkg. Defaults to the current release-version package.
  --target=<target>  Tauri target directory used when locating the default package.
  --upload      Upload only after validation succeeds.
  --help        Show this help.

Environment:
  APPLE_ID                       App Store Connect Apple ID.
  APPLE_PASSWORD                 App-specific password.
  APPLE_PROVIDER_SHORT_NAME      Optional provider short name.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

export { appStoreCredentials, buildAltoolArgs, parseOptions };
