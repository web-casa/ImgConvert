// SPDX-License-Identifier: Apache-2.0
import { createPendingImageImport, type PendingImageImport } from "../web-import/descriptor";
import {
  storePendingImageImport,
  type PendingImportSessionStorage,
} from "../web-import/pending-storage";

export const WEB_IMAGE_CONTEXT_MENU_ID = "imgconvert.convertWebImage";
export const WEB_IMAGE_DOCUMENT_PATTERNS = ["https://*/*"] as const;
export const WEB_IMAGE_TARGET_PATTERNS = ["https://*/*"] as const;

export interface ImageContextMenuClick {
  readonly frameUrl?: string;
  readonly mediaType?: string;
  readonly menuItemId: string | number;
  readonly pageUrl?: string;
  readonly srcUrl?: string;
}

export interface ImageContextMenuTab {
  readonly windowId?: number;
}

export interface ContextMenuApi {
  create(
    properties: {
      contexts: ["image"];
      documentUrlPatterns: string[];
      id: string;
      targetUrlPatterns: string[];
      title: string;
    },
    callback: () => void,
  ): string | number;
  removeAll(callback: () => void): void;
}

export interface ContextMenuRuntimeApi {
  readonly lastError?: Readonly<{ message?: string }>;
}

export interface ContextMenuClickDependencies {
  readonly nonce: () => string;
  readonly now: () => number;
  readonly openWorkbench: (windowId: number | undefined) => Promise<unknown>;
  readonly session: PendingImportSessionStorage;
}

export async function installWebImageContextMenu(
  contextMenus: ContextMenuApi,
  title: string,
  runtime: ContextMenuRuntimeApi,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    contextMenus.removeAll(() => {
      if (runtime.lastError) {
        reject(new Error("Unable to clear the extension context menu"));
        return;
      }
      resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    contextMenus.create(
      {
        contexts: ["image"],
        documentUrlPatterns: [...WEB_IMAGE_DOCUMENT_PATTERNS],
        id: WEB_IMAGE_CONTEXT_MENU_ID,
        targetUrlPatterns: [...WEB_IMAGE_TARGET_PATTERNS],
        title,
      },
      () => {
        if (runtime.lastError) {
          reject(new Error("Unable to create the web-image context menu"));
          return;
        }
        resolve();
      },
    );
  });
}

export async function handleWebImageContextMenuClick(
  dependencies: ContextMenuClickDependencies,
  info: ImageContextMenuClick,
  tab: ImageContextMenuTab | undefined,
): Promise<PendingImageImport | undefined> {
  if (info.menuItemId !== WEB_IMAGE_CONTEXT_MENU_ID || info.mediaType !== "image") return undefined;
  const windowId = tab?.windowId;
  if (typeof windowId !== "number" || !Number.isSafeInteger(windowId) || windowId < 0) {
    throw new Error("The web-image context menu event did not include a valid window ID");
  }

  const descriptor = createPendingImageImport({
    documentUrl: info.frameUrl ?? info.pageUrl,
    nonce: dependencies.nonce(),
    now: dependencies.now(),
    sourceUrl: info.srcUrl,
  });
  // Chromium requires sidePanel.open() to begin while the context-menu click
  // still counts as a user gesture. The opened panel observes the subsequent
  // session-storage write and claims this one-time handoff.
  await dependencies.openWorkbench(windowId);
  await storePendingImageImport(dependencies.session, windowId, descriptor);
  return descriptor;
}
