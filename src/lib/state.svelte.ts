// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import { Channel, invoke, isTauri as tauriIsTauri } from "@tauri-apps/api/core";
import { confirm as confirmDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  formatCommandError,
  logCommandError,
  parseCommandError,
  type CommandError,
} from "$lib/command-error";
import {
  locale as localeStore,
  navigatorLocale,
  setAppLocale,
  systemLocale,
  translate,
  type AppLocale,
} from "$lib/i18n";
import {
  commandErrorMessage,
  formatLocalizedMessage,
  messageList,
  translationMessage,
  type LocalizedMessage,
} from "$lib/localized-message";
import {
  check as checkTauriUpdate,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { CoalescingWriter } from "$lib/coalescing-writer";
import {
  buildConvertRequest,
  conversionContentSignature,
  type ConvertRequest,
} from "$lib/conversion-options";
import {
  MAX_TARGET_SIZE_KIB,
  MIN_TARGET_SIZE_KIB,
  WORKFLOW_SETTINGS_VERSION,
  normalizeCustomWorkflowPresets,
  type CustomWorkflowPreset,
  type MetadataPolicy,
  type ResizeMode,
} from "$lib/workflow-presets";
import { decodePreviewPayload } from "$lib/preview-wire";

// ---- 类型 ----
export type ItemStatus = "pending" | "running" | "done" | "skipped" | "error";
export type ThumbnailStatus = "idle" | "loading" | "ready" | "skipped" | "error";
type BatchProgressStage = "readingAndConverting" | "done";
interface LocalizedItemDetail {
  key: string;
  params?: Record<string, string | number>;
}
export interface QueueItem {
  path: string;
  key: string;
  name: string;
  relativeDir: string | null;
  temporary?: boolean;
  status: ItemStatus;
  detail: string;
  targetFormat: string | null;
  metadata: ImageMetadata | null;
  thumbnail: ThumbnailPreview | null;
  thumbnailStatus: ThumbnailStatus;
  progress?: number;
  progressStage?: BatchProgressStage | null;
  localizedDetail?: LocalizedItemDetail | null;
  detailError?: CommandError | null;
  preview?: boolean;
}
export interface ComparisonPreviewResult {
  input: string;
  mime: string;
  sourcePage: number | null;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  outputSize: number;
  selectedQuality: number | null;
  targetSizeMet: boolean | null;
  warnings: ConvertWarning[];
}
export interface Capabilities {
  readable: string[];
  writable: string[];
  lossless: string[];
  colorPipeline: ColorPipelineCapability;
  heic: boolean;
  codecProviders: CodecProvider[];
}

export interface ColorPipelineCapability {
  rgba8: boolean;
  rgba16: boolean;
  rgbaF32: boolean;
  linearResize: boolean;
  iccTransform: boolean;
}

export interface CodecProvider {
  id: string;
  kind: string;
  license: string | null;
  readable: string[];
  writable: string[];
}
export interface CodecDiagnostics {
  heic: HeicCodecDiagnostics;
}
export interface DiagnosticMessage {
  code: string;
  detail: string | null;
}
export interface HeicCodecDiagnostics {
  enabled: boolean;
  externalCodecsEnabled: boolean;
  disabledReason: DiagnosticMessage | null;
  extensions: string[];
  activeProvider: CodecProviderDiagnostic | null;
  systemCodecs: SystemCodecDiagnostic[];
  selectedHelper: SelectedHelperDiagnostic;
  manifestDirs: ManifestSearchDirDiagnostic[];
  systemHelpers: SystemHelperDiagnostic[];
}
export interface CodecProviderDiagnostic extends CodecProvider {
  command: string;
  path: string;
  args: string[];
}
export interface ManifestSearchDirDiagnostic {
  source: string;
  path: string;
  status: string;
  message: DiagnosticMessage | null;
  manifests: ManifestDiagnostic[];
}
export interface ManifestDiagnostic {
  path: string;
  status: string;
  message: DiagnosticMessage | null;
  provider: CodecProviderDiagnostic | null;
}
export interface SystemHelperDiagnostic {
  command: string;
  available: boolean;
  path: string | null;
  message: DiagnosticMessage | null;
}
export interface SystemCodecDiagnostic {
  id: string;
  kind: string;
  available: boolean;
  readable: string[];
  message: DiagnosticMessage;
  installHint: DiagnosticMessage | null;
}
export interface SelectedHelperDiagnostic {
  configured: boolean;
  available: boolean;
  path: string | null;
  message: DiagnosticMessage | null;
  provider: CodecProviderDiagnostic | null;
}
export interface ConvertResult {
  input: string;
  output: string;
  inSize: number;
  outSize: number;
  warning?: ConvertWarning | null;
  warnings?: ConvertWarning[];
  outputCount?: number;
  skippedOutputCount?: number;
}
export type ConvertWarning =
  | {
      code: "previousOutputBackupRetained";
      path: string;
    }
  | {
      code: "modifiedTimeNotPreserved";
      path: string;
    }
  | {
      code: "outputBackupRetainedAndModifiedTimeNotPreserved";
      backupPath: string;
      outputPath: string;
    }
  | {
      code: "colorProfileConvertedForResize";
    }
  | {
      code: "invalidColorProfileDiscarded";
    }
  | {
      code: "invalidColorProfileIgnoredForPreview";
    }
  | {
      code: "targetSizeNotMet";
      targetBytes: number;
      actualBytes: number;
    }
  | {
      code: "pdfPagesSkippedExisting";
      count: number;
    }
  | {
      code: "pdfRenderWarnings";
      page: number;
      count: number;
    };
export interface ImportScanError {
  path: string;
  error: CommandError;
}
export interface UiImportError {
  path: string;
  message: string;
  localizedMessage: LocalizedMessage;
}
export interface ImportScanFile {
  path: string;
  key: string;
  relativeDir: string | null;
  metadata: ImageMetadata | null;
  temporary?: boolean;
}
export interface ImageMetadata {
  format: string;
  width: number;
  height: number;
  dpiX: number | null;
  dpiY: number | null;
  pageCount: number | null;
}
export interface ImportScanResult {
  files: ImportScanFile[];
  skipped: number;
  errors: ImportScanError[];
  truncated: boolean;
  cancelled: boolean;
  limitReason: ImportScanLimitReason | null;
}
export type ImportScanLimitReason = "directoryDepth" | "entryCount" | "fileCount";
export interface BatchSummary {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
}
export interface ThumbnailPreview {
  url: string;
  width: number;
  height: number;
  mime: string;
  warningCount: number;
}
export interface ThumbnailResult {
  input: string;
  mime: string;
  width: number;
  height: number;
  bytes: number[] | Uint8Array;
  warningCount: number;
}
export interface PickPathOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  extensions?: string[];
  defaultPath?: string;
  recursive?: boolean;
}
interface DesktopE2ESeed {
  input: string;
  pdfInput: string;
  outDir: string;
}
export interface ConversionPlanEntry {
  index: number;
  input: string;
  output: string | null;
  exists: boolean;
  sameAsSource: boolean;
  conflictsWithQueuedInput: boolean;
  outputCount: number;
  existingOutputCount: number;
  error: CommandError | null;
}
export interface AppUpdateState {
  checking: boolean;
  installing: boolean;
  available: boolean;
  checked: boolean;
  installed: boolean;
  version: string | null;
  currentVersion: string | null;
  date: string | null;
  body: string | null;
  message: string;
  error: string;
  downloadedBytes: number;
  contentLength: number | null;
}
export type { ConvertRequest } from "$lib/conversion-options";
type BatchConvertRequest = {
  options: ConvertRequest[];
  concurrency: number | null;
};
type BatchProgressEvent =
  | { event: "started"; data: { total: number } }
  | { event: "fileStarted"; data: { index: number; input: string } }
  | {
      event: "fileProgress";
      data: { index: number; percent: number; stage: BatchProgressStage };
    }
  | { event: "fileFinished"; data: { index: number; result: ConvertResult } }
  | {
      event: "fileSkipped";
      data: { index: number; input: string; error: CommandError };
    }
  | {
      event: "fileError";
      data: { index: number; input: string; error: CommandError };
    }
  | { event: "cancelled"; data: { completed: number; total: number } }
  | { event: "finished"; data: { summary: BatchSummary } };
type BatchJob = {
  item: QueueItem;
  options: ConvertRequest;
};
export type Theme = "light" | "dark" | "system";
export type OverwriteMode = "ask" | "skip" | "overwrite";
export type ImportMode = "scan" | "clipboard" | null;
export type ColorManagementPolicy = "preserve" | "convertToSrgb";

export interface Settings {
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
  resultCache: boolean;
  skipIfLarger: boolean;
  /** Internal migration marker for opt-in policies that can skip a conversion. */
  conversionPolicyVersion: number;
  multiCandidate: boolean;
  overwrite: OverwriteMode;
  outDir: string | null;
  heicHelperPath: string | null;
  fileNameTemplate: string;
  outputSuffixEnabled: boolean;
  outputSuffix: string;
  preserveMetadata: boolean;
  metadataPolicy: MetadataPolicy;
  resizeMode: ResizeMode;
  resizeWidth: number;
  resizeHeight: number;
  resizeValue: number;
  resizeAllowUpscale: boolean;
  targetSizeEnabled: boolean;
  targetSizeKib: number;
  workflowSettingsVersion: number;
  customWorkflowPresets: CustomWorkflowPreset[];
  colorManagementPolicy: ColorManagementPolicy;
  pdfDpi: number;
  pdfPageRange: string;
  concurrency: number;
  theme: Theme;
  reduceMotion: boolean;
  locale: AppLocale;
}

// ---- 常量 ----
const CORE_CAPABILITIES: Capabilities = {
  readable: ["jpeg", "png", "webp", "avif", "svg", "gif", "bmp", "pdf"],
  writable: ["jpeg", "png", "webp", "avif"],
  lossless: ["png", "webp", "avif"],
  colorPipeline: {
    rgba8: true,
    rgba16: true,
    rgbaF32: true,
    linearResize: true,
    iccTransform: true,
  },
  heic: false,
  codecProviders: [],
};

const FORMAT_EXTENSIONS: Record<string, string[]> = {
  jpeg: ["jpg", "jpeg"],
  png: ["png"],
  webp: ["webp"],
  avif: ["avif"],
  svg: ["svg"],
  gif: ["gif"],
  bmp: ["bmp"],
  heic: ["heic", "heif", "hif"],
  pdf: ["pdf"],
};
const THUMBNAIL_MAX_EDGE = 180;
const THUMBNAIL_CONCURRENCY = 2;
const CLIPBOARD_MAX_BYTES = 128 * 1024 * 1024;
const CLIPBOARD_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "image/gif",
  "image/bmp",
  "image/x-ms-bmp",
]);
export const OUTPUT_SUFFIX_MAX_CHARS = 48;
const OUTPUT_SUFFIX_MAX_BYTES = 128;
export const DEFAULT_OUTPUT_SUFFIX = "_done";
export const CONVERSION_POLICY_VERSION = 2;
export const MIN_PDF_DPI = 72;
export const MAX_PDF_DPI = 600;
export const DEFAULT_PDF_DPI = 150;
export const MAX_PDF_PAGES_PER_JOB = 500;
export const MAX_PDF_PAGE_RANGE_CHARS = 2048;
export interface RuntimeFileAccess {
  useHostLinuxPicker: boolean;
  requiresOutputDirectory: boolean;
  requiresOutputDirectorySessionGrant: boolean;
}

