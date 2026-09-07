import { describe, expect, it, vi } from "vitest";

import { retryableLazy } from "../src/retryable-lazy.js";

describe("retryable lazy initialization", () => {
  it("shares an in-flight initialization and retains a successful value", async () => {
    const factory = vi.fn(async () => ({ ready: true }));
    const load = retryableLazy(factory);
    const first = load();
    const second = load();
    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ ready: true });
    await expect(load()).resolves.toEqual({ ready: true });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("clears a rejected initialization so a transient failure can recover", async () => {
    const factory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("transient load failure"))
      .mockResolvedValueOnce("ready");
    const load = retryableLazy(factory);
    await expect(load()).rejects.toThrow(/transient/);
    await expect(load()).resolves.toBe("ready");
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
