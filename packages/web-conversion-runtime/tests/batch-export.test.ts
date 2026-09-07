// SPDX-License-Identifier: Apache-2.0
import { WEB_V1_DESKTOP_LIMITS, type ConversionSettings } from "@imgconvert/conversion-contract";
import { describe, expect, it } from "vitest";

import {
  BATCH_FAILURE_MANIFEST_NAME,
  createBatchExportPlan,
  reserveUniqueBatchFileName,
  sanitizeBatchFileName,
  serializeFailureManifest,
} from "../src/batch-export";
import type { QueueConversionResult, QueueEntry } from "../src/queue";

const settings: ConversionSettings = {
  background: { blue: 255, green: 255, red: 255 },
  lossless: true,
  metadata: "stripAll",
  output: "png",
  quality: null,
  resize: null,
};

function result(name: string, content = name): QueueConversionResult {
  const blob = new Blob([content], { type: "image/png" });
  return {
    blob,
    downloaded: false,
    durationMs: 1,
    format: "png",
    height: 1,
    name,
    previewUrl: "blob:test",
    settings,
    size: blob.size,
    width: 1,
  };
}

function entry(name: string, output?: QueueConversionResult): QueueEntry {
  return {
    file: {} as File,
    id: name,
    name,
    previewUrl: "blob:input",
    ...(output ? { result: output } : {}),
    size: 1,
    state: output ? "done" : "failed",
  };
}

describe("shared batch export planning", () => {
  it("sanitizes portable names and resolves case-insensitive collisions", () => {
    expect(sanitizeBatchFileName("../../CON.png")).toBe("_CON.png");
    const used = new Set<string>();
    expect(reserveUniqueBatchFileName("Photo.png", used)).toBe("Photo.png");
    expect(reserveUniqueBatchFileName("photo.png", used)).toBe("photo (2).png");
  });

  it("adds a bounded, de-spoofed partial-failure manifest", async () => {
    const first = entry("folder/first.png", result("same.png", "first"));
    const second = entry("second.png", result("SAME.png", "second"));
    const rejected = entry("photo\u202egnp.exe");
    rejected.failure = { code: "unsafe-svg", params: {} };
    const plan = createBatchExportPlan([first, second, rejected]);

    expect(plan.artifacts.map(({ name }) => name)).toEqual([
      "same.png",
      "SAME (2).png",
      BATCH_FAILURE_MANIFEST_NAME,
    ]);
    const manifest = plan.artifacts.at(-1);
    expect(await manifest?.blob.text()).not.toContain("\u202e");
    expect(JSON.parse((await manifest?.blob.text()) ?? "{}")).toMatchObject({
      failedCount: 1,
      schemaVersion: 1,
      status: "partial",
    });
    expect(new TextEncoder().encode(serializeFailureManifest([])).byteLength).toBeLessThan(
      16 * 1024 * 1024,
    );
  });

  it("blocks a fallback archive before its estimate crosses the shared limit", () => {
    const output = result("large.png");
    Object.defineProperty(output.blob, "size", {
      configurable: true,
      value: WEB_V1_DESKTOP_LIMITS.maxFallbackArchiveBytes,
    });
    expect(createBatchExportPlan([entry("large.png", output)]).archiveAllowed).toBe(false);
  });
});