const SAFE_FILE_ACCESS_FALLBACK: RuntimeFileAccess = {
  useHostLinuxPicker: false,
  // If the bridge cannot report its policy, favor an explicit output folder
  // over a potentially unauthorized sibling write.
  requiresOutputDirectory: true,
  requiresOutputDirectorySessionGrant: true,
};

let runtimeFileAccessPromise: Promise<RuntimeFileAccess> | null = null;
// `NSOpenPanel` grants the App Sandbox access for the current process. A path
// restored from settings is not itself a macOS security-scoped bookmark, so it
// must not be treated as a write grant after an app relaunch.
export const outputDirectoryGrant = $state({ sessionGranted: false });

export const FORMAT_CATEGORIES = [
  { value: "modern", labelKey: "state.formatCategoryModern" },
  { value: "standard", labelKey: "state.formatCategoryStandard" },
];

export const FORMATS: {
  value: string;
  labelKey: string;
  category: string;
  descriptionKey: string;
  noteKey?: string;
}[] = [
  {
    value: "avif",
    labelKey: "state.formatLabelavif",
    category: "modern",
    descriptionKey: "state.formatAvifDescription",
  },
  {
    value: "webp",
    labelKey: "state.formatLabelwebp",
    category: "modern",
    descriptionKey: "state.formatWebpDescription",
  },
  {
    value: "jpeg",
    labelKey: "state.formatLabeljpeg",
    category: "standard",
    descriptionKey: "state.formatJpegDescription",
  },
  {
    value: "png",
    labelKey: "state.formatLabelpng",
    category: "standard",
    descriptionKey: "state.formatPngDescription",
  },
  {
    value: "heic",
    labelKey: "state.formatLabelheic",
    category: "modern",
    descriptionKey: "state.formatHeicDescription",
    noteKey: "state.formatHeicNote",
  },
];

export const IMAGE_EXTS = Object.values(FORMAT_EXTENSIONS).flat();

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && tauriIsTauri();
}

// ---- 状态(runes)----
export const settings = $state<Settings>({
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
  resultCache: true,
  // A requested format conversion must produce that format. Keeping only smaller
  // results is useful for compression-only work, but requires an explicit opt-in.
  skipIfLarger: false,
  conversionPolicyVersion: CONVERSION_POLICY_VERSION,
  multiCandidate: true,
  overwrite: "skip",
  outDir: null,
  heicHelperPath: null,
  fileNameTemplate: "%name%",
  outputSuffixEnabled: true,
  outputSuffix: DEFAULT_OUTPUT_SUFFIX,
  preserveMetadata: false,
  metadataPolicy: "stripAll",
  resizeMode: "none",
  resizeWidth: 1920,
  resizeHeight: 1080,
  resizeValue: 2048,
  resizeAllowUpscale: false,
  targetSizeEnabled: false,
  targetSizeKib: 1024,
  workflowSettingsVersion: WORKFLOW_SETTINGS_VERSION,
  customWorkflowPresets: [],
  colorManagementPolicy: "preserve",
  pdfDpi: 150,
  pdfPageRange: "",
  concurrency: 0,
  theme: "system",
  reduceMotion: false,
  locale: "zh-CN",
});

export function qualityFloorFor(format: string): number {
  switch (format) {
    case "jpeg":
      return settings.jpegQualityFloor;
    case "webp":
      return settings.webpQualityFloor;
    case "avif":
      return settings.avifQualityFloor;
    default:
      return 0;
  }
}

export function effectiveQualityFor(format: string, quality = settings.quality): number {
  const requested = clampQuality(quality);
  if (format === "png" || (settings.lossless && supportsLossless(format))) {
    return requested;
  }

  const floor = normalizeQualityFloor(qualityFloorFor(format), 0);
  return floor >= 30 ? Math.max(requested, floor) : requested;
}

export const queue = $state<QueueItem[]>([]);

export const comparisonPreview = $state<{
  open: boolean;
  loading: boolean;
  stale: boolean;
  itemPath: string | null;
  itemName: string;
  beforeUrl: string | null;
  afterUrl: string | null;
  reveal: number;
  result: ComparisonPreviewResult | null;
  error: string;
}>({
  open: false,
  loading: false,
  stale: false,
  itemPath: null,
  itemName: "",
  beforeUrl: null,
  afterUrl: null,
  reveal: 50,
  result: null,
  error: "",
});

let comparisonPreviewRequestId = 0;

/**
 * Settings that change the bytes of the converted output. When any of them
 * changes while the comparison preview is open, the displayed "after" image no
 * longer matches the current configuration and the preview is marked stale.
 * The previewed item's per-format override is part of the same signature.
 */
function comparisonPreviewSettingsSignature(): string {
  const item = comparisonPreview.itemPath
    ? queue.find((candidate) => candidate.path === comparisonPreview.itemPath)
    : null;
  if (!item) return "null";
  const format = itemTargetFormat(item);
  return conversionContentSignature(conversionRequestFor(item, format));
}

let comparisonPreviewSettingsBaseline: string | null = null;

// Components mutate `settings` directly (including `bind:value`), so a single
// effect tracking the output-affecting fields is the only reliable
// invalidation point. Marking stale never triggers I/O; the user refreshes
// through the existing guarded path.
$effect.root(() => {
  $effect(() => {
    if (!comparisonPreview.open) {
      comparisonPreviewSettingsBaseline = null;
      return;
    }
    const signature = comparisonPreviewSettingsSignature();
    if (comparisonPreviewSettingsBaseline === null) {
      comparisonPreviewSettingsBaseline = signature;
      return;
    }
    if (signature === comparisonPreviewSettingsBaseline) return;
    comparisonPreviewSettingsBaseline = signature;
    comparisonPreview.stale = true;
  });
});

interface UiState {
  converting: boolean;
  cancelRequested: boolean;
  dragActive: boolean;
  importing: boolean;
  importMode: ImportMode;
  importCancelRequested: boolean;
  importMessage: string;
  importErrors: UiImportError[];
}

export const ui = $state<UiState>({
  converting: false,
  cancelRequested: false,
  dragActive: false,
  importing: false,
  importMode: null,
  importCancelRequested: false,
  importMessage: "",
  importErrors: [],
});

let importMessageSource: LocalizedMessage | null = null;

export const engine = $state<{ text: string; ok: boolean }>({
  text: translate("state.engineInitializing"),
  ok: false,
});

localeStore.subscribe(() => {
  if (engine.ok) void checkEngine();
  if (importMessageSource) {
    ui.importMessage = formatLocalizedMessage(importMessageSource);
  }
  for (const error of ui.importErrors) {
    error.message = formatLocalizedMessage(error.localizedMessage);
  }
  for (const item of queue) {
    if (item.status === "running" && item.progressStage) {
      item.detail = translate(batchProgressStageKey(item.progressStage));
    } else if (item.localizedDetail) {
      item.detail = translate(item.localizedDetail.key, item.localizedDetail.params);
    } else if (item.detailError) {
      item.detail = formatCommandError(item.detailError);
    }
  }
});

export const appUpdate = $state<AppUpdateState>({
  checking: false,
  installing: false,
  available: false,
  checked: false,
  installed: false,
  version: null,
  currentVersion: null,
  date: null,
  body: null,
  message: "",
  error: "",
  downloadedBytes: 0,
  contentLength: null,
});

let appUpdateMessageSource: LocalizedMessage | null = null;
let appUpdateErrorSource: LocalizedMessage | null = null;

localeStore.subscribe(() => {
  if (appUpdateMessageSource) {
    appUpdate.message = formatLocalizedMessage(appUpdateMessageSource);
  }
  if (appUpdateErrorSource) {
    appUpdate.error = formatLocalizedMessage(appUpdateErrorSource);
  }
});

let pendingAppUpdate: Update | null = null;

export const updaterEnabled = import.meta.env.VITE_IMGCONVERT_DISABLE_UPDATER !== "1";

export const capabilities = $state<Capabilities>({
  readable: [...CORE_CAPABILITIES.readable],
  writable: [...CORE_CAPABILITIES.writable],
  lossless: [...CORE_CAPABILITIES.lossless],
  colorPipeline: { ...CORE_CAPABILITIES.colorPipeline },
  heic: CORE_CAPABILITIES.heic,
  codecProviders: [...CORE_CAPABILITIES.codecProviders],
});

// ---- 派生 ----
export function supportsLossless(format: string): boolean {
  return capabilities.lossless.includes(format.toLowerCase());
}

export function formatLabel(format: string): string {
  const formatInfo = FORMATS.find((f) => f.value === format);
  return formatInfo ? translate(formatInfo.labelKey) : format.toUpperCase();
}

export function writableFormats() {
  const writable = new Set(capabilities.writable);
  return FORMATS.filter((format) => writable.has(format.value));
}

export async function checkForAppUpdate(): Promise<void> {
  if (!isTauriRuntime()) {
    resetAppUpdateResult();
    appUpdate.checked = true;
    setAppUpdateMessage(translationMessage("update.webPreview"));
    return;
  }
  if (!updaterEnabled) {
    resetAppUpdateResult();
    appUpdate.checked = true;
    setAppUpdateMessage(translationMessage("update.storeBuild"));
    return;
  }

  appUpdate.checking = true;
  setAppUpdateError(null);
  setAppUpdateMessage(null);
  appUpdate.installed = false;
  try {
    if (pendingAppUpdate) {
      void pendingAppUpdate.close().catch(() => undefined);
    }
    pendingAppUpdate = await checkTauriUpdate({ timeout: 30_000 });
    appUpdate.checked = true;
    appUpdate.downloadedBytes = 0;
    appUpdate.contentLength = null;
    if (!pendingAppUpdate) {
      appUpdate.available = false;
      appUpdate.version = null;
      appUpdate.currentVersion = null;
      appUpdate.date = null;
      appUpdate.body = null;
      setAppUpdateMessage(translationMessage("update.latest"));
      return;
    }

    appUpdate.available = true;
    appUpdate.version = pendingAppUpdate.version;
    appUpdate.currentVersion = pendingAppUpdate.currentVersion;
    appUpdate.date = pendingAppUpdate.date ?? null;
    appUpdate.body = pendingAppUpdate.body ?? null;
    setAppUpdateMessage(
      translationMessage("update.newVersion", { version: pendingAppUpdate.version }),
    );
  } catch (error) {
    resetAppUpdateResult();
    appUpdate.checked = true;
    setAppUpdateError(updaterErrorMessage(error));
  } finally {
    appUpdate.checking = false;
  }
}

