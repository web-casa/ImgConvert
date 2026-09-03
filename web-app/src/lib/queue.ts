import {
  WEB_V1_DESKTOP_LIMITS,
  type ConversionFailure,
  type ConversionSettings,
  type InputProbeResult,
  type JobState,
  type ProbeResult,
  type ResourceLimits,
} from "@imgconvert/conversion-contract";
import {
  DEFAULT_MAX_PROBE_BYTES,
  HeaderProbeError,
  probeRasterHeader,
  probePdfHeader,
  probeSvg,
  type ConversionProgressPhase,
  type HeaderProbeErrorCode,
  type ProbeErrorDetail,
} from "@imgconvert/web-image-engine";

export type ImportQueueState = JobState;

export interface QueueConversionResult {
  readonly blob: Blob;
  downloaded: boolean;
  readonly durationMs: number;
  readonly format: ConversionSettings["output"];
  readonly height: number;
  readonly name: string;
  readonly pageNumber?: number;
  readonly previewUrl: string;
  readonly settings: ConversionSettings;
  readonly size: number;
  readonly width: number;
}

export type QueueFailureCode =
  HeaderProbeErrorCode | "input-empty" | "queue-byte-limit" | "queue-file-limit" | "read-failed";

export interface QueueFailure {
  readonly code: QueueFailureCode;
  readonly params: Readonly<Record<string, ProbeErrorDetail>>;
}

export interface FormatMismatchWarning {
  readonly actual: InputProbeResult["format"];
  readonly expected: InputProbeResult["format"];
}

export interface QueueEntry {
  readonly file: File;
  readonly id: string;
  readonly name: string;
  readonly previewUrl: string;
  readonly size: number;
  conversionFailure?: ConversionFailure;
  failure?: QueueFailure;
  pageFailures?: Array<Readonly<{ failure: ConversionFailure; pageNumber: number }>>;
  pdfPageCount?: number;
  progress?: Readonly<{
    pageIndex?: number;
    pageNumber?: number;
    pageTotal?: number;
    phase: ConversionProgressPhase;
    value: number;
  }>;
  probe?: InputProbeResult;
  result?: QueueConversionResult;
  additionalResults?: QueueConversionResult[];
  gifFirstFrameNotice?: boolean;
  state: ImportQueueState;
  warning?: FormatMismatchWarning;
}

export interface QueueAdmission<T> {
  readonly accepted: readonly T[];
  readonly rejected: readonly Readonly<{ file: T; failure: QueueFailure }>[];
}

interface SizedFile {
  readonly name: string;
  readonly size: number;
}

const EXTENSION_FORMATS: Readonly<Record<string, InputProbeResult["format"]>> = Object.freeze({
  avif: "avif",
  bmp: "bmp",
  gif: "gif",
  jfif: "jpeg",
  jpeg: "jpeg",
  jpg: "jpeg",
  png: "png",
  pdf: "pdf",
  svg: "svg",
  webp: "webp",
});

export class QueueProbeError extends Error {
  readonly code: QueueFailureCode;
  readonly params: Readonly<Record<string, ProbeErrorDetail>>;

  constructor(code: QueueFailureCode, params: Readonly<Record<string, ProbeErrorDetail>> = {}) {
    super(code);
    this.name = "QueueProbeError";
    this.code = code;
    this.params = Object.freeze({ ...params });
  }
}

function abortIfRequested(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The probe was cancelled.", "AbortError");
}

export function admitFiles<T extends SizedFile>(
  existingCount: number,
  existingBytes: number,
  candidates: readonly T[],
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): QueueAdmission<T> {
  const accepted: T[] = [];
  const rejected: Array<Readonly<{ file: T; failure: QueueFailure }>> = [];
  let nextCount = existingCount;
  let nextBytes = existingBytes;

  for (const file of candidates) {
    if (nextCount >= limits.maxQueueFiles) {
      rejected.push({
        failure: {
          code: "queue-file-limit",
          params: Object.freeze({ limitFiles: limits.maxQueueFiles }),
        },
        file,
      });
      continue;
    }
    const candidateBytes = nextBytes + file.size;
    if (!Number.isSafeInteger(candidateBytes) || candidateBytes > limits.maxTotalSourceBytes) {
      rejected.push({
        failure: {
          code: "queue-byte-limit",
          params: Object.freeze({ limitBytes: limits.maxTotalSourceBytes }),
        },
        file,
      });
      continue;
    }
    accepted.push(file);
    nextCount += 1;
    nextBytes = candidateBytes;
  }
  return Object.freeze({ accepted: Object.freeze(accepted), rejected: Object.freeze(rejected) });
}

