// SPDX-License-Identifier: Apache-2.0
import type { Browser } from "wxt/browser";

import {
  isKeepAliveWebImportPermissionLeaseMessage,
  isRegisterWebImportPermissionLeaseMessage,
  type RegisterWebImportPermissionLeaseResponse,
  type RequestWebImportPermissionResponse,
  type WebImportPermissionLeaseIdentity,
} from "../web-import/permission-lease-protocol";
import {
  markWebImportPermissionLeaseGranted,
  registerWebImportPermissionLease,
  releaseWebImportPermissionLease,
  type PermissionLeasePermissions,
  type PermissionLeaseStorage,
} from "./web-import-permission-lease";

export interface WebImportPermissionServiceDependencies {
  readonly activity: WebImportPermissionLeaseActivity;
  readonly now: () => number;
  readonly permissions: PermissionLeasePermissions & {
    request(permissions: { origins: string[] }): Promise<boolean>;
  };
  readonly recover: () => Promise<void>;
  readonly resolveWindowId: (
    sender: Browser.runtime.MessageSender | undefined,
    requestedWindowId: number,
  ) => Promise<number | undefined>;
  readonly storage: PermissionLeaseStorage;
}

export interface WebImportPermissionLeaseActivity {
  activate(identity: WebImportPermissionLeaseIdentity, documentId?: string): () => void;
  has(identity: WebImportPermissionLeaseIdentity, documentId?: string): boolean;
}

export function createWebImportPermissionLeaseActivity(): WebImportPermissionLeaseActivity {
  const activeByNonce = new Map<
    string,
    Readonly<{ identity: WebImportPermissionLeaseIdentity; token: symbol; documentId?: string }>
  >();
  return Object.freeze({
    activate(identity: WebImportPermissionLeaseIdentity, documentId?: string) {
      const token = Symbol(identity.nonce);
      activeByNonce.set(identity.nonce, Object.freeze({ identity, token, documentId }));
      return () => {
        if (activeByNonce.get(identity.nonce)?.token === token)
          activeByNonce.delete(identity.nonce);
      };
    },
    has(identity: WebImportPermissionLeaseIdentity, documentId?: string) {
      const registration = activeByNonce.get(identity.nonce);
      const active = registration?.identity;
      return (
        active !== undefined &&
        registration?.documentId === documentId &&
        active.permissionPattern === identity.permissionPattern &&
        active.windowId === identity.windowId
      );
    },
  });
}

function safePostMessage(port: Browser.runtime.Port, message: unknown): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

