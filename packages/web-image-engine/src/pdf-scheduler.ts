import {
  WEB_V1_DESKTOP_LIMITS,
  assertPdfConversionRequest,
  createConversionFailure,
  createResourceLimits,
  type PdfConversionOutcome,
  type PdfConversionRequest,
  type ResourceLimits,
} from "@imgconvert/conversion-contract";

import {
  isPdfConversionWorkerProgress,
  isPdfConversionWorkerResult,
  type PdfConversionWorkerCommand,
  type PdfConversionWorkerProgress,
} from "./pdf-worker-protocol.js";

export interface PdfConversionWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: PdfConversionWorkerCommand, transfer: Transferable[]): void;
  terminate(): void;
}

export interface PdfConversionJobHandle {
  readonly jobId: string;
  readonly outcome: Promise<PdfConversionOutcome>;
  cancel(): boolean;
}

export interface PdfConversionSchedulerOptions {
  readonly limits?: ResourceLimits;
  readonly timeoutMs?: number;
  readonly workerFactory: () => PdfConversionWorkerLike;
}

interface ActiveJob {
  readonly executionId: string;
  readonly onProgress: ((progress: PdfConversionWorkerProgress) => void) | undefined;
  readonly request: PdfConversionRequest;
  readonly resolve: (outcome: PdfConversionOutcome) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_PDF_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

function failure(
  jobId: string,
  reason:
    | "cancelled"
    | "error-event"
    | "invalid-message"
    | "message-error"
    | "output-mismatch"
    | "post-message"
    | "startup"
    | "timeout",
  timeoutMs?: number,
): PdfConversionOutcome {
  return Object.freeze({
    failure: createConversionFailure(reason === "cancelled" ? "cancelled" : "worker-failed", true, {
      jobId,
      reason,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
    ok: false,
  });
}

function takeOwnership(request: PdfConversionRequest): PdfConversionRequest {
  const bytes = structuredClone(request.input.bytes, { transfer: [request.input.bytes] });
  return Object.freeze({
    input: Object.freeze({
      bytes,
      name: request.input.name,
      probe: Object.freeze({ ...request.input.probe }),
    }),
    jobId: request.jobId,
    schemaVersion: 1,
    settings: Object.freeze({
      dpi: request.settings.dpi,
      pages: Object.freeze([...request.settings.pages]),
      raster: Object.freeze({
        ...request.settings.raster,
        background: Object.freeze({ ...request.settings.raster.background }),
        resize:
          request.settings.raster.resize === null
            ? null
            : Object.freeze({ ...request.settings.raster.resize }),
      }),
    }),
  });
}

function freezeOutcome(outcome: PdfConversionOutcome): PdfConversionOutcome {
  if (!outcome.ok) {
    return Object.freeze({
      failure: createConversionFailure(
        outcome.failure.code,
        outcome.failure.recoverable,
        outcome.failure.params,
      ),
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    result: Object.freeze({
      ...outcome.result,
      pages: Object.freeze(
        outcome.result.pages.map((page) =>
          page.ok
            ? Object.freeze({
                ok: true as const,
                pageNumber: page.pageNumber,
                result: Object.freeze({ ...page.result }),
              })
            : Object.freeze({
                failure: createConversionFailure(
                  page.failure.code,
                  page.failure.recoverable,
                  page.failure.params,
                ),
                ok: false as const,
                pageNumber: page.pageNumber,
              }),
        ),
      ),
    }),
  });
}

export class PdfConversionScheduler {
  readonly #limits: ResourceLimits;
  readonly #timeoutMs: number;
  readonly #workerFactory: () => PdfConversionWorkerLike;
  #active: ActiveJob | undefined;
  #disposed = false;
  #executionSequence = 0;
  #worker: PdfConversionWorkerLike | undefined;

  constructor(options: PdfConversionSchedulerOptions) {
    if (typeof options.workerFactory !== "function") {
      throw new TypeError("workerFactory must be a function.");
    }
    this.#limits = createResourceLimits(options.limits ?? WEB_V1_DESKTOP_LIMITS);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_PDF_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 1 ||
      this.#timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new RangeError(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}.`);
    }
    this.#workerFactory = options.workerFactory;
  }

  enqueue(
    request: PdfConversionRequest,
    onProgress?: (progress: PdfConversionWorkerProgress) => void,
  ): PdfConversionJobHandle {
    if (this.#disposed) throw new Error("PDF scheduler has been disposed.");
    if (this.#active) throw new Error("PDF scheduler already has an active job.");
    assertPdfConversionRequest(request, this.#limits);
    const owned = takeOwnership(request);
    let resolveOutcome: ((outcome: PdfConversionOutcome) => void) | undefined;
    const outcome = new Promise<PdfConversionOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    if (!resolveOutcome) throw new Error("Failed to create PDF conversion promise.");
    const executionId = `${owned.jobId}:${(this.#executionSequence += 1)}`;
    this.#active = {
      executionId,
      onProgress,
      request: owned,
      resolve: resolveOutcome,
      timeout: undefined,
    };
    queueMicrotask(() => this.#start(executionId));
    return Object.freeze({
      cancel: () => this.cancel(owned.jobId),
      jobId: owned.jobId,
      outcome,
    });
  }

  cancel(jobId: string): boolean {
    const active = this.#active;
    if (!active || active.request.jobId !== jobId) return false;
    this.#finish(active.executionId, failure(jobId, "cancelled"), true);
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const active = this.#active;
    if (active) this.#finish(active.executionId, failure(active.request.jobId, "cancelled"), true);
    else this.#recycleWorker();
  }

  #createWorker(): PdfConversionWorkerLike {
    const worker = this.#workerFactory();
    if (
      !worker ||
      typeof worker.postMessage !== "function" ||
      typeof worker.terminate !== "function"
    ) {
      throw new TypeError("workerFactory returned an invalid PDF worker.");
    }
    worker.onmessage = (event) => this.#onMessage(worker, event.data);
    worker.onerror = () => this.#onFailure(worker, "error-event");
    worker.onmessageerror = () => this.#onFailure(worker, "message-error");
    this.#worker = worker;
    return worker;
  }

  #start(executionId: string): void {
    const active = this.#active;
    if (!active || active.executionId !== executionId || this.#disposed) return;
    let worker: PdfConversionWorkerLike;
    try {
      worker = this.#worker ?? this.#createWorker();
    } catch {
      this.#finish(executionId, failure(active.request.jobId, "startup"), true);
      return;
    }
    try {
      worker.postMessage(
        { executionId, request: active.request, schemaVersion: 1, type: "convert-pdf" },
        [active.request.input.bytes],
      );
    } catch {
      this.#finish(executionId, failure(active.request.jobId, "post-message"), true);
      return;
    }
    if (this.#active === active) {
      active.timeout = setTimeout(
        () =>
          this.#finish(
            executionId,
            failure(active.request.jobId, "timeout", this.#timeoutMs),
            true,
          ),
        this.#timeoutMs,
      );
    }
  }

  #onMessage(worker: PdfConversionWorkerLike, data: unknown): void {
    if (worker !== this.#worker || !this.#active) return;
    const active = this.#active;
    if (isRecordWithExecutionId(data) && data.executionId !== active.executionId) return;
    if (isPdfConversionWorkerProgress(data)) {
      if (
        data.pageTotal !== active.request.settings.pages.length ||
        data.pageNumber !== active.request.settings.pages[data.pageIndex]
      ) {
        this.#finish(active.executionId, failure(active.request.jobId, "invalid-message"), true);
        return;
      }
      try {
        active.onProgress?.(Object.freeze({ ...data }));
      } catch {
        // Progress consumers cannot strand worker ownership.
      }
      return;
    }
    if (!isPdfConversionWorkerResult(data, this.#limits)) {
      this.#finish(active.executionId, failure(active.request.jobId, "invalid-message"), true);
      return;
    }
    if (data.executionId !== active.executionId) return;
    if (
      data.outcome.ok &&
      (data.outcome.result.pages.map(({ pageNumber }) => pageNumber).join(",") !==
        active.request.settings.pages.join(",") ||
        data.outcome.result.pages.some(
          (page) => page.ok && page.result.format !== active.request.settings.raster.output,
        ))
    ) {
      this.#finish(active.executionId, failure(active.request.jobId, "output-mismatch"), true);
      return;
    }
    this.#finish(active.executionId, freezeOutcome(data.outcome), false);
  }

  #onFailure(worker: PdfConversionWorkerLike, reason: "error-event" | "message-error"): void {
    const active = this.#active;
    if (worker !== this.#worker || !active) return;
    this.#finish(active.executionId, failure(active.request.jobId, reason), true);
  }

  #finish(executionId: string, outcome: PdfConversionOutcome, recycle: boolean): void {
    const active = this.#active;
    if (!active || active.executionId !== executionId) return;
    if (active.timeout !== undefined) clearTimeout(active.timeout);
    this.#active = undefined;
    if (recycle) this.#recycleWorker();
    active.resolve(outcome);
  }

  #recycleWorker(): void {
    const worker = this.#worker;
    this.#worker = undefined;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    try {
      worker.terminate();
    } catch {
      // A non-standard terminate failure cannot retain scheduler ownership.
    }
  }
}

function isRecordWithExecutionId(value: unknown): value is { executionId: unknown } {
  return typeof value === "object" && value !== null && "executionId" in value;
}
