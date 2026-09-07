// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";

import { createPendingImageImport } from "../web-import/descriptor";
import { pendingImportStorageKey } from "../web-import/pending-storage";
import { claimPendingImportForSender, isTrustedConverterSender } from "./pending-claim";

const NOW = 1_800_000_000_000;
const descriptor = createPendingImageImport({
  documentUrl: "https://photos.example.net/",
  nonce: "123e4567-e89b-42d3-a456-426614174000",
  now: NOW,
  sourceUrl: "https://cdn.example.net/image.png",
});

describe("pending import claim", () => {
  it("trusts only this extension's exact side-panel converter URL", () => {
    const expected = "chrome-extension://extension-id/converter.html?surface=side-panel";
    expect(
      isTrustedConverterSender({ id: "extension-id", url: expected }, "extension-id", expected),
    ).toBe(true);
    expect(
      isTrustedConverterSender(
        { id: "extension-id", url: "chrome-extension://extension-id/converter.html?surface=full" },
        "extension-id",
        expected,
      ),
    ).toBe(false);
    expect(
      isTrustedConverterSender(
        {
          id: "extension-id",
          url: "chrome-extension://extension-id/converter.html?surface=side-panel&extra=true",
        },
        "extension-id",
        expected,
      ),
    ).toBe(false);
    expect(isTrustedConverterSender({ id: "other", url: expected }, "extension-id", expected)).toBe(
      false,
    );
    expect(
      isTrustedConverterSender(
        { id: "extension-id", url: "chrome-extension://extension-id/other.html" },
        "extension-id",
        expected,
      ),
    ).toBe(false);
  });

  it("destructively claims the descriptor for the sender window", async () => {
    const key = pendingImportStorageKey(4);
    const session = {
      get: vi.fn(async () => ({ [key]: descriptor })),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    };

    await expect(
      claimPendingImportForSender(session, { tab: { windowId: 4 } }, 4, NOW),
    ).resolves.toEqual({ descriptor, ok: true });
    expect(session.remove).toHaveBeenCalledWith(key);
  });

  it("supports a pre-authenticated native side panel without sender.tab or documentId", async () => {
    const key = pendingImportStorageKey(4);
    const session = {
      get: vi.fn(async () => ({ [key]: descriptor })),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    };
    await expect(claimPendingImportForSender(session, {}, 4, NOW)).resolves.toEqual({
      descriptor,
      ok: true,
    });
  });

  it("returns bounded errors for empty and unavailable storage", async () => {
    const empty = {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    };
    await expect(
      claimPendingImportForSender(empty, { tab: { windowId: 4 } }, 4, NOW),
    ).resolves.toEqual({
      error: "empty",
      ok: false,
    });
    empty.get.mockRejectedValueOnce(new Error("sensitive storage detail"));
    await expect(
      claimPendingImportForSender(empty, { tab: { windowId: 4 } }, 4, NOW),
    ).resolves.toEqual({
      error: "storage-error",
      ok: false,
    });
  });

  it("rejects a mismatched browser-provided window without consuming state", async () => {
    const key = pendingImportStorageKey(8);
    const session = {
      get: vi.fn(async () => ({ [key]: descriptor })),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    };

    await expect(
      claimPendingImportForSender(session, { tab: { windowId: 9 } }, 8, NOW),
    ).resolves.toEqual({ error: "empty", ok: false });
    expect(session.get).not.toHaveBeenCalled();
    expect(session.remove).not.toHaveBeenCalled();
  });
});
