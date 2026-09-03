import {
  AnnotationMode,
  PDFWorker,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

import {
  createConversionFailure,
  type PdfConversionOutcome,
} from "@imgconvert/conversion-contract";
import {
  PdfAdapterError,
  convertPdfRequest,
  type LoadedPdfDocument,
  type PdfConversionWorkerCommand,
  type PdfConversionWorkerProgress,
  type PdfConversionWorkerResult,
  type PdfDocumentAdapter,
} from "@imgconvert/web-image-engine";

import { rasterCodecs } from "./raster-codecs";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: PdfConversionWorkerProgress): void;
  postMessage(message: PdfConversionWorkerResult, transfer: Transferable[]): void;
}

interface CanvasAndContext {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
}

class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new PdfAdapterError("decode-failed", "2D canvas is unavailable.");
    return { canvas, context };
  }

  reset(target: CanvasAndContext, width: number, height: number): void {
    if (!target.canvas) throw new PdfAdapterError("decode-failed", "Canvas is unavailable.");
    target.canvas.width = width;
    target.canvas.height = height;
  }

  destroy(target: CanvasAndContext): void {
    if (target.canvas) target.canvas.width = target.canvas.height = 0;
    target.canvas = null;
    target.context = null;
  }
}

class NoDomFilterFactory {
  addFilter(): string {
    return "none";
  }

  addHCMFilter(): string {
    return "none";
  }

  addAlphaFilter(): string {
    return "none";
  }

  addLuminosityFilter(): string {
    return "none";
  }

  addHighlightHCMFilter(): string {
    return "none";
  }

  destroy(): void {}
}

const workerScope = self as unknown as WorkerScope;

function mapLoadError(error: unknown): PdfAdapterError {
  if (error instanceof PdfAdapterError) return error;
  if (
    error instanceof Error &&
    (error.name === "PasswordException" || /password|encrypted/iu.test(error.message))
  ) {
    return new PdfAdapterError("encrypted-pdf", "Encrypted PDF files are not supported.");
  }
  return new PdfAdapterError("decode-failed", "PDF.js could not load the document.");
}

function loadedDocument(
  loadingTask: PDFDocumentLoadingTask,
  pdf: PDFDocumentProxy,
  containsJavaScript: boolean,
  pdfWorker: PDFWorker,
  nativeWorker: Worker,
): LoadedPdfDocument {
  return {
    containsJavaScript,
    async destroy() {
      try {
        await pdf.cleanup();
        await loadingTask.destroy();
      } finally {
        pdfWorker.destroy();
        nativeWorker.terminate();
      }
    },
    pageCount: pdf.numPages,
    async renderPage(pageNumber, dpi, limits) {
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: dpi / 72 });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        const pixels = width * height;
        if (
          !Number.isSafeInteger(width) ||
          !Number.isSafeInteger(height) ||
          width < 1 ||
          height < 1 ||
          !Number.isSafeInteger(pixels) ||
          pixels > limits.maxRuntimePixels ||
          pixels > limits.absolutePixels
        ) {
          throw new PdfAdapterError(
            "pixel-budget-exceeded",
            "PDF page dimensions exceed the active pixel budget.",
          );
        }
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        if (!context) throw new PdfAdapterError("decode-failed", "2D canvas is unavailable.");
        try {
          const renderTask = page.render({
            annotationMode: AnnotationMode.DISABLE,
            background: "rgb(255,255,255)",
            canvas: canvas as unknown as HTMLCanvasElement,
            viewport,
          });
          await renderTask.promise;
          const png = await canvas.convertToBlob({ type: "image/png" });
          return { height, pngBytes: await png.arrayBuffer(), width };
        } finally {
          canvas.width = canvas.height = 0;
        }
      } finally {
        page.cleanup();
      }
    },
  };
}

const pdfAdapter: PdfDocumentAdapter = {
  async load(bytes, limits) {
    const nativeWorker = new Worker(new URL(pdfWorkerUrl, location.href), { type: "module" });
    const pdfWorker = PDFWorker.create({ port: nativeWorker });
    const loadingTask = getDocument({
      CanvasFactory: OffscreenCanvasFactory,
      FilterFactory: NoDomFilterFactory,
      canvasMaxAreaInBytes: limits.maxRuntimePixels * 4,
      data: bytes,
      disableAutoFetch: true,
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
      enableHWA: false,
      enableXfa: false,
      isImageDecoderSupported: false,
      isOffscreenCanvasSupported: true,
      maxImageSize: limits.maxRuntimePixels,
      stopAtErrors: true,
      useSystemFonts: false,
      useWasm: false,
      useWorkerFetch: false,
      worker: pdfWorker,
    });
    loadingTask.onPassword = (updatePassword: (password: string | Error) => void) => {
      updatePassword(new PdfAdapterError("encrypted-pdf", "Password-protected PDF."));
    };
    try {
      const pdf = await loadingTask.promise;
      const javaScriptActions = await pdf.getJSActions();
      const containsJavaScript = (javaScriptActions?.size ?? 0) > 0;
      return loadedDocument(loadingTask, pdf, containsJavaScript, pdfWorker, nativeWorker);
    } catch (error) {
      try {
        await loadingTask.destroy();
      } catch {
        // Preserve the original document failure; the native worker is always terminated below.
      }
      pdfWorker.destroy();
      nativeWorker.terminate();
      throw mapLoadError(error);
    }
  },
};

function isCommand(value: unknown): value is PdfConversionWorkerCommand {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  return (
    command.type === "convert-pdf" &&
    command.schemaVersion === 1 &&
    typeof command.executionId === "string" &&
    command.executionId.length > 0 &&
    typeof command.request === "object" &&
    command.request !== null
  );
}

function workerFailure(): PdfConversionOutcome {
  return Object.freeze({
    failure: createConversionFailure("worker-failed", true, { reason: "worker-exception" }),
    ok: false,
  });
}

workerScope.addEventListener("message", (event) => {
  if (!isCommand(event.data)) return;
  const { executionId, request } = event.data;
  void (async () => {
    let outcome: PdfConversionOutcome;
    try {
      outcome = await convertPdfRequest(
        request,
        pdfAdapter,
        rasterCodecs,
        ({ pageIndex, pageNumber, pageTotal, phase, progress }) => {
          workerScope.postMessage({
            executionId,
            pageIndex,
            pageNumber,
            pageTotal,
            phase,
            progress,
            schemaVersion: 1,
            type: "pdf-progress",
          });
        },
      );
    } catch {
      outcome = workerFailure();
    }
    const response: PdfConversionWorkerResult = {
      executionId,
      outcome,
      schemaVersion: 1,
      type: "pdf-result",
    };
    const transfers = outcome.ok
      ? outcome.result.pages.flatMap((page) => (page.ok ? [page.result.bytes] : []))
      : [];
    workerScope.postMessage(response, transfers);
  })();
});
