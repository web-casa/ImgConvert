import { createConversionFailure, type ConversionOutcome } from "@imgconvert/conversion-contract";
import {
  convertRasterRequest,
  type ConversionWorkerCommand,
  type ConversionWorkerProgress,
  type ConversionWorkerResult,
} from "@imgconvert/web-image-engine";

import { rasterCodecs } from "../raster-codecs.js";
import { asRuntimeWorkerScope, isWorkerCommand, workerExceptionParams } from "../worker-scope.js";

type RasterWorkerMessage = ConversionWorkerProgress | ConversionWorkerResult;

function workerFailure(error: unknown): ConversionOutcome {
  return Object.freeze({
    failure: createConversionFailure("worker-failed", true, workerExceptionParams(error)),
    ok: false,
  });
}

export function registerRasterWorker(workerGlobal: unknown): void {
  const workerScope = asRuntimeWorkerScope<RasterWorkerMessage>(workerGlobal);
  workerScope.addEventListener("message", (event) => {
    if (!isWorkerCommand(event.data, "convert", 1)) return;
    const command = event.data as ConversionWorkerCommand;
    const { executionId, request } = command;
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
      } catch (error) {
        outcome = workerFailure(error);
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
}
