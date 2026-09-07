import { describe, expect, it } from "vitest";

import { HeaderProbeError, probeRasterHeader } from "../src/index.js";

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function uint16BigEndian(value: number): Uint8Array {
  return Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
}

function uint24LittleEndian(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff);
}

function uint32BigEndian(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function uint32LittleEndian(value: number): Uint8Array {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function makeBmp(width: number, height: number, bitsPerPixel: 24 | 32 = 24): Uint8Array {
  const stride = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const pixelBytes = stride * height;
  const output = new Uint8Array(54 + pixelBytes);
  const view = new DataView(output.buffer);
  output.set(text("BM"), 0);
  view.setUint32(2, output.byteLength, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, bitsPerPixel, true);
  view.setUint32(34, pixelBytes, true);
  return output;
}

function makeV4Bmp(colorSpace: number): Uint8Array {
  const info = makeBmp(1, 1);
  const output = new Uint8Array(14 + 108 + 4);
  output.set(info.subarray(0, 54), 0);
  output.set(info.subarray(54), 122);
  const view = new DataView(output.buffer);
  view.setUint32(2, output.byteLength, true);
  view.setUint32(10, 122, true);
  view.setUint32(14, 108, true);
  view.setUint32(70, colorSpace, true);
  return output;
}

function makeGif(
  options: Readonly<{ animated?: boolean; icc?: boolean; transparent?: boolean }> = {},
): Uint8Array {
  const base = Uint8Array.of(71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255);
  const control = options.transparent
    ? Uint8Array.of(0x21, 0xf9, 4, 1, 0, 0, 0, 0)
    : new Uint8Array();
  const icc = options.icc
    ? concat(Uint8Array.of(0x21, 0xff, 11), text("ICCRGBG1012"), Uint8Array.of(1, 0, 0))
    : new Uint8Array();
  const image = Uint8Array.of(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0x4c, 0);
  return concat(
    base,
    control,
    icc,
    image,
    ...(options.animated ? [image] : []),
    Uint8Array.of(0x3b),
  );
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
  const body = concat(text(type), data);
  return concat(uint32BigEndian(data.byteLength), body, uint32BigEndian(crc32(body)));
}

function makePng(
  width: number,
  height: number,
  options: Readonly<{ animated?: boolean; alpha?: boolean }> = {},
): Uint8Array {
  const colorType = options.alpha ? 6 : 2;
  const ihdr = concat(
    uint32BigEndian(width),
    uint32BigEndian(height),
    Uint8Array.of(8, colorType, 0, 0, 0),
  );
  const chunks = [pngChunk("IHDR", ihdr)];
  if (options.animated) {
    chunks.push(pngChunk("acTL", concat(uint32BigEndian(2), uint32BigEndian(0))));
  }
  chunks.push(pngChunk("IDAT", new Uint8Array()));
  return concat(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), ...chunks);
}

function makeJpeg(width: number, height: number, orientation?: number): Uint8Array {
  const segments: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  if (orientation !== undefined) {
    const tiff = Uint8Array.of(
      0x49,
      0x49,
      0x2a,
      0,
      8,
      0,
      0,
      0,
      1,
      0,
      0x12,
      0x01,
      3,
      0,
      1,
      0,
      0,
      0,
      orientation,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    );
    const exif = concat(text("Exif"), Uint8Array.of(0, 0), tiff);
    segments.push(Uint8Array.of(0xff, 0xe1), uint16BigEndian(exif.byteLength + 2), exif);
  }
  const sof = concat(
    Uint8Array.of(8),
    uint16BigEndian(height),
    uint16BigEndian(width),
    Uint8Array.of(3),
  );
  segments.push(Uint8Array.of(0xff, 0xc0), uint16BigEndian(sof.byteLength + 2), sof);
  return concat(...segments);
}

function makeWebpVp8x(
  width: number,
  height: number,
  flags = 0,
  reserved = Uint8Array.of(0, 0, 0),
): Uint8Array {
  const payload = concat(
    Uint8Array.of(flags),
    reserved,
    uint24LittleEndian(width - 1),
    uint24LittleEndian(height - 1),
  );
  const chunk = concat(text("VP8X"), uint32LittleEndian(payload.byteLength), payload);
  return concat(text("RIFF"), uint32LittleEndian(4 + chunk.byteLength), text("WEBP"), chunk);
}

function box(type: string, ...payload: readonly Uint8Array[]): Uint8Array {
  const data = concat(...payload);
  return concat(uint32BigEndian(8 + data.byteLength), text(type), data);
}

function fullBox(version = 0, flags = 0): Uint8Array {
  return Uint8Array.of(version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff);
}

function makeAvif(
  width: number,
  height: number,
  options: Readonly<{ animated?: boolean; malformedAssociation?: boolean }> = {},
): Uint8Array {
  const brand = options.animated ? "avis" : "avif";
  const ftyp = box("ftyp", text(brand), uint32BigEndian(0), text(brand));
  const pitm = box("pitm", fullBox(), uint16BigEndian(7));
  const decoy = box("ispe", fullBox(), uint32BigEndian(2), uint32BigEndian(3));
  const primary = box("ispe", fullBox(), uint32BigEndian(width), uint32BigEndian(height));
  const ipco = box("ipco", decoy, primary);
  const association = options.malformedAssociation
    ? concat(fullBox(), uint32BigEndian(1), uint16BigEndian(7), Uint8Array.of(2, 2))
    : concat(fullBox(), uint32BigEndian(1), uint16BigEndian(7), Uint8Array.of(1, 2));
  const ipma = box("ipma", association);
  const trailingSibling = options.malformedAssociation
    ? box("free", Uint8Array.of(0))
    : new Uint8Array();
  const iprp = box("iprp", ipco, ipma, trailingSibling);
  const meta = box("meta", fullBox(), pitm, iprp);
  return concat(ftyp, meta);
}

function expectProbeError(action: () => unknown, code: HeaderProbeError["code"]): HeaderProbeError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HeaderProbeError);
    expect((error as HeaderProbeError).code).toBe(code);
    return error as HeaderProbeError;
  }
  throw new Error(`Expected probe error ${code}.`);
}

