import { WEB_V1_DESKTOP_LIMITS } from "@imgconvert/conversion-contract";
import { describe, expect, it, vi } from "vitest";

import {
  BATCH_FAILURE_MANIFEST_NAME,
  createBatchExportPlan,
  reserveUniqueBatchFileName,
  sanitizeBatchFileName,
  serializeFailureManifest,
  type BatchExportArtifact,
} from "../src/lib/batch-export";
import {
  assertArchiveRequest,
  type ArchiveOutcome,
  type ArchiveWorkerCommand,
} from "@imgconvert/web-conversion-runtime";
import { ArchiveScheduler, type ArchiveWorkerLike } from "@imgconvert/web-conversion-runtime";
import {
  DirectoryExportError,
  writeBatchToDirectory,
  type DirectoryFileHandle,
  type DirectoryHandle,
  type DirectoryWritable,
} from "../src/lib/directory-export";
import type { QueueConversionResult, QueueEntry } from "../src/lib/queue";

function result(name: string, content = name): QueueConversionResult {
  const blob = new Blob([content], { type: "image/png" });
  return {
    blob,
    downloaded: false,
    durationMs: 1,
    format: "png",
    height: 1,
    name,
    previewUrl: "blob:test",
    settings: {
      background: { blue: 255, green: 255, red: 255 },
      lossless: true,
      metadata: "stripAll",
      output: "png",
      quality: null,
      resize: null,
    },
    size: blob.size,
    width: 1,
  };
}

function entry(name: string, output?: QueueConversionResult): QueueEntry {
  return {
    file: {} as File,
    id: name,
    name,
    previewUrl: "blob:input",
    ...(output ? { result: output } : {}),
    size: 1,
    state: output ? "done" : "failed",
  };
}

describe("batch export planning", () => {
  it("sanitizes portable names and resolves case-insensitive collisions", () => {
    expect(sanitizeBatchFileName("../../CON.png")).toBe("_CON.png");
    expect(sanitizeBatchFileName("\u202eevil/../photo.png")).toBe("evil-photo.png");
    const used = new Set<string>();
    expect(reserveUniqueBatchFileName("Photo.png", used)).toBe("Photo.png");
    expect(reserveUniqueBatchFileName("photo.png", used)).toBe("photo (2).png");
  });

  it("keeps successful files and adds a bounded structured partial-failure manifest", async () => {
    const first = entry("folder/first.png", result("same.png", "first"));
    const second = entry("second.png", result("SAME.png", "second"));
    const rejected = entry("unsafe.svg");
    rejected.failure = { code: "unsafe-svg", params: {} };
    const plan = createBatchExportPlan([first, second, rejected]);

    expect(plan.outputCount).toBe(2);
    expect(plan.failureCount).toBe(1);
    expect(plan.artifacts.map(({ name }) => name)).toEqual([
      "same.png",
      "SAME (2).png",
      BATCH_FAILURE_MANIFEST_NAME,
    ]);
    const manifest = plan.artifacts.at(-1);
    expect(JSON.parse((await manifest?.blob.text()) ?? "{}")).toMatchObject({
      failedCount: 1,
      failures: [{ code: "unsafe-svg", sourceName: "unsafe.svg" }],
      schemaVersion: 1,
      status: "partial",
    });
    expect(plan.archiveAllowed).toBe(true);
  });

  it("bounds and de-spoofs source names included in the failure manifest", async () => {
    const manifest = serializeFailureManifest([
      { code: "read-failed", sourceName: "x".repeat(1024) },
    ]);
    expect(new TextEncoder().encode(manifest).byteLength).toBeLessThan(16 * 1024 * 1024);

    const unsafeName = entry("photo\u202egnp.exe");
    unsafeName.failure = { code: "read-failed", params: {} };
    const safeManifest = createBatchExportPlan([unsafeName]).artifacts[0];
    if (!safeManifest) throw new Error("Failure manifest was not generated.");
    await expect(safeManifest.blob.text()).resolves.not.toContain("\u202e");
  });

  it("disables the fallback archive before an estimated batch crosses 256 MiB", () => {
    const output = result("large.png");
    Object.defineProperty(output.blob, "size", {
      configurable: true,
      value: WEB_V1_DESKTOP_LIMITS.maxFallbackArchiveBytes,
    });
    const plan = createBatchExportPlan([entry("large.png", output)]);
    expect(plan.archiveAllowed).toBe(false);
  });
});

