<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import {
    CapabilityRegistry,
    WEB_001B_RASTER_CAPABILITIES,
    WEB_006_SVG_CAPABILITIES,
    WEB_007_PDF_CAPABILITIES,
    WEB_V1_DESKTOP_LIMITS,
    PDF_DEFAULT_DPI,
    PDF_MAX_DPI,
    PDF_MIN_DPI,
    assertJobTransition,
    createConversionFailure,
    parsePdfPageRange,
    type PdfConversionRequest,
    type ConversionRequest,
    type ConversionSettings,
    type RasterOutputFormat,
  } from "@imgconvert/conversion-contract";
  import {
    SerialConversionScheduler,
    PdfConversionScheduler,
    outputFileName,
    outputMimeType,
    pdfPageOutputFileName,
    type ConversionJobHandle,
    type PdfConversionJobHandle,
  } from "@imgconvert/web-image-engine";
  import Check from "@lucide/svelte/icons/check";
  import Download from "@lucide/svelte/icons/download";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import { onMount, tick } from "svelte";

  import BatchExportPanel from "./lib/BatchExportPanel.svelte";
  import ConvertDock from "./lib/ConvertDock.svelte";
  import Dropzone from "./lib/Dropzone.svelte";
  import Header from "./lib/Header.svelte";
  import PwaPanel from "./lib/PwaPanel.svelte";
  import QueueList from "./lib/QueueList.svelte";
  import SettingsPanel from "./lib/SettingsPanel.svelte";
  import SiteFooter from "./lib/SiteFooter.svelte";
  import StatsPanel from "./lib/StatsPanel.svelte";
  import { reveal } from "./lib/reveal";
  import {
    formatBytes as formatBytesPure,
    formatDimensions as formatDimensionsPure,
    formatDuration as formatDurationPure,
    resultDelta as resultDeltaPure,
  } from "./lib/format";
  import { summarizeQueueByteReduction } from "./lib/impact";
  import { translations, type Locale } from "./lib/copy";
  import {
    DEFAULT_WEB_CONVERSION_PREFERENCES,
    WEB_LOCALE_PREFERENCE_KEY,
    WEB_THEME_PREFERENCE_KEY,
    clearWebPreferences,
    loadWebConversionPreferences,
    saveWebConversionPreferences,
  } from "./lib/preferences";
  import {
    clearImgConvertOfflineCaches,
    registerImgConvertPwa,
    type PwaManager,
    type PwaStatus,
  } from "./lib/pwa";
  import {
    ArchiveScheduler,
    nextConversionIncludesPdf,
    type ArchiveJobHandle,
  } from "@imgconvert/web-conversion-runtime";
  import {
    BATCH_ARCHIVE_FILE_NAME,
    createBatchExportPlan,
    type BatchExportArtifact,
    type BatchExportUiState,
  } from "./lib/batch-export";
  import {
    DirectoryExportError,
    directoryPickerFromWindow,
    writeBatchToDirectory,
    type DirectoryPicker,
  } from "./lib/directory-export";
  import type { AdmissionNotice } from "./lib/workbench";
  import {
    admitFiles,
    formatMismatch,
    isAbortError,
    normalizeProbeFailure,
    probeImageFile,
    remainingQueueOutputBytes,
    type ImportQueueState,
    type QueueConversionResult,
    type QueueEntry,
  } from "./lib/queue";

  type Theme = "dark" | "light";

  interface ActiveConversion {
    readonly entryId: string;
    readonly handle: Pick<ConversionJobHandle | PdfConversionJobHandle, "cancel">;
  }

  interface PendingConversion {
    readonly entryId: string;
    readonly pdf: Readonly<{ dpi: number; pages: readonly number[] }> | undefined;
    readonly settings: ConversionSettings;
  }

  interface BeforeInstallPromptEvent extends Event {
    readonly userChoice: Promise<Readonly<{ outcome: "accepted" | "dismissed"; platform: string }>>;
    prompt(): Promise<void>;
  }

  let locale = $state<Locale>("zh");
  let theme = $state<Theme>("light");
  let entries = $state<QueueEntry[]>([]);
  let notices = $state<AdmissionNotice[]>([]);
  let probePumpRunning = false;
  let clearDialog: HTMLDialogElement;
  let localDataDialog: HTMLDialogElement;
  let previewDialog: HTMLDialogElement;
  let previewEntry = $state<QueueEntry>();
  let previewResult = $state<QueueConversionResult>();
  let rasterConversionScheduler: SerialConversionScheduler | undefined;
  let svgConversionScheduler: SerialConversionScheduler | undefined;
  let pdfConversionScheduler: PdfConversionScheduler | undefined;
  let archiveScheduler: ArchiveScheduler | undefined;
  let activeConversion: ActiveConversion | undefined;
  let activeArchiveExport: ArchiveJobHandle | undefined;
  let directoryExportController: AbortController | undefined;
  let directoryPicker: DirectoryPicker | undefined;
  let batchExportSequence = 0;
  let batchRunning = $state(false);
  let cancelBatchRequested = false;
  let batchExportState = $state<BatchExportUiState>("idle");
  let batchExportProgressCompleted = $state(0);
  let batchExportProgressTotal = $state(0);
  let directoryExportSupported = $state(false);
  let preferencesReady = $state(false);
  let conversionPersistenceBlocked = $state(false);
  let localDataClearing = $state(false);
  let localDataClearError = $state(false);
  let installPrompt = $state<BeforeInstallPromptEvent>();
  let isOnline = $state(true);
  let pwaManager: PwaManager | undefined;
  let pwaRegistrationAllowed = false;
  let pwaRegistrationInFlight: Promise<void> | undefined;
  let pwaStatus = $state<PwaStatus>({
    offlineReady: false,
    phase: "registering",
    updateAvailable: false,
  });
  const probeControllers = new Map<string, AbortController>();

  const conversionCapabilities = new CapabilityRegistry([
    WEB_001B_RASTER_CAPABILITIES,
    WEB_006_SVG_CAPABILITIES,
    WEB_007_PDF_CAPABILITIES,
  ]);
  const outputFormats = WEB_001B_RASTER_CAPABILITIES.inputs[0]?.outputs ?? [];
  let outputFormat = $state<RasterOutputFormat>("webp");
  let lossless = $state(false);
  let quality = $state(82);
  let resizeMode = $state<"custom" | "original">("original");
  let resizeWidth = $state(1920);
  let resizeHeight = $state(1080);
  let jpegBackground = $state("#ffffff");
  let pdfPageRange = $state("1");
  let pdfDpi = $state(PDF_DEFAULT_DPI);

  const copy = $derived(translations[locale]);
  const totalBytes = $derived(entries.reduce((total, entry) => total + entry.size, 0));
  const readyCount = $derived(entries.filter(({ state }) => state === "ready").length);
  const convertedCount = $derived(entries.filter(({ state }) => state === "done").length);
  const undownloadedCount = $derived(
    entries.reduce(
      (count, entry) => count + entryResults(entry).filter(({ downloaded }) => !downloaded).length,
      0,
    ),
  );
  const checkedCount = $derived(entries.filter(({ probe }) => probe !== undefined).length);
  const queueByteReduction = $derived(summarizeQueueByteReduction(entries));
  const activeCount = $derived(
    entries.filter(
      ({ state }) => state === "queued" || state === "probing" || state === "converting",
    ).length,
  );
  const batchExportPlan = $derived.by(() => createBatchExportPlan(entries));
  const showBatchExport = $derived(
    batchExportPlan.outputCount > 1 ||
      (batchExportPlan.outputCount > 0 && batchExportPlan.failureCount > 0),
  );
  const batchExportBusy = $derived(
    batchExportState === "archiving" || batchExportState === "writing",
  );
  const numberLocale = $derived(locale === "zh" ? "zh-CN" : "en-US");
  const dimensionError = $derived(
    resizeMode === "custom" &&
      (!Number.isSafeInteger(resizeWidth) ||
        !Number.isSafeInteger(resizeHeight) ||
        resizeWidth < 1 ||
        resizeHeight < 1 ||
        resizeWidth * resizeHeight > WEB_V1_DESKTOP_LIMITS.maxRuntimePixels),
  );
  const hasPdfEntries = $derived(
    entries.some(({ probe, state }) => probe?.format === "pdf" && state !== "failed"),
  );
  const nextBatchIncludesPdf = $derived(nextConversionIncludesPdf(entries));
  const pdfDpiError = $derived(
    nextBatchIncludesPdf &&
      (!Number.isSafeInteger(pdfDpi) || pdfDpi < PDF_MIN_DPI || pdfDpi > PDF_MAX_DPI),
  );
  const pdfPageError = $derived.by(() => {
    if (!nextBatchIncludesPdf) return false;
    try {
      parsePdfPageRange(pdfPageRange);
      return false;
    } catch {
      return true;
    }
  });
  const pdfSettingsError = $derived(pdfDpiError || pdfPageError);

  function readPreference(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function savePreference(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Preferences remain session-only when browser storage is unavailable.
    }
  }

  function applyDocumentPreferences(): void {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.theme = theme;
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#172019" : "#f8f5ed");
  }

  function setLocale(nextLocale: Locale): void {
    locale = nextLocale;
    savePreference(WEB_LOCALE_PREFERENCE_KEY, locale);
    const url = new URL(window.location.href);
    url.searchParams.set("lang", locale);
    history.replaceState(null, "", url);
    applyDocumentPreferences();
  }

  function toggleTheme(): void {
    theme = theme === "light" ? "dark" : "light";
    savePreference(WEB_THEME_PREFERENCE_KEY, theme);
    applyDocumentPreferences();
  }

  function formatBytes(bytes: number): string {
    return formatBytesPure(bytes, numberLocale);
  }

  function formatDimensions(entry: QueueEntry): string {
    return formatDimensionsPure(entry, numberLocale);
  }

  function formatOutputDimensions(result: QueueConversionResult): string {
    const formatter = new Intl.NumberFormat(numberLocale);
    return `${formatter.format(result.width)} × ${formatter.format(result.height)}`;
  }

  function formatDuration(durationMs: number): string {
    return formatDurationPure(durationMs, numberLocale);
  }

  function resultDelta(entry: QueueEntry): string {
    return resultDeltaPure(
      entry,
      numberLocale,
      copy.preview.reduction,
      copy.preview.larger,
      copy.preview.sameSize,
    );
  }

  function transition(entry: QueueEntry, next: ImportQueueState): void {
    assertJobTransition(entry.state, next);
    entry.state = next;
  }

  function isCurrent(entry: QueueEntry): boolean {
    return entries.some(({ id }) => id === entry.id);
  }

  function isCurrentState(entry: QueueEntry, state: ImportQueueState): boolean {
    return entries.find(({ id }) => id === entry.id)?.state === state;
  }

  function entryResults(entry: QueueEntry): QueueConversionResult[] {
    return entry.result
      ? [entry.result, ...(entry.additionalResults ?? [])]
      : (entry.additionalResults ?? []);
  }

  function disposeEntry(entry: QueueEntry): void {
    URL.revokeObjectURL(entry.previewUrl);
    for (const result of entryResults(entry)) URL.revokeObjectURL(result.previewUrl);
  }

  function createQueueEntry(file: File): QueueEntry {
    return {
      file,
      id: crypto.randomUUID(),
      name: file.name || (locale === "zh" ? "未命名图片" : "Untitled image"),
      previewUrl: URL.createObjectURL(file),
      size: file.size,
      state: "queued",
    };
  }

  async function pumpProbeQueue(): Promise<void> {
    if (probePumpRunning) return;
    probePumpRunning = true;
    try {
      let entry = entries.find(({ state }) => state === "queued");
      while (entry) {
        transition(entry, "probing");
        const controller = new AbortController();
        probeControllers.set(entry.id, controller);
        try {
          const probe = await probeImageFile(entry.file, controller.signal);
          if (probeControllers.get(entry.id) === controller && entry.state === "probing") {
            entry.probe = probe;
            entry.gifFirstFrameNotice = probe.format === "gif";
            const warning = formatMismatch(entry.name, probe.format);
            if (warning) entry.warning = warning;
            else delete entry.warning;
            transition(entry, "ready");
          }
        } catch (error) {
          if (
            probeControllers.get(entry.id) === controller &&
            entry.state === "probing" &&
            !isAbortError(error)
          ) {
            entry.failure = normalizeProbeFailure(error);
            transition(entry, "failed");
          }
        } finally {
          if (probeControllers.get(entry.id) === controller) probeControllers.delete(entry.id);
        }
        entry = entries.find(({ state }) => state === "queued");
      }
    } finally {
      probePumpRunning = false;
      if (entries.some(({ state }) => state === "queued")) void pumpProbeQueue();
    }
  }

  async function revealQueueOnNarrowViewport(): Promise<void> {
    await tick();
    if (!window.matchMedia("(max-width: 900px)").matches) return;

    const queueRail = document.querySelector<HTMLElement>(".v-softlab-queue-rail");
    const firstItem = queueRail?.querySelector<HTMLElement>(".queue-item");
    if (!queueRail || !firstItem) return;

    const itemBounds = firstItem.getBoundingClientRect();
    const topInset = 96;
    const bottomInset = 16;
    if (itemBounds.top >= topInset && itemBounds.bottom <= window.innerHeight - bottomInset) return;

    queueRail.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }

  function addFiles(files: readonly File[]): void {
    if (files.length === 0) return;
    const admission = admitFiles(entries.length, totalBytes, files);
    notices = admission.rejected.slice(0, 4).map(({ file, failure }) => ({
      failure,
      id: crypto.randomUUID(),
      name: file.name,
    }));
    if (admission.accepted.length > 0 && !batchExportBusy) batchExportState = "idle";
    for (const file of admission.accepted) entries.push(createQueueEntry(file));
    if (admission.accepted.length > 0) {
      void pumpProbeQueue();
      void revealQueueOnNarrowViewport();
    }
  }

  function handlePaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length > 0) addFiles(files);
  }

  function cancelProbe(entry: QueueEntry): void {
    if (entry.state === "queued") {
      transition(entry, "cancelled");
      return;
    }
    if (entry.state !== "probing") return;
    probeControllers.get(entry.id)?.abort();
    transition(entry, "cancelled");
  }

  function retryProbe(entry: QueueEntry): void {
    stopBatchExport("idle");
    if (entry.state === "cancelled") {
      const replacement: QueueEntry = {
        file: entry.file,
        id: crypto.randomUUID(),
        name: entry.name,
        previewUrl: entry.previewUrl,
        size: entry.size,
        state: "queued",
      };
      for (const result of entryResults(entry)) URL.revokeObjectURL(result.previewUrl);
      entries = entries.map((candidate) => (candidate.id === entry.id ? replacement : candidate));
      void pumpProbeQueue();
      return;
    }
    if (entry.state !== "failed") return;
    delete entry.failure;
    delete entry.conversionFailure;
    delete entry.probe;
    delete entry.progress;
    for (const result of entryResults(entry)) URL.revokeObjectURL(result.previewUrl);
    delete entry.result;
    delete entry.additionalResults;
    delete entry.pageFailures;
    delete entry.pdfPageCount;
    delete entry.gifFirstFrameNotice;
    delete entry.warning;
    transition(entry, "queued");
    void pumpProbeQueue();
  }

  function removeEntry(entry: QueueEntry): void {
    stopBatchExport("idle");
    probeControllers.get(entry.id)?.abort();
    probeControllers.delete(entry.id);
    if (activeConversion?.entryId === entry.id) activeConversion.handle.cancel();
    disposeEntry(entry);
    if (previewEntry?.id === entry.id) previewDialog.close();
    entries = entries.filter(({ id }) => id !== entry.id);
  }

  function openClearDialog(): void {
    clearDialog.showModal();
  }

  function clearQueue(): void {
    stopBatchExport("idle");
    cancelBatchRequested = true;
    activeConversion?.handle.cancel();
    for (const controller of probeControllers.values()) controller.abort();
    probeControllers.clear();
    for (const entry of entries) disposeEntry(entry);
    if (previewDialog.open) previewDialog.close();
    entries = [];
    notices = [];
  }

  function openLocalDataDialog(): void {
    localDataClearError = false;
    localDataDialog.showModal();
  }

  function applyDefaultPreferences(): void {
    const defaults = DEFAULT_WEB_CONVERSION_PREFERENCES;
    outputFormat = defaults.outputFormat;
    lossless = defaults.lossless;
    quality = defaults.quality;
    resizeMode = defaults.resizeMode;
    resizeWidth = defaults.resizeWidth;
    resizeHeight = defaults.resizeHeight;
    jpegBackground = defaults.jpegBackground;
    pdfPageRange = defaults.pdfPageRange;
    pdfDpi = defaults.pdfDpi;
    const url = new URL(window.location.href);
    url.searchParams.delete("lang");
    history.replaceState(null, "", url);
    locale = navigator.languages.some((language) => language.toLowerCase().startsWith("zh"))
      ? "zh"
      : "en";
    theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyDocumentPreferences();
  }

  async function clearLocalData(): Promise<void> {
    if (localDataClearing) return;
    localDataClearing = true;
    localDataClearError = false;
    conversionPersistenceBlocked = true;
    const preferencesCleared = clearWebPreferences(localStorage);
    applyDefaultPreferences();
    try {
      if ("caches" in window) await clearImgConvertOfflineCaches(window.caches);
      if (!preferencesCleared) throw new Error("Browser storage rejected the clear operation.");
      pwaStatus = { offlineReady: false, phase: "cleared", updateAvailable: false };
      localDataDialog.close();
    } catch {
      localDataClearError = true;
    } finally {
      localDataClearing = false;
    }
  }

  async function installWebApp(): Promise<void> {
    const prompt = installPrompt;
    if (!prompt) return;
    installPrompt = undefined;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      pwaStatus = { offlineReady: pwaStatus.offlineReady, phase: "error", updateAvailable: false };
    }
  }

  function registerPwa(): Promise<void> {
    if (pwaRegistrationInFlight) return pwaRegistrationInFlight;
    const registration = registerImgConvertPwa((status) => {
      if (pwaRegistrationAllowed) pwaStatus = status;
    }).then((manager) => {
      if (!pwaRegistrationAllowed) {
        manager?.dispose();
        return;
      }
      pwaManager?.dispose();
      pwaManager = manager;
    });
    pwaRegistrationInFlight = registration.finally(() => {
      pwaRegistrationInFlight = undefined;
    });
    return pwaRegistrationInFlight;
  }

  function checkForPwaUpdate(): void {
    if (pwaManager) void pwaManager.checkForUpdate();
    else void registerPwa();
  }

  async function activatePwaUpdate(): Promise<void> {
    if ((await pwaManager?.activateUpdate()) !== false) return;
    pwaStatus = { offlineReady: pwaStatus.offlineReady, phase: "error", updateAvailable: false };
  }

  function backgroundFromHex(value: string): ConversionSettings["background"] {
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value);
    if (!match) return Object.freeze({ blue: 255, green: 255, red: 255 });
    return Object.freeze({
      blue: Number.parseInt(match[3] ?? "ff", 16),
      green: Number.parseInt(match[2] ?? "ff", 16),
      red: Number.parseInt(match[1] ?? "ff", 16),
    });
  }

  function snapshotSettings(): ConversionSettings {
    const nextLossless = outputFormat === "png" || (outputFormat !== "jpeg" && lossless);
    return Object.freeze({
      background: backgroundFromHex(jpegBackground),
      lossless: nextLossless,
      metadata: "stripAll",
      output: outputFormat,
      quality: outputFormat === "png" || nextLossless ? null : Math.round(quality),
      resize:
        resizeMode === "custom"
          ? Object.freeze({ height: Math.round(resizeHeight), width: Math.round(resizeWidth) })
          : null,
    });
  }

  async function convertEntry(
    entry: QueueEntry,
    settings: ConversionSettings,
    pdfSettings: PendingConversion["pdf"],
  ): Promise<void> {
    if (!entry.probe || entry.state !== "ready" || !isCurrent(entry)) return;
    const probe = entry.probe;
    delete entry.conversionFailure;
    delete entry.progress;
    transition(entry, "converting");
    if (!conversionCapabilities.supports(probe.format, settings.output)) {
      entry.conversionFailure = createConversionFailure("unsupported-output", true);
      transition(entry, "failed");
      return;
    }
    const outputByteLimit = remainingQueueOutputBytes(entries);
    if (outputByteLimit === 0) {
      entry.conversionFailure = createConversionFailure("output-budget-exceeded", true);
      transition(entry, "failed");
      return;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await entry.file.arrayBuffer();
    } catch {
      if (!isCurrentState(entry, "converting")) return;
      entry.conversionFailure = createConversionFailure("worker-failed", true, {
        reason: "read-failed",
      });
      transition(entry, "failed");
      return;
    }
    if (!isCurrentState(entry, "converting")) return;
    if (cancelBatchRequested) {
      transition(entry, "cancelled");
      return;
    }

    if (probe.format === "pdf") {
      if (!pdfConversionScheduler) {
        entry.conversionFailure = createConversionFailure("worker-failed", true, {
          reason: "scheduler-unavailable",
        });
        transition(entry, "failed");
        return;
      }
      if (!pdfSettings) {
        entry.conversionFailure = createConversionFailure("invalid-settings", true);
        transition(entry, "failed");
        return;
      }
      const request: PdfConversionRequest = {
        outputByteLimit,
        input: { bytes, name: entry.name, probe },
        jobId: `pdf-${entry.id}`,
        schemaVersion: 1,
        settings: { dpi: pdfSettings.dpi, pages: pdfSettings.pages, raster: settings },
      };
      let handle: PdfConversionJobHandle;
      try {
        handle = pdfConversionScheduler.enqueue(
          request,
          ({ pageIndex, pageNumber, pageTotal, phase, progress }) => {
            if (isCurrent(entry) && entry.state === "converting") {
              entry.progress = Object.freeze({
                pageIndex,
                pageNumber,
                pageTotal,
                phase,
                value: progress,
              });
            }
          },
        );
      } catch {
        entry.conversionFailure = createConversionFailure("invalid-settings", true);
        transition(entry, "failed");
        return;
      }
      activeConversion = { entryId: entry.id, handle };
      const outcome = await handle.outcome;
      if (activeConversion?.handle === handle) activeConversion = undefined;
      if (!isCurrentState(entry, "converting")) return;
      if (!outcome.ok) {
        entry.conversionFailure = outcome.failure;
        delete entry.progress;
        transition(entry, outcome.failure.code === "cancelled" ? "cancelled" : "failed");
        return;
      }

      entry.pdfPageCount = outcome.result.pageCount;
      entry.pageFailures = outcome.result.pages
        .filter((page) => !page.ok)
        .map((page) => ({ failure: page.failure, pageNumber: page.pageNumber }));
      const results = outcome.result.pages.flatMap((page): QueueConversionResult[] => {
        if (!page.ok) return [];
        const blob = new Blob([page.result.bytes], { type: outputMimeType(page.result.format) });
        return [
          {
            blob,
            downloaded: false,
            durationMs: page.result.durationMs,
            format: page.result.format,
            height: page.result.height,
            name: pdfPageOutputFileName(entry.name, page.pageNumber, page.result.format),
            pageNumber: page.pageNumber,
            previewUrl: URL.createObjectURL(blob),
            settings,
            size: blob.size,
            width: page.result.width,
          },
        ];
      });
      const [firstResult, ...additionalResults] = results;
      if (!firstResult) {
        entry.conversionFailure =
          entry.pageFailures[0]?.failure ?? createConversionFailure("decode-failed", true);
        delete entry.progress;
        transition(entry, "failed");
        return;
      }
      entry.result = firstResult;
      entry.additionalResults = additionalResults;
      entry.progress = Object.freeze({ phase: "validating", value: 1 });
      transition(entry, "done");
      return;
    }

    const conversionScheduler =
      probe.format === "svg" ? svgConversionScheduler : rasterConversionScheduler;
    if (!conversionScheduler) {
      entry.conversionFailure = createConversionFailure("worker-failed", true, {
        reason: "scheduler-unavailable",
      });
      transition(entry, "failed");
      return;
    }

    const request: ConversionRequest = {
      outputByteLimit,
      input: { bytes, name: entry.name, probe },
      jobId: `run-${entry.id}`,
      schemaVersion: 1,
      settings,
    };
    let handle: ConversionJobHandle;
    try {
      handle = conversionScheduler.enqueue(request, ({ phase, progress }) => {
        if (isCurrent(entry) && entry.state === "converting") {
          entry.progress = Object.freeze({ phase, value: progress });
        }
      });
    } catch {
      entry.conversionFailure = createConversionFailure("invalid-settings", true);
      transition(entry, "failed");
      return;
    }
    activeConversion = { entryId: entry.id, handle };
    const outcome = await handle.outcome;
    if (activeConversion?.handle === handle) activeConversion = undefined;
    if (!isCurrentState(entry, "converting")) return;

    if (!outcome.ok) {
      entry.conversionFailure = outcome.failure;
      delete entry.progress;
      transition(entry, outcome.failure.code === "cancelled" ? "cancelled" : "failed");
      return;
    }
    const blob = new Blob([outcome.result.bytes], { type: outputMimeType(outcome.result.format) });
    entry.result = {
      blob,
      downloaded: false,
      durationMs: outcome.result.durationMs,
      format: outcome.result.format,
      height: outcome.result.height,
      name: outputFileName(entry.name, outcome.result.format),
      previewUrl: URL.createObjectURL(blob),
      settings,
      size: blob.size,
      width: outcome.result.width,
    };
    entry.progress = Object.freeze({ phase: "validating", value: 1 });
    transition(entry, "done");
  }

  function resetCompletedEntries(): void {
    entries = entries.map((entry) => {
      if (entry.state !== "done" || !entry.probe) return entry;
      for (const result of entryResults(entry)) URL.revokeObjectURL(result.previewUrl);
      return {
        file: entry.file,
        id: crypto.randomUUID(),
        name: entry.name,
        previewUrl: entry.previewUrl,
        probe: entry.probe,
        size: entry.size,
        state: "ready",
        ...(entry.gifFirstFrameNotice ? { gifFirstFrameNotice: true } : {}),
        ...(entry.warning ? { warning: entry.warning } : {}),
      };
    });
  }

  async function startConversion(): Promise<void> {
    if (
      batchRunning ||
      batchExportBusy ||
      dimensionError ||
      pdfSettingsError ||
      (readyCount === 0 && convertedCount === 0)
    ) {
      return;
    }
    batchExportState = "idle";
    if (readyCount === 0) resetCompletedEntries();
    const settings = snapshotSettings();
    const pdfSettings = nextBatchIncludesPdf
      ? Object.freeze({ dpi: Math.round(pdfDpi), pages: parsePdfPageRange(pdfPageRange) })
      : undefined;
    const pending: PendingConversion[] = entries
      .filter(({ state, probe }) => state === "ready" && probe !== undefined)
      .map(({ id }) => ({ entryId: id, pdf: pdfSettings, settings }));
    batchRunning = true;
    cancelBatchRequested = false;
    try {
      for (const item of pending) {
        if (cancelBatchRequested) break;
        const entry = entries.find(({ id }) => id === item.entryId);
        if (entry) await convertEntry(entry, item.settings, item.pdf);
      }
    } finally {
      activeConversion = undefined;
      batchRunning = false;
      cancelBatchRequested = false;
    }
  }

  function cancelConversion(): void {
    cancelBatchRequested = true;
    activeConversion?.handle.cancel();
  }

  function triggerDownload(href: string, name: string): void {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = name;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function downloadResult(entry: QueueEntry, result = entry.result): void {
    if (!result) return;
    triggerDownload(result.previewUrl, result.name);
    result.downloaded = true;
  }

  function markArtifactsDownloaded(
    artifacts: readonly BatchExportArtifact[],
    completed = artifacts.length,
  ): void {
    for (const artifact of artifacts.slice(0, completed)) {
      if (artifact.result) artifact.result.downloaded = true;
    }
  }

  function stopBatchExport(nextState: BatchExportUiState): void {
    const wasBusy = batchExportBusy;
    batchExportSequence += 1;
    activeArchiveExport?.cancel();
    activeArchiveExport = undefined;
    directoryExportController?.abort();
    directoryExportController = undefined;
    batchExportProgressCompleted = 0;
    batchExportProgressTotal = 0;
    if (wasBusy || nextState === "idle") batchExportState = nextState;
  }

  function cancelBatchExport(): void {
    stopBatchExport("cancelled");
  }

  async function saveBatchToDirectory(): Promise<void> {
    const picker = directoryPicker;
    const plan = batchExportPlan;
    if (!picker || plan.outputCount < 1 || batchExportBusy || batchRunning) return;
    const operation = (batchExportSequence += 1);
    let selection: ReturnType<DirectoryPicker>;
    try {
      // Invoke the picker synchronously inside the click activation.
      selection = picker({ mode: "readwrite" });
    } catch {
      batchExportState = "directory-error";
      return;
    }
    batchExportState = "writing";
    batchExportProgressCompleted = 0;
    batchExportProgressTotal = plan.artifacts.length;
    let directory: Awaited<ReturnType<DirectoryPicker>>;
    try {
      directory = await selection;
    } catch (error) {
      if (operation !== batchExportSequence) return;
      batchExportState = isAbortError(error) ? "cancelled" : "directory-error";
      return;
    }
    if (operation !== batchExportSequence) return;
    const controller = new AbortController();
    directoryExportController = controller;
    try {
      await writeBatchToDirectory(directory, plan.artifacts, controller.signal, ({ completed }) => {
        if (operation === batchExportSequence) batchExportProgressCompleted = completed;
      });
      if (operation !== batchExportSequence) return;
      markArtifactsDownloaded(plan.artifacts);
      batchExportState = "directory-complete";
    } catch (error) {
      if (operation !== batchExportSequence) return;
      if (error instanceof DirectoryExportError) {
        markArtifactsDownloaded(plan.artifacts, error.writtenArtifactCount);
        batchExportProgressCompleted = error.writtenArtifactCount;
        batchExportState = "directory-error";
      } else {
        batchExportState = isAbortError(error) ? "cancelled" : "directory-error";
      }
    } finally {
      if (operation === batchExportSequence) directoryExportController = undefined;
    }
  }

  async function downloadBatchArchive(): Promise<void> {
    const scheduler = archiveScheduler;
    const plan = batchExportPlan;
    if (
      !scheduler ||
      plan.outputCount < 1 ||
      !plan.archiveAllowed ||
      batchExportBusy ||
      batchRunning
    ) {
      return;
    }
    const operation = (batchExportSequence += 1);
    batchExportState = "archiving";
    batchExportProgressCompleted = 0;
    batchExportProgressTotal = plan.artifacts.length;
    let handle: ArchiveJobHandle;
    try {
      handle = scheduler.enqueue(
        `archive-${crypto.randomUUID()}`,
        {
          files: plan.artifacts.map(({ blob, name }) => ({ blob, name })),
          maxBytes: WEB_V1_DESKTOP_LIMITS.maxFallbackArchiveBytes,
        },
        ({ completed }) => {
          if (operation === batchExportSequence) batchExportProgressCompleted = completed;
        },
      );
    } catch {
      batchExportState = "archive-error";
      return;
    }
    activeArchiveExport = handle;
    const outcome = await handle.outcome;
    if (operation !== batchExportSequence) return;
    activeArchiveExport = undefined;
    if (!outcome.ok) {
      batchExportState = outcome.reason === "cancelled" ? "cancelled" : "archive-error";
      return;
    }
    const archiveUrl = URL.createObjectURL(outcome.archive);
    triggerDownload(archiveUrl, BATCH_ARCHIVE_FILE_NAME);
    window.setTimeout(() => URL.revokeObjectURL(archiveUrl), 1_000);
    markArtifactsDownloaded(plan.artifacts);
    batchExportProgressCompleted = plan.artifacts.length;
    batchExportState = "archive-complete";
  }

  function openPreview(entry: QueueEntry, result = entry.result): void {
    if (!result) return;
    previewEntry = entry;
    previewResult = result;
    previewDialog.showModal();
  }

  function closePreview(): void {
    previewDialog.close();
    previewEntry = undefined;
    previewResult = undefined;
  }

  function handlePreviewClose(): void {
    previewEntry = undefined;
    previewResult = undefined;
  }

  function handleConvertAction(): void {
    if (batchExportBusy) return;
    if (batchRunning) cancelConversion();
    else void startConversion();
  }

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (undownloadedCount < 1 && !batchExportBusy && !batchRunning) return;
    event.preventDefault();
    event.returnValue = "";
  }

  onMount(() => {
    const queryLocale = new URL(window.location.href).searchParams.get("lang");
    const savedLocale = readPreference(WEB_LOCALE_PREFERENCE_KEY);
    locale =
      queryLocale === "en" || queryLocale === "zh"
        ? queryLocale
        : savedLocale === "en" || savedLocale === "zh"
          ? savedLocale
          : navigator.languages.some((language) => language.toLowerCase().startsWith("zh"))
            ? "zh"
            : "en";
    const savedTheme = readPreference(WEB_THEME_PREFERENCE_KEY);
    theme =
      savedTheme === "dark" || savedTheme === "light"
        ? savedTheme
        : matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    const savedConversionPreferences = loadWebConversionPreferences(localStorage);
    outputFormat = savedConversionPreferences.outputFormat;
    lossless = savedConversionPreferences.lossless;
    quality = savedConversionPreferences.quality;
    resizeMode = savedConversionPreferences.resizeMode;
    resizeWidth = savedConversionPreferences.resizeWidth;
    resizeHeight = savedConversionPreferences.resizeHeight;
    jpegBackground = savedConversionPreferences.jpegBackground;
    pdfPageRange = savedConversionPreferences.pdfPageRange;
    pdfDpi = savedConversionPreferences.pdfDpi;
    preferencesReady = true;
    applyDocumentPreferences();
    rasterConversionScheduler = new SerialConversionScheduler({
      workerFactory: () =>
        new Worker(new URL("./lib/raster-codec.worker.ts", import.meta.url), { type: "module" }),
    });
    svgConversionScheduler = new SerialConversionScheduler({
      workerFactory: () =>
        new Worker(new URL("./lib/svg-codec.worker.ts", import.meta.url), { type: "module" }),
    });
    pdfConversionScheduler = new PdfConversionScheduler({
      workerFactory: () =>
        new Worker(new URL("./lib/pdf-codec.worker.ts", import.meta.url), { type: "module" }),
    });
    archiveScheduler = new ArchiveScheduler({
      workerFactory: () =>
        new Worker(new URL("./lib/archive.worker.ts", import.meta.url), { type: "module" }),
    });
    directoryPicker = directoryPickerFromWindow(window);
    directoryExportSupported = directoryPicker !== undefined;
    isOnline = navigator.onLine;
    const handleOnline = (): void => {
      isOnline = true;
    };
    const handleOffline = (): void => {
      isOnline = false;
    };
    const handleBeforeInstallPrompt = (event: Event): void => {
      event.preventDefault();
      installPrompt = event as BeforeInstallPromptEvent;
    };
    const handleAppInstalled = (): void => {
      installPrompt = undefined;
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    pwaRegistrationAllowed = true;
    void registerPwa();
    window.addEventListener("paste", handlePaste);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      pwaRegistrationAllowed = false;
      pwaManager?.dispose();
      rasterConversionScheduler?.dispose();
      svgConversionScheduler?.dispose();
      pdfConversionScheduler?.dispose();
      stopBatchExport("idle");
      archiveScheduler?.dispose();
      for (const controller of probeControllers.values()) controller.abort();
      for (const entry of entries) disposeEntry(entry);
    };
  });

  $effect(() => {
    if (outputFormat === "png") lossless = true;
    if (outputFormat === "jpeg") lossless = false;
  });

  $effect(() => {
    if (!preferencesReady) return;
    const preferences = {
      jpegBackground,
      lossless,
      outputFormat,
      pdfDpi,
      pdfPageRange,
      quality,
      resizeHeight,
      resizeMode,
      resizeWidth,
      schemaVersion: 1,
    } as const;
    if (conversionPersistenceBlocked) {
      const defaults = DEFAULT_WEB_CONVERSION_PREFERENCES;
      if (
        preferences.jpegBackground === defaults.jpegBackground &&
        preferences.lossless === defaults.lossless &&
        preferences.outputFormat === defaults.outputFormat &&
        preferences.pdfDpi === defaults.pdfDpi &&
        preferences.pdfPageRange === defaults.pdfPageRange &&
        preferences.quality === defaults.quality &&
        preferences.resizeHeight === defaults.resizeHeight &&
        preferences.resizeMode === defaults.resizeMode &&
        preferences.resizeWidth === defaults.resizeWidth
      ) {
        return;
      }
      conversionPersistenceBlocked = false;
    }
    saveWebConversionPreferences(localStorage, preferences);
  });