export async function installAppUpdate(): Promise<void> {
  if (!pendingAppUpdate || appUpdate.installing) return;

  appUpdate.installing = true;
  setAppUpdateError(null);
  setAppUpdateMessage(translationMessage("update.downloading"));
  appUpdate.downloadedBytes = 0;
  appUpdate.contentLength = null;

  try {
    await pendingAppUpdate.downloadAndInstall(handleUpdateDownloadEvent, { timeout: 120_000 });
    appUpdate.installed = true;
    appUpdate.available = false;
    setAppUpdateMessage(translationMessage("update.installed"));
    pendingAppUpdate = null;
    try {
      await relaunch();
    } catch (error) {
      setAppUpdateMessage(translationMessage("update.installedRelaunchFailed"));
      setAppUpdateError(translationMessage("update.relaunchFailed", { message: String(error) }));
    }
  } catch (error) {
    setAppUpdateError(updaterErrorMessage(error));
  } finally {
    appUpdate.installing = false;
  }
}

function handleUpdateDownloadEvent(event: DownloadEvent) {
  switch (event.event) {
    case "Started":
      appUpdate.contentLength = event.data.contentLength ?? null;
      appUpdate.downloadedBytes = 0;
      return;
    case "Progress":
      appUpdate.downloadedBytes += event.data.chunkLength;
      return;
    case "Finished":
      if (appUpdate.contentLength !== null) {
        appUpdate.downloadedBytes = appUpdate.contentLength;
      }
      setAppUpdateMessage(translationMessage("update.downloadComplete"));
      return;
  }
}

function resetAppUpdateResult() {
  pendingAppUpdate = null;
  appUpdate.available = false;
  appUpdate.installed = false;
  appUpdate.version = null;
  appUpdate.currentVersion = null;
  appUpdate.date = null;
  appUpdate.body = null;
  appUpdate.downloadedBytes = 0;
  appUpdate.contentLength = null;
  setAppUpdateMessage(null);
  setAppUpdateError(null);
}

function updaterErrorMessage(error: unknown): LocalizedMessage {
  const message = String(error);
  if (/not configured|No updater config|updater.*config/i.test(message)) {
    return translationMessage("update.notConfigured");
  }
  return translationMessage("update.checkFailed", { message });
}

function setAppUpdateMessage(message: LocalizedMessage | null): void {
  appUpdateMessageSource = message;
  appUpdate.message = message ? formatLocalizedMessage(message) : "";
}

function setAppUpdateError(message: LocalizedMessage | null): void {
  appUpdateErrorSource = message;
  appUpdate.error = message ? formatLocalizedMessage(message) : "";
}

export function readableExtensions(): string[] {
  const exts = capabilities.readable.flatMap((format) => FORMAT_EXTENSIONS[format] ?? []);
  return Array.from(new Set(exts));
}

export async function pickSystemPaths(options: PickPathOptions): Promise<string[]> {
  if (!isTauriRuntime()) return [];

  const access = await runtimeFileAccess();
  if (!access.useHostLinuxPicker) {
    return pickWithTauriDialog(options);
  }

  return invoke<string[]>("pick_paths", {
    options: {
      directory: options.directory ?? false,
      multiple: options.multiple ?? false,
      title: options.title ?? null,
      extensions: options.extensions ?? [],
      filterName: translate("state.image"),
      allFilesName: translate("state.allFiles"),
    },
  });
}

export function needsOutputDirectoryGrant(
  requiresOutputDirectory: boolean,
  requiresOutputDirectorySessionGrant: boolean,
  hasOutputDirectory: boolean,
  hasSessionGrant: boolean,
): boolean {
  return (
    requiresOutputDirectory &&
    (!hasOutputDirectory || (requiresOutputDirectorySessionGrant && !hasSessionGrant))
  );
}

export function hasTemporaryQueuedInput(
  items: readonly Pick<QueueItem, "temporary" | "status">[] = queue,
): boolean {
  // Completed clipboard imports no longer need a writable folder. Keep this
  // in lockstep with `prepareBatchJobs`, which also omits completed items.
  return items.some((item) => item.temporary === true && item.status !== "done");
}

export function needsOutputDirectoryForBatch(
  requiresOutputDirectory: boolean,
  requiresOutputDirectorySessionGrant: boolean,
  hasOutputDirectory: boolean,
  hasSessionGrant: boolean,
  hasTemporaryInput: boolean,
): boolean {
  return (
    needsOutputDirectoryGrant(
      requiresOutputDirectory,
      requiresOutputDirectorySessionGrant,
      hasOutputDirectory,
      hasSessionGrant,
    ) ||
    (hasTemporaryInput && !hasOutputDirectory)
  );
}

/**
 * Custom suffixes remain literal text, not file-name template syntax. The UI
 * normalizes only cross-platform-invalid characters; the Rust command repeats
 * the validation so direct IPC calls cannot bypass it.
 */
export function normalizeOutputSuffixInput(value: string): {
  value: string;
  adjusted: boolean;
} {
  const input = value.normalize("NFC");
  const trimmed = input.trim();
  const encoder = new TextEncoder();
  let normalized = "";
  let byteLength = 0;
  let adjusted = input !== value || trimmed !== input;

  for (const character of trimmed) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    const safeCharacter = /[\\/:*?"<>|]/.test(character) || isControl ? "_" : character;
    if (safeCharacter !== character) adjusted = true;
    const nextBytes = encoder.encode(safeCharacter).length;
    if (
      Array.from(normalized).length >= OUTPUT_SUFFIX_MAX_CHARS ||
      byteLength + nextBytes > OUTPUT_SUFFIX_MAX_BYTES
    ) {
      adjusted = true;
      break;
    }
    normalized += safeCharacter;
    byteLength += nextBytes;
  }

  return { value: normalized, adjusted };
}

export function normalizePersistedOutputSuffixSettings(
  persisted: Pick<Partial<Settings>, "outputSuffixEnabled"> | undefined,
  outputSuffixEnabled: unknown,
  outputSuffix: unknown,
): Pick<Settings, "outputSuffixEnabled" | "outputSuffix"> {
  const normalizedOutputSuffix =
    typeof outputSuffix === "string" ? normalizeOutputSuffixInput(outputSuffix).value : "";
  return {
    // Older persisted settings only have the template. Preserve that behavior
    // until the user actively enables the new suffix switch.
    outputSuffixEnabled:
      persisted && !Object.hasOwn(persisted, "outputSuffixEnabled")
        ? false
        : typeof outputSuffixEnabled === "boolean"
          ? outputSuffixEnabled
          : true,
    outputSuffix: normalizedOutputSuffix || DEFAULT_OUTPUT_SUFFIX,
  };
}

export function normalizePersistedConversionPolicySettings(
  persisted:
    | Pick<
        Partial<Settings>,
        "generationLossProtection" | "skipIfLarger" | "conversionPolicyVersion"
      >
    | undefined,
  generationLossProtection: unknown,
  skipIfLarger: unknown,
): Pick<Settings, "generationLossProtection" | "skipIfLarger" | "conversionPolicyVersion"> & {
  migrated: boolean;
} {
  const usesCurrentPolicy = persisted?.conversionPolicyVersion === CONVERSION_POLICY_VERSION;

  return {
    // Releases before this policy version enabled skip policies by default, so
    // a persisted `true` is not reliable evidence of an informed opt-in.
    // Migrate every legacy profile to the conversion-first default once.
    generationLossProtection:
      usesCurrentPolicy && typeof generationLossProtection === "boolean"
        ? generationLossProtection
        : false,
    skipIfLarger: usesCurrentPolicy && typeof skipIfLarger === "boolean" ? skipIfLarger : false,
    conversionPolicyVersion: CONVERSION_POLICY_VERSION,
    migrated: Boolean(persisted) && !usesCurrentPolicy,
  };
}

export function outputSuffixForRequest(enabled: boolean, suffix: string): string | null {
  return enabled ? suffix : null;
}

/**
 * Selects an output folder and records the current macOS process grant.
 *
 * The folder is kept as a convenience default for a later launch, but macOS
 * requires the user to select it again before that later process writes to it.
 */
export async function chooseOutputDirectory(): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const access = await runtimeFileAccess();
  const paths = await pickSystemPaths({
    directory: true,
    multiple: false,
    recursive: true,
    title: translate("settings.chooseOutputDir"),
    defaultPath: settings.outDir ?? undefined,
  });
  if (!paths[0]) return false;

  settings.outDir = paths[0];
  outputDirectoryGrant.sessionGranted = access.requiresOutputDirectorySessionGrant;
  await persistSettings();
  return true;
}

export async function clearOutputDirectory(): Promise<void> {
  settings.outDir = null;
  outputDirectoryGrant.sessionGranted = false;
  await persistSettings();
}

export async function getRuntimeFileAccess(): Promise<RuntimeFileAccess> {
  runtimeFileAccessPromise ??= invoke<RuntimeFileAccess>("file_access_runtime").catch((error) => {
    logCommandError("Failed to read runtime file access policy", error);
    return SAFE_FILE_ACCESS_FALLBACK;
  });
  return runtimeFileAccessPromise;
}

async function runtimeFileAccess(): Promise<RuntimeFileAccess> {
  return getRuntimeFileAccess();
}

async function pickWithTauriDialog(options: PickPathOptions): Promise<string[]> {
  const extensions = sanitizedDialogExtensions(options.extensions ?? []);
  const selected = await openDialog({
    directory: options.directory ?? false,
    multiple: options.multiple ?? false,
    title: options.title || undefined,
    defaultPath: options.defaultPath,
    recursive: options.recursive ?? false,
    filters:
      !options.directory && extensions.length
        ? [
            {
              name: translate("state.image"),
              extensions,
            },
          ]
        : undefined,
  });

  if (selected === null) return [];
  if (Array.isArray(selected)) {
    return selected.filter((path) => path.trim().length > 0);
  }
  return selected.trim() ? [selected] : [];
}

function sanitizedDialogExtensions(extensions: string[]): string[] {
  const sanitized = new Set<string>();
  for (const extension of extensions) {
    const normalized = extension.trim().replace(/^\.+/, "").toLowerCase();
    if (normalized && /^[a-z0-9]+$/.test(normalized)) {
      sanitized.add(normalized);
    }
  }
  return [...sanitized];
}

export function formatFromExt(ext: string): string | null {
  const normalized = ext.toLowerCase();
  for (const [format, exts] of Object.entries(FORMAT_EXTENSIONS)) {
    if (exts.includes(normalized)) return format;
  }
  return null;
}

export function itemTargetFormat(item: QueueItem): string {
  return item.targetFormat ?? settings.format;
}

export function itemProgress(item: QueueItem): number {
  if (item.status === "done") return 100;
  if (item.status === "skipped") return 100;
  if (item.status === "running") return item.progress ?? 55;
  if (item.status === "error") return 100;
  return item.progress ?? 0;
}

