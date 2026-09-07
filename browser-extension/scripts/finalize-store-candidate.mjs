// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  sha256File,
  validateAuditReport,
  validatePrivacyReport,
  validateWebImportReport,
  WEB_IMPORT_CASES,
} from "./release-evidence.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(projectRoot, "..");
const reportsRoot = join(projectRoot, ".output", "reports");
const extensionPackage = await readJson(join(projectRoot, "package.json"));
const candidateRoot = join(
  projectRoot,
  ".output",
  "store-candidate",
  `v${extensionPackage.version}`,
);
const finalEvidencePath = join(candidateRoot, "final-evidence.json");
const checkOnly = process.argv.includes("--check");
const deploymentId = argumentValue("--deployment-id");
const execFileAsync = promisify(execFile);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (!deploymentId || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(deploymentId)) {
  throw new Error("Pass the full production Cloudflare deployment ID as --deployment-id=<uuid>");
}
if (!checkOnly) await rm(finalEvidencePath, { force: true });

const preflight = await execFileAsync(pnpm, ["run", "store:check"], {
  cwd: projectRoot,
  maxBuffer: 16 * 1024 * 1024,
});
if (preflight.stdout) process.stdout.write(preflight.stdout);
if (preflight.stderr) process.stderr.write(preflight.stderr);

const releaseEvidencePath = join(candidateRoot, "release-evidence.json");
const releaseEvidence = await readJson(releaseEvidencePath);
const lockfilePath = join(repositoryRoot, "pnpm-lock.yaml");
const lockfileSha256 = await sha256File(lockfilePath);
const failures = [];
const reportEvidence = [];

for (const testCase of WEB_IMPORT_CASES) {
  const path = join(reportsRoot, `${testCase.browser}-web-import-${testCase.decision}.json`);
  const report = await readJson(path);
  const bundleReport = await readJson(join(reportsRoot, `${testCase.browser}-bundle.json`));
  const fingerprint = bundleFingerprint(bundleReport);
  failures.push(...validateWebImportReport(report, { ...testCase, fingerprint }));
  reportEvidence.push({
    browser: testCase.browser,
    decision: testCase.decision,
    executable: report.executable,
    generatedAt: report.generatedAt,
    path: repositoryRelative(path),
    sha256: await sha256File(path),
  });
}

const auditPath = join(reportsRoot, "production-dependency-audit.json");
const auditReport = await readJson(auditPath);
failures.push(...validateAuditReport(auditReport, lockfileSha256));

const privacyPath = join(reportsRoot, "privacy-production.json");
const privacyReport = await readJson(privacyPath);
failures.push(...validatePrivacyReport(privacyReport, deploymentId));

if (releaseEvidence.schemaVersion !== 1 || releaseEvidence.state !== "local-draft-only") {
  failures.push("local candidate release evidence has an unsupported state");
}
for (const candidatePackage of releaseEvidence.packages ?? []) {
  const packagePath = join(candidateRoot, candidatePackage.path);
  if ((await sha256File(packagePath)) !== candidatePackage.sha256) {
    failures.push(`candidate package hash changed: ${candidatePackage.path}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Store candidate finalization failed:\n- ${failures.join("\n- ")}`);
}

const expectedEvidence = {
  audit: {
    generatedAt: auditReport.finishedAt,
    lockfileSha256,
    path: repositoryRelative(auditPath),
    sha256: await sha256File(auditPath),
    vulnerabilities: auditReport.vulnerabilities,
  },
  candidate: {
    path: repositoryRelative(releaseEvidencePath),
    sha256: await sha256File(releaseEvidencePath),
  },
  frozenAt: checkOnly ? undefined : new Date().toISOString(),
  packages: releaseEvidence.packages,
  privacy: {
    baseUrl: privacyReport.baseUrl,
    deploymentId,
    generatedAt: privacyReport.generatedAt,
    path: repositoryRelative(privacyPath),
    sha256: await sha256File(privacyPath),
  },
  remainingGates: [
    "Account owner must confirm the publisher identity and monitored contact email in both stores.",
    "Creating a listing, uploading, submitting, or publishing requires separate explicit authorization.",
  ],
  schemaVersion: 1,
  state: "frozen-awaiting-account-owner",
  vendorWebImport: reportEvidence,
  version: extensionPackage.version,
};

if (checkOnly) {
  const recorded = await readJson(finalEvidencePath);
  expectedEvidence.frozenAt = recorded.frozenAt;
  if (JSON.stringify(recorded) !== JSON.stringify(expectedEvidence)) {
    throw new Error("Final store evidence is stale; rerun finalization after all gates pass");
  }
  console.log(`Final candidate evidence remains valid: ${repositoryRelative(finalEvidencePath)}`);
} else {
  await mkdir(candidateRoot, { recursive: true });
  await writeFile(finalEvidencePath, `${JSON.stringify(expectedEvidence, null, 2)}\n`, "utf8");
  console.log(
    `Frozen v${extensionPackage.version} candidate with privacy, audit, and vendor evidence. No upload was performed.`,
  );
}

function argumentValue(name) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

function bundleFingerprint(report) {
  if (!report?.passed || !Array.isArray(report.files)) {
    throw new Error(`${report?.browser ?? "unknown"} bundle report is missing or failed`);
  }
  const digestInput = report.files.map((file) => `${file.path}\0${file.sha256}\n`).join("");
  return sha256Text(digestInput);
}

function repositoryRelative(path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}