describe("archive protocol and scheduler", () => {
  it("rejects path names, duplicate names, and oversized sources", () => {
    expect(() =>
      assertArchiveRequest({
        files: [{ blob: new Blob(["x"]), name: "../x.png" }],
        maxBytes: 100,
      }),
    ).toThrow(/entry/u);
    expect(() =>
      assertArchiveRequest({
        files: [
          { blob: new Blob(["a"]), name: "A.png" },
          { blob: new Blob(["b"]), name: "a.png" },
        ],
        maxBytes: 100,
      }),
    ).toThrow(/unique/u);
    expect(() =>
      assertArchiveRequest({
        files: [{ blob: new Blob(["too large"]), name: "x.png" }],
        maxBytes: 1,
      }),
    ).toThrow(/source bytes/u);
  });

  it("accepts only matching progress and result messages and recycles malformed workers", async () => {
    const worker = new FakeArchiveWorker();
    const progress = vi.fn();
    const scheduler = new ArchiveScheduler({ workerFactory: () => worker });
    const handle = scheduler.enqueue(
      "archive-1",
      { files: [{ blob: new Blob(["x"]), name: "x.png" }], maxBytes: 1024 },
      progress,
    );
    await Promise.resolve();
    worker.progress(1, 1);
    worker.respond({
      archive: new Blob(["PK\u0003\u0004"], { type: "application/zip" }),
      entryCount: 1,
      ok: true,
    });
    await expect(handle.outcome).resolves.toMatchObject({ entryCount: 1, ok: true });
    expect(progress).toHaveBeenCalledOnce();
    scheduler.dispose();

    const invalidWorker = new FakeArchiveWorker();
    const invalidScheduler = new ArchiveScheduler({ workerFactory: () => invalidWorker });
    const invalidHandle = invalidScheduler.enqueue("archive-2", {
      files: [{ blob: new Blob(["x"]), name: "x.png" }],
      maxBytes: 1024,
    });
    await Promise.resolve();
    invalidWorker.progress(1, 2);
    await expect(invalidHandle.outcome).resolves.toEqual({ ok: false, reason: "invalid-message" });
    expect(invalidWorker.terminated).toBe(true);
    invalidScheduler.dispose();

    const corruptWorker = new FakeArchiveWorker();
    const corruptScheduler = new ArchiveScheduler({ workerFactory: () => corruptWorker });
    const corruptHandle = corruptScheduler.enqueue("archive-3", {
      files: [{ blob: new Blob(["x"]), name: "x.png" }],
      maxBytes: 1024,
    });
    await Promise.resolve();
    corruptWorker.progress(1, 1);
    corruptWorker.respond({
      archive: new Blob(["not a zip"], { type: "application/zip" }),
      entryCount: 1,
      ok: true,
    });
    await expect(corruptHandle.outcome).resolves.toEqual({
      ok: false,
      reason: "invalid-message",
    });
    expect(corruptWorker.terminated).toBe(true);
    corruptScheduler.dispose();
  });

  it("cancels by terminating the active archive worker", async () => {
    const worker = new FakeArchiveWorker();
    const scheduler = new ArchiveScheduler({ workerFactory: () => worker });
    const handle = scheduler.enqueue("archive-cancel", {
      files: [{ blob: new Blob(["x"]), name: "x.png" }],
      maxBytes: WEB_V1_DESKTOP_LIMITS.maxFallbackArchiveBytes,
    });
    await Promise.resolve();
    expect(handle.cancel()).toBe(true);
    await expect(handle.outcome).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(worker.terminated).toBe(true);
    scheduler.dispose();
  });

  it("recycles a completed archive worker after its idle lifetime", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeArchiveWorker();
      const scheduler = new ArchiveScheduler({
        idleTimeoutMs: 25,
        workerFactory: () => worker,
      });
      const handle = scheduler.enqueue("archive-idle", {
        files: [{ blob: new Blob(["x"]), name: "x.png" }],
        maxBytes: 1024,
      });
      await Promise.resolve();
      worker.progress(1, 1);
      worker.respond({
        archive: new Blob(["PK\u0003\u0004"], { type: "application/zip" }),
        entryCount: 1,
        ok: true,
      });
      await handle.outcome;
      await vi.advanceTimersByTimeAsync(25);
      expect(worker.terminated).toBe(true);
      scheduler.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

class FakeArchiveWorker implements ArchiveWorkerLike {
  messages: ArchiveWorkerCommand[] = [];
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  terminated = false;

  postMessage(message: ArchiveWorkerCommand): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  progress(completed: number, total: number): void {
    const command = this.messages[0];
    if (!command) throw new Error("No archive command.");
    this.onmessage?.({
      data: {
        completed,
        executionId: command.executionId,
        schemaVersion: 1,
        total,
        type: "archive-progress",
      },
    } as MessageEvent<unknown>);
  }

  respond(outcome: ArchiveOutcome): void {
    const command = this.messages[0];
    if (!command) throw new Error("No archive command.");
    this.onmessage?.({
      data: {
        executionId: command.executionId,
        outcome,
        schemaVersion: 1,
        type: "archive-result",
      },
    } as MessageEvent<unknown>);
  }
}

class MemoryWritable implements DirectoryWritable {
  aborted = false;
  closed = false;
  value: Blob | undefined;

  async abort(): Promise<void> {
    this.aborted = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async write(data: Blob): Promise<void> {
    this.value = data;
  }
}

class MemoryDirectory implements DirectoryHandle {
  readonly files = new Map<string, MemoryWritable>();
  failOnCreate: string | undefined;

  async getFileHandle(
    name: string,
    options?: Readonly<{ create?: boolean }>,
  ): Promise<DirectoryFileHandle> {
    if (name === this.failOnCreate && options?.create)
      throw new DOMException("denied", "NotAllowedError");
    const existing = this.files.get(name);
    if (!existing && !options?.create) throw new DOMException("missing", "NotFoundError");
    const writable = existing ?? new MemoryWritable();
    if (!existing) this.files.set(name, writable);
    return { createWritable: async () => writable };
  }
}

describe("directory export", () => {
  const artifacts: BatchExportArtifact[] = [
    { blob: new Blob(["one"]), name: "photo.png" },
    { blob: new Blob(["two"]), name: "other.png" },
  ];

  it("avoids existing files and reports serial progress", async () => {
    const directory = new MemoryDirectory();
    directory.files.set("photo.png", new MemoryWritable());
    const progress = vi.fn();
    const names = await writeBatchToDirectory(
      directory,
      artifacts,
      new AbortController().signal,
      progress,
    );

    expect(names).toEqual(["photo (2).png", "other.png"]);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(directory.files.get("photo (2).png")?.closed).toBe(true);
  });

  it("reports the number of completed files when a later write fails", async () => {
    const directory = new MemoryDirectory();
    directory.failOnCreate = "other.png";
    const error = await writeBatchToDirectory(
      directory,
      artifacts,
      new AbortController().signal,
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DirectoryExportError);
    expect(error).toMatchObject({
      name: "DirectoryExportError",
      writtenArtifactCount: 1,
    });
  });

  it("stops before writing when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      writeBatchToDirectory(new MemoryDirectory(), artifacts, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects unsafe artifacts before creating any directory file", async () => {
    const directory = new MemoryDirectory();
    await expect(
      writeBatchToDirectory(
        directory,
        [{ blob: new Blob(["x"]), name: "../unsafe.png" }],
        new AbortController().signal,
      ),
    ).rejects.toThrow(/safe, unique/u);
    expect(directory.files.size).toBe(0);
  });
});
