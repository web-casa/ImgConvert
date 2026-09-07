import {
  ARCHIVE_SCHEMA_VERSION,
  assertArchiveRequest,
  isArchiveWorkerProgress,
  isArchiveWorkerResult,
  type ArchiveOutcome,
  type ArchiveRequest,
  type ArchiveWorkerCommand,
  type ArchiveWorkerProgress,
} from "./archive-protocol.js";

export interface ArchiveWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: ArchiveWorkerCommand): void;
  terminate(): void;
}

export interface ArchiveJobHandle {
  readonly jobId: string;
  readonly outcome: Promise<ArchiveOutcome>;
  cancel(): boolean;
}

export interface ArchiveSchedulerOptions {
  readonly idleTimeoutMs?: number;
  readonly timeoutMs?: number;
  readonly workerFactory: () => ArchiveWorkerLike;
}

interface ActiveArchiveJob {
  completed: number;
  readonly executionId: string;
  readonly jobId: string;
  readonly onProgress: ((progress: ArchiveWorkerProgress) => void) | undefined;
  readonly request: ArchiveRequest;
  readonly resolve: (outcome: ArchiveOutcome) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_ARCHIVE_TIMEOUT_MS = 300_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

function failure(reason: "cancelled" | "invalid-message" | "worker-failed"): ArchiveOutcome {
  return Object.freeze({ ok: false, reason });
}

function isRecordWithExecutionId(value: unknown): value is { executionId: unknown } {
  return typeof value === "object" && value !== null && "executionId" in value;
}

export class ArchiveScheduler {
  readonly #idleTimeoutMs: number;
  readonly #timeoutMs: number;
  readonly #workerFactory: () => ArchiveWorkerLike;
  #active: ActiveArchiveJob | undefined;
  #disposed = false;
  #executionSequence = 0;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #worker: ArchiveWorkerLike | undefined;

  constructor(options: ArchiveSchedulerOptions) {
    if (typeof options.workerFactory !== "function") {
      throw new TypeError("workerFactory must be a function.");
    }
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_ARCHIVE_TIMEOUT_MS;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 1 ||
      this.#timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new RangeError(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}.`);
    }
    if (
      !Number.isSafeInteger(this.#idleTimeoutMs) ||
      this.#idleTimeoutMs < 1 ||
      this.#idleTimeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new RangeError(`idleTimeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}.`);
    }
    this.#workerFactory = options.workerFactory;
  }

  enqueue(
    jobId: string,
    request: ArchiveRequest,
    onProgress?: (progress: ArchiveWorkerProgress) => void,
  ): ArchiveJobHandle {
    if (this.#disposed) throw new Error("Archive scheduler has been disposed.");
    this.#clearIdleTimer();
    if (this.#active) throw new Error("Archive scheduler already has an active job.");
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(jobId)) throw new TypeError("Archive jobId is invalid.");
    assertArchiveRequest(request);
    const ownedRequest: ArchiveRequest = Object.freeze({
      files: Object.freeze(request.files.map((file) => Object.freeze({ ...file }))),
      maxBytes: request.maxBytes,
    });
    let resolveOutcome: (outcome: ArchiveOutcome) => void = () => {
      throw new Error("Archive outcome resolver was not initialized.");
    };
    const outcome = new Promise<ArchiveOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    const executionId = `${jobId}:${(this.#executionSequence += 1)}`;
    this.#active = {
      completed: 0,
      executionId,
      jobId,
      onProgress,
      request: ownedRequest,
      resolve: resolveOutcome,
      timeout: undefined,
    };
    queueMicrotask(() => this.#start(executionId));
    return Object.freeze({ cancel: () => this.cancel(jobId), jobId, outcome });
  }

  cancel(jobId: string): boolean {
    const active = this.#active;
    if (!active || active.jobId !== jobId) return false;
    this.#finish(active.executionId, failure("cancelled"), true);
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearIdleTimer();
    const active = this.#active;
    if (active) this.#finish(active.executionId, failure("cancelled"), true);
    else this.#recycleWorker();
  }

  #createWorker(): ArchiveWorkerLike {
    const worker = this.#workerFactory();
    if (
      !worker ||
      typeof worker.postMessage !== "function" ||
      typeof worker.terminate !== "function"
    ) {
      throw new TypeError("workerFactory returned an invalid archive worker.");
    }
    worker.onmessage = (event) => void this.#onMessage(worker, event.data);
    worker.onerror = () => this.#onFailure(worker);
    worker.onmessageerror = () => this.#onFailure(worker);
    this.#worker = worker;
    return worker;
  }

