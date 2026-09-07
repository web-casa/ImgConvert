// SPDX-License-Identifier: Apache-2.0
import { browser, defineBackground } from "#imports";
import type { Browser } from "wxt/browser";

import { runExtensionInstallLifecycle } from "../src/background/install-lifecycle";
import {
  claimPendingImportForSender,
  isTrustedConverterSender,
} from "../src/background/pending-claim";
import { configureActionSidePanel } from "../src/background/side-panel-configuration";
import {
  handleWebImageContextMenuClick,
  installWebImageContextMenu,
} from "../src/background/web-image-context-menu";
import {
  attachWebImportPermissionLeasePort,
  createWebImportPermissionLeaseActivity,
  releaseWebImportPermissionFromMessage,
  requestWebImportPermissionFromUserGesture,
} from "../src/background/web-import-permission-service";
import { cleanupOrphanedWebImportPermissionLeases } from "../src/background/web-import-permission-lease";
import { clearOwnedTransientSessionState } from "../src/background/update-cleanup";
import { migrateExtensionPreferencesStorage } from "../src/preferences/storage";
import {
  isReleaseWebImportPermissionMessage,
  isRequestWebImportPermissionMessage,
  WEB_IMPORT_PERMISSION_LEASE_PORT,
} from "../src/web-import/permission-lease-protocol";
import { isClaimPendingImportMessage } from "../src/web-import/protocol";