export function formatAccent(format: string | null): {
  text: string;
  border: string;
  background: string;
} {
  switch (format) {
    case "avif":
      return {
        text: "text-sky-700 dark:text-sky-300",
        border: "border-sky-500/35",
        background: "bg-sky-500/10",
      };
    case "webp":
      return {
        text: "text-emerald-700 dark:text-emerald-300",
        border: "border-emerald-500/35",
        background: "bg-emerald-500/10",
      };
    case "jpeg":
      return {
        text: "text-amber-700 dark:text-amber-300",
        border: "border-amber-500/35",
        background: "bg-amber-500/10",
      };
    case "png":
      return {
        text: "text-indigo-700 dark:text-indigo-300",
        border: "border-indigo-500/35",
        background: "bg-indigo-500/10",
      };
    case "heic":
      return {
        text: "text-fuchsia-700 dark:text-fuchsia-300",
        border: "border-fuchsia-500/35",
        background: "bg-fuchsia-500/10",
      };
    case "pdf":
      return {
        text: "text-rose-700 dark:text-rose-300",
        border: "border-rose-500/35",
        background: "bg-rose-500/10",
      };
    default:
      return {
        text: "text-primary",
        border: "border-primary/25",
        background: "bg-primary/10",
      };
  }
}

// ---- 工具 ----
export const extOf = (p: string) => p.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
export function fmtSize(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function formatImageMetadata(metadata: ImageMetadata | null): string {
  if (!metadata) return "";
  const parts = [`${metadata.width}×${metadata.height}`];
  if (metadata.pageCount) {
    parts.unshift(translate("state.pdfPageCount", { count: metadata.pageCount }));
  }
  const dpi = formatDpi(metadata);
  if (dpi) parts.push(dpi);
  return parts.join(" · ");
}

export function isPdfItem(item: Pick<QueueItem, "path" | "metadata">): boolean {
  return item.metadata?.format === "pdf" || extOf(item.path) === "pdf";
}

export function validatePdfPageRange(
  value: string,
  pageCount: number | null = null,
): string | null {
  const range = value.trim();
  if (!range) {
    return pageCount !== null && pageCount > MAX_PDF_PAGES_PER_JOB
      ? translate("workflow.pdfRangeRequired", { count: MAX_PDF_PAGES_PER_JOB })
      : null;
  }
  if (range.length > MAX_PDF_PAGE_RANGE_CHARS) return translate("workflow.pdfRangeTooLong");
  const seen = new Set<number>();
  for (const rawToken of range.split(",")) {
    const token = rawToken.trim();
    if (!token) return translate("workflow.pdfRangeInvalid");
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) return translate("workflow.pdfRangeInvalid");
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || start > end) {
      return translate("workflow.pdfRangeInvalid");
    }
    if (pageCount !== null && end > pageCount) {
      return translate("workflow.pdfRangeOutOfBounds", { count: pageCount });
    }
    // Avoid expanding an attacker-controlled gigantic range merely to validate it.
    if (end - start + 1 > MAX_PDF_PAGES_PER_JOB) {
      return translate("workflow.pdfTooManyPages", { count: MAX_PDF_PAGES_PER_JOB });
    }
    for (let page = start; page <= end; page += 1) {
      seen.add(page);
      if (seen.size > MAX_PDF_PAGES_PER_JOB) {
        return translate("workflow.pdfTooManyPages", { count: MAX_PDF_PAGES_PER_JOB });
      }
    }
  }
  return null;
}

function formatDpi(metadata: ImageMetadata): string {
  const x = metadata.dpiX;
  const y = metadata.dpiY;
  if (!x || !y) return "";
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  return roundedX === roundedY ? `${roundedX} DPI` : `${roundedX}×${roundedY} DPI`;
}

export interface AddPathsResult {
  added: number;
  duplicates: number;
  skipped: number;
}

type AddPathInput = string | ImportScanFile;
type ClipboardImageInput = {
  blob: Blob;
  mimeType: string;
  suggestedName: string | null;
};
const thumbnailQueue: QueueItem[] = [];
const thumbnailQueuedKeys = new Set<string>();
let thumbnailActive = 0;

// ---- 队列操作(就地变更,保持响应式)----
export function addPaths(paths: AddPathInput[]): AddPathsResult {
  const result: AddPathsResult = { added: 0, duplicates: 0, skipped: 0 };
  if (ui.converting) return result;

  const readable = readableExtensions();
  const existingKeys = new Set(queue.map((item) => item.key));
  const existingPaths = new Set(queue.map((item) => item.path));

  for (const input of paths) {
    const candidate = normalizeAddPathInput(input);
    if (!readable.includes(extOf(candidate.path))) {
      result.skipped += 1;
      continue;
    }
    if (existingKeys.has(candidate.key) || existingPaths.has(candidate.path)) {
      result.duplicates += 1;
      continue;
    }
    queue.push({
      path: candidate.path,
      key: candidate.key,
      name: baseName(candidate.path),
      relativeDir: candidate.relativeDir ?? null,
      temporary: candidate.temporary,
      status: "pending",
      detail: "",
      targetFormat: null,
      metadata: candidate.metadata ?? null,
      thumbnail: null,
      thumbnailStatus: "idle",
    });
    existingKeys.add(candidate.key);
    existingPaths.add(candidate.path);
    result.added += 1;
  }
  return result;
}

function normalizeAddPathInput(input: AddPathInput): ImportScanFile {
  if (typeof input === "string") {
    return { path: input, key: input, relativeDir: null, metadata: null };
  }
  return {
    path: input.path,
    key: input.key || input.path,
    relativeDir: input.relativeDir ?? null,
    metadata: input.metadata ?? null,
    temporary: input.temporary,
  };
}

export function setImportMessage(key: string, params?: Record<string, string | number>): void {
  setUiImportMessage(translationMessage(key, params));
}

export function setImportCommandError(error: unknown, wrapperKey?: string): void {
  setUiImportMessage(commandErrorMessage(error, wrapperKey));
}

function setUiImportMessage(message: LocalizedMessage | null): void {
  importMessageSource = message;
  ui.importMessage = message ? formatLocalizedMessage(message) : "";
}

function importError(path: string, localizedMessage: LocalizedMessage): UiImportError {
  return {
    path,
    localizedMessage,
    message: formatLocalizedMessage(localizedMessage),
  };
}

export async function importPaths(paths: string[]) {
  if (ui.converting || ui.importing || paths.length === 0) return;
  await importPathList(paths, "state.importScanning");
}

async function importPathList(paths: string[], messageKey: string) {
  ui.importing = true;
  ui.importMode = "scan";
  ui.importCancelRequested = false;
  setImportMessage(messageKey);
  ui.importErrors = [];
  try {
    if (!isTauriRuntime()) {
      const added = addPaths(paths);
      setUiImportMessage(importSummaryMessage(added, null));
      return;
    }

    const scan = await invoke<ImportScanResult>("scan_import_paths", {
      options: {
        paths,
        recursive: true,
      },
    });
    ui.importErrors = scan.errors.map((error) =>
      importError(error.path, commandErrorMessage(error.error)),
    );
    if (scan.cancelled) {
      setImportMessage("state.importCancelled");
      return;
    }

    const added = addPaths(scan.files);
    setUiImportMessage(importSummaryMessage(added, scan));
  } catch (e) {
    setImportCommandError(e, "state.importFailed");
    ui.importErrors = [];
  } finally {
    ui.importing = false;
    ui.importMode = null;
    ui.importCancelRequested = false;
  }
}

export async function importClipboard() {
  if (ui.converting || ui.importing) return;

  if (!isTauriRuntime()) {
    setImportMessage("state.clipboardWebUnavailable");
    return;
  }

  const clipboard = navigator.clipboard as
    | {
        read?: () => Promise<ClipboardItem[]>;
        readText?: () => Promise<string>;
      }
    | undefined;
  if (!clipboard) {
    setImportMessage("state.clipboardUnsupported");
    return;
  }

  let readError: unknown = null;
  try {
    const read = clipboard.read;
    const images =
      typeof read === "function" ? await readClipboardImages(read.bind(clipboard)) : [];
    if (images.length) {
      await importClipboardImages(images);
      return;
    }
  } catch (error) {
    readError = error;
  }

  try {
    const text = clipboard.readText ? await clipboard.readText() : "";
    const paths = parseClipboardPaths(text);
    if (paths.length) {
      await importPathList(paths, "state.clipboardScanning");
      return;
    }
  } catch (error) {
    readError ??= error;
  }

  setUiImportMessage(
    readError
      ? translationMessage("state.clipboardReadFailed", { error: String(readError) })
      : translationMessage("state.clipboardEmpty"),
  );
}

export async function importPastedClipboard(event: ClipboardEvent) {
  if (ui.converting || ui.importing) return;
  const data = event.clipboardData;
  if (!data) return;

  const images = imagesFromClipboardData(data);
  if (images.length) {
    event.preventDefault();
    await importClipboardImages(images);
    return;
  }

  if (isEditablePasteTarget(event.target)) {
    return;
  }

  const paths = parseClipboardPaths(textFromClipboardData(data));
  if (!paths.length) return;

  event.preventDefault();
  await importPathList(paths, "state.clipboardScanning");
}

async function readClipboardImages(
  read: () => Promise<ClipboardItem[]>,
): Promise<ClipboardImageInput[]> {
  const images: ClipboardImageInput[] = [];
  const items = await read();
  for (const item of items) {
    const mimeType = item.types.find(isSupportedClipboardImageMime);
    if (!mimeType) continue;
    const blob = await item.getType(mimeType);
    images.push({ blob, mimeType, suggestedName: null });
  }
  return images;
}

function imagesFromClipboardData(data: DataTransfer): ClipboardImageInput[] {
  const files = new Map<string, File>();
  for (const file of Array.from(data.files)) {
    if (isSupportedClipboardImageFile(file)) {
      files.set(clipboardFileKey(file), file);
    }
  }
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file || !isSupportedClipboardImageFile(file)) continue;
    files.set(clipboardFileKey(file), file);
  }

  return Array.from(files.values()).map((file) => ({
    blob: file,
    mimeType: normalizedMimeType(file.type),
    suggestedName: file.name || null,
  }));
}

async function importClipboardImages(images: ClipboardImageInput[]) {
  if (ui.converting || ui.importing || images.length === 0) return;

  ui.importing = true;
  ui.importMode = "clipboard";
  ui.importCancelRequested = false;
  setImportMessage("state.clipboardImporting");
  ui.importErrors = [];

  let skipped = 0;
  const files: ImportScanFile[] = [];
  try {
    for (const image of images) {
      if (ui.importCancelRequested) break;
      try {
        if (image.blob.size > CLIPBOARD_MAX_BYTES) {
          skipped += 1;
          ui.importErrors.push(
            importError(
              image.suggestedName ?? "clipboard",
              translationMessage("state.clipboardTooLarge", {
                size: fmtSize(CLIPBOARD_MAX_BYTES),
              }),
            ),
          );
          continue;
        }

        const bytes = new Uint8Array(await image.blob.arrayBuffer());
        if (ui.importCancelRequested) break;
        if (bytes.byteLength > CLIPBOARD_MAX_BYTES) {
          skipped += 1;
          ui.importErrors.push(
            importError(
              image.suggestedName ?? "clipboard",
              translationMessage("state.clipboardTooLarge", {
                size: fmtSize(CLIPBOARD_MAX_BYTES),
              }),
            ),
          );
          continue;
        }

        const file = await invoke<ImportScanFile>("import_clipboard_image", {
          options: {
            bytes,
            mimeType: image.mimeType || null,
            suggestedName: image.suggestedName,
          },
        });
        files.push({ ...file, temporary: true });
        if (ui.importCancelRequested) break;
      } catch (error) {
        skipped += 1;
        ui.importErrors.push(
          importError(image.suggestedName ?? "clipboard", commandErrorMessage(error)),
        );
      }
    }

    if (ui.importCancelRequested) {
      for (const file of files) {
        cleanupTemporaryPath(file.path);
      }
      setImportMessage("state.clipboardCancelled");
      return;
    }

    const beforeKeys = new Set(queue.map((item) => item.key));
    const added = addPaths(files);
    const afterKeys = new Set(queue.map((item) => item.key));
    for (const file of files) {
      if (beforeKeys.has(file.key) || !afterKeys.has(file.key)) {
        cleanupTemporaryPath(file.path);
      }
    }
    setUiImportMessage(importSummaryMessage({ ...added, skipped: added.skipped + skipped }, null));
  } catch (error) {
    setImportCommandError(error, "state.clipboardImportFailed");
  } finally {
    ui.importing = false;
    ui.importMode = null;
    ui.importCancelRequested = false;
  }
}

