<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import {
    CapabilityRegistry,
    PDF_MAX_DPI,
    PDF_MIN_DPI,
    WEB_001B_RASTER_CAPABILITIES,
    WEB_006_SVG_CAPABILITIES,
    WEB_007_PDF_CAPABILITIES,
    WEB_V1_DESKTOP_LIMITS,
    assertJobTransition,
    createConversionFailure,
    parsePdfPageRange,
    type ConversionRequest,
    type ConversionSettings,
    type PdfConversionRequest,
    type RasterOutputFormat,
  } from "@imgconvert/conversion-contract";
  import {
    PdfConversionScheduler,
    SerialConversionScheduler,
    outputFileName,
    outputMimeType,
    pdfPageOutputFileName,
    type ConversionJobHandle,
    type PdfConversionJobHandle,
  } from "@imgconvert/web-image-engine";
  import {
    ArchiveScheduler,
    BATCH_ARCHIVE_FILE_NAME,
    admitFiles,
    createBatchExportPlan,
    formatMismatch,
    isAbortError,
    normalizeProbeFailure,
    probeImageFile,
    remainingQueueOutputBytes,
    type ArchiveJobHandle,
    type BatchExportArtifact,
    type BatchExportUiState,
    type ImportQueueState,
    type QueueConversionResult,
    type QueueEntry,
    type QueueFailure,
  } from "@imgconvert/web-conversion-runtime";
  import {
    measureComparableRasterReduction,
    summarizeComparableRasterReductions,
  } from "@imgconvert/environmental-impact";
  import ImpactDetails from "../../src/workbench/ImpactDetails.svelte";
  import { browser } from "#imports";
  import { onMount, tick } from "svelte";

  import {
    clearExtensionPreferences,
    loadExtensionPreferences,
    saveExtensionPreferences,
  } from "../../src/preferences/storage";
  import {
    systemDefaultPreferences,
    type ExtensionLocale,
    type ExtensionPreferences,
    type ExtensionTheme,
  } from "../../src/preferences/schema";
  import {
    createArchiveWorker,
    createPdfWorker,
    createRasterWorker,
    createSvgWorker,
  } from "../../src/runtime/worker-factories";
  import { workbenchTranslations } from "../../src/workbench/copy";
  import { nextConversionIncludesPdf } from "../../src/workbench/pdf-settings";
  import type {
    PendingImageImport,
    PendingRemoteImageImport,
  } from "../../src/web-import/descriptor";
  import {
    disposeWebImportPermissionLeaseClient,
    registerWebImportPermissionLeaseClient,
    releaseWebImportPermission,
    requestWebImportPermission,
    type RegisteredWebImportPermissionLease,
  } from "../../src/web-import/permission-lease-client";
  import { permissionLeaseIdentity } from "../../src/web-import/permission-lease-protocol";
  import { isPendingImportStorageKey } from "../../src/web-import/pending-storage";
  import {
    CLAIM_PENDING_IMPORT,
    validateClaimPendingImportResponse,
  } from "../../src/web-import/protocol";
  import {
    RemoteImageFetchError,
    fetchRemoteImage,
    type RemoteImageFetchErrorCode,
  } from "../../src/web-import/remote-fetch";

  interface ActiveConversion {
    readonly entryId: string;
    readonly handle: Pick<ConversionJobHandle | PdfConversionJobHandle, "cancel">;
  }

  interface PendingConversion {
    readonly entryId: string;
    readonly pdf: Readonly<{ dpi: number; pages: readonly number[] }> | undefined;
    readonly settings: ConversionSettings;
  }

  interface AdmissionNotice {
    readonly failure: QueueFailure;
    readonly id: string;
    readonly name: string;
  }

  type WebImportErrorCode =
    | RemoteImageFetchErrorCode
    | "permission-check-failed"
    | "permission-cleanup-failed"
    | "permission-request-failed"
    | "queue-rejected";

  type WebImportPhase =
    | "checking"
    | "cleanup-failed"
    | "denied"
    | "failed"
    | "fetching"
    | "queued"
    | "ready"
    | "requesting";

  const initialPreferences = systemDefaultPreferences(
    navigator.languages,
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const surface =
    new URL(location.href).searchParams.get("surface") === "side-panel" ? "side-panel" : "full";
  const fullWorkspaceUrl = browser.runtime.getURL("/converter.html?surface=full");
  const websiteUrl = "https://imgconvert.web.casa/";
  const desktopDownloadUrl = `${websiteUrl}#download`;
  const repositoryUrl = "https://github.com/web-casa/ImgConvert";
  const conversionCapabilities = new CapabilityRegistry([
    WEB_001B_RASTER_CAPABILITIES,
    WEB_006_SVG_CAPABILITIES,
    WEB_007_PDF_CAPABILITIES,
  ]);
  const outputFormats = WEB_001B_RASTER_CAPABILITIES.inputs[0]?.outputs ?? [];
  const queueThumbnailMaxPixels = (16 * 1024 * 1024) / 4;
  const probeControllers = new Map<string, AbortController>();

  let locale = $state<ExtensionLocale>(initialPreferences.locale);
  let theme = $state<ExtensionTheme>(initialPreferences.theme);
  let outputFormat = $state<RasterOutputFormat>(initialPreferences.outputFormat);
  let lossless = $state(initialPreferences.lossless);
  let quality = $state(initialPreferences.quality);
  let resizeMode = $state<"custom" | "original">(initialPreferences.resizeMode);
  let resizeWidth = $state(initialPreferences.resizeWidth);
  let resizeHeight = $state(initialPreferences.resizeHeight);
  let jpegBackground = $state(initialPreferences.jpegBackground);
  let pdfPageRange = $state(initialPreferences.pdfPageRange);
  let pdfDpi = $state(initialPreferences.pdfDpi);
  let entries = $state<QueueEntry[]>([]);
  let notices = $state<AdmissionNotice[]>([]);
  let batchRunning = $state(false);
  let batchExportState = $state<BatchExportUiState>("idle");
  let batchExportProgressCompleted = $state(0);
  let batchExportProgressTotal = $state(0);
  let preferenceStatus = $state<"loading" | "saved" | "session-only">("loading");
  let preferencesReady = $state(false);
  let resetError = $state(false);
  let pendingWebImport = $state<PendingImageImport>();
  let webImportError = $state<WebImportErrorCode>();
  let webImportPhase = $state<WebImportPhase>("checking");
  let webImportPermissionPreexisting = $state<boolean>();
  let webImportReceivedBytes = $state(0);
  let webImportClaimError = $state(false);
  let probePumpRunning = false;
  let cancelBatchRequested = false;
  let batchExportSequence = 0;
  let rasterConversionScheduler: SerialConversionScheduler | undefined;
  let svgConversionScheduler: SerialConversionScheduler | undefined;
  let pdfConversionScheduler: PdfConversionScheduler | undefined;
  let archiveScheduler: ArchiveScheduler | undefined;
  let activeConversion: ActiveConversion | undefined;
  let activeArchiveExport: ArchiveJobHandle | undefined;
  let webImportController: AbortController | undefined;
  let webImportPermissionLease: RegisteredWebImportPermissionLease | undefined;
  let webImportClaimRunning = false;
  let webImportClaimAgain = false;
  let workbenchMounted = false;
  let clearDialog: HTMLDialogElement;
  let resetDialog: HTMLDialogElement;
  let previewDialog: HTMLDialogElement;
  let previewEntry = $state<QueueEntry>();
  let previewResult = $state<QueueConversionResult>();
  let fileInput: HTMLInputElement;

  const copy = $derived(workbenchTranslations[locale]);
  const docsUrl = $derived(`${websiteUrl}${locale === "zh" ? "docs/" : "en/docs/"}`);
  const privacyUrl = $derived(`${websiteUrl}${locale === "zh" ? "privacy/" : "en/privacy/"}`);
  const footerLinks = $derived([
    { href: websiteUrl, key: "website", label: copy.footer.website },
    { href: docsUrl, key: "docs", label: copy.footer.docs },
    { href: privacyUrl, key: "privacy", label: copy.footer.privacy },
    { href: desktopDownloadUrl, key: "desktop-download", label: copy.footer.desktopDownload },
    { href: repositoryUrl, key: "github", label: copy.footer.github },
  ]);
  const numberLocale = $derived(locale === "zh" ? "zh-CN" : "en-US");
  const queueByteReduction = $derived(summarizeComparableRasterReductions(entries));
  const totalBytes = $derived(entries.reduce((total, entry) => total + entry.size, 0));
  const readyCount = $derived(entries.filter(({ state }) => state === "ready").length);
  const convertedCount = $derived(entries.filter(({ state }) => state === "done").length);
  const activeCount = $derived(
    entries.filter(
      ({ state }) => state === "queued" || state === "probing" || state === "converting",
    ).length,
  );
  const undownloadedCount = $derived(
    entries.reduce(
      (count, entry) => count + entryResults(entry).filter(({ downloaded }) => !downloaded).length,
      0,
    ),
  );
  const batchExportPlan = $derived.by(() => createBatchExportPlan(entries));
  const batchExportBusy = $derived(batchExportState === "archiving");
  const showBatchExport = $derived(
    batchExportPlan.outputCount > 1 ||
      (batchExportPlan.outputCount > 0 && batchExportPlan.failureCount > 0),
  );
  const hasPdfEntries = $derived(
    entries.some(({ probe, state }) => probe?.format === "pdf" && state !== "failed"),
  );
  const nextConversionHasPdf = $derived(nextConversionIncludesPdf(entries));
  const dimensionError = $derived(
    resizeMode === "custom" &&
      (!Number.isSafeInteger(resizeWidth) ||
        !Number.isSafeInteger(resizeHeight) ||
        resizeWidth < 1 ||
        resizeHeight < 1 ||
        resizeWidth * resizeHeight > WEB_V1_DESKTOP_LIMITS.maxRuntimePixels),
  );
  const pdfDpiError = $derived(
    nextConversionHasPdf &&
      (!Number.isSafeInteger(pdfDpi) || pdfDpi < PDF_MIN_DPI || pdfDpi > PDF_MAX_DPI),
  );
  const pdfPageError = $derived.by(() => {
    if (!nextConversionHasPdf) return false;
    try {
      parsePdfPageRange(pdfPageRange);
      return false;
    } catch {
      return true;
    }
  });
  const settingsError = $derived(dimensionError || pdfDpiError || pdfPageError);

  function preferenceSnapshot(): ExtensionPreferences {
    return {
      jpegBackground,
      locale,
      lossless: outputFormat === "png" || (outputFormat !== "jpeg" && lossless),
      outputFormat,
      pdfDpi: Math.round(pdfDpi),
      pdfPageRange,
      quality: Math.round(quality),
      resizeHeight: Math.round(resizeHeight),
      resizeMode,
      resizeWidth: Math.round(resizeWidth),
      schemaVersion: 1,
      theme,
    };
  }

  function applyPreferences(preferences: ExtensionPreferences): void {
    locale = preferences.locale;
    theme = preferences.theme;
    outputFormat = preferences.outputFormat;
    lossless = preferences.lossless;
    quality = preferences.quality;
    resizeMode = preferences.resizeMode;
    resizeWidth = preferences.resizeWidth;
    resizeHeight = preferences.resizeHeight;
    jpegBackground = preferences.jpegBackground;
    pdfPageRange = preferences.pdfPageRange;
    pdfDpi = preferences.pdfDpi;
    applyDocumentPreferences();
  }

  function applyDocumentPreferences(): void {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.title =
      locale === "zh" ? "ImgConvert — 浏览器扩展工作台" : "ImgConvert — Extension Workbench";
  }

  async function persistPreferences(): Promise<void> {
    preferenceStatus = (await saveExtensionPreferences(preferenceSnapshot()))
      ? "saved"
      : "session-only";
  }

  function queuePreferenceSave(): void {
    queueMicrotask(() => void persistPreferences());
  }

  function toggleLocale(): void {
    locale = locale === "zh" ? "en" : "zh";
    applyDocumentPreferences();
    void persistPreferences();
  }

  function toggleTheme(): void {
    theme = theme === "light" ? "dark" : "light";
    applyDocumentPreferences();
    void persistPreferences();
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

  function canRenderQueueThumbnail(entry: QueueEntry): boolean {
    if (entry.state === "done" && entry.result) {
      return entry.result.width * entry.result.height <= queueThumbnailMaxPixels;
    }
    return (
      entry.probe !== undefined &&
      entry.probe.format !== "pdf" &&
      entry.probe.width * entry.probe.height <= queueThumbnailMaxPixels
    );
  }

  function queueThumbnailLabel(entry: QueueEntry): string {
    if (entry.result) return outputLabel(entry.result.format);
    return entry.probe?.format === "pdf" ? "PDF" : "IMG";
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
            entry.warning = formatMismatch(entry.name, probe.format);
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
    if (!matchMedia("(max-width: 900px)").matches) return;
    document.querySelector<HTMLElement>(".queue-card")?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }

  function addFiles(files: readonly File[]): boolean {
    if (files.length === 0) return false;
    const admission = admitFiles(entries.length, totalBytes, files);
    notices = admission.rejected.slice(0, 4).map(({ file, failure }) => ({
      failure,
      id: crypto.randomUUID(),
      name: file.name,
    }));
    if (admission.accepted.length > 0) stopBatchExport("idle");
    for (const file of admission.accepted) entries.push(createQueueEntry(file));
    if (admission.accepted.length > 0) {
      void pumpProbeQueue();
      void revealQueueOnNarrowViewport();
    }
    return admission.accepted.length > 0;
  }

  function handleFileSelection(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    addFiles(Array.from(input.files ?? []));
    input.value = "";
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  function handlePaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length > 0) addFiles(files);
  }

  async function revealWebImport(): Promise<void> {
    await tick();
    const panel = document.querySelector<HTMLElement>(".web-import-panel");
    panel?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center",
    });
    panel?.focus({ preventScroll: true });
  }

  async function prepareWebImportPermission(descriptor: PendingRemoteImageImport): Promise<void> {
    disposeWebImportPermissionLeaseClient(webImportPermissionLease);
    webImportPermissionLease = undefined;
    webImportError = undefined;
    webImportPhase = "checking";
    webImportPermissionPreexisting = undefined;
    try {
      const currentWindow = await browser.windows.getCurrent();
      if (
        typeof currentWindow.id !== "number" ||
        !Number.isSafeInteger(currentWindow.id) ||
        currentWindow.id < 0
      ) {
        throw new Error("The extension page is not attached to a valid browser window");
      }
      const lease = await registerWebImportPermissionLeaseClient(
        (name) => browser.runtime.connect({ name }),
        permissionLeaseIdentity({
          nonce: descriptor.nonce,
          permissionPattern: descriptor.permissionPattern,
          windowId: currentWindow.id,
        }),
        () => {
          if (
            workbenchMounted &&
            pendingWebImport?.nonce === descriptor.nonce &&
            webImportPermissionLease?.identity.nonce === descriptor.nonce
          ) {
            webImportPermissionLease = undefined;
            webImportController?.abort();
            webImportError = "permission-check-failed";
            webImportPermissionPreexisting = undefined;
            webImportPhase = "failed";
          }
        },
      );
      if (!workbenchMounted || pendingWebImport?.nonce !== descriptor.nonce) {
        disposeWebImportPermissionLeaseClient(lease);
        return;
      }
      webImportPermissionLease = lease;
      webImportPermissionPreexisting = lease.permissionPreexisting;
      webImportPhase = "ready";
    } catch {
      if (!workbenchMounted || pendingWebImport?.nonce !== descriptor.nonce) return;
      webImportError = "permission-check-failed";
      webImportPhase = "failed";
    }
  }

  function applyPendingWebImport(descriptor: PendingImageImport): void {
    webImportController?.abort();
    disposeWebImportPermissionLeaseClient(webImportPermissionLease);
    webImportPermissionLease = undefined;
    pendingWebImport = descriptor;
    webImportError = undefined;
    webImportReceivedBytes = 0;
    webImportPermissionPreexisting = undefined;
    webImportPhase = descriptor.kind === "remote" ? "checking" : "ready";
    if (descriptor.kind === "remote") void prepareWebImportPermission(descriptor);
    void revealWebImport();
  }

  async function claimPendingWebImport(): Promise<void> {
    if (surface !== "side-panel") return;
    if (webImportClaimRunning) {
      webImportClaimAgain = true;
      return;
    }
    webImportClaimRunning = true;
    try {
      do {
        webImportClaimAgain = false;
        let rawResponse: unknown;
        try {
          const currentWindow = await browser.windows.getCurrent();
          if (
            typeof currentWindow.id !== "number" ||
            !Number.isSafeInteger(currentWindow.id) ||
            currentWindow.id < 0
          ) {
            throw new Error("The extension page is not attached to a valid browser window");
          }
          rawResponse = await browser.runtime.sendMessage({
            type: CLAIM_PENDING_IMPORT,
            windowId: currentWindow.id,
          });
        } catch {
          if (workbenchMounted) webImportClaimError = true;
          continue;
        }
        if (!workbenchMounted) return;
        const response = validateClaimPendingImportResponse(rawResponse);
        if (!response) {
          webImportClaimError = true;
          continue;
        }
        if (response.ok) {
          webImportClaimError = false;
          applyPendingWebImport(response.descriptor);
        } else if (response.error === "storage-error") {
          webImportClaimError = true;
        }
      } while (webImportClaimAgain);
    } finally {
      webImportClaimRunning = false;
      if (webImportClaimAgain && workbenchMounted) void claimPendingWebImport();
    }
  }

  function handleExtensionStorageChange(changes: Record<string, unknown>, areaName: string): void {
    if (
      surface === "side-panel" &&
      areaName === "session" &&
      Object.keys(changes).some(isPendingImportStorageKey)
    ) {
      void claimPendingWebImport();
    }
  }

  function dismissWebImport(): void {
    webImportController?.abort();
    disposeWebImportPermissionLeaseClient(webImportPermissionLease);
    webImportPermissionLease = undefined;
    pendingWebImport = undefined;
    webImportError = undefined;
    webImportClaimError = false;
    webImportPermissionPreexisting = undefined;
    webImportReceivedBytes = 0;
  }

  function chooseLocalFile(): void {
    dismissWebImport();
    fileInput.click();
  }

  async function retryPermissionCleanup(): Promise<void> {
    const descriptor = pendingWebImport;
    const lease = webImportPermissionLease;
    if (descriptor?.kind !== "remote" || lease?.identity.nonce !== descriptor.nonce) return;
    let released = false;
    try {
      released = (
        await releaseWebImportPermission(
          (message) => browser.runtime.sendMessage(message),
          lease.identity,
        )
      ).released;
    } catch {
      released = false;
    }
    if (!workbenchMounted || pendingWebImport?.nonce !== descriptor.nonce) return;
    if (released) {
      disposeWebImportPermissionLeaseClient(lease);
      if (webImportPermissionLease === lease) webImportPermissionLease = undefined;
      webImportError = undefined;
      await prepareWebImportPermission(descriptor);
    }
  }

  function retryWebImportPermission(): void {
    const descriptor = pendingWebImport;
    if (descriptor?.kind === "remote") void prepareWebImportPermission(descriptor);
  }

  async function authorizeAndImportWebImage(): Promise<void> {
    const descriptor = pendingWebImport;
    const permissionPreexisting = webImportPermissionPreexisting;
    const permissionLease = webImportPermissionLease;
    if (
      descriptor?.kind !== "remote" ||
      permissionPreexisting === undefined ||
      permissionLease?.identity.nonce !== descriptor.nonce ||
      webImportPhase === "fetching" ||
      webImportPhase === "requesting"
    ) {
      return;
    }

    webImportError = undefined;
    webImportPhase = "requesting";

    let granted = permissionPreexisting;
    if (!permissionPreexisting) {
      try {
        const response = await requestWebImportPermission(
          (message) => browser.runtime.sendMessage(message),
          permissionLease.identity,
        );
        if (!response.ok) throw new Error(response.error);
        granted = response.granted;
      } catch {
        if (pendingWebImport?.nonce === descriptor.nonce) {
          webImportError = "permission-request-failed";
          webImportPhase = "failed";
        }
        return;
      }
    }
    if (!granted) {
      if (pendingWebImport?.nonce === descriptor.nonce) webImportPhase = "denied";
      return;
    }

    if (!workbenchMounted || pendingWebImport?.nonce !== descriptor.nonce) {
      if (!permissionPreexisting) {
        try {
          await releaseWebImportPermission(
            (message) => browser.runtime.sendMessage(message),
            permissionLease.identity,
          );
        } catch {
          // The background lease recovers on Port disconnect or worker restart.
        }
        disposeWebImportPermissionLeaseClient(permissionLease);
      }
      return;
    }

    const controller = new AbortController();
    webImportController = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
    webImportReceivedBytes = 0;
    webImportPhase = "fetching";
    let fetchedFile: File | undefined;
    let fetchError: WebImportErrorCode | undefined;
    try {
      fetchedFile = await fetchRemoteImage(descriptor, {
        onProgress(receivedBytes) {
          if (pendingWebImport?.nonce === descriptor.nonce) {
            webImportReceivedBytes = receivedBytes;
          }
        },
        signal: controller.signal,
      });
    } catch (error) {
      fetchError = error instanceof RemoteImageFetchError ? error.code : "network-error";
    } finally {
      window.clearTimeout(timeoutId);
      if (webImportController === controller) webImportController = undefined;
    }

    let permissionReleased = true;
    if (!permissionPreexisting) {
      try {
        permissionReleased = (
          await releaseWebImportPermission(
            (message) => browser.runtime.sendMessage(message),
            permissionLease.identity,
          )
        ).released;
      } catch {
        permissionReleased = false;
      }
      if (permissionReleased) {
        disposeWebImportPermissionLeaseClient(permissionLease);
        if (webImportPermissionLease === permissionLease) webImportPermissionLease = undefined;
      }
    }
    if (!workbenchMounted || pendingWebImport?.nonce !== descriptor.nonce) return;
    if (!permissionReleased) {
      webImportError = "permission-cleanup-failed";
      webImportPhase = "cleanup-failed";
      return;
    }
    if (fetchError) {
      webImportError = fetchError;
      webImportPhase = "failed";
      return;
    }
    if (!fetchedFile || !addFiles([fetchedFile])) {
      webImportError = "queue-rejected";
      webImportPhase = "failed";
      return;
    }
    webImportPhase = "queued";
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

  function retryEntry(entry: QueueEntry): void {
    stopBatchExport("idle");
    if (entry.state === "cancelled") {
      entries = entries.map((candidate) =>
        candidate.id === entry.id
          ? {
              file: entry.file,
              id: crypto.randomUUID(),
              name: entry.name,
              previewUrl: entry.previewUrl,
              size: entry.size,
              state: "queued",
            }
          : candidate,
      );
      void pumpProbeQueue();
      return;
    }
    if (entry.state !== "failed") return;
    for (const result of entryResults(entry)) URL.revokeObjectURL(result.previewUrl);
    delete entry.failure;
    delete entry.conversionFailure;
    delete entry.probe;
    delete entry.progress;
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
    if (previewEntry?.id === entry.id && previewDialog.open) previewDialog.close();
    disposeEntry(entry);
    entries = entries.filter(({ id }) => id !== entry.id);
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

  function backgroundFromHex(value: string): ConversionSettings["background"] {
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value);
    return Object.freeze({
      blue: Number.parseInt(match?.[3] ?? "ff", 16),
      green: Number.parseInt(match?.[2] ?? "ff", 16),
      red: Number.parseInt(match?.[1] ?? "ff", 16),
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
      const scheduler = pdfConversionScheduler;
      if (!scheduler || !pdfSettings) {
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
        handle = scheduler.enqueue(
          request,
          ({ pageIndex, pageNumber, pageTotal, phase, progress }) => {
            if (isCurrentState(entry, "converting")) {
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

    const scheduler = probe.format === "svg" ? svgConversionScheduler : rasterConversionScheduler;
    if (!scheduler) {
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
      handle = scheduler.enqueue(request, ({ phase, progress }) => {
        if (isCurrentState(entry, "converting")) {
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
      !preferencesReady ||
      batchRunning ||
      batchExportBusy ||
      settingsError ||
      (readyCount === 0 && convertedCount === 0)
    ) {
      return;
    }
    stopBatchExport("idle");
    if (readyCount === 0) resetCompletedEntries();
    const settings = snapshotSettings();
    const pendingEntries = entries.filter(
      ({ state, probe }) => state === "ready" && probe !== undefined,
    );
    const pdf = pendingEntries.some(({ probe }) => probe?.format === "pdf")
      ? Object.freeze({ dpi: Math.round(pdfDpi), pages: parsePdfPageRange(pdfPageRange) })
      : undefined;
    const pending: PendingConversion[] = pendingEntries.map(({ id }) => ({
      entryId: id,
      pdf,
      settings,
    }));
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

  function handleConvertAction(): void {
    if (batchRunning) cancelConversion();
    else void startConversion();
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

  function stopBatchExport(nextState: BatchExportUiState): void {
    const wasBusy = batchExportBusy;
    batchExportSequence += 1;
    activeArchiveExport?.cancel();
    activeArchiveExport = undefined;
    batchExportProgressCompleted = 0;
    batchExportProgressTotal = 0;
    if (wasBusy || nextState === "idle") batchExportState = nextState;
  }

  function cancelBatchExport(): void {
    stopBatchExport("cancelled");
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

  function markArtifactsDownloaded(artifacts: readonly BatchExportArtifact[]): void {
    for (const artifact of artifacts) if (artifact.result) artifact.result.downloaded = true;
  }

  function openPreview(entry: QueueEntry, result = entry.result): void {
    if (!result) return;
    previewEntry = entry;
    previewResult = result;
    previewDialog.showModal();
  }

  function closePreview(): void {
    previewDialog.close();
  }

  function handlePreviewClose(): void {
    previewEntry = undefined;
    previewResult = undefined;
  }

  async function resetPreferences(): Promise<void> {
    resetError = false;
    const cleared = await clearExtensionPreferences();
    const defaults = systemDefaultPreferences(
      navigator.languages,
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
    applyPreferences(defaults);
    preferenceStatus = cleared ? "saved" : "session-only";
    if (cleared) resetDialog.close();
    else resetError = true;
  }

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    const hasUnfinishedWork = entries.some(({ state }) =>
      ["queued", "probing", "ready", "converting"].includes(state),
    );
    if (undownloadedCount < 1 && !hasUnfinishedWork && !batchExportBusy && !batchRunning) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${new Intl.NumberFormat(numberLocale).format(bytes)}\u00a0B`;
    const units = ["KiB", "MiB", "GiB"] as const;
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 }).format(value)}\u00a0${units[unit]}`;
  }

  function dimensions(entry: QueueEntry): string {
    if (!entry.probe) return "—";
    if (entry.probe.format === "pdf") return `PDF v${entry.probe.version}`;
    const formatter = new Intl.NumberFormat(numberLocale);
    return `${formatter.format(entry.probe.width)} × ${formatter.format(entry.probe.height)}`;
  }

  function resultDimensions(result: QueueConversionResult): string {
    const formatter = new Intl.NumberFormat(numberLocale);
    return `${formatter.format(result.width)} × ${formatter.format(result.height)}`;
  }

  function duration(milliseconds: number): string {
    const value = milliseconds < 1000 ? milliseconds : milliseconds / 1000;
    const unit = milliseconds < 1000 ? "ms" : "s";
    return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 }).format(value)}\u00a0${unit}`;
  }

  function outputLabel(format: RasterOutputFormat): string {
    return format === "jpeg" ? "JPEG" : format === "webp" ? "WebP" : format.toUpperCase();
  }

  function queueMessage(entry: QueueEntry): string {
    if (entry.failure) return copy.errors[entry.failure.code];
    if (entry.conversionFailure) return copy.conversionErrors[entry.conversionFailure.code];
    if (entry.gifFirstFrameNotice) return copy.warning.gif;
    if (entry.warning) {
      return copy.queue.mismatch
        .replace("{expected}", entry.warning.expected.toUpperCase())
        .replace("{actual}", entry.warning.actual.toUpperCase());
    }
    return copy.states[entry.state];
  }

  function archiveMessage(): string {
    if (!batchExportPlan.archiveAllowed) return copy.archive.blocked;
    if (batchExportState === "archiving") return copy.archive.preparing;
    if (batchExportState === "archive-complete") return copy.archive.complete;
    if (batchExportState === "archive-error") return copy.archive.error;
    if (batchExportState === "cancelled") return copy.archive.cancelled;
    return `${batchExportPlan.outputCount} · ${formatBytes(batchExportPlan.estimatedArchiveBytes)}`;
  }

  function webImportMessage(): string {
    if (webImportClaimError) return copy.webImport.claimError;
    if (!pendingWebImport) return "";
    if (pendingWebImport.kind === "blocked") {
      return copy.webImport.blocked[pendingWebImport.code];
    }
    if (webImportPhase === "checking") return copy.webImport.checking;
    if (webImportPhase === "requesting") return copy.webImport.requesting;
    if (webImportPhase === "fetching") {
      return copy.webImport.fetching.replace("{bytes}", formatBytes(webImportReceivedBytes));
    }
    if (webImportPhase === "queued") return copy.webImport.queued;
    if (webImportPhase === "denied") return copy.webImport.denied;
    if (webImportPhase === "cleanup-failed")
      return copy.webImport.errors["permission-cleanup-failed"];
    if (webImportError) return copy.webImport.errors[webImportError];
    return webImportPermissionPreexisting ? copy.webImport.alreadyAllowed : copy.webImport.ready;
  }

  onMount(() => {
    let mounted = true;
    workbenchMounted = true;
    rasterConversionScheduler = new SerialConversionScheduler({
      workerFactory: createRasterWorker,
    });
    svgConversionScheduler = new SerialConversionScheduler({ workerFactory: createSvgWorker });
    pdfConversionScheduler = new PdfConversionScheduler({ workerFactory: createPdfWorker });
    archiveScheduler = new ArchiveScheduler({ workerFactory: createArchiveWorker });
    applyDocumentPreferences();
    void (async () => {
      const loaded = await loadExtensionPreferences(initialPreferences);
      if (!mounted) return;
      applyPreferences(loaded.preferences);
      preferenceStatus = loaded.persistent ? "saved" : "session-only";
      preferencesReady = true;
    })();
    window.addEventListener("paste", handlePaste);
    window.addEventListener("beforeunload", handleBeforeUnload);
    if (surface === "side-panel") {
      browser.storage.onChanged.addListener(handleExtensionStorageChange);
      void claimPendingWebImport();
    }
    return () => {
      mounted = false;
      workbenchMounted = false;
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (surface === "side-panel") {
        browser.storage.onChanged.removeListener(handleExtensionStorageChange);
      }
      webImportController?.abort();
      disposeWebImportPermissionLeaseClient(webImportPermissionLease);
      webImportPermissionLease = undefined;
      rasterConversionScheduler?.dispose();
      svgConversionScheduler?.dispose();
      pdfConversionScheduler?.dispose();
      stopBatchExport("idle");
      archiveScheduler?.dispose();
      for (const controller of probeControllers.values()) controller.abort();
      for (const entry of entries) disposeEntry(entry);
      entries = [];
    };
  });

  $effect(() => {
    if (outputFormat === "png") lossless = true;
    if (outputFormat === "jpeg") lossless = false;
  });
</script>

<svelte:head>
  <meta name="theme-color" content={theme === "light" ? "#f8f5ed" : "#172019"} />
</svelte:head>

<div
  class="extension-shell"
  class:side-panel={surface === "side-panel"}
  data-surface={surface}
  data-theme={theme}
>
  <a class="skip-link" href="#workspace">{locale === "zh" ? "跳到工作台" : "Skip to workspace"}</a>
  <p class="sr-only" aria-live="polite">
    {entries.length}
    {copy.queue.imported}; {readyCount}
    {copy.states.ready}; {convertedCount}
    {copy.states.done}; {activeCount > 0 ? copy.states.converting : copy.states.ready}
  </p>

  <header class="app-header">
    <a
      class="brand"
      data-testid="external-link-brand"
      data-external-link
      href={websiteUrl}
      target="_blank"
      rel="noopener noreferrer"
      referrerpolicy="no-referrer"
      aria-label={`ImgConvert · ${copy.footer.website} · ${copy.footer.newTab}`}
      title={`${copy.footer.website} · ${copy.footer.newTab}`}
      translate="no"
    >
      <img src="/icon/48.png" alt="" width="32" height="32" fetchpriority="high" />
      <span>ImgConvert</span>
      <span class="brand-kind">{copy.header.badge}</span>
    </a>
    <div class="header-actions">
      {#if surface === "side-panel"}
        <a
          class="fullscreen-button"
          data-testid="open-full-workspace"
          href={fullWorkspaceUrl}
          target="_blank"
          title={copy.header.fullscreenHint}
          aria-label={copy.header.fullscreenHint}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path d="M8 3H3v5M16 3h5v5M8 21H3v-5m13 5h5v-5" /></svg
          ><span>{copy.header.fullscreen}</span>
        </a>
      {/if}
      <button
        class="text-button reset-button"
        type="button"
        disabled={!preferencesReady}
        onclick={() => resetDialog.showModal()}
      >
        {copy.header.reset}
      </button>
      <button
        class="text-button"
        type="button"
        data-testid="locale-button"
        disabled={!preferencesReady}
        onclick={toggleLocale}
        aria-label={copy.header.toggleLocale}
        >{surface === "side-panel"
          ? locale === "zh"
            ? "EN"
            : "中"
          : copy.header.toggleLocale}</button
      >
      <button
        class="icon-button"
        type="button"
        data-testid="theme-button"
        disabled={!preferencesReady}
        onclick={toggleTheme}
        aria-label={copy.header.theme}
        title={copy.header.theme}
      >
        {#if theme === "light"}
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><circle cx="12" cy="12" r="4" /><path
              d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19"
            /></svg
          >
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" /></svg
          >
        {/if}
      </button>
    </div>
  </header>

  <nav class="extension-stepper" aria-label={copy.intro.eyebrow}>
    <a class:done={entries.length > 0} class="extension-step" href="#import-panel">
      <span class="step-index">{entries.length > 0 ? "✓" : "1"}</span>
      <span>{copy.drop.title}</span>
    </a>
    <a class:done={convertedCount > 0} class="extension-step" href="#settings-panel">
      <span class="step-index">{convertedCount > 0 ? "✓" : "2"}</span>
      <span>{copy.settings.title}</span>
    </a>
    <a
      class:done={convertedCount > 0 && !batchRunning}
      class="extension-step"
      href="#convert-panel"
    >
      <span class="step-index">3</span>
      <span>{copy.actions.convert}</span>
    </a>
  </nav>

  <main id="workspace" class="workspace" tabindex="-1">
    <section class="intro" aria-labelledby="workbench-title">
      <div class="eyebrow"><span class="status-dot"></span>{copy.intro.eyebrow}</div>
      <h1 id="workbench-title">{copy.intro.title}</h1>
      <p class="lead">{copy.intro.lead}</p>
      <div class="privacy-line">{copy.intro.local}</div>
    </section>

    {#if pendingWebImport || webImportClaimError}
      <section
        class="web-import-panel"
        data-testid="web-import-panel"
        tabindex="-1"
        aria-labelledby="web-import-title"
        aria-live="polite"
      >
        <div class="web-import-mark" aria-hidden="true">↘</div>
        <div class="web-import-copy">
          <span>{copy.webImport.badge}</span>
          <h2 id="web-import-title">{copy.webImport.title}</h2>
          {#if pendingWebImport?.kind === "remote"}
            <p>
              <strong>{pendingWebImport.displayName}</strong>
              <span>{copy.webImport.source}: {pendingWebImport.sourceOrigin}</span>
            </p>
            <p>{copy.webImport.permission}</p>
          {:else if pendingWebImport?.kind === "blocked"}
            <p><strong>{pendingWebImport.sourceLabel}</strong></p>
          {/if}
          <small
            class:error={webImportPhase === "failed" || webImportPhase === "cleanup-failed"}
            data-testid="web-import-status"
            data-state={webImportPhase}>{webImportMessage()}</small
          >
        </div>
        <div class="web-import-actions">
          {#if webImportClaimError}
            <button type="button" onclick={() => void claimPendingWebImport()}
              >{copy.webImport.retry}</button
            >
          {:else if pendingWebImport?.kind === "blocked"}
            <button type="button" class="primary" onclick={chooseLocalFile}
              >{copy.webImport.chooseLocal}</button
            >
          {:else if pendingWebImport?.kind === "remote"}
            {#if webImportPhase === "cleanup-failed"}
              <button
                type="button"
                class="primary"
                data-testid="web-import-cleanup"
                onclick={() => void retryPermissionCleanup()}>{copy.webImport.retryCleanup}</button
              >
            {:else if webImportError === "permission-check-failed"}
              <button
                type="button"
                class="primary"
                data-testid="web-import-permission-retry"
                onclick={retryWebImportPermission}>{copy.webImport.retryPermission}</button
              >
            {:else if webImportPhase !== "queued"}
              <button
                type="button"
                class="primary"
                data-testid="web-import-authorize"
                disabled={webImportPermissionPreexisting === undefined ||
                  webImportPhase === "requesting" ||
                  webImportPhase === "fetching"}
                onclick={() => void authorizeAndImportWebImage()}>{copy.webImport.authorize}</button
              >
            {/if}
          {/if}
          <button type="button" data-testid="web-import-dismiss" onclick={dismissWebImport}
            >{copy.webImport.dismiss}</button
          >
        </div>
      </section>
    {/if}

    <div class="workbench-grid">
      <section id="import-panel" class="panel import-panel" aria-labelledby="import-title">
        <div class="panel-heading">
          <div>
            <span>01 / INPUT</span>
            <h2 id="import-title">{copy.drop.title}</h2>
          </div>
          <span class="format-pill" translate="no">8 INPUTS</span>
        </div>
        <label class="dropzone" ondrop={handleDrop} ondragover={(event) => event.preventDefault()}>
          <input
            class="file-input"
            bind:this={fileInput}
            type="file"
            name="images"
            accept=".jpg,.jpeg,.jfif,.png,.webp,.avif,.bmp,.gif,.svg,.pdf,image/jpeg,image/png,image/webp,image/avif,image/bmp,image/x-ms-bmp,image/gif,image/svg+xml,application/pdf"
            multiple
            data-testid="file-input"
            onchange={handleFileSelection}
          />
          <span class="drop-icon" aria-hidden="true"
            ><svg viewBox="0 0 24 24"
              ><path
                d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
              /></svg
            ></span
          >
          <span class="drop-copy"
            ><strong>{copy.drop.body}</strong><small>{copy.drop.hint}</small></span
          >
          <span class="select-button">{copy.actions.select}<span aria-hidden="true">→</span></span>
          <span class="format-row" translate="no">{copy.drop.formats}</span>
        </label>
        {#if notices.length > 0}
          <div class="notices" aria-live="polite">
            {#each notices as notice (notice.id)}
              <p><strong>{notice.name}</strong> · {copy.errors[notice.failure.code]}</p>
            {/each}
          </div>
        {/if}
      </section>

      <aside
        class="panel queue-card"
        class:has-impact={convertedCount > 0}
        aria-labelledby="queue-title"
      >
        <div class="panel-heading queue-heading">
          <div>
            <span>QUEUE / {entries.length}</span>
            <h2 id="queue-title">{copy.queue.title}</h2>
          </div>
          <div class="queue-tools">
            <span>{formatBytes(totalBytes)}</span><button
              type="button"
              disabled={entries.length === 0}
              onclick={() => clearDialog.showModal()}>{copy.actions.clear}</button
            >
          </div>
        </div>
        {#if entries.length === 0}
          <div class="queue-empty">
            <span aria-hidden="true"></span><strong>{copy.queue.empty}</strong>
            <p>{copy.queue.emptyBody}</p>
          </div>
        {:else}
          <ul class="queue-list">
            {#each entries as entry (entry.id)}
              <li
                class:has-error={entry.state === "failed"}
                class:has-result={entry.state === "done"}
                data-testid="queue-item"
              >
                <div class="thumbnail">
                  {#if entry.state === "done" && entry.result && canRenderQueueThumbnail(entry)}
                    <img
                      src={entry.result.previewUrl}
                      alt=""
                      width="64"
                      height="64"
                      loading="lazy"
                      decoding="async"
                      draggable="false"
                    />
                  {:else if entry.probe && entry.probe.format !== "pdf" && canRenderQueueThumbnail(entry)}
                    <img
                      src={entry.previewUrl}
                      alt=""
                      width="64"
                      height="64"
                      loading="lazy"
                      decoding="async"
                      draggable="false"
                    />
                  {:else}<span aria-hidden="true">{queueThumbnailLabel(entry)}</span>{/if}
                </div>
                <div class="file-detail">
                  <div class="file-title">
                    <strong title={entry.name}>{entry.name}</strong><span
                      data-testid="queue-state"
                      data-state={entry.state}>{copy.states[entry.state]}</span
                    >
                  </div>
                  <p>
                    {entry.result
                      ? `${outputLabel(entry.result.format)} · ${resultDimensions(entry.result)} · ${formatBytes(entry.result.size)}`
                      : `${entry.probe?.format.toUpperCase() ?? "IMG"} · ${dimensions(entry)} · ${formatBytes(entry.size)}`}
                  </p>
                  {#if entry.state === "converting" && entry.progress}
                    <div class="progress-row" role="status" aria-live="polite">
                      <span
                        >{copy.progress[entry.progress.phase]} · {Math.round(
                          entry.progress.value * 100,
                        )}%</span
                      >
                      <progress
                        max="100"
                        value={Math.round(entry.progress.value * 100)}
                        aria-label={copy.progress[entry.progress.phase]}
                      ></progress>
                    </div>
                  {:else}<small class:error={entry.state === "failed"}>{queueMessage(entry)}</small
                    >{/if}
                  {#if entry.probe?.format === "pdf" && entry.result}
                    <ul class="page-results">
                      {#each entryResults(entry) as result (result.pageNumber)}
                        <li>
                          <span
                            >{copy.queue.page.replace("{page}", String(result.pageNumber ?? 1))} · {formatBytes(
                              result.size,
                            )}</span
                          ><span
                            ><button type="button" onclick={() => openPreview(entry, result)}
                              >{copy.actions.preview}</button
                            ><button type="button" onclick={() => downloadResult(entry, result)}
                              >{copy.actions.download}</button
                            ></span
                          >
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
                <div class="item-actions">
                  {#if entry.state === "queued" || entry.state === "probing"}
                    <button
                      type="button"
                      aria-label={`${copy.actions.cancel}: ${entry.name}`}
                      onclick={() => cancelProbe(entry)}>{copy.actions.cancel}</button
                    >
                  {:else if entry.state === "failed" || entry.state === "cancelled"}
                    <button
                      type="button"
                      aria-label={`${copy.actions.retry}: ${entry.name}`}
                      onclick={() => retryEntry(entry)}>{copy.actions.retry}</button
                    >
                  {:else if entry.state === "done" && entry.result && entry.probe?.format !== "pdf"}
                    <button
                      type="button"
                      data-testid="preview-result"
                      aria-label={`${copy.actions.preview}: ${entry.name}`}
                      onclick={() => openPreview(entry)}>{copy.actions.preview}</button
                    >
                    <button
                      class="download-button"
                      type="button"
                      data-testid="download-result"
                      aria-label={`${copy.actions.download}: ${entry.result.name}`}
                      onclick={() => downloadResult(entry)}>{copy.actions.download}</button
                    >
                  {/if}
                  <button
                    type="button"
                    aria-label={`${copy.actions.remove}: ${entry.name}`}
                    onclick={() => removeEntry(entry)}>×</button
                  >
                </div>
                <div class="impact-row">
                  {#if entry.state === "done" && entry.result}
                    {#key entry.result}<ImpactDetails
                        measurement={measureComparableRasterReduction(entry)}
                        {numberLocale}
                        {formatBytes}
                      />{/key}
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
        {#if queueByteReduction}
          <section
            class="impact-batch"
            aria-label={locale === "zh" ? "批量环境情景" : "Batch environmental scenario"}
          >
            <p>
              {locale === "zh" ? "合资格结果" : "Eligible results"}: {queueByteReduction.resultCount}
            </p>
            {#key queueByteReduction}<ImpactDetails
                batch
                measurement={queueByteReduction.measurement}
                {numberLocale}
                {formatBytes}
                excludedCount={Math.max(0, convertedCount - queueByteReduction.resultCount)}
              />{/key}
          </section>
        {/if}
      </aside>

      <section id="settings-panel" class="panel settings-panel" aria-labelledby="settings-title">
        <div class="panel-heading">
          <div>
            <span>02 / OUTPUT</span>
            <h2 id="settings-title">{copy.settings.title}</h2>
          </div>
          <div class="settings-heading-actions">
            <button
              type="button"
              data-testid="reset-preferences"
              disabled={!preferencesReady}
              onclick={() => resetDialog.showModal()}>{copy.actions.reset}</button
            >
            <span class="format-pill">LOCAL</span>
          </div>
        </div>
        <fieldset disabled={batchRunning || !preferencesReady} onchange={queuePreferenceSave}>
          <legend class="sr-only">{copy.settings.title}</legend>
          <div class="field-group">
            <span class="field-label">{copy.settings.output}</span>
            <div class="format-cards">
              {#each outputFormats as format (format)}
                <label class:selected={outputFormat === format}
                  ><input
                    type="radio"
                    name="outputFormat"
                    value={format}
                    bind:group={outputFormat}
                  /><span>{outputLabel(format)}</span></label
                >
              {/each}
            </div>
          </div>
          {#if outputFormat === "webp" || outputFormat === "avif"}
            <label class="check-row"
              ><input type="checkbox" name="lossless" bind:checked={lossless} /><span
                >{copy.settings.lossless}</span
              ></label
            >
          {/if}
          {#if outputFormat !== "png" && !lossless}
            <div class="range-row">
              <label for="quality">{copy.settings.quality}</label><output for="quality"
                >{quality}</output
              ><input
                id="quality"
                type="range"
                name="quality"
                min="1"
                max="100"
                bind:value={quality}
              />
            </div>
          {/if}
          <div class="field-grid">
            <label
              >{copy.settings.resize}<select name="resizeMode" bind:value={resizeMode}
                ><option value="original">{copy.settings.original}</option><option value="custom"
                  >{copy.settings.custom}</option
                ></select
              ></label
            >
            {#if resizeMode === "custom"}
              <label
                >{copy.settings.width}<input
                  type="number"
                  name="resizeWidth"
                  min="1"
                  max="65535"
                  inputmode="numeric"
                  autocomplete="off"
                  aria-invalid={dimensionError}
                  aria-describedby={dimensionError ? "dimension-validation" : undefined}
                  bind:value={resizeWidth}
                /></label
              >
              <label
                >{copy.settings.height}<input
                  type="number"
                  name="resizeHeight"
                  min="1"
                  max="65535"
                  inputmode="numeric"
                  autocomplete="off"
                  aria-invalid={dimensionError}
                  aria-describedby={dimensionError ? "dimension-validation" : undefined}
                  bind:value={resizeHeight}
                /></label
              >
            {/if}
            {#if outputFormat === "jpeg"}
              <label
                >{copy.settings.background}<input
                  type="color"
                  name="jpegBackground"
                  bind:value={jpegBackground}
                /></label
              >
            {/if}
          </div>
          {#if dimensionError}<p
              id="dimension-validation"
              class="validation"
              role="status"
              aria-live="polite"
            >
              {copy.settings.dimensionsError}
            </p>{/if}
          {#if hasPdfEntries}
            <div class="pdf-settings">
              <strong>{copy.settings.pdf}</strong>
              <div class="field-grid two">
                <label
                  >{copy.settings.pages}<input
                    type="text"
                    name="pdfPages"
                    autocomplete="off"
                    spellcheck="false"
                    aria-invalid={pdfPageError}
                    aria-describedby={pdfPageError ? "pdf-validation" : undefined}
                    bind:value={pdfPageRange}
                  /></label
                >
                <label
                  >DPI<input
                    type="number"
                    name="pdfDpi"
                    min="72"
                    max="600"
                    inputmode="numeric"
                    autocomplete="off"
                    aria-invalid={pdfDpiError}
                    aria-describedby={pdfDpiError ? "pdf-validation" : undefined}
                    bind:value={pdfDpi}
                  /></label
                >
              </div>
              {#if pdfDpiError || pdfPageError}<p
                  id="pdf-validation"
                  class="validation"
                  role="status"
                  aria-live="polite"
                >
                  {copy.settings.pdfError}
                </p>{/if}
            </div>
          {/if}
          <div class="metadata-row">
            <span aria-hidden="true">✓</span><strong>{copy.settings.metadata}</strong><small
              >{copy.settings.hint}</small
            >
          </div>
        </fieldset>
      </section>

      <section id="convert-panel" class="convert-panel" aria-label={copy.actions.convert}>
        <button
          class:cancel={batchRunning}
          type="button"
          data-testid="convert-button"
          disabled={!batchRunning &&
            (!preferencesReady ||
              batchExportBusy ||
              settingsError ||
              (readyCount === 0 && convertedCount === 0))}
          onclick={handleConvertAction}
        >
          {batchRunning
            ? copy.actions.cancelConversion
            : readyCount === 0 && convertedCount > 0
              ? copy.actions.convertAgain
              : copy.actions.convert}<span aria-hidden="true">{batchRunning ? "■" : "→"}</span>
        </button>
        <p>{copy.settings.hint}</p>
        {#if showBatchExport}
          <div class="archive-row">
            <div>
              <strong>{copy.archive.title}</strong><span role="status" aria-live="polite"
                >{archiveMessage()}</span
              >
            </div>
            {#if batchExportBusy}
              <button type="button" onclick={cancelBatchExport}
                >{copy.actions.cancel}
                {batchExportProgressCompleted}/{batchExportProgressTotal}</button
              >
            {:else}
              <button
                type="button"
                data-testid="batch-download"
                disabled={!batchExportPlan.archiveAllowed || batchRunning}
                onclick={() => void downloadBatchArchive()}>{copy.actions.downloadZip}</button
              >
            {/if}
          </div>
        {/if}
      </section>
    </div>

    <section class="local-ledger" aria-label={copy.ledger.engine}>
      <div><span>{copy.ledger.engine}</span><strong>READY</strong></div>
      <div><span>{copy.ledger.session}</span><strong>RAM</strong></div>
      <div>
        <span
          >{preferenceStatus === "session-only"
            ? copy.ledger.storageError
            : copy.ledger.persisted}</span
        ><strong>LOCAL</strong>
      </div>
      <div><span>{copy.ledger.uploads}</span><strong class="green">NONE</strong></div>
    </section>
  </main>

  <footer class="app-footer">
    <div class="footer-identity">
      <a
        class="footer-wordmark"
        data-testid="external-link-footer-brand"
        data-external-link
        href={websiteUrl}
        target="_blank"
        rel="noopener noreferrer"
        referrerpolicy="no-referrer"
        aria-label={`ImgConvert · ${copy.footer.website} · ${copy.footer.newTab}`}
        translate="no">ImgConvert</a
      >
      <span>{copy.intro.local}</span>
    </div>
    <nav class="footer-links" aria-label={copy.footer.navigation}>
      {#each footerLinks as link (link.key)}
        <a
          data-testid={`external-link-${link.key}`}
          data-external-link
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          referrerpolicy="no-referrer"
          aria-label={`${link.label} · ${copy.footer.newTab}`}
          >{link.label}<svg viewBox="0 0 16 16" aria-hidden="true"
            ><path d="M5 11 11 5m-5 0h5v5" /></svg
          ></a
        >
      {/each}
    </nav>
    <span class="footer-platform">Chrome / Edge · MV3</span>
  </footer>
</div>

<dialog
  class="confirm-dialog"
  bind:this={clearDialog}
  aria-labelledby="clear-title"
  aria-describedby="clear-body"
>
  <form method="dialog">
    <span class="dialog-mark" aria-hidden="true">×</span>
    <h2 id="clear-title">{copy.dialog.clearTitle}</h2>
    <p id="clear-body">{copy.dialog.clearBody}</p>
    <div>
      <button type="submit" value="cancel">{copy.actions.cancel}</button><button
        class="danger"
        type="submit"
        value="confirm"
        onclick={clearQueue}>{copy.actions.confirmClear}</button
      >
    </div>
  </form>
</dialog>

<dialog
  class="confirm-dialog"
  bind:this={resetDialog}
  aria-labelledby="reset-title"
  aria-describedby="reset-body"
>
  <form method="dialog">
    <span class="dialog-mark" aria-hidden="true">↺</span>
    <h2 id="reset-title">{copy.dialog.resetTitle}</h2>
    <p id="reset-body">{copy.dialog.resetBody}</p>
    {#if resetError}<p class="validation" role="alert">{copy.dialog.resetError}</p>{/if}
    <div>
      <button type="submit" value="cancel">{copy.actions.cancel}</button><button
        class="danger"
        type="button"
        data-testid="confirm-reset"
        onclick={() => void resetPreferences()}>{copy.actions.reset}</button
      >
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
          <span>RESULT / VERIFIED</span>
          <h2 id="preview-title">{copy.preview.title}</h2>
        </div>
        <button type="button" aria-label={copy.actions.close} onclick={closePreview}>×</button>
      </div>
      <div class:pdf-only={previewEntry.probe.format === "pdf"} class="preview-grid">
        {#if previewEntry.probe.format !== "pdf"}
          <figure>
            <div class="preview-stage">
              <img
                src={previewEntry.previewUrl}
                alt={`${copy.preview.original}: ${previewEntry.name}`}
                width={previewEntry.probe.width}
                height={previewEntry.probe.height}
              />
            </div>
            <figcaption>
              <strong>{copy.preview.original}</strong><span
                >{dimensions(previewEntry)} · {formatBytes(previewEntry.size)}</span
              >
            </figcaption>
          </figure>
        {/if}
        <figure>
          <div class="preview-stage">
            <img
              src={previewResult.previewUrl}
              alt={`${copy.preview.converted}: ${previewResult.name}`}
              width={previewResult.width}
              height={previewResult.height}
            />
          </div>
          <figcaption>
            <strong
              >{previewEntry.probe.format === "pdf"
                ? copy.preview.page
                : copy.preview.converted}</strong
            ><span>{resultDimensions(previewResult)} · {formatBytes(previewResult.size)}</span>
          </figcaption>
        </figure>
      </div>
      <div class="preview-summary">
        <span>{copy.preview.duration} · {duration(previewResult.durationMs)}</span><button
          type="button"
          onclick={() => downloadResult(previewEntry!, previewResult)}
          >{copy.actions.download}</button
        >
      </div>
    </div>
  {/if}
</dialog>