export async function probeRasterFile(
  file: File,
  signal: AbortSignal,
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): Promise<ProbeResult> {
  abortIfRequested(signal);
  if (file.size < 1) throw new QueueProbeError("input-empty");
  if (file.size > limits.maxRasterBytes) {
    throw new QueueProbeError("input-too-large", {
      limitBytes: limits.maxRasterBytes,
      sourceByteLength: file.size,
    });
  }
  const prefix = await file.slice(0, DEFAULT_MAX_PROBE_BYTES).arrayBuffer();
  abortIfRequested(signal);
  if (looksLikeGif(prefix)) {
    const source = await file.slice(0, file.size).arrayBuffer();
    abortIfRequested(signal);
    return probeRasterHeader(source, file.size, {
      limits,
      maxProbeBytes: Math.max(64, file.size),
    });
  }
  return probeRasterHeader(prefix, file.size, { limits });
}

function looksLikeSvg(file: File, prefix: ArrayBuffer): boolean {
  if (/\.svg$/iu.test(file.name) || file.type?.toLowerCase() === "image/svg+xml") return true;
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(prefix);
    return /<(?:[A-Za-z_][\w.-]*:)?svg(?:\s|>)/u.test(source);
  } catch {
    return false;
  }
}

function looksLikeGif(prefix: ArrayBuffer): boolean {
  const bytes = new Uint8Array(prefix);
  if (bytes.byteLength < 6) return false;
  const signature = new TextDecoder("ascii").decode(bytes.subarray(0, 6));
  return signature === "GIF87a" || signature === "GIF89a";
}

export async function probeImageFile(
  file: File,
  signal: AbortSignal,
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): Promise<InputProbeResult> {
  abortIfRequested(signal);
  if (file.size < 1) throw new QueueProbeError("input-empty");
  if (file.size > limits.maxPdfBytes) {
    throw new QueueProbeError("input-too-large", {
      limitBytes: limits.maxPdfBytes,
      sourceByteLength: file.size,
    });
  }
  const prefix = await file.slice(0, DEFAULT_MAX_PROBE_BYTES).arrayBuffer();
  abortIfRequested(signal);
  try {
    return probePdfHeader(prefix, file.size, limits);
  } catch (error) {
    if (!(error instanceof HeaderProbeError) || error.code !== "unsupported-input") throw error;
  }
  try {
    if (looksLikeGif(prefix)) {
      const source = await file.slice(0, file.size).arrayBuffer();
      abortIfRequested(signal);
      return probeRasterHeader(source, file.size, {
        limits,
        maxProbeBytes: Math.max(64, file.size),
      });
    }
    return probeRasterHeader(prefix, file.size, { limits });
  } catch (error) {
    if (!(error instanceof HeaderProbeError) || error.code !== "unsupported-input") throw error;
    if (!looksLikeSvg(file, prefix)) throw error;
  }
  if (file.size > limits.maxSvgBytes) {
    throw new QueueProbeError("input-too-large", {
      limitBytes: limits.maxSvgBytes,
      sourceByteLength: file.size,
    });
  }
  const source = await file.slice(0, file.size).arrayBuffer();
  abortIfRequested(signal);
  return probeSvg(source, limits);
}

export function formatMismatch(
  fileName: string,
  actual: InputProbeResult["format"],
): FormatMismatchWarning | undefined {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension) return undefined;
  const expected = EXTENSION_FORMATS[extension];
  return expected && expected !== actual ? Object.freeze({ actual, expected }) : undefined;
}

export function normalizeProbeFailure(error: unknown): QueueFailure {
  if (error instanceof HeaderProbeError) {
    return Object.freeze({ code: error.code, params: Object.freeze({ ...error.details }) });
  }
  if (error instanceof QueueProbeError) {
    return Object.freeze({ code: error.code, params: Object.freeze({ ...error.params }) });
  }
  return Object.freeze({ code: "read-failed", params: Object.freeze({}) });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
