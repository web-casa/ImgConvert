// SPDX-License-Identifier: Apache-2.0

export const WORKFLOW_SETTINGS_VERSION = 1;
export const MAX_CUSTOM_PRESETS = 20;
export const MAX_PRESET_NAME_CHARS = 64;
export const MAX_RESIZE_PERCENT = 400;
export const MIN_TARGET_SIZE_KIB = 16;
export const MAX_TARGET_SIZE_KIB = 100 * 1024;

export type ResizeMode = "none" | "fit" | "width" | "height" | "longestEdge" | "percentage";
export type MetadataPolicy = "stripAll" | "colorOnly" | "preserveAll";

export interface WorkflowPresetSnapshot {
  format: string;
  quality: number;
  jpegQualityFloor: number;
  webpQualityFloor: number;
  avifQualityFloor: number;
  lossless: boolean;
  jpegProgressive: boolean;
  pngOxipngLevel: number;
  pngLossyQuantize: boolean;
  pngQuantColors: number;
  webpMethod: number;
  avifSpeed: number;
  avifSubsample: string;
  webpNearLossless: number;
  webpSharpYuv: boolean;
  jpegTrellis: boolean;
  autoQuality: boolean;
  autoQualityScore: number;
  generationLossProtection: boolean;
  skipIfLarger: boolean;
  multiCandidate: boolean;
  resizeMode: ResizeMode;
  resizeWidth: number;
  resizeHeight: number;
  resizeValue: number;
  resizeAllowUpscale: boolean;
  targetSizeEnabled: boolean;
  targetSizeKib: number;
  metadataPolicy: MetadataPolicy;
  colorManagementPolicy: "preserve" | "convertToSrgb";
}

export interface BuiltinWorkflowPreset {
  id: string;
  labelKey: string;
  descriptionKey: string;
  snapshot: WorkflowPresetSnapshot;
}

export interface CustomWorkflowPreset {
  id: string;
  name: string;
  version: number;
  snapshot: WorkflowPresetSnapshot;
}

const DEFAULT_SNAPSHOT: WorkflowPresetSnapshot = {
  format: "avif",
  quality: 80,
  jpegQualityFloor: 30,
  webpQualityFloor: 30,
  avifQualityFloor: 30,
  lossless: false,
  jpegProgressive: true,
  pngOxipngLevel: 4,
  pngLossyQuantize: false,
  pngQuantColors: 256,
  webpMethod: 4,
  avifSpeed: 8,
  avifSubsample: "yuv444",
  webpNearLossless: 100,
  webpSharpYuv: false,
  jpegTrellis: true,
  autoQuality: false,
  autoQualityScore: 80,
  generationLossProtection: false,
  skipIfLarger: false,
  multiCandidate: true,
  resizeMode: "none",
  resizeWidth: 1920,
  resizeHeight: 1080,
  resizeValue: 2048,
  resizeAllowUpscale: false,
  targetSizeEnabled: false,
  targetSizeKib: 1024,
  metadataPolicy: "stripAll",
  colorManagementPolicy: "preserve",
};

function preset(overrides: Partial<WorkflowPresetSnapshot>): WorkflowPresetSnapshot {
  return { ...DEFAULT_SNAPSHOT, ...overrides };
}

export const BUILTIN_WORKFLOW_PRESETS: readonly BuiltinWorkflowPreset[] = [
  {
    id: "builtin:web-sharing",
    labelKey: "workflow.presets.webSharing",
    descriptionKey: "workflow.presets.webSharingDescription",
    snapshot: preset({
      format: "webp",
      quality: 82,
      resizeMode: "longestEdge",
      resizeValue: 2048,
      metadataPolicy: "colorOnly",
    }),
  },
  {
    id: "builtin:email",
    labelKey: "workflow.presets.email",
    descriptionKey: "workflow.presets.emailDescription",
    snapshot: preset({
      format: "jpeg",
      quality: 82,
      resizeMode: "longestEdge",
      resizeValue: 1600,
      targetSizeEnabled: true,
      targetSizeKib: 1024,
      metadataPolicy: "colorOnly",
    }),
  },
  {
    id: "builtin:high-quality",
    labelKey: "workflow.presets.highQuality",
    descriptionKey: "workflow.presets.highQualityDescription",
    snapshot: preset({
      format: "avif",
      quality: 90,
      metadataPolicy: "preserveAll",
    }),
  },
  {
    id: "builtin:private-sharing",
    labelKey: "workflow.presets.privateSharing",
    descriptionKey: "workflow.presets.privateSharingDescription",
    snapshot: preset({
      format: "jpeg",
      quality: 85,
      resizeMode: "longestEdge",
      resizeValue: 2048,
      metadataPolicy: "stripAll",
    }),
  },
] as const;

