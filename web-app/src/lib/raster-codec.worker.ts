import { createConversionFailure, type ConversionOutcome } from "@imgconvert/conversion-contract";
import {
  convertRasterRequest,
  type ConversionWorkerCommand,
  type ConversionWorkerProgress,
  type ConversionWorkerResult,
} from "@imgconvert/web-image-engine";

import { rasterCodecs } from "./raster-codecs";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: ConversionWorkerProgress): void;
  postMessage(message: ConversionWorkerResult, transfer: Transferable[]): void;
}

const workerScope = self as unknown as WorkerScope;

function isCommand(value: unknown): value is ConversionWorkerCommand {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  return (
    command.type === "convert" &&
    command.schemaVersion === 1 &&
    typeof command.executionId === "string" &&
    command.executionId.length > 0 &&
    typeof command.request === "object" &&
    command.request !== null
  );
}

function workerFailure(): ConversionOutcome {
  return Object.freeze({
    failure: createConversionFailure("worker-failed", true, { reason: "worker-exception" }),
    ok: false,
  });
}

workerScope.addEventListener("message", (event) => {
  if (!isCommand(event.data)) return;
  const { executionId, request } = event.data;
  void (async () => {
    let outcome: ConversionOutcome;
    try {
      outcome = await convertRasterRequest(request, rasterCodecs, ({ phase, progress }) => {
        workerScope.postMessage({
          executionId,
          phase,
          progress,
          schemaVersion: 1,
          type: "progress",
        });
      });
    } catch {
      outcome = workerFailure();
    }
    const response: ConversionWorkerResult = {
      executionId,
      outcome,
      schemaVersion: 1,
      type: "result",
    };
    workerScope.postMessage(response, outcome.ok ? [outcome.result.bytes] : []);
  })();
});
