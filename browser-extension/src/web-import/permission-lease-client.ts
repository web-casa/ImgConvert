// SPDX-License-Identifier: Apache-2.0
import type { Browser } from "wxt/browser";

import {
  KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE,
  REGISTER_WEB_IMPORT_PERMISSION_LEASE,
  RELEASE_WEB_IMPORT_PERMISSION,
  REQUEST_WEB_IMPORT_PERMISSION,
  WEB_IMPORT_PERMISSION_LEASE_PORT,
  validateRegisterWebImportPermissionLeaseResponse,
  validateReleaseWebImportPermissionResponse,
  validateRequestWebImportPermissionResponse,
  type ReleaseWebImportPermissionResponse,
  type RequestWebImportPermissionResponse,
  type WebImportPermissionLeaseIdentity,
} from "./permission-lease-protocol";
import { PENDING_IMPORT_TTL_MS } from "./descriptor";

export interface RegisteredWebImportPermissionLease {
  readonly close: () => void;
  readonly identity: WebImportPermissionLeaseIdentity;
  readonly permissionPreexisting: boolean;
}

export type RuntimeMessageSender = (message: unknown) => Promise<unknown>;

const REGISTRATION_TIMEOUT_MS = 5000;
export const PERMISSION_LEASE_HEARTBEAT_MS = 20_000;
export const PERMISSION_LEASE_MAX_LIFETIME_MS = PENDING_IMPORT_TTL_MS;

export async function registerWebImportPermissionLeaseClient(
  connect: (name: string) => Browser.runtime.Port,
  identity: WebImportPermissionLeaseIdentity,
  onUnexpectedDisconnect: () => void,
  timeoutMs = REGISTRATION_TIMEOUT_MS,
): Promise<RegisteredWebImportPermissionLease> {
  const port = connect(WEB_IMPORT_PERMISSION_LEASE_PORT);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timeoutId);
      port.onMessage.removeListener(handleMessage);
      port.onDisconnect.removeListener(handleDisconnect);
      return true;
    };
    const fail = (message: string): void => {
      if (!finish()) return;
      try {
        port.disconnect();
      } catch {
        // The browser may already have closed a failed registration port.
      }
      reject(new Error(message));
    };
    const handleMessage = (message: unknown): void => {
      const response = validateRegisterWebImportPermissionLeaseResponse(message, identity.nonce);
      if (!response) return;
      if (!response.ok) {
        fail("Unable to register the temporary web-image permission lease");
        return;
      }
      if (!finish()) return;
      let active = true;
      let heartbeatId: ReturnType<typeof setInterval> | undefined;
      let lifetimeId: ReturnType<typeof setTimeout> | undefined;
      const stopActiveLease = (disconnect: boolean): boolean => {
        if (!active) return false;
        active = false;
        if (heartbeatId !== undefined) clearInterval(heartbeatId);
        if (lifetimeId !== undefined) clearTimeout(lifetimeId);
        port.onDisconnect.removeListener(monitorDisconnect);
        if (disconnect) {
          try {
            port.disconnect();
          } catch {
            // The browser may already have closed the lease Port.
          }
        }
        return true;
      };
      const monitorDisconnect = (): void => {
        if (stopActiveLease(false)) onUnexpectedDisconnect();
      };
      const close = (): void => {
        stopActiveLease(true);
      };
      if (response.permissionPreexisting) close();
      else {
        port.onDisconnect.addListener(monitorDisconnect);
        heartbeatId = setInterval(() => {
          try {
            port.postMessage({
              ...identity,
              type: KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE,
            });
          } catch {
            if (stopActiveLease(false)) onUnexpectedDisconnect();
          }
        }, PERMISSION_LEASE_HEARTBEAT_MS);
        lifetimeId = setTimeout(() => {
          if (stopActiveLease(true)) onUnexpectedDisconnect();
        }, PERMISSION_LEASE_MAX_LIFETIME_MS);
      }
      resolve(
        Object.freeze({
          close,
          identity,
          permissionPreexisting: response.permissionPreexisting,
        }),
      );
    };
    const handleDisconnect = (): void => {
      fail("The temporary web-image permission lease disconnected during registration");
    };
    const timeoutId = setTimeout(() => {
      fail("The temporary web-image permission lease registration timed out");
    }, timeoutMs);

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);
    try {
      port.postMessage({
        ...identity,
        type: REGISTER_WEB_IMPORT_PERMISSION_LEASE,
      });
    } catch {
      fail("Unable to contact the temporary web-image permission lease service");
    }
  });
}

export function disposeWebImportPermissionLeaseClient(
  lease: RegisteredWebImportPermissionLease | undefined,
): void {
  lease?.close();
}

export async function requestWebImportPermission(
  sendMessage: RuntimeMessageSender,
  identity: WebImportPermissionLeaseIdentity,
): Promise<RequestWebImportPermissionResponse> {
  const response = validateRequestWebImportPermissionResponse(
    await sendMessage({ ...identity, type: REQUEST_WEB_IMPORT_PERMISSION }),
  );
  if (!response) throw new Error("Invalid temporary permission request response");
  return response;
}

export async function releaseWebImportPermission(
  sendMessage: RuntimeMessageSender,
  identity: WebImportPermissionLeaseIdentity,
): Promise<ReleaseWebImportPermissionResponse> {
  const response = validateReleaseWebImportPermissionResponse(
    await sendMessage({ ...identity, type: RELEASE_WEB_IMPORT_PERMISSION }),
  );
  if (!response) throw new Error("Invalid temporary permission release response");
  return response;
}
