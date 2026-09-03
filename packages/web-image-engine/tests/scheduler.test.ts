import {
  createConversionFailure,
  type ConversionOutcome,
  type ConversionRequest,
} from "@imgconvert/conversion-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_RASTER_OUTPUT_BYTES,
  SerialConversionScheduler,
  type ConversionWorkerCommand,
  type ConversionWorkerLike,
} from "../src/index.js";

class FakeWorker implements ConversionWorkerLike {
  readonly messages: ConversionWorkerCommand[] = [];
  readonly transfers: Transferable[][] = [];
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  postError: Error | undefined;
  terminated = false;

  postMessage(message: ConversionWorkerCommand, transfer: Transferable[]): void {
    if (this.postError) throw this.postError;
    this.messages.push(message);
    this.transfers.push(transfer);
  }

  respond(outcome: ConversionOutcome, messageIndex = this.messages.length - 1): void {
    const command = this.messages[messageIndex];
    if (!command) throw new Error("No fake worker command is available.");
    this.emitRaw({
      executionId: command.executionId,
      outcome,
      schemaVersion: 1,
      type: "result",
    });
  }

  emitRaw(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  fail(): void {
    this.onerror?.({} as ErrorEvent);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function makeRequest(jobId: string): ConversionRequest {
  const bytes = new ArrayBuffer(16);
  return {
    input: {
      bytes,
      name: `${jobId}.png`,
      probe: {
        alpha: "present",
        animation: "static",
        byteLength: bytes.byteLength,
        colorProfile: "srgb",
        format: "png",
        height: 1,
        metadata: {
          exif: "absent",
          iptc: "absent",
          orientation: null,
          xmp: "absent",
        },
        width: 1,
      },
    },
    jobId,
    schemaVersion: 1,
    settings: {
      background: { blue: 255, green: 255, red: 255 },
      lossless: true,
      metadata: "stripAll",
      output: "png",
      quality: null,
      resize: null,
    },
  };
}

function success(width = 1, height = 1): ConversionOutcome {
  return {
    ok: true,
    result: {
      bytes: new Uint8Array([137, 80, 78, 71]).buffer,
      durationMs: 5,
      format: "png",
      height,
      width,
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("serial conversion scheduler", () => {
  it("runs exactly one job at a time and reuses a healthy worker", async () => {
    const workers: FakeWorker[] = [];
    const scheduler = new SerialConversionScheduler({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = scheduler.enqueue(makeRequest("first"));
    const second = scheduler.enqueue(makeRequest("second"));

    await flushMicrotasks();
    expect(workers).toHaveLength(1);
    expect(workers[0]?.messages).toHaveLength(1);
    expect(scheduler.snapshot()).toMatchObject({
      activeJobId: "first",
      queuedJobIds: ["second"],
      workerGeneration: 1,
    });
    expect(workers[0]?.transfers[0]).toHaveLength(1);

    workers[0]?.respond(success());
    await expect(first.outcome).resolves.toMatchObject({ ok: true });
    await flushMicrotasks();
    expect(workers[0]?.messages).toHaveLength(2);
    expect(scheduler.snapshot().activeJobId).toBe("second");

    workers[0]?.respond(success(), 1);
    await expect(second.outcome).resolves.toMatchObject({ ok: true });
    expect(workers[0]?.terminated).toBe(false);
    scheduler.dispose();
  });

  it("takes buffer ownership immediately and queues an immutable request snapshot", async () => {
    const worker = new FakeWorker();
    const scheduler = new SerialConversionScheduler({ workerFactory: () => worker });
    const request = makeRequest("owned");
    const callerBuffer = request.input.bytes;
    const handle = scheduler.enqueue(request);

    expect(callerBuffer.byteLength).toBe(0);
    (request.settings as { output: string }).output = "jpeg";
    await flushMicrotasks();
    expect(worker.messages[0]?.request.settings.output).toBe("png");
    expect(Object.isFrozen(worker.messages[0]?.request.settings)).toBe(true);

    worker.respond(success());
    await handle.outcome;
    scheduler.dispose();
  });

  it("cancels queued work without disturbing the active worker", async () => {
    const worker = new FakeWorker();
    const scheduler = new SerialConversionScheduler({ workerFactory: () => worker });
    const active = scheduler.enqueue(makeRequest("active"));
    const queued = scheduler.enqueue(makeRequest("queued"));

    await flushMicrotasks();
    expect(queued.cancel()).toBe(true);
    await expect(queued.outcome).resolves.toMatchObject({
      failure: { code: "cancelled" },
      ok: false,
    });
    expect(worker.terminated).toBe(false);
    expect(worker.messages).toHaveLength(1);

    worker.respond(success());
    await active.outcome;
    scheduler.dispose();
  });

  it("terminates an active worker, replaces it, and ignores stale events", async () => {
    const workers: FakeWorker[] = [];
    const scheduler = new SerialConversionScheduler({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = scheduler.enqueue(makeRequest("first"));
    const second = scheduler.enqueue(makeRequest("second"));
    await flushMicrotasks();

    const staleHandler = workers[0]?.onmessage;
    const staleExecutionId = workers[0]?.messages[0]?.executionId;
    expect(first.cancel()).toBe(true);
    await expect(first.outcome).resolves.toMatchObject({ failure: { code: "cancelled" } });
    await flushMicrotasks();
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);
    expect(scheduler.snapshot().activeJobId).toBe("second");

    staleHandler?.({
      data: {
        executionId: staleExecutionId,
        outcome: success(),
        schemaVersion: 1,
        type: "result",
      },
    } as MessageEvent<unknown>);
    expect(scheduler.snapshot().activeJobId).toBe("second");

    workers[1]?.respond(success());
    await expect(second.outcome).resolves.toMatchObject({ ok: true });
    scheduler.dispose();
  });

  it("times out, recycles the worker, and continues with the next job", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const scheduler = new SerialConversionScheduler({
      timeoutMs: 25,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = scheduler.enqueue(makeRequest("slow"));
    const second = scheduler.enqueue(makeRequest("next"));
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(25);
    await expect(first.outcome).resolves.toMatchObject({
      failure: { code: "worker-failed", params: { reason: "timeout", timeoutMs: 25 } },
      ok: false,
    });
    await flushMicrotasks();
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);

    workers[1]?.respond(success());
    await expect(second.outcome).resolves.toMatchObject({ ok: true });
    scheduler.dispose();
  });

  it("rejects malformed current-worker messages but ignores wrong execution ids", async () => {
    const workers: FakeWorker[] = [];
    const scheduler = new SerialConversionScheduler({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = scheduler.enqueue(makeRequest("first"));
    await flushMicrotasks();
    workers[0]?.emitRaw({
      executionId: "stale:9",
      outcome: success(),
      schemaVersion: 1,
      type: "result",
    });
    expect(scheduler.snapshot().activeJobId).toBe("first");

    const executionId = workers[0]?.messages[0]?.executionId;
    workers[0]?.emitRaw({
      executionId,
      outcome: { ok: true, result: { bytes: "not-an-array-buffer" } },
      schemaVersion: 1,
      type: "result",
    });
    await expect(first.outcome).resolves.toMatchObject({
      failure: { code: "worker-failed", params: { reason: "invalid-message" } },
      ok: false,
    });
    expect(workers[0]?.terminated).toBe(true);
    scheduler.dispose();
  });

  it("rejects worker output that exceeds the bounded result size", async () => {
    const worker = new FakeWorker();
    const scheduler = new SerialConversionScheduler({ workerFactory: () => worker });
    const handle = scheduler.enqueue(makeRequest("oversized-output"));
    await flushMicrotasks();
    worker.respond({
      ok: true,
      result: {
        bytes: new ArrayBuffer(MAX_RASTER_OUTPUT_BYTES + 1),
        durationMs: 1,
        format: "png",
        height: 1,
        width: 1,
      },
    });

    await expect(handle.outcome).resolves.toMatchObject({
      failure: { code: "worker-failed", params: { reason: "invalid-message" } },
      ok: false,
    });
    expect(worker.terminated).toBe(true);
    scheduler.dispose();
  });

  it("rejects a valid-looking result whose format does not match the request", async () => {
    const worker = new FakeWorker();
    const scheduler = new SerialConversionScheduler({ workerFactory: () => worker });
    const handle = scheduler.enqueue(makeRequest("mismatch"));
    await flushMicrotasks();
    worker.respond({
      ok: true,
      result: {
        bytes: Uint8Array.of(0xff, 0xd8).buffer,
        durationMs: 1,
        format: "jpeg",
        height: 1,
        width: 1,
      },
    });

    await expect(handle.outcome).resolves.toMatchObject({
      failure: { code: "worker-failed", params: { reason: "output-mismatch" } },
      ok: false,
    });
    expect(worker.terminated).toBe(true);
    scheduler.dispose();
  });

  it("isolates worker errors, startup failures, and postMessage failures", async () => {
    const workers: FakeWorker[] = [];
    let factoryCall = 0;
    const scheduler = new SerialConversionScheduler({
      workerFactory: () => {
        factoryCall += 1;
        if (factoryCall === 1) throw new Error("startup failed");
        const worker = new FakeWorker();
        if (factoryCall === 2) worker.postError = new Error("post failed");
        workers.push(worker);
        return worker;
      },
    });
    const startup = scheduler.enqueue(makeRequest("startup"));
    const posting = scheduler.enqueue(makeRequest("posting"));
    const eventFailure = scheduler.enqueue(makeRequest("event"));

    await expect(startup.outcome).resolves.toMatchObject({
      failure: { params: { reason: "startup" } },
    });
    await expect(posting.outcome).resolves.toMatchObject({
      failure: { params: { reason: "post-message" } },
    });
    await flushMicrotasks();
    workers[1]?.fail();
    await expect(eventFailure.outcome).resolves.toMatchObject({
      failure: { params: { reason: "error-event" } },
    });
    expect(workers.every(({ terminated }) => terminated)).toBe(true);
    scheduler.dispose();
  });

  it("disposes active and queued jobs as cancelled and rejects new work", async () => {
    const worker = new FakeWorker();
    const scheduler = new SerialConversionScheduler({ workerFactory: () => worker });
    const active = scheduler.enqueue(makeRequest("active"));
    const queued = scheduler.enqueue(makeRequest("queued"));
    await flushMicrotasks();

    scheduler.dispose();
    await expect(active.outcome).resolves.toMatchObject({ failure: { code: "cancelled" } });
    await expect(queued.outcome).resolves.toMatchObject({ failure: { code: "cancelled" } });
    expect(worker.terminated).toBe(true);
    expect(scheduler.snapshot()).toMatchObject({ disposed: true, queuedJobIds: [] });
    expect(() => scheduler.enqueue(makeRequest("late"))).toThrow(/disposed/u);
  });

  it("accepts a validated worker failure without exposing arbitrary objects", async () => {
    const worker = new FakeWorker();
    const scheduler = new SerialConversionScheduler({ workerFactory: () => worker });
    const handle = scheduler.enqueue(makeRequest("decode"));
    await flushMicrotasks();
    worker.respond({
      failure: createConversionFailure("decode-failed", true, { format: "png" }),
      ok: false,
    });
    await expect(handle.outcome).resolves.toMatchObject({
      failure: { code: "decode-failed", params: { format: "png" } },
      ok: false,
    });
    scheduler.dispose();
  });

  it("forwards validated progress without allowing consumer errors to strand the job", async () => {
    const worker = new FakeWorker();
    const scheduler = new SerialConversionScheduler({ workerFactory: () => worker });
    const progress: number[] = [];
    const handle = scheduler.enqueue(makeRequest("progress"), (event) => {
      progress.push(event.progress);
      if (event.progress === 0.5) throw new Error("consumer failed");
    });
    await flushMicrotasks();
    const executionId = worker.messages[0]?.executionId;
    worker.emitRaw({
      executionId,
      phase: "encoding",
      progress: 0.5,
      schemaVersion: 1,
      type: "progress",
    });
    worker.respond(success());

    await expect(handle.outcome).resolves.toMatchObject({ ok: true });
    expect(progress).toEqual([0.5]);
    scheduler.dispose();
  });
});
