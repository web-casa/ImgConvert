// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import { Channel, invoke, isTauri as tauriIsTauri } from "@tauri-apps/api/core";
import { confirm as confirmDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  check as checkTauriUpdate,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";

// ---- 类型 ----
export type ItemStatus = "pending" | "running" | "done" | "skipped" | "error";
export type ThumbnailStatus = "idle" | "loading" | "ready" | "skipped" | "error";
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
  preview?: boolean;
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
export interface HeicCodecDiagnostics {
  enabled: boolean;
  externalCodecsEnabled: boolean;
  disabledReason: string | null;
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
  message: string | null;
  manifests: ManifestDiagnostic[];
}
export interface ManifestDiagnostic {
  path: string;
  status: string;
  message: string | null;
  provider: CodecProviderDiagnostic | null;
}
export interface SystemHelperDiagnostic {
  command: string;
  available: boolean;
  path: string | null;
  message: string | null;
}
export interface SystemCodecDiagnostic {
  id: string;
  kind: string;
  available: boolean;
  readable: string[];
  message: string;
  installHint: string | null;
}
export interface SelectedHelperDiagnostic {
  configured: boolean;
  available: boolean;
  path: string | null;
  message: string | null;
  provider: CodecProviderDiagnostic | null;
}
export interface ConvertResult {
  input: string;
  output: string;
  inSize: number;
  outSize: number;
}
export interface ImportScanError {
  path: string;
  message: string;
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
}
export interface ImportScanResult {
  files: ImportScanFile[];
  skipped: number;
  errors: ImportScanError[];
  truncated: boolean;
  cancelled: boolean;
  limitReason: string | null;
}
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
}
export interface ThumbnailResult {
  input: string;
  mime: string;
  width: number;
  height: number;
  bytes: number[] | Uint8Array;
}
export interface PickPathOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  extensions?: string[];
}
export interface ConversionPlanEntry {
  index: number;
  input: string;
  output: string | null;
  exists: boolean;
  error: string | null;
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
type ConvertRequest = {
  input: string;
  format: string;
  quality: number;
  qualityFloor: number;
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
  multiCandidate: boolean;
  overwrite: boolean;
  overwriteMode: OverwriteMode;
  outDir: string | null;
  relativeDir: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  fileNameTemplate: string;
  preserveMetadata: boolean;
  colorManagementPolicy: ColorManagementPolicy;
};
type BatchConvertRequest = {
  options: ConvertRequest[];
  concurrency: number | null;
};
type BatchProgressEvent =
  | { event: "started"; data: { total: number } }
  | { event: "fileStarted"; data: { index: number; input: string } }
  | {
      event: "fileProgress";
      data: { index: number; percent: number; stage: string };
    }
  | { event: "fileFinished"; data: { index: number; result: ConvertResult } }
  | {
      event: "fileSkipped";
      data: { index: number; input: string; message: string };
    }
  | {
      event: "fileError";
      data: { index: number; input: string; message: string };
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
  multiCandidate: boolean;
  overwrite: OverwriteMode;
  outDir: string | null;
  heicHelperPath: string | null;
  fileNameTemplate: string;
  preserveMetadata: boolean;
  colorManagementPolicy: ColorManagementPolicy;
  concurrency: number;
  theme: Theme;
  reduceMotion: boolean;
}

// ---- 常量 ----
const CORE_CAPABILITIES: Capabilities = {
  readable: ["jpeg", "png", "webp", "avif"],
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
  heic: ["heic", "heif", "hif"],
};
const THUMBNAIL_MAX_EDGE = 180;
const THUMBNAIL_CONCURRENCY = 2;
const CLIPBOARD_MAX_BYTES = 128 * 1024 * 1024;
const CLIPBOARD_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);
let hostPlatformPromise: Promise<string> | null = null;

export const FORMAT_CATEGORIES = [
  { value: "modern", label: "现代格式" },
  { value: "standard", label: "通用格式" },
];

