// SPDX-License-Identifier: Apache-2.0
import {
  PDF_DEFAULT_DPI,
  PDF_MAX_DPI,
  PDF_MIN_DPI,
  WEB_V1_DESKTOP_LIMITS,
  parsePdfPageRange,
  type RasterOutputFormat,
} from "@imgconvert/conversion-contract";

export type ExtensionLocale = "en" | "zh";
export type ExtensionTheme = "dark" | "light";

export interface ExtensionPreferences {
  readonly jpegBackground: string;
  readonly locale: ExtensionLocale;
  readonly lossless: boolean;
  readonly outputFormat: RasterOutputFormat;
  readonly pdfDpi: number;
  readonly pdfPageRange: string;
  readonly quality: number;
  readonly resizeHeight: number;
  readonly resizeMode: "custom" | "original";
  readonly resizeWidth: number;
  readonly schemaVersion: 1;
  readonly theme: ExtensionTheme;
}

export const EXTENSION_PREFERENCES_MAX_BYTES = 4096;

export const DEFAULT_EXTENSION_PREFERENCES: ExtensionPreferences = Object.freeze({
  jpegBackground: "#ffffff",
  locale: "en",
  lossless: false,
  outputFormat: "webp",
  pdfDpi: PDF_DEFAULT_DPI,
  pdfPageRange: "1",
  quality: 82,
  resizeHeight: 1080,
  resizeMode: "original",
  resizeWidth: 1920,
  schemaVersion: 1,
  theme: "light",
});

const OUTPUT_FORMATS = new Set<RasterOutputFormat>(["avif", "jpeg", "png", "webp"]);

function isSafeDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 65_535;
}

export function validateExtensionPreferences(value: unknown): ExtensionPreferences | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ExtensionPreferences>;
  if (
    candidate.schemaVersion !== 1 ||
    (candidate.locale !== "en" && candidate.locale !== "zh") ||
    (candidate.theme !== "dark" && candidate.theme !== "light") ||
    typeof candidate.outputFormat !== "string" ||
    !OUTPUT_FORMATS.has(candidate.outputFormat as RasterOutputFormat) ||
    typeof candidate.lossless !== "boolean" ||
    !Number.isSafeInteger(candidate.quality) ||
    Number(candidate.quality) < 1 ||
    Number(candidate.quality) > 100 ||
    (candidate.resizeMode !== "custom" && candidate.resizeMode !== "original") ||
    !isSafeDimension(candidate.resizeWidth) ||
    !isSafeDimension(candidate.resizeHeight) ||
    candidate.resizeWidth * candidate.resizeHeight > WEB_V1_DESKTOP_LIMITS.maxRuntimePixels ||
    typeof candidate.jpegBackground !== "string" ||
    !/^#[\da-f]{6}$/iu.test(candidate.jpegBackground) ||
    typeof candidate.pdfPageRange !== "string" ||
    candidate.pdfPageRange.length > 512 ||
    !Number.isSafeInteger(candidate.pdfDpi) ||
    Number(candidate.pdfDpi) < PDF_MIN_DPI ||
    Number(candidate.pdfDpi) > PDF_MAX_DPI
  ) {
    return undefined;
  }
  try {
    parsePdfPageRange(candidate.pdfPageRange);
  } catch {
    return undefined;
  }
  const outputFormat = candidate.outputFormat as RasterOutputFormat;
  const preferences: ExtensionPreferences = {
    jpegBackground: candidate.jpegBackground.toLowerCase(),
    locale: candidate.locale,
    lossless: outputFormat === "png" || (outputFormat !== "jpeg" && candidate.lossless),
    outputFormat,
    pdfDpi: candidate.pdfDpi as number,
    pdfPageRange: candidate.pdfPageRange,
    quality: candidate.quality as number,
    resizeHeight: candidate.resizeHeight,
    resizeMode: candidate.resizeMode,
    resizeWidth: candidate.resizeWidth,
    schemaVersion: 1,
    theme: candidate.theme,
  };
  if (
    new TextEncoder().encode(JSON.stringify(preferences)).byteLength >
    EXTENSION_PREFERENCES_MAX_BYTES
  ) {
    return undefined;
  }
  return Object.freeze(preferences);
}

export function systemDefaultPreferences(
  languages: readonly string[],
  prefersDark: boolean,
): ExtensionPreferences {
  return Object.freeze({
    ...DEFAULT_EXTENSION_PREFERENCES,
    locale: languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh" : "en",
    theme: prefersDark ? "dark" : "light",
  });
}
