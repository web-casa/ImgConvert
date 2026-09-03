import {
  WEB_V1_DESKTOP_LIMITS,
  assertConversionRequest,
  createConversionFailure,
  createResourceLimits,
  type ConversionOutcome,
  type ConversionRequest,
  type ResourceLimits,
} from "@imgconvert/conversion-contract";

import {
  isConversionWorkerProgress,
  isConversionWorkerResult,
  type ConversionWorkerProgress,
  type ConversionWorkerCommand,
  type ConversionWorkerResult,
} from "./worker-protocol.js";

export interface ConversionWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: ConversionWorkerCommand, transfer: Transferable[]): void;
  terminate(): void;
}

export interface ConversionJobHandle {
  readonly jobId: string;
  readonly outcome: Promise<ConversionOutcome>;
  cancel(): boolean;
}

export interface ConversionSchedulerSnapshot {
  readonly activeJobId: string | null;
  readonly disposed: boolean;
  readonly queuedJobIds: readonly string[];
  readonly workerGeneration: number;
}

export interface ConversionSchedulerOptions {
  readonly limits?: ResourceLimits;
  readonly maxQueueFiles?: number;
  readonly timeoutMs?: number;
  readonly workerFactory: () => ConversionWorkerLike;
}

interface PendingJob {
  readonly onProgress: ((progress: ConversionWorkerProgress) => void) | undefined;
  readonly request: ConversionRequest;
  readonly resolve: (outcome: ConversionOutcome) => void;
}

