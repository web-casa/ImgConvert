// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  confirm: vi.fn(),
  relaunch: vi.fn(),
  checkUpdate: vi.fn(),
  storeGet: vi.fn(),
  storeSet: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class<T> {
    constructor(public readonly onmessage: (message: T) => void) {}
  },
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
  confirm: mocks.confirm,
}));

vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.checkUpdate }));
vi.mock("@tauri-apps/plugin-os", () => ({ locale: vi.fn(async () => "en-US") }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: vi.fn(async () => undefined) }),
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: mocks.storeGet,
    set: mocks.storeSet,
  })),
}));

import {
  addPaths,
  appUpdate,
  cancelConversion,
  cancelImportScan,
  closeComparisonPreview,
  clearResultCache,
  capabilities,
  checkEngine,
  checkForAppUpdate,
  clearQueue,
  convertAll,
  comparisonPreview,
  importPaths,
  initPersistence,
  installAppUpdate,
  engine,
  persistenceReady,
  persistenceStatus,
  persistSettings,
  openComparisonPreview,
  queue,
  refreshComparisonPreview,
  settings,
  setItemTargetFormat,
  ui,
} from "../src/lib/state.svelte";
import { setAppLocale } from "../src/lib/i18n";

const runtimeAccess = {
  useHostLinuxPicker: false,
  requiresOutputDirectory: true,
  requiresOutputDirectorySessionGrant: false,
};

function previewPayload(
  summary: Record<string, unknown>,
  before: number[] = [1],
  after: number[] = [2],
): ArrayBuffer {
  const summaryBytes = new TextEncoder().encode(JSON.stringify(summary));
  const payload = new Uint8Array(16 + summaryBytes.length + before.length + after.length);
  payload.set([0x49, 0x43, 0x50, 0x31]);
  const view = new DataView(payload.buffer);
  view.setUint32(4, summaryBytes.length, true);
  view.setUint32(8, before.length, true);
  view.setUint32(12, after.length, true);
  payload.set(summaryBytes, 16);
  payload.set(before, 16 + summaryBytes.length);
  payload.set(after, 16 + summaryBytes.length + before.length);
  return payload.buffer;
}

const previewInvalidationCases: Array<{
  label: string;
  format: string;
  prepare?: () => void;
  change: () => void;
}> = [
  {
    label: "JPEG quality floor",
    format: "jpeg",
    change: () => (settings.jpegQualityFloor = 35),
  },
  {
    label: "WebP quality floor",
    format: "webp",
    change: () => (settings.webpQualityFloor = 35),
  },
  {
    label: "AVIF quality floor",
    format: "avif",
    change: () => (settings.avifQualityFloor = 35),
  },
  {
    label: "JPEG progressive mode",
    format: "jpeg",
    change: () => (settings.jpegProgressive = false),
  },
  {
    label: "JPEG trellis scans",
    format: "jpeg",
    change: () => (settings.jpegTrellis = false),
  },
  {
    label: "PNG oxipng level",
    format: "png",
    change: () => (settings.pngOxipngLevel = 5),
  },
  {
    label: "PNG lossy quantization",
    format: "png",
    change: () => (settings.pngLossyQuantize = true),
  },
  {
    label: "PNG quantization color count",
    format: "png",
    prepare: () => (settings.pngLossyQuantize = true),
    change: () => (settings.pngQuantColors = 128),
  },
  {
    label: "WebP method",
    format: "webp",
    change: () => (settings.webpMethod = 5),
  },
  {
    label: "WebP near-lossless level",
    format: "webp",
    prepare: () => (settings.lossless = true),
    change: () => (settings.webpNearLossless = 65),
  },
  {
    label: "WebP sharp YUV",
    format: "webp",
    change: () => (settings.webpSharpYuv = true),
  },
  {
    label: "AVIF speed",
    format: "avif",
    change: () => (settings.avifSpeed = 7),
  },
  {
    label: "AVIF chroma subsampling",
    format: "avif",
    change: () => (settings.avifSubsample = "yuv420"),
  },
  {
    label: "automatic quality",
    format: "jpeg",
    change: () => (settings.autoQuality = true),
  },
  {
    label: "automatic quality target score",
    format: "jpeg",
    prepare: () => (settings.autoQuality = true),
    change: () => (settings.autoQualityScore = 81),
  },
  {
    label: "generation-loss protection",
    format: "jpeg",
    change: () => (settings.generationLossProtection = true),
  },
  {
    label: "keep-smaller policy",
    format: "jpeg",
    change: () => (settings.skipIfLarger = true),
  },
  {
    label: "multi-candidate encoding",
    format: "jpeg",
    change: () => (settings.multiCandidate = false),
  },
  {
    label: "metadata policy",
    format: "jpeg",
    change: () => (settings.metadataPolicy = "colorOnly"),
  },
  {
    label: "color-management policy",
    format: "jpeg",
    change: () => (settings.colorManagementPolicy = "convertToSrgb"),
  },
];

