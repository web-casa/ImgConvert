import { WEB_V1_DESKTOP_LIMITS } from "@imgconvert/conversion-contract";
import { describe, expect, it, vi } from "vitest";

import {
  QueueProbeError,
  remainingQueueOutputBytes,
  type QueueConversionResult,
  admitFiles,
  formatMismatch,
  normalizeProbeFailure,
  probeImageFile,
  probeRasterFile,
} from "../src/queue";

function uint32BigEndian(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

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

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  return concat(
    uint32BigEndian(data.byteLength),
    typeBytes,
    data,
    uint32BigEndian(crc32(concat(typeBytes, data))),
  );
}

function makePng(width: number, height: number): Uint8Array {
  const ihdr = concat(
    uint32BigEndian(width),
    uint32BigEndian(height),
    Uint8Array.of(8, 6, 0, 0, 0),
  );
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array()),
  );
}

function makeGif(animated = false): Uint8Array {
  const base = Uint8Array.of(71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255);
  const image = Uint8Array.of(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0x4c, 0);
  return concat(base, image, ...(animated ? [image] : []), Uint8Array.of(0x3b));
}

function fakeFile(name: string, bytes: Uint8Array): File {
  return {
    name,
    size: bytes.byteLength,
    slice: (start?: number, end?: number) => new Blob([bytes.slice(start, end)]),
    type: name.endsWith(".svg") ? "image/svg+xml" : "image/png",
  } as File;
}

function pdfHeader(version = "1.7"): Uint8Array {
  return new TextEncoder().encode(`%PDF-${version}\n%%EOF`);
}

describe("shared browser import admission", () => {
  it("accepts files in order and rejects additions beyond count and byte budgets", () => {
    const limits = { ...WEB_V1_DESKTOP_LIMITS, maxQueueFiles: 2, maxTotalSourceBytes: 10 };
    const files = [
      { name: "one.png", size: 4 },
      { name: "two.png", size: 6 },
      { name: "three.png", size: 1 },
    ];
    const admission = admitFiles(0, 0, files, limits);

    expect(admission.accepted.map(({ name }) => name)).toEqual(["one.png", "two.png"]);
    expect(admission.rejected[0]?.failure.code).toBe("queue-file-limit");
  });

  it("does not consume a queue slot for a byte-budget rejection", () => {
    const limits = { ...WEB_V1_DESKTOP_LIMITS, maxQueueFiles: 2, maxTotalSourceBytes: 5 };
    const admission = admitFiles(
      0,
      0,
      [
        { name: "large.png", size: 6 },
        { name: "small.png", size: 5 },
      ],
      limits,
    );

    expect(admission.rejected[0]?.failure.code).toBe("queue-byte-limit");
    expect(admission.accepted[0]?.name).toBe("small.png");
  });
});

