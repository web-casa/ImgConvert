// SPDX-License-Identifier: Apache-2.0
import { WEB_V1_DESKTOP_LIMITS } from "@imgconvert/conversion-contract";

import type { PendingRemoteImageImport } from "./descriptor";

const ALLOWED_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);
const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
});

export const MAX_REMOTE_IMAGE_BYTES = WEB_V1_DESKTOP_LIMITS.maxRasterBytes;

export type RemoteImageFetchErrorCode =
  | "empty-response"
  | "http-error"
  | "invalid-content-length"
  | "network-error"
  | "redirect-blocked"
  | "response-too-large"
  | "stream-unavailable"
  | "timeout"
  | "unexpected-origin"
  | "unsupported-content-type";

export class RemoteImageFetchError extends Error {
  readonly code: RemoteImageFetchErrorCode;

  constructor(code: RemoteImageFetchErrorCode) {
    super(code);
    this.name = "RemoteImageFetchError";
    this.code = code;
  }
}

export interface RemoteImageFetchOptions {
  readonly fetcher?: typeof fetch;
  readonly onProgress?: (receivedBytes: number) => void;
  readonly signal: AbortSignal;
}

function normalizedContentType(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function checkedContentLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length");
  if (raw === null) return undefined;
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) throw new RemoteImageFetchError("invalid-content-length");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new RemoteImageFetchError("invalid-content-length");
  return value;
}

function outputName(descriptor: PendingRemoteImageImport, contentType: string): string {
  const extension = CONTENT_TYPE_EXTENSIONS[contentType];
  if (!extension || /\.(?:avif|bmp|gif|jpe?g|jfif|png|svg|webp)$/iu.test(descriptor.displayName)) {
    return descriptor.displayName;
  }
  const stem = descriptor.displayName.replace(/\.[^.]{1,12}$/u, "").slice(0, 110) || "web-image";
  return `${stem}.${extension}`;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Preserve the primary fetch/validation error when stream cleanup also fails.
  }
}

export async function fetchRemoteImage(
  descriptor: PendingRemoteImageImport,
  options: RemoteImageFetchOptions,
): Promise<File> {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(descriptor.sourceUrl, {
      cache: "no-store",
      credentials: "omit",
      method: "GET",
      redirect: "manual",
      referrerPolicy: "no-referrer",
      signal: options.signal,
    });
  } catch {
    if (options.signal.aborted) throw new RemoteImageFetchError("timeout");
    throw new RemoteImageFetchError("network-error");
  }

  if (
    response.type === "opaqueredirect" ||
    response.redirected ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new RemoteImageFetchError("redirect-blocked");
  }
  if (!response.ok) throw new RemoteImageFetchError("http-error");
  if (response.url) {
    try {
      if (new URL(response.url).origin !== descriptor.sourceOrigin) {
        throw new RemoteImageFetchError("unexpected-origin");
      }
    } catch (error) {
      if (error instanceof RemoteImageFetchError) throw error;
      throw new RemoteImageFetchError("unexpected-origin");
    }
  }

  const contentType = normalizedContentType(response);
  if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new RemoteImageFetchError("unsupported-content-type");
  }
  const contentLength = checkedContentLength(response);
  if (contentLength === 0) throw new RemoteImageFetchError("empty-response");
  if (contentLength !== undefined && contentLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new RemoteImageFetchError("response-too-large");
  }
  if (!response.body) throw new RemoteImageFetchError("stream-unavailable");

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!result.value) continue;
      receivedBytes += result.value.byteLength;
      if (!Number.isSafeInteger(receivedBytes) || receivedBytes > MAX_REMOTE_IMAGE_BYTES) {
        throw new RemoteImageFetchError("response-too-large");
      }
      const ownedChunk = new Uint8Array(result.value.byteLength);
      ownedChunk.set(result.value);
      chunks.push(ownedChunk.buffer);
      options.onProgress?.(receivedBytes);
    }
  } catch (error) {
    await cancelReader(reader);
    if (error instanceof RemoteImageFetchError) throw error;
    if (options.signal.aborted) throw new RemoteImageFetchError("timeout");
    throw new RemoteImageFetchError("network-error");
  } finally {
    reader.releaseLock();
  }
  if (receivedBytes === 0) throw new RemoteImageFetchError("empty-response");

  return new File(chunks, outputName(descriptor, contentType), {
    lastModified: Date.now(),
    type: contentType,
  });
}