describe("desktop state orchestration", () => {
  beforeEach(async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
    if (comparisonPreview.open) closeComparisonPreview();
    if (ui.converting) ui.converting = false;
    if (ui.importing) ui.importing = false;
    clearQueue();
    await setAppLocale("en-US");
    capabilities.readable = ["jpeg", "png", "webp", "avif"];
    capabilities.writable = ["jpeg", "png", "webp", "avif"];
    capabilities.lossless = ["png", "webp", "avif"];
    settings.format = "jpeg";
    settings.quality = 80;
    settings.jpegQualityFloor = 30;
    settings.webpQualityFloor = 30;
    settings.avifQualityFloor = 30;
    settings.lossless = false;
    settings.jpegProgressive = true;
    settings.jpegTrellis = true;
    settings.pngOxipngLevel = 4;
    settings.pngLossyQuantize = false;
    settings.pngQuantColors = 256;
    settings.webpMethod = 4;
    settings.webpNearLossless = 100;
    settings.webpSharpYuv = false;
    settings.avifSpeed = 8;
    settings.avifSubsample = "yuv444";
    settings.autoQuality = false;
    settings.autoQualityScore = 80;
    settings.generationLossProtection = false;
    settings.skipIfLarger = false;
    settings.multiCandidate = true;
    settings.metadataPolicy = "stripAll";
    settings.preserveMetadata = false;
    settings.resizeMode = "none";
    settings.resizeWidth = 1920;
    settings.resizeHeight = 1080;
    settings.resizeValue = 2048;
    settings.resizeAllowUpscale = false;
    settings.targetSizeEnabled = false;
    settings.targetSizeKib = 1024;
    settings.colorManagementPolicy = "preserve";
    settings.pdfDpi = 150;
    settings.pdfPageRange = "";
    settings.outDir = "/tmp/out";
    settings.overwrite = "skip";
    ui.importMode = null;
    ui.importCancelRequested = false;
    mocks.invoke.mockReset();
    mocks.open.mockReset();
    mocks.confirm.mockReset();
    mocks.relaunch.mockReset();
    mocks.checkUpdate.mockReset();
    mocks.storeGet.mockReset();
    mocks.storeSet.mockReset();
    mocks.storeGet.mockResolvedValue(null);
    mocks.storeSet.mockResolvedValue(undefined);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "file_access_runtime") return runtimeAccess;
      throw new Error(`unexpected command: ${command}`);
    });
  });

  it("runs plan and batch progress through mocked IPC", async () => {
    addPaths(["/tmp/source.png"]);
    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "file_access_runtime") return runtimeAccess;
      if (command === "plan_conversions") {
        return [
          {
            index: 0,
            input: "/tmp/source.png",
            output: "/tmp/out/source.jpg",
            exists: false,
            sameAsSource: false,
            conflictsWithQueuedInput: false,
            error: null,
          },
        ];
      }
      if (command === "convert_batch") {
        const progress = args?.progress as { onmessage: (event: unknown) => void };
        progress.onmessage({ event: "fileStarted", data: { index: 0, input: "/tmp/source.png" } });
        progress.onmessage({
          event: "fileFinished",
          data: {
            index: 0,
            result: {
              input: "/tmp/source.png",
              output: "/tmp/out/source.jpg",
              inSize: 2048,
              outSize: 1024,
              warning: null,
            },
          },
        });
        return { total: 1, completed: 1, skipped: 0, failed: 0, cancelled: false };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await convertAll();

    expect(queue[0]?.status).toBe("done");
    expect(queue[0]?.detail).toContain("2.0 KB → 1.0 KB");
  });

  it("sends resize, target-size, and metadata workflow fields through the shared batch plan", async () => {
    addPaths(["/tmp/source.png"]);
    settings.metadataPolicy = "colorOnly";
    settings.resizeMode = "fit";
    settings.resizeWidth = 1280;
    settings.resizeHeight = 720;
    settings.resizeAllowUpscale = true;
    settings.targetSizeEnabled = true;
    settings.targetSizeKib = 640;
    let plannedOptions: Record<string, unknown>[] = [];

    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "file_access_runtime") return runtimeAccess;
      if (command === "plan_conversions") {
        plannedOptions = args?.options as Record<string, unknown>[];
        return [
          {
            index: 0,
            input: "/tmp/source.png",
            output: "/tmp/out/source.jpg",
            exists: false,
            sameAsSource: false,
            conflictsWithQueuedInput: false,
            error: null,
          },
        ];
      }
      if (command === "convert_batch") {
        return { total: 1, completed: 1, skipped: 0, failed: 0, cancelled: false };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await convertAll();

    expect(plannedOptions[0]).toMatchObject({
      metadataPolicy: "colorOnly",
      preserveMetadata: false,
      resize: {
        mode: "fit",
        width: 1280,
        height: 720,
        value: null,
        allowUpscale: true,
      },
      targetSizeBytes: 640 * 1024,
      autoQuality: false,
      lossless: false,
    });
  });

  it("plans one PDF job, prompts once for all existing page outputs, and sends raster settings", async () => {
    capabilities.readable.push("pdf");
    addPaths([
      {
        path: "/tmp/document.pdf",
        key: "/tmp/document.pdf",
        relativeDir: null,
        metadata: {
          format: "pdf",
          width: 300,
          height: 300,
          dpiX: 150,
          dpiY: 150,
          pageCount: 3,
        },
      },
    ]);
    settings.pdfDpi = 200;
    settings.pdfPageRange = "1,3";
    settings.overwrite = "ask";
    mocks.confirm.mockResolvedValue(true);
    let plannedOptions: Record<string, unknown>[] = [];
    let batchOptions: Record<string, unknown>[] = [];

    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "file_access_runtime") return runtimeAccess;
      if (command === "plan_conversions") {
        plannedOptions = args?.options as Record<string, unknown>[];
        return [
          {
            index: 0,
            input: "/tmp/document.pdf",
            output: "/tmp/out/document-page-001.jpg",
            exists: true,
            sameAsSource: false,
            conflictsWithQueuedInput: false,
            outputCount: 2,
            existingOutputCount: 2,
            error: null,
          },
        ];
      }
      if (command === "convert_batch") {
        batchOptions = args?.options as Record<string, unknown>[];
        const progress = args?.progress as { onmessage: (event: unknown) => void };
        progress.onmessage({
          event: "fileStarted",
          data: { index: 0, input: "/tmp/document.pdf" },
        });
        progress.onmessage({
          event: "fileFinished",
          data: {
            index: 0,
            result: {
              input: "/tmp/document.pdf",
              output: "/tmp/out/document-page-001.jpg",
              inSize: 4096,
              outSize: 2048,
              warnings: [],
              outputCount: 2,
              skippedOutputCount: 0,
            },
          },
        });
        return { total: 1, completed: 1, skipped: 0, failed: 0, cancelled: false };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await convertAll();

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(plannedOptions[0]).toMatchObject({
      input: "/tmp/document.pdf",
      pdf: { dpi: 200, pageRange: "1,3" },
      generationLossProtection: false,
      resultCache: false,
      skipIfLarger: false,
    });
    expect(batchOptions[0]).toMatchObject({ overwrite: true, overwriteMode: "overwrite" });
    expect(queue[0]?.status).toBe("done");
    expect(queue[0]?.detail).toContain("Created 2 pages");
  });

  it("rejects a per-item target format that cannot honor target size before IPC", async () => {
    addPaths(["/tmp/source.png"]);
    settings.targetSizeEnabled = true;
    setItemTargetFormat("/tmp/source.png", "png");

    await convertAll();

    expect(queue[0]?.status).toBe("error");
    expect(queue[0]?.detail).toContain("only for lossy JPEG or WebP");
    expect(mocks.invoke).not.toHaveBeenCalledWith("plan_conversions", expect.anything());
  });

  it("creates and revokes exact preview object URLs", async () => {
    addPaths(["/tmp/source.png"]);
    settings.resizeMode = "longestEdge";
    settings.resizeValue = 900;
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:before")
      .mockReturnValueOnce("blob:after");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "generate_comparison_preview") {
        expect(args).toMatchObject({
          options: {
            conversion: {
              input: "/tmp/source.png",
              resize: { mode: "longestEdge", value: 900 },
            },
            maxEdge: 1200,
          },
        });
        return previewPayload(
          {
            input: "/tmp/source.png",
            mime: "image/png",
            sourceWidth: 1800,
            sourceHeight: 1200,
            outputWidth: 900,
            outputHeight: 600,
            outputSize: 12345,
            selectedQuality: 80,
            targetSizeMet: null,
            warnings: [],
          },
          [137, 80, 78, 71],
          [137, 80, 78, 71],
        );
      }
      if (command === "cancel_comparison_preview") return true;
      if (command === "file_access_runtime") return runtimeAccess;
      throw new Error(`unexpected command: ${command}`);
    });

    const item = queue[0];
    expect(item).toBeDefined();
    if (!item) return;
    openComparisonPreview(item);
    await vi.waitFor(() => expect(comparisonPreview.afterUrl).toBe("blob:after"));
    expect(comparisonPreview.result).toMatchObject({ outputWidth: 900, outputHeight: 600 });

    closeComparisonPreview();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:before");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:after");
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_comparison_preview");
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("clears the previous file while a newly opened preview is loading", async () => {
    addPaths(["/tmp/first.png", "/tmp/second.png"]);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first-before")
      .mockReturnValueOnce("blob:first-after")
      .mockReturnValueOnce("blob:second-before")
      .mockReturnValueOnce("blob:second-after");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    let resolveSecond: ((payload: ArrayBuffer) => void) | undefined;
    const secondPayload = new Promise<ArrayBuffer>((resolve) => {
      resolveSecond = resolve;
    });
    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "generate_comparison_preview") {
        const input = (args?.options as { conversion?: { input?: string } } | undefined)?.conversion
          ?.input;
        if (input === "/tmp/second.png") return secondPayload;
        return previewPayload({
          input: "/tmp/first.png",
          mime: "image/png",
          sourceWidth: 100,
          sourceHeight: 100,
          outputWidth: 100,
          outputHeight: 100,
          outputSize: 1000,
          selectedQuality: 80,
          targetSizeMet: null,
          warnings: [],
        });
      }
      if (command === "cancel_comparison_preview") return true;
      if (command === "file_access_runtime") return runtimeAccess;
      throw new Error(`unexpected command: ${command}`);
    });

    const first = queue[0];
    const second = queue[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;
    openComparisonPreview(first);
    await vi.waitFor(() => expect(comparisonPreview.afterUrl).toBe("blob:first-after"));

    openComparisonPreview(second);
    expect(comparisonPreview.loading).toBe(true);
    expect(comparisonPreview.result).toBeNull();
    expect(comparisonPreview.beforeUrl).toBeNull();
    expect(comparisonPreview.afterUrl).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first-before");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first-after");

    resolveSecond?.(
      previewPayload({
        input: "/tmp/second.png",
        mime: "image/png",
        sourceWidth: 200,
        sourceHeight: 100,
        outputWidth: 200,
        outputHeight: 100,
        outputSize: 2000,
        selectedQuality: 80,
        targetSizeMet: null,
        warnings: [],
      }),
    );
    await vi.waitFor(() => expect(comparisonPreview.afterUrl).toBe("blob:second-after"));
    closeComparisonPreview();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("marks the open comparison preview stale when output-affecting settings change", async () => {
    addPaths(["/tmp/source.png"]);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "generate_comparison_preview") {
        return previewPayload({
          input: "/tmp/source.png",
          mime: "image/jpeg",
          sourceWidth: 100,
          sourceHeight: 100,
          outputWidth: 100,
          outputHeight: 100,
          outputSize: 1000,
          selectedQuality: settings.quality,
          targetSizeMet: null,
          warnings: [],
        });
      }
      if (command === "cancel_comparison_preview") return true;
      if (command === "file_access_runtime") return runtimeAccess;
      throw new Error(`unexpected command: ${command}`);
    });

    const item = queue[0];
    expect(item).toBeDefined();
    if (!item) return;
    openComparisonPreview(item);
    await vi.waitFor(() => expect(comparisonPreview.result).not.toBeNull());
    expect(comparisonPreview.stale).toBe(false);

    settings.quality = 55;
    await vi.waitFor(() => expect(comparisonPreview.stale).toBe(true));

    await refreshComparisonPreview();
    expect(comparisonPreview.stale).toBe(false);

    settings.format = "webp";
    await vi.waitFor(() => expect(comparisonPreview.stale).toBe(true));

    await refreshComparisonPreview();
    expect(comparisonPreview.stale).toBe(false);
    setItemTargetFormat("/tmp/source.png", "png");
    await vi.waitFor(() => expect(comparisonPreview.stale).toBe(true));

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it.each(previewInvalidationCases)(
    "invalidates the comparison preview when $label changes",
    async ({ format, prepare, change }) => {
      settings.format = format;
      prepare?.();
      addPaths(["/tmp/source.png"]);
      const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
      const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      mocks.invoke.mockImplementation(async (command: string) => {
        if (command === "generate_comparison_preview") {
          return previewPayload({
            input: "/tmp/source.png",
            mime: "image/png",
            sourceWidth: 100,
            sourceHeight: 100,
            outputWidth: 100,
            outputHeight: 100,
            outputSize: 1000,
            selectedQuality: settings.quality,
            targetSizeMet: null,
            warnings: [],
          });
        }
        if (command === "cancel_comparison_preview") return true;
        if (command === "file_access_runtime") return runtimeAccess;
        throw new Error(`unexpected command: ${command}`);
      });

      const item = queue[0];
      expect(item).toBeDefined();
      if (!item) return;
      openComparisonPreview(item);
      await vi.waitFor(() => expect(comparisonPreview.result).not.toBeNull());
      expect(comparisonPreview.stale).toBe(false);

      change();
      await vi.waitFor(() => expect(comparisonPreview.stale).toBe(true));

      closeComparisonPreview();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    },
  );

  it("does not relabel an earlier skipped item when output selection fails", async () => {
    addPaths(["/tmp/skipped.png", "/tmp/pending.png"]);
    const skipped = queue[0];
    expect(skipped).toBeDefined();
    if (!skipped) return;
    skipped.status = "skipped";
    skipped.detail = "kept from prior run";
    settings.outDir = null;
    mocks.open.mockRejectedValue(new Error("dialog unavailable"));

    await convertAll();

    expect(skipped.status).toBe("skipped");
    expect(skipped.detail).toBe("kept from prior run");
    expect(queue[1]?.status).toBe("error");
  });

  it("uses the import and cancellation wrapper messages", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "scan_import_paths") throw new Error("scanner offline");
      if (command === "cancel_import_scan") throw new Error("cancel offline");
      if (command === "file_access_runtime") return runtimeAccess;
      throw new Error(`unexpected command: ${command}`);
    });

    await importPaths(["/tmp/source.png"]);
    expect(ui.importMessage).toContain("Import failed:");

    ui.importing = true;
    ui.importMode = "scan";
    await cancelImportScan();
    expect(ui.importMessage).toContain("Failed to cancel import scan:");
    ui.importing = false;
  });

  it("forwards batch cancellation to the backend", async () => {
    ui.converting = true;
    mocks.invoke.mockResolvedValue(true);

    await cancelConversion();

    expect(mocks.invoke).toHaveBeenCalledWith("cancel_batch");
    expect(ui.cancelRequested).toBe(true);
    ui.converting = false;
    ui.cancelRequested = false;
  });

  it("loads capabilities through checkEngine and recovers invalid persisted settings", async () => {
    mocks.storeGet.mockResolvedValue({
      overwrite: "invalid",
      format: "",
      outDir: 42,
      preserveMetadata: true,
      resizeMode: "percentage",
      resizeValue: 50_000,
      targetSizeEnabled: true,
      targetSizeKib: 1,
      autoQuality: true,
      lossless: true,
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "set_selected_heic_helper") {
        return { configured: false, available: false, path: null, message: null, provider: null };
      }
      if (command === "capabilities") {
        return {
          readable: ["png", "jpeg"],
          writable: ["png"],
          lossless: ["png"],
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
      }
      if (command === "file_access_runtime") return runtimeAccess;
      throw new Error(`unexpected command: ${command}`);
    });

    await initPersistence();
    await checkEngine();

    expect(persistenceReady.ready).toBe(true);
    expect(settings.overwrite).toBe("skip");
    expect(settings.outDir).toBeNull();
    expect(settings.format).toBe("png");
    expect(settings.metadataPolicy).toBe("preserveAll");
    expect(settings.resizeValue).toBe(400);
    expect(settings.targetSizeKib).toBe(16);
    expect(settings.autoQuality).toBe(false);
    expect(settings.lossless).toBe(false);
    expect(capabilities.writable).toEqual(["png"]);
    expect(engine.ok).toBe(true);
    expect(mocks.storeSet).toHaveBeenCalled();
  });

  it("handles settings persistence failures and clears the warning after retry", async () => {
    await initPersistence();
    mocks.storeSet.mockRejectedValueOnce(new Error("disk full"));

    settings.quality = 79;
    await expect(persistSettings()).resolves.toBeUndefined();
    expect(persistenceStatus.error).toContain("disk full");

    mocks.storeSet.mockResolvedValue(undefined);
    settings.quality = 78;
    await persistSettings();
    expect(persistenceStatus.error).toBeNull();
  });

  it("clears the backend result cache through IPC", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "clear_result_cache") return 7;
      if (command === "file_access_runtime") return runtimeAccess;
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(clearResultCache()).resolves.toBe(7);
    expect(mocks.invoke).toHaveBeenCalledWith("clear_result_cache");
  });

  it("reports relaunch failure as post-install instead of update-check failure", async () => {
    mocks.checkUpdate.mockResolvedValue({
      version: "9.9.9",
      currentVersion: "1.0.0",
      date: null,
      body: null,
      close: vi.fn(async () => undefined),
      downloadAndInstall: vi.fn(async () => undefined),
    });
    mocks.relaunch.mockRejectedValue(new Error("relaunch denied"));

    await checkForAppUpdate();
    await installAppUpdate();

    expect(appUpdate.installed).toBe(true);
    expect(appUpdate.message).toContain("Restart ImgConvert manually");
    expect(appUpdate.error).toContain("automatic restart failed");
    expect(appUpdate.error).not.toContain("Update check failed");
  });
});
