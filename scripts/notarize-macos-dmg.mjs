// SPDX-License-Identifier: Apache-2.0

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  profile: "release",
  dmg: process.env.IMGCONVERT_MACOS_DMG ?? null,
  keychainProfile: process.env.IMGCONVERT_NOTARYTOOL_PROFILE ?? null,
  appleId: process.env.APPLE_ID ?? null,
  password: process.env.APPLE_PASSWORD ?? null,
  teamId: process.env.APPLE_TEAM_ID ?? null,
  apiKey: process.env.APPLE_API_KEY ?? null,
  apiIssuer: process.env.APPLE_API_ISSUER ?? null,
  apiKeyPath: process.env.APPLE_API_KEY_PATH ?? null,
  timeoutMinutes: positiveInteger(process.env.IMGCONVERT_NOTARY_TIMEOUT_MINUTES, 60),
  pollSeconds: positiveInteger(process.env.IMGCONVERT_NOTARY_POLL_SECONDS, 20),
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--dmg=")) {
    options.dmg = arg.slice("--dmg=".length);
  } else if (arg.startsWith("--keychain-profile=")) {
    options.keychainProfile = arg.slice("--keychain-profile=".length);
  } else if (arg.startsWith("--apple-id=")) {
    options.appleId = arg.slice("--apple-id=".length);
  } else if (arg.startsWith("--password=")) {
    options.password = arg.slice("--password=".length);
  } else if (arg.startsWith("--team-id=")) {
    options.teamId = arg.slice("--team-id=".length);
  } else if (arg.startsWith("--api-key=")) {
    options.apiKey = arg.slice("--api-key=".length);
  } else if (arg.startsWith("--api-issuer=")) {
    options.apiIssuer = arg.slice("--api-issuer=".length);
  } else if (arg.startsWith("--api-key-path=")) {
    options.apiKeyPath = arg.slice("--api-key-path=".length);
  } else if (arg.startsWith("--timeout-minutes=")) {
    options.timeoutMinutes = positiveInteger(
      arg.slice("--timeout-minutes=".length),
      options.timeoutMinutes,
    );
  } else if (arg.startsWith("--poll-seconds=")) {
    options.pollSeconds = positiveInteger(arg.slice("--poll-seconds=".length), options.pollSeconds);
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (process.platform !== "darwin") {
  fail("macOS notarization requires macOS");
}
if (!["debug", "release"].includes(options.profile)) {
  fail(`unsupported profile: ${options.profile}`);
}

const dmg = options.dmg ? path.resolve(options.dmg) : findLatestDmg();
if (!existsSync(dmg)) {
  fail(`DMG does not exist: ${dmg}`);
}

const credentials = notaryCredentials();
const submissionId = submitForNotarization(dmg, credentials);
await waitForNotarization(submissionId, credentials);
run("xcrun", ["stapler", "staple", dmg], "stapler staple");
run(
  "spctl",
  ["--assess", "--type", "open", "--context", "context:primary-signature", "-v", dmg],
  "Gatekeeper assessment",
);
run(
  "node",
  [
    "scripts/check-macos-bundle-artifacts.mjs",
    `--profile=${options.profile}`,
    "--bundles=dmg",
    "--require-signed",
    "--require-notarized",
  ],
  "signed/notarized DMG artifact verification",
);

console.log(`ok ${path.relative(repoRoot, dmg)} notarized and stapled`);

function submitForNotarization(dmgPath, credentials) {
  const response = runJson(
    "xcrun",
    ["notarytool", "submit", dmgPath, ...credentials, "--output-format", "json"],
    "notarytool submit",
    false,
    10 * 60_000,
  );
  const submissionId = response.value?.id;
  if (!response.ok || typeof submissionId !== "string" || !submissionId.trim()) {
    fail(`notarytool submit did not return a submission ID${formatCommandError(response)}`);
  }
  console.log(`notarytool submission id: ${submissionId}`);
  return submissionId;
}

async function waitForNotarization(submissionId, credentials) {
  const deadline = Date.now() + options.timeoutMinutes * 60_000;
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    const response = runJson(
      "xcrun",
      ["notarytool", "info", submissionId, ...credentials, "--output-format", "json"],
      "notarytool info",
      true,
      2 * 60_000,
    );
    if (!response.ok) {
      consecutiveErrors += 1;
      console.warn(
        `notarytool info failed (${consecutiveErrors}/5); retrying${formatCommandError(response)}`,
      );
      if (consecutiveErrors >= 5) fail("notarytool info failed five consecutive times");
    } else {
      consecutiveErrors = 0;
      const status = String(response.value?.status ?? "").trim();
      console.log(`notarytool status: ${status || "<missing>"}`);
      if (status === "Accepted") return;
      if (["Invalid", "Rejected"].includes(status)) {
        printNotarizationLog(submissionId, credentials);
        fail(`Apple notarization finished with status ${status}`);
      }
      if (status !== "In Progress") fail(`unexpected Apple notarization status: ${status}`);
    }
    await delay(options.pollSeconds * 1_000);
  }
  fail(`Apple notarization did not finish within ${options.timeoutMinutes} minutes`);
}