describe("bounded raster header probing", () => {
  it("reads dimensions from JPEG, PNG, WebP, AVIF, BMP, and static GIF", () => {
    const inputs = [
      [makeJpeg(640, 480), "jpeg"],
      [makePng(800, 600, { alpha: true }), "png"],
      [makeWebpVp8x(1024, 768, 0x10), "webp"],
      [makeAvif(1280, 720), "avif"],
      [makeBmp(48, 32), "bmp"],
      [makeGif(), "gif"],
    ] as const;

    for (const [bytes, format] of inputs) {
      const result = probeRasterHeader(bytes, bytes.byteLength);
      expect(result.format).toBe(format);
      expect(result.animation).toBe("static");
    }
    expect(probeRasterHeader(inputs[0][0], inputs[0][0].byteLength)).toMatchObject({
      height: 480,
      width: 640,
    });
    expect(probeRasterHeader(inputs[1][0], inputs[1][0].byteLength)).toMatchObject({
      alpha: "present",
      height: 600,
      width: 800,
    });
    expect(probeRasterHeader(inputs[2][0], inputs[2][0].byteLength)).toMatchObject({
      alpha: "present",
      height: 768,
      width: 1024,
    });
    expect(probeRasterHeader(inputs[3][0], inputs[3][0].byteLength)).toMatchObject({
      height: 720,
      width: 1280,
    });
    expect(probeRasterHeader(inputs[4][0], inputs[4][0].byteLength)).toMatchObject({
      alpha: "absent",
      height: 32,
      width: 48,
    });
    expect(probeRasterHeader(inputs[5][0], inputs[5][0].byteLength)).toMatchObject({
      alpha: "absent",
      height: 1,
      width: 1,
    });
  });

  it("detects GIF transparency and rejects animated GIF before decoding", () => {
    const transparent = makeGif({ transparent: true });
    expect(probeRasterHeader(transparent, transparent.byteLength)).toMatchObject({
      alpha: "present",
      animation: "static",
      format: "gif",
    });
    const animated = makeGif({ animated: true });
    expectProbeError(() => probeRasterHeader(animated, animated.byteLength), "animated-input");
    const colorManaged = makeGif({ icc: true });
    expect(probeRasterHeader(colorManaged, colorManaged.byteLength)).toMatchObject({
      colorProfile: "unknown",
      format: "gif",
    });
  });

  it("rejects truncated, compressed, and dimension-mismatched BMP input", () => {
    const rgba = makeBmp(3, 2, 32);
    expect(probeRasterHeader(rgba, rgba.byteLength)).toMatchObject({
      alpha: "unknown",
      format: "bmp",
      height: 2,
      width: 3,
    });
    const calibrated = makeV4Bmp(0);
    expect(probeRasterHeader(calibrated, calibrated.byteLength)).toMatchObject({
      colorProfile: "unknown",
    });
    const srgb = makeV4Bmp(0x73524742);
    expect(probeRasterHeader(srgb, srgb.byteLength)).toMatchObject({ colorProfile: "srgb" });

    const truncated = makeBmp(2, 2);
    const truncatedView = new DataView(truncated.buffer);
    truncatedView.setUint32(2, truncated.byteLength - 1, true);
    expectProbeError(() => probeRasterHeader(truncated, truncated.byteLength), "invalid-container");

    const compressed = makeBmp(2, 2);
    new DataView(compressed.buffer).setUint32(30, 1, true);
    expectProbeError(
      () => probeRasterHeader(compressed, compressed.byteLength),
      "invalid-container",
    );

    const gif = makeGif();
    const oversizedGif = gif.slice();
    new DataView(oversizedGif.buffer).setUint16(6, 8000, true);
    new DataView(oversizedGif.buffer).setUint16(8, 6000, true);
    expectProbeError(
      () => probeRasterHeader(oversizedGif, oversizedGif.byteLength),
      "pixel-budget-exceeded",
    );
  });

  it("parses bounded JPEG EXIF orientation without claiming unseen PNG metadata is absent", () => {
    const jpeg = makeJpeg(320, 240, 6);
    expect(probeRasterHeader(jpeg, jpeg.byteLength).metadata).toMatchObject({
      exif: "present",
      orientation: 6,
    });

    const png = makePng(320, 240);
    expect(probeRasterHeader(png, png.byteLength).metadata).toMatchObject({
      exif: "unknown",
      orientation: "unknown",
      xmp: "unknown",
    });
  });

  it("rejects animated PNG, WebP, and AVIF before decoding", () => {
    for (const bytes of [
      makePng(16, 16, { animated: true }),
      makeWebpVp8x(16, 16, 0x02),
      makeAvif(16, 16, { animated: true }),
    ]) {
      expectProbeError(() => probeRasterHeader(bytes, bytes.byteLength), "animated-input");
    }
  });

  it("rejects 48 MP headers for all four formats before decoding", () => {
    const oversized = [
      makeJpeg(8000, 6000),
      makePng(8000, 6000),
      makeWebpVp8x(8000, 6000),
      makeAvif(8000, 6000),
    ];
    for (const bytes of oversized) {
      expectProbeError(() => probeRasterHeader(bytes, bytes.byteLength), "pixel-budget-exceeded");
    }
  });

  it("distinguishes a bounded prefix from a corrupt PNG and validates WebP reserved bytes", () => {
    const png = makePng(32, 24);
    expectProbeError(
      () => probeRasterHeader(png.subarray(0, 33), png.byteLength),
      "probe-limit-exceeded",
    );
    expectProbeError(() => probeRasterHeader(png.subarray(0, 33), 33), "invalid-container");
    expectProbeError(() => probeRasterHeader(Uint8Array.of(0xff, 0xd8), 2), "invalid-container");
    const avifWithoutMeta = box("ftyp", text("avif"), uint32BigEndian(0), text("avif"));
    expectProbeError(
      () => probeRasterHeader(avifWithoutMeta, avifWithoutMeta.byteLength),
      "invalid-container",
    );

    const corruptPng = png.slice();
    const crcByteIndex = corruptPng.byteLength - 1;
    corruptPng[crcByteIndex] = (corruptPng[crcByteIndex] ?? 0) ^ 0xff;
    expectProbeError(
      () => probeRasterHeader(corruptPng, corruptPng.byteLength),
      "invalid-container",
    );

    const reservedWebp = makeWebpVp8x(32, 24, 0, Uint8Array.of(1, 0, 0));
    expectProbeError(
      () => probeRasterHeader(reservedWebp, reservedWebp.byteLength),
      "invalid-container",
    );
  });

  it("does not let malformed AVIF ipma entries read into a sibling box", () => {
    const avif = makeAvif(320, 200, { malformedAssociation: true });
    const error = expectProbeError(
      () => probeRasterHeader(avif, avif.byteLength),
      "invalid-container",
    );
    expect(error.message).toMatch(/containing ipma box/u);
  });

  it("enforces source byte limits before parsing the complete container", () => {
    const webpPrefix = makeWebpVp8x(8, 8);
    expectProbeError(() => probeRasterHeader(webpPrefix, 32 * 1024 * 1024 + 1), "input-too-large");
  });

  it("validates custom resource limits at the runtime boundary", () => {
    const png = makePng(8, 8);
    expect(() =>
      probeRasterHeader(png, png.byteLength, {
        limits: {
          absolutePixels: 10,
          maxFallbackArchiveBytes: 10,
          maxPdfBytes: 10,
          maxPdfOutputBytes: 10,
          maxTotalOutputBytes: 10,
          maxPdfPages: 10,
          maxQueueFiles: 10,
          maxRasterBytes: 10,
          maxRuntimePixels: 11,
          maxSelectedPdfPages: 10,
          maxSvgBytes: 10,
          maxTotalSourceBytes: 10,
        },
      }),
    ).toThrow(/cannot exceed/u);
  });
});
