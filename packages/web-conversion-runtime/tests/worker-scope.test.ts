import { describe, expect, it } from "vitest";

import { asRuntimeWorkerScope, isWorkerCommand, workerExceptionParams } from "../src/worker-scope";

describe("shared worker boundary", () => {
  it("rejects globals that do not implement the Worker messaging surface", () => {
    expect(() => asRuntimeWorkerScope(null)).toThrow(TypeError);
    expect(() => asRuntimeWorkerScope({ addEventListener() {} })).toThrow(TypeError);
    expect(() => asRuntimeWorkerScope({ postMessage() {} })).toThrow(TypeError);
  });

  it("accepts only versioned commands with a non-empty execution ID and object request", () => {
    expect(
      isWorkerCommand(
        { executionId: "job:1", request: {}, schemaVersion: 1, type: "convert" },
        "convert",
        1,
      ),
    ).toBe(true);
    expect(
      isWorkerCommand(
        { executionId: "", request: {}, schemaVersion: 1, type: "convert" },
        "convert",
        1,
      ),
    ).toBe(false);
    expect(
      isWorkerCommand(
        { executionId: "job:1", request: null, schemaVersion: 1, type: "convert" },
        "convert",
        1,
      ),
    ).toBe(false);
    expect(
      isWorkerCommand(
        { executionId: "job:1", request: {}, schemaVersion: 2, type: "convert" },
        "convert",
        1,
      ),
    ).toBe(false);
  });

  it("keeps exception diagnostics typed and bounded", () => {
    const message = "x".repeat(400);
    expect(workerExceptionParams(new TypeError(message))).toEqual({
      exceptionMessage: "x".repeat(256),
      exceptionType: "TypeError",
      reason: "worker-exception",
    });
    expect(workerExceptionParams("failed")).toEqual({
      exceptionType: "string",
      reason: "worker-exception",
    });
  });
});
