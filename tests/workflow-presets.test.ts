// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  BUILTIN_WORKFLOW_PRESETS,
  MAX_CUSTOM_PRESETS,
  applyWorkflowSnapshot,
  captureWorkflowSettings,
  createCustomWorkflowPreset,
  matchingWorkflowPresetId,
  normalizeCustomWorkflowPresets,
  normalizeWorkflowSnapshot,
} from "$lib/workflow-presets";

function settings() {
  return {
    ...BUILTIN_WORKFLOW_PRESETS[0].snapshot,
    outDir: "/private/output",
    overwrite: "overwrite",
    heicHelperPath: "/usr/bin/helper",
    customWorkflowPresets: [],
  };
}

describe("workflow presets", () => {
  it("captures only the content allowlist", () => {
    const snapshot = captureWorkflowSettings(settings());
    expect(snapshot).not.toHaveProperty("outDir");
    expect(snapshot).not.toHaveProperty("overwrite");
    expect(snapshot).not.toHaveProperty("heicHelperPath");
  });

  it("applies a preset atomically without changing paths or overwrite authority", () => {
    const current = settings();
    applyWorkflowSnapshot(current, BUILTIN_WORKFLOW_PRESETS[1].snapshot);
    expect(current.format).toBe("jpeg");
    expect(current.targetSizeEnabled).toBe(true);
    expect(current.outDir).toBe("/private/output");
    expect(current.overwrite).toBe("overwrite");
    expect(matchingWorkflowPresetId(current)).toBe("builtin:email");
    current.quality = 81;
    expect(matchingWorkflowPresetId(current)).toBeNull();
  });

  it("normalizes numeric and enum fields", () => {
    const normalized = normalizeWorkflowSnapshot({
      quality: 500,
      format: "tiff",
      resizeMode: "crop",
      resizeWidth: 0,
      targetSizeKib: Number.POSITIVE_INFINITY,
      metadataPolicy: "gpsOnly",
    });
    expect(normalized.quality).toBe(100);
    expect(normalized.format).toBe("avif");
    expect(normalized.resizeMode).toBe("none");
    expect(normalized.resizeWidth).toBe(1);
    expect(normalized.targetSizeKib).toBe(1024);
    expect(normalized.metadataPolicy).toBe("stripAll");
  });

  it("normalizes percentage and target-size conflicts before a custom preset is applied", () => {
    const percentage = normalizeWorkflowSnapshot({
      format: "jpeg",
      resizeMode: "percentage",
      resizeValue: 5_000,
      targetSizeEnabled: true,
      autoQuality: true,
      lossless: true,
    });
    expect(percentage.resizeValue).toBe(400);
    expect(percentage.targetSizeEnabled).toBe(true);
    expect(percentage.autoQuality).toBe(false);
    expect(percentage.lossless).toBe(false);

    expect(
      normalizeWorkflowSnapshot({ format: "png", targetSizeEnabled: true }).targetSizeEnabled,
    ).toBe(false);
  });

  it("bounds and de-duplicates persisted custom presets", () => {
    const candidates = Array.from({ length: MAX_CUSTOM_PRESETS + 5 }, (_, index) => ({
      id: `custom:${index}`,
      name: `Preset ${index}`,
      snapshot: BUILTIN_WORKFLOW_PRESETS[0].snapshot,
    }));
    candidates.splice(1, 0, candidates[0]);
    const normalized = normalizeCustomWorkflowPresets(candidates);
    expect(normalized).toHaveLength(MAX_CUSTOM_PRESETS);
    expect(new Set(normalized.map((preset) => preset.id)).size).toBe(MAX_CUSTOM_PRESETS);
  });

  it("skips malformed entries without dropping later valid presets", () => {
    const normalized = normalizeCustomWorkflowPresets([
      null,
      { id: "custom:valid", name: "Valid", snapshot: BUILTIN_WORKFLOW_PRESETS[0].snapshot },
    ]);
    expect(normalized.map((preset) => preset.id)).toEqual(["custom:valid"]);
  });

  it("rejects empty custom names", () => {
    expect(createCustomWorkflowPreset("custom:1", "   ", settings())).toBeNull();
    expect(createCustomWorkflowPreset("not-custom", "Valid", settings())).toBeNull();
  });
});
