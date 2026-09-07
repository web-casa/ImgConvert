// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const WEB_IMPORT_CASES = Object.freeze([
  Object.freeze({ browser: "chrome", decision: "allow" }),
  Object.freeze({ browser: "chrome", decision: "deny" }),
  Object.freeze({ browser: "edge", decision: "allow" }),
  Object.freeze({ browser: "edge", decision: "deny" }),
]);

export function summarizeAuditPayload(payload) {
  const metadataCounts = payload?.metadata?.vulnerabilities;
  const severities = ["critical", "high", "moderate", "low", "info"];
  const counts = Object.fromEntries(
    severities.map((severity) => [
      severity,
      Number.isSafeInteger(metadataCounts?.[severity]) ? metadataCounts[severity] : 0,
    ]),
  );
  const advisories = payload?.advisories;
  if (!metadataCounts && advisories && typeof advisories === "object") {
    for (const advisory of Object.values(advisories)) {
      if (advisory && severities.includes(advisory.severity)) counts[advisory.severity] += 1;
    }
  }
  const calculatedTotal = severities.reduce((total, severity) => total + counts[severity], 0);
  const total = Number.isSafeInteger(metadataCounts?.total)
    ? metadataCounts.total
    : calculatedTotal;
  return Object.freeze({ ...counts, total });
}

export function validateAuditReport(report, expectedLockfileSha256) {
  const failures = [];
  check(report?.schemaVersion === 2, "dependency audit schema is unsupported", failures);
  check(report?.passed === true, "production dependency audit did not pass", failures);
  check(
    report?.npm?.registry === "https://registry.npmjs.org/",
    "dependency audit did not use the canonical npm registry",
    failures,
  );
  check(
    report?.lockfile?.sha256 === expectedLockfileSha256,
    "dependency audit is not bound to the current pnpm lockfile",
    failures,
  );
  check(report?.vulnerabilities?.total === 0, "dependency audit reports vulnerabilities", failures);
  check(report?.osv?.passed === true, "OSV production dependency audit did not pass", failures);
  check(
    Number.isSafeInteger(report?.osv?.packageCount) && report.osv.packageCount > 0,
    "OSV production dependency inventory is empty",
    failures,
  );
  check(
    report?.osv?.vulnerabilities?.length === 0,
    "OSV reports production vulnerabilities",
    failures,
  );
  check(
    report?.npm?.passed === true || report?.npm?.unavailable === true,
    "npm audit neither passed nor recorded an unavailable endpoint",
    failures,
  );
  check(
    !(report?.npm?.passed === true && report?.npm?.unavailable === true),
    "npm audit cannot be both passed and unavailable",
    failures,
  );
  check(
    report?.npm?.passed !== true || report?.npm?.payloadRecognized === true,
    "npm audit success did not contain a recognized vulnerability summary",
    failures,
  );
  return failures;
}

export function validatePrivacyReport(report, expectedDeploymentId) {
  const failures = [];
  check(report?.schemaVersion === 2, "privacy deployment schema is unsupported", failures);
  check(report?.passed === true, "privacy deployment verification did not pass", failures);
  check(report?.environment === "production", "privacy verification is not production", failures);
  check(
    report?.baseUrl === "https://imgconvert.web.casa",
    "privacy verification did not use the canonical production origin",
    failures,
  );
  check(
    report?.deploymentId === expectedDeploymentId,
    "privacy verification is not bound to the expected Cloudflare deployment",
    failures,
  );
  check(
    Array.isArray(report?.pages) && report.pages.length === 2,
    "privacy report must cover two locales",
    failures,
  );
  for (const locale of ["zh-CN", "en"]) {
    const page = report?.pages?.find((entry) => entry.locale === locale);
    check(page?.status === 200, `${locale} privacy URL did not return 200`, failures);
    check(page?.https === true, `${locale} privacy URL was not HTTPS`, failures);
    check(page?.contentVerified === true, `${locale} privacy content was not verified`, failures);
    check(
      page?.securityHeadersVerified === true,
      `${locale} privacy security headers were not verified`,
      failures,
    );
    check(
      page?.headers?.contentSecurityPolicy?.includes("default-src 'self'") &&
        page.headers.contentSecurityPolicy.includes("frame-ancestors 'none'"),
      `${locale} privacy CSP evidence is missing`,
      failures,
    );
    check(
      page?.headers?.xContentTypeOptions === "nosniff" &&
        page?.headers?.referrerPolicy === "strict-origin-when-cross-origin",
      `${locale} privacy response-header evidence is missing`,
      failures,
    );
    check(
      typeof page?.htmlSha256 === "string" && page.htmlSha256.length === 64,
      `${locale} privacy HTML hash is missing`,
      failures,
    );
  }
  return failures;
}