</script>

<a class="skip-link" href="#main-content">{locale === "zh" ? "跳到主要内容" : "Skip to content"}</a>
<p class="sr-only" aria-live="polite">
  {entries.length}
  {copy.queue.imported}; {readyCount}
  {copy.rail.ready}; {convertedCount}
  {copy.rail.converted}; {activeCount}
  {#if queueByteReduction}
    ; {copy.rail.outputReduction}:
    {queueByteReduction.measurement.savedBytes > 0
      ? formatBytes(queueByteReduction.measurement.savedBytes)
      : copy.rail.noNetReduction}
  {/if}
  {batchRunning ? copy.states.converting : activeCount > 0 ? copy.states.probing : copy.rail.ready}
</p>

<div class="web-app-shell" id="top">
  <Header {copy} {locale} {theme} onSetLocale={setLocale} onToggleTheme={toggleTheme} />

  <nav class="stepper" aria-label={copy.intro.eyebrow}>
    <a
      href="#sl-import"
      class="step"
      class:done={entries.length > 0}
      aria-current={entries.length > 0 ? undefined : "step"}
    >
      <span class="step-index" aria-hidden="true"
        >{#if entries.length > 0}<Check size={13} />{:else}1{/if}</span
      >
      <span class="step-label">{copy.drop.title}</span>
    </a>
    <a
      href="#sl-settings"
      class="step"
      class:done={batchRunning || convertedCount > 0}
      aria-current={entries.length > 0 && !batchRunning && convertedCount === 0
        ? "step"
        : undefined}
    >
      <span class="step-index" aria-hidden="true"
        >{#if batchRunning || convertedCount > 0}<Check size={13} />{:else}2{/if}</span
      >
      <span class="step-label">{copy.settings.title}</span>
    </a>
    <a
      href="#sl-convert"
      class="step"
      class:done={convertedCount > 0 && !batchRunning}
      aria-current={batchRunning ? "step" : undefined}
    >
      <span class="step-index" aria-hidden="true">3</span>
      <span class="step-label">{copy.settings.convert}</span>
    </a>
  </nav>

  <main id="main-content" class="v-softlab-main" tabindex="-1">
    <h1 class="sr-only">{copy.intro.title}</h1>
    <section id="sl-import" class="v-softlab-section v-softlab-import" use:reveal>
      <Dropzone {copy} {notices} onFiles={addFiles} />
    </section>
    <div class="v-softlab-queue-rail">
      <QueueList
        {copy}
        {numberLocale}
        {entries}
        {totalBytes}
        onOpenClear={openClearDialog}
        onCancelProbe={cancelProbe}
        onRetry={retryProbe}
        onPreview={openPreview}
        onDownload={downloadResult}
        onRemove={removeEntry}
      />
    </div>
    <section
      id="sl-settings"
      class="v-softlab-section v-softlab-settings"
      use:reveal={{ delay: 40 }}
    >
      <SettingsPanel
        {copy}
        {batchRunning}
        {dimensionError}
        {hasPdfEntries}
        {outputFormats}
        {pdfDpiError}
        {pdfPageError}
        {pdfSettingsError}
        bind:outputFormat
        bind:lossless
        bind:quality
        bind:resizeMode
        bind:resizeWidth
        bind:resizeHeight
        bind:jpegBackground
        bind:pdfPageRange
        bind:pdfDpi
      />
    </section>
    <section id="sl-convert" class="v-softlab-section v-softlab-convert" use:reveal={{ delay: 80 }}>
      <ConvertDock
        {copy}
        {batchRunning}
        exportBusy={batchExportBusy}
        {readyCount}
        {convertedCount}
        dimensionError={dimensionError || pdfSettingsError}
        onAction={handleConvertAction}
      />
      {#if showBatchExport}
        <BatchExportPanel
          {copy}
          {numberLocale}
          plan={batchExportPlan}
          directorySupported={directoryExportSupported}
          {batchRunning}
          state={batchExportState}
          progressCompleted={batchExportProgressCompleted}
          progressTotal={batchExportProgressTotal}
          onSaveDirectory={saveBatchToDirectory}
          onDownloadArchive={downloadBatchArchive}
          onCancel={cancelBatchExport}
        />
      {/if}
    </section>
    <section
      class="v-softlab-section v-softlab-stats"
      aria-label={copy.rail.title}
      use:reveal={{ delay: 110 }}
    >
      <StatsPanel
        {copy}
        importedCount={entries.length}
        {checkedCount}
        {convertedCount}
        {numberLocale}
        byteReduction={queueByteReduction}
      />
    </section>
    <section class="v-softlab-section v-softlab-pwa" use:reveal={{ delay: 130 }}>
      <PwaPanel
        canInstall={installPrompt !== undefined}
        {copy}
        {isOnline}
        status={pwaStatus}
        onCheckUpdate={checkForPwaUpdate}
        onClearData={openLocalDataDialog}
        onInstall={() => void installWebApp()}
        onUpdate={() => void activatePwaUpdate()}
      />
    </section>
  </main>

  <SiteFooter {copy} {locale} />
</div>

<dialog
  class="clear-dialog"
  bind:this={clearDialog}
  aria-labelledby="clear-dialog-title"
  aria-describedby="clear-dialog-description"
>
  <form method="dialog">
    <div class="dialog-icon"><Trash2 size={20} aria-hidden="true" /></div>
    <h2 id="clear-dialog-title">{copy.dialog.title}</h2>
    <p id="clear-dialog-description">{copy.dialog.body}</p>
    <div class="dialog-actions">
      <button type="submit" value="cancel">{copy.actions.close}</button>
      <button class="danger-button" type="submit" value="confirm" onclick={clearQueue}
        >{copy.actions.confirmClear}</button
      >
    </div>
  </form>
</dialog>

<dialog
  class="clear-dialog"
  bind:this={localDataDialog}
  aria-labelledby="local-data-dialog-title"
  aria-describedby="local-data-dialog-description"
>
  <form method="dialog">
    <div class="dialog-icon"><Trash2 size={20} aria-hidden="true" /></div>
    <h2 id="local-data-dialog-title">{copy.pwaDialog.title}</h2>
    <p id="local-data-dialog-description">{copy.pwaDialog.body}</p>
    {#if localDataClearError}
      <p class="dialog-error" role="status" aria-live="polite">{copy.pwaDialog.error}</p>
    {/if}
    <div class="dialog-actions">
      <button type="submit" value="cancel" disabled={localDataClearing}
        >{copy.pwaDialog.cancel}</button
      >
      <button
        class="danger-button"
        type="button"
        disabled={localDataClearing}
        onclick={() => void clearLocalData()}
      >
        {localDataClearing ? copy.pwaDialog.working : copy.pwaDialog.confirm}
      </button>
    </div>
  </form>
</dialog>

<dialog
  class="preview-dialog"
  bind:this={previewDialog}
  aria-labelledby="preview-title"
  onclose={handlePreviewClose}
>
  {#if previewEntry && previewResult && previewEntry.probe}
    <div class="preview-shell">
      <div class="preview-heading">
        <div>
          <p class="section-label">RESULT / VERIFIED</p>
          <h2 id="preview-title">{copy.preview.title}</h2>
        </div>
        <button type="button" aria-label={copy.actions.closePreview} onclick={closePreview}
          ><X size={19} aria-hidden="true" /></button
        >
      </div>
      <div class:pdf-only={previewEntry.probe.format === "pdf"} class="preview-grid">
        {#if previewEntry.probe.format !== "pdf"}
          <figure>
            <div class="preview-stage checkerboard">
              <img
                src={previewEntry.previewUrl}
                alt={`${copy.preview.original}: ${previewEntry.name}`}
                width={previewEntry.probe.width}
                height={previewEntry.probe.height}
              />
            </div>
            <figcaption>
              <strong>{copy.preview.original}</strong>
              <span>{formatDimensions(previewEntry)} · {formatBytes(previewEntry.size)}</span>
            </figcaption>
          </figure>
        {/if}
        <figure>
          <div class="preview-stage checkerboard">
            <img
              src={previewResult.previewUrl}
              alt={`${previewEntry.probe.format === "pdf" ? copy.preview.renderedPage : copy.preview.converted}: ${previewResult.name}`}
              width={previewResult.width}
              height={previewResult.height}
            />
          </div>
          <figcaption>
            <strong
              >{previewEntry.probe.format === "pdf"
                ? `${copy.preview.renderedPage} ${previewResult.pageNumber ?? ""}`
                : copy.preview.converted}</strong
            >
            <span>{formatOutputDimensions(previewResult)} · {formatBytes(previewResult.size)}</span>
          </figcaption>
        </figure>
      </div>
      <div class="preview-summary">
        <span>
          {#if previewEntry.probe.format === "pdf"}
            {copy.queue.pageLabel.replace(
              "{page}",
              new Intl.NumberFormat(numberLocale).format(previewResult.pageNumber ?? 1),
            )}
          {:else}
            {resultDelta(previewEntry)}
          {/if}
        </span>
        <span>{copy.preview.duration} {formatDuration(previewResult.durationMs)}</span>
        <button type="button" onclick={() => downloadResult(previewEntry!, previewResult)}
          ><Download size={17} aria-hidden="true" />{copy.actions.download}</button
        >
      </div>
    </div>
  {/if}
</dialog>
