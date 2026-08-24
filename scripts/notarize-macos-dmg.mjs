// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const RECEIPT_SCHEMA_VERSION = 1;
const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2), process.env);
  if (options.help) {
    printHelp();
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error("macOS notarization requires macOS");
  }
  if (!["debug", "release"].includes(options.profile)) {
    throw new Error(`unsupported profile: ${options.profile}`);
  }

  const dmg = options.dmg ? path.resolve(options.dmg) : findLatestDmg(options);
  requireFile(dmg, "DMG");
  const credentials = notaryCredentials(options);

  if (options.mode === "finalize") {
    await finalizeSavedSubmission(dmg, options, credentials);
    return;
  }

  verifySignedDmg(dmg, options.profile, options.expectedArchitectures);
  const submissionId = submitForNotarization(dmg, credentials);
  const receipt = createNotarizationReceipt({
    submissionId,
    dmgPath: dmg,
    source: sourceMetadata(process.env),
  });
  if (options.receipt) {
    writeReceipt(path.resolve(options.receipt), receipt);
  }
  writeGithubOutputs(receipt, "Submitted");

  if (options.mode === "submit") {
    console.log(`ok ${path.relative(repoRoot, dmg)} submitted for notarization`);
    return;
  }

  await waitForNotarization(submissionId, credentials, options);
  finalizeAcceptedDmg(
    dmg,
    submissionId,
    credentials,
    options.profile,
    options.expectedArchitectures,
  );
}

async function finalizeSavedSubmission(dmg, options, credentials) {
  if (!options.receipt) {
    throw new Error("--finalize requires --receipt=<path>");
  }
  const receiptPath = path.resolve(options.receipt);
  requireFile(receiptPath, "notarization receipt");
  const receipt = readReceipt(receiptPath);
  validateNotarizationReceipt(receipt, dmg, expectedSource(process.env));

  const status = getNotarizationStatus(receipt.submissionId, credentials);
  writeGithubOutputs(receipt, status);
  if (status === "In Progress") {
    console.log(`Apple notarization is still in progress: ${receipt.submissionId}`);
    return;
  }
  if (["Invalid", "Rejected"].includes(status)) {
    printNotarizationLog(receipt.submissionId, credentials);
    throw new Error(`Apple notarization finished with status ${status}`);
  }
  if (status !== "Accepted") {
    throw new Error(`unexpected Apple notarization status: ${status}`);
  }

  finalizeAcceptedDmg(
    dmg,
    receipt.submissionId,
    credentials,
    options.profile,
    options.expectedArchitectures,
  );
}

function finalizeAcceptedDmg(dmg, submissionId, credentials, profile, expectedArchitectures) {
  printNotarizationLog(submissionId, credentials);
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
      `--profile=${profile}`,
      "--bundles=dmg",
      `--artifact=${dmg}`,
      "--require-signed",
      "--require-notarized",
      ...expectedArchitectureArgument(expectedArchitectures),
    ],
    "signed/notarized DMG artifact verification",
  );
  console.log(`ok ${path.relative(repoRoot, dmg)} notarized and stapled`);
}

function verifySignedDmg(dmg, profile, expectedArchitectures) {
  run(
    "node",
    [
      "scripts/check-macos-bundle-artifacts.mjs",
      `--profile=${profile}`,
      "--bundles=dmg",
      `--artifact=${dmg}`,
      "--require-signed",
      ...expectedArchitectureArgument(expectedArchitectures),
    ],
    "signed DMG pre-submission verification",
  );
  if (!existsSync(dmg)) {
    throw new Error(`DMG disappeared during verification: ${dmg}`);
  }
}

function submitForNotarization(dmgPath, credentials) {
  const response = runJson(
    "xcrun",
    ["notarytool", "submit", dmgPath, ...credentials, "--output-format", "json"],
    "notarytool submit",
    false,
    10 * 60_000,
  );
  const submissionId = response.value?.id;
  if (!response.ok || !isSubmissionId(submissionId)) {
    throw new Error(
      `notarytool submit did not return a submission ID${formatCommandError(response)}`,
    );
  }
  console.log(`notarytool submission id: ${submissionId}`);
  return submissionId;
}

