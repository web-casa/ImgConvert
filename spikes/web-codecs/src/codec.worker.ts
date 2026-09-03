/// <reference lib="webworker" />

import decodeAvif from "@jsquash/avif/decode.js";
import avifEncoderModuleFactory from "@jsquash/avif/codec/enc/avif_enc.js";
import avifEncoderWasmUrl from "@jsquash/avif/codec/enc/avif_enc.wasm?url";
import { defaultOptions as defaultAvifOptions } from "@jsquash/avif/meta.js";
import decodeJpeg from "@jsquash/jpeg/decode.js";
import encodeJpeg from "@jsquash/jpeg/encode.js";
import decodePng from "@jsquash/png/decode.js";
import encodePng from "@jsquash/png/encode.js";
import decodeWebp from "@jsquash/webp/decode.js";
import encodeWebp from "@jsquash/webp/encode.js";

import {
  RASTER_FORMATS,
  type BenchmarkResult,
  type CodecDescriptor,
  type EncodedImageSummary,
  type MatrixCell,
  type MatrixResult,
  type RasterFormat,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";

const workerScope: DedicatedWorkerGlobalScope = self;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 64_000_000;
const RUNTIME_PIXEL_BUDGET = 24_000_000;
const MAX_STRESS_ITERATIONS = 1000;
const METADATA_MARKER = new TextEncoder().encode("IMGCONVERT_METADATA_WEB_001B");
const XMP_PAYLOAD = new TextEncoder().encode(`<?xpacket begin="\uFEFF"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:imgconvert="https://imgconvert.app/spike/"
      imgconvert:marker="IMGCONVERT_METADATA_WEB_001B" />
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`);

const CODECS: CodecDescriptor[] = [
  {
    format: "jpeg",
    implementation: "MozJPEG",
    packageName: "@jsquash/jpeg",
    version: "1.6.0",
  },
  {
    format: "png",
    implementation: "Rust png crate",
    packageName: "@jsquash/png",
    version: "3.1.1",
  },
  {
    format: "webp",
    implementation: "libwebp",
    packageName: "@jsquash/webp",
    version: "1.5.0",
  },
  {
    format: "avif",
    implementation: "libavif",
    packageName: "@jsquash/avif",
    version: "2.1.1",
  },
];

let requestInProgress = false;
let avifEncoderModule: ReturnType<typeof avifEncoderModuleFactory> | undefined;

function ensureAvifEncoder() {
  if (!avifEncoderModule) {
    avifEncoderModule = avifEncoderModuleFactory({
      locateFile: () => new URL(avifEncoderWasmUrl, workerScope.location.href).href,
      noInitialRun: true,
    });
  }
  return avifEncoderModule;
}

function requestIdFrom(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const id = (value as Record<string, unknown>).id;
  return Number.isSafeInteger(id) && (id as number) > 0 ? (id as number) : 0;
}

function parseRequest(value: unknown): WorkerRequest {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Worker request must be an object.");
  }

  const candidate = value as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.id) || (candidate.id as number) < 1) {
    throw new TypeError("Worker request id must be a positive safe integer.");
  }
  if (!(candidate.bytes instanceof ArrayBuffer)) {
    throw new TypeError("Worker request bytes must be an ArrayBuffer.");
  }
  if (candidate.bytes.byteLength < 1 || candidate.bytes.byteLength > MAX_INPUT_BYTES) {
    throw new RangeError(
      `Worker input must contain 1 to ${MAX_INPUT_BYTES} bytes; received ${candidate.bytes.byteLength}.`,
    );
  }

  if (candidate.type === "matrix") {
    return { bytes: candidate.bytes, id: candidate.id as number, type: "matrix" };
  }
  if (candidate.type === "benchmark") {
    if (!RASTER_FORMATS.includes(candidate.output as RasterFormat)) {
      throw new TypeError("Benchmark output must be jpeg, png, webp, or avif.");
    }
    if (
      !Number.isSafeInteger(candidate.iterations) ||
      (candidate.iterations as number) < 1 ||
      (candidate.iterations as number) > 8
    ) {
      throw new RangeError("Benchmark iterations must be an integer from 1 to 8.");
    }
    return {
      bytes: candidate.bytes,
      id: candidate.id as number,
      iterations: candidate.iterations as number,
      output: candidate.output as RasterFormat,
      type: "benchmark",
    };
  }
  if (candidate.type === "stress") {
    if (
      !Number.isSafeInteger(candidate.iterations) ||
      (candidate.iterations as number) < 1 ||
      (candidate.iterations as number) > MAX_STRESS_ITERATIONS
    ) {
      throw new RangeError(
        `Stress iterations must be an integer from 1 to ${MAX_STRESS_ITERATIONS}.`,
      );
    }
    return {
      bytes: candidate.bytes,
      id: candidate.id as number,
      iterations: candidate.iterations as number,
      type: "stress",
    };
  }

  throw new TypeError("Worker request type must be benchmark, matrix, or stress.");
}

function copyBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return new Uint8Array(buffer).slice().buffer;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
  outer: for (let offset = 0; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

function writeUint32BigEndian(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
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

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const typeBytes = new TextEncoder().encode(type);
  if (typeBytes.byteLength !== 4) throw new Error(`Invalid PNG chunk type: ${type}.`);
  return concatBytes(
    writeUint32BigEndian(data.byteLength),
    typeBytes,
    data,
    writeUint32BigEndian(crc32(concatBytes(typeBytes, data))),
  );
}

function injectJpegXmp(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("JPEG source lacks an SOI marker.");
  const namespace = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0");
  const payload = concatBytes(namespace, XMP_PAYLOAD);
  if (payload.byteLength > 65_533) throw new Error("JPEG XMP test payload is too large.");
  const segmentLength = payload.byteLength + 2;
  const header = new Uint8Array([0xff, 0xe1, segmentLength >>> 8, segmentLength & 0xff]);
  return concatBytes(bytes.subarray(0, 2), header, payload, bytes.subarray(2));
}

function injectPngXmp(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!signature.every((byte, index) => bytes[index] === byte)) {
    throw new Error("PNG source has an invalid signature.");
  }
  const firstChunkLength = new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0, false);
  const insertOffset = 8 + 12 + firstChunkLength;
  const keyword = new TextEncoder().encode("XML:com.adobe.xmp");
  const data = concatBytes(keyword, new Uint8Array([0, 0, 0, 0, 0]), XMP_PAYLOAD);
  return concatBytes(
    bytes.subarray(0, insertOffset),
    pngChunk("iTXt", data),
    bytes.subarray(insertOffset),
  );
}

function injectWebpXmp(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const text = new TextDecoder("ascii").decode(bytes.subarray(0, 12));
  if (!text.startsWith("RIFF") || text.slice(8) !== "WEBP") {
    throw new Error("WebP source has an invalid RIFF signature.");
  }
  const padding = XMP_PAYLOAD.byteLength % 2 === 0 ? new Uint8Array() : new Uint8Array([0]);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, XMP_PAYLOAD.byteLength, true);
  const chunk = concatBytes(new TextEncoder().encode("XMP "), length, XMP_PAYLOAD, padding);
  const output = concatBytes(bytes, chunk);
  new DataView(output.buffer).setUint32(4, output.byteLength - 8, true);
  return output;
}

function injectAvifXmp(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const fileType = new TextDecoder("ascii").decode(bytes.subarray(4, 8));
  if (fileType !== "ftyp") throw new Error("AVIF source lacks an ftyp box.");
  const adobeXmpUuid = new Uint8Array([
    0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
  ]);
  const box = concatBytes(
    writeUint32BigEndian(8 + adobeXmpUuid.byteLength + XMP_PAYLOAD.byteLength),
    new TextEncoder().encode("uuid"),
    adobeXmpUuid,
    XMP_PAYLOAD,
  );
  return concatBytes(bytes, box);
}

function injectXmp(bytes: Uint8Array, format: RasterFormat): Uint8Array<ArrayBuffer> {
  switch (format) {
    case "jpeg":
      return injectJpegXmp(bytes);
    case "png":
      return injectPngXmp(bytes);
    case "webp":
      return injectWebpXmp(bytes);
    case "avif":
      return injectAvifXmp(bytes);
  }
}

function validateSignature(bytes: Uint8Array, format: RasterFormat): void {
  const ascii = new TextDecoder("ascii");
  switch (format) {
    case "jpeg":
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("JPEG output has no SOI marker.");
      return;
    case "png": {
      const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      if (!signature.every((byte, index) => bytes[index] === byte)) {
        throw new Error("PNG output has an invalid signature.");
      }
      return;
    }
    case "webp":
      if (
        ascii.decode(bytes.subarray(0, 4)) !== "RIFF" ||
        ascii.decode(bytes.subarray(8, 12)) !== "WEBP"
      ) {
        throw new Error("WebP output has an invalid RIFF signature.");
      }
      return;
    case "avif":
      if (ascii.decode(bytes.subarray(4, 8)) !== "ftyp") {
        throw new Error("AVIF output has no ftyp box.");
      }
  }
}

