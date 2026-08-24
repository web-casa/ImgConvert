import { translate } from "$lib/i18n";

const ERROR_MESSAGE_KEYS = {
  fileNotFound: "errors.fileNotFound",
  permissionDenied: "errors.permissionDenied",
  outputPermissionDenied: "errors.outputPermissionDenied",
  unsupportedFormat: "errors.unsupportedFormat",
  outputExists: "errors.outputExists",
  outputNotSmaller: "errors.outputNotSmaller",
  conversionFailed: "errors.conversionFailed",
  batchFailed: "errors.batchFailed",
  importFailed: "errors.importFailed",
  clipboardImportFailed: "errors.clipboardImportFailed",
  nativeDialogFailed: "errors.nativeDialogFailed",
  thumbnailFailed: "errors.thumbnailFailed",
  codecConfigurationFailed: "errors.codecConfigurationFailed",
  taskFailed: "errors.taskFailed",
} as const;

export type CommandErrorCode = keyof typeof ERROR_MESSAGE_KEYS;

const REQUIRED_MESSAGE_PARAMS: Partial<Record<CommandErrorCode, readonly string[]>> = {
  fileNotFound: ["path"],
  permissionDenied: ["path"],
  outputPermissionDenied: ["path"],
  unsupportedFormat: ["format"],
  outputExists: ["path"],
  outputNotSmaller: ["path"],
  conversionFailed: ["path"],
  thumbnailFailed: ["path"],
};

export interface CommandError {
  code: CommandErrorCode;
  params: Record<string, unknown> | null;
  detail: string | null;
}

export function parseCommandError(error: unknown): CommandError | null {
  const direct = parseCommandErrorObject(error);
  if (direct) return direct;

  const message =
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof error.message === "string"
        ? error.message
        : null;
  return message ? parseCommandErrorJson(message) : null;
}

export function formatCommandError(error: unknown): string {
  const commandError = parseCommandError(error);
  if (!commandError) {
    return translate("errors.taskFailed");
  }

  if (commandError.detail && import.meta.env.DEV) {
    console.warn("ImgConvert command error detail:", commandError);
  }

  const params = messageParams(commandError.params);
  const requiredParams = REQUIRED_MESSAGE_PARAMS[commandError.code] ?? [];
  if (requiredParams.some((name) => !params[name])) {
    return translate("errors.taskFailed");
  }

  try {
    return translate(ERROR_MESSAGE_KEYS[commandError.code], params);
  } catch {
    return translate("errors.taskFailed");
  }
}

/**
 * Logs a command failure without leaking its backend detail in production.
 * `formatCommandError` retains the structured detail for local development.
 */
export function logCommandError(context: string, error: unknown): void {
  console.warn(`${context}:`, formatCommandError(error));
}

function parseCommandErrorJson(value: string): CommandError | null {
  try {
    return parseCommandErrorObject(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function parseCommandErrorObject(value: unknown): CommandError | null {
  if (!isRecord(value) || !isCommandErrorCode(value.code)) return null;

  return {
    code: value.code,
    params: isRecord(value.params) ? value.params : null,
    detail: typeof value.detail === "string" ? value.detail : null,
  };
}

function isCommandErrorCode(value: unknown): value is CommandErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_MESSAGE_KEYS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function messageParams(params: Record<string, unknown> | null): Record<string, string | number> {
  if (!params) return {};

  return Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) => {
      if (typeof value === "string" || typeof value === "number") {
        return [[key, value]];
      }
      if (typeof value === "boolean") {
        return [[key, String(value)]];
      }
      return [];
    }),
  );
}
