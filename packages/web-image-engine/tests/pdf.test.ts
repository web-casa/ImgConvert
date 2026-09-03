import {
  WEB_V1_DESKTOP_LIMITS,
  type PdfConversionOutcome,
  type PdfConversionRequest,
} from "@imgconvert/conversion-contract";
import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

import {
  HeaderProbeError,
  PdfAdapterError,
  PdfConversionScheduler,
  convertPdfRequest,
  probePdfHeader,
  type LoadedPdfDocument,
  type PdfConversionWorkerCommand,
  type PdfConversionWorkerLike,
  type RasterCodecAdapter,
} from "../src/index.js";

class TestImageData {
  readonly data: Uint8ClampedArray;
  readonly height: number;
  readonly width: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

beforeAll(() => {
  globalThis.ImageData = TestImageData as unknown as typeof ImageData;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function onePixelPng(): ArrayBuffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 50, 100, 150, 255]))),
    pngChunk("IEND", new Uint8Array()),
  ]);
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
}

function pdfBytes(version = "1.7"): ArrayBuffer {
  return new TextEncoder().encode(`%PDF-${version}\n%%EOF`).buffer;
}

function request(pages: readonly number[] = [1, 2]): PdfConversionRequest {
  const bytes = pdfBytes();
  return {
    input: { bytes, name: "document.pdf", probe: probePdfHeader(bytes, bytes.byteLength) },
    jobId: "pdf-test",
    schemaVersion: 1,
    settings: {
      dpi: 144,
      pages,
      raster: {
        background: { blue: 255, green: 255, red: 255 },
        lossless: true,
        metadata: "stripAll",
        output: "png",
        quality: null,
        resize: null,
      },
    },
  };
}

const codecs: RasterCodecAdapter = {
  decode: async () => new ImageData(new Uint8ClampedArray([50, 100, 150, 255]), 1, 1),
  encode: async () => onePixelPng(),
};

function documentAdapter(
  options: { containsJavaScript?: boolean; pageCount?: number; rejectPage?: number } = {},
): LoadedPdfDocument {
  return {
    containsJavaScript: options.containsJavaScript ?? false,
    destroy: async () => undefined,
    pageCount: options.pageCount ?? 3,
    renderPage: async (pageNumber) => {
      if (pageNumber === options.rejectPage) {
        throw new PdfAdapterError("decode-failed", "page failed");
      }
      return { height: 1, pngBytes: onePixelPng(), width: 1 };
    },
  };
}

describe("bounded PDF header probe", () => {
  it("accepts supported version headers and rejects polyglots or unsupported versions", () => {
    const input = pdfBytes("2.0");
    expect(probePdfHeader(input, input.byteLength)).toEqual({
      byteLength: input.byteLength,
      format: "pdf",
      version: "2.0",
    });
    expect(() => probePdfHeader(new TextEncoder().encode("x%PDF-1.7"), 9)).toThrow(
      HeaderProbeError,
    );
    expect(() => probePdfHeader(pdfBytes("9.9"), 14)).toThrow(HeaderProbeError);
  });

  it("enforces the PDF-specific byte ceiling before decoding", () => {
    expect(() =>
      probePdfHeader(pdfBytes(), WEB_V1_DESKTOP_LIMITS.maxPdfBytes + 1, WEB_V1_DESKTOP_LIMITS),
    ).toThrowError(expect.objectContaining({ code: "input-too-large" }));
  });
});

describe("PDF conversion boundary", () => {
  it("renders selected pages serially and validates each raster output", async () => {
    const rendered: number[] = [];
    const progress: number[] = [];
    const outcome = await convertPdfRequest(
      request([1, 3]),
      {
        load: async () => ({
          ...documentAdapter(),
          renderPage: async (pageNumber) => {
            rendered.push(pageNumber);
            return { height: 1, pngBytes: onePixelPng(), width: 1 };
          },
        }),
      },
      codecs,
      ({ progress: value }) => progress.push(value),
    );

    expect(rendered).toEqual([1, 3]);
    expect(outcome).toMatchObject({
      ok: true,
      result: {
        pageCount: 3,
        pages: [
          { ok: true, pageNumber: 1 },
          { ok: true, pageNumber: 3 },
        ],
      },
    });
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(
      true,
    );
  });

  it("rejects JavaScript, out-of-range selections, and excessive page counts", async () => {
    await expect(
      convertPdfRequest(
        request([1]),
        { load: async () => documentAdapter({ containsJavaScript: true }) },
        codecs,
      ),
    ).resolves.toMatchObject({ failure: { code: "unsafe-pdf" }, ok: false });
    await expect(
      convertPdfRequest(
        request([4]),
        { load: async () => documentAdapter({ pageCount: 3 }) },
        codecs,
      ),
    ).resolves.toMatchObject({ failure: { code: "invalid-settings" }, ok: false });
    await expect(
      convertPdfRequest(
        request([1]),
        { load: async () => documentAdapter({ pageCount: 501 }) },
        codecs,
      ),
    ).resolves.toMatchObject({ failure: { code: "input-too-large" }, ok: false });
  });

  it("isolates a failed page and continues the remaining selection", async () => {
    const outcome = await convertPdfRequest(
      request([1, 2, 3]),
      { load: async () => documentAdapter({ rejectPage: 2 }) },
      codecs,
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: {
        pages: [
          { ok: true, pageNumber: 1 },
          { failure: { code: "decode-failed" }, ok: false, pageNumber: 2 },
          { ok: true, pageNumber: 3 },
        ],
      },
    });
  });

  it("re-probes transferred bytes and enforces the runtime page-pixel budget", async () => {
    const tampered = request([1]);
    new Uint8Array(tampered.input.bytes)[0] = 0;
    await expect(
      convertPdfRequest(tampered, { load: async () => documentAdapter() }, codecs),
    ).resolves.toMatchObject({ failure: { code: "format-mismatch" }, ok: false });

    await expect(
      convertPdfRequest(
        request([1]),
        {
          load: async () => ({
            ...documentAdapter(),
            renderPage: async () => ({
              height: 5_000,
              pngBytes: onePixelPng(),
              width: 5_000,
            }),
          }),
        },
        codecs,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { pages: [{ failure: { code: "pixel-budget-exceeded" }, ok: false }] },
    });
  });

  it("fails closed when document cleanup cannot complete", async () => {
    await expect(
      convertPdfRequest(
        request([1]),
        {
          load: async () => ({
            ...documentAdapter(),
            destroy: async () => {
              throw new Error("cleanup failed");
            },
          }),
        },
        codecs,
      ),
    ).resolves.toMatchObject({ failure: { code: "worker-failed" }, ok: false });
  });
});

