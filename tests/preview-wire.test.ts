// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import { describe, expect, it } from "vitest";

import { decodePreviewPayload } from "$lib/preview-wire";

function encodePayload(
  summary: unknown,
  before: number[] = [1, 2, 3],
  after: number[] = [4, 5],
): ArrayBuffer {
  const summaryBytes = new TextEncoder().encode(JSON.stringify(summary));
  const payload = new Uint8Array(16 + summaryBytes.length + before.length + after.length);
  payload.set([0x49, 0x43, 0x50, 0x31]);
  const view = new DataView(payload.buffer);
  view.setUint32(4, summaryBytes.length, true);
  view.setUint32(8, before.length, true);
  view.setUint32(12, after.length, true);
  payload.set(summaryBytes, 16);
  payload.set(before, 16 + summaryBytes.length);
  payload.set(after, 16 + summaryBytes.length + before.length);
  return payload.buffer;
}

describe("preview wire format", () => {
  it("decodes the summary and both images without retaining the envelope", () => {
    const payload = encodePayload({ mime: "image/png", outputSize: 42 });
    const result = decodePreviewPayload<{ mime: string; outputSize: number }>(payload);

    expect(result.summary).toEqual({ mime: "image/png", outputSize: 42 });
    expect([...result.beforeBytes]).toEqual([1, 2, 3]);
    expect([...result.afterBytes]).toEqual([4, 5]);
    expect(result.beforeBytes.buffer).not.toBe(payload);
    expect(result.afterBytes.buffer).not.toBe(payload);
  });

  it("rejects unknown, truncated, and length-mismatched payloads", () => {
    const unknown = encodePayload({});
    new Uint8Array(unknown)[0] = 0;
    expect(() => decodePreviewPayload(unknown)).toThrow("unsupported format");
    expect(() => decodePreviewPayload(new ArrayBuffer(15))).toThrow("truncated");

    const mismatched = encodePayload({});
    new DataView(mismatched).setUint32(8, 99, true);
    expect(() => decodePreviewPayload(mismatched)).toThrow("does not match");
  });

  it("rejects declared images above the transport budget before slicing", () => {
    const payload = new ArrayBuffer(16);
    const bytes = new Uint8Array(payload);
    bytes.set([0x49, 0x43, 0x50, 0x31]);
    new DataView(payload).setUint32(8, 16 * 1024 * 1024 + 1, true);

    expect(() => decodePreviewPayload(payload)).toThrow("safety limit");
  });

  it("rejects a non-object summary", () => {
    expect(() => decodePreviewPayload(encodePayload(["not", "a", "summary"]))).toThrow(
      "summary is invalid",
    );
  });
});