function isSupportedClipboardImageFile(file: File): boolean {
  if (isSupportedClipboardImageMime(file.type)) return true;
  const format = formatFromExt(extOf(file.name));
  return !!format && capabilities.readable.includes(format) && format !== "heic";
}

function clipboardFileKey(file: File): string {
  return `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
}

function isSupportedClipboardImageMime(mimeType: string): boolean {
  const normalized = normalizedMimeType(mimeType);
  return CLIPBOARD_IMAGE_MIME_TYPES.has(normalized);
}

function normalizedMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function textFromClipboardData(data: DataTransfer): string {
  return [
    readClipboardData(data, "x-special/gnome-copied-files"),
    readClipboardData(data, "text/uri-list"),
    readClipboardData(data, "text/plain"),
  ]
    .filter(Boolean)
    .join("\n");
}

function readClipboardData(data: DataTransfer, type: string): string {
  try {
    return data.getData(type);
  } catch {
    return "";
  }
}

function parseClipboardPaths(text: string): string[] {
  const paths = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;

    const fileUrlPath = fileUrlToPath(line);
    if (fileUrlPath) {
      paths.add(fileUrlPath);
      continue;
    }
    if (looksLikeAbsolutePath(line)) {
      paths.add(line);
    }
  }
  return [...paths];
}

function fileUrlToPath(value: string): string | null {
  if (!value.toLowerCase().startsWith("file:")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    let path = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:\//.test(path)) {
      path = path.slice(1);
    }
    return path || null;
  } catch {
    return null;
  }
}

function looksLikeAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export async function cancelImportScan() {
  if (!ui.importing || ui.importCancelRequested) return;
  ui.importCancelRequested = true;

  if (ui.importMode === "clipboard") {
    setImportMessage("state.clipboardCancelling");
    return;
  }

  if (!isTauriRuntime()) {
    ui.importing = false;
    ui.importMode = null;
    setImportMessage("state.importCancelled");
    return;
  }

  try {
    await invoke<boolean>("cancel_import_scan");
  } catch (e) {
    setImportCommandError(e, "state.cancelImportScanFailed");
  }
}

export function formatImportSummary(added: AddPathsResult, scan: ImportScanResult | null): string {
  return formatLocalizedMessage(importSummaryMessage(added, scan));
}

function importSummaryMessage(
  added: AddPathsResult,
  scan: ImportScanResult | null,
): LocalizedMessage {
  const skipped = (scan?.skipped ?? 0) + added.skipped;
  const scanErrors = scan?.errors.length ?? 0;
  const parts: LocalizedMessage[] = [];
  if (added.added > 0) {
    parts.push(translationMessage("state.addedFiles", { count: added.added }));
  }
  if (added.duplicates > 0) {
    parts.push(translationMessage("state.duplicates", { count: added.duplicates }));
  }
  if (skipped > 0) {
    parts.push(translationMessage("state.skippedFiles", { count: skipped }));
  }
  if (scanErrors > 0) {
    parts.push(translationMessage("state.errorsCount", { count: scanErrors }));
  }
  if (scan?.truncated) {
    parts.push(
      scan.limitReason
        ? translationMessage(importScanLimitReasonKey(scan.limitReason))
        : translationMessage("state.scanTruncated"),
    );
  }
  return parts.length ? messageList(parts) : translationMessage("state.noSupportedImages");
}

function importScanLimitReasonKey(reason: ImportScanLimitReason): string {
  switch (reason) {
    case "directoryDepth":
      return "state.scanDirectoryDepthLimit";
    case "entryCount":
      return "state.scanEntryCountLimit";
    case "fileCount":
      return "state.scanFileCountLimit";
  }
}

export function addDemoItems() {
  if (queue.length > 0) return;
  const demo = [
    "/preview/landing-hero.png",
    "/preview/product-photo.jpg",
    "/preview/icon-set.webp",
    "/preview/archive-sample.avif",
  ];
  for (const path of demo) {
    const item: QueueItem = {
      path,
      key: path,
      name: baseName(path),
      relativeDir: null,
      status: "pending",
      detail: "",
      targetFormat: null,
      metadata: null,
      thumbnail: null,
      thumbnailStatus: "idle",
      preview: true,
    };
    setLocalizedItemDetail(item, "state.webPreviewDemo");
    queue.push(item);
  }
}

export function setItemTargetFormat(path: string, format: string | null) {
  if (ui.converting || ui.importing) return;

  const item = queue.find((it) => it.path === path);
  if (!item) return;
  const normalized = format?.toLowerCase() ?? null;
  if (normalized && !capabilities.writable.includes(normalized)) return;
  item.targetFormat = normalized;
  if (item.status !== "running") {
    item.status = "pending";
    if (item.preview) {
      setLocalizedItemDetail(item, "state.webPreviewDemo");
    } else {
      clearItemDetail(item);
    }
    item.progress = 0;
    item.progressStage = null;
  }
}

export function resetItemFormats() {
  if (ui.converting || ui.importing) return;

  for (const item of queue) {
    item.targetFormat = null;
    if (item.status !== "running") {
      item.status = "pending";
      if (item.preview) {
        setLocalizedItemDetail(item, "state.webPreviewDemo");
      } else {
        clearItemDetail(item);
      }
      item.progress = 0;
      item.progressStage = null;
    }
  }
}
export function removeItem(path: string) {
  if (ui.converting || ui.importing) return;
  const i = queue.findIndex((it) => it.path === path);
  if (i >= 0) {
    if (comparisonPreview.itemPath === queue[i].path) closeComparisonPreview();
    disposeThumbnail(queue[i]);
    removeQueuedThumbnail(queue[i]);
    cleanupTemporaryImport(queue[i]);
    queue.splice(i, 1);
  }
}
export function clearQueue() {
  if (ui.converting || ui.importing) return;
  for (const item of queue) {
    disposeThumbnail(item);
    cleanupTemporaryImport(item);
  }
  resetThumbnailQueue();
  closeComparisonPreview();
  queue.splice(0, queue.length);
}

function cleanupTemporaryImport(item: QueueItem) {
  if (!item.temporary || !isTauriRuntime()) return;
  cleanupTemporaryPath(item.path);
}

function cleanupTemporaryPath(path: string) {
  if (!isTauriRuntime()) return;
  void invoke<boolean>("cleanup_imported_temp_file", { path }).catch((error) => {
    logCommandError("Failed to clean clipboard temp files", error);
  });
}

// ---- 缩略图 ----
export function ensureThumbnail(item: QueueItem) {
  if (!isTauriRuntime() || item.preview) return;
  if (item.thumbnailStatus !== "idle" && item.thumbnailStatus !== "error") return;
  if (thumbnailQueuedKeys.has(item.key)) return;

  item.thumbnailStatus = "loading";
  thumbnailQueuedKeys.add(item.key);
  thumbnailQueue.push(item);
  void drainThumbnailQueue();
}

async function drainThumbnailQueue() {
  while (thumbnailActive < THUMBNAIL_CONCURRENCY && thumbnailQueue.length > 0) {
    const item = thumbnailQueue.shift();
    if (!item) continue;
    thumbnailQueuedKeys.delete(item.key);
    if (!queue.includes(item)) continue;

    thumbnailActive += 1;
    void loadThumbnail(item).finally(() => {
      thumbnailActive -= 1;
      void drainThumbnailQueue();
    });
  }
}

async function loadThumbnail(item: QueueItem) {
  try {
    const result = await invoke<ThumbnailResult | null>("generate_thumbnail", {
      options: {
        input: item.path,
        maxEdge: THUMBNAIL_MAX_EDGE,
      },
    });
    if (!queue.includes(item)) return;
    if (!result) {
      item.thumbnailStatus = "skipped";
      return;
    }

    const bytes = new Uint8Array(result.bytes);
    const url = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
    if (!queue.includes(item)) {
      URL.revokeObjectURL(url);
      return;
    }
    disposeThumbnail(item);
    item.thumbnail = {
      url,
      width: result.width,
      height: result.height,
      mime: result.mime,
      warningCount: result.warningCount,
    };
    item.thumbnailStatus = "ready";
  } catch (e) {
    if (!queue.includes(item)) return;
    logCommandError("Thumbnail generation failed", e);
    item.thumbnailStatus = "error";
  }
}

function disposeThumbnail(item: QueueItem) {
  if (item.thumbnail?.url) {
    URL.revokeObjectURL(item.thumbnail.url);
  }
  item.thumbnail = null;
  if (item.thumbnailStatus === "ready") {
    item.thumbnailStatus = "idle";
  }
}

function removeQueuedThumbnail(item: QueueItem) {
  thumbnailQueuedKeys.delete(item.key);
  const index = thumbnailQueue.findIndex((queuedItem) => queuedItem === item);
  if (index >= 0) {
    thumbnailQueue.splice(index, 1);
  }
}

function resetThumbnailQueue() {
  thumbnailQueue.splice(0, thumbnailQueue.length);
  thumbnailQueuedKeys.clear();
}

// ---- 前后对比预览 ----
export function openComparisonPreview(item: QueueItem) {
  if (ui.converting || ui.importing) return;
  // Opening is a new item-level preview session. Never leave another file's
  // image or statistics visible while the replacement request is in flight.
  disposeComparisonPreviewUrls();
  comparisonPreview.result = null;
  comparisonPreview.loading = false;
  comparisonPreview.open = true;
  comparisonPreview.itemPath = item.path;
  comparisonPreview.itemName = item.name;
  comparisonPreview.reveal = 50;
  comparisonPreview.stale = false;
  comparisonPreviewSettingsBaseline = comparisonPreviewSettingsSignature();
  comparisonPreview.error = "";

  if (!isTauriRuntime()) {
    comparisonPreview.loading = false;
    comparisonPreview.error = translate("state.webPreviewNoLocalConvert");
    return;
  }
  void refreshComparisonPreview();
}

export async function refreshComparisonPreview() {
  const path = comparisonPreview.itemPath;
  if (!path || !comparisonPreview.open || !isTauriRuntime() || ui.converting) return;
  const item = queue.find((candidate) => candidate.path === path);
  if (!item) {
    closeComparisonPreview();
    return;
  }

  const requestId = ++comparisonPreviewRequestId;
  comparisonPreview.loading = true;
  // A refresh starts from the current settings; re-sync the invalidation
  // baseline so the signature effect does not flag this in-flight, explicitly
  // requested refresh as stale.
  comparisonPreview.stale = false;
  comparisonPreviewSettingsBaseline = comparisonPreviewSettingsSignature();
  comparisonPreview.error = "";
  try {
    const format = itemTargetFormat(item);
    const payload = await invoke<ArrayBuffer>("generate_comparison_preview", {
      options: {
        conversion: conversionRequestFor(item, format),
        maxEdge: 1200,
      },
    });
    if (requestId !== comparisonPreviewRequestId || !comparisonPreview.open) return;

    const {
      summary: result,
      beforeBytes,
      afterBytes,
    } = decodePreviewPayload<ComparisonPreviewResult>(payload);

    const beforeUrl = URL.createObjectURL(new Blob([beforeBytes], { type: result.mime }));
    const afterUrl = URL.createObjectURL(new Blob([afterBytes], { type: result.mime }));
    if (requestId !== comparisonPreviewRequestId || !comparisonPreview.open) {
      URL.revokeObjectURL(beforeUrl);
      URL.revokeObjectURL(afterUrl);
      return;
    }
    disposeComparisonPreviewUrls();
    comparisonPreview.beforeUrl = beforeUrl;
    comparisonPreview.afterUrl = afterUrl;
    comparisonPreview.result = result;
  } catch (error) {
    if (requestId !== comparisonPreviewRequestId || !comparisonPreview.open) return;
    comparisonPreview.error = formatCommandError(error);
  } finally {
    if (requestId === comparisonPreviewRequestId) comparisonPreview.loading = false;
  }
}

export function closeComparisonPreview() {
  comparisonPreviewRequestId += 1;
  if (isTauriRuntime() && comparisonPreview.open) {
    void invoke<boolean>("cancel_comparison_preview").catch((error) => {
      logCommandError("Failed to cancel comparison preview", error);
    });
  }
  disposeComparisonPreviewUrls();
  comparisonPreview.open = false;
  comparisonPreview.loading = false;
  comparisonPreview.stale = false;
  comparisonPreview.itemPath = null;
  comparisonPreview.itemName = "";
  comparisonPreview.result = null;
  comparisonPreview.error = "";
}

export function setComparisonReveal(value: number) {
  comparisonPreview.reveal = Math.min(100, Math.max(0, Math.round(value)));
}

function disposeComparisonPreviewUrls() {
  for (const url of [comparisonPreview.beforeUrl, comparisonPreview.afterUrl]) {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  }
  comparisonPreview.beforeUrl = null;
  comparisonPreview.afterUrl = null;
}

// ---- 转换 ----
export async function convertAll() {
  if (ui.converting || ui.importing || queue.length === 0) {
    return;
  }

  if (comparisonPreview.open) closeComparisonPreview();

  if (!isTauriRuntime()) {
    for (const item of queue) {
      if (item.status !== "done") {
        item.status = "error";
        setLocalizedItemDetail(item, "state.webPreviewNoLocalConvert");
        item.progress = 100;
        item.progressStage = null;
      }
    }
    return;
  }

  ui.converting = true;
  ui.cancelRequested = false;
  ui.dragActive = false;
  try {
    if (!(await ensureOutputDirectoryAccess())) return;
    await convertAllWithBatch();
  } catch (error) {
    for (const item of queue) {
      if (item.status === "pending" || item.status === "running") {
        item.status = "error";
        setItemCommandError(item, error);
        item.progress = 100;
        item.progressStage = null;
      }
    }
  } finally {
    ui.converting = false;
    ui.cancelRequested = false;
  }
}

async function ensureOutputDirectoryAccess(): Promise<boolean> {
  const access = await runtimeFileAccess();
  const hasOutputDirectory = !!settings.outDir?.trim();
  if (
    !needsOutputDirectoryForBatch(
      access.requiresOutputDirectory,
      access.requiresOutputDirectorySessionGrant,
      hasOutputDirectory,
      outputDirectoryGrant.sessionGranted,
      hasTemporaryQueuedInput(),
    )
  ) {
    return true;
  }

  return chooseOutputDirectory();
}

export async function cancelConversion() {
  if (!ui.converting || ui.cancelRequested) return;
  ui.cancelRequested = true;
  if (isTauriRuntime()) {
    try {
      await invoke<boolean>("cancel_batch");
    } catch (e) {
      logCommandError("Failed to cancel batch task", e);
    }
  }
}

async function convertAllWithBatch() {
  const jobs = prepareBatchJobs();
  if (jobs.length === 0) return;

  for (const job of jobs) {
    job.item.status = "pending";
    setLocalizedItemDetail(job.item, "state.queued");
    job.item.progress = 0;
    job.item.progressStage = null;
  }

  try {
    if (!(await applyOutputSafetyDecisions(jobs))) {
      if (ui.cancelRequested) finalizeCancelledJobs(jobs);
      return;
    }
    // Cancellation may have occurred while `plan_conversions` or a user-facing
    // overwrite confirmation was pending. At that point no backend batch exists
    // yet, so `cancel_batch` cannot cancel it; honour the local signal before
    // creating one.
    if (ui.cancelRequested) {
      finalizeCancelledJobs(jobs);
      return;
    }

    const progress = new Channel<BatchProgressEvent>((event) => {
      handleBatchProgress(event, jobs);
    });

    const request: BatchConvertRequest = {
      options: jobs.map((job) => job.options),
      concurrency: batchConcurrency(),
    };
    const summary = await invoke<BatchSummary>("convert_batch", {
      ...request,
      progress,
    });
    if (summary.cancelled) {
      finalizeCancelledJobs(jobs);
    }
  } catch (e) {
    for (const job of jobs) {
      if (job.item.status === "pending" || job.item.status === "running") {
        job.item.status = "error";
        setItemCommandError(job.item, e);
        job.item.progress = 100;
        job.item.progressStage = null;
      }
    }
  }
}

function batchConcurrency(): number | null {
  const concurrency = Math.round(settings.concurrency);
  return concurrency > 0 ? Math.min(8, concurrency) : null;
}

async function applyOutputSafetyDecisions(jobs: BatchJob[]): Promise<boolean> {
  const plan = await invoke<ConversionPlanEntry[]>("plan_conversions", {
    options: jobs.map((job) => job.options),
  });

  const queuedInputConflicts = plan.filter(
    (entry) => !entry.error && entry.conflictsWithQueuedInput,
  );
  if (queuedInputConflicts.length) {
    const acknowledged = await confirmDialog(
      translate("state.queuedInputConflictMessage", { count: queuedInputConflicts.length }),
      {
        title: translate("state.queuedInputConflictTitle"),
        kind: "warning",
        okLabel: translate("state.continueRemaining"),
        cancelLabel: translate("state.cancel"),
      },
    );
    if (!acknowledged) return false;
  }

  if (settings.overwrite === "ask") {
    await applyAskOverwriteDecisions(jobs, plan);
    return !ui.cancelRequested;
  }

  return applySourceOverwriteDecisions(jobs, plan);
}

async function applySourceOverwriteDecisions(
  jobs: BatchJob[],
  plan: ConversionPlanEntry[],
): Promise<boolean> {
  const sourceCollisions = plan.filter(
    (entry) => !entry.error && entry.sameAsSource && !entry.conflictsWithQueuedInput,
  );
  if (!sourceCollisions.length) return true;

  if (settings.overwrite === "skip") {
    return confirmDialog(
      translate("state.sourceOverwriteWillSkipMessage", { count: sourceCollisions.length }),
      {
        title: translate("state.sourceOverwriteTitle"),
        kind: "warning",
        okLabel: translate("state.continueConversion"),
        cancelLabel: translate("state.cancel"),
      },
    );
  }

  const confirmed = await confirmDialog(
    translate("state.sourceOverwriteMessage", { count: sourceCollisions.length }),
    {
      title: translate("state.sourceOverwriteTitle"),
      kind: "warning",
      okLabel: translate("state.sourceOverwrite"),
      cancelLabel: translate("state.cancel"),
    },
  );
  if (!confirmed) return false;

  for (const entry of sourceCollisions) {
    const job = jobs[entry.index];
    if (!job) continue;
    job.options.overwrite = true;
    job.options.overwriteMode = "overwrite";
    // This value exists only in the in-memory request for this batch. The
    // Rust command independently rejects source replacement without it.
    job.options.allowSourceOverwrite = true;
  }
  return true;
}

async function applyAskOverwriteDecisions(jobs: BatchJob[], plan: ConversionPlanEntry[]) {
  for (const entry of plan) {
    if (ui.cancelRequested) break;
    const job = jobs[entry.index];
    if (!job) continue;

    if (entry.error || entry.conflictsWithQueuedInput) {
      continue;
    }
    if (!entry.exists) {
      job.options.overwrite = false;
      job.options.overwriteMode = "skip";
      continue;
    }

    const sourceCollision = entry.sameAsSource;
    const confirmed = await confirmDialog(formatAskOverwriteMessage(entry), {
      title: translate(
        sourceCollision ? "state.sourceOverwriteTitle" : "state.confirmOverwriteTitle",
      ),
      kind: "warning",
      okLabel: translate(sourceCollision ? "state.sourceOverwrite" : "state.overwrite"),
      cancelLabel: translate("state.skip"),
    });
    if (confirmed) {
      job.options.overwrite = true;
      job.options.overwriteMode = "overwrite";
      job.options.allowSourceOverwrite = sourceCollision;
    } else {
      job.options.overwrite = false;
      job.options.overwriteMode = "skip";
    }
  }
}

function prepareBatchJobs(): BatchJob[] {
  const jobs: BatchJob[] = [];
  for (const item of queue) {
    if (!isPendingConversionItem(item)) continue;
    const options = prepareSingleJob(item);
    if (options) jobs.push({ item, options });
  }
  return jobs;
}

export function isPendingConversionItem(item: Pick<QueueItem, "status">): boolean {
  return item.status !== "done";
}

function prepareSingleJob(item: QueueItem): ConvertRequest | null {
  const format = itemTargetFormat(item);
  if (!capabilities.writable.includes(format)) {
    item.status = "error";
    setLocalizedItemDetail(item, "state.unsupportedTarget", { format: formatLabel(format) });
    item.progress = 100;
    item.progressStage = null;
    return null;
  }
  if (settings.targetSizeEnabled && !targetSizeSupported(format)) {
    item.status = "error";
    setLocalizedItemDetail(item, "state.targetSizeUnsupported");
    item.progress = 100;
    item.progressStage = null;
    return null;
  }
  if (isPdfItem(item)) {
    const pageRangeError = validatePdfPageRange(
      settings.pdfPageRange,
      item.metadata?.pageCount ?? null,
    );
    if (pageRangeError) {
      item.status = "error";
      setLocalizedItemDetail(item, "state.pdfSettingsInvalid");
      item.progress = 100;
      item.progressStage = null;
      return null;
    }
  }
  return conversionRequestFor(item, format);
}

export function targetSizeSupported(format: string): boolean {
  return ["jpeg", "webp"].includes(format) && !settings.lossless;
}

export function hasInvalidWorkflowConfiguration(): boolean {
  if (hasInvalidPdfConfiguration()) return true;
  return hasInvalidTargetSizeConfiguration();
}

export function hasInvalidPdfConfiguration(): boolean {
  return queue.some(
    (item) =>
      isPendingConversionItem(item) &&
      isPdfItem(item) &&
      validatePdfPageRange(settings.pdfPageRange, item.metadata?.pageCount ?? null) !== null,
  );
}

export function hasInvalidTargetSizeConfiguration(): boolean {
  if (!settings.targetSizeEnabled) return false;
  if (settings.autoQuality || settings.lossless) return true;
  return queue.some(
    (item) => isPendingConversionItem(item) && !targetSizeSupported(itemTargetFormat(item)),
  );
}

function conversionRequestFor(item: QueueItem, format: string): ConvertRequest {
  return buildConvertRequest({
    settings,
    item,
    format,
    qualityFloor: qualityFloorFor(format),
    losslessSupported: supportsLossless(format),
    outputSuffix: outputSuffixForRequest(settings.outputSuffixEnabled, settings.outputSuffix),
  });
}

function handleBatchProgress(event: BatchProgressEvent, jobs: BatchJob[]) {
  switch (event.event) {
    case "started":
      return;
    case "fileStarted": {
      const job = jobs[event.data.index];
      if (!job) return;
      job.item.status = "running";
      setBatchProgressStage(job.item, "readingAndConverting");
      job.item.progress = 5;
      return;
    }
    case "fileProgress": {
      const job = jobs[event.data.index];
      if (!job) return;
      job.item.status = "running";
      setBatchProgressStage(job.item, event.data.stage);
      job.item.progress = Math.min(100, Math.max(0, Math.round(event.data.percent)));
      return;
    }
    case "fileFinished": {
      const job = jobs[event.data.index];
      if (!job) return;
      job.item.status = "done";
      setNeutralItemDetail(job.item, formatResultDetail(event.data.result));
      job.item.progress = 100;
      job.item.progressStage = null;
      return;
    }
    case "fileSkipped": {
      const job = jobs[event.data.index];
      if (!job) return;
      job.item.status = "skipped";
      setItemCommandError(job.item, event.data.error);
      job.item.progress = 100;
      job.item.progressStage = null;
      return;
    }
    case "fileError": {
      const job = jobs[event.data.index];
      if (!job) return;
      job.item.status = "error";
      setItemCommandError(job.item, event.data.error);
      job.item.progress = 100;
      job.item.progressStage = null;
      return;
    }
    case "cancelled":
      ui.cancelRequested = true;
      finalizeCancelledJobs(jobs);
      return;
    case "finished":
      if (event.data.summary.cancelled) {
        finalizeCancelledJobs(jobs);
      }
      return;
  }
}

function setBatchProgressStage(item: QueueItem, stage: BatchProgressStage): void {
  item.progressStage = stage;
  setLocalizedItemDetail(item, batchProgressStageKey(stage));
}

function setLocalizedItemDetail(
  item: QueueItem,
  key: string,
  params?: Record<string, string | number>,
): void {
  item.localizedDetail = { key, params };
  item.detailError = null;
  item.detail = translate(key, params);
}

function setItemCommandError(item: QueueItem, error: unknown): void {
  const commandError = parseCommandError(error);
  item.localizedDetail = commandError ? null : { key: "errors.taskFailed" };
  item.detailError = commandError;
  item.detail = formatCommandError(error);
}

function setNeutralItemDetail(item: QueueItem, detail: string): void {
  item.localizedDetail = null;
  item.detailError = null;
  item.detail = detail;
}

function clearItemDetail(item: QueueItem): void {
  setNeutralItemDetail(item, "");
}

function batchProgressStageKey(stage: BatchProgressStage): string {
  switch (stage) {
    case "readingAndConverting":
      return "state.readingAndConverting";
    case "done":
      return "queueItem.done";
  }
}

function finalizeCancelledJobs(jobs: BatchJob[]) {
  for (const job of jobs) {
    if (job.item.status === "pending" || job.item.status === "running") {
      job.item.status = "pending";
      setLocalizedItemDetail(job.item, "state.cancelled");
      job.item.progress = 0;
      job.item.progressStage = null;
    }
  }
}

function formatResultDetail(res: ConvertResult): string {
  const ratio = res.inSize > 0 ? Math.round((1 - res.outSize / res.inSize) * 100) : 0;
  const pdfOutput = extOf(res.input) === "pdf";
  const pageDetail =
    pdfOutput || (res.outputCount ?? 1) > 1 || (res.skippedOutputCount ?? 0) > 0
      ? `${translate("state.pdfOutputsCreated", { count: res.outputCount ?? 0 })} · `
      : "";
  const sizeDetail = pdfOutput
    ? `${fmtSize(res.inSize)} → ${fmtSize(res.outSize)}`
    : `${fmtSize(res.inSize)} → ${fmtSize(res.outSize)} (${ratio >= 0 ? "-" : "+"}${Math.abs(ratio)}%)`;
  const detail = `${pageDetail}${sizeDetail}`;
  const warningMessages = conversionWarnings(res).flatMap(formatConvertWarning);
  return warningMessages.length ? `${detail} · ${warningMessages.join(" · ")}` : detail;
}

export function conversionWarnings(
  res: Pick<ConvertResult, "warning" | "warnings">,
): ConvertWarning[] {
  const warnings = [...(res.warnings ?? []), ...(res.warning ? [res.warning] : [])];
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = JSON.stringify(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatConvertWarning(warning: ConvertWarning): string[] {
  switch (warning.code) {
    case "previousOutputBackupRetained":
      return [translate("state.outputBackupRetained", { path: warning.path })];
    case "modifiedTimeNotPreserved":
      return [translate("state.modifiedTimeNotPreserved", { path: warning.path })];
    case "outputBackupRetainedAndModifiedTimeNotPreserved":
      return [
        translate("state.outputBackupRetained", { path: warning.backupPath }),
        translate("state.modifiedTimeNotPreserved", { path: warning.outputPath }),
      ];
    case "colorProfileConvertedForResize":
      return [translate("state.colorProfileConvertedForResize")];
    case "invalidColorProfileDiscarded":
      return [translate("state.invalidColorProfileDiscarded")];
    case "invalidColorProfileIgnoredForPreview":
      return [translate("state.invalidColorProfileIgnoredForPreview")];
    case "targetSizeNotMet":
      return [
        translate("state.targetSizeNotMet", {
          target: fmtSize(warning.targetBytes),
          actual: fmtSize(warning.actualBytes),
        }),
      ];
    case "pdfPagesSkippedExisting":
      return [translate("state.pdfPagesSkippedExisting", { count: warning.count })];
    case "pdfRenderWarnings":
      return [
        translate("state.pdfRenderWarnings", {
          page: warning.page,
          count: warning.count,
        }),
      ];
  }
}

function formatAskOverwriteMessage(entry: ConversionPlanEntry): string {
  if (entry.sameAsSource) {
    return translate("state.sourceOverwriteSingleMessage", { path: entry.output ?? entry.input });
  }
  if (entry.existingOutputCount > 1) {
    return translate("state.pdfOutputsExist", { count: entry.existingOutputCount });
  }
  return translate("state.outputExists", { path: entry.output ?? entry.input });
}

// ---- 引擎检测 ----
export async function checkEngine() {
  if (!isTauriRuntime()) {
    capabilities.readable = [...CORE_CAPABILITIES.readable];
    capabilities.writable = [...CORE_CAPABILITIES.writable];
    capabilities.lossless = [...CORE_CAPABILITIES.lossless];
    capabilities.heic = CORE_CAPABILITIES.heic;
    capabilities.codecProviders = [...CORE_CAPABILITIES.codecProviders];
    engine.text = translate("state.webPreviewEngine");
    engine.ok = true;
    return;
  }

  try {
    await syncSelectedHeicHelper();
    const info = await invoke<Capabilities>("capabilities");
    capabilities.readable = [...info.readable];
    capabilities.writable = [...info.writable];
    capabilities.lossless = [...info.lossless];
    capabilities.heic = info.heic;
    capabilities.codecProviders = [...(info.codecProviders ?? [])];

    if (!capabilities.writable.includes(settings.format)) {
      settings.format = capabilities.writable[0] ?? CORE_CAPABILITIES.writable[0];
      await persistSettings();
    }

    engine.text = translate("state.coreReady");
    engine.ok = capabilities.writable.length > 0;
  } catch (e) {
    engine.text = translate("state.coreFailed", { error: formatCommandError(e) });
    engine.ok = false;
  }
}

export async function loadCodecDiagnostics(): Promise<CodecDiagnostics> {
  if (!isTauriRuntime()) {
    return {
      heic: {
        enabled: false,
        externalCodecsEnabled: false,
        disabledReason: { code: "desktopRuntimeRequired", detail: null },
        extensions: ["heic", "heif", "hif"],
        activeProvider: null,
        systemCodecs: [],
        selectedHelper: {
          configured: false,
          available: false,
          path: null,
          message: null,
          provider: null,
        },
        manifestDirs: [],
        systemHelpers: [],
      },
    };
  }

  return invoke<CodecDiagnostics>("codec_diagnostics");
}

export async function setSelectedHeicHelperPath(
  path: string | null,
): Promise<SelectedHelperDiagnostic> {
  if (!isTauriRuntime()) {
    return {
      configured: false,
      available: false,
      path: null,
      message: { code: "desktopRuntimeRequired", detail: null },
      provider: null,
    };
  }

  const diagnostic = await invoke<SelectedHelperDiagnostic>("set_selected_heic_helper", {
    path,
  });
  settings.heicHelperPath = diagnostic.provider?.path ?? diagnostic.path ?? null;
  await persistSettings();
  await checkEngine();
  return diagnostic;
}

async function syncSelectedHeicHelper() {
  if (!isTauriRuntime()) return;
  try {
    await invoke<SelectedHelperDiagnostic>("set_selected_heic_helper", {
      path: settings.heicHelperPath,
    });
  } catch (error) {
    logCommandError("Failed to sync HEIC helper allowlist", error);
  }
}

// ---- 主题 ----
export function applyTheme() {
  const dark =
    settings.theme === "dark" ||
    (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("reduce-motion", settings.reduceMotion);
}

// ---- 持久化(Tauri Store)----
export const persistenceReady = $state({ ready: false });
export const persistenceStatus = $state({ error: null as string | null });
let store: Store | null = null;
let settingsWriter: CoalescingWriter<Settings> | null = null;
export async function initPersistence() {
  let detectedLocale = navigatorLocale();
  persistenceStatus.error = null;
  try {
    detectedLocale = await systemLocale();
    if (!isTauriRuntime()) {
      settings.locale = detectedLocale;
      await setAppLocale(detectedLocale);
      applyTheme();
      return;
    }

    store = await load("settings.json", { defaults: {}, autoSave: 300 });
    settingsWriter = new CoalescingWriter(async (snapshot) => {
      if (!store) throw new Error("settings store is unavailable");
      await store.set("settings", snapshot);
    });
    const saved = await store.get<Partial<Settings>>("settings");
    if (saved) {
      Object.assign(settings, saved);
      const normalized = normalizeSettings(detectedLocale, saved);
      if (normalized) {
        await persistSettings();
      }
    } else {
      settings.locale = detectedLocale;
    }
    await setAppLocale(settings.locale);
  } catch (e) {
    console.warn("Failed to load settings, using defaults:", e);
    persistenceStatus.error = String(e);
    store = null;
    settingsWriter = null;
    settings.locale = detectedLocale;
    await setAppLocale(detectedLocale);
  } finally {
    applyTheme();
    persistenceReady.ready = true;
  }
}
export async function persistSettings() {
  const writer = settingsWriter;
  if (!writer) return;
  try {
    await writer.enqueue(settingsSnapshot());
    persistenceStatus.error = null;
  } catch (error) {
    persistenceStatus.error = String(error);
    console.warn("Failed to persist settings:", error);
  }
}

function settingsSnapshot(): Settings {
  return {
    ...settings,
    customWorkflowPresets: settings.customWorkflowPresets.map((preset) => ({
      ...preset,
      snapshot: { ...preset.snapshot },
    })),
  };
}

export async function clearResultCache(): Promise<number> {
  if (!isTauriRuntime()) return 0;
  return invoke<number>("clear_result_cache");
}

export async function seedDesktopE2E(): Promise<boolean> {
  if (import.meta.env.VITE_IMGCONVERT_DESKTOP_E2E !== "1" || !isTauriRuntime()) return false;
  const seed = await invoke<DesktopE2ESeed | null>("desktop_e2e_seed");
  if (!seed) return false;

  clearQueue();
  const added = addPaths([seed.input, seed.pdfInput]);
  if (added.added !== 2) throw new Error("desktop E2E fixtures could not be queued");
  settings.format = "jpeg";
  settings.outDir = seed.outDir;
  settings.outputSuffixEnabled = true;
  settings.outputSuffix = "_done";
  settings.overwrite = "skip";
  settings.resizeMode = "percentage";
  settings.resizeValue = 50;
  settings.resizeAllowUpscale = false;
  settings.targetSizeEnabled = true;
  settings.targetSizeKib = 16;
  settings.autoQuality = false;
  settings.lossless = false;
  settings.metadataPolicy = "stripAll";
  settings.pdfDpi = 72;
  settings.pdfPageRange = "1-2";
  settings.preserveMetadata = false;
  outputDirectoryGrant.sessionGranted = true;
  return true;
}

function normalizeSettings(fallbackLocale: AppLocale, persisted?: Partial<Settings>): boolean {
  const before = JSON.stringify({ ...settings });
  const overwrite = settings.overwrite as unknown;
  if (overwrite !== "ask" && overwrite !== "skip" && overwrite !== "overwrite") {
    settings.overwrite = overwrite === true ? "overwrite" : "skip";
  }

  if (!["light", "dark", "system"].includes(settings.theme)) {
    settings.theme = "system";
  }
  if (settings.locale !== "zh-CN" && settings.locale !== "en-US") {
    settings.locale = fallbackLocale;
  }
  if (typeof settings.format !== "string" || !settings.format.trim()) {
    settings.format = CORE_CAPABILITIES.writable[0];
  }
  if (settings.outDir !== null && typeof settings.outDir !== "string") {
    settings.outDir = null;
  }
  if (settings.heicHelperPath !== null && typeof settings.heicHelperPath !== "string") {
    settings.heicHelperPath = null;
  }
  if (typeof settings.fileNameTemplate !== "string" || !settings.fileNameTemplate.trim()) {
    settings.fileNameTemplate = "%name%";
  }
  const suffixSettings = normalizePersistedOutputSuffixSettings(
    persisted,
    settings.outputSuffixEnabled,
    settings.outputSuffix,
  );
  settings.outputSuffixEnabled = suffixSettings.outputSuffixEnabled;
  settings.outputSuffix = suffixSettings.outputSuffix;
  if (typeof settings.preserveMetadata !== "boolean") {
    settings.preserveMetadata = false;
  }
  const persistedMetadataPolicy = persisted?.metadataPolicy;
  if (
    persistedMetadataPolicy !== "stripAll" &&
    persistedMetadataPolicy !== "colorOnly" &&
    persistedMetadataPolicy !== "preserveAll"
  ) {
    settings.metadataPolicy = settings.preserveMetadata ? "preserveAll" : "stripAll";
  }
  settings.preserveMetadata = settings.metadataPolicy === "preserveAll";
  if (
    !["none", "fit", "width", "height", "longestEdge", "percentage"].includes(settings.resizeMode)
  ) {
    settings.resizeMode = "none";
  }
  settings.resizeWidth = normalizeWorkflowInteger(settings.resizeWidth, 1, 65_535, 1920);
  settings.resizeHeight = normalizeWorkflowInteger(settings.resizeHeight, 1, 65_535, 1080);
  settings.resizeValue = normalizeWorkflowInteger(
    settings.resizeValue,
    1,
    settings.resizeMode === "percentage" ? 400 : 65_535,
    settings.resizeMode === "percentage" ? 100 : 2048,
  );
  if (typeof settings.resizeAllowUpscale !== "boolean") {
    settings.resizeAllowUpscale = false;
  }
  if (typeof settings.targetSizeEnabled !== "boolean") {
    settings.targetSizeEnabled = false;
  }
  settings.targetSizeKib = normalizeWorkflowInteger(
    settings.targetSizeKib,
    MIN_TARGET_SIZE_KIB,
    MAX_TARGET_SIZE_KIB,
    1024,
  );
  settings.workflowSettingsVersion = WORKFLOW_SETTINGS_VERSION;
  settings.customWorkflowPresets = normalizeCustomWorkflowPresets(settings.customWorkflowPresets);
  if (!["preserve", "convertToSrgb"].includes(settings.colorManagementPolicy)) {
    settings.colorManagementPolicy = "preserve";
  }
  settings.pdfDpi = normalizeWorkflowInteger(
    settings.pdfDpi,
    MIN_PDF_DPI,
    MAX_PDF_DPI,
    DEFAULT_PDF_DPI,
  );
  if (typeof settings.pdfPageRange !== "string") {
    settings.pdfPageRange = "";
  } else {
    settings.pdfPageRange = settings.pdfPageRange.slice(0, MAX_PDF_PAGE_RANGE_CHARS);
  }
  if (typeof settings.concurrency !== "number" || !Number.isFinite(settings.concurrency)) {
    settings.concurrency = 0;
  } else {
    settings.concurrency = Math.min(8, Math.max(0, Math.round(settings.concurrency)));
  }
  if (typeof settings.lossless !== "boolean") {
    settings.lossless = false;
  }
  if (typeof settings.jpegProgressive !== "boolean") {
    settings.jpegProgressive = true;
  }
  if (typeof settings.pngOxipngLevel !== "number" || !Number.isFinite(settings.pngOxipngLevel)) {
    settings.pngOxipngLevel = 4;
  } else {
    settings.pngOxipngLevel = Math.min(6, Math.max(0, Math.round(settings.pngOxipngLevel)));
  }
  if (typeof settings.pngLossyQuantize !== "boolean") {
    settings.pngLossyQuantize = false;
  }
  if (typeof settings.pngQuantColors !== "number" || !Number.isFinite(settings.pngQuantColors)) {
    settings.pngQuantColors = 256;
  } else {
    settings.pngQuantColors = Math.min(256, Math.max(64, Math.round(settings.pngQuantColors)));
  }
  if (typeof settings.webpMethod !== "number" || !Number.isFinite(settings.webpMethod)) {
    settings.webpMethod = 4;
  } else {
    settings.webpMethod = Math.min(6, Math.max(0, Math.round(settings.webpMethod)));
  }
  if (typeof settings.avifSpeed !== "number" || !Number.isFinite(settings.avifSpeed)) {
    settings.avifSpeed = 8;
  } else {
    settings.avifSpeed = Math.min(10, Math.max(0, Math.round(settings.avifSpeed)));
  }
  if (settings.avifSubsample !== "yuv420" && settings.avifSubsample !== "yuv444") {
    settings.avifSubsample = "yuv444";
  }
  if (
    typeof settings.webpNearLossless !== "number" ||
    !Number.isFinite(settings.webpNearLossless)
  ) {
    settings.webpNearLossless = 100;
  } else {
    settings.webpNearLossless = Math.min(100, Math.max(0, Math.round(settings.webpNearLossless)));
  }
  if (typeof settings.webpSharpYuv !== "boolean") {
    settings.webpSharpYuv = false;
  }
  if (typeof settings.jpegTrellis !== "boolean") {
    settings.jpegTrellis = true;
  }
  if (typeof settings.autoQuality !== "boolean") {
    settings.autoQuality = false;
  }
  if (settings.targetSizeEnabled && settings.autoQuality) {
    settings.autoQuality = false;
  }
  if (settings.targetSizeEnabled && settings.lossless) {
    settings.lossless = false;
  }
  if (
    typeof settings.autoQualityScore !== "number" ||
    !Number.isFinite(settings.autoQualityScore)
  ) {
    settings.autoQualityScore = 80;
  } else {
    settings.autoQualityScore = Math.min(95, Math.max(50, Math.round(settings.autoQualityScore)));
  }
  if (typeof settings.resultCache !== "boolean") {
    settings.resultCache = true;
  }
  const conversionPolicySettings = normalizePersistedConversionPolicySettings(
    persisted,
    settings.generationLossProtection,
    settings.skipIfLarger,
  );
  settings.generationLossProtection = conversionPolicySettings.generationLossProtection;
  settings.skipIfLarger = conversionPolicySettings.skipIfLarger;
  settings.conversionPolicyVersion = conversionPolicySettings.conversionPolicyVersion;
  if (typeof settings.multiCandidate !== "boolean") {
    settings.multiCandidate = true;
  }
  if (typeof settings.reduceMotion !== "boolean") {
    settings.reduceMotion = false;
  }
  settings.quality = clampQuality(settings.quality);
  settings.jpegQualityFloor = normalizeQualityFloor(settings.jpegQualityFloor, 30);
  settings.webpQualityFloor = normalizeQualityFloor(settings.webpQualityFloor, 30);
  settings.avifQualityFloor = normalizeQualityFloor(settings.avifQualityFloor, 30);
  return conversionPolicySettings.migrated || JSON.stringify({ ...settings }) !== before;
}

function clampQuality(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 80;
  }
  return Math.min(100, Math.max(1, Math.round(value)));
}

function normalizeWorkflowInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeQualityFloor(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.min(100, Math.max(0, Math.round(value)));
  return rounded < 30 ? 0 : rounded;
}
