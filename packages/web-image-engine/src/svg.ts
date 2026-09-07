import {
  WEB_V1_DESKTOP_LIMITS,
  assertConversionRequest,
  createConversionFailure,
  type ConversionOutcome,
  type ConversionRequest,
  type ProbeResult,
  type ResourceLimits,
} from "@imgconvert/conversion-contract";
import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from "saxes";

import { probeRasterHeader } from "./probe/index.js";
import { HeaderProbeError } from "./probe/shared.js";
import {
  MAX_RASTER_OUTPUT_BYTES,
  convertRasterRequest,
  type RasterCodecAdapter,
  type RasterProgressReporter,
} from "./raster.js";
import type { ConversionProgressPhase } from "./worker-protocol.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

export const SVG_COMPLEXITY_LIMITS = Object.freeze({
  attributes: 200_000,
  depth: 128,
  filterPrimitives: 256,
  filters: 32,
  nodes: 50_000,
  pathDataCharacters: 2 * 1024 * 1024,
});

const BLOCKED_ELEMENTS = new Set([
  "a",
  "animate",
  "animatemotion",
  "animatetransform",
  "audio",
  "base",
  "canvas",
  "discard",
  "embed",
  "feimage",
  "font",
  "font-face",
  "foreignobject",
  "iframe",
  "image",
  "link",
  "mpath",
  "object",
  "script",
  "set",
  "style",
  "text",
  "textpath",
  "tspan",
  "use",
  "video",
]);

const LENGTH_FACTORS: Readonly<Record<string, number>> = Object.freeze({
  "": 1,
  cm: 96 / 2.54,
  in: 96,
  mm: 96 / 25.4,
  pc: 16,
  pt: 96 / 72,
  px: 1,
  q: 96 / 101.6,
});

type SvgSafetyReason =
  | "blocked-element"
  | "complexity"
  | "doctype"
  | "event-handler"
  | "external-reference"
  | "invalid-dimensions"
  | "invalid-namespace"
  | "malformed-xml"
  | "processing-instruction"
  | "style"
  | "text-requires-font"
  | "unsupported-encoding";

export interface SvgRenderAdapter {
  render(svg: Uint8Array, width: number, height: number): Promise<ArrayBuffer>;
}

function unsafeSvg(reason: SvgSafetyReason): never {
  throw new HeaderProbeError("unsafe-svg", "SVG input failed the bounded safety policy.", {
    reason,
  });
}

function decodeSvg(input: ArrayBuffer | Uint8Array): { bytes: Uint8Array; source: string } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 1) unsafeSvg("malformed-xml");
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (source.includes("\0")) unsafeSvg("malformed-xml");
    return { bytes, source };
  } catch (error) {
    if (error instanceof HeaderProbeError) throw error;
    unsafeSvg("unsupported-encoding");
  }
}

function parseLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^\s*(\d+(?:\.\d+)?|\.\d+)(?:[eE]([+-]?\d+))?\s*(cm|in|mm|pc|pt|px|q)?\s*$/u.exec(
    value,
  );
  if (!match) return undefined;
  const exponent = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 12) return undefined;
  const numeric = Number(match[1]) * 10 ** exponent;
  const factor = LENGTH_FACTORS[(match[3] ?? "").toLowerCase()];
  if (factor === undefined || !Number.isFinite(numeric) || numeric <= 0) return undefined;
  const pixels = numeric * factor;
  return Number.isFinite(pixels) && pixels > 0 ? pixels : undefined;
}