async function waitForNotarization(submissionId, credentials, options) {
  const deadline = Date.now() + options.timeoutMinutes * 60_000;
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    const response = queryNotarizationStatus(submissionId, credentials, true);
    if (!response.ok) {
      consecutiveErrors += 1;
      console.warn(
        `notarytool info failed (${consecutiveErrors}/5); retrying${formatCommandError(response)}`,
      );
      if (consecutiveErrors >= 5) {
        throw new Error("notarytool info failed five consecutive times");
      }
    } else {
      consecutiveErrors = 0;
      const status = normalizeNotarizationStatus(response.value?.status);
      console.log(`notarytool status: ${status}`);
      if (status === "Accepted") return;
      if (["Invalid", "Rejected"].includes(status)) {
        printNotarizationLog(submissionId, credentials);
        throw new Error(`Apple notarization finished with status ${status}`);
      }
      if (status !== "In Progress") {
        throw new Error(`unexpected Apple notarization status: ${status}`);
      }
    }
    await delay(options.pollSeconds * 1_000);
  }
  throw new Error(`Apple notarization did not finish within ${options.timeoutMinutes} minutes`);
}

function getNotarizationStatus(submissionId, credentials) {
  const response = queryNotarizationStatus(submissionId, credentials, false);
  const status = normalizeNotarizationStatus(response.value?.status);
  console.log(`notarytool status: ${status}`);
  return status;
}

function queryNotarizationStatus(submissionId, credentials, allowFailure) {
  return runJson(
    "xcrun",
    ["notarytool", "info", submissionId, ...credentials, "--output-format", "json"],
    "notarytool info",
    allowFailure,
    2 * 60_000,
  );
}

function printNotarizationLog(submissionId, credentials) {
  console.log("\n> notarytool log");
  const result = spawnSync("xcrun", ["notarytool", "log", submissionId, ...credentials], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 2 * 60_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (output) console.log(output);
  if (result.error || result.status !== 0) {
    console.warn(
      `notarytool log could not be retrieved: ${result.error?.message ?? `exit ${result.status}`}`,
    );
  }
}

export function createNotarizationReceipt({
  submissionId,
  dmgPath,
  source,
  submittedAt = new Date().toISOString(),
}) {
  if (!isSubmissionId(submissionId)) {
    throw new Error("invalid Apple notarization submission ID");
  }
  requireFile(dmgPath, "DMG");
  const dmgStat = statSync(dmgPath);
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    submissionId,
    submittedAt,
    dmg: {
      name: path.basename(dmgPath),
      size: dmgStat.size,
      sha256: sha256File(dmgPath),
    },
    source: normalizeSource(source),
  };
  validateNotarizationReceipt(receipt, dmgPath);
  return receipt;
}

export function validateNotarizationReceipt(receipt, dmgPath, expected = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("notarization receipt must be a JSON object");
  }
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new Error(`unsupported notarization receipt schema: ${receipt.schemaVersion}`);
  }
  if (!isSubmissionId(receipt.submissionId)) {
    throw new Error("notarization receipt has an invalid submission ID");
  }
  if (!isIsoTimestamp(receipt.submittedAt)) {
    throw new Error("notarization receipt has an invalid submittedAt timestamp");
  }
  requireFile(dmgPath, "DMG");
  const dmgStat = statSync(dmgPath);
  if (receipt.dmg?.name !== path.basename(dmgPath)) {
    throw new Error("notarization receipt DMG name does not match the downloaded file");
  }
  if (receipt.dmg?.size !== dmgStat.size) {
    throw new Error("notarization receipt DMG size does not match the downloaded file");
  }
  if (receipt.dmg?.sha256 !== sha256File(dmgPath)) {
    throw new Error("notarization receipt DMG SHA-256 does not match the downloaded file");
  }

  const source = normalizeSource(receipt.source);
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && source[field] !== value) {
      throw new Error(`notarization receipt source ${field} does not match the source run`);
    }
  }
  return receipt;
}

function normalizeSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("notarization receipt source must be an object");
  }
  const normalized = {
    repository: safeText(source.repository, "source repository", 200),
    runId: numericText(source.runId, "source run ID"),
    workflow: safeText(source.workflow, "source workflow", 200),
    workflowRunSha: shaText(source.workflowRunSha, "workflow run SHA"),
    sourceSha: shaText(source.sourceSha, "source SHA"),
    releaseTag:
      source.releaseTag == null || source.releaseTag === ""
        ? null
        : safeText(source.releaseTag, "release tag", 128),
    publishRelease: booleanValue(source.publishRelease, "publishRelease"),
  };
  if (normalized.publishRelease && !normalized.releaseTag) {
    throw new Error("publishRelease requires a release tag");
  }
  if (
    normalized.releaseTag &&
    !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized.releaseTag)
  ) {
    throw new Error("invalid release tag");
  }
  return normalized;
}

function sourceMetadata(env) {
  const publishValue = env.IMGCONVERT_NOTARY_PUBLISH_RELEASE ?? "false";
  if (!new Set(["true", "false"]).has(publishValue)) {
    throw new Error("IMGCONVERT_NOTARY_PUBLISH_RELEASE must be true or false");
  }
  const localSha = "0000000000000000000000000000000000000000";
  return {
    repository: env.GITHUB_REPOSITORY ?? "local/ImgConvert",
    runId: env.GITHUB_RUN_ID ?? "0",
    workflow: env.GITHUB_WORKFLOW ?? "local notarization",
    workflowRunSha: env.GITHUB_SHA ?? localSha,
    sourceSha: env.IMGCONVERT_NOTARY_SOURCE_SHA ?? env.GITHUB_SHA ?? localSha,
    releaseTag: env.IMGCONVERT_NOTARY_RELEASE_TAG ?? null,
    publishRelease: publishValue === "true",
  };
}

function expectedSource(env) {
  const expected = {
    repository: env.IMGCONVERT_NOTARY_EXPECTED_REPOSITORY,
    runId: env.IMGCONVERT_NOTARY_EXPECTED_SOURCE_RUN_ID,
    workflow: env.IMGCONVERT_NOTARY_EXPECTED_WORKFLOW,
    workflowRunSha: env.IMGCONVERT_NOTARY_EXPECTED_WORKFLOW_SHA,
  };
  if (env.IMGCONVERT_NOTARY_ALLOW_RELEASE !== "true") {
    expected.publishRelease = false;
    expected.releaseTag = null;
  }
  return expected;
}

