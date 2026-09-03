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

import { rasterCodecs } from "./raster-codecs";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: ConversionWorkerProgress): void;
  postMessage(message: ConversionWorkerResult, transfer: Transferable[]): void;
}

const workerScope = self as unknown as WorkerScope;
let wasmInitialization: Promise<void> | undefined;

function ensureWasm(): Promise<void> {
  wasmInitialization ??= initWasm(new URL(resvgWasmUrl, location.href));
  return wasmInitialization;
}

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
