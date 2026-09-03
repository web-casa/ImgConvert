import {
  HeaderProbeError,
  MAX_CONTAINER_BOXES,
  ascii,
  invalidContainer,
  readUint16BigEndian,
  readUint32BigEndian,
  requireBytes,
  type ParsedRasterHeader,
} from "./shared.js";

interface Box {
  readonly dataEnd: number;
  readonly dataStart: number;
  readonly end: number;
  readonly type: string;
}

interface AvifProperties {
  readonly associations: Map<number, readonly number[]>;
  readonly colorProfiles: Map<number, ParsedRasterHeader["colorProfile"]>;
  readonly dimensions: Map<number, Readonly<{ height: number; width: number }>>;
  readonly primaryItemId: number;
}

interface ParseContext {
  boxCount: number;
}

function requireBoxBytes(
  bytes: Uint8Array,
  box: Box,
  offset: number,
  length: number,
  context: string,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < box.dataStart ||
    length < 0 ||
    offset + length > box.dataEnd
  ) {
    invalidContainer(`${context} exceeds its containing ${box.type} box.`);
  }
  requireBytes(bytes, offset, length, context);
}

function readBox(bytes: Uint8Array, offset: number, parentEnd: number, context: ParseContext): Box {
  context.boxCount += 1;
  if (context.boxCount > MAX_CONTAINER_BOXES) {
    invalidContainer("AVIF contains too many boxes in the probe window.");
  }
  if (offset + 8 > parentEnd) invalidContainer("AVIF box header exceeds its parent box.");
  requireBytes(bytes, offset, 8, "AVIF box header");
  const size32 = readUint32BigEndian(bytes, offset);
  const type = ascii(bytes, offset + 4, offset + 8);
  let headerLength = 8;
  let size = size32;
  if (size32 === 1) {
    if (offset + 16 > parentEnd) invalidContainer("AVIF large box header exceeds its parent box.");
    requireBytes(bytes, offset + 8, 8, "AVIF large box size");
    const largeSize = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 8).getBigUint64(0);
    if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
      invalidContainer("AVIF box size exceeds the safe integer range.");
    }
    size = Number(largeSize);
    headerLength = 16;
  } else if (size32 === 0) {
    invalidContainer("AVIF zero-sized boxes are not accepted by the bounded probe.");
  }
  if (size < headerLength) invalidContainer(`AVIF ${type} box is smaller than its header.`);
  const end = offset + size;
  if (!Number.isSafeInteger(end) || end > parentEnd) {
    invalidContainer(`AVIF ${type} box exceeds its parent box.`);
  }
  requireBytes(bytes, offset, size, `AVIF ${type} box`);
  return { dataEnd: end, dataStart: offset + headerLength, end, type };
}

function fullBoxVersionAndFlags(
  bytes: Uint8Array,
  box: Box,
): { flags: number; offset: number; version: number } {
  requireBoxBytes(bytes, box, box.dataStart, 4, `AVIF ${box.type} full-box header`);
  return {
    flags:
      ((bytes[box.dataStart + 1] ?? 0) << 16) |
      ((bytes[box.dataStart + 2] ?? 0) << 8) |
      (bytes[box.dataStart + 3] ?? 0),
    offset: box.dataStart + 4,
    version: bytes[box.dataStart] ?? 0,
  };
}

function parsePrimaryItem(bytes: Uint8Array, box: Box): number {
  const { flags, offset, version } = fullBoxVersionAndFlags(bytes, box);
  if (flags !== 0) invalidContainer("AVIF pitm flags must be zero.");
  if (version === 0) {
    requireBoxBytes(bytes, box, offset, 2, "AVIF pitm item id");
    return readUint16BigEndian(bytes, offset);
  }
  if (version === 1) {
    requireBoxBytes(bytes, box, offset, 4, "AVIF pitm item id");
    return readUint32BigEndian(bytes, offset);
  }
  invalidContainer(`AVIF pitm version ${version} is unsupported.`);
}

function parseColorProperty(bytes: Uint8Array, property: Box): ParsedRasterHeader["colorProfile"] {
  requireBoxBytes(bytes, property, property.dataStart, 4, "AVIF colr color type");
  const colorType = ascii(bytes, property.dataStart, property.dataStart + 4);
  if (colorType === "prof" || colorType === "rICC") return "unknown";
  if (colorType !== "nclx") return "unknown";
  requireBoxBytes(bytes, property, property.dataStart + 4, 7, "AVIF nclx color fields");
  const colorPrimaries = readUint16BigEndian(bytes, property.dataStart + 4);
  const transferCharacteristics = readUint16BigEndian(bytes, property.dataStart + 6);
  if (colorPrimaries === 1 && transferCharacteristics === 13) return "srgb";
  if (colorPrimaries === 2 && transferCharacteristics === 2) return "none";
  return "nonSrgb";
}

