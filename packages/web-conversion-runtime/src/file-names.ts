const MAX_BATCH_FILE_NAME_CODE_POINTS = 200;
const WINDOWS_DEVICE_NAME = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function codePoints(value: string): string[] {
  return [...value];
}

function splitExtension(name: string): Readonly<{ base: string; extension: string }> {
  const extensionOffset = name.lastIndexOf(".");
  if (extensionOffset <= 0 || extensionOffset === name.length - 1) {
    return { base: name, extension: "" };
  }
  return { base: name.slice(0, extensionOffset), extension: name.slice(extensionOffset) };
}

function truncateFileName(name: string, suffix = ""): string {
  const { base, extension } = splitExtension(name);
  const available = Math.max(
    1,
    MAX_BATCH_FILE_NAME_CODE_POINTS - codePoints(extension).length - codePoints(suffix).length,
  );
  return `${codePoints(base).slice(0, available).join("")}${suffix}${extension}`;
}

export function sanitizeBatchFileName(value: string, fallback = "converted-image"): string {
  const normalized = codePoints(value.normalize("NFC"))
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      const control = point <= 0x1f || (point >= 0x7f && point <= 0x9f);
      const bidirectionalControl =
        point === 0x061c ||
        point === 0x200e ||
        point === 0x200f ||
        (point >= 0x202a && point <= 0x202e) ||
        (point >= 0x2066 && point <= 0x2069);
      return control || bidirectionalControl ? "-" : character;
    })
    .join("")
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/[.\s-]{2,}/gu, "-")
    .replace(/^[.\s-]+|[.\s]+$/gu, "")
    .trim();
  const usable = normalized && normalized !== "." ? normalized : fallback;
  const nonReserved = WINDOWS_DEVICE_NAME.test(usable) ? `_${usable}` : usable;
  return truncateFileName(nonReserved);
}

export function isSafeBatchFileName(value: string): boolean {
  return (
    value.length > 0 &&
    value === sanitizeBatchFileName(value) &&
    codePoints(value).length <= MAX_BATCH_FILE_NAME_CODE_POINTS
  );
}

export function fileNameWithCollisionSuffix(value: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 2) {
    throw new RangeError("Collision sequence must be an integer greater than 1.");
  }
  return truncateFileName(value, ` (${sequence})`);
}

function collisionKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function reserveUniqueBatchFileName(value: string, used: Set<string>): string {
  const safe = sanitizeBatchFileName(value);
  let candidate = safe;
  let sequence = 2;
  while (used.has(collisionKey(candidate))) {
    candidate = fileNameWithCollisionSuffix(safe, sequence);
    sequence += 1;
  }
  used.add(collisionKey(candidate));
  return candidate;
}
