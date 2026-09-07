// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";

import { clearOwnedTransientSessionState, isOwnedTransientSessionKey } from "./update-cleanup";

describe("extension update cleanup", () => {
  it("recognizes only bounded ImgConvert transient keys", () => {
    expect(isOwnedTransientSessionKey("imgconvert.converterTab.current")).toBe(true);
    expect(isOwnedTransientSessionKey("imgconvert.converterTab.42")).toBe(true);
    expect(isOwnedTransientSessionKey("imgconvert.pendingImport.42")).toBe(true);
    expect(isOwnedTransientSessionKey("imgconvert.pendingImport.-1")).toBe(false);
    expect(isOwnedTransientSessionKey("imgconvert.preferences")).toBe(false);
    expect(isOwnedTransientSessionKey("unrelated.session")).toBe(false);
  });

  it("removes owned handoffs without clearing unrelated session state", async () => {
    const remove = vi.fn(async (_keys: string[]) => undefined);
    const count = await clearOwnedTransientSessionState({
      get: vi.fn(async () => ({
        "imgconvert.converterTab.7": 19,
        "imgconvert.pendingImport.7": { sourceUrl: "https://private.test/image.png" },
        "unrelated.session": "keep",
      })),
      remove,
    });

    expect(count).toBe(2);
    expect(remove).toHaveBeenCalledOnce();
    expect(new Set(remove.mock.calls[0]?.[0])).toEqual(
      new Set(["imgconvert.converterTab.7", "imgconvert.pendingImport.7"]),
    );
  });

  it("does not issue an empty remove operation", async () => {
    const remove = vi.fn(async (_keys: string[]) => undefined);
    await expect(
      clearOwnedTransientSessionState({
        get: vi.fn(async () => ({ "unrelated.session": "keep" })),
        remove,
      }),
    ).resolves.toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });
});
