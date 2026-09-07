// SPDX-License-Identifier: Apache-2.0
import {
  takePendingImageImport,
  type PendingImportSessionStorage,
} from "../web-import/pending-storage";
import type { ClaimPendingImportResponse } from "../web-import/protocol";

export interface PendingClaimSender {
  readonly id?: string;
  readonly tab?: Readonly<{ windowId?: number }>;
  readonly url?: string;
}

function sameExtensionPage(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  try {
    const candidateUrl = new URL(candidate);
    const expectedUrl = new URL(expected);
    return (
      candidateUrl.protocol === expectedUrl.protocol &&
      candidateUrl.host === expectedUrl.host &&
      candidateUrl.pathname === expectedUrl.pathname &&
      candidateUrl.search === expectedUrl.search &&
      candidateUrl.hash === expectedUrl.hash
    );
  } catch {
    return false;
  }
}

export function isTrustedConverterSender(
  sender: PendingClaimSender,
  extensionId: string,
  converterUrl: string,
): boolean {
  return sender.id === extensionId && sameExtensionPage(sender.url, converterUrl);
}

export async function claimPendingImportForSender(
  session: PendingImportSessionStorage,
  sender: PendingClaimSender,
  requestedWindowId: number,
  now = Date.now(),
): Promise<ClaimPendingImportResponse> {
  try {
    // The caller authenticates the extension ID and exact converter URL.
    // Native side panels expose no tab/window identity in MessageSender; only
    // tab-hosted converters can independently cross-check the requested window.
    const senderWindowId = sender.tab?.windowId;
    if (
      !Number.isSafeInteger(requestedWindowId) ||
      requestedWindowId < 0 ||
      (senderWindowId !== undefined && senderWindowId !== requestedWindowId)
    ) {
      return Object.freeze({ error: "empty", ok: false });
    }
    const descriptor = await takePendingImageImport(session, requestedWindowId, now);
    return descriptor
      ? Object.freeze({ descriptor, ok: true })
      : Object.freeze({ error: "empty", ok: false });
  } catch {
    return Object.freeze({ error: "storage-error", ok: false });
  }
}
