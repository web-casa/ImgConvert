// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import { createPendingImageImport } from "./descriptor";
import {
  CLAIM_PENDING_IMPORT,
  isClaimPendingImportMessage,
  validateClaimPendingImportResponse,
} from "./protocol";

describe("pending import protocol", () => {
  it("accepts only the exact claim request", () => {
    expect(isClaimPendingImportMessage({ type: CLAIM_PENDING_IMPORT, windowId: 7 })).toBe(true);
    expect(isClaimPendingImportMessage({ type: CLAIM_PENDING_IMPORT })).toBe(false);
    expect(
      isClaimPendingImportMessage({
        type: CLAIM_PENDING_IMPORT,
        url: "https://example.com",
        windowId: 7,
      }),
    ).toBe(false);
    expect(isClaimPendingImportMessage({ type: CLAIM_PENDING_IMPORT, windowId: -1 })).toBe(false);
    expect(isClaimPendingImportMessage(null)).toBe(false);
  });

  it("validates descriptor and bounded failure responses", () => {
    const now = 1_800_000_000_000;
    const descriptor = createPendingImageImport({
      documentUrl: "https://photos.example.net/",
      nonce: "123e4567-e89b-42d3-a456-426614174000",
      now,
      sourceUrl: "https://cdn.example.net/image.png",
    });
    expect(validateClaimPendingImportResponse({ descriptor, ok: true }, now)).toEqual({
      descriptor,
      ok: true,
    });
    expect(validateClaimPendingImportResponse({ error: "empty", ok: false }, now)).toEqual({
      error: "empty",
      ok: false,
    });
    expect(
      validateClaimPendingImportResponse(
        { descriptor, ok: true, sourceUrl: "https://evil.invalid" },
        now,
      ),
    ).toBeUndefined();
  });
});
