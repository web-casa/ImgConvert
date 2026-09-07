// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import { AsyncOperationLock } from "./operation-lock";

describe("AsyncOperationLock", () => {
  it("runs storage mutations in invocation order", async () => {
    const lock = new AsyncOperationLock();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = lock.run(async () => {
      events.push("save:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("save:end");
    });
    const second = lock.run(async () => {
      events.push("clear");
    });

    await Promise.resolve();
    expect(events).toEqual(["save:start"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(["save:start", "save:end", "clear"]);
  });

  it("releases the next mutation when an operation fails", async () => {
    const lock = new AsyncOperationLock();
    const first = lock.run(async () => {
      throw new Error("write failed");
    });
    const second = lock.run(async () => "clear completed");

    await expect(first).rejects.toThrow("write failed");
    await expect(second).resolves.toBe("clear completed");
  });
});