function validatePixelData(image: ImageData, context: string): ImageData {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)) {
    throw new Error(`${context} returned non-integer dimensions.`);
  }
  const pixels = image.width * image.height;
  if (image.width < 1 || image.height < 1 || pixels > MAX_PIXELS) {
    throw new RangeError(`${context} dimensions exceed the ${MAX_PIXELS}-pixel limit.`);
  }
  if (!(image.data instanceof Uint8ClampedArray) || image.data.byteLength !== pixels * 4) {
    throw new Error(`${context} returned invalid 8-bit RGBA pixel data.`);
  }
  return image;
}

function validatePngBudget(bytes: ArrayBuffer): { height: number; width: number } {
  const data = new Uint8Array(bytes);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.byteLength < 24 || !signature.every((byte, index) => data[index] === byte)) {
    throw new Error("PNG preflight could not read a valid signature and IHDR.");
  }
  if (new TextDecoder("ascii").decode(data.subarray(12, 16)) !== "IHDR") {
    throw new Error("PNG preflight did not find IHDR as the first chunk.");
  }
  const view = new DataView(bytes);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const pixels = width * height;
  if (width < 1 || height < 1 || pixels > MAX_PIXELS) {
    throw new RangeError(`PNG dimensions exceed the ${MAX_PIXELS}-pixel absolute limit.`);
  }
  if (pixels > RUNTIME_PIXEL_BUDGET) {
    throw new RangeError(
      `PNG dimensions exceed the ${RUNTIME_PIXEL_BUDGET.toLocaleString("en-US")}-pixel runtime budget.`,
    );
  }
  return { height, width };
}

async function decode(bytes: ArrayBuffer, format: RasterFormat): Promise<ImageData> {
  let decoded: ImageData | null;
  switch (format) {
    case "jpeg":
      decoded = await decodeJpeg(bytes);
      break;
    case "png":
      decoded = await decodePng(bytes);
      break;
    case "webp":
      decoded = await decodeWebp(bytes);
      break;
    case "avif":
      decoded = await decodeAvif(bytes);
      break;
  }
  if (!decoded) throw new Error(`${format} decoder returned no pixel data.`);
  return validatePixelData(decoded, `${format} decoder`);
}

function flattenOnWhite(image: ImageData): ImageData {
  const pixels = new Uint8ClampedArray(image.data.byteLength);
  for (let offset = 0; offset < image.data.byteLength; offset += 4) {
    const alpha = image.data[offset + 3] ?? 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = image.data[offset + channel] ?? 0;
      pixels[offset + channel] = Math.round((value * alpha + 255 * (255 - alpha)) / 255);
    }
    pixels[offset + 3] = 255;
  }
  return new ImageData(pixels, image.width, image.height);
}

async function encode(image: ImageData, format: RasterFormat): Promise<ArrayBuffer> {
  let encoded: ArrayBuffer;
  switch (format) {
    case "jpeg":
      encoded = await encodeJpeg(flattenOnWhite(image), { quality: 82 });
      break;
    case "png":
      encoded = await encodePng(image);
      break;
    case "webp":
      encoded = await encodeWebp(image, { quality: 82 });
      break;
    case "avif":
      {
        const module = await ensureAvifEncoder();
        const { lossless: _lossless, ...encoderDefaults } = defaultAvifOptions;
        const output = module.encode(image.data, image.width, image.height, {
          ...encoderDefaults,
          quality: 82,
          speed: 8,
        });
        if (!output) throw new Error("AVIF encoder returned no bytes.");
        encoded = new Uint8Array(output).slice().buffer;
      }
      break;
  }
  if (encoded.byteLength < 1 || encoded.byteLength > MAX_OUTPUT_BYTES) {
    throw new RangeError(
      `${format} output must contain 1 to ${MAX_OUTPUT_BYTES} bytes; received ${encoded.byteLength}.`,
    );
  }
  const output = copyBuffer(encoded);
  validateSignature(new Uint8Array(output), format);
  return output;
}

function transparency(image: ImageData): { hasAlpha: boolean; opaque: boolean } {
  for (let offset = 3; offset < image.data.byteLength; offset += 4) {
    if (image.data[offset] !== 255) return { hasAlpha: true, opaque: false };
  }
  return { hasAlpha: false, opaque: true };
}

async function probe(bytes: ArrayBuffer, format: RasterFormat): Promise<EncodedImageSummary> {
  const image = await decode(copyBuffer(bytes), format);
  return {
    bytes: bytes.byteLength,
    format,
    ...transparency(image),
    height: image.height,
    metadataMarkerPresent: containsBytes(new Uint8Array(bytes), METADATA_MARKER),
    width: image.width,
  };
}

