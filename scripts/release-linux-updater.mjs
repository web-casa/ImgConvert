// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const options = {
  profile: "release",
  keyPath: process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? defaultKeyPath(),
  pubkeyPath: process.env.TAURI_UPDATER_PUBKEY_PATH ?? "",
  endpoint: "",
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length).trim();
  } else if (arg.startsWith("--key=")) {
    options.keyPath = expandHome(arg.slice("--key=".length).trim());
  } else if (arg.startsWith("--pubkey=")) {
    options.pubkeyPath = expandHome(arg.slice("--pubkey=".length).trim());
  } else if (arg.startsWith("--endpoint=")) {
    options.endpoint = arg.slice("--endpoint=".length).trim();
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!/^[A-Za-z0-9_.-]+$/.test(options.profile)) {
  fail(`invalid profile: ${options.profile}`);
}

const updaterEnv = buildUpdaterEnvironment();

run("pnpm", ["run", "toolchain:check:linux:all"], updaterEnv);
run(
  "node",
  ["scripts/clean-linux-bundles.mjs", `--profile=${options.profile}`, "--bundles=appimage"],
  updaterEnv,
);
run("pnpm", ["run", "release:updater:prepare"], updaterEnv);
run(
  "pnpm",
  [
    "tauri",
    "build",
    "--ci",
    "--bundles",
    "appimage",
    "--config",
    "src-tauri/target/updater/tauri.updater.generated.conf.json",
  ],
  { ...updaterEnv, APPIMAGE_EXTRACT_AND_RUN: "1" },
);
run("node", ["scripts/scrub-linux-appimage.mjs", `--profile=${options.profile}`], updaterEnv);
run(
  "pnpm",
  ["run", "release:updater:sign", "--", `--profile=${options.profile}`, "--bundles=appimage"],
  updaterEnv,
);
run(
  "node",
  [
    "scripts/check-linux-bundle-artifacts.mjs",
    `--profile=${options.profile}`,
    "--bundles=appimage",
  ],
  updaterEnv,
);
run(
  "node",
  [
    "scripts/generate-linux-release-checksums.mjs",
    `--profile=${options.profile}`,
    "--bundles=appimage",
  ],
  updaterEnv,
);

console.log("Linux updater AppImage release build passed.");

function buildUpdaterEnvironment() {
  const signingPrivateKey = privateKeyContent();
  const updaterPubkey = pubkeyContent();
  const endpoint = endpointConfig();

  return {
    ...process.env,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    TAURI_SIGNING_PRIVATE_KEY: signingPrivateKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
    TAURI_UPDATER_ENDPOINTS: endpoint,
    TAURI_UPDATER_PUBKEY: updaterPubkey,
  };
}

function privateKeyContent() {
  const raw = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
  if (raw) {
    return raw;
  }

  const file = expandHome(options.keyPath);
  if (!file || !existsSync(file)) {
    fail(
      `TAURI_SIGNING_PRIVATE_KEY is required; set it or create ${path.relative(repoRoot, file || defaultKeyPath())}`,
    );
  }
  const value = readFileSync(file, "utf8").trim();
  if (value.length < 40) {
    fail(`signing key file does not look like a Tauri private key: ${file}`);
  }
  return value;
}

function pubkeyContent() {
  const raw = process.env.TAURI_UPDATER_PUBKEY?.trim();
  if (raw) {
    return validatePubkey(raw);
  }

  const fallback = options.pubkeyPath || `${expandHome(options.keyPath)}.pub`;
  if (!existsSync(fallback)) {
    fail(`TAURI_UPDATER_PUBKEY is required; set it or create ${fallback}`);
  }
  return validatePubkey(readFileSync(fallback, "utf8").trim());
}

function endpointConfig() {
  const raw = process.env.TAURI_UPDATER_ENDPOINTS?.trim() || options.endpoint;
  if (raw) {
    validateEndpointList(raw);
    return raw;
  }
  return JSON.stringify([defaultLatestJsonUrl()]);
}

function validateEndpointList(raw) {
  let values = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      values = parsed.map(String);
    }
  } catch {
    values = raw.split(/[\n,]+/u).map((value) => value.trim());
  }
  values = values.filter(Boolean);
  if (values.length === 0) {
    fail("TAURI_UPDATER_ENDPOINTS must include at least one endpoint");
  }
  for (const endpoint of values) {
    let url;
    try {
      url = new URL(
        endpoint
          .replaceAll("{{target}}", "linux")
          .replaceAll("{{arch}}", "aarch64")
          .replaceAll("{{current_version}}", packageJson.version),
      );
    } catch {
      fail(`invalid updater endpoint: ${endpoint}`);
    }
    if (url.protocol !== "https:") {
      fail(`updater endpoint must use HTTPS: ${endpoint}`);
    }
  }
}

function validatePubkey(value) {
  if (/PRIVATE KEY/i.test(value)) {
    fail("TAURI_UPDATER_PUBKEY must not contain a private key");
  }
  if (value.length < 40) {
    fail("TAURI_UPDATER_PUBKEY looks too short");
  }
  return value;
}

function defaultLatestJsonUrl() {
  return `https://github.com/${defaultRepository()}/releases/latest/download/latest.json`;
}

function defaultRepository() {
  const repo = process.env.GITHUB_REPOSITORY?.trim() || "web-casa/ImgConvert";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    fail(`GITHUB_REPOSITORY must be owner/name: ${repo}`);
  }
  return repo;
}

function defaultKeyPath() {
  return path.join(os.homedir(), ".tauri", "imgconvert-updater.key");
}

function expandHome(value) {
  if (!value) {
    return "";
  }
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(repoRoot, value);
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
}

function fail(message) {
  console.error(`release-linux-updater: ${message}`);
  process.exit(1);
}
