import {
  assertConversionSettings,
  type ConversionSettings,
  type ConversionSuccess,
  type ProbeResult,
} from "./conversion.js";
import type { ConversionFailure } from "./errors.js";
import { WEB_V1_DESKTOP_LIMITS, type ResourceLimits } from "./limits.js";

export const PDF_MIN_DPI = 72;
export const PDF_MAX_DPI = 600;
export const PDF_DEFAULT_DPI = 144;
export const PDF_MAX_PAGE_RANGE_CHARACTERS = 4_096;

export type PdfVersion = "1.0" | "1.1" | "1.2" | "1.3" | "1.4" | "1.5" | "1.6" | "1.7" | "2.0";

export interface PdfProbeResult {
  readonly byteLength: number;
  readonly format: "pdf";
  readonly version: PdfVersion;
}

export type InputProbeResult = PdfProbeResult | ProbeResult;

export interface PdfConversionSettings {
  readonly dpi: number;
  readonly pages: readonly number[];
  readonly raster: ConversionSettings;
}

export interface PdfConversionRequest {
  readonly input: Readonly<{
    bytes: ArrayBuffer;
    name: string;
    probe: PdfProbeResult;
  }>;
  readonly jobId: string;
  readonly schemaVersion: 1;
  readonly settings: PdfConversionSettings;
}

export interface PdfPageConversionSuccess extends ConversionSuccess {
  readonly pageNumber: number;
}

export type PdfPageConversionOutcome =
  | { readonly failure: ConversionFailure; readonly ok: false; readonly pageNumber: number }
  | { readonly ok: true; readonly pageNumber: number; readonly result: PdfPageConversionSuccess };

export interface PdfConversionSuccess {
  readonly durationMs: number;
  readonly pageCount: number;
  readonly pages: readonly PdfPageConversionOutcome[];
}

export type PdfConversionOutcome =
  | { readonly failure: ConversionFailure; readonly ok: false }
  | { readonly ok: true; readonly result: PdfConversionSuccess };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function parsePdfPageRange(
  source: string,
  pageCount: number | undefined = undefined,
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): readonly number[] {
  if (source.length < 1 || source.length > PDF_MAX_PAGE_RANGE_CHARACTERS) {
    throw new RangeError("PDF page range must be a short, non-empty value.");
  }
  const maximumPage = pageCount ?? limits.maxPdfPages;
  if (!Number.isSafeInteger(maximumPage) || maximumPage < 1 || maximumPage > limits.maxPdfPages) {
    throw new RangeError("PDF page count is outside the configured limit.");
  }

  const pages: number[] = [];
  const seen = new Set<number>();
  const tokens = source.split(",");
  if (tokens.length > limits.maxSelectedPdfPages) {
    throw new RangeError("PDF page range selects too many pages.");
  }
  for (const token of tokens) {
    const match = /^\s*(\d{1,6})(?:\s*-\s*(\d{1,6}))?\s*$/u.exec(token);
    if (!match) throw new TypeError("PDF page range syntax is invalid.");
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      first < 1 ||
      last < first ||
      last > maximumPage
    ) {
      throw new RangeError("PDF page range is outside the document bounds.");
    }
    for (let page = first; page <= last; page += 1) {
      if (!seen.has(page)) {
        if (pages.length >= limits.maxSelectedPdfPages) {
          throw new RangeError("PDF page range selects too many pages.");
        }
        pages.push(page);
        seen.add(page);
      }
    }
  }
  if (pages.length < 1 || pages.length > limits.maxSelectedPdfPages) {
    throw new RangeError("PDF page range selects too many pages.");
  }
  return Object.freeze(pages);
}

export function assertPdfConversionRequest(
  value: unknown,
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): asserts value is PdfConversionRequest {
  if (!isRecord(value)) throw new TypeError("PDF conversion request must be an object.");
  if (value.schemaVersion !== 1) throw new TypeError("PDF request schemaVersion must be 1.");
  if (typeof value.jobId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.jobId)) {
    throw new TypeError("PDF request jobId is invalid.");
  }
  if (!isRecord(value.input)) throw new TypeError("PDF request input must be an object.");
  if (
    !(value.input.bytes instanceof ArrayBuffer) ||
    value.input.bytes.byteLength < 1 ||
    value.input.bytes.byteLength > limits.maxPdfBytes
  ) {
    throw new RangeError("PDF input bytes are outside the configured limit.");
  }
  if (
    typeof value.input.name !== "string" ||
    value.input.name.length < 1 ||
    value.input.name.length > 1024 ||
    containsControlCharacter(value.input.name)
  ) {
    throw new TypeError("PDF input name is invalid.");
  }
  if (!isRecord(value.input.probe) || value.input.probe.format !== "pdf") {
    throw new TypeError("PDF input probe is invalid.");
  }
  if (
    value.input.probe.byteLength !== value.input.bytes.byteLength ||
    typeof value.input.probe.version !== "string" ||
    !/^(?:1\.[0-7]|2\.0)$/u.test(value.input.probe.version)
  ) {
    throw new TypeError("PDF input probe does not match the source bytes.");
  }
  if (!isRecord(value.settings)) throw new TypeError("PDF conversion settings are invalid.");
  if (
    !Number.isSafeInteger(value.settings.dpi) ||
    (value.settings.dpi as number) < PDF_MIN_DPI ||
    (value.settings.dpi as number) > PDF_MAX_DPI
  ) {
    throw new RangeError(`PDF DPI must be an integer from ${PDF_MIN_DPI} to ${PDF_MAX_DPI}.`);
  }
  if (!Array.isArray(value.settings.pages)) throw new TypeError("PDF pages must be an array.");
  const pages = value.settings.pages;
  if (
    pages.length < 1 ||
    pages.length > limits.maxSelectedPdfPages ||
    pages.some(
      (page) =>
        !Number.isSafeInteger(page) ||
        (page as number) < 1 ||
        (page as number) > limits.maxPdfPages,
    ) ||
    new Set(pages).size !== pages.length
  ) {
    throw new RangeError("PDF page selection is invalid.");
  }
  assertConversionSettings(value.settings.raster, limits);
}