function printNotarizationLog(submissionId, credentials) {
  const result = spawnSync("xcrun", ["notarytool", "log", submissionId, ...credentials], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (output) console.error(output);
}

function notaryCredentials() {
  if (options.keychainProfile) {
    return ["--keychain-profile", options.keychainProfile];
  }
  if (options.apiKey && options.apiIssuer && options.apiKeyPath) {
    if (!existsSync(options.apiKeyPath)) {
      fail(`APPLE_API_KEY_PATH does not exist: ${options.apiKeyPath}`);
    }
    return ["--key", options.apiKeyPath, "--key-id", options.apiKey, "--issuer", options.apiIssuer];
  }
  if (options.appleId && options.password && options.teamId) {
    return [
      "--apple-id",
      options.appleId,
      "--password",
      options.password,
      "--team-id",
      options.teamId,
    ];
  }
  fail(
    "notarization requires IMGCONVERT_NOTARYTOOL_PROFILE, or APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH, or APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID",
  );
}

function findLatestDmg() {
  const dir = path.join(cargoTargetRoot(), options.profile, "bundle", "dmg");
  const dmgs = collectFiles(dir).filter((file) => file.toLowerCase().endsWith(".dmg"));
  if (dmgs.length === 0) {
    fail(`missing DMG artifact under ${path.relative(repoRoot, dir)}`);
  }
  dmgs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return dmgs[0];
}

function collectFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function run(command, args, label) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error) {
    fail(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${label} failed with exit code ${result.status ?? 1}`);
  }
}

function runJson(command, args, label, allowFailure = false, timeout = 2 * 60_000) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout,
  });
  if (result.error) {
    const response = { ok: false, error: result.error.message, value: null };
    if (allowFailure) return response;
    fail(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const response = { ok: false, error: result.stderr.trim(), value: null };
    if (allowFailure) return response;
    fail(`${label} failed with exit code ${result.status ?? 1}${formatCommandError(response)}`);
  }
  try {
    return { ok: true, error: "", value: JSON.parse(result.stdout.replace(/^\uFEFF/, "")) };
  } catch (error) {
    const response = { ok: false, error: `invalid JSON: ${error.message}`, value: null };
    if (allowFailure) return response;
    fail(`${label} returned invalid JSON`);
  }
}

function formatCommandError(response) {
  return response.error ? `: ${response.error}` : "";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cargoTargetRoot() {
  return process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(repoRoot, "src-tauri", "target");
}

function printHelp() {
  console.log(`Usage: node scripts/notarize-macos-dmg.mjs [options]

Options:
  --profile=<debug|release>       Cargo profile, defaults to release.
  --dmg=<path>                    DMG path. Defaults to the newest DMG artifact.
  --keychain-profile=<name>       notarytool keychain profile.
  --apple-id=<id>                 Apple ID for notarytool.
  --password=<password>           App-specific password for notarytool.
  --team-id=<TEAMID>              Apple team ID for notarytool.
  --api-key=<KEYID>               App Store Connect API key ID.
  --api-issuer=<ISSUERID>         App Store Connect issuer ID.
  --api-key-path=<path>           App Store Connect private key path.
  --timeout-minutes=<minutes>     Maximum notarization wait, defaults to 60.
  --poll-seconds=<seconds>        Status polling interval, defaults to 20.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