function parseViewBox(value: string | undefined): { height: number; width: number } | undefined {
  if (value === undefined) return undefined;
  const parts = value
    .trim()
    .split(/[\s,]+/u)
    .filter(Boolean);
  if (parts.length !== 4) return undefined;
  const numbers = parts.map(Number);
  const width = numbers[2];
  const height = numbers[3];
  if (
    width === undefined ||
    height === undefined ||
    !numbers.every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { height, width };
}

function validateLocalUrlFunctions(value: string): void {
  if (!value.toLowerCase().includes("url")) return;
  const withoutLocalReferences = value.replace(
    /url\s*\(\s*(["']?)#[A-Za-z_][\w:.-]*\1\s*\)/giu,
    "",
  );
  if (/url\s*\(/iu.test(withoutLocalReferences)) unsafeSvg("external-reference");
}

function validateReference(value: string): void {
  if (!/^#[A-Za-z_][\w:.-]*$/u.test(value.trim())) unsafeSvg("external-reference");
}

function validateAttribute(attribute: SaxesAttributeNS): void {
  const name = attribute.local.toLowerCase();
  const qualifiedName = attribute.name.toLowerCase();
  // Presentation attributes use CSS value syntax. Reject escapes so a value cannot
  // hide an external url() token from the deliberately small allow-list below.
  if (attribute.value.includes("\\")) unsafeSvg("external-reference");
  if (/^on/u.test(name)) unsafeSvg("event-handler");
  if (name === "style") unsafeSvg("style");
  if (name === "base" || name === "src") unsafeSvg("external-reference");
  if (name === "href" || qualifiedName === "xlink:href") validateReference(attribute.value);
  validateLocalUrlFunctions(attribute.value);
  if (
    attribute.uri &&
    attribute.uri !== XLINK_NAMESPACE &&
    attribute.uri !== XML_NAMESPACE &&
    attribute.uri !== XMLNS_NAMESPACE
  ) {
    unsafeSvg("invalid-namespace");
  }
}

function resolvedDimensions(
  rootAttributes: Readonly<Record<string, string>>,
  limits: ResourceLimits,
): { height: number; width: number } {
  const declaredWidth = parseLength(rootAttributes.width);
  const declaredHeight = parseLength(rootAttributes.height);
  const viewBox = parseViewBox(rootAttributes.viewbox);
  if (
    (rootAttributes.width !== undefined &&
      declaredWidth === undefined &&
      !/^\s*\d+(?:\.\d+)?%\s*$/u.test(rootAttributes.width)) ||
    (rootAttributes.height !== undefined &&
      declaredHeight === undefined &&
      !/^\s*\d+(?:\.\d+)?%\s*$/u.test(rootAttributes.height))
  ) {
    unsafeSvg("invalid-dimensions");
  }
  let rawWidth = declaredWidth;
  let rawHeight = declaredHeight;
  if (rawWidth !== undefined && rawHeight === undefined && viewBox) {
    rawHeight = rawWidth * (viewBox.height / viewBox.width);
  } else if (rawHeight !== undefined && rawWidth === undefined && viewBox) {
    rawWidth = rawHeight * (viewBox.width / viewBox.height);
  } else {
    rawWidth ??= viewBox?.width;
    rawHeight ??= viewBox?.height;
  }
  if (rawWidth === undefined || rawHeight === undefined) unsafeSvg("invalid-dimensions");
  const width = Math.max(1, Math.round(rawWidth));
  const height = Math.max(1, Math.round(rawHeight));
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width > 65_535 ||
    height > 65_535 ||
    !Number.isSafeInteger(pixels) ||
    pixels > limits.absolutePixels ||
    pixels > limits.maxRuntimePixels
  ) {
    throw new HeaderProbeError(
      "pixel-budget-exceeded",
      "SVG dimensions exceed the active Web runtime pixel budget.",
      { height, limitPixels: Math.min(limits.absolutePixels, limits.maxRuntimePixels), width },
    );
  }
  return { height, width };
}

export function probeSvg(
  input: ArrayBuffer | Uint8Array,
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): ProbeResult {
  const { bytes, source } = decodeSvg(input);
  if (bytes.byteLength > limits.maxSvgBytes) {
    throw new HeaderProbeError("input-too-large", "SVG source exceeds the Web byte limit.", {
      limitBytes: limits.maxSvgBytes,
      sourceByteLength: bytes.byteLength,
    });
  }

  let attributeCount = 0;
  let depth = 0;
  let filterCount = 0;
  let filterDepth = 0;
  let filterPrimitiveCount = 0;
  let nodeCount = 0;
  let pathDataCharacters = 0;
  let rootAttributes: Record<string, string> | undefined;
  const parser = new SaxesParser<{ xmlns: true }>({ xmlns: true });

  parser.on("doctype", () => unsafeSvg("doctype"));
  parser.on("processinginstruction", () => unsafeSvg("processing-instruction"));
  parser.on("xmldecl", ({ encoding }) => {
    if (encoding && !/^utf-?8$/iu.test(encoding)) unsafeSvg("unsupported-encoding");
  });
  parser.on("opentag", (tag: SaxesTagNS) => {
    depth += 1;
    nodeCount += 1;
    const localName = tag.local.toLowerCase();
    if (depth > SVG_COMPLEXITY_LIMITS.depth || nodeCount > SVG_COMPLEXITY_LIMITS.nodes) {
      unsafeSvg("complexity");
    }
    if (tag.uri !== "" && tag.uri !== SVG_NAMESPACE) unsafeSvg("invalid-namespace");
    if (nodeCount === 1) {
      if (localName !== "svg") unsafeSvg("malformed-xml");
      rootAttributes = {};
    }
    if (BLOCKED_ELEMENTS.has(localName) || localName.startsWith("font")) {
      unsafeSvg(
        localName === "text" || localName === "textpath" || localName === "tspan"
          ? "text-requires-font"
          : "blocked-element",
      );
    }
    if (localName === "filter") {
      filterCount += 1;
      filterDepth += 1;
      if (filterCount > SVG_COMPLEXITY_LIMITS.filters || filterDepth > 1) {
        unsafeSvg("complexity");
      }
    } else if (filterDepth > 0 && localName.startsWith("fe")) {
      filterPrimitiveCount += 1;
      if (filterPrimitiveCount > SVG_COMPLEXITY_LIMITS.filterPrimitives) {
        unsafeSvg("complexity");
      }
    }

    const attributes = Object.values(tag.attributes);
    attributeCount += attributes.length;
    if (attributeCount > SVG_COMPLEXITY_LIMITS.attributes) unsafeSvg("complexity");
    for (const attribute of attributes) {
      validateAttribute(attribute);
      if (nodeCount === 1 && rootAttributes) {
        rootAttributes[attribute.local.toLowerCase()] = attribute.value;
      }
      if (attribute.local.toLowerCase() === "d") {
        pathDataCharacters += attribute.value.length;
        if (pathDataCharacters > SVG_COMPLEXITY_LIMITS.pathDataCharacters) {
          unsafeSvg("complexity");
        }
      }
    }
  });
  parser.on("closetag", (tag: SaxesTagNS) => {
    if (tag.local.toLowerCase() === "filter") filterDepth -= 1;
    depth -= 1;
  });

  try {
    parser.write(source).close();
  } catch (error) {
    if (error instanceof HeaderProbeError) throw error;
    unsafeSvg("malformed-xml");
  }
  if (!rootAttributes || nodeCount < 1 || depth !== 0) unsafeSvg("malformed-xml");
  const { height, width } = resolvedDimensions(rootAttributes, limits);
  return Object.freeze({
    alpha: "present",
    animation: "static",
    byteLength: bytes.byteLength,
    colorProfile: "none",
    format: "svg",
    height,
    metadata: Object.freeze({ exif: "absent", iptc: "absent", orientation: null, xmp: "absent" }),
    width,
  });
}

function failure(code: Parameters<typeof createConversionFailure>[0]): ConversionOutcome {
  return Object.freeze({ failure: createConversionFailure(code, true), ok: false });
}

function report(
  reporter: RasterProgressReporter | undefined,
  phase: ConversionProgressPhase,
  progress: number,
): void {
  reporter?.(Object.freeze({ phase, progress }));
}

export async function convertSvgRequest(
  request: ConversionRequest,
  renderer: SvgRenderAdapter,
  codecs: RasterCodecAdapter,
  onProgress?: RasterProgressReporter,
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): Promise<ConversionOutcome> {
  try {
    assertConversionRequest(request, limits);
  } catch {
    return failure("invalid-settings");
  }
  if (request.input.probe.format !== "svg") return failure("unsupported-input");
  if (request.outputByteLimit === 0) return failure("output-budget-exceeded");

  const startedAt = performance.now();
  let svgProbe: ProbeResult;
  try {
    report(onProgress, "loading", 0.05);
    svgProbe = probeSvg(request.input.bytes, limits);
    if (
      svgProbe.width !== request.input.probe.width ||
      svgProbe.height !== request.input.probe.height ||
      svgProbe.byteLength !== request.input.probe.byteLength
    ) {
      return failure("format-mismatch");
    }
  } catch (error) {
    if (error instanceof HeaderProbeError) {
      if (
        error.code === "input-too-large" ||
        error.code === "pixel-budget-exceeded" ||
        error.code === "unsafe-svg"
      ) {
        return failure(error.code);
      }
    }
    return failure("unsafe-svg");
  }

  let pngBytes: ArrayBuffer;
  try {
    report(onProgress, "rendering", 0.25);
    pngBytes = await renderer.render(
      new Uint8Array(request.input.bytes),
      svgProbe.width,
      svgProbe.height,
    );
  } catch {
    return failure("decode-failed");
  }

  const intermediateLimits: ResourceLimits = {
    ...limits,
    maxRasterBytes: Math.max(limits.maxRasterBytes, pngBytes.byteLength),
  };
  let renderedProbe: ProbeResult;
  try {
    if (pngBytes.byteLength < 1 || pngBytes.byteLength > MAX_RASTER_OUTPUT_BYTES) {
      return failure("output-validation-failed");
    }
    renderedProbe = probeRasterHeader(pngBytes, pngBytes.byteLength, {
      limits: intermediateLimits,
      maxProbeBytes: Math.max(64, pngBytes.byteLength),
    });
    if (
      renderedProbe.format !== "png" ||
      renderedProbe.width !== svgProbe.width ||
      renderedProbe.height !== svgProbe.height
    ) {
      return failure("output-validation-failed");
    }
  } catch {
    return failure("output-validation-failed");
  }

  const rasterRequest: ConversionRequest = {
    input: { bytes: pngBytes, name: request.input.name, probe: renderedProbe },
    ...(request.outputByteLimit === undefined ? {} : { outputByteLimit: request.outputByteLimit }),
    jobId: request.jobId,
    schemaVersion: 1,
    settings: request.settings,
  };
  const outcome = await convertRasterRequest(
    rasterRequest,
    codecs,
    ({ phase, progress }) => {
      const mappedProgress = 0.32 + progress * 0.68;
      report(onProgress, phase, mappedProgress);
    },
    intermediateLimits,
  );
  if (!outcome.ok) return outcome;
  return Object.freeze({
    ok: true,
    result: Object.freeze({ ...outcome.result, durationMs: performance.now() - startedAt }),
  });
}