class FakePdfWorker implements PdfConversionWorkerLike {
  readonly messages: PdfConversionWorkerCommand[] = [];
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  terminated = false;

  postMessage(message: PdfConversionWorkerCommand): void {
    this.messages.push(message);
  }

  respond(outcome: PdfConversionOutcome): void {
    const command = this.messages[0];
    if (!command) throw new Error("No PDF command.");
    this.onmessage?.({
      data: { executionId: command.executionId, outcome, schemaVersion: 1, type: "pdf-result" },
    } as MessageEvent<unknown>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("PDF scheduler", () => {
  it("takes source ownership and cancels by terminating the active worker", async () => {
    const worker = new FakePdfWorker();
    const scheduler = new PdfConversionScheduler({ workerFactory: () => worker });
    const source = request([1]);
    const callerBytes = source.input.bytes;
    const handle = scheduler.enqueue(source);
    await Promise.resolve();

    expect(callerBytes.byteLength).toBe(0);
    expect(worker.messages).toHaveLength(1);
    expect(handle.cancel()).toBe(true);
    await expect(handle.outcome).resolves.toMatchObject({ failure: { code: "cancelled" } });
    expect(worker.terminated).toBe(true);
    scheduler.dispose();
  });

  it("accepts matching page results", async () => {
    const worker = new FakePdfWorker();
    const scheduler = new PdfConversionScheduler({ workerFactory: () => worker });
    const handle = scheduler.enqueue(request([1]));
    await Promise.resolve();
    worker.respond({
      ok: true,
      result: {
        durationMs: 2,
        pageCount: 1,
        pages: [
          {
            ok: true,
            pageNumber: 1,
            result: {
              bytes: onePixelPng(),
              durationMs: 1,
              format: "png",
              height: 1,
              pageNumber: 1,
              width: 1,
            },
          },
        ],
      },
    });
    await expect(handle.outcome).resolves.toMatchObject({ ok: true });
    scheduler.dispose();
  });

  it("terminates the worker after malformed output or mismatched progress", async () => {
    const malformedWorker = new FakePdfWorker();
    const malformedScheduler = new PdfConversionScheduler({
      workerFactory: () => malformedWorker,
    });
    const malformedHandle = malformedScheduler.enqueue(request([1]));
    await Promise.resolve();
    const malformedCommand = malformedWorker.messages[0];
    if (!malformedCommand) throw new Error("No malformed PDF command.");
    malformedWorker.onmessage?.({
      data: {
        executionId: malformedCommand.executionId,
        outcome: {
          ok: true,
          result: {
            durationMs: 1,
            pageCount: 1,
            pages: [
              {
                ok: true,
                pageNumber: 1,
                result: {
                  bytes: new ArrayBuffer(0),
                  durationMs: 1,
                  format: "png",
                  height: 1,
                  pageNumber: 1,
                  width: 1,
                },
              },
            ],
          },
        },
        schemaVersion: 1,
        type: "pdf-result",
      },
    } as MessageEvent<unknown>);
    await expect(malformedHandle.outcome).resolves.toMatchObject({
      failure: { code: "worker-failed", params: { reason: "invalid-message" } },
      ok: false,
    });
    expect(malformedWorker.terminated).toBe(true);
    malformedScheduler.dispose();

    const progressWorker = new FakePdfWorker();
    const progressScheduler = new PdfConversionScheduler({ workerFactory: () => progressWorker });
    const progressHandle = progressScheduler.enqueue(request([1]));
    await Promise.resolve();
    const progressCommand = progressWorker.messages[0];
    if (!progressCommand) throw new Error("No progress PDF command.");
    progressWorker.onmessage?.({
      data: {
        executionId: progressCommand.executionId,
        pageIndex: 0,
        pageNumber: 2,
        pageTotal: 1,
        phase: "rendering",
        progress: 0.5,
        schemaVersion: 1,
        type: "pdf-progress",
      },
    } as MessageEvent<unknown>);
    await expect(progressHandle.outcome).resolves.toMatchObject({
      failure: { code: "worker-failed", params: { reason: "invalid-message" } },
      ok: false,
    });
    expect(progressWorker.terminated).toBe(true);
    progressScheduler.dispose();
  });
});
