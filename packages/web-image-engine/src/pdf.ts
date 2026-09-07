import {
  WEB_V1_DESKTOP_LIMITS,
  assertPdfConversionRequest,
  createConversionFailure,
  type ConversionRequest,
  type PdfConversionOutcome,
  type PdfConversionRequest,
  type PdfPageConversionOutcome,
  type PdfProbeResult,
  type PdfVersion,
  type ResourceLimits,
} from "@imgconvert/conversion-contract";

import { probeRasterHeader } from "./probe/index.js";
import { HeaderProbeError, ascii } from "./probe/shared.js";
import {
  MAX_RASTER_OUTPUT_BYTES,
  convertRasterRequest,
  type RasterCodecAdapter,
} from "./raster.js";
import type { ConversionProgressPhase } from "./worker-protocol.js";

const PDF_HEADER_LENGTH = 8;

export type PdfAdapterFailureCode =
  "decode-failed" | "encrypted-pdf" | "pixel-budget-exceeded" | "unsafe-pdf";

export class PdfAdapterError extends Error {
  readonly code: PdfAdapterFailureCode;

  constructor(code: PdfAdapterFailureCode, message: string) {
    super(message);
    this.name = "PdfAdapterError";
    this.code = code;
  }
}

export interface RenderedPdfPage {
  readonly height: number;
  readonly pngBytes: ArrayBuffer;
  readonly width: number;
}

export interface LoadedPdfDocument {
  readonly pageCount: number;
  readonly containsJavaScript: boolean;
  destroy(): Promise<void>;
  renderPage(pageNumber: number, dpi: number, limits: ResourceLimits): Promise<RenderedPdfPage>;
}

export interface PdfDocumentAdapter {
  load(bytes: Uint8Array, limits: ResourceLimits): Promise<LoadedPdfDocument>;
}

export interface PdfConversionProgress {
  readonly pageIndex: number;
  readonly pageNumber: number;
  readonly pageTotal: number;
  readonly phase: ConversionProgressPhase;
  readonly progress: number;
}

export type PdfProgressReporter = (progress: PdfConversionProgress) => void;

function failure(code: Parameters<typeof createConversionFailure>[0]): PdfConversionOutcome {
  return Object.freeze({ failure: createConversionFailure(code, true), ok: false });
}

function pageFailure(
  pageNumber: number,
  code: Parameters<typeof createConversionFailure>[0],
): PdfPageConversionOutcome {
  return Object.freeze({
    failure: createConversionFailure(code, true, { pageNumber }),
    ok: false,
    pageNumber,
  });
}

function report(
  reporter: PdfProgressReporter | undefined,
  phase: ConversionProgressPhase,
  pageIndex: number,
  pageNumber: number,
  pageTotal: number,
  withinPageProgress: number,
): void {
  reporter?.(
    Object.freeze({
      pageIndex,
      pageNumber,
      pageTotal,
      phase,
      progress: Math.min(1, Math.max(0, (pageIndex + withinPageProgress) / pageTotal)),
    }),
  );
}

export function probePdfHeader(
  input: ArrayBuffer | Uint8Array,
  sourceByteLength: number,
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): PdfProbeResult {
  if (!Number.isSafeInteger(sourceByteLength) || sourceByteLength < PDF_HEADER_LENGTH) {
    throw new HeaderProbeError("invalid-container", "PDF source length is invalid.");
  }
  if (sourceByteLength > limits.maxPdfBytes) {
    throw new HeaderProbeError("input-too-large", "PDF source exceeds the Web byte limit.", {
      limitBytes: limits.maxPdfBytes,
      sourceByteLength,
    });
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < PDF_HEADER_LENGTH || ascii(bytes, 0, 5) !== "%PDF-") {
    throw new HeaderProbeError("unsupported-input", "PDF signature is missing.");
  }
  const version = ascii(bytes, 5, 8);
  if (!/^(?:1\.[0-7]|2\.0)$/u.test(version)) {
    throw new HeaderProbeError("invalid-container", "PDF version header is unsupported.");
  }
  return Object.freeze({
    byteLength: sourceByteLength,
    format: "pdf",
    version: version as PdfVersion,
  });
}

