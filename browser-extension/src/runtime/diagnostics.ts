import {
  PDF_DEFAULT_DPI,
  RASTER_OUTPUT_FORMATS,
  WEB_V1_DESKTOP_LIMITS,
  type ConversionSettings,
  type ImageInputFormat,
  type RasterOutputFormat,
} from "@imgconvert/conversion-contract";
import { ArchiveScheduler } from "@imgconvert/web-conversion-runtime";
import {
  PdfConversionScheduler,
  SerialConversionScheduler,
  probePdfHeader,
  probeRasterHeader,
  probeSvg,
} from "@imgconvert/web-image-engine";

import {
  createArchiveWorker,
  createPdfWorker,
  createRasterWorker,
  createSvgWorker,
} from "./worker-factories";

const PNG_FIXTURE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAhElEQVR4nBXKIRVEIRRF0YnzAxCAAARgoRFIFApxBQlI8PQpeWex9f59DaWGckOlodpwb3g2vBv+fQOlgfJAZaA6cB94DrzHCwulhfJCZaG6cF94LrzXCwelg/JB5aB6cD94HrzPCxeli/JF5aJ6cb94XrzvC4FSoByoBKqBe+AZeAf+A42rapk80shGAAAAAElFTkSuQmCC";

const FILE_EXTENSIONS: Readonly<Record<ImageInputFormat, string>> = Object.freeze({
  avif: "avif",
  bmp: "bmp",
  gif: "gif",
  jpeg: "jpg",
  pdf: "pdf",
  png: "png",
  svg: "svg",
  webp: "webp",
});

const MIME_TYPES: Readonly<Record<RasterOutputFormat, string>> = Object.freeze({
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
});

export interface RuntimeDiagnosticsResult {
  readonly archiveBytes: number;
  readonly archiveEntries: number;
  readonly conversions: number;
  readonly inputs: number;
  readonly outputs: number;
}

export interface RuntimeDiagnosticsProgress {
  readonly completed: number;
  readonly stage: string;
  readonly total: 32;
}

function fixturePng(): Uint8Array<ArrayBuffer> {
  const binary = atob(PNG_FIXTURE_BASE64);
  return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
}

function fixtureBmp(width = 8, height = 6): Uint8Array<ArrayBuffer> {
  const bitsPerPixel = 24;
  const stride = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const pixelBytes = stride * height;
  const bytes = new Uint8Array(54 + pixelBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.byteLength, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, bitsPerPixel, true);
  view.setUint32(34, pixelBytes, true);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * stride + x * 3;
      bytes[offset] = 170;
      bytes[offset + 1] = 90 + y * 14;
      bytes[offset + 2] = 40 + x * 12;
    }
  }
  return bytes;
}

function fixtureGif(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 0x2c, 0, 0, 0, 0, 1, 0,
    1, 0, 0, 2, 1, 0x4c, 0, 0x3b,
  ]);
}

function fixtureSvg(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6" viewBox="0 0 8 6"><rect width="8" height="6" rx="1" fill="#326a39"/><circle cx="4" cy="3" r="2" fill="#f8f5ed"/></svg>',
  );
}

function fixturePdf(): Uint8Array<ArrayBuffer> {
  const pageContent = "q 0.20 0.42 0.23 rg 0 0 8 6 re f Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 8 6] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${pageContent.length} >>\nstream\n${pageContent}\nendstream`,
  ];
  let source = "%PDF-1.7\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets[index + 1] = source.length;
    source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    source += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

function settings(output: RasterOutputFormat): ConversionSettings {
  return Object.freeze({
    background: Object.freeze({ blue: 255, green: 255, red: 255 }),
    lossless: output === "png",
    metadata: "stripAll",
    output,
    quality: output === "png" ? null : 82,
    resize: null,
  });
}

function ownedBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return bytes.slice().buffer;
}