export function attachWebImportPermissionLeasePort(
  port: Browser.runtime.Port,
  dependencies: WebImportPermissionServiceDependencies,
): void {
  let registration: Promise<WebImportPermissionLeaseIdentity | undefined> | undefined;
  let activeIdentity: WebImportPermissionLeaseIdentity | undefined;
  let deactivateActiveIdentity: (() => void) | undefined;
  let disconnected = false;
  let releaseScheduled = false;

  const releaseAfterRegistration = async (): Promise<void> => {
    const identity = await registration;
    if (identity) {
      await releaseWebImportPermissionLease(
        dependencies.storage,
        dependencies.permissions,
        identity,
      );
    }
  };

  const handleDisconnect = (): void => {
    disconnected = true;
    deactivateActiveIdentity?.();
    deactivateActiveIdentity = undefined;
    activeIdentity = undefined;
    port.onMessage.removeListener(handleMessage);
    if (registration && !releaseScheduled) {
      releaseScheduled = true;
      void releaseAfterRegistration().catch(() => {
        // A persisted lease remains available for startup recovery.
      });
    }
  };

  const handleMessage = (message: unknown): void => {
    if (registration) {
      if (
        !activeIdentity ||
        !isKeepAliveWebImportPermissionLeaseMessage(message) ||
        message.nonce !== activeIdentity.nonce ||
        message.permissionPattern !== activeIdentity.permissionPattern ||
        message.windowId !== activeIdentity.windowId
      ) {
        port.disconnect();
      }
      return;
    }
    if (
      !isRegisterWebImportPermissionLeaseMessage(message) ||
      (port.sender?.tab?.windowId !== undefined && port.sender.tab.windowId !== message.windowId)
    ) {
      port.disconnect();
      return;
    }
    const identity: WebImportPermissionLeaseIdentity = Object.freeze({
      nonce: message.nonce,
      permissionPattern: message.permissionPattern,
      windowId: message.windowId,
    });
    registration = (async () => {
      let response: RegisterWebImportPermissionLeaseResponse;
      try {
        if (
          (await dependencies.resolveWindowId(port.sender, identity.windowId)) !==
            identity.windowId ||
          disconnected
        ) {
          throw new Error("permission lease sender does not own this window");
        }
        // Registration must not race startup recovery. In particular, recovery
        // may remove malformed lease keys that reuse this nonce.
        await dependencies.recover();
        const result = await registerWebImportPermissionLease(
          dependencies.storage,
          dependencies.permissions,
          identity,
          dependencies.now(),
        );
        response = Object.freeze({
          nonce: identity.nonce,
          ok: true,
          permissionPreexisting: result.permissionPreexisting,
        });
        if (!result.permissionPreexisting) {
          activeIdentity = identity;
          deactivateActiveIdentity = dependencies.activity.activate(
            identity,
            port.sender?.documentId,
          );
        }
        if (!disconnected && !safePostMessage(port, response)) {
          disconnected = true;
          deactivateActiveIdentity?.();
          deactivateActiveIdentity = undefined;
          activeIdentity = undefined;
          try {
            port.disconnect();
          } catch {
            // The registration Port may already be closed.
          }
        }
        return result.permissionPreexisting ? undefined : identity;
      } catch {
        response = Object.freeze({
          error: "registration-failed",
          nonce: identity.nonce,
          ok: false,
        });
        safePostMessage(port, response);
        return undefined;
      }
    })();
    void registration
      .then(async (registeredIdentity) => {
        if (disconnected && registeredIdentity && !releaseScheduled) {
          releaseScheduled = true;
          deactivateActiveIdentity?.();
          deactivateActiveIdentity = undefined;
          activeIdentity = undefined;
          await releaseWebImportPermissionLease(
            dependencies.storage,
            dependencies.permissions,
            registeredIdentity,
          );
        }
      })
      .catch(() => {
        // A persisted lease remains available for startup recovery.
      });
  };

  port.onMessage.addListener(handleMessage);
  port.onDisconnect.addListener(handleDisconnect);
}

async function finishWebImportPermissionRequest(
  permissionRequest: Promise<boolean>,
  dependencies: WebImportPermissionServiceDependencies,
  identity: WebImportPermissionLeaseIdentity,
): Promise<RequestWebImportPermissionResponse> {
  let granted: boolean;
  try {
    granted = await permissionRequest;
  } catch {
    return Object.freeze({ error: "permission-request-failed", ok: false });
  }
  if (!granted) return Object.freeze({ granted: false, ok: true });
  try {
    const retained = await markWebImportPermissionLeaseGranted(
      dependencies.storage,
      dependencies.permissions,
      identity,
    );
    return retained
      ? Object.freeze({ granted: true, ok: true })
      : Object.freeze({ error: "lease-expired", ok: false });
  } catch {
    try {
      await releaseWebImportPermissionLease(
        dependencies.storage,
        dependencies.permissions,
        identity,
      );
    } catch {
      // The persisted lease remains available for startup recovery.
    }
    return Object.freeze({ error: "permission-request-failed", ok: false });
  }
}

export function requestWebImportPermissionFromUserGesture(
  dependencies: WebImportPermissionServiceDependencies,
  identity: WebImportPermissionLeaseIdentity,
  documentId?: string,
): Promise<RequestWebImportPermissionResponse> {
  if (!dependencies.activity.has(identity, documentId)) {
    return Promise.resolve(Object.freeze({ error: "lease-expired", ok: false }));
  }
  let permissionRequest: Promise<boolean>;
  try {
    // This must remain the first asynchronous browser operation: Chrome only
    // propagates the UI user gesture through the current message turn.
    permissionRequest = dependencies.permissions.request({
      origins: [identity.permissionPattern],
    });
  } catch {
    return Promise.resolve(Object.freeze({ error: "permission-request-failed", ok: false }));
  }
  return finishWebImportPermissionRequest(permissionRequest, dependencies, identity);
}

export async function releaseWebImportPermissionFromMessage(
  dependencies: WebImportPermissionServiceDependencies,
  identity: WebImportPermissionLeaseIdentity,
): Promise<boolean> {
  try {
    return await releaseWebImportPermissionLease(
      dependencies.storage,
      dependencies.permissions,
      identity,
    );
  } catch {
    return false;
  }
}
