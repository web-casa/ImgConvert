// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

const PREVIEW_MAGIC = new Uint8Array([0x49, 0x43, 0x50, 0x31]); // "ICP1"
const PREVIEW_HEADER_BYTES = 16;
const MAX_PREVIEW_SUMMARY_BYTES = 64 * 1024;
const MAX_PREVIEW_IMAGE_BYTES = 16 * 1024 * 1024;

export interface DecodedPreviewPayload<T> {
  summary: T;
  beforeBytes: Uint8Array<ArrayBuffer>;
  afterBytes: Uint8Array<ArrayBuffer>;
}

function checkedPayloadLength(summaryLength: number, beforeLength: number, afterLength: number) {
  if (summaryLength > MAX_PREVIEW_SUMMARY_BYTES) {
    throw new Error("Preview response summary exceeds the safety limit");
  }
  if (beforeLength > MAX_PREVIEW_IMAGE_BYTES || afterLength > MAX_PREVIEW_IMAGE_BYTES) {
    throw new Error("Preview response image exceeds the safety limit");
  }
  const total = PREVIEW_HEADER_BYTES + summaryLength + beforeLength + afterLength;
  if (!Number.isSafeInteger(total)) {
    throw new Error("Preview response length is invalid");
  }
  return total;
}

/** Decode the bounded binary envelope returned by the native preview command. */
export function decodePreviewPayload<T>(payload: ArrayBuffer): DecodedPreviewPayload<T> {
  if (payload.byteLength < PREVIEW_HEADER_BYTES) {
    throw new Error("Preview response is truncated");
  }

  const bytes = new Uint8Array(payload);
  if (!PREVIEW_MAGIC.every((value, index) => bytes[index] === value)) {
    throw new Error("Preview response has an unsupported format");
  }

  const view = new DataView(payload);
  const summaryLength = view.getUint32(4, true);
  const beforeLength = view.getUint32(8, true);
  const afterLength = view.getUint32(12, true);
  const expectedLength = checkedPayloadLength(summaryLength, beforeLength, afterLength);
  if (payload.byteLength !== expectedLength) {
    throw new Error("Preview response length does not match its header");
  }

  const summaryStart = PREVIEW_HEADER_BYTES;
  const beforeStart = summaryStart + summaryLength;
  const afterStart = beforeStart + beforeLength;
  const summaryText = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(summaryStart, beforeStart),
  );
  const summary: unknown = JSON.parse(summaryText);
  if (typeof summary !== "object" || summary === null || Array.isArray(summary)) {
    throw new Error("Preview response summary is invalid");
  }

  // Copy each PNG so its Blob does not retain the complete response envelope.
  const beforeBytes = bytes.slice(beforeStart, afterStart);
  const afterBytes = bytes.slice(afterStart);
  return { summary: summary as T, beforeBytes, afterBytes };
}
