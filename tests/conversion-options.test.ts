// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildConvertRequest, conversionContentSignature } from "$lib/conversion-options";

const settings = {
  quality: 82,
  lossless: false,
  jpegProgressive: true,
  pngOxipngLevel: 4,
  pngLossyQuantize: false,
  pngQuantColors: 256,
  webpMethod: 4,
  avifSpeed: 8,
  avifSubsample: "yuv444",
  webpNearLossless: 100,
  webpSharpYuv: false,
  jpegTrellis: true,
  autoQuality: false,
  autoQualityScore: 80,
  generationLossProtection: false,
  resultCache: true,
  skipIfLarger: false,
  multiCandidate: true,
  overwrite: "skip" as const,
  outDir: "/tmp/out",
  fileNameTemplate: "%name%",
  metadataPolicy: "colorOnly" as const,
  resizeMode: "fit" as const,
  resizeWidth: 1280,
  resizeHeight: 720,
  resizeValue: 2048,
  resizeAllowUpscale: false,
  targetSizeEnabled: true,
  targetSizeKib: 640,
  colorManagementPolicy: "preserve" as const,
  pdfDpi: 150,
  pdfPageRange: "",
};

const item = {
  path: "/tmp/source.png",
  relativeDir: "nested",
  metadata: { format: "png", width: 4000, height: 3000 },
};

describe("conversion request builder", () => {
  it("builds the shared plan, batch, and preview workflow fields", () => {
    expect(
      buildConvertRequest({
        settings,
        item,
        format: "jpeg",
        qualityFloor: 30,
        losslessSupported: false,
        outputSuffix: "_done",
      }),
    ).toMatchObject({
      input: "/tmp/source.png",
      relativeDir: "nested",
      sourceWidth: 4000,
      sourceHeight: 3000,
      metadataPolicy: "colorOnly",
      preserveMetadata: false,
      resize: { mode: "fit", width: 1280, height: 720, value: null },
      targetSizeBytes: 640 * 1024,
      allowSourceOverwrite: false,
    });
  });

  it("normalizes inactive resize fields and carries active WebP near-lossless", () => {
    const request = buildConvertRequest({
      settings: {
        ...settings,
        lossless: true,
        webpNearLossless: 65,
        resizeMode: "none",
        targetSizeEnabled: false,
      },
      item,
      format: "webp",
      qualityFloor: 0,
      losslessSupported: true,
      outputSuffix: null,
    });

    expect(request.lossless).toBe(true);
    expect(request.webpNearLossless).toBe(65);
    expect(request.resize).toMatchObject({ width: null, height: null, value: null });
    expect(request.targetSizeBytes).toBeNull();
    expect(request.outputSuffix).toBeNull();
  });

  it.each([
    ["width", { width: 1440, height: null, value: null }],
    ["height", { width: null, height: 810, value: null }],
  ] as const)("uses the dedicated %s field for single-axis resize", (resizeMode, expected) => {
    const request = buildConvertRequest({
      settings: {
        ...settings,
        resizeMode,
        resizeWidth: 1440,
        resizeHeight: 810,
        resizeValue: 3333,
      },
      item,
      format: "jpeg",
      qualityFloor: 30,
      losslessSupported: false,
      outputSuffix: "_done",
    });

    expect(request.resize).toMatchObject({ mode: resizeMode, ...expected });
  });

  it("excludes output-only planning fields from the content signature", () => {
    const request = buildConvertRequest({
      settings,
      item,
      format: "jpeg",
      qualityFloor: 30,
      losslessSupported: false,
      outputSuffix: "_done",
    });
    const outputOnlyChange = {
      ...request,
      outDir: "/somewhere/else",
      relativeDir: "other",
      fileNameTemplate: "%name%-%width%",
      outputSuffix: "_other",
      overwrite: true,
      overwriteMode: "overwrite" as const,
      allowSourceOverwrite: true,
      resultCache: !request.resultCache,
    };

    expect(conversionContentSignature(outputOnlyChange)).toBe(conversionContentSignature(request));
  });

  it("adds PDF raster settings and disables inapplicable source-size policies", () => {
    const request = buildConvertRequest({
      settings: {
        ...settings,
        pdfDpi: 300,
        pdfPageRange: "1-3, 5",
        generationLossProtection: true,
        skipIfLarger: true,
      },
      item: {
        path: "/tmp/document.pdf",
        relativeDir: null,
        metadata: { format: "pdf", width: 2480, height: 3508 },
      },
      format: "png",
      qualityFloor: 0,
      losslessSupported: true,
      outputSuffix: "_done",
    });

    expect(request.pdf).toEqual({ dpi: 300, pageRange: "1-3, 5" });
    expect(request.generationLossProtection).toBe(false);
    expect(request.skipIfLarger).toBe(false);
    expect(request.resultCache).toBe(false);
  });
});
