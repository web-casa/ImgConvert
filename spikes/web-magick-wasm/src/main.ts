import type {
  BrowserMatrixResult,
  NativeDecodeResult,
  RasterFormat,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

const MIME_TYPES: Record<RasterFormat, string> = {
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

type PendingRequest = {
  reject: (reason: Error) => void;
  resolve: (response: WorkerResponse) => void;
};

const MAX_SEED_PIXELS = 16_777_216;

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.id) || (candidate.id as number) < 1) return false;

  if (candidate.type === "error") return typeof candidate.error === "string";
  if (candidate.type === "stress-result") {
    return Number.isSafeInteger(candidate.completedIterations);
  }
  return (
    candidate.type === "matrix-result" &&
    typeof candidate.result === "object" &&
    candidate.result !== null &&
    Array.isArray(candidate.samples)
  );
}

class SpikeClient {
  readonly #pending = new Map<number, PendingRequest>();
  #disposed = false;
  #nextId = 1;
  #worker = this.#createWorker();

  async runMatrix(seed: ArrayBuffer): Promise<BrowserMatrixResult> {
    const response = await this.#request({ bytes: seed, id: this.#nextId++, type: "matrix" }, [
      seed,
    ]);
    if (response.type !== "matrix-result") {
      throw new Error(`Unexpected worker response: ${response.type}`);
    }

    return {
      ...response.result,
      nativeDecodes: await Promise.all(
        response.samples.map(({ bytes, format }) => this.#decodeNatively(format, bytes)),
      ),
    };
  }

  async verifyCancellation(
    seed: ArrayBuffer,
  ): Promise<{ cancelAndRecoveryMs: number; recovered: boolean; terminationCallMs: number }> {
    const requestId = this.#nextId++;
    const startedAt = performance.now();
    const pending = this.#request(
      { bytes: seed, id: requestId, iterations: 1000, type: "stress" },
      [seed],
    );

    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
    const terminationStartedAt = performance.now();
    this.#replaceWorker(new DOMException("Spike conversion cancelled.", "AbortError"));
    const terminationCallMs = performance.now() - terminationStartedAt;

    let cancelled = false;
    try {
      await pending;
    } catch (error) {
      cancelled = error instanceof DOMException && error.name === "AbortError";
    }

    if (!cancelled) {
      throw new Error("Stress conversion completed instead of being cancelled.");
    }

    const recoverySeed = await createSeedPng(32, 24);
    const recoveredResult = await this.runMatrix(recoverySeed);
    return {
      cancelAndRecoveryMs: performance.now() - startedAt,
      recovered: recoveredResult.matrix.length === 16,
      terminationCallMs,
    };
  }

  async verifyInvalidInputRecovery(): Promise<{ recovered: boolean; rejected: boolean }> {
    let rejected = false;
    try {
      await this.runMatrix(new Uint8Array([0x49, 0x4d, 0x47, 0x43]).buffer);
    } catch {
      rejected = true;
    }

    if (!rejected) throw new Error("Invalid image input was accepted.");
    const recoveredResult = await this.runMatrix(await createSeedPng(32, 24));
    return { recovered: recoveredResult.matrix.length === 16, rejected };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#replaceWorker(new Error("Spike client disposed."), false);
  }

  #createWorker(): Worker {
    const worker = new Worker(new URL("./magick.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (worker !== this.#worker) return;
      if (!isWorkerResponse(event.data)) {
        this.#replaceWorker(new Error("Raster worker returned an invalid response."), true, worker);
        return;
      }

      const response = event.data;
      const pending = this.#pending.get(response.id);
      if (!pending) return;

      this.#pending.delete(response.id);
      if (response.type === "error") {
        pending.reject(new Error(response.error));
        this.#replaceWorker(new Error("Raster worker was recycled after a failed request."));
      } else {
        pending.resolve(response);
      }
    });
    worker.addEventListener("error", (event) => {
      this.#replaceWorker(new Error(event.message || "Raster worker failed."), true, worker);
    });
    return worker;
  }

  #replaceWorker(error: Error, recreate = true, sourceWorker = this.#worker): void {
    if (sourceWorker !== this.#worker) return;
    sourceWorker.terminate();
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    if (recreate && !this.#disposed) this.#worker = this.#createWorker();
  }

  #request(
    request: WorkerRequest,
    transfer: Transferable[],
  ): Promise<Exclude<WorkerResponse, { type: "error" }>> {
    if (this.#disposed) return Promise.reject(new Error("Spike client is disposed."));
    if (this.#pending.size > 0) {
      return Promise.reject(new Error("The raster worker only accepts one request at a time."));
    }

    return new Promise((resolve, reject) => {
      this.#pending.set(request.id, {
        reject,
        resolve: (response) => resolve(response as Exclude<WorkerResponse, { type: "error" }>),
      });
      try {
        this.#worker.postMessage(request, transfer);
      } catch (error) {
        this.#pending.delete(request.id);
        reject(
          new Error(
            `Could not send request ${request.id} to the raster worker: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
    });
  }

  async #decodeNatively(format: RasterFormat, bytes: ArrayBuffer): Promise<NativeDecodeResult> {
    try {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: MIME_TYPES[format] }));
      const result: NativeDecodeResult = {
        format,
        height: bitmap.height,
        supported: true,
        width: bitmap.width,
      };
      bitmap.close();
      return result;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        format,
        supported: false,
      };
    }
  }
}

async function createSeedPng(width: number, height: number): Promise<ArrayBuffer> {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_SEED_PIXELS
  ) {
    throw new RangeError(
      `Seed dimensions must be positive integers totaling at most ${MAX_SEED_PIXELS} pixels.`,
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable.");

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#1f7a55");
  gradient.addColorStop(0.5, "#f2e8cf");
  gradient.addColorStop(1, "#ef8354");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(20, 30, 40, 0.55)";
  context.fillRect(width / 4, height / 4, width / 2, height / 2);
  context.clearRect(width - Math.max(4, width / 8), 0, Math.max(4, width / 8), height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Canvas PNG encoding failed."));
    }, "image/png");
  });
  return blob.arrayBuffer();
}

const client = new SpikeClient();
const status = document.querySelector<HTMLPreElement>("#status");
const runButton = document.querySelector<HTMLButtonElement>("#run");

async function runMatrix(): Promise<BrowserMatrixResult> {
  const result = await client.runMatrix(await createSeedPng(96, 64));
  if (status) status.textContent = JSON.stringify(result, null, 2);
  return result;
}

runButton?.addEventListener("click", () => {
  if (status) status.textContent = "Running…";
  void runMatrix().catch((error: unknown) => {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  });
});

window.addEventListener("beforeunload", () => client.dispose());

declare global {
  interface Window {
    __imgConvertSpike: {
      createSeedPng: typeof createSeedPng;
      runMatrix: typeof runMatrix;
      verifyCancellation: () => Promise<{
        cancelAndRecoveryMs: number;
        recovered: boolean;
        terminationCallMs: number;
      }>;
      verifyInvalidInputRecovery: () => Promise<{ recovered: boolean; rejected: boolean }>;
    };
  }
}

window.__imgConvertSpike = {
  createSeedPng,
  runMatrix,
  verifyCancellation: async () => client.verifyCancellation(await createSeedPng(2048, 2048)),
  verifyInvalidInputRecovery: () => client.verifyInvalidInputRecovery(),
};
