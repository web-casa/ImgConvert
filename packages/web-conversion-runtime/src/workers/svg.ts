import { createConversionFailure, type ConversionOutcome } from "@imgconvert/conversion-contract";
import {
  convertSvgRequest,
  type ConversionWorkerCommand,
  type ConversionWorkerProgress,
  type ConversionWorkerResult,
  type SvgRenderAdapter,
} from "@imgconvert/web-image-engine";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasmUrl from "@resvg/resvg-wasm/index_bg.wasm?url";

import { rasterCodecs } from "../raster-codecs.js";
import { retryableLazy } from "../retryable-lazy.js";
import { asRuntimeWorkerScope, isWorkerCommand, workerExceptionParams } from "../worker-scope.js";

type SvgWorkerMessage = ConversionWorkerProgress | ConversionWorkerResult;

const ensureWasm = retryableLazy(() => initWasm(new URL(resvgWasmUrl, location.href)));

const svgRenderer: SvgRenderAdapter = {
  async render(svg, expectedWidth, expectedHeight) {
    await ensureWasm();
    const renderer = new Resvg(svg, {
      fitTo: { mode: "original" },
      font: { loadSystemFonts: false },
      imageRendering: 0,
      shapeRendering: 2,
      textRendering: 2,
    });
    try {
      if (renderer.imagesToResolve().length > 0) {
        throw new Error("The validated SVG still contains an unresolved image reference.");
      }
      if (renderer.width !== expectedWidth || renderer.height !== expectedHeight) {
        throw new Error("The SVG renderer dimensions do not match the validated dimensions.");
      }
      const rendered = renderer.render();
      try {
        if (rendered.width !== expectedWidth || rendered.height !== expectedHeight) {
          throw new Error("The rendered PNG dimensions do not match the validated dimensions.");
        }
        return Uint8Array.from(rendered.asPng()).buffer;
      } finally {
        rendered.free();
      }
    } finally {
      renderer.free();
    }
  },
};

function workerFailure(error: unknown): ConversionOutcome {
  return Object.freeze({
    failure: createConversionFailure("worker-failed", true, workerExceptionParams(error)),
    ok: false,
  });
}

export function registerSvgWorker(workerGlobal: unknown): void {
  const workerScope = asRuntimeWorkerScope<SvgWorkerMessage>(workerGlobal);
  workerScope.addEventListener("message", (event) => {
    if (!isWorkerCommand(event.data, "convert", 1)) return;
    const command = event.data as ConversionWorkerCommand;
    const { executionId, request } = command;
    void (async () => {
      let outcome: ConversionOutcome;
      try {
        outcome = await convertSvgRequest(
          request,
          svgRenderer,
          rasterCodecs,
          ({ phase, progress }) => {
            workerScope.postMessage({
              executionId,
              phase,
              progress,
              schemaVersion: 1,
              type: "progress",
            });
          },
        );
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
