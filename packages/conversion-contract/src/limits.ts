export interface ResourceLimits {
  readonly absolutePixels: number;
  readonly maxFallbackArchiveBytes: number;
  readonly maxPdfBytes: number;
  readonly maxPdfPages: number;
  readonly maxQueueFiles: number;
  readonly maxRasterBytes: number;
  readonly maxRuntimePixels: number;
  readonly maxSelectedPdfPages: number;
  readonly maxSvgBytes: number;
  readonly maxTotalSourceBytes: number;
}

export const WEB_V1_DESKTOP_LIMITS = Object.freeze<ResourceLimits>({
  absolutePixels: 64_000_000,
  maxFallbackArchiveBytes: 256 * 1024 * 1024,
  maxPdfBytes: 256 * 1024 * 1024,
  maxPdfPages: 500,
  maxQueueFiles: 100,
  maxRasterBytes: 32 * 1024 * 1024,
  maxRuntimePixels: 24_000_000,
  maxSelectedPdfPages: 100,
  maxSvgBytes: 16 * 1024 * 1024,
  maxTotalSourceBytes: 2 * 1024 * 1024 * 1024,
});

export function createResourceLimits(limits: ResourceLimits): ResourceLimits {
  const snapshot: ResourceLimits = {
    absolutePixels: limits.absolutePixels,
    maxFallbackArchiveBytes: limits.maxFallbackArchiveBytes,
    maxPdfBytes: limits.maxPdfBytes,
    maxPdfPages: limits.maxPdfPages,
    maxQueueFiles: limits.maxQueueFiles,
    maxRasterBytes: limits.maxRasterBytes,
    maxRuntimePixels: limits.maxRuntimePixels,
    maxSelectedPdfPages: limits.maxSelectedPdfPages,
    maxSvgBytes: limits.maxSvgBytes,
    maxTotalSourceBytes: limits.maxTotalSourceBytes,
  };
  for (const [key, value] of Object.entries(snapshot)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`limits.${key} must be a positive safe integer.`);
    }
  }
  if (snapshot.maxRuntimePixels > snapshot.absolutePixels) {
    throw new RangeError("limits.maxRuntimePixels cannot exceed limits.absolutePixels.");
  }
  return Object.freeze(snapshot);
}
