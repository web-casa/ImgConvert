import { describe, expect, it, vi } from "vitest";

import {
  ARCHIVE_SCHEMA_VERSION,
  assertArchiveRequest,
  isArchiveWorkerResult,
  sanitizeBatchFileName,
} from "../src/index";
import { registerArchiveWorker } from "../src/workers/archive";

class FakeArchiveScope {
  readonly messages: unknown[] = [];
  #listener: ((event: MessageEvent<unknown>) => void) | undefined;

  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.#listener = listener;
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  dispatch(data: unknown): void {
    this.#listener?.({ data } as MessageEvent<unknown>);
  }
}

describe("shared archive runtime", () => {
  it("keeps filename validation independent from Web UI code", () => {
    expect(sanitizeBatchFileName("CON.png")).toBe("_CON.png");
    expect(() =>
      assertArchiveRequest({
        files: [{ blob: new Blob(["ok"]), name: "../result.png" }],
        maxBytes: 1024,
      }),
    ).toThrow("Archive entry is invalid");
  });

  it("ignores malformed commands and creates a bounded stored ZIP", async () => {
    const scope = new FakeArchiveScope();
    registerArchiveWorker(scope);
    scope.dispatch({ type: "create-archive" });
    expect(scope.messages).toEqual([]);

    scope.dispatch({
      executionId: "archive-test:1",
      request: {
        files: [{ blob: new Blob(["local image bytes"]), name: "result.txt" }],
        maxBytes: 4096,
      },
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      type: "create-archive",
    });

    await vi.waitFor(() => expect(scope.messages).toHaveLength(2));
    expect(scope.messages[0]).toMatchObject({ completed: 1, type: "archive-progress" });
    expect(isArchiveWorkerResult(scope.messages[1])).toBe(true);
  });
});