function parsePropertyContainer(
  bytes: Uint8Array,
  box: Box,
  context: ParseContext,
): {
  colorProfiles: Map<number, ParsedRasterHeader["colorProfile"]>;
  dimensions: Map<number, Readonly<{ height: number; width: number }>>;
} {
  const colorProfiles = new Map<number, ParsedRasterHeader["colorProfile"]>();
  const dimensions = new Map<number, Readonly<{ height: number; width: number }>>();
  let propertyIndex = 1;
  let offset = box.dataStart;
  while (offset < box.dataEnd) {
    const property = readBox(bytes, offset, box.dataEnd, context);
    if (property.type === "ispe") {
      const { flags, offset: fieldOffset, version } = fullBoxVersionAndFlags(bytes, property);
      if (version !== 0 || flags !== 0) {
        invalidContainer("AVIF ispe full-box version and flags must be zero.");
      }
      requireBoxBytes(bytes, property, fieldOffset, 8, "AVIF ispe dimensions");
      const width = readUint32BigEndian(bytes, fieldOffset);
      const height = readUint32BigEndian(bytes, fieldOffset + 4);
      if (width === 0 || height === 0) invalidContainer("AVIF ispe dimensions must be non-zero.");
      dimensions.set(propertyIndex, Object.freeze({ height, width }));
    }
    if (property.type === "colr") {
      colorProfiles.set(propertyIndex, parseColorProperty(bytes, property));
    }
    propertyIndex += 1;
    offset = property.end;
  }
  return { colorProfiles, dimensions };
}

function parsePropertyAssociations(bytes: Uint8Array, box: Box): Map<number, readonly number[]> {
  const associations = new Map<number, readonly number[]>();
  const { flags, offset: initialOffset, version } = fullBoxVersionAndFlags(bytes, box);
  if (version > 1) invalidContainer(`AVIF ipma version ${version} is unsupported.`);
  if ((flags & 0xfffffe) !== 0) invalidContainer("AVIF ipma reserved flags are set.");
  const largeAssociations = Boolean(flags & 1);
  let offset = initialOffset;
  requireBoxBytes(bytes, box, offset, 4, "AVIF ipma entry count");
  const entryCount = readUint32BigEndian(bytes, offset);
  offset += 4;
  if (entryCount > MAX_CONTAINER_BOXES) invalidContainer("AVIF ipma entry count is excessive.");

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    requireBoxBytes(bytes, box, offset, version === 0 ? 2 : 4, "AVIF ipma item id");
    const itemId =
      version === 0 ? readUint16BigEndian(bytes, offset) : readUint32BigEndian(bytes, offset);
    offset += version === 0 ? 2 : 4;
    requireBoxBytes(bytes, box, offset, 1, "AVIF ipma association count");
    const associationCount = bytes[offset] ?? 0;
    offset += 1;
    const propertyIndices: number[] = [];
    for (let index = 0; index < associationCount; index += 1) {
      if (largeAssociations) {
        requireBoxBytes(bytes, box, offset, 2, "AVIF ipma property association");
        const association = readUint16BigEndian(bytes, offset);
        propertyIndices.push(association & 0x7fff);
        offset += 2;
      } else {
        requireBoxBytes(bytes, box, offset, 1, "AVIF ipma property association");
        propertyIndices.push((bytes[offset] ?? 0) & 0x7f);
        offset += 1;
      }
    }
    if (associations.has(itemId)) invalidContainer("AVIF ipma contains a duplicate item id.");
    associations.set(itemId, Object.freeze(propertyIndices.filter((index) => index > 0)));
  }
  return associations;
}

function parseItemProperties(
  bytes: Uint8Array,
  box: Box,
  context: ParseContext,
): {
  associations: Map<number, readonly number[]>;
  colorProfiles: Map<number, ParsedRasterHeader["colorProfile"]>;
  dimensions: Map<number, Readonly<{ height: number; width: number }>>;
} {
  let colorProfiles = new Map<number, ParsedRasterHeader["colorProfile"]>();
  let offset = box.dataStart;
  let dimensions = new Map<number, Readonly<{ height: number; width: number }>>();
  const associations = new Map<number, readonly number[]>();
  let foundPropertyContainer = false;
  while (offset < box.dataEnd) {
    const child = readBox(bytes, offset, box.dataEnd, context);
    if (child.type === "ipco") {
      if (foundPropertyContainer) invalidContainer("AVIF iprp contains duplicate ipco boxes.");
      foundPropertyContainer = true;
      ({ colorProfiles, dimensions } = parsePropertyContainer(bytes, child, context));
    }
    if (child.type === "ipma") {
      for (const [itemId, indices] of parsePropertyAssociations(bytes, child)) {
        if (associations.has(itemId)) {
          invalidContainer("AVIF iprp contains duplicate associations for an item id.");
        }
        associations.set(itemId, indices);
      }
    }
    offset = child.end;
  }
  return { associations, colorProfiles, dimensions };
}

