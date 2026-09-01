// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { CoalescingWriter } from "../src/lib/coalescing-writer";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("CoalescingWriter", () => {
  it("serializes writes and keeps only the newest queued snapshot", async () => {
    const first = deferred();
    const writes: number[] = [];
    const write = vi.fn(async (value: number) => {
      writes.push(value);
      if (value === 1) await first.promise;
    });
    const writer = new CoalescingWriter(write);

    const initial = writer.enqueue(1);
    const middle = writer.enqueue(2);
    const latest = writer.enqueue(3);
    expect(writes).toEqual([1]);
    expect(writer.busy).toBe(true);

    first.resolve();
    await Promise.all([initial, middle, latest]);

    expect(writes).toEqual([1, 3]);
    expect(writer.busy).toBe(false);
  });

  it("surfaces a failed write and can retry on the next enqueue", async () => {
    const write = vi
      .fn<(value: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const writer = new CoalescingWriter(write);

    await expect(writer.enqueue(1)).rejects.toThrow("disk full");
    await expect(writer.enqueue(2)).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("drains a newer snapshot queued while an older write fails", async () => {
    const first = deferred();
    const writes: number[] = [];
    const write = vi.fn(async (value: number) => {
      writes.push(value);
      if (value === 1) await first.promise;
    });
    const writer = new CoalescingWriter(write);

    const initial = writer.enqueue(1);
    const latest = writer.enqueue(2);
    first.reject(new Error("transient failure"));

    await expect(initial).resolves.toBeUndefined();
    await expect(latest).resolves.toBeUndefined();
    expect(writes).toEqual([1, 2]);
    expect(writer.busy).toBe(false);
  });
});