export function validateWebImportReport(report, expected) {
  const failures = [];
  const expectedDenied = expected.decision === "deny";
  check(
    report?.schemaVersion === 2,
    `${expected.browser} ${expected.decision} report schema is unsupported`,
    failures,
  );
  check(
    report?.passed === true,
    `${expected.browser} ${expected.decision} smoke did not pass`,
    failures,
  );
  check(
    report?.failure == null,
    `${expected.browser} ${expected.decision} smoke recorded a failure`,
    failures,
  );
  check(
    report?.build?.target === expected.browser,
    `${expected.browser} report target is incorrect`,
    failures,
  );
  check(
    report?.build?.fingerprint === expected.fingerprint,
    `${expected.browser} ${expected.decision} report is stale for the current build`,
    failures,
  );
  check(
    report?.executable?.product === expected.browser,
    `${expected.browser} executable identity is not vendor-native`,
    failures,
  );
  check(
    Number.isSafeInteger(report?.executable?.major) && report.executable.major >= 116,
    `${expected.browser} executable is below the declared compatibility floor`,
    failures,
  );
  check(
    report?.expected?.product === expected.browser,
    `${expected.browser} expected product is not fail-closed`,
    failures,
  );
  check(
    report?.expected?.major === report?.executable?.major,
    `${expected.browser} expected major does not match the tested executable`,
    failures,
  );
  check(
    report?.modes?.webImport === true,
    `${expected.browser} report did not run web import`,
    failures,
  );
  check(
    report?.modes?.webImportDenied === expectedDenied,
    `${expected.browser} ${expected.decision} report used the wrong decision mode`,
    failures,
  );
  check(
    report?.webImport?.decision === expected.decision,
    `${expected.browser} decision evidence is missing`,
    failures,
  );
  check(
    report?.webImport?.descriptorConsumed === true,
    `${expected.browser} descriptor was not consumed`,
    failures,
  );
  check(
    report?.webImport?.blockedDescriptorConsumed === true,
    `${expected.browser} blocked descriptor was not consumed`,
    failures,
  );
  check(
    report?.webImport?.permissionRetained === false,
    `${expected.browser} permission was retained`,
    failures,
  );
  check(
    report?.webImport?.queueAdmitted === !expectedDenied,
    `${expected.browser} ${expected.decision} queue result is incorrect`,
    failures,
  );
  const expectedRequestCount = expectedDenied ? 0 : 1;
  check(
    report?.webImport?.requestCount === expectedRequestCount,
    `${expected.browser} ${expected.decision} request count is incorrect`,
    failures,
  );
  check(
    Array.isArray(report?.webImport?.requests) &&
      report.webImport.requests.length === expectedRequestCount,
    `${expected.browser} ${expected.decision} request evidence is incomplete`,
    failures,
  );
  for (const request of report?.webImport?.requests ?? []) {
    check(request.method === "GET", `${expected.browser} import request was not GET`, failures);
    check(
      request.path === "/web-smoke.png",
      `${expected.browser} import request path changed`,
      failures,
    );
    check(
      request.authorizationPresent === false,
      `${expected.browser} import sent Authorization`,
      failures,
    );
    check(request.cookiePresent === false, `${expected.browser} import sent Cookie`, failures);
    check(request.refererPresent === false, `${expected.browser} import sent Referer`, failures);
  }
  return failures;
}

export async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function check(condition, message, failures) {
  if (!condition) failures.push(message);
}