  #start(executionId: string): void {
    const active = this.#active;
    if (!active || active.executionId !== executionId || this.#disposed) return;
    let worker: ArchiveWorkerLike;
    try {
      worker = this.#worker ?? this.#createWorker();
      worker.postMessage({
        executionId,
        request: active.request,
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        type: "create-archive",
      });
    } catch {
      this.#finish(executionId, failure("worker-failed"), true);
      return;
    }
    if (this.#active === active) {
      active.timeout = setTimeout(
        () => this.#finish(executionId, failure("worker-failed"), true),
        this.#timeoutMs,
      );
    }
  }

  async #onMessage(worker: ArchiveWorkerLike, data: unknown): Promise<void> {
    const active = this.#active;
    if (worker !== this.#worker || !active) return;
    if (isRecordWithExecutionId(data) && data.executionId !== active.executionId) return;
    if (isArchiveWorkerProgress(data)) {
      if (data.total !== active.request.files.length || data.completed !== active.completed + 1) {
        this.#finish(active.executionId, failure("invalid-message"), true);
        return;
      }
      active.completed = data.completed;
      try {
        active.onProgress?.(Object.freeze({ ...data }));
      } catch {
        // A progress consumer cannot retain worker ownership.
      }
      return;
    }
    if (!isArchiveWorkerResult(data)) {
      this.#finish(active.executionId, failure("invalid-message"), true);
      return;
    }
    if (data.executionId !== active.executionId) return;
    if (
      data.outcome.ok &&
      (active.completed !== active.request.files.length ||
        data.outcome.entryCount !== active.request.files.length ||
        data.outcome.archive.size > active.request.maxBytes)
    ) {
      this.#finish(active.executionId, failure("invalid-message"), true);
      return;
    }
    if (data.outcome.ok) {
      const magic = new Uint8Array(await data.outcome.archive.slice(0, 4).arrayBuffer());
      if (this.#active !== active) return;
      if (magic[0] !== 0x50 || magic[1] !== 0x4b || magic[2] !== 0x03 || magic[3] !== 0x04) {
        this.#finish(active.executionId, failure("invalid-message"), true);
        return;
      }
    }
    this.#finish(active.executionId, data.outcome, !data.outcome.ok);
  }

  #onFailure(worker: ArchiveWorkerLike): void {
    const active = this.#active;
    if (worker !== this.#worker || !active) return;
    this.#finish(active.executionId, failure("worker-failed"), true);
  }

  #finish(executionId: string, outcome: ArchiveOutcome, recycle: boolean): void {
    const active = this.#active;
    if (!active || active.executionId !== executionId) return;
    if (active.timeout !== undefined) clearTimeout(active.timeout);
    this.#active = undefined;
    if (recycle) this.#recycleWorker();
    active.resolve(outcome);
    if (!recycle) this.#scheduleIdleRecycle();
  }

  #recycleWorker(): void {
    this.#clearIdleTimer();
    const worker = this.#worker;
    this.#worker = undefined;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    try {
      worker.terminate();
    } catch {
      // Worker ownership is already released even if a non-standard terminate throws.
    }
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer === undefined) return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }

  #scheduleIdleRecycle(): void {
    this.#clearIdleTimer();
    const worker = this.#worker;
    if (!worker || this.#disposed || this.#active) return;
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      if (!this.#active && this.#worker === worker) this.#recycleWorker();
    }, this.#idleTimeoutMs);
  }
}
