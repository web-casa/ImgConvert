// SPDX-License-Identifier: Apache-2.0

import {
  PDF_DEFAULT_DPI,
  PDF_MAX_DPI,
  PDF_MIN_DPI,
  WEB_V1_DESKTOP_LIMITS,
  parsePdfPageRange,
  type RasterOutputFormat,
} from "@imgconvert/conversion-contract";

export const WEB_CONVERSION_PREFERENCES_KEY = "imgconvert-web-conversion-v1";
export const WEB_LOCALE_PREFERENCE_KEY = "imgconvert-web-locale";
export const WEB_THEME_PREFERENCE_KEY = "imgconvert-web-theme";

const OUTPUT_FORMATS = new Set<RasterOutputFormat>(["avif", "jpeg", "png", "webp"]);
const MAX_PREFERENCE_BYTES = 4096;

export interface WebConversionPreferences {
  readonly jpegBackground: string;
  readonly lossless: boolean;
  readonly outputFormat: RasterOutputFormat;
  readonly pdfDpi: number;
  readonly pdfPageRange: string;
  readonly quality: number;
  readonly resizeHeight: number;
  readonly resizeMode: "custom" | "original";
  readonly resizeWidth: number;
  readonly schemaVersion: 1;
}

export const DEFAULT_WEB_CONVERSION_PREFERENCES: WebConversionPreferences = Object.freeze({
  jpegBackground: "#ffffff",
  lossless: false,
  outputFormat: "webp",
  pdfDpi: PDF_DEFAULT_DPI,
  pdfPageRange: "1",
  quality: 82,
  resizeHeight: 1080,
  resizeMode: "original",
  resizeWidth: 1920,
  schemaVersion: 1,
});

interface PreferenceReader {
  getItem(key: string): string | null;
}

interface PreferenceWriter {
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function isSafeDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 65_535;
}

export function validateWebConversionPreferences(
  value: unknown,
): WebConversionPreferences | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<WebConversionPreferences>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.outputFormat !== "string" ||
    !OUTPUT_FORMATS.has(candidate.outputFormat as RasterOutputFormat) ||
    typeof candidate.lossless !== "boolean" ||
    typeof candidate.quality !== "number" ||
    !Number.isSafeInteger(candidate.quality) ||
    candidate.quality < 1 ||
    candidate.quality > 100 ||
    (candidate.resizeMode !== "custom" && candidate.resizeMode !== "original") ||
    !isSafeDimension(candidate.resizeWidth) ||
    !isSafeDimension(candidate.resizeHeight) ||
    candidate.resizeWidth * candidate.resizeHeight > WEB_V1_DESKTOP_LIMITS.maxRuntimePixels ||
    typeof candidate.jpegBackground !== "string" ||
    !/^#[\da-f]{6}$/iu.test(candidate.jpegBackground) ||
    typeof candidate.pdfPageRange !== "string" ||
    candidate.pdfPageRange.length > 512 ||
    typeof candidate.pdfDpi !== "number" ||
    !Number.isSafeInteger(candidate.pdfDpi) ||
    candidate.pdfDpi < PDF_MIN_DPI ||
    candidate.pdfDpi > PDF_MAX_DPI
  ) {
    return undefined;
  }
  try {
    parsePdfPageRange(candidate.pdfPageRange);
  } catch {
    return undefined;
  }
  const outputFormat = candidate.outputFormat as RasterOutputFormat;
  return Object.freeze({
    jpegBackground: candidate.jpegBackground.toLowerCase(),
    lossless: outputFormat === "png" || (outputFormat !== "jpeg" && candidate.lossless),
    outputFormat,
    pdfDpi: candidate.pdfDpi,
    pdfPageRange: candidate.pdfPageRange,
    quality: candidate.quality,
    resizeHeight: candidate.resizeHeight,
    resizeMode: candidate.resizeMode,
    resizeWidth: candidate.resizeWidth,
    schemaVersion: 1,
  });
}

export function loadWebConversionPreferences(storage: PreferenceReader): WebConversionPreferences {
  try {
    const serialized = storage.getItem(WEB_CONVERSION_PREFERENCES_KEY);
    if (!serialized || serialized.length > MAX_PREFERENCE_BYTES) {
      return DEFAULT_WEB_CONVERSION_PREFERENCES;
    }
    return (
      validateWebConversionPreferences(JSON.parse(serialized)) ?? DEFAULT_WEB_CONVERSION_PREFERENCES
    );
  } catch {
    return DEFAULT_WEB_CONVERSION_PREFERENCES;
  }
}

export function saveWebConversionPreferences(
  storage: PreferenceWriter,
  preferences: WebConversionPreferences,
): void {
  try {
    const validated = validateWebConversionPreferences(preferences);
    if (!validated) return;
    storage.setItem(WEB_CONVERSION_PREFERENCES_KEY, JSON.stringify(validated));
  } catch {
    // Preferences remain session-only when browser storage is unavailable.
  }
}

export function clearWebPreferences(storage: PreferenceWriter): boolean {
  let cleared = true;
  for (const key of [
    WEB_CONVERSION_PREFERENCES_KEY,
    WEB_LOCALE_PREFERENCE_KEY,
    WEB_THEME_PREFERENCE_KEY,
  ]) {
    try {
      storage.removeItem(key);
    } catch {
      cleared = false;
      // Keep clearing the remaining keys when a storage implementation rejects one entry.
    }
  }
  return cleared;
}