function writeReceipt(receiptPath, receipt) {
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  const temporaryPath = `${receiptPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, receiptPath);
  console.log(`notarization receipt: ${path.relative(repoRoot, receiptPath)}`);
}

function readReceipt(receiptPath) {
  try {
    return JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    throw new Error(`invalid notarization receipt JSON: ${error.message}`);
  }
}

function writeGithubOutputs(receipt, status) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const source = normalizeSource(receipt.source);
  const values = {
    notarization_status: status,
    submission_id: receipt.submissionId,
    publish_release: String(source.publishRelease),
    release_tag: source.releaseTag ?? "",
    source_sha: source.sourceSha,
  };
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "string" || value.length > 500 || /[\r\n]/.test(value)) {
      throw new Error(`invalid GitHub output ${name}`);
    }
    appendFileSync(outputPath, `${name}=${value}\n`);
  }
}

function notaryCredentials(options) {
  if (options.keychainProfile) {
    return ["--keychain-profile", options.keychainProfile];
  }
  if (options.apiKey && options.apiIssuer && options.apiKeyPath) {
    requireFile(options.apiKeyPath, "APPLE_API_KEY_PATH");
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
  throw new Error(
    "notarization requires IMGCONVERT_NOTARYTOOL_PROFILE, or APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH, or APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID",
  );
}

export function parseOptions(argv, env = process.env) {
  const options = {
    profile: "release",
    mode: "wait",
    modeSelected: false,
    help: false,
    dmg: env.IMGCONVERT_MACOS_DMG ?? null,
    receipt: env.IMGCONVERT_NOTARY_RECEIPT ?? null,
    keychainProfile: env.IMGCONVERT_NOTARYTOOL_PROFILE ?? null,
    appleId: env.APPLE_ID ?? null,
    password: env.APPLE_PASSWORD ?? null,
    teamId: env.APPLE_TEAM_ID ?? null,
    apiKey: env.APPLE_API_KEY ?? null,
    apiIssuer: env.APPLE_API_ISSUER ?? null,
    apiKeyPath: env.APPLE_API_KEY_PATH ?? null,
    expectedArchitectures: [],
    timeoutMinutes: positiveInteger(env.IMGCONVERT_NOTARY_TIMEOUT_MINUTES, 60),
    pollSeconds: positiveInteger(env.IMGCONVERT_NOTARY_POLL_SECONDS, 20),
  };

  for (const arg of argv) {
    parseArgument(arg, options);
  }
  if (!options.help && options.mode === "submit" && !options.receipt) {
    throw new Error("--submit-only requires --receipt=<path>");
  }
  delete options.modeSelected;
  return options;
}

function parseArgument(arg, options) {
  if (arg === "--") return;
  if (arg === "--submit-only") return selectMode(options, "submit", arg);
  if (arg === "--finalize") return selectMode(options, "finalize", arg);
  if (arg === "--help" || arg === "-h") {
    options.help = true;
    return;
  }
  const stringOptions = new Map([
    ["--profile=", "profile"],
    ["--dmg=", "dmg"],
    ["--receipt=", "receipt"],
    ["--keychain-profile=", "keychainProfile"],
    ["--apple-id=", "appleId"],
    ["--password=", "password"],
    ["--team-id=", "teamId"],
    ["--api-key=", "apiKey"],
    ["--api-issuer=", "apiIssuer"],
    ["--api-key-path=", "apiKeyPath"],
  ]);
  for (const [prefix, key] of stringOptions) {
    if (arg.startsWith(prefix)) {
      options[key] = arg.slice(prefix.length);
      return;
    }
  }
  if (arg.startsWith("--timeout-minutes=")) {
    options.timeoutMinutes = positiveInteger(
      arg.slice("--timeout-minutes=".length),
      options.timeoutMinutes,
    );
    return;
  }
  if (arg.startsWith("--poll-seconds=")) {
    options.pollSeconds = positiveInteger(arg.slice("--poll-seconds=".length), options.pollSeconds);
    return;
  }
  if (arg.startsWith("--expected-architectures=")) {
    options.expectedArchitectures = parseExpectedArchitectures(
      arg.slice("--expected-architectures=".length),
    );
    return;
  }
  throw new Error(`unknown argument: ${arg}`);
}

function expectedArchitectureArgument(expectedArchitectures) {
  if (!expectedArchitectures?.length) return [];
  return [`--expected-architectures=${expectedArchitectures.join(",")}`];
}

function parseExpectedArchitectures(value) {
  const requested = String(value ?? "")
    .split(",")
    .map((architecture) => architecture.trim())
    .filter(Boolean);
  if (requested.length === 0) {
    throw new Error("--expected-architectures requires at least one architecture");
  }

  const aliases = {
    arm64: "arm64",
    aarch64: "arm64",
    x64: "x86_64",
    x86_64: "x86_64",
  };
  const normalized = requested.map((architecture) => {
    const canonical = aliases[architecture.toLowerCase()];
    if (!canonical) {
      throw new Error(`unsupported macOS architecture: ${architecture}`);
    }
    return canonical;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("--expected-architectures must not contain duplicate architectures");
  }
  return normalized;
}

function selectMode(options, mode, argument) {
  if (options.modeSelected) {
    throw new Error(`notarization modes are mutually exclusive: ${argument}`);
  }
  options.mode = mode;
  options.modeSelected = true;
}

function findLatestDmg(options) {
  const dir = path.join(cargoTargetRoot(), options.profile, "bundle", "dmg");
  const dmgs = collectFiles(dir).filter((file) => file.toLowerCase().endsWith(".dmg"));
  if (dmgs.length === 0) {
    throw new Error(`missing DMG artifact under ${path.relative(repoRoot, dir)}`);
  }
  dmgs.sort((first, second) => statSync(second).mtimeMs - statSync(first).mtimeMs);
  return dmgs[0];
}

function collectFiles(dir) {
  if (!existsSync(dir)) return [];
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
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
  }
}

function runJson(command, args, label, allowFailure = false, timeout = 2 * 60_000) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", timeout });
  if (result.error) {
    const response = { ok: false, error: result.error.message, value: null };
    if (allowFailure) return response;
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const response = { ok: false, error: result.stderr.trim(), value: null };
    if (allowFailure) return response;
    throw new Error(
      `${label} failed with exit code ${result.status ?? 1}${formatCommandError(response)}`,
    );
  }
  try {
    return { ok: true, error: "", value: JSON.parse(result.stdout.replace(/^\uFEFF/, "")) };
  } catch (error) {
    const response = { ok: false, error: `invalid JSON: ${error.message}`, value: null };
    if (allowFailure) return response;
    throw new Error(`${label} returned invalid JSON`);
  }
}

export function normalizeNotarizationStatus(value) {
  const status = String(value ?? "").trim();
  if (!["Accepted", "In Progress", "Invalid", "Rejected"].includes(status)) {
    throw new Error(`unexpected Apple notarization status: ${status || "<missing>"}`);
  }
  return status;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function requireFile(filePath, label) {
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`${label} does not exist or is not a file: ${filePath ?? "<missing>"}`);
  }
}

function safeText(value, label, maximumLength) {
  if (typeof value !== "string" || !value || value.length > maximumLength || /[\r\n]/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function numericText(value, label) {
  const text = safeText(String(value ?? ""), label, 30);
  if (!/^\d+$/.test(text)) throw new Error(`invalid ${label}`);
  return text;
}

function shaText(value, label) {
  const text = safeText(value, label, 64);
  if (!/^[0-9a-f]{40}$/i.test(text)) throw new Error(`invalid ${label}`);
  return text.toLowerCase();
}

function booleanValue(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

function isSubmissionId(value) {
  return typeof value === "string" && SUBMISSION_ID_PATTERN.test(value);
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

Modes:
  default                         Submit, wait, staple, and verify.
  --submit-only                   Submit and save a receipt without waiting.
  --finalize                      Check a saved receipt once; staple if accepted.

Options:
  --profile=<debug|release>       Cargo profile, defaults to release.
  --dmg=<path>                    DMG path. Defaults to the newest DMG artifact.
  --receipt=<path>                Receipt output for submit or input for finalize.
  --expected-architectures=<list> Expected DMG app architecture(s), e.g. arm64 or x86_64.
  --keychain-profile=<name>       notarytool keychain profile.
  --apple-id=<id>                 Apple ID for notarytool.
  --password=<password>           App-specific password for notarytool.
  --team-id=<TEAMID>              Apple team ID for notarytool.
  --api-key=<KEYID>               App Store Connect API key ID.
  --api-issuer=<ISSUERID>         App Store Connect issuer ID.
  --api-key-path=<path>           App Store Connect private key path.
  --timeout-minutes=<minutes>     Maximum synchronous wait, defaults to 60.
  --poll-seconds=<seconds>        Synchronous poll interval, defaults to 20.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