type WorkflowSettingsSource = WorkflowPresetSnapshot & {
  customWorkflowPresets?: CustomWorkflowPreset[];
};

export function captureWorkflowSettings(settings: WorkflowSettingsSource): WorkflowPresetSnapshot {
  // Object construction is intentionally allowlisted by DEFAULT_SNAPSHOT; paths and overwrite
  // authority can never enter a preset even if Settings gains more fields later.
  const entries = (Object.keys(DEFAULT_SNAPSHOT) as (keyof WorkflowPresetSnapshot)[]).map((key) => [
    key,
    settings[key],
  ]);
  return normalizeWorkflowSnapshot(Object.fromEntries(entries));
}

export function applyWorkflowSnapshot(
  settings: WorkflowSettingsSource,
  snapshot: WorkflowPresetSnapshot,
): void {
  Object.assign(settings, normalizeWorkflowSnapshot(snapshot));
}

export function matchingWorkflowPresetId(
  settings: WorkflowSettingsSource,
  customPresets: readonly CustomWorkflowPreset[] = settings.customWorkflowPresets ?? [],
): string | null {
  const current = JSON.stringify(captureWorkflowSettings(settings));
  const preset = [...BUILTIN_WORKFLOW_PRESETS, ...customPresets].find(
    (candidate) => JSON.stringify(candidate.snapshot) === current,
  );
  return preset?.id ?? null;
}

export function normalizeCustomWorkflowPresets(value: unknown): CustomWorkflowPreset[] {
  if (!Array.isArray(value)) return [];
  const presets: CustomWorkflowPreset[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (presets.length >= MAX_CUSTOM_PRESETS) break;
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 128) : "";
    const name = normalizePresetName(candidate.name);
    if (!id.startsWith("custom:") || !name || ids.has(id)) continue;
    ids.add(id);
    presets.push({
      id,
      name,
      version: WORKFLOW_SETTINGS_VERSION,
      snapshot: normalizeWorkflowSnapshot(candidate.snapshot),
    });
  }
  return presets;
}

export function createCustomWorkflowPreset(
  id: string,
  name: unknown,
  settings: WorkflowSettingsSource,
): CustomWorkflowPreset | null {
  const normalizedName = normalizePresetName(name);
  if (!id.startsWith("custom:") || !normalizedName) return null;
  return {
    id,
    name: normalizedName,
    version: WORKFLOW_SETTINGS_VERSION,
    snapshot: captureWorkflowSettings(settings),
  };
}