async function runMatrix(seed: ArrayBuffer): Promise<{
  result: MatrixResult;
  samples: Array<{ bytes: ArrayBuffer; format: RasterFormat }>;
}> {
  validatePngBudget(seed);
  const coldStartStartedAt = performance.now();
  const seedPixels = await decode(copyBuffer(seed), "png");
  const sources = new Map<RasterFormat, ArrayBuffer>();
  const sourceBytes = {} as Record<RasterFormat, number>;

  for (const format of RASTER_FORMATS) {
    const encoded = new Uint8Array(await encode(seedPixels, format));
    const source = injectXmp(encoded, format).buffer;
    const sourceSummary = await probe(source, format);
    if (!sourceSummary.metadataMarkerPresent) {
      throw new Error(`${format} source does not contain the injected XMP marker.`);
    }
    sources.set(format, source);
    sourceBytes[format] = source.byteLength;
  }
  const coldStartMs = performance.now() - coldStartStartedAt;

  const matrix: MatrixCell[] = [];
  for (const input of RASTER_FORMATS) {
    const source = sources.get(input);
    if (!source) throw new Error(`Missing generated ${input} source.`);
    const sourcePixels = await decode(copyBuffer(source), input);

    for (const output of RASTER_FORMATS) {
      const startedAt = performance.now();
      const bytes = await encode(sourcePixels, output);
      const summary = await probe(bytes, output);
      matrix.push({
        ...summary,
        durationMs: performance.now() - startedAt,
        input,
        output,
      });
    }
  }

  return {
    result: { codecs: CODECS, coldStartMs, matrix, sourceBytes },
    samples: RASTER_FORMATS.map((format) => ({ bytes: sources.get(format)!, format })),
  };
}

async function runBenchmark(
  seed: ArrayBuffer,
  output: RasterFormat,
  iterations: number,
): Promise<BenchmarkResult> {
  const expectedDimensions = validatePngBudget(seed);
  const startedAt = performance.now();
  let summary: EncodedImageSummary | undefined;

  for (let index = 0; index < iterations; index += 1) {
    const pixels = await decode(copyBuffer(seed), "png");
    if (pixels.width !== expectedDimensions.width || pixels.height !== expectedDimensions.height) {
      throw new Error("PNG decoder dimensions do not match the preflight dimensions.");
    }
    const encoded = await encode(pixels, output);
    summary = await probe(encoded, output);
  }
  if (!summary) throw new Error("Benchmark produced no output summary.");

  return {
    ...summary,
    durationMs: performance.now() - startedAt,
    inputBytes: seed.byteLength,
    iterations,
    output,
  };
}

async function runStress(seed: ArrayBuffer, iterations: number): Promise<number> {
  validatePngBudget(seed);
  let currentBytes = copyBuffer(seed);
  let currentFormat: RasterFormat = "png";
  for (let index = 0; index < iterations; index += 1) {
    const pixels = await decode(currentBytes, currentFormat);
    currentFormat = index % 2 === 0 ? "avif" : "png";
    currentBytes = await encode(pixels, currentFormat);
  }
  return iterations;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const responseId = requestIdFrom(event.data);
  void (async () => {
    let ownsRequestSlot = false;
    try {
      if (requestInProgress) throw new Error("Codec worker is already processing a request.");
      const request = parseRequest(event.data);
      requestInProgress = true;
      ownsRequestSlot = true;

      if (request.type === "matrix") {
        const { result, samples } = await runMatrix(request.bytes);
        const response: WorkerResponse = {
          id: request.id,
          result,
          samples,
          type: "matrix-result",
        };
        workerScope.postMessage(
          response,
          samples.map(({ bytes }) => bytes),
        );
        return;
      }

      if (request.type === "benchmark") {
        const result = await runBenchmark(request.bytes, request.output, request.iterations);
        const response: WorkerResponse = { id: request.id, result, type: "benchmark-result" };
        workerScope.postMessage(response);
        return;
      }

      const completedIterations = await runStress(request.bytes, request.iterations);
      const response: WorkerResponse = {
        completedIterations,
        id: request.id,
        type: "stress-result",
      };
      workerScope.postMessage(response);
    } catch (error) {
      const response: WorkerResponse = {
        error: errorMessage(error),
        id: responseId,
        type: "error",
      };
      workerScope.postMessage(response);
    } finally {
      if (ownsRequestSlot) requestInProgress = false;
    }
  })();
});
