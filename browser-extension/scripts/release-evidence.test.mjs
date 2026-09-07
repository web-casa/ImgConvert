// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  summarizeAuditPayload,
  validateAuditReport,
  validatePrivacyReport,
  validateWebImportReport,
} from "./release-evidence.mjs";

const fingerprint = "a".repeat(64);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function webImportReport(decision = "allow") {
  const denied = decision === "deny";
  return {
    build: { fingerprint, target: "chrome" },
    executable: { major: 152, product: "chrome" },
    expected: { major: 152, product: "chrome" },
    failure: null,
    modes: { webImport: true, webImportDenied: denied },
    passed: true,
    schemaVersion: 2,
    webImport: {
      blockedDescriptorConsumed: true,
      decision,
      descriptorConsumed: true,
      permissionRetained: false,
      queueAdmitted: !denied,
      requestCount: denied ? 0 : 1,
      requests: denied
        ? []
        : [
            {
              authorizationPresent: false,
              cookiePresent: false,
              method: "GET",
              path: "/web-smoke.png",
              refererPresent: false,
            },
          ],
    },
  };
}

test("accepts complete allow and deny evidence", () => {
  assert.deepEqual(
    validateWebImportReport(webImportReport("allow"), {
      browser: "chrome",
      decision: "allow",
      fingerprint,
    }),
    [],
  );
  assert.deepEqual(
    validateWebImportReport(webImportReport("deny"), {
      browser: "chrome",
      decision: "deny",
      fingerprint,
    }),
    [],
  );
});

test("rejects stale, permissive, or privacy-unsafe vendor evidence", () => {
  const report = webImportReport("allow");
  report.build.fingerprint = "b".repeat(64);
  report.expected.product = "any";
  report.expected.major = 149;
  report.webImport.permissionRetained = true;
  report.webImport.requests[0].cookiePresent = true;
  const failures = validateWebImportReport(report, {
    browser: "chrome",
    decision: "allow",
    fingerprint,
  });
  assert.ok(failures.some((failure) => failure.includes("stale")));
  assert.ok(failures.some((failure) => failure.includes("fail-closed")));
  assert.ok(failures.some((failure) => failure.includes("major")));
  assert.ok(failures.some((failure) => failure.includes("retained")));
  assert.ok(failures.some((failure) => failure.includes("Cookie")));
});

test("normalizes npm audit counts and binds a passing report to the lockfile", () => {
  assert.deepEqual(
    summarizeAuditPayload({
      metadata: {
        vulnerabilities: { critical: 0, high: 0, info: 0, low: 0, moderate: 0, total: 0 },
      },
    }),
    { critical: 0, high: 0, info: 0, low: 0, moderate: 0, total: 0 },
  );
  assert.deepEqual(
    validateAuditReport(
      {
        lockfile: { sha256: fingerprint },
        npm: {
          passed: false,
          registry: "https://registry.npmjs.org/",
          unavailable: true,
        },
        osv: { packageCount: 12, passed: true, vulnerabilities: [] },
        passed: true,
        schemaVersion: 2,
        vulnerabilities: { total: 0 },
      },
      fingerprint,
    ),
    [],
  );
  const malformedSuccess = validateAuditReport(
    {
      lockfile: { sha256: fingerprint },
      npm: {
        passed: true,
        payloadRecognized: false,
        registry: "https://registry.npmjs.org/",
        unavailable: false,
      },
      osv: { packageCount: 12, passed: true, vulnerabilities: [] },
      passed: true,
      schemaVersion: 2,
      vulnerabilities: { total: 0 },
    },
    fingerprint,
  );
  assert.ok(malformedSuccess.some((failure) => failure.includes("recognized")));
});

test("requires canonical production privacy evidence for both locales", () => {
  const deploymentId = "12345678-1234-1234-1234-123456789abc";
  const page = (locale) => ({
    contentVerified: true,
    headers: {
      contentSecurityPolicy: "default-src 'self'; frame-ancestors 'none'",
      referrerPolicy: "strict-origin-when-cross-origin",
      xContentTypeOptions: "nosniff",
    },
    htmlSha256: fingerprint,
    https: true,
    locale,
    securityHeadersVerified: true,
    status: 200,
  });
  assert.deepEqual(
    validatePrivacyReport(
      {
        baseUrl: "https://imgconvert.web.casa",
        deploymentId,
        environment: "production",
        pages: [page("zh-CN"), page("en")],
        passed: true,
        schemaVersion: 2,
      },
      deploymentId,
    ),
    [],
  );
});

test("patched extract-zip rejects a symlink target outside the extraction root", async () => {
  const packageStore = join(repositoryRoot, "node_modules", ".pnpm");
  const packageDirectory = (await readdir(packageStore)).find((entry) =>
    entry.startsWith("extract-zip@2.0.1_patch_hash="),
  );
  assert.ok(packageDirectory, "patched extract-zip package was not installed");
  const packageRoot = join(packageStore, packageDirectory, "node_modules", "extract-zip");
  const require = createRequire(join(packageRoot, "package.json"));
  const extractZip = require("./index.js");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "imgconvert-extract-zip-test-"));
  const archivePath = join(temporaryRoot, "malicious.zip");
  const outputPath = join(temporaryRoot, "output");
  await mkdir(outputPath);
  await writeFile(archivePath, symlinkZip("nested/link", "../../outside.txt"));
  try {
    await assert.rejects(
      extractZip(archivePath, { dir: outputPath }),
      /Out of bound symlink target/u,
    );
    await assert.rejects(lstat(join(outputPath, "nested", "link")), { code: "ENOENT" });
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function symlinkZip(name, target) {
  const nameBytes = Buffer.from(name);
  const targetBytes = Buffer.from(target);
  const checksum = crc32(targetBytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(targetBytes.length, 18);
  local.writeUInt32LE(targetBytes.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(targetBytes.length, 20);
  central.writeUInt32LE(targetBytes.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE((0o120777 << 16) >>> 0, 38);
  const localRecord = Buffer.concat([local, nameBytes, targetBytes]);
  const centralRecord = Buffer.concat([central, nameBytes]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralRecord.length, 12);
  end.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, end]);
}