export function normalizeWorkflowSnapshot(value: unknown): WorkflowPresetSnapshot {
  const source = isRecord(value) ? value : {};
  const normalizedResizeMode = resizeMode(source.resizeMode);
  const snapshot: WorkflowPresetSnapshot = {
    format: outputFormat(source.format),
    quality: integer(source.quality, 1, 100, DEFAULT_SNAPSHOT.quality),
    jpegQualityFloor: qualityFloor(source.jpegQualityFloor, DEFAULT_SNAPSHOT.jpegQualityFloor),
    webpQualityFloor: qualityFloor(source.webpQualityFloor, DEFAULT_SNAPSHOT.webpQualityFloor),
    avifQualityFloor: qualityFloor(source.avifQualityFloor, DEFAULT_SNAPSHOT.avifQualityFloor),
    lossless: booleanValue(source.lossless, DEFAULT_SNAPSHOT.lossless),
    jpegProgressive: booleanValue(source.jpegProgressive, DEFAULT_SNAPSHOT.jpegProgressive),
    pngOxipngLevel: integer(source.pngOxipngLevel, 0, 6, DEFAULT_SNAPSHOT.pngOxipngLevel),
    pngLossyQuantize: booleanValue(source.pngLossyQuantize, DEFAULT_SNAPSHOT.pngLossyQuantize),
    pngQuantColors: integer(source.pngQuantColors, 64, 256, DEFAULT_SNAPSHOT.pngQuantColors),
    webpMethod: integer(source.webpMethod, 0, 6, DEFAULT_SNAPSHOT.webpMethod),
    avifSpeed: integer(source.avifSpeed, 0, 10, DEFAULT_SNAPSHOT.avifSpeed),
    avifSubsample: source.avifSubsample === "yuv420" ? "yuv420" : "yuv444",
    webpNearLossless: integer(source.webpNearLossless, 0, 100, DEFAULT_SNAPSHOT.webpNearLossless),
    webpSharpYuv: booleanValue(source.webpSharpYuv, DEFAULT_SNAPSHOT.webpSharpYuv),
    jpegTrellis: booleanValue(source.jpegTrellis, DEFAULT_SNAPSHOT.jpegTrellis),
    autoQuality: booleanValue(source.autoQuality, DEFAULT_SNAPSHOT.autoQuality),
    autoQualityScore: integer(source.autoQualityScore, 50, 95, DEFAULT_SNAPSHOT.autoQualityScore),
    generationLossProtection: booleanValue(
      source.generationLossProtection,
      DEFAULT_SNAPSHOT.generationLossProtection,
    ),
    skipIfLarger: booleanValue(source.skipIfLarger, DEFAULT_SNAPSHOT.skipIfLarger),
    multiCandidate: booleanValue(source.multiCandidate, DEFAULT_SNAPSHOT.multiCandidate),
    resizeMode: normalizedResizeMode,
    resizeWidth: integer(source.resizeWidth, 1, 65_535, DEFAULT_SNAPSHOT.resizeWidth),
    resizeHeight: integer(source.resizeHeight, 1, 65_535, DEFAULT_SNAPSHOT.resizeHeight),
    resizeValue: integer(
      source.resizeValue,
      1,
      normalizedResizeMode === "percentage" ? MAX_RESIZE_PERCENT : 65_535,
      normalizedResizeMode === "percentage" ? 100 : DEFAULT_SNAPSHOT.resizeValue,
    ),
    resizeAllowUpscale: booleanValue(
      source.resizeAllowUpscale,
      DEFAULT_SNAPSHOT.resizeAllowUpscale,
    ),
    targetSizeEnabled: booleanValue(source.targetSizeEnabled, DEFAULT_SNAPSHOT.targetSizeEnabled),
    targetSizeKib: integer(
      source.targetSizeKib,
      MIN_TARGET_SIZE_KIB,
      MAX_TARGET_SIZE_KIB,
      DEFAULT_SNAPSHOT.targetSizeKib,
    ),
    metadataPolicy: metadataPolicy(source.metadataPolicy),
    colorManagementPolicy:
      source.colorManagementPolicy === "convertToSrgb" ? "convertToSrgb" : "preserve",
  };
  if (snapshot.targetSizeEnabled) {
    if (["jpeg", "webp"].includes(snapshot.format)) {
      snapshot.autoQuality = false;
      snapshot.lossless = false;
    } else {
      snapshot.targetSizeEnabled = false;
    }
  }
  return snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function qualityFloor(value: unknown, fallback: number): number {
  const normalized = integer(value, 0, 100, fallback);
  return normalized < 30 ? 0 : normalized;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function outputFormat(value: unknown): string {
  return ["jpeg", "png", "webp", "avif"].includes(String(value))
    ? String(value)
    : DEFAULT_SNAPSHOT.format;
}

function resizeMode(value: unknown): ResizeMode {
  return ["none", "fit", "width", "height", "longestEdge", "percentage"].includes(String(value))
    ? (value as ResizeMode)
    : DEFAULT_SNAPSHOT.resizeMode;
}

function metadataPolicy(value: unknown): MetadataPolicy {
  return ["stripAll", "colorOnly", "preserveAll"].includes(String(value))
    ? (value as MetadataPolicy)
    : DEFAULT_SNAPSHOT.metadataPolicy;
}

function normalizePresetName(value: unknown): string {
  return typeof value === "string"
    ? [...value.trim()].slice(0, MAX_PRESET_NAME_CHARS).join("")
    : "";
}
