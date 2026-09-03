import { describe, expect, it } from "vitest";

import {
  CapabilityRegistry,
  WEB_001B_RASTER_CAPABILITIES,
  WEB_006_SVG_CAPABILITIES,
  WEB_007_PDF_CAPABILITIES,
  WEB_V1_DESKTOP_LIMITS,
  assertConversionRequest,
  assertJobTransition,
  canTransitionJob,
  createBackendCapabilities,
  createConversionFailure,
  createResourceLimits,
  isConversionFailure,
  isImageInputFormat,
  isRasterOutputFormat,
  parsePdfPageRange,
} from "../src/index.js";

describe("format guards", () => {
  it("distinguishes inputs from writable raster formats", () => {
    expect(isImageInputFormat("pdf")).toBe(true);
    expect(isRasterOutputFormat("pdf")).toBe(false);
    expect(isRasterOutputFormat("avif")).toBe(true);
    expect(isImageInputFormat("heic")).toBe(false);
  });
});

describe("capability registry", () => {
  it("reports only the formats demonstrated by WEB-001B", () => {
    const registry = new CapabilityRegistry([WEB_001B_RASTER_CAPABILITIES]);

    expect(registry.supports("png", "avif")).toBe(true);
    expect(registry.supports("bmp", "png")).toBe(true);
    expect(registry.supports("pdf", "png")).toBe(false);
    expect(registry.find("webp", "jpeg")[0]?.capability.animation).toBe("reject");
    expect(registry.find("gif", "webp")[0]?.capability.animation).toBe("firstFrame");
    expect(registry.find("png", "webp")[0]?.capability.metadataPolicies).toEqual(["stripAll"]);
  });

  it("registers WEB-006 SVG as a separate rasterization backend", () => {
    const registry = new CapabilityRegistry([
      WEB_001B_RASTER_CAPABILITIES,
      WEB_006_SVG_CAPABILITIES,
    ]);

    expect(registry.supports("svg", "png")).toBe(true);
    expect(registry.find("svg", "avif")[0]?.backendId).toBe("safe-svg-resvg");
    expect(registry.find("svg", "webp")[0]?.capability.metadataPolicies).toEqual(["stripAll"]);
  });

  it("registers WEB-007 PDF as a separate multi-page rasterization backend", () => {
    const registry = new CapabilityRegistry([WEB_007_PDF_CAPABILITIES]);

    expect(registry.supports("pdf", "png")).toBe(true);
    expect(registry.find("pdf", "avif")[0]?.backendId).toBe("bounded-pdfjs");
  });

  it("copies and freezes mutable registration input", () => {
    const mutableOutputs = ["png"] as const;
    const backend = createBackendCapabilities({
      backendId: "test-backend",
      inputs: [
        {
          alpha: "none",
          animation: "reject",
          input: "jpeg",
          metadataPolicies: ["stripAll"],
          outputs: mutableOutputs,
        },
      ],
      limits: WEB_V1_DESKTOP_LIMITS,
      schemaVersion: 1,
    });

    expect(Object.isFrozen(backend)).toBe(true);
    expect(Object.isFrozen(backend.inputs)).toBe(true);
    expect(Object.isFrozen(backend.inputs[0]?.outputs)).toBe(true);
  });

  it("rejects duplicate backend ids and invalid runtime limits", () => {
    const registry = new CapabilityRegistry([WEB_001B_RASTER_CAPABILITIES]);
    expect(() => registry.register(WEB_001B_RASTER_CAPABILITIES)).toThrow(/already registered/u);
    expect(() =>
      createBackendCapabilities({
        ...WEB_001B_RASTER_CAPABILITIES,
        backendId: "invalid-limits",
        limits: { ...WEB_V1_DESKTOP_LIMITS, maxRuntimePixels: 65_000_000 },
      }),
    ).toThrow(/cannot exceed/u);
  });

  it("validates policy fields at the runtime registration boundary", () => {
    expect(() =>
      createBackendCapabilities({
        ...WEB_001B_RASTER_CAPABILITIES,
        backendId: "invalid-policy",
        inputs: [
          {
            ...WEB_001B_RASTER_CAPABILITIES.inputs[0]!,
            animation: "loop" as never,
          },
        ],
      }),
    ).toThrow(/animation policy/u);
  });
});