function assertMagic(bytes: Uint8Array, format: RasterOutputFormat): void {
  const ascii = (start: number, end: number) => String.fromCodePoint(...bytes.subarray(start, end));
  const valid =
    (format === "jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (format === "png" &&
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71) ||
    (format === "webp" && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") ||
    (format === "avif" && ascii(4, 8) === "ftyp");
  if (!valid) throw new Error(`Runtime diagnostics received invalid ${format} output magic.`);
}

export async function runRuntimeDiagnostics(
  onProgress?: (progress: RuntimeDiagnosticsProgress) => void,
): Promise<RuntimeDiagnosticsResult> {
  let lastWorkerError = "none";
  const diagnosticWorker = (label: string, factory: () => Worker): Worker => {
    const worker = factory();
    worker.addEventListener("error", (event) => {
      lastWorkerError = `${label}: ${event.message || "worker error"}`.slice(0, 384);
    });
    worker.addEventListener("messageerror", () => {
      lastWorkerError = `${label}: message deserialization failed`;
    });
    return worker;
  };
  const rasterScheduler = new SerialConversionScheduler({
    workerFactory: () => diagnosticWorker("raster", createRasterWorker),
  });
  const svgScheduler = new SerialConversionScheduler({
    workerFactory: () => diagnosticWorker("svg", createSvgWorker),
  });
  const pdfScheduler = new PdfConversionScheduler({
    workerFactory: () => diagnosticWorker("pdf", createPdfWorker),
  });
  const archiveScheduler = new ArchiveScheduler({
    workerFactory: () => diagnosticWorker("archive", createArchiveWorker),
  });
  let sequence = 0;
  const artifacts: Array<{ blob: Blob; name: string }> = [];

  async function convertRasterLike(
    inputFormat: Exclude<ImageInputFormat, "pdf">,
    source: Uint8Array<ArrayBuffer>,
    output: RasterOutputFormat,
    recordArtifact: boolean,
  ): Promise<Uint8Array<ArrayBuffer>> {
    sequence += 1;
    const bytes = ownedBuffer(source);
    const probe =
      inputFormat === "svg" ? probeSvg(bytes) : probeRasterHeader(bytes, bytes.byteLength);
    const scheduler = inputFormat === "svg" ? svgScheduler : rasterScheduler;
    const outcome = await scheduler.enqueue(
      {
        input: {
          bytes,
          name: `diagnostic.${FILE_EXTENSIONS[inputFormat]}`,
          probe,
        },
        jobId: `runtime_${sequence}`,
        schemaVersion: 1,
        settings: settings(output),
      },
      ({ phase }) => {
        onProgress?.({
          completed: artifacts.length,
          stage: `${inputFormat}-to-${output}:${phase}`,
          total: 32,
        });
      },
    ).outcome;
    if (!outcome.ok) {
      throw new Error(
        `${inputFormat} to ${output} failed: ${outcome.failure.code} ${JSON.stringify(outcome.failure.params)}; ${lastWorkerError}`,
      );
    }
    const result = new Uint8Array(outcome.result.bytes);
    assertMagic(result, output);
    if (recordArtifact) {
      artifacts.push({
        blob: new Blob([result], { type: MIME_TYPES[output] }),
        name: `${inputFormat}-to-${output}.${FILE_EXTENSIONS[output]}`,
      });
      onProgress?.({
        completed: artifacts.length,
        stage: `${inputFormat}-to-${output}`,
        total: 32,
      });
    }
    return result;
  }

  async function convertPdf(
    source: Uint8Array<ArrayBuffer>,
    output: RasterOutputFormat,
  ): Promise<void> {
    sequence += 1;
    const bytes = ownedBuffer(source);
    const outcome = await pdfScheduler.enqueue(
      {
        input: {
          bytes,
          name: "diagnostic.pdf",
          probe: probePdfHeader(bytes, bytes.byteLength),
        },
        jobId: `runtime_${sequence}`,
        schemaVersion: 1,
        settings: {
          dpi: PDF_DEFAULT_DPI,
          pages: [1],
          raster: settings(output),
        },
      },
      ({ phase }) => {
        onProgress?.({
          completed: artifacts.length,
          stage: `pdf-to-${output}:${phase}`,
          total: 32,
        });
      },
    ).outcome;
    if (!outcome.ok) {
      throw new Error(
        `pdf to ${output} failed: ${outcome.failure.code} ${JSON.stringify(outcome.failure.params)}; ${lastWorkerError}`,
      );
    }
    const page = outcome.result.pages[0];
    if (!page?.ok) throw new Error(`pdf to ${output} did not return a successful page.`);
    const result = new Uint8Array(page.result.bytes);
    assertMagic(result, output);
    artifacts.push({
      blob: new Blob([result], { type: MIME_TYPES[output] }),
      name: `pdf-to-${output}.${FILE_EXTENSIONS[output]}`,
    });
    onProgress?.({ completed: artifacts.length, stage: `pdf-to-${output}`, total: 32 });
  }

  try {
    const seed = fixturePng();
    const sources = new Map<Exclude<ImageInputFormat, "pdf">, Uint8Array<ArrayBuffer>>([
      ["png", seed],
      ["bmp", fixtureBmp()],
      ["gif", fixtureGif()],
      ["svg", fixtureSvg()],
    ]);
    for (const generatedFormat of ["jpeg", "webp", "avif"] as const) {
      sources.set(generatedFormat, await convertRasterLike("png", seed, generatedFormat, false));
    }

    for (const inputFormat of ["jpeg", "png", "webp", "avif", "bmp", "gif", "svg"] as const) {
      const source = sources.get(inputFormat);
      if (!source) throw new Error(`Runtime diagnostics source ${inputFormat} is missing.`);
      for (const output of RASTER_OUTPUT_FORMATS) {
        await convertRasterLike(inputFormat, source, output, true);
      }
    }
    const pdf = fixturePdf();
    for (const output of RASTER_OUTPUT_FORMATS) await convertPdf(pdf, output);

    const archiveOutcome = await archiveScheduler.enqueue("runtime_archive", {
      files: artifacts,
      maxBytes: WEB_V1_DESKTOP_LIMITS.maxFallbackArchiveBytes,
    }).outcome;
    if (!archiveOutcome.ok) {
      throw new Error(`archive smoke failed: ${archiveOutcome.reason}`);
    }
    return Object.freeze({
      archiveBytes: archiveOutcome.archive.size,
      archiveEntries: archiveOutcome.entryCount,
      conversions: artifacts.length,
      inputs: 8,
      outputs: RASTER_OUTPUT_FORMATS.length,
    });
  } finally {
    archiveScheduler.dispose();
    pdfScheduler.dispose();
    rasterScheduler.dispose();
    svgScheduler.dispose();
  }
}
