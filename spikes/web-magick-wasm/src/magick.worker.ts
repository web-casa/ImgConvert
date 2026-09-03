/// <reference lib="webworker" />

import {
  AlphaAction,
  ImageMagick,
  Magick,
  MagickColors,
  MagickFormat,
  initializeImageMagick,
} from "@imagemagick/magick-wasm";
import wasmUrl from "@imagemagick/magick-wasm/magick.wasm?url";

import {
  RASTER_FORMATS,
  type EncodedImageSummary,
  type MatrixCell,
  type MatrixResult,
  type RasterFormat,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";

const workerScope: DedicatedWorkerGlobalScope = self;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_STRESS_ITERATIONS = 1000;

const testXmp = new TextEncoder().encode(`<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:imgconvert="https://imgconvert.example/spike/"
      imgconvert:marker="WEB-001" />
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`);

const formats: Record<RasterFormat, (typeof MagickFormat)[keyof typeof MagickFormat]> = {
  avif: MagickFormat.Avif,
  jpeg: MagickFormat.Jpeg,
  png: MagickFormat.Png,
  webp: MagickFormat.WebP,
};

const reportedFormats = new Set<string>([
  MagickFormat.Avif,
  MagickFormat.Bmp,
  MagickFormat.Gif,
  MagickFormat.Heic,
  MagickFormat.Jpeg,
  MagickFormat.Png,
  MagickFormat.WebP,
]);

let initialization: Promise<number> | undefined;
let requestInProgress = false;

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

  throw new TypeError("Worker request type must be matrix or stress.");
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function ensureInitialized(): Promise<number> {
  if (!initialization) {
    initialization = (async () => {
      const startedAt = performance.now();
      await initializeImageMagick(new URL(wasmUrl, workerScope.location.href));
      return performance.now() - startedAt;
    })();
  }

  return initialization;
}

function encode(
  input: Uint8Array,
  output: RasterFormat,
  options: { injectTestProfile?: boolean; stripMetadata?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  return ImageMagick.read(input, (image) => {
    image.autoOrient();
    if (options.injectTestProfile) image.setProfile("xmp", testXmp);
    if (options.stripMetadata ?? true) image.strip();

    if (output === "jpeg") {
      image.backgroundColor = MagickColors.White;
      image.alpha(AlphaAction.Remove);
    }

    if (output !== "png") {
      image.quality = 82;
    }

    return image.write(formats[output], copyBytes);
  });
}

function probe(bytes: Uint8Array, expectedFormat: RasterFormat): EncodedImageSummary {
  return ImageMagick.readCollection(bytes, (images) => {
    if (images.length !== 1) {
      throw new Error(`Expected one ${expectedFormat} frame, got ${images.length}.`);
    }

    const image = images[0];
    if (!image) {
      throw new Error(`ImageMagick returned no ${expectedFormat} frame.`);
    }

    if (image.format !== formats[expectedFormat]) {
      throw new Error(`Expected ${formats[expectedFormat]}, got ${image.format}.`);
    }

    return {
      bytes: bytes.byteLength,
      format: expectedFormat,
      hasAlpha: image.hasAlpha,
      height: image.height,
      opaque: image.isOpaque,
      profileNames: [...image.profileNames],
      width: image.width,
    };
  });
}

async function runMatrix(seed: Uint8Array): Promise<{
  result: MatrixResult;
  samples: Array<{ bytes: Uint8Array<ArrayBuffer>; format: RasterFormat }>;
}> {
  const initializationMs = await ensureInitialized();
  const sources = new Map<RasterFormat, Uint8Array<ArrayBuffer>>();
  const sourceBytes: Partial<Record<RasterFormat, number>> = {};

  for (const format of RASTER_FORMATS) {
    const bytes = encode(seed, format, { injectTestProfile: true, stripMetadata: false });
    const sourceSummary = probe(bytes, format);
    if (!sourceSummary.profileNames.some((name) => name.toLowerCase() === "xmp")) {
      throw new Error(`${format} did not retain the injected XMP source profile.`);
    }
    sources.set(format, bytes);
    sourceBytes[format] = bytes.byteLength;
  }

  const matrix: MatrixCell[] = [];
  for (const input of RASTER_FORMATS) {
    const source = sources.get(input);
    if (!source) {
      throw new Error(`Missing generated ${input} source.`);
    }

    for (const output of RASTER_FORMATS) {
      const startedAt = performance.now();
      const bytes = encode(source, output);
      const summary = probe(bytes, output);
      matrix.push({
        ...summary,
        durationMs: performance.now() - startedAt,
        input,
        output,
      });
    }
  }

  return {
    result: {
      delegates: Magick.delegates,
      engineVersion: Magick.imageMagickVersion,
      features: Magick.features,
      initializationMs,
      matrix,
      sourceBytes,
      supportedFormats: Magick.supportedFormats
        .filter(({ format }) => reportedFormats.has(format))
        .map(({ format, mimeType, supportsMultipleFrames, supportsReading, supportsWriting }) => ({
          format,
          mimeType,
          supportsMultipleFrames,
          supportsReading,
          supportsWriting,
        })),
    },
    samples: RASTER_FORMATS.map((format) => ({
      bytes: sources.get(format)!,
      format,
    })),
  };
}

async function runStress(seed: Uint8Array, iterations: number): Promise<number> {
  await ensureInitialized();
  let current: Uint8Array = seed;

  for (let index = 0; index < iterations; index += 1) {
    current = encode(current, index % 2 === 0 ? "avif" : "png");
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
      if (requestInProgress) throw new Error("Raster worker is already processing a request.");
      const request = parseRequest(event.data);
      requestInProgress = true;
      ownsRequestSlot = true;

      if (request.type === "matrix") {
        const { result, samples } = await runMatrix(new Uint8Array(request.bytes));
        const response: WorkerResponse = {
          id: request.id,
          result,
          samples: samples.map(({ bytes, format }) => ({ bytes: bytes.buffer, format })),
          type: "matrix-result",
        };
        workerScope.postMessage(
          response,
          samples.map(({ bytes }) => bytes.buffer),
        );
        return;
      }

      const completedIterations = await runStress(
        new Uint8Array(request.bytes),
        request.iterations,
      );
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