describe("safe failures", () => {
  it("accepts scalar localization parameters", () => {
    const failure = createConversionFailure("input-too-large", true, {
      limitBytes: 32 * 1024 * 1024,
      name: "photo.png",
    });

    expect(isConversionFailure(failure)).toBe(true);
    expect(Object.isFrozen(failure.params)).toBe(true);
  });

  it("rejects objects and unsafe parameter keys from worker messages", () => {
    expect(
      isConversionFailure({
        code: "decode-failed",
        params: { detail: { html: "<strong>unsafe</strong>" } },
        recoverable: true,
      }),
    ).toBe(false);
    expect(() => createConversionFailure("decode-failed", true, { "bad-key": "value" })).toThrow(
      /parameter name/u,
    );
    expect(() => createConversionFailure("decode-failed", true, { elapsedMs: Number.NaN })).toThrow(
      /finite/u,
    );
  });
});

describe("resource limits", () => {
  it("copies, freezes, and validates limits through one shared boundary", () => {
    const mutable = { ...WEB_V1_DESKTOP_LIMITS };
    const limits = createResourceLimits(mutable);
    mutable.maxRasterBytes = 1;

    expect(limits.maxRasterBytes).toBe(WEB_V1_DESKTOP_LIMITS.maxRasterBytes);
    expect(limits.maxFallbackArchiveBytes).toBe(256 * 1024 * 1024);
    expect(Object.isFrozen(limits)).toBe(true);
    expect(() =>
      createResourceLimits({ ...WEB_V1_DESKTOP_LIMITS, maxRuntimePixels: 65_000_000 }),
    ).toThrow(/cannot exceed/u);
  });
});

describe("PDF page range", () => {
  it("expands ordered ranges, removes duplicates, and enforces document bounds", () => {
    expect(parsePdfPageRange("1-3, 2, 5", 5)).toEqual([1, 2, 3, 5]);
    expect(parsePdfPageRange("1-3,1-3", 5)).toEqual([1, 2, 3]);
    expect(() => parsePdfPageRange("0,1", 5)).toThrow(/bounds/u);
    expect(() => parsePdfPageRange("1-6", 5)).toThrow(/bounds/u);
    expect(() => parsePdfPageRange("3-1", 5)).toThrow(/bounds/u);
    expect(() => parsePdfPageRange("1,,2", 5)).toThrow(/syntax/u);
  });

  it("rejects huge ranges before expanding them", () => {
    expect(() => parsePdfPageRange("1-500")).toThrow(/too many/u);
    expect(() => parsePdfPageRange("1".repeat(4_097))).toThrow(/short/u);
  });
});

describe("job transitions", () => {
  it("allows the serial conversion lifecycle and explicit retry", () => {
    expect(canTransitionJob("queued", "probing")).toBe(true);
    expect(canTransitionJob("probing", "ready")).toBe(true);
    expect(canTransitionJob("ready", "converting")).toBe(true);
    expect(canTransitionJob("converting", "done")).toBe(true);
    expect(canTransitionJob("failed", "queued")).toBe(true);
  });

  it("rejects impossible terminal-state transitions", () => {
    expect(canTransitionJob("done", "converting")).toBe(false);
    expect(() => assertJobTransition("cancelled", "queued")).toThrow(/cancelled -> queued/u);
  });
});

describe("conversion request boundary", () => {
  function validRequest() {
    const bytes = new ArrayBuffer(16);
    return {
      input: {
        bytes,
        name: "photo.png",
        probe: {
          alpha: "present",
          animation: "static",
          byteLength: bytes.byteLength,
          colorProfile: "srgb",
          format: "png",
          height: 1,
          metadata: {
            exif: "absent",
            iptc: "absent",
            orientation: null,
            xmp: "absent",
          },
          width: 1,
        },
      },
      jobId: "job_01",
      schemaVersion: 1,
      settings: {
        background: { blue: 255, green: 255, red: 255 },
        lossless: false,
        metadata: "stripAll",
        output: "avif",
        quality: 82,
        resize: null,
      },
    };
  }

  it("accepts a fully validated data-only request", () => {
    const request: unknown = validRequest();
    expect(() => assertConversionRequest(request)).not.toThrow();
  });

  it("rejects detached facts, invalid format settings, and pixel bombs", () => {
    const mismatchedLength = validRequest();
    mismatchedLength.input.probe.byteLength += 1;
    expect(() => assertConversionRequest(mismatchedLength)).toThrow(/does not match/u);

    const invalidPngSettings = validRequest();
    invalidPngSettings.settings.output = "png";
    expect(() => assertConversionRequest(invalidPngSettings)).toThrow(/PNG settings/u);

    const oversized = validRequest();
    oversized.input.probe.width = 8000;
    oversized.input.probe.height = 6000;
    expect(() => assertConversionRequest(oversized)).toThrow(/runtime pixel budget/u);
  });
});
