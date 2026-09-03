import type { ConversionRequest } from "@imgconvert/conversion-contract";
import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

import {
  HeaderProbeError,
  SVG_COMPLEXITY_LIMITS,
  convertSvgRequest,
  probeSvg,
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
    pngChunk("IDAT", deflateSync(Buffer.from([0, 50, 100, 150, 128]))),
    pngChunk("IEND", new Uint8Array()),
  ]);
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
}

function bytes(source: string): ArrayBuffer {
  return new TextEncoder().encode(source).buffer;
}

function svg(
  source = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#326a39"/></svg>',
): ArrayBuffer {
  return bytes(source);
}

function request(source = svg()): ConversionRequest {
  return {
    input: { bytes: source, name: "vector.svg", probe: probeSvg(source) },
    jobId: "svg-test",
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

function expectUnsafe(
  source: string,
  code: "pixel-budget-exceeded" | "unsafe-svg" = "unsafe-svg",
): void {
  try {
    probeSvg(bytes(source));
    throw new Error("Expected SVG probe to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(HeaderProbeError);
    expect((error as HeaderProbeError).code).toBe(code);
  }
}

describe("bounded SVG safety probe", () => {
  it("accepts an explicit UTF-8 XML declaration", () => {
    const result = probeSvg(
      bytes(
        '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"><path d="M0 0h2v1H0z"/></svg>',
      ),
    );

    expect(result).toMatchObject({ format: "svg", height: 1, width: 2 });
  });

  it("accepts vector-only SVG, absolute units, viewBox sizing, and local paint references", () => {
    const result = probeSvg(
      bytes(
        '<svg xmlns="http://www.w3.org/2000/svg" width="2in" viewBox="0 0 4 2"><defs><linearGradient id="g"><stop offset="1" stop-color="#326a39"/></linearGradient></defs><rect width="4" height="2" fill="url(#g)"/></svg>',
      ),
    );

    expect(result).toMatchObject({ format: "svg", height: 96, width: 192 });
  });

  it.each([
    [
      "DTD and entities",
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    ],
    [
      "scripts",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>',
    ],
    [
      "event handlers",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" onload="alert(1)"/>',
    ],
    [
      "foreign objects",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><foreignObject/></svg>',
    ],
    [
      "remote images",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="https://example.com/a.png"/></svg>',
    ],
    [
      "data images",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="data:image/png;base64,AA=="/></svg>',
    ],
    [
      "file images",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><feImage href="file:///tmp/a.png"/></svg>',
    ],
    [
      "CSS",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><style>@import url(https://example.com/a.css)</style></svg>',
    ],
    [
      "escaped CSS URL tokens",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="u\\72l(https://example.com/a.svg)"/></svg>',
    ],
    [
      "recursive use",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><g id="a"><use href="#a"/></g></svg>',
    ],
    [
      "live text",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><text>remote font</text></svg>',
    ],
    [
      "processing instructions",
      '<?xml-stylesheet href="https://example.com/a.css"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    ],
    [
      "foreign namespaces",
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="https://example.com/ns" width="1" height="1"><x:payload/></svg>',
    ],
  ])("rejects %s", (_label, source) => expectUnsafe(source));

  it("rejects excessive depth, filter complexity, malformed XML, and pixel bombs", () => {
    const nested = `${'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">'}${"<g>".repeat(SVG_COMPLEXITY_LIMITS.depth)}${"</g>".repeat(SVG_COMPLEXITY_LIMITS.depth)}</svg>`;
    expectUnsafe(nested);
    expectUnsafe(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${'<filter id="f"></filter>'.repeat(SVG_COMPLEXITY_LIMITS.filters + 1)}</svg>`,
    );
    expectUnsafe('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><g></svg>');
    expectUnsafe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="5000"/>',
      "pixel-budget-exceeded",
    );
  });
});

describe("SVG conversion boundary", () => {
  const codecs: RasterCodecAdapter = {
    decode: async () => new ImageData(new Uint8ClampedArray([50, 100, 150, 128]), 1, 1),
    encode: async () => onePixelPng(),
  };

  it("renders a validated SVG and reuses the verified raster output path", async () => {
    const phases: string[] = [];
    const outcome = await convertSvgRequest(
      request(),
      { render: async () => onePixelPng() },
      codecs,
      ({ phase }) => phases.push(phase),
    );

    expect(outcome).toMatchObject({ ok: true, result: { format: "png", height: 1, width: 1 } });
    expect(phases).toContain("rendering");
    expect(phases.at(-1)).toBe("validating");
  });

  it("fails closed when the supplied probe changes or rendering fails", async () => {
    const mismatched = request();
    const changed: ConversionRequest = {
      ...mismatched,
      input: { ...mismatched.input, probe: { ...mismatched.input.probe, width: 2 } },
    };
    await expect(
      convertSvgRequest(changed, { render: async () => onePixelPng() }, codecs),
    ).resolves.toMatchObject({ failure: { code: "format-mismatch" }, ok: false });
    await expect(
      convertSvgRequest(
        request(),
        { render: async () => Promise.reject(new Error("boom")) },
        codecs,
      ),
    ).resolves.toMatchObject({ failure: { code: "decode-failed" }, ok: false });
  });
});