function parseMeta(bytes: Uint8Array, box: Box, context: ParseContext): AvifProperties {
  const { flags, offset: childrenStart, version } = fullBoxVersionAndFlags(bytes, box);
  if (version !== 0 || flags !== 0) {
    invalidContainer("AVIF meta full-box version and flags must be zero.");
  }
  let primaryItemId: number | undefined;
  let associations = new Map<number, readonly number[]>();
  let colorProfiles = new Map<number, ParsedRasterHeader["colorProfile"]>();
  let dimensions = new Map<number, Readonly<{ height: number; width: number }>>();
  let foundItemProperties = false;
  let offset = childrenStart;
  while (offset < box.dataEnd) {
    const child = readBox(bytes, offset, box.dataEnd, context);
    if (child.type === "pitm") {
      if (primaryItemId !== undefined) invalidContainer("AVIF meta contains duplicate pitm boxes.");
      primaryItemId = parsePrimaryItem(bytes, child);
    }
    if (child.type === "iprp") {
      if (foundItemProperties) invalidContainer("AVIF meta contains duplicate iprp boxes.");
      foundItemProperties = true;
      ({ associations, colorProfiles, dimensions } = parseItemProperties(bytes, child, context));
    }
    offset = child.end;
  }
  if (primaryItemId === undefined) invalidContainer("AVIF meta box has no primary item.");
  return { associations, colorProfiles, dimensions, primaryItemId };
}

function parseBrands(bytes: Uint8Array, box: Box): Set<string> {
  if (box.dataEnd - box.dataStart < 8 || (box.dataEnd - box.dataStart - 8) % 4 !== 0) {
    invalidContainer("AVIF ftyp box has an invalid brand list.");
  }
  const brands = new Set<string>([ascii(bytes, box.dataStart, box.dataStart + 4)]);
  for (let offset = box.dataStart + 8; offset < box.dataEnd; offset += 4) {
    brands.add(ascii(bytes, offset, offset + 4));
  }
  return brands;
}

export function parseAvifHeader(bytes: Uint8Array, sourceByteLength: number): ParsedRasterHeader {
  const context: ParseContext = { boxCount: 0 };
  let offset = 0;
  let brands: Set<string> | undefined;
  let properties: AvifProperties | undefined;
  while (offset < bytes.byteLength && (!brands || !properties)) {
    const box = readBox(bytes, offset, sourceByteLength, context);
    if (box.type === "ftyp") brands = parseBrands(bytes, box);
    if (box.type === "meta") properties = parseMeta(bytes, box, context);
    offset = box.end;
  }
  if (!brands?.has("avif") && !brands?.has("avis")) {
    invalidContainer("ISO BMFF input does not declare an AVIF compatible brand.");
  }
  if (brands.has("avis")) {
    throw new HeaderProbeError("animated-input", "Animated AVIF sequences are not supported.", {
      format: "avif",
    });
  }
  if (!properties) {
    if (bytes.byteLength === sourceByteLength) {
      invalidContainer("AVIF source contains no usable meta properties.");
    }
    throw new HeaderProbeError(
      "probe-limit-exceeded",
      "AVIF meta properties were not found inside the bounded probe window.",
    );
  }
  const propertyIndices = properties.associations.get(properties.primaryItemId) ?? [];
  const dimensions = propertyIndices
    .map((index) => properties.dimensions.get(index))
    .find((candidate) => candidate !== undefined);
  if (!dimensions) invalidContainer("AVIF primary item has no associated ispe dimensions.");
  const colorProfile =
    propertyIndices
      .map((index) => properties.colorProfiles.get(index))
      .find((candidate) => candidate !== undefined) ?? "none";
  return {
    alpha: "unknown",
    animation: "static",
    colorProfile,
    format: "avif",
    height: dimensions.height,
    metadata: { exif: "unknown", iptc: "unknown", orientation: "unknown", xmp: "unknown" },
    width: dimensions.width,
  };
}