async function convertRenderedPage(
  request: PdfConversionRequest,
  rendered: RenderedPdfPage,
  pageNumber: number,
  codecs: RasterCodecAdapter,
  limits: ResourceLimits,
  onProgress: PdfProgressReporter | undefined,
  pageIndex: number,
  outputByteLimit: number,
): Promise<PdfPageConversionOutcome> {
  const pixels = rendered.width * rendered.height;
  if (
    !Number.isSafeInteger(rendered.width) ||
    !Number.isSafeInteger(rendered.height) ||
    rendered.width < 1 ||
    rendered.height < 1 ||
    !Number.isSafeInteger(pixels) ||
    pixels > limits.maxRuntimePixels ||
    pixels > limits.absolutePixels ||
    rendered.pngBytes.byteLength < 1 ||
    rendered.pngBytes.byteLength > MAX_RASTER_OUTPUT_BYTES
  ) {
    return pageFailure(pageNumber, "pixel-budget-exceeded");
  }

  const intermediateLimits: ResourceLimits = {
    ...limits,
    maxRasterBytes: Math.max(limits.maxRasterBytes, rendered.pngBytes.byteLength),
  };
  let pngProbe;
  try {
    pngProbe = probeRasterHeader(rendered.pngBytes, rendered.pngBytes.byteLength, {
      limits: intermediateLimits,
      maxProbeBytes: Math.max(64, rendered.pngBytes.byteLength),
    });
    if (
      pngProbe.format !== "png" ||
      pngProbe.width !== rendered.width ||
      pngProbe.height !== rendered.height
    ) {
      return pageFailure(pageNumber, "output-validation-failed");
    }
  } catch {
    return pageFailure(pageNumber, "output-validation-failed");
  }

  const rasterRequest: ConversionRequest = {
    input: {
      bytes: rendered.pngBytes,
      name: request.input.name,
      probe: pngProbe,
    },
    outputByteLimit,
    jobId: `${request.jobId}_p${pageNumber}`,
    schemaVersion: 1,
    settings: request.settings.raster,
  };
  const outcome = await convertRasterRequest(
    rasterRequest,
    codecs,
    ({ phase, progress }) => {
      report(
        onProgress,
        phase,
        pageIndex,
        pageNumber,
        request.settings.pages.length,
        0.28 + progress * 0.72,
      );
    },
    intermediateLimits,
  );
  if (!outcome.ok) {
    return Object.freeze({
      failure: createConversionFailure(outcome.failure.code, outcome.failure.recoverable, {
        ...outcome.failure.params,
        pageNumber,
      }),
      ok: false,
      pageNumber,
    });
  }
  return Object.freeze({
    ok: true,
    pageNumber,
    result: Object.freeze({ ...outcome.result, pageNumber }),
  });
}

export async function convertPdfRequest(
  request: PdfConversionRequest,
  pdfAdapter: PdfDocumentAdapter,
  codecs: RasterCodecAdapter,
  onProgress?: PdfProgressReporter,
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): Promise<PdfConversionOutcome> {
  try {
    assertPdfConversionRequest(request, limits);
  } catch {
    return failure("invalid-settings");
  }
  try {
    const freshProbe = probePdfHeader(request.input.bytes, request.input.bytes.byteLength, limits);
    if (freshProbe.version !== request.input.probe.version) return failure("format-mismatch");
  } catch {
    return failure("format-mismatch");
  }

  const outputByteLimit = Math.min(
    limits.maxPdfOutputBytes,
    limits.maxTotalOutputBytes,
    request.outputByteLimit ?? limits.maxTotalOutputBytes,
  );
  if (outputByteLimit === 0) return failure("output-budget-exceeded");
  const startedAt = performance.now();
  report(
    onProgress,
    "loading",
    0,
    request.settings.pages[0] ?? 1,
    request.settings.pages.length,
    0.02,
  );
  let document: LoadedPdfDocument;
  try {
    document = await pdfAdapter.load(new Uint8Array(request.input.bytes), limits);
  } catch (error) {
    return failure(error instanceof PdfAdapterError ? error.code : "decode-failed");
  }

  let outcome: PdfConversionOutcome = failure("worker-failed");
  try {
    if (
      !Number.isSafeInteger(document.pageCount) ||
      document.pageCount < 1 ||
      document.pageCount > limits.maxPdfPages
    ) {
      outcome = failure(
        document.pageCount > limits.maxPdfPages ? "input-too-large" : "decode-failed",
      );
    } else if (document.containsJavaScript) {
      outcome = failure("unsafe-pdf");
    } else if (request.settings.pages.some((page) => page > document.pageCount)) {
      outcome = failure("invalid-settings");
    } else {
      const pages: PdfPageConversionOutcome[] = [];
      let retainedBytes = 0;
      let outputBudgetExhausted = false;
      for (let pageIndex = 0; pageIndex < request.settings.pages.length; pageIndex += 1) {
        const pageNumber = request.settings.pages[pageIndex];
        if (pageNumber === undefined) continue;
        if (outputBudgetExhausted || retainedBytes === outputByteLimit) {
          pages.push(pageFailure(pageNumber, "output-budget-exceeded"));
          continue;
        }
        report(onProgress, "rendering", pageIndex, pageNumber, request.settings.pages.length, 0.08);
        try {
          const rendered = await document.renderPage(pageNumber, request.settings.dpi, limits);
          const page = await convertRenderedPage(
            request,
            rendered,
            pageNumber,
            codecs,
            limits,
            onProgress,
            pageIndex,
            outputByteLimit - retainedBytes,
          );
          if (page.ok) retainedBytes += page.result.bytes.byteLength;
          else if (page.failure.code === "output-budget-exceeded") outputBudgetExhausted = true;
          pages.push(page);
        } catch (error) {
          pages.push(
            pageFailure(
              pageNumber,
              error instanceof PdfAdapterError ? error.code : "decode-failed",
            ),
          );
        }
      }
      outcome = Object.freeze({
        ok: true,
        result: Object.freeze({
          durationMs: performance.now() - startedAt,
          pageCount: document.pageCount,
          pages: Object.freeze(pages),
        }),
      });
    }
  } finally {
    try {
      await document.destroy();
    } catch {
      outcome = failure("worker-failed");
    }
  }
  return outcome;
}