export const FORMATS: {
  value: string;
  label: string;
  category: string;
  description: string;
  note?: string;
}[] = [
  {
    value: "avif",
    label: "AVIF",
    category: "modern",
    description: "高压缩率,适合网页与归档",
  },
  {
    value: "webp",
    label: "WebP",
    category: "modern",
    description: "体积小,兼容现代浏览器",
  },
  {
    value: "jpeg",
    label: "JPEG",
    category: "standard",
    description: "照片通用,兼容性最好",
  },
  {
    value: "png",
    label: "PNG",
    category: "standard",
    description: "无损图形与透明背景",
  },
  {
    value: "heic",
    label: "HEIC",
    category: "modern",
    description: "可选插件导入,不作为输出格式",
    note: "仅导入",
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
  generationLossProtection: true,
  resultCache: true,
  skipIfLarger: true,
  multiCandidate: true,
  overwrite: "skip",
  outDir: null,
  heicHelperPath: null,
  fileNameTemplate: "%name%",
  preserveMetadata: false,
  colorManagementPolicy: "preserve",
  concurrency: 0,
  theme: "system",
  reduceMotion: false,
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

interface UiState {
  converting: boolean;
  cancelRequested: boolean;
  dragActive: boolean;
  importing: boolean;
  importMode: ImportMode;
  importCancelRequested: boolean;
  importMessage: string;
  importErrors: ImportScanError[];
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

export const engine = $state<{ text: string; ok: boolean }>({
  text: "检测 core 能力中…",
  ok: false,
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
  return FORMATS.find((f) => f.value === format)?.label ?? format.toUpperCase();
}

export function writableFormats() {
  const writable = new Set(capabilities.writable);
  return FORMATS.filter((format) => writable.has(format.value));
}

export async function checkForAppUpdate(): Promise<void> {
  if (!isTauriRuntime()) {
    resetAppUpdateResult();
    appUpdate.checked = true;
    appUpdate.message = "网页预览不连接桌面更新通道";
    return;
  }
  if (!updaterEnabled) {
    resetAppUpdateResult();
    appUpdate.checked = true;
    appUpdate.message = "商店构建由 App Store / Microsoft Store 更新";
    return;
  }

  appUpdate.checking = true;
  appUpdate.error = "";
  appUpdate.message = "";
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
      appUpdate.message = "当前已经是最新版本";
      return;
    }

    appUpdate.available = true;
    appUpdate.version = pendingAppUpdate.version;
    appUpdate.currentVersion = pendingAppUpdate.currentVersion;
    appUpdate.date = pendingAppUpdate.date ?? null;
    appUpdate.body = pendingAppUpdate.body ?? null;
    appUpdate.message = `发现新版本 ${pendingAppUpdate.version}`;
  } catch (error) {
    resetAppUpdateResult();
    appUpdate.checked = true;
    appUpdate.error = formatUpdaterError(error);
  } finally {
    appUpdate.checking = false;
  }
}

export async function installAppUpdate(): Promise<void> {
  if (!pendingAppUpdate || appUpdate.installing) return;

  appUpdate.installing = true;
  appUpdate.error = "";
  appUpdate.message = "正在下载更新…";
  appUpdate.downloadedBytes = 0;
  appUpdate.contentLength = null;

  try {
    await pendingAppUpdate.downloadAndInstall(handleUpdateDownloadEvent, { timeout: 120_000 });
    appUpdate.installed = true;
    appUpdate.available = false;
    appUpdate.message = "更新已安装,正在重启…";
    pendingAppUpdate = null;
    await relaunch();
  } catch (error) {
    appUpdate.error = formatUpdaterError(error);
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
      appUpdate.message = "下载完成,正在安装…";
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
  appUpdate.message = "";
  appUpdate.error = "";
}

function formatUpdaterError(error: unknown): string {
  const message = String(error);
  if (/not configured|No updater config|updater.*config/i.test(message)) {
    return "此构建未启用更新通道。正式直发包需要使用 updater release 配置构建。";
  }
  return `更新检查失败:${message}`;
}

export function readableExtensions(): string[] {
  const exts = capabilities.readable.flatMap((format) => FORMAT_EXTENSIONS[format] ?? []);
  return Array.from(new Set(exts));
}

export async function pickSystemPaths(options: PickPathOptions): Promise<string[]> {
  if (!isTauriRuntime()) return [];

  const platform = await hostPlatform();
  if (platform !== "linux") {
    return pickWithTauriDialog(options);
  }

  return invoke<string[]>("pick_paths", {
    options: {
      directory: options.directory ?? false,
      multiple: options.multiple ?? false,
      title: options.title ?? null,
      extensions: options.extensions ?? [],
    },
  });
}

async function hostPlatform(): Promise<string> {
  hostPlatformPromise ??= invoke<string>("host_platform").catch((error) => {
    console.warn("读取宿主平台失败:", error);
    return "unknown";
  });
  return hostPlatformPromise;
}

async function pickWithTauriDialog(options: PickPathOptions): Promise<string[]> {
  const extensions = sanitizedDialogExtensions(options.extensions ?? []);
  const platform = await hostPlatform();
  const selected = await openDialog({
    directory: options.directory ?? false,
    multiple: options.multiple ?? false,
    title: options.title || undefined,
    fileAccessMode: platform === "macos" ? "scoped" : undefined,
    filters:
      !options.directory && extensions.length
        ? [
            {
              name: "图片",
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
  if (b <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function formatImageMetadata(metadata: ImageMetadata | null): string {
  if (!metadata) return "";
  const parts = [`${metadata.width}×${metadata.height}`];
  const dpi = formatDpi(metadata);
  if (dpi) parts.push(dpi);
  return parts.join(" · ");
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

export async function importPaths(paths: string[]) {
  if (ui.converting || ui.importing || paths.length === 0) return;
  await importPathList(paths, "正在扫描导入…");
}

async function importPathList(paths: string[], message: string) {
  ui.importing = true;
  ui.importMode = "scan";
  ui.importCancelRequested = false;
  ui.importMessage = message;
  ui.importErrors = [];
  try {
    if (!isTauriRuntime()) {
      const added = addPaths(paths);
      ui.importMessage = formatImportSummary(added, null);
      return;
    }

    const scan = await invoke<ImportScanResult>("scan_import_paths", {
      options: {
        paths,
        recursive: true,
      },
    });
    ui.importErrors = scan.errors;
    if (scan.cancelled) {
      ui.importMessage = "已取消导入扫描";
      return;
    }

    const added = addPaths(scan.files);
    ui.importMessage = formatImportSummary(added, scan);
  } catch (e) {
    ui.importMessage = `导入失败:${e}`;
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
    ui.importMessage = "网页预览无法读取系统剪贴板,请在 Tauri 桌面端使用";
    return;
  }

  const clipboard = navigator.clipboard as
    | {
        read?: () => Promise<ClipboardItem[]>;
        readText?: () => Promise<string>;
      }
    | undefined;
  if (!clipboard) {
    ui.importMessage = "当前 WebView 不支持读取剪贴板";
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
      await importPathList(paths, "正在扫描剪贴板路径…");
      return;
    }
  } catch (error) {
    readError ??= error;
  }

  ui.importMessage = readError
    ? `读取剪贴板失败:${String(readError)}`
    : "剪贴板中没有可导入的图片或本机路径";
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
  await importPathList(paths, "正在扫描剪贴板路径…");
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
  ui.importMessage = "正在导入剪贴板图片…";
  ui.importErrors = [];

  let skipped = 0;
  const files: ImportScanFile[] = [];
  try {
    for (const image of images) {
      if (ui.importCancelRequested) break;
      try {
        if (image.blob.size > CLIPBOARD_MAX_BYTES) {
          skipped += 1;
          ui.importErrors.push({
            path: image.suggestedName ?? "clipboard",
            message: `剪贴板图片超过上限 ${fmtSize(CLIPBOARD_MAX_BYTES)}`,
          });
          continue;
        }

        const bytes = new Uint8Array(await image.blob.arrayBuffer());
        if (ui.importCancelRequested) break;
        if (bytes.byteLength > CLIPBOARD_MAX_BYTES) {
          skipped += 1;
          ui.importErrors.push({
            path: image.suggestedName ?? "clipboard",
            message: `剪贴板图片超过上限 ${fmtSize(CLIPBOARD_MAX_BYTES)}`,
          });
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
        ui.importErrors.push({
          path: image.suggestedName ?? "clipboard",
          message: String(error),
        });
      }
    }

    if (ui.importCancelRequested) {
      for (const file of files) {
        cleanupTemporaryPath(file.path);
      }
      ui.importMessage = "已取消剪贴板导入";
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
    ui.importMessage = formatImportSummary({ ...added, skipped: added.skipped + skipped }, null);
  } catch (error) {
    ui.importMessage = `剪贴板导入失败:${String(error)}`;
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
    ui.importMessage = "正在取消剪贴板导入…";
    return;
  }

  if (!isTauriRuntime()) {
    ui.importing = false;
    ui.importMode = null;
    ui.importMessage = "已取消导入扫描";
    return;
  }

  try {
    await invoke<boolean>("cancel_import_scan");
  } catch (e) {
    ui.importMessage = `取消导入扫描失败:${e}`;
  }
}

function formatImportSummary(added: AddPathsResult, scan: ImportScanResult | null): string {
  const skipped = (scan?.skipped ?? 0) + added.skipped;
  const scanErrors = scan?.errors.length ?? 0;
  const parts: string[] = [];
  if (added.added > 0) parts.push(`已添加 ${added.added} 个文件`);
  if (added.duplicates > 0) parts.push(`${added.duplicates} 个重复`);
  if (skipped > 0) parts.push(`跳过 ${skipped} 个`);
  if (scanErrors > 0) parts.push(`${scanErrors} 个错误`);
  if (scan?.truncated) parts.push(scan.limitReason ?? "扫描已截断");
  return parts.join(" · ") || "未找到支持的图片";
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
    queue.push({
      path,
      key: path,
      name: baseName(path),
      relativeDir: null,
      status: "pending",
      detail: "网页预览示例",
      targetFormat: null,
      metadata: null,
      thumbnail: null,
      thumbnailStatus: "idle",
      preview: true,
    });
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
    item.detail = item.preview ? "网页预览示例" : "";
    item.progress = 0;
  }
}

export function resetItemFormats() {
  if (ui.converting || ui.importing) return;

  for (const item of queue) {
    item.targetFormat = null;
    if (item.status !== "running") {
      item.status = "pending";
      item.detail = item.preview ? "网页预览示例" : "";
      item.progress = 0;
    }
  }
}
export function removeItem(path: string) {
  if (ui.converting || ui.importing) return;
  const i = queue.findIndex((it) => it.path === path);
  if (i >= 0) {
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
  queue.splice(0, queue.length);
}

function cleanupTemporaryImport(item: QueueItem) {
  if (!item.temporary || !isTauriRuntime()) return;
  cleanupTemporaryPath(item.path);
}

function cleanupTemporaryPath(path: string) {
  if (!isTauriRuntime()) return;
  void invoke<boolean>("cleanup_imported_temp_file", { path }).catch((error) => {
    console.warn("清理剪贴板临时文件失败:", error);
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
    };
    item.thumbnailStatus = "ready";
  } catch (e) {
    if (!queue.includes(item)) return;
    console.warn("缩略图生成失败:", e);
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

// ---- 转换 ----
export async function convertAll() {
  if (ui.converting || ui.importing || queue.length === 0) {
    return;
  }

  if (!isTauriRuntime()) {
    for (const item of queue) {
      if (item.status !== "done") {
        item.status = "error";
        item.detail = "网页预览不执行本地文件转换,请在 Tauri 桌面端运行";
        item.progress = 100;
      }
    }
    return;
  }

  ui.converting = true;
  ui.cancelRequested = false;
  ui.dragActive = false;
  try {
    await convertAllWithBatch();
  } finally {
    ui.converting = false;
    ui.cancelRequested = false;
  }
}

export async function cancelConversion() {
  if (!ui.converting || ui.cancelRequested) return;
  ui.cancelRequested = true;
  if (isTauriRuntime()) {
    try {
      await invoke<boolean>("cancel_batch");
    } catch (e) {
      console.warn("取消批量任务失败:", e);
    }
  }
}

async function convertAllWithBatch() {
  const jobs = prepareBatchJobs();
  if (jobs.length === 0) return;

  for (const job of jobs) {
    job.item.status = "pending";
    job.item.detail = "排队中";
    job.item.progress = 0;
  }

  try {
    if (settings.overwrite === "ask") {
      await applyAskOverwriteDecisions(jobs);
      if (ui.cancelRequested) {
        finalizeCancelledJobs(jobs);
        return;
      }
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
    const msg = String(e);
    for (const job of jobs) {
      if (job.item.status === "pending" || job.item.status === "running") {
        job.item.status = "error";
        job.item.detail = `批量任务失败:${msg}`;
        job.item.progress = 100;
      }
    }
  }
}

function batchConcurrency(): number | null {
  const concurrency = Math.round(settings.concurrency);
  return concurrency > 0 ? Math.min(8, concurrency) : null;
}

async function applyAskOverwriteDecisions(jobs: BatchJob[]) {
  const plan = await invoke<ConversionPlanEntry[]>("plan_conversions", {
    options: jobs.map((job) => job.options),
  });

  for (const entry of plan) {
    if (ui.cancelRequested) break;
    const job = jobs[entry.index];
    if (!job) continue;

    if (entry.error) {
      continue;
    }
    if (!entry.exists) {
      job.options.overwrite = false;
      job.options.overwriteMode = "skip";
      continue;
    }

    const confirmed = await confirmDialog(formatAskOverwriteMessage(entry), {
      title: "确认覆盖",
      kind: "warning",
      okLabel: "覆盖",
      cancelLabel: "跳过",
    });
    if (confirmed) {
      job.options.overwrite = true;
      job.options.overwriteMode = "overwrite";
    } else {
      job.options.overwrite = false;
      job.options.overwriteMode = "skip";
    }
  }
}

function prepareBatchJobs(): BatchJob[] {
  const jobs: BatchJob[] = [];
  for (const item of queue) {
    if (item.status === "done") continue;
    const options = prepareSingleJob(item);
    if (options) jobs.push({ item, options });
  }
  return jobs;
}

function prepareSingleJob(item: QueueItem): ConvertRequest | null {
  const format = itemTargetFormat(item);
  if (!capabilities.writable.includes(format)) {
    item.status = "error";
    item.detail = `不支持的目标格式:${formatLabel(format)}`;
    item.progress = 100;
    return null;
  }
  return buildConvertRequest(item, format);
}

function buildConvertRequest(item: QueueItem, format: string): ConvertRequest {
  return {
    input: item.path,
    format,
    quality: settings.quality,
    qualityFloor: qualityFloorFor(format),
    lossless: settings.lossless && supportsLossless(format),
    jpegProgressive: settings.jpegProgressive,
    pngOxipngLevel: settings.pngOxipngLevel,
    pngLossyQuantize: settings.pngLossyQuantize,
    pngQuantColors: settings.pngQuantColors,
    webpMethod: settings.webpMethod,
    avifSpeed: settings.avifSpeed,
    avifSubsample: settings.avifSubsample,
    webpNearLossless: settings.webpNearLossless,
    webpSharpYuv: settings.webpSharpYuv,
    jpegTrellis: settings.jpegTrellis,
    autoQuality: settings.autoQuality,
    autoQualityScore: settings.autoQualityScore,
    generationLossProtection: settings.generationLossProtection,
    resultCache: settings.resultCache,
    skipIfLarger: settings.skipIfLarger,
    multiCandidate: settings.multiCandidate,
    overwrite: settings.overwrite === "overwrite",
    overwriteMode: settings.overwrite,
    outDir: settings.outDir,
    relativeDir: settings.outDir ? item.relativeDir : null,
    sourceWidth: item.metadata?.width ?? null,
    sourceHeight: item.metadata?.height ?? null,
    fileNameTemplate: settings.fileNameTemplate,
    preserveMetadata: settings.preserveMetadata,
    colorManagementPolicy: settings.colorManagementPolicy,
  };
}

function handleBatchProgress(event: BatchProgressEvent, jobs: BatchJob[]) {
  switch (event.event) {
    case "started":
      return;
    case "fileStarted": {
      const job = jobs[event.data.index];
      if (!job) return;
      job.item.status = "running";
      job.item.detail = "读取并转换";
      job.item.progress = 5;
      return;
    }
    case "fileProgress": {
      const job = jobs[event.data.index];
      if (!job) return;
      job.item.status = "running";
      job.item.detail = event.data.stage;
      job.item.progress = Math.min(100, Math.max(0, Math.round(event.data.percent)));
      return;
    }
    case "fileFinished": {
      const job = jobs[event.data.index];
      if (!job) return;
      job.item.status = "done";
      job.item.detail = formatResultDetail(event.data.result);
      job.item.progress = 100;
      return;
    }
    case "fileSkipped": {
      const job = jobs[event.data.index];
      if (!job) return;
      job.item.status = "skipped";
      job.item.detail = formatSkipDetail(event.data.message);
      job.item.progress = 100;
      return;
    }
    case "fileError": {
      const job = jobs[event.data.index];
      if (!job) return;
      job.item.status = "error";
      job.item.detail = event.data.message;
      job.item.progress = 100;
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

function finalizeCancelledJobs(jobs: BatchJob[]) {
  for (const job of jobs) {
    if (job.item.status === "pending" || job.item.status === "running") {
      job.item.status = "pending";
      job.item.detail = "已取消";
      job.item.progress = 0;
    }
  }
}

function formatResultDetail(res: ConvertResult): string {
  const ratio = res.inSize > 0 ? Math.round((1 - res.outSize / res.inSize) * 100) : 0;
  return `${fmtSize(res.inSize)} → ${fmtSize(res.outSize)} (${ratio >= 0 ? "-" : "+"}${Math.abs(ratio)}%)`;
}

function formatSkipDetail(message: string): string {
  if (message.includes("已存在")) return "已跳过(输出已存在)";
  return `已跳过:${message}`;
}

function formatAskOverwriteMessage(entry: ConversionPlanEntry): string {
  return `输出文件已存在:\n${entry.output ?? entry.input}`;
}

// ---- 引擎检测 ----
export async function checkEngine() {
  if (!isTauriRuntime()) {
    capabilities.readable = [...CORE_CAPABILITIES.readable];
    capabilities.writable = [...CORE_CAPABILITIES.writable];
    capabilities.lossless = [...CORE_CAPABILITIES.lossless];
    capabilities.heic = CORE_CAPABILITIES.heic;
    capabilities.codecProviders = [...CORE_CAPABILITIES.codecProviders];
    engine.text = `网页预览 · ${capabilities.writable.map(formatLabel).join(" / ")}`;
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

    const heicProvider = capabilities.codecProviders.find((provider) =>
      provider.readable.includes("heic"),
    );
    const heicProviderText =
      heicProvider?.kind === "manifest"
        ? "插件"
        : heicProvider?.kind === "system-helper"
          ? "系统 helper"
          : heicProvider?.kind === "system-imageio"
            ? "系统 ImageIO"
            : heicProvider?.kind === "system-wic"
              ? "Windows WIC"
              : heicProvider?.kind === "selected-helper"
                ? "手动 helper"
                : "可选 helper";
    const heicText = capabilities.heic ? ` · HEIC 可选导入(${heicProviderText})` : "";
    engine.text = `Core 就绪 · ${capabilities.writable.map(formatLabel).join(" / ")}${heicText}`;
    engine.ok = capabilities.writable.length > 0;
  } catch (e) {
    engine.text = `Core 能力检测失败:${e}`;
    engine.ok = false;
  }
}

export async function loadCodecDiagnostics(): Promise<CodecDiagnostics> {
  if (!isTauriRuntime()) {
    return {
      heic: {
        enabled: false,
        externalCodecsEnabled: false,
        disabledReason: null,
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
      message: "网页预览环境不配置本机 helper",
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
    console.warn("同步 HEIC helper 白名单失败:", error);
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
let store: Store | null = null;
export async function initPersistence() {
  if (!isTauriRuntime()) {
    applyTheme();
    return;
  }

  try {
    store = await load("settings.json", { defaults: {}, autoSave: 300 });
    const saved = await store.get<Partial<Settings>>("settings");
    if (saved) {
      Object.assign(settings, saved);
      normalizeSettings();
    }
  } catch (e) {
    console.warn("加载设置失败,用默认值:", e);
  }
  applyTheme();
}
export async function persistSettings() {
  if (!store) return;
  await store.set("settings", { ...settings });
}

function normalizeSettings() {
  const overwrite = settings.overwrite as unknown;
  if (overwrite !== "ask" && overwrite !== "skip" && overwrite !== "overwrite") {
    settings.overwrite = overwrite === true ? "overwrite" : "skip";
  }

  if (!["light", "dark", "system"].includes(settings.theme)) {
    settings.theme = "system";
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
  if (typeof settings.preserveMetadata !== "boolean") {
    settings.preserveMetadata = false;
  }
  if (!["preserve", "convertToSrgb"].includes(settings.colorManagementPolicy)) {
    settings.colorManagementPolicy = "preserve";
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
  if (
    typeof settings.autoQualityScore !== "number" ||
    !Number.isFinite(settings.autoQualityScore)
  ) {
    settings.autoQualityScore = 80;
  } else {
    settings.autoQualityScore = Math.min(95, Math.max(50, Math.round(settings.autoQualityScore)));
  }
  if (typeof settings.generationLossProtection !== "boolean") {
    settings.generationLossProtection = true;
  }
  if (typeof settings.resultCache !== "boolean") {
    settings.resultCache = true;
  }
  if (typeof settings.skipIfLarger !== "boolean") {
    settings.skipIfLarger = true;
  }
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
}

function clampQuality(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 80;
  }
  return Math.min(100, Math.max(1, Math.round(value)));
}

function normalizeQualityFloor(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.min(100, Math.max(0, Math.round(value)));
  return rounded < 30 ? 0 : rounded;
}
