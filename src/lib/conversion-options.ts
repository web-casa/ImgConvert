// SPDX-License-Identifier: Apache-2.0

import type { MetadataPolicy, ResizeMode } from "$lib/workflow-presets";

export type ConvertRequest = {
  input: string;
  format: string;
  quality: number;
  qualityFloor: number;
  lossless: boolean;
  jpegProgressive: boolean;
  pngOxipngLevel: number;
  pngLossyQuantize: boolean;
  pngQuantColors: number;
  webpMethod: number;
  avifSpeed: number;
  avifSubsample: string;
  webpNearLossless: number;
  webpSharpYuv: boolean;
  jpegTrellis: boolean;
  autoQuality: boolean;
  autoQualityScore: number;
  generationLossProtection: boolean;
  resultCache: boolean;
  skipIfLarger: boolean;
  multiCandidate: boolean;
  overwrite: boolean;
  overwriteMode: "ask" | "skip" | "overwrite";
  outDir: string | null;
  relativeDir: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  fileNameTemplate: string;
  outputSuffix: string | null;
  allowSourceOverwrite: boolean;
  preserveMetadata: boolean;
  metadataPolicy: MetadataPolicy;
  resize: {
    mode: ResizeMode;
    width: number | null;
    height: number | null;
    value: number | null;
    allowUpscale: boolean;
  };
  targetSizeBytes: number | null;
  colorManagementPolicy: "preserve" | "convertToSrgb";
  pdf: {
    dpi: number;
    pageRange: string | null;
  } | null;
};

interface ConversionSettings {
  quality: number;
  lossless: boolean;
  jpegProgressive: boolean;
  pngOxipngLevel: number;
  pngLossyQuantize: boolean;
  pngQuantColors: number;
  webpMethod: number;
  avifSpeed: number;
  avifSubsample: string;
  webpNearLossless: number;
  webpSharpYuv: boolean;
  jpegTrellis: boolean;
  autoQuality: boolean;
  autoQualityScore: number;
  generationLossProtection: boolean;
  resultCache: boolean;
  skipIfLarger: boolean;
  multiCandidate: boolean;
  overwrite: "ask" | "skip" | "overwrite";
  outDir: string | null;
  fileNameTemplate: string;
  metadataPolicy: MetadataPolicy;
  resizeMode: ResizeMode;
  resizeWidth: number;
  resizeHeight: number;
  resizeValue: number;
  resizeAllowUpscale: boolean;
  targetSizeEnabled: boolean;
  targetSizeKib: number;
  colorManagementPolicy: "preserve" | "convertToSrgb";
  pdfDpi: number;
  pdfPageRange: string;
}

interface ConversionItem {
  path: string;
  relativeDir: string | null;
  metadata: { format: string; width: number; height: number } | null;
}

export interface BuildConvertRequestInput {
  settings: ConversionSettings;
  item: ConversionItem;
  format: string;
  qualityFloor: number;
  losslessSupported: boolean;
  outputSuffix: string | null;
}

/**
 * The only frontend settings/item -> IPC conversion builder. Planning, conversion and preview
 * all call this function so new workflow fields cannot drift between those paths.
 */
export function buildConvertRequest({
  settings,
  item,
  format,
  qualityFloor,
  losslessSupported,
  outputSuffix,
}: BuildConvertRequestInput): ConvertRequest {
  const lossless = settings.lossless && losslessSupported;
  const pdfInput = item.metadata?.format === "pdf" || /\.pdf$/i.test(item.path);
  return {
    input: item.path,
    format,
    quality: settings.quality,
    qualityFloor,
    lossless,
    jpegProgressive: settings.jpegProgressive,
    pngOxipngLevel: settings.pngOxipngLevel,
    pngLossyQuantize: settings.pngLossyQuantize,
    pngQuantColors: settings.pngQuantColors,
    webpMethod: settings.webpMethod,
    avifSpeed: settings.avifSpeed,
    avifSubsample: settings.avifSubsample,
    webpNearLossless: format === "webp" && lossless ? settings.webpNearLossless : 100,
    webpSharpYuv: settings.webpSharpYuv,
    jpegTrellis: settings.jpegTrellis,
    autoQuality: settings.autoQuality,
    autoQualityScore: settings.autoQualityScore,
    generationLossProtection: pdfInput ? false : settings.generationLossProtection,
    resultCache: pdfInput ? false : settings.resultCache,
    skipIfLarger: pdfInput ? false : settings.skipIfLarger,
    multiCandidate: settings.multiCandidate,
    overwrite: settings.overwrite === "overwrite",
    overwriteMode: settings.overwrite,
    outDir: settings.outDir,
    relativeDir: settings.outDir ? item.relativeDir : null,
    sourceWidth: item.metadata?.width ?? null,
    sourceHeight: item.metadata?.height ?? null,
    fileNameTemplate: settings.fileNameTemplate,
    outputSuffix,
    allowSourceOverwrite: false,
    preserveMetadata: settings.metadataPolicy === "preserveAll",
    metadataPolicy: settings.metadataPolicy,
    resize: {
      mode: settings.resizeMode,
      width: ["fit", "width"].includes(settings.resizeMode) ? settings.resizeWidth : null,
      height: ["fit", "height"].includes(settings.resizeMode) ? settings.resizeHeight : null,
      value: ["longestEdge", "percentage"].includes(settings.resizeMode)
        ? settings.resizeValue
        : null,
      allowUpscale: settings.resizeAllowUpscale,
    },
    targetSizeBytes: settings.targetSizeEnabled ? settings.targetSizeKib * 1024 : null,
    colorManagementPolicy: settings.colorManagementPolicy,
    pdf: pdfInput
      ? {
          dpi: settings.pdfDpi,
          pageRange: settings.pdfPageRange.trim() || null,
        }
      : null,
  };
}

/**
 * Stable serialization of the normalized request fields that can change the
 * converted image or its bytes. Output location/naming, overwrite behavior,
 * source dimensions used by filename planning, and result-cache policy are
 * deliberately excluded.
 */
export function conversionContentSignature(request: ConvertRequest): string {
  return JSON.stringify({
    format: request.format,
    quality: request.quality,
    qualityFloor: request.qualityFloor,
    lossless: request.lossless,
    jpegProgressive: request.jpegProgressive,
    jpegTrellis: request.jpegTrellis,
    pngOxipngLevel: request.pngOxipngLevel,
    pngLossyQuantize: request.pngLossyQuantize,
    pngQuantColors: request.pngQuantColors,
    webpMethod: request.webpMethod,
    webpNearLossless: request.webpNearLossless,
    webpSharpYuv: request.webpSharpYuv,
    avifSpeed: request.avifSpeed,
    avifSubsample: request.avifSubsample,
    autoQuality: request.autoQuality,
    autoQualityScore: request.autoQualityScore,
    generationLossProtection: request.generationLossProtection,
    skipIfLarger: request.skipIfLarger,
    multiCandidate: request.multiCandidate,
    preserveMetadata: request.preserveMetadata,
    metadataPolicy: request.metadataPolicy,
    resize: request.resize,
    targetSizeBytes: request.targetSizeBytes,
    colorManagementPolicy: request.colorManagementPolicy,
    pdf: request.pdf,
  });
}
