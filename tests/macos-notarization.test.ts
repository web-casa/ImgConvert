// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error -- The production CLI intentionally remains a plain ESM script.
const notarizationModule = await import("../scripts/notarize-macos-dmg.mjs");
const {
  createNotarizationReceipt,
  normalizeNotarizationStatus,
  parseOptions,
  validateNotarizationReceipt,
} = notarizationModule;

const submissionId = "7ae6f6bf-774b-45b7-8202-3c44b3b818f0";
const source = {
  repository: "web-casa/ImgConvert",
  runId: "32354919301",
  workflow: "macOS Smoke",
  workflowRunSha: "15e04111ed489751baadeb9332085fe175f7efb7",
  sourceSha: "15e04111ed489751baadeb9332085fe175f7efb7",
  releaseTag: null,
  publishRelease: false,
};
const fixtureDirectories: string[] = [];

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("macOS notarization receipt", () => {
  it("round-trips a receipt and verifies its source", () => {
    const dmg = fixtureDmg("signed-dmg");
    const receipt = createNotarizationReceipt({ submissionId, dmgPath: dmg, source });

    expect(
      validateNotarizationReceipt(receipt, dmg, {
        repository: source.repository,
        runId: source.runId,
        workflowRunSha: source.workflowRunSha,
      }),
    ).toEqual(receipt);
  });

  it("rejects a modified DMG", () => {
    const dmg = fixtureDmg("signed-dmg");
    const receipt = createNotarizationReceipt({ submissionId, dmgPath: dmg, source });
    writeFileSync(dmg, "tampered-dmg");

    expect(() => validateNotarizationReceipt(receipt, dmg)).toThrow(/size|SHA-256/);
  });

  it("rejects source-run mismatches", () => {
    const dmg = fixtureDmg("signed-dmg");
    const receipt = createNotarizationReceipt({ submissionId, dmgPath: dmg, source });

    expect(() => validateNotarizationReceipt(receipt, dmg, { runId: "999999" })).toThrow(
      /source runId/,
    );
  });

  it("enforces explicitly absent release metadata", () => {
    const dmg = fixtureDmg("signed-dmg");
    const receipt = createNotarizationReceipt({
      submissionId,
      dmgPath: dmg,
      source: { ...source, releaseTag: "v0.2.0" },
    });

    expect(() => validateNotarizationReceipt(receipt, dmg, { releaseTag: null })).toThrow(
      /source releaseTag/,
    );
  });

  it("requires a receipt for asynchronous submission", () => {
    expect(() => parseOptions(["--submit-only"], {})).toThrow(/requires --receipt/);
    expect(parseOptions(["--submit-only", "--receipt=receipt.json"], {}).mode).toBe("submit");
    expect(parseOptions(["--submit-only", "--help"], {}).help).toBe(true);
  });

  it("keeps asynchronous modes mutually exclusive", () => {
    expect(() =>
      parseOptions(["--submit-only", "--finalize", "--receipt=receipt.json"], {}),
    ).toThrow(/mutually exclusive/);
  });

  it("requires a valid release tag when publication is requested", () => {
    const dmg = fixtureDmg("signed-dmg");

    expect(() =>
      createNotarizationReceipt({
        submissionId,
        dmgPath: dmg,
        source: { ...source, releaseTag: null, publishRelease: true },
      }),
    ).toThrow(/requires a release tag/);
  });

  it("accepts only documented terminal and pending statuses", () => {
    expect(normalizeNotarizationStatus("Accepted")).toBe("Accepted");
    expect(normalizeNotarizationStatus("In Progress")).toBe("In Progress");
    expect(() => normalizeNotarizationStatus("Unknown")).toThrow(/unexpected/);
  });
});

function fixtureDmg(contents: string) {
  const directory = mkdtempSync(path.join(tmpdir(), "imgconvert-notary-"));
  fixtureDirectories.push(directory);
  const dmg = path.join(directory, "ImgConvert.dmg");
  writeFileSync(dmg, contents);
  return dmg;
}
