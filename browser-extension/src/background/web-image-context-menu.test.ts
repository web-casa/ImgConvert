// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";

import { pendingImportStorageKey } from "../web-import/pending-storage";
import {
  WEB_IMAGE_CONTEXT_MENU_ID,
  WEB_IMAGE_DOCUMENT_PATTERNS,
  WEB_IMAGE_TARGET_PATTERNS,
  handleWebImageContextMenuClick,
  installWebImageContextMenu,
} from "./web-image-context-menu";

const NOW = 1_800_000_000_000;
const NONCE = "123e4567-e89b-42d3-a456-426614174000";

function dependencies() {
  const set = vi.fn(async () => undefined);
  const openWorkbench = vi.fn(async () => "created");
  return {
    api: {
      nonce: () => NONCE,
      now: () => NOW,
      openWorkbench,
      session: {
        get: vi.fn(async () => ({})),
        remove: vi.fn(async () => undefined),
        set,
      },
    },
    openWorkbench,
    set,
  };
}

describe("web image context menu", () => {
  it("installs one HTTPS-image-only menu on HTTPS documents", async () => {
    const contextMenus = {
      create: vi.fn((_properties, callback: () => void) => {
        callback();
        return WEB_IMAGE_CONTEXT_MENU_ID;
      }),
      removeAll: vi.fn((callback: () => void) => callback()),
    };

    await installWebImageContextMenu(contextMenus, "Convert with ImgConvert", {});
    expect(contextMenus.removeAll).toHaveBeenCalledOnce();
    expect(contextMenus.create).toHaveBeenCalledWith(
      {
        contexts: ["image"],
        documentUrlPatterns: [...WEB_IMAGE_DOCUMENT_PATTERNS],
        id: WEB_IMAGE_CONTEXT_MENU_ID,
        targetUrlPatterns: [...WEB_IMAGE_TARGET_PATTERNS],
        title: "Convert with ImgConvert",
      },
      expect.any(Function),
    );
  });

  it("uses the callback-compatible path and reports menu creation errors", async () => {
    const runtime: { lastError?: { message: string } } = {};
    let finishRemove: () => void = () => {
      throw new Error("remove callback was not captured");
    };
    const contextMenus = {
      create: vi.fn((_properties, callback: () => void) => {
        runtime.lastError = { message: "duplicate ID detail" };
        callback();
        delete runtime.lastError;
        return WEB_IMAGE_CONTEXT_MENU_ID;
      }),
      removeAll: vi.fn((callback: () => void) => {
        finishRemove = callback;
      }),
    };

    const installation = installWebImageContextMenu(
      contextMenus,
      "Convert with ImgConvert",
      runtime,
    );
    expect(contextMenus.create).not.toHaveBeenCalled();
    finishRemove();
    await expect(installation).rejects.toThrow("Unable to create the web-image context menu");
  });

  it("opens the matching side panel before storing the bounded descriptor", async () => {
    const fixture = dependencies();

    const descriptor = await handleWebImageContextMenuClick(
      fixture.api,
      {
        mediaType: "image",
        menuItemId: WEB_IMAGE_CONTEXT_MENU_ID,
        pageUrl: "https://photos.example.net/album",
        srcUrl: "https://cdn.example.net/photo.png",
      },
      { windowId: 7 },
    );

    expect(descriptor).toMatchObject({ kind: "remote", sourceOrigin: "https://cdn.example.net" });
    expect(fixture.set).toHaveBeenCalledWith({ [pendingImportStorageKey(7)]: descriptor });
    expect(fixture.openWorkbench.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.set.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(fixture.openWorkbench).toHaveBeenCalledWith(7);
  });

  it("stores only a reason for blocked data URLs", async () => {
    const fixture = dependencies();
    const descriptor = await handleWebImageContextMenuClick(
      fixture.api,
      {
        mediaType: "image",
        menuItemId: WEB_IMAGE_CONTEXT_MENU_ID,
        pageUrl: "https://photos.example.net/album",
        srcUrl: "data:image/png;base64,AAAA",
      },
      { windowId: 2 },
    );

    expect(descriptor).toMatchObject({ code: "unsupported-scheme", kind: "blocked" });
    expect(JSON.stringify(fixture.set.mock.calls)).not.toContain("AAAA");
  });

  it("ignores unrelated menu and media events", async () => {
    const fixture = dependencies();
    await expect(
      handleWebImageContextMenuClick(
        fixture.api,
        { mediaType: "video", menuItemId: WEB_IMAGE_CONTEXT_MENU_ID },
        { windowId: 1 },
      ),
    ).resolves.toBeUndefined();
    await expect(
      handleWebImageContextMenuClick(
        fixture.api,
        { mediaType: "image", menuItemId: "other" },
        { windowId: 1 },
      ),
    ).resolves.toBeUndefined();
    expect(fixture.set).not.toHaveBeenCalled();
    expect(fixture.openWorkbench).not.toHaveBeenCalled();
  });

  it("does not create an ambiguous cross-window handoff without a window ID", async () => {
    const fixture = dependencies();
    await expect(
      handleWebImageContextMenuClick(
        fixture.api,
        {
          mediaType: "image",
          menuItemId: WEB_IMAGE_CONTEXT_MENU_ID,
          pageUrl: "https://photos.example.net/album",
          srcUrl: "https://cdn.example.net/photo.png",
        },
        undefined,
      ),
    ).rejects.toThrow("valid window ID");
    expect(fixture.set).not.toHaveBeenCalled();
    expect(fixture.openWorkbench).not.toHaveBeenCalled();
  });
});