interface ActiveJob extends PendingJob {
  readonly executionId: string;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

interface WorkerSlot {
  readonly generation: number;
  readonly worker: ConversionWorkerLike;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function cancelledOutcome(jobId: string): ConversionOutcome {
  return Object.freeze({
    failure: createConversionFailure("cancelled", true, { jobId }),
    ok: false,
  });
}

function workerFailure(
  jobId: string,
  reason:
    | "error-event"
    | "invalid-message"
    | "message-error"
    | "output-mismatch"
    | "post-message"
    | "startup"
    | "timeout",
  timeoutMs?: number,
): ConversionOutcome {
  return Object.freeze({
    failure: createConversionFailure("worker-failed", true, {
      jobId,
      reason,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
    ok: false,
  });
}

function freezeWorkerOutcome(message: ConversionWorkerResult): ConversionOutcome {
  if (!message.outcome.ok) {
    return Object.freeze({
      failure: createConversionFailure(
        message.outcome.failure.code,
        message.outcome.failure.recoverable,
        message.outcome.failure.params,
      ),
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    result: Object.freeze({ ...message.outcome.result }),
  });
}

function takeRequestOwnership(request: ConversionRequest): ConversionRequest {
  const bytes = structuredClone(request.input.bytes, { transfer: [request.input.bytes] });
  return Object.freeze({
    input: Object.freeze({
      bytes,
      name: request.input.name,
      probe: Object.freeze({
        ...request.input.probe,
        metadata: Object.freeze({ ...request.input.probe.metadata }),
      }),
    }),
    jobId: request.jobId,
    schemaVersion: 1,
    settings: Object.freeze({
      ...request.settings,
      background: Object.freeze({ ...request.settings.background }),
      resize:
        request.settings.resize === null ? null : Object.freeze({ ...request.settings.resize }),
    }),
  });
}

export class SerialConversionScheduler {
  readonly #limits: ResourceLimits;
  readonly #liveJobIds = new Set<string>();
  readonly #maxQueueFiles: number;
  readonly #queue: PendingJob[] = [];
  readonly #timeoutMs: number;
  readonly #workerFactory: () => ConversionWorkerLike;
  #active: ActiveJob | undefined;
  #disposed = false;
  #executionSequence = 0;
  #pumpScheduled = false;
  #workerGeneration = 0;
  #workerSlot: WorkerSlot | undefined;

  constructor(options: ConversionSchedulerOptions) {
    if (typeof options.workerFactory !== "function") {
      throw new TypeError("workerFactory must be a function.");
    }
    this.#limits = createResourceLimits(options.limits ?? WEB_V1_DESKTOP_LIMITS);
    this.#maxQueueFiles = options.maxQueueFiles ?? this.#limits.maxQueueFiles;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#maxQueueFiles) || this.#maxQueueFiles < 1) {
      throw new RangeError("maxQueueFiles must be a positive safe integer.");
    }
    if (this.#maxQueueFiles > this.#limits.maxQueueFiles) {
      throw new RangeError("maxQueueFiles cannot exceed limits.maxQueueFiles.");
    }
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 1 ||
      this.#timeoutMs > 2_147_483_647
    ) {
      throw new RangeError("timeoutMs must be an integer from 1 to 2147483647 milliseconds.");
    }
    this.#workerFactory = options.workerFactory;
  }

  enqueue(
    request: ConversionRequest,
    onProgress?: (progress: ConversionWorkerProgress) => void,
  ): ConversionJobHandle {
    if (this.#disposed) throw new Error("Conversion scheduler has been disposed.");
    assertConversionRequest(request, this.#limits);
    if (this.#liveJobIds.has(request.jobId)) {
      throw new Error(`Conversion job ${request.jobId} is already queued or active.`);
    }
    if (this.#liveJobIds.size >= this.#maxQueueFiles) {
      throw new RangeError("Conversion queue has reached its file limit.");
    }
    const ownedRequest = takeRequestOwnership(request);

    let resolveOutcome: ((outcome: ConversionOutcome) => void) | undefined;
    const outcome = new Promise<ConversionOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    if (!resolveOutcome) throw new Error("Failed to create conversion job promise.");
    const pending: PendingJob = { onProgress, request: ownedRequest, resolve: resolveOutcome };
    this.#liveJobIds.add(ownedRequest.jobId);
    this.#queue.push(pending);
    this.#schedulePump();
    return Object.freeze({
      cancel: () => this.cancel(ownedRequest.jobId),
      jobId: ownedRequest.jobId,
      outcome,
    });
  }

  cancel(jobId: string): boolean {
    const queuedIndex = this.#queue.findIndex((pending) => pending.request.jobId === jobId);
    if (queuedIndex >= 0) {
      const [pending] = this.#queue.splice(queuedIndex, 1);
      if (!pending) return false;
      this.#liveJobIds.delete(jobId);
      pending.resolve(cancelledOutcome(jobId));
      return true;
    }
    if (this.#active?.request.jobId === jobId && this.#workerSlot) {
      this.#finishActive(this.#workerSlot, this.#active.executionId, cancelledOutcome(jobId), true);
      return true;
    }
    return false;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const active = this.#active;
    const slot = this.#workerSlot;
    if (active && slot) {
      this.#finishActive(slot, active.executionId, cancelledOutcome(active.request.jobId), true);
    } else if (slot) {
      this.#recycleWorker(slot);
    }
    for (const pending of this.#queue.splice(0)) {
      this.#liveJobIds.delete(pending.request.jobId);
      pending.resolve(cancelledOutcome(pending.request.jobId));
    }
  }

  snapshot(): ConversionSchedulerSnapshot {
    return Object.freeze({
      activeJobId: this.#active?.request.jobId ?? null,
      disposed: this.#disposed,
      queuedJobIds: Object.freeze(this.#queue.map(({ request }) => request.jobId)),
      workerGeneration: this.#workerGeneration,
    });
  }

  #createWorker(): WorkerSlot {
    const worker = this.#workerFactory();
    if (
      !worker ||
      typeof worker.postMessage !== "function" ||
      typeof worker.terminate !== "function"
    ) {
      throw new TypeError("workerFactory returned an invalid worker.");
    }
    const slot: WorkerSlot = {
      generation: (this.#workerGeneration += 1),
      worker,
    };
    try {
      worker.onmessage = (event) => this.#onWorkerMessage(slot, event.data);
      worker.onerror = () => this.#onWorkerFailure(slot, "error-event");
      worker.onmessageerror = () => this.#onWorkerFailure(slot, "message-error");
    } catch (error) {
      try {
        worker.terminate();
      } catch {
        // Preserve the original startup error.
      }
      throw error;
    }
    this.#workerSlot = slot;
    return slot;
  }

  #finishActive(
    slot: WorkerSlot,
    executionId: string,
    outcome: ConversionOutcome,
    recycleWorker: boolean,
  ): void {
    const active = this.#active;
    if (this.#workerSlot !== slot || !active || active.executionId !== executionId) return;
    if (active.timeout !== undefined) clearTimeout(active.timeout);
    this.#active = undefined;
    this.#liveJobIds.delete(active.request.jobId);
    if (recycleWorker) this.#recycleWorker(slot);
    active.resolve(outcome);
    this.#schedulePump();
  }

  #onWorkerFailure(slot: WorkerSlot, reason: "error-event" | "message-error"): void {
    if (this.#workerSlot !== slot) return;
    const active = this.#active;
    if (!active) {
      this.#recycleWorker(slot);
      return;
    }
    this.#finishActive(slot, active.executionId, workerFailure(active.request.jobId, reason), true);
  }

  #onWorkerMessage(slot: WorkerSlot, data: unknown): void {
    if (this.#workerSlot !== slot) return;
    const active = this.#active;
    if (!active) return;
    if (
      typeof data === "object" &&
      data !== null &&
      "executionId" in data &&
      data.executionId !== active.executionId
    ) {
      return;
    }
    if (isConversionWorkerProgress(data)) {
      try {
        active.onProgress?.(Object.freeze({ ...data }));
      } catch {
        // Consumer progress callbacks cannot break scheduler ownership or strand the active job.
      }
      return;
    }
    if (!isConversionWorkerResult(data, this.#limits)) {
      this.#finishActive(
        slot,
        active.executionId,
        workerFailure(active.request.jobId, "invalid-message"),
        true,
      );
      return;
    }
    if (data.outcome.ok && data.outcome.result.format !== active.request.settings.output) {
      this.#finishActive(
        slot,
        active.executionId,
        workerFailure(active.request.jobId, "output-mismatch"),
        true,
      );
      return;
    }
    this.#finishActive(slot, active.executionId, freezeWorkerOutcome(data), false);
  }

  #pump(): void {
    if (this.#disposed || this.#active) return;
    const pending = this.#queue.shift();
    if (!pending) return;

    let slot: WorkerSlot;
    try {
      slot = this.#workerSlot ?? this.#createWorker();
    } catch {
      this.#liveJobIds.delete(pending.request.jobId);
      pending.resolve(workerFailure(pending.request.jobId, "startup"));
      this.#schedulePump();
      return;
    }

    const executionId = `${pending.request.jobId}:${(this.#executionSequence += 1)}`;
    const active: ActiveJob = { ...pending, executionId, timeout: undefined };
    this.#active = active;
    const command: ConversionWorkerCommand = {
      executionId,
      request: pending.request,
      schemaVersion: 1,
      type: "convert",
    };
    try {
      slot.worker.postMessage(command, [pending.request.input.bytes]);
    } catch {
      this.#finishActive(
        slot,
        executionId,
        workerFailure(pending.request.jobId, "post-message"),
        true,
      );
      return;
    }
    if (this.#active === active) {
      active.timeout = setTimeout(() => {
        this.#finishActive(
          slot,
          executionId,
          workerFailure(pending.request.jobId, "timeout", this.#timeoutMs),
          true,
        );
      }, this.#timeoutMs);
    }
  }

  #recycleWorker(slot: WorkerSlot): void {
    if (this.#workerSlot !== slot) return;
    this.#workerSlot = undefined;
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.onmessageerror = null;
    try {
      slot.worker.terminate();
    } catch {
      // The slot is already detached; a non-standard terminate failure must not strand the queue.
    }
  }

  #schedulePump(): void {
    if (this.#disposed || this.#pumpScheduled) return;
    this.#pumpScheduled = true;
    queueMicrotask(() => {
      this.#pumpScheduled = false;
      this.#pump();
    });
  }
}
