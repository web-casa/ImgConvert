// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";

import { createPendingImageImport, type PendingRemoteImageImport } from "./descriptor";
import {
  MAX_REMOTE_IMAGE_BYTES,
  RemoteImageFetchError,
  fetchRemoteImage,
  type RemoteImageFetchErrorCode,
} from "./remote-fetch";

const descriptor = createPendingImageImport({
  documentUrl: "https://photos.example.net/",
  nonce: "123e4567-e89b-42d3-a456-426614174000",
  now: Date.now(),
  sourceUrl: "https://cdn.example.net/assets/photo",
}) as PendingRemoteImageImport;

function response(body: BodyInit | null, init: ResponseInit & { url?: string } = {}): Response {
  const result = new Response(body, init);
  if (init.url) Object.defineProperty(result, "url", { value: init.url });
  return result;
}

async function expectCode(
  promise: Promise<unknown>,
  code: RemoteImageFetchErrorCode,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code } satisfies Partial<RemoteImageFetchError>);
}

describe("bounded remote image fetch", () => {
  it("uses a credential-free, no-referrer, no-cache, non-redirecting GET", async () => {
    const fetcher = vi.fn(async () =>
      response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        headers: { "content-length": "4", "content-type": "image/png" },
        status: 200,
        url: descriptor.sourceUrl,
      }),
    );
    const progress = vi.fn();
    const file = await fetchRemoteImage(descriptor, {
      fetcher,
      onProgress: progress,
      signal: new AbortController().signal,
    });

    expect(fetcher).toHaveBeenCalledWith(descriptor.sourceUrl, {
      cache: "no-store",
      credentials: "omit",
      method: "GET",
      redirect: "manual",
      referrerPolicy: "no-referrer",
      signal: expect.any(AbortSignal),
    });
    expect(file.name).toBe("photo.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(4);
    expect(progress).toHaveBeenLastCalledWith(4);
  });

  it("rejects redirects and a final origin that does not match the descriptor", async () => {
    await expectCode(
      fetchRemoteImage(descriptor, {
        fetcher: async () => response(null, { status: 302 }),
        signal: new AbortController().signal,
      }),
      "redirect-blocked",
    );
    await expectCode(
      fetchRemoteImage(descriptor, {
        fetcher: async () =>
          response("png", { status: 200, url: "https://other.example.net/a.png" }),
        signal: new AbortController().signal,
      }),
      "unexpected-origin",
    );
    await expectCode(
      fetchRemoteImage(descriptor, {
        fetcher: async () => response("png", { status: 200, url: "not a URL" }),
        signal: new AbortController().signal,
      }),
      "unexpected-origin",
    );
  });

  it("rejects explicit and streamed responses over the byte budget", async () => {
    await expectCode(
      fetchRemoteImage(descriptor, {
        fetcher: async () =>
          response("x", {
            headers: {
              "content-length": String(MAX_REMOTE_IMAGE_BYTES + 1),
              "content-type": "image/png",
            },
            status: 200,
          }),
        signal: new AbortController().signal,
      }),
      "response-too-large",
    );
    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_REMOTE_IMAGE_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    await expectCode(
      fetchRemoteImage(descriptor, {
        fetcher: async () =>
          response(oversizedStream, { headers: { "content-type": "image/png" }, status: 200 }),
        signal: new AbortController().signal,
      }),
      "response-too-large",
    );
  });

  it("rejects HTML, invalid lengths, empty bodies, and HTTP errors", async () => {
    const cases: ReadonlyArray<readonly [Response, RemoteImageFetchErrorCode]> = [
      [
        response("<html>", { headers: { "content-type": "text/html" }, status: 200 }),
        "unsupported-content-type",
      ],
      [
        response("x", {
          headers: { "content-length": "1e6", "content-type": "image/png" },
          status: 200,
        }),
        "invalid-content-length",
      ],
      [
        response(new Uint8Array(), { headers: { "content-type": "image/png" }, status: 200 }),
        "empty-response",
      ],
      [response("missing", { status: 404 }), "http-error"],
    ];
    for (const [candidate, code] of cases) {
      await expectCode(
        fetchRemoteImage(descriptor, {
          fetcher: async () => candidate,
          signal: new AbortController().signal,
        }),
        code,
      );
    }
  });

  it("maps aborted and ordinary request failures without exposing exception text", async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expectCode(
      fetchRemoteImage(descriptor, {
        fetcher: async () => {
          throw new Error("secret response detail");
        },
        signal: aborted.signal,
      }),
      "timeout",
    );
    await expectCode(
      fetchRemoteImage(descriptor, {
        fetcher: async () => {
          throw new Error("secret response detail");
        },
        signal: new AbortController().signal,
      }),
      "network-error",
    );
  });
});