async function restrictPreferenceStorage(): Promise<void> {
  await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

let preferenceMigration: Promise<void> | undefined;

async function runPreferenceMigration(): Promise<void> {
  try {
    await migrateExtensionPreferencesStorage();
  } catch (error) {
    preferenceMigration = undefined;
    throw error;
  }
}

function migratePreferenceStorage(): Promise<void> {
  preferenceMigration ??= runPreferenceMigration();
  return preferenceMigration;
}

async function configureSidePanel(): Promise<void> {
  try {
    await configureActionSidePanel({ action: browser.action, sidePanel: browser.sidePanel });
  } catch (error) {
    console.error("Unable to configure the ImgConvert side panel", error);
  }
}

function sidePanelUrl(): string {
  return browser.runtime.getURL("/converter.html?surface=side-panel");
}

function isTrustedSidePanelSender(sender: Browser.runtime.MessageSender): boolean {
  return isTrustedConverterSender(sender, browser.runtime.id, sidePanelUrl());
}

function senderWindowId(
  sender: Browser.runtime.MessageSender | undefined,
  requestedWindowId: number,
): number | undefined {
  if (!sender || !isTrustedSidePanelSender(sender)) return undefined;
  // Native side-panel messages have neither tab nor documentId in Chromium 149.
  // Their window is our trusted page's windows.getCurrent() result. It is not
  // independently authenticated by the background; see the release review.
  const windowId = sender.tab?.windowId ?? requestedWindowId;
  return Number.isSafeInteger(windowId) && windowId >= 0 ? windowId : undefined;
}

let permissionLeaseRecovery: Promise<void> | undefined;
const permissionLeaseActivity = createWebImportPermissionLeaseActivity();

async function runPermissionLeaseRecovery(): Promise<void> {
  try {
    const { failed } = await cleanupOrphanedWebImportPermissionLeases(
      browser.storage.local,
      browser.permissions,
    );
    if (failed > 0) throw new Error("Unable to release temporary web-image permissions");
  } catch (error) {
    permissionLeaseRecovery = undefined;
    throw error;
  }
}

function recoverPermissionLeases(): Promise<void> {
  permissionLeaseRecovery ??= runPermissionLeaseRecovery();
  return permissionLeaseRecovery;
}

function permissionServiceDependencies() {
  return {
    activity: permissionLeaseActivity,
    now: () => Date.now(),
    permissions: browser.permissions,
    recover: recoverPermissionLeases,
    resolveWindowId: async (sender: Browser.runtime.MessageSender | undefined, windowId: number) =>
      senderWindowId(sender, windowId),
    storage: browser.storage.local,
  } as const;
}

async function handleInstalled(details: Browser.runtime.InstalledDetails): Promise<void> {
  await runExtensionInstallLifecycle(details.reason, {
    clearOwnedTransientSessionState: () => clearOwnedTransientSessionState(browser.storage.session),
    installContextMenu: () =>
      installWebImageContextMenu(
        browser.contextMenus,
        browser.i18n.getMessage("contextMenuConvert") || "Convert with ImgConvert",
        browser.runtime,
      ),
    migratePreferences: migratePreferenceStorage,
    restrictLocalStorage: restrictPreferenceStorage,
  });
}

async function handleContextMenuClick(
  info: Browser.contextMenus.OnClickData,
  tab: Browser.tabs.Tab | undefined,
): Promise<void> {
  try {
    const descriptor = await handleWebImageContextMenuClick(
      {
        nonce: () => crypto.randomUUID(),
        now: () => Date.now(),
        openWorkbench: async (windowId) => {
          if (typeof windowId !== "number" || !Number.isSafeInteger(windowId) || windowId < 0) {
            throw new Error("The ImgConvert side panel needs a valid browser window");
          }
          await browser.sidePanel.open({ windowId });
        },
        session: browser.storage.session,
      },
      info,
      tab,
    );
    if (descriptor) await browser.action.setBadgeText({ text: "" });
  } catch (error) {
    console.error("Unable to prepare the selected web image", error);
    await Promise.allSettled([
      browser.action.setBadgeBackgroundColor({ color: "#a64a42" }),
      browser.action.setBadgeText({ text: "!" }),
    ]);
  }
}

async function respondToPendingImportClaim(
  sender: Browser.runtime.MessageSender,
  windowId: number,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  const authorizedWindowId = senderWindowId(sender, windowId);
  if (authorizedWindowId !== windowId) {
    sendResponse({ error: "untrusted-sender", ok: false });
    return;
  }
  sendResponse(await claimPendingImportForSender(browser.storage.session, sender, windowId));
}

export default defineBackground({
  type: "module",
  main() {
    // Start recovery before exposing any registration endpoint. Port
    // registration awaits this same retryable promise.
    void recoverPermissionLeases().catch((error: unknown) => {
      console.error("Unable to recover temporary web-image permissions", error);
    });

    browser.contextMenus.onClicked.addListener((info, tab) => {
      void handleContextMenuClick(info, tab);
    });

    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== WEB_IMPORT_PERMISSION_LEASE_PORT) return;
      if (!port.sender || !isTrustedSidePanelSender(port.sender)) {
        port.disconnect();
        return;
      }
      attachWebImportPermissionLeasePort(port, permissionServiceDependencies());
    });

    browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (isClaimPendingImportMessage(message)) {
        if (!isTrustedSidePanelSender(sender)) {
          sendResponse({ error: "untrusted-sender", ok: false });
          return undefined;
        }
        void respondToPendingImportClaim(sender, message.windowId, sendResponse);
        return true;
      }
      if (isRequestWebImportPermissionMessage(message)) {
        if (senderWindowId(sender, message.windowId) !== message.windowId) {
          sendResponse({ error: "untrusted-sender", ok: false });
          return undefined;
        }
        const response = requestWebImportPermissionFromUserGesture(
          permissionServiceDependencies(),
          message,
          sender.documentId,
        );
        void response.then(sendResponse);
        return true;
      }
      if (isReleaseWebImportPermissionMessage(message)) {
        if (
          senderWindowId(sender, message.windowId) !== message.windowId ||
          !permissionLeaseActivity.has(message, sender.documentId)
        ) {
          sendResponse({ ok: true, released: false });
          return undefined;
        }
        void releaseWebImportPermissionFromMessage(permissionServiceDependencies(), message).then(
          (released) => sendResponse({ ok: true, released }),
        );
        return true;
      }
      return undefined;
    });

    browser.runtime.onInstalled.addListener((details) => {
      void handleInstalled(details).catch((error: unknown) => {
        console.error("Unable to initialize the ImgConvert extension", error);
      });
    });

    void restrictPreferenceStorage().catch((error: unknown) => {
      console.error("Unable to restrict extension preference storage", error);
    });
    void configureSidePanel();
    void migratePreferenceStorage().catch((error: unknown) => {
      console.error("Unable to migrate extension preferences", error);
    });
  },
});
