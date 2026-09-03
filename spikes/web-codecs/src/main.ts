import type {
  BenchmarkResult,
  BrowserMatrixResult,
  NativeDecodeResult,
  RasterFormat,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

const MAX_SEED_PIXELS = 24_000_000;
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

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.id) || (candidate.id as number) < 1) return false;

  if (candidate.type === "error") return typeof candidate.error === "string";
  if (candidate.type === "stress-result") {
    return Number.isSafeInteger(candidate.completedIterations);
  }
  if (candidate.type === "benchmark-result") {
    return typeof candidate.result === "object" && candidate.result !== null;
  }
  return (
    candidate.type === "matrix-result" &&
    typeof candidate.result === "object" &&
    candidate.result !== null &&
    Array.isArray(candidate.samples)
  );
}

class CodecClient {
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

  async runBenchmark(
    seed: ArrayBuffer,
    output: RasterFormat,
    iterations = 1,
  ): Promise<BenchmarkResult> {
    const response = await this.#request(
      { bytes: seed, id: this.#nextId++, iterations, output, type: "benchmark" },
      [seed],
    );
    if (response.type !== "benchmark-result") {
      throw new Error(`Unexpected worker response: ${response.type}`);
    }
    return response.result;
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
    this.#replaceWorker(new DOMException("Codec conversion cancelled.", "AbortError"));
    const terminationCallMs = performance.now() - terminationStartedAt;

    let cancelled = false;
    try {
      await pending;
    } catch (error) {
      cancelled = error instanceof DOMException && error.name === "AbortError";
    }
    if (!cancelled) throw new Error("Stress conversion completed instead of being cancelled.");

    const recovered = (await this.runMatrix(await createSeedPng(32, 24))).matrix.length === 16;
    return {
      cancelAndRecoveryMs: performance.now() - startedAt,
      recovered,
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

    const recovered = (await this.runMatrix(await createSeedPng(32, 24))).matrix.length === 16;
    return { recovered, rejected };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#replaceWorker(new Error("Codec client disposed."), false);
  }

  #createWorker(): Worker {
    const worker = new Worker(new URL("./codec.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (worker !== this.#worker) return;
      if (!isWorkerResponse(event.data)) {
        this.#replaceWorker(new Error("Codec worker returned an invalid response."), true, worker);
        return;
      }

      const response = event.data;
      const pending = this.#pending.get(response.id);
      if (!pending) return;
      this.#pending.delete(response.id);

      if (response.type === "error") {
        pending.reject(new Error(response.error));
        this.#replaceWorker(new Error("Codec worker was recycled after a failed request."));
      } else {
        pending.resolve(response);
      }
    });
    worker.addEventListener("error", (event) => {
      this.#replaceWorker(new Error(event.message || "Codec worker failed."), true, worker);
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
    if (this.#disposed) return Promise.reject(new Error("Codec client is disposed."));
    if (this.#pending.size > 0) {
      return Promise.reject(new Error("The codec worker only accepts one request at a time."));
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
            `Could not send request ${request.id} to the codec worker: ${
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

function createPngHeaderOnly(width: number, height: number): ArrayBuffer {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 0xffffffff ||
    height > 0xffffffff
  ) {
    throw new RangeError("PNG probe dimensions must be positive unsigned 32-bit integers.");
  }
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes.buffer;
}

async function measureMemory(): Promise<number | null> {
  const memoryPerformance = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  };
  if (!memoryPerformance.measureUserAgentSpecificMemory) return null;
  try {
    return (await memoryPerformance.measureUserAgentSpecificMemory()).bytes;
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") return null;
    throw error;
  }
}

const client = new CodecClient();
const status = document.querySelector<HTMLPreElement>("#status");
const runButton = document.querySelector<HTMLButtonElement>("#run");

async function runMatrix(): Promise<BrowserMatrixResult> {
  const result = await client.runMatrix(await createSeedPng(96, 64));
  if (status) status.textContent = JSON.stringify(result, null, 2);
  return result;
}

async function runLargeBenchmark(iterations = 8): Promise<{
  measurements: Array<{ memoryBytes: number | null; result: BenchmarkResult }>;
  pixels: number;
}> {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 8) {
    throw new RangeError("Large benchmark iterations must be an integer from 1 to 8.");
  }
  const width = 6000;
  const height = 4000;
  const seed = await createSeedPng(width, height);
  const measurements = [];
  for (let index = 0; index < iterations; index += 1) {
    const result = await client.runBenchmark(seed.slice(0), "avif");
    measurements.push({ memoryBytes: await measureMemory(), result });
  }
  return { measurements, pixels: width * height };
}

async function verifyRuntimeBudget(
  width: number,
  height: number,
): Promise<{
  elapsedMs: number;
  message: string;
  rejectedBeforeDecode: boolean;
}> {
  const startedAt = performance.now();
  try {
    await client.runBenchmark(createPngHeaderOnly(width, height), "avif");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      elapsedMs: performance.now() - startedAt,
      message,
      rejectedBeforeDecode: message.includes("24,000,000-pixel runtime budget"),
    };
  }
  throw new Error(`${width} × ${height} unexpectedly passed the runtime budget.`);
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
    __imgConvertCodecSpike: {
      createSeedPng: typeof createSeedPng;
      runLargeBenchmark: typeof runLargeBenchmark;
      runMatrix: typeof runMatrix;
      verifyCancellation: () => Promise<{
        cancelAndRecoveryMs: number;
        recovered: boolean;
        terminationCallMs: number;
      }>;
      verifyInvalidInputRecovery: () => Promise<{ recovered: boolean; rejected: boolean }>;
      verifyRuntimeBudget: typeof verifyRuntimeBudget;
    };
  }
}

window.__imgConvertCodecSpike = {
  createSeedPng,
  runLargeBenchmark,
  runMatrix,
  verifyCancellation: async () => client.verifyCancellation(await createSeedPng(2048, 2048)),
  verifyInvalidInputRecovery: () => client.verifyInvalidInputRecovery(),
  verifyRuntimeBudget,
};
