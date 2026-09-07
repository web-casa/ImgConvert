// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";

import { createPendingImageImport } from "./descriptor";
import {
  isPendingImportStorageKey,
  pendingImportStorageKey,
  storePendingImageImport,
  takePendingImageImport,
} from "./pending-storage";

const NOW = 1_800_000_000_000;
const descriptor = createPendingImageImport({
  documentUrl: "https://photos.example.net/",
  nonce: "123e4567-e89b-42d3-a456-426614174000",
  now: NOW,
  sourceUrl: "https://cdn.example.net/image.png",
});

function storageFixture() {
  const values: Record<string, unknown> = {};
  return {
    api: {
      get: vi.fn(async (key: string) => (key in values ? { [key]: values[key] } : {})),
      remove: vi.fn(async (key: string) => {
        delete values[key];
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(values, items);
      }),
    },
    values,
  };
}

describe("pending import session storage", () => {
  it("uses bounded per-window keys", () => {
    expect(pendingImportStorageKey(0)).toBe("imgconvert.pendingImport.0");
    expect(pendingImportStorageKey(undefined)).toBe("imgconvert.pendingImport.current");
    expect(isPendingImportStorageKey("imgconvert.pendingImport.42")).toBe(true);
    expect(isPendingImportStorageKey("imgconvert.pendingImport.-1")).toBe(false);
    expect(isPendingImportStorageKey("imgconvert.preferences")).toBe(false);
  });

  it("stores and destructively consumes a valid descriptor", async () => {
    const fixture = storageFixture();
    await storePendingImageImport(fixture.api, 7, descriptor);

    await expect(takePendingImageImport(fixture.api, 7, NOW)).resolves.toEqual(descriptor);
    await expect(takePendingImageImport(fixture.api, 7, NOW)).resolves.toBeUndefined();
    expect(fixture.values).toEqual({});
  });

  it("serializes simultaneous claims so only one receives the descriptor", async () => {
    const fixture = storageFixture();
    await storePendingImageImport(fixture.api, 9, descriptor);

    const claims = await Promise.all([
      takePendingImageImport(fixture.api, 9, NOW),
      takePendingImageImport(fixture.api, 9, NOW),
    ]);
    expect(claims.filter(Boolean)).toEqual([descriptor]);
  });

  it("does not disclose a descriptor if destructive removal fails", async () => {
    const fixture = storageFixture();
    await storePendingImageImport(fixture.api, 3, descriptor);
    fixture.api.remove.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(takePendingImageImport(fixture.api, 3, NOW)).rejects.toThrow(
      "storage unavailable",
    );
  });
});
