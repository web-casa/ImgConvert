// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { sha256File, summarizeAuditPayload } from "./release-evidence.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(projectRoot, "..");
const reportsRoot = join(projectRoot, ".output", "reports");
const reportPath = join(reportsRoot, "production-dependency-audit.json");
const rawPath = join(reportsRoot, "production-dependency-audit.raw.json");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const registry = "https://registry.npmjs.org/";
const timeoutMs = boundedTimeout(process.env.IMGCONVERT_AUDIT_TIMEOUT_MS);
const osvEndpoint = "https://api.osv.dev/v1/querybatch";

await mkdir(reportsRoot, { recursive: true });
const startedAt = new Date().toISOString();
const command = ["audit", "--prod", "--json", `--registry=${registry}`];
const result = await runAudit(pnpm, command, timeoutMs);
let payload;
let parseFailure;
try {
  payload = JSON.parse(result.stdout);
} catch (error) {
  parseFailure = error instanceof Error ? error.message : String(error);
}
if (payload) await writeFile(rawPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
else await rm(rawPath, { force: true });

const npmVulnerabilities = payload ? summarizeAuditPayload(payload) : undefined;
const npmPayloadRecognized = isRecognizedAuditPayload(payload);
const npmPassed =
  result.exitCode === 0 &&
  result.timedOut === false &&
  parseFailure === undefined &&
  npmPayloadRecognized &&
  npmVulnerabilities?.total === 0;
const npmUnavailable =
  result.timedOut &&
  result.signal === "SIGTERM" &&
  result.stdout.length === 0 &&
  payload === undefined;

let productionPackages = [];
let osvVulnerabilities = [];
let osvFailure;
try {
  productionPackages = await productionDependencyInventory();
  const response = await fetch(osvEndpoint, {
    body: JSON.stringify({
      queries: productionPackages.map(({ name, version }) => ({
        package: { ecosystem: "npm", name },
        version,
      })),
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OSV querybatch returned HTTP ${response.status}`);
  const osvPayload = await response.json();
  if (
    !Array.isArray(osvPayload.results) ||
    osvPayload.results.length !== productionPackages.length
  ) {
    throw new Error("OSV querybatch returned an incomplete result set");
  }
  osvVulnerabilities = osvPayload.results.flatMap((entry, index) =>
    (entry.vulns ?? []).map((vulnerability) => ({
      id: vulnerability.id,
      package: productionPackages[index].name,
      version: productionPackages[index].version,
    })),
  );
} catch (error) {
  osvFailure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
const osvPassed =
  osvFailure === undefined && productionPackages.length > 0 && osvVulnerabilities.length === 0;
const vulnerabilities = npmPassed
  ? npmVulnerabilities
  : {
      critical: 0,
      high: 0,
      info: 0,
      low: 0,
      moderate: 0,
      total: osvVulnerabilities.length,
    };
const passed = osvPassed && (npmPassed || npmUnavailable) && vulnerabilities.total === 0;
const report = {
  finishedAt: new Date().toISOString(),
  lockfile: {
    path: "pnpm-lock.yaml",
    sha256: await sha256File(join(repositoryRoot, "pnpm-lock.yaml")),
  },
  npm: {
    command: `pnpm ${command.join(" ")}`,
    exitCode: result.exitCode,
    payloadRecognized: npmPayloadRecognized,
    parseFailure,
    passed: npmPassed,
    registry,
    signal: result.signal,
    stderrSha256: hashText(result.stderr),
    stdoutSha256: hashText(result.stdout),
    timedOut: result.timedOut,
    timeoutMs,
    unavailable: npmUnavailable,
    vulnerabilities: npmVulnerabilities,
  },
  osv: {
    endpoint: osvEndpoint,
    failure: osvFailure,
    packageCount: productionPackages.length,
    packages: productionPackages,
    passed: osvPassed,
    vulnerabilities: osvVulnerabilities,
  },
  passed,
  schemaVersion: 2,
  startedAt,
  vulnerabilities,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!passed) {
  const reason = osvFailure
    ? osvFailure
    : osvVulnerabilities.length > 0
      ? `OSV reported ${osvVulnerabilities.length} production vulnerabilities`
      : `npm audit failed without a verified endpoint outage (exit ${result.exitCode})`;
  throw new Error(`Production dependency audit did not pass: ${reason}. Report: ${reportPath}`);
}

console.log(
  `Production dependency audit passed for ${productionPackages.length} packages with zero advisories${npmUnavailable ? "; canonical npm audit endpoint was unavailable, so OSV provided the fail-closed result" : ""} (report: ${reportPath})`,
);

function boundedTimeout(value) {
  if (value === undefined) return 120_000;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 10_000 || parsed > 300_000) {
    throw new Error("IMGCONVERT_AUDIT_TIMEOUT_MS must be between 10000 and 300000");
  }
  return parsed;
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecognizedAuditPayload(payload) {
  const vulnerabilities = payload?.metadata?.vulnerabilities;
  return (
    vulnerabilities != null &&
    typeof vulnerabilities === "object" &&
    ["critical", "high", "moderate", "low", "info"].every((severity) =>
      Number.isSafeInteger(vulnerabilities[severity]),
    )
  );
}

async function runAudit(commandName, arguments_, timeout) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(commandName, arguments_, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        npm_config_fetch_retries: "1",
        npm_config_fetch_retry_maxtimeout: "20000",
        npm_config_fetch_retry_mintimeout: "1000",
        npm_config_fetch_timeout: "30000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", rejectPromise);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode,
        signal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
        timedOut,
      });
    });
  });
}

async function productionDependencyInventory() {
  const result = await runCommand(
    pnpm,
    [
      "--filter",
      "@imgconvert/browser-extension",
      "list",
      "--prod",
      "--depth",
      "Infinity",
      "--json",
    ],
    30_000,
  );
  if (result.exitCode !== 0) throw new Error(`pnpm production inventory exited ${result.exitCode}`);
  const roots = JSON.parse(result.stdout);
  const packages = new Map();
  for (const root of roots) collectDependencies(root.dependencies, packages);
  return [...packages.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name, "en") || left.version.localeCompare(right.version, "en"),
  );
}

function collectDependencies(dependencies, packages) {
  for (const [name, dependency] of Object.entries(dependencies ?? {})) {
    if (
      typeof dependency.version === "string" &&
      /^\d+\.\d+\.\d+(?:-|$)/u.test(dependency.version)
    ) {
      packages.set(`${name}\0${dependency.version}`, { name, version: dependency.version });
    }
    collectDependencies(dependency.dependencies, packages);
  }
}

async function runCommand(commandName, arguments_, timeout) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(commandName, arguments_, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", rejectPromise);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode,
        signal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}
