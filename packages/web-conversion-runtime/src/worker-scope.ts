export interface RuntimeWorkerScope<TOutput> {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: TOutput, transfer?: Transferable[]): void;
}

export function asRuntimeWorkerScope<TOutput>(value: unknown): RuntimeWorkerScope<TOutput> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("addEventListener" in value) ||
    typeof value.addEventListener !== "function" ||
    !("postMessage" in value) ||
    typeof value.postMessage !== "function"
  ) {
    throw new TypeError("Worker scope must provide addEventListener and postMessage.");
  }
  return value as RuntimeWorkerScope<TOutput>;
}

export function isWorkerCommand<TType extends string, TVersion extends number>(
  value: unknown,
  type: TType,
  schemaVersion: TVersion,
): value is Readonly<{
  executionId: string;
  request: object;
  schemaVersion: TVersion;
  type: TType;
}> {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  return (
    command.type === type &&
    command.schemaVersion === schemaVersion &&
    typeof command.executionId === "string" &&
    command.executionId.length > 0 &&
    typeof command.request === "object" &&
    command.request !== null
  );
}

export function workerExceptionParams(
  error: unknown,
): Readonly<Record<string, boolean | number | string | null>> {
  if (!(error instanceof Error)) {
    return Object.freeze({ exceptionType: typeof error, reason: "worker-exception" });
  }
  return Object.freeze({
    exceptionMessage: error.message.slice(0, 256),
    exceptionType: error.name.slice(0, 80),
    reason: "worker-exception",
  });
}
