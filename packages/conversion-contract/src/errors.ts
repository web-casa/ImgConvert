export const CONVERSION_ERROR_CODES = [
  "cancelled",
  "input-empty",
  "input-too-large",
  "unsupported-input",
  "unsupported-output",
  "unsupported-color-profile",
  "format-mismatch",
  "animated-input",
  "pixel-budget-exceeded",
  "unsafe-svg",
  "unsafe-pdf",
  "encrypted-pdf",
  "invalid-settings",
  "decode-failed",
  "encode-failed",
  "output-validation-failed",
  "worker-failed",
] as const;

export type ConversionErrorCode = (typeof CONVERSION_ERROR_CODES)[number];
export type ErrorParameter = boolean | number | string | null;

export interface ConversionFailure {
  readonly code: ConversionErrorCode;
  readonly params: Readonly<Record<string, ErrorParameter>>;
  readonly recoverable: boolean;
}

const errorCodes = new Set<string>(CONVERSION_ERROR_CODES);

export function createConversionFailure(
  code: ConversionErrorCode,
  recoverable: boolean,
  params: Readonly<Record<string, ErrorParameter>> = {},
): ConversionFailure {
  if (!errorCodes.has(code)) throw new TypeError(`Unknown conversion error code: ${code}.`);
  const safeParams: Record<string, ErrorParameter> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!/^[a-z][a-zA-Z0-9]*$/u.test(key)) {
      throw new TypeError(`Invalid conversion error parameter name: ${key}.`);
    }
    if (
      value !== null &&
      typeof value !== "boolean" &&
      typeof value !== "number" &&
      typeof value !== "string"
    ) {
      throw new TypeError(`Conversion error parameter ${key} must be a scalar.`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`Conversion error parameter ${key} must be finite.`);
    }
    safeParams[key] = value;
  }
  return Object.freeze({ code, params: Object.freeze(safeParams), recoverable });
}

export function isConversionFailure(value: unknown): value is ConversionFailure {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.code !== "string" ||
    !errorCodes.has(candidate.code) ||
    typeof candidate.recoverable !== "boolean" ||
    typeof candidate.params !== "object" ||
    candidate.params === null ||
    Array.isArray(candidate.params)
  ) {
    return false;
  }
  return Object.entries(candidate.params).every(
    ([key, parameter]) =>
      /^[a-z][a-zA-Z0-9]*$/u.test(key) &&
      (parameter === null ||
        typeof parameter === "boolean" ||
        (typeof parameter === "number" && Number.isFinite(parameter)) ||
        typeof parameter === "string"),
  );
}