describe("shared browser file probing", () => {
  it("reads only the bounded prefix and returns real PNG dimensions", async () => {
    const bytes = makePng(320, 180);
    const file = fakeFile("photo.png", bytes);
    const result = await probeRasterFile(file, new AbortController().signal);

    expect(result).toMatchObject({ format: "png", height: 180, width: 320 });
  });

  it("reads GIF through its trailer and rejects animation before conversion", async () => {
    await expect(
      probeImageFile(fakeFile("still.gif", makeGif()), new AbortController().signal),
    ).resolves.toMatchObject({ animation: "static", format: "gif", height: 1, width: 1 });
    await expect(
      probeImageFile(fakeFile("animated.gif", makeGif(true)), new AbortController().signal),
    ).rejects.toMatchObject({ code: "animated-input" });
  });

  it("rejects an oversized GIF after its prefix without reading the full file", async () => {
    const prefix = makeGif();
    const slice = vi.fn((start: number, end: number) => {
      if (start === 0 && end < WEB_V1_DESKTOP_LIMITS.maxRasterBytes) {
        return new Blob([new Uint8Array(prefix).buffer]);
      }
      throw new Error("full GIF read must not occur");
    });
    const file = {
      name: "oversized.gif",
      size: WEB_V1_DESKTOP_LIMITS.maxRasterBytes + 1,
      slice,
      type: "image/gif",
    } as unknown as File;

    await expect(probeImageFile(file, new AbortController().signal)).rejects.toMatchObject({
      code: "input-too-large",
      params: { limitBytes: WEB_V1_DESKTOP_LIMITS.maxRasterBytes },
    });
    expect(slice).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized files before calling slice", async () => {
    const slice = vi.fn();
    const file = {
      name: "large.png",
      size: WEB_V1_DESKTOP_LIMITS.maxRasterBytes + 1,
      slice,
    } as unknown as File;

    await expect(probeRasterFile(file, new AbortController().signal)).rejects.toMatchObject({
      code: "input-too-large",
    });
    expect(slice).not.toHaveBeenCalled();
  });

  it("checks cancellation before reading and preserves safe error codes", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      probeRasterFile(fakeFile("photo.png", makePng(1, 1)), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(normalizeProbeFailure(new QueueProbeError("input-empty"))).toEqual({
      code: "input-empty",
      params: {},
    });
    expect(normalizeProbeFailure(new Error("private filesystem detail"))).toEqual({
      code: "read-failed",
      params: {},
    });
  });

  it("trusts magic bytes over a conflicting extension and reports the mismatch", async () => {
    const file = fakeFile("renamed.jpg", makePng(8, 6));
    const result = await probeRasterFile(file, new AbortController().signal);

    expect(formatMismatch(file.name, result.format)).toEqual({ actual: "png", expected: "jpeg" });
    expect(formatMismatch("photo.unknown", result.format)).toBeUndefined();
  });

  it("validates vector-only SVG and rejects active or linked content", async () => {
    const safe = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#326a39"/></svg>',
    );
    await expect(
      probeImageFile(fakeFile("vector.svg", safe), new AbortController().signal),
    ).resolves.toMatchObject({ format: "svg", height: 180, width: 320 });

    const linked = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://example.com/tracker.png"/></svg>',
    );
    await expect(
      probeImageFile(fakeFile("linked.svg", linked), new AbortController().signal),
    ).rejects.toMatchObject({ code: "unsafe-svg" });
  });

  it("uses raster magic before an SVG extension and bounds SVG before a full read", async () => {
    await expect(
      probeImageFile(fakeFile("renamed.svg", makePng(12, 7)), new AbortController().signal),
    ).resolves.toMatchObject({ format: "png", height: 7, width: 12 });

    const prefix = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    );
    const slice = vi.fn(() => new Blob([prefix]));
    const oversized = {
      name: "oversized.svg",
      size: WEB_V1_DESKTOP_LIMITS.maxSvgBytes + 1,
      slice,
      type: "image/svg+xml",
    } as unknown as File;
    await expect(probeImageFile(oversized, new AbortController().signal)).rejects.toMatchObject({
      code: "input-too-large",
    });
    expect(slice).toHaveBeenCalledTimes(1);
  });

  it("detects PDF magic independently of its extension and preserves the header version", async () => {
    await expect(
      probeImageFile(fakeFile("renamed.png", pdfHeader("2.0")), new AbortController().signal),
    ).resolves.toMatchObject({ format: "pdf", version: "2.0" });
    await expect(
      probeImageFile(fakeFile("renamed.pdf", makePng(12, 7)), new AbortController().signal),
    ).resolves.toMatchObject({ format: "png", height: 7, width: 12 });
  });

  it("applies the 256 MiB PDF limit without imposing the 32 MiB raster limit", async () => {
    const prefix = pdfHeader();
    const slice = vi.fn(() => new Blob([prefix.buffer as ArrayBuffer]));
    const withinPdfLimit = {
      name: "large.pdf",
      size: WEB_V1_DESKTOP_LIMITS.maxRasterBytes + 1,
      slice,
      type: "application/pdf",
    } as unknown as File;
    await expect(
      probeImageFile(withinPdfLimit, new AbortController().signal),
    ).resolves.toMatchObject({
      byteLength: WEB_V1_DESKTOP_LIMITS.maxRasterBytes + 1,
      format: "pdf",
    });
    expect(slice).toHaveBeenCalledTimes(1);

    const oversizedSlice = vi.fn();
    const oversizedPdf = {
      name: "oversized.pdf",
      size: WEB_V1_DESKTOP_LIMITS.maxPdfBytes + 1,
      slice: oversizedSlice,
      type: "application/pdf",
    } as unknown as File;
    await expect(probeImageFile(oversizedPdf, new AbortController().signal)).rejects.toMatchObject({
      code: "input-too-large",
    });
    expect(oversizedSlice).not.toHaveBeenCalled();
  });
});

describe("retained queue output budget", () => {
  it("counts all PDF pages and raster results and restores capacity after removal", () => {
    const limits = { ...WEB_V1_DESKTOP_LIMITS, maxTotalOutputBytes: 10 };
    const result = (size: number) =>
      ({ blob: new Blob([new Uint8Array(size)]) }) as QueueConversionResult;
    const entries = [{ result: result(3), additionalResults: [result(4)] }, { result: result(3) }];
    expect(remainingQueueOutputBytes(entries, limits)).toBe(0);
    entries.pop();
    expect(remainingQueueOutputBytes(entries, limits)).toBe(3);
    expect(remainingQueueOutputBytes([], limits)).toBe(10);
    expect(remainingQueueOutputBytes([{ result: result(11) }], limits)).toBe(0);
  });
});
