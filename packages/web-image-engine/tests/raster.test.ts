import type { ConversionRequest } from "@imgconvert/conversion-contract";
import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

import {
  convertRasterRequest,
  flattenAlpha,
  outputFileName,
  outputMimeType,
  pdfPageOutputFileName,
  resizeBilinear,
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

function chunk(type: string, data: Uint8Array): Buffer {
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
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 100, 162, 87, 128]))),
    chunk("IEND", new Uint8Array()),
  ]);
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
}

function largeOnePixelPng(): ArrayBuffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", Buffer.alloc(1024 * 1024 + 1)),
    chunk("IEND", new Uint8Array()),
  ]);
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
}

function onePixelJpeg(): ArrayBuffer {
  return Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0).buffer;
}

function animatedGif(): ArrayBuffer {
  const base = Uint8Array.of(71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255);
  const image = Uint8Array.of(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0x4c, 0);
  const gif = Buffer.concat([base, image, image, Uint8Array.of(0x3b)]);
  return gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength);
}

function request(
  bytes: ArrayBuffer,
  colorProfile: "none" | "nonSrgb" | "unknown" = "none",
): ConversionRequest {
  return {
    input: {
      bytes,
      name: "source.png",
      probe: {
        alpha: "present",
        animation: "static",
        byteLength: bytes.byteLength,
        colorProfile,
        format: "png",
        height: 1,
        metadata: {
          exif: "absent",
          iptc: "absent",
          orientation: null,
          xmp: "absent",
        },
        width: 1,
      },
    },
    jobId: "raster-test",
    schemaVersion: 1,
    settings: {
      background: { blue: 255, green: 255, red: 255 },
      lossless: true,
      metadata: "stripAll",
      output: "png",
      quality: null,
      resize: null,
    },
  };
}

describe("raster helpers", () => {
  it("flattens alpha against the selected RGB background", () => {
    const source = new ImageData(new Uint8ClampedArray([100, 50, 0, 128]), 1, 1);
    const output = flattenAlpha(source, { blue: 220, green: 210, red: 200 });
    expect([...output.data]).toEqual([150, 130, 110, 255]);
  });

  it("resizes RGBA pixels without mutating the source", () => {
    const source = new ImageData(new Uint8ClampedArray([20, 40, 60, 255]), 1, 1);
    const output = resizeBilinear(source, 2, 2);
    expect(output.width).toBe(2);
    expect(output.height).toBe(2);
    expect([...output.data]).toEqual([
      20, 40, 60, 255, 20, 40, 60, 255, 20, 40, 60, 255, 20, 40, 60, 255,
    ]);
    expect(source.width).toBe(1);
  });

  it("sanitizes download names and emits exact image MIME types", () => {
    expect(outputFileName("../../bad:name.PNG", "jpeg")).toBe("bad-name.jpg");
    expect(outputFileName("...", "webp")).toBe("converted-image.webp");
    expect(outputFileName("photo\u202egnp.exe.png", "jpeg")).toBe("photo-gnp.exe.jpg");
    expect(outputFileName("unsafe\u0085name.png", "png")).toBe("unsafe-name.png");
    expect(outputMimeType("avif")).toBe("image/avif");
    expect(outputMimeType("jpeg")).toBe("image/jpeg");
  });

  it("creates stable, sanitized PDF page output names", () => {
    expect(pdfPageOutputFileName("report.final.pdf", 7, "jpeg")).toBe("report.final-page-007.jpg");
    expect(() => pdfPageOutputFileName("report.pdf", 0, "png")).toThrow(/positive/u);
  });
});

describe("raster conversion boundary", () => {
  it("returns only output that passes a second header and pixel decode", async () => {
    const transparentPixel = new ImageData(new Uint8ClampedArray([100, 162, 87, 128]), 1, 1);
    const codecs: RasterCodecAdapter = {
      decode: async () => transparentPixel,
      encode: async () => onePixelPng(),
    };
    const phases: string[] = [];
    const outcome = await convertRasterRequest(request(onePixelPng()), codecs, ({ phase }) =>
      phases.push(phase),
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: { format: "png", height: 1, width: 1 },
    });
    expect(phases).toEqual(["loading", "decoding", "resizing", "encoding", "validating"]);
  });

  it("validates generated output beyond the bounded input probe window", async () => {
    const transparentPixel = new ImageData(new Uint8ClampedArray([100, 162, 87, 128]), 1, 1);
    const codecs: RasterCodecAdapter = {
      decode: async () => transparentPixel,
      encode: async () => largeOnePixelPng(),
    };

    const outcome = await convertRasterRequest(request(largeOnePixelPng()), codecs);

    expect(outcome).toMatchObject({
      ok: true,
      result: { format: "png", height: 1, width: 1 },
    });
  });

  it("fails closed before decoding a known non-sRGB profile", async () => {
    let decoded = false;
    const codecs: RasterCodecAdapter = {
      decode: async () => {
        decoded = true;
        return new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
      },
      encode: async () => onePixelPng(),
    };
    const outcome = await convertRasterRequest(request(onePixelPng(), "nonSrgb"), codecs);
    expect(outcome).toMatchObject({
      failure: { code: "unsupported-color-profile" },
      ok: false,
    });
    expect(decoded).toBe(false);
  });

  it("fails closed before decoding an unrecognized embedded color profile", async () => {
    const codecs: RasterCodecAdapter = {
      decode: async () => new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1),
      encode: async () => onePixelPng(),
    };
    const outcome = await convertRasterRequest(request(onePixelPng(), "unknown"), codecs);
    expect(outcome).toMatchObject({
      failure: { code: "unsupported-color-profile" },
      ok: false,
    });
  });

  it("re-probes worker input bytes and rejects a forged format claim", async () => {
    const forged = request(onePixelJpeg());
    const codecs: RasterCodecAdapter = {
      decode: async () => new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1),
      encode: async () => onePixelPng(),
    };

    await expect(convertRasterRequest(forged, codecs)).resolves.toMatchObject({
      failure: { code: "format-mismatch" },
      ok: false,
    });
  });

  it("re-probes GIF animation and rejects it before codec loading", async () => {
    const bytes = animatedGif();
    const base = request(bytes);
    const forged: ConversionRequest = {
      ...base,
      input: {
        ...base.input,
        name: "animated.gif",
        probe: { ...base.input.probe, byteLength: bytes.byteLength, format: "gif" },
      },
    };
    let decoded = false;
    const codecs: RasterCodecAdapter = {
      decode: async () => {
        decoded = true;
        return new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
      },
      encode: async () => onePixelPng(),
    };

    await expect(convertRasterRequest(forged, codecs)).resolves.toMatchObject({
      failure: { code: "animated-input" },
      ok: false,
    });
    expect(decoded).toBe(false);
  });

  it("rejects decoded dimensions that differ from the verified header", async () => {
    const codecs: RasterCodecAdapter = {
      decode: async () => new ImageData(new Uint8ClampedArray(2 * 2 * 4).fill(255), 2, 2),
      encode: async () => onePixelPng(),
    };

    await expect(convertRasterRequest(request(onePixelPng()), codecs)).resolves.toMatchObject({
      failure: { code: "decode-failed" },
      ok: false,
    });
  });
});
