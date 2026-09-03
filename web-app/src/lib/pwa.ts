// SPDX-License-Identifier: Apache-2.0

import { PWA_CACHE_PREFIX, PWA_COMPATIBILITY_VERSION } from "../../pwa.config.mjs";

export type PwaPhase = "checking" | "cleared" | "error" | "ready" | "registering" | "unsupported";

export interface PwaStatus {
  readonly buildId?: string;
  readonly offlineReady: boolean;
  readonly phase: PwaPhase;
  readonly updateAvailable: boolean;
}

export interface PwaManager {
  activateUpdate(): Promise<boolean>;
  checkForUpdate(): Promise<void>;
  dispose(): void;
}

interface WorkerVersion {
  readonly buildId: string;
  readonly compatibilityVersion: string;
  readonly offlineReady: boolean;
}

const EXPECTED_SCOPE_PATH = import.meta.env.BASE_URL;
const EXPECTED_COMPATIBILITY_VERSION = PWA_COMPATIBILITY_VERSION;
const CACHE_PREFIX = PWA_CACHE_PREFIX;
const VERSION_RESPONSE_TIMEOUT_MS = 2500;

function parseWorkerVersion(value: unknown): WorkerVersion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<WorkerVersion> & { type?: unknown };
  if (
    candidate.type !== "IMGCONVERT_VERSION_RESPONSE" ||
    typeof candidate.buildId !== "string" ||
    !/^[\da-f]{16}$/u.test(candidate.buildId) ||
    typeof candidate.compatibilityVersion !== "string" ||
    candidate.compatibilityVersion.length < 1 ||
    candidate.compatibilityVersion.length > 64 ||
    typeof candidate.offlineReady !== "boolean"
  ) {
    return undefined;
  }
  return {
    buildId: candidate.buildId,
    compatibilityVersion: candidate.compatibilityVersion,
    offlineReady: candidate.offlineReady,
  };
}

async function requestWorkerVersion(worker: ServiceWorker): Promise<WorkerVersion | undefined> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value: WorkerVersion | undefined): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(undefined), VERSION_RESPONSE_TIMEOUT_MS);
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      finish(parseWorkerVersion(data));
    };
    try {
      worker.postMessage({ type: "IMGCONVERT_VERSION_REQUEST" }, [channel.port2]);
    } catch {
      finish(undefined);
    }
  });
}

async function prepareOfflineShell(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (ready: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(ready);
    };
    const timeout = window.setTimeout(() => finish(false), VERSION_RESPONSE_TIMEOUT_MS * 4);
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      finish(
        Boolean(
          data &&
          typeof data === "object" &&
          (data as { type?: unknown }).type === "IMGCONVERT_PREPARE_RESPONSE" &&
          (data as { ok?: unknown }).ok === true,
        ),
      );
    };
    try {
      worker.postMessage({ type: "IMGCONVERT_PREPARE_OFFLINE" }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

export function isImgConvertCacheName(name: string): boolean {
  return name.startsWith(CACHE_PREFIX);
}

export async function clearImgConvertOfflineCaches(cacheStorage: CacheStorage): Promise<number> {
  const names = (await cacheStorage.keys()).filter(isImgConvertCacheName);
  const removed = await Promise.all(names.map((name) => cacheStorage.delete(name)));
  return removed.filter(Boolean).length;
}

export async function registerImgConvertPwa(
  onStatus: (status: PwaStatus) => void,
  reload = () => window.location.reload(),
): Promise<PwaManager | undefined> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || !window.isSecureContext) {
    onStatus({ offlineReady: false, phase: "unsupported", updateAvailable: false });
    return undefined;
  }

  const scopeUrl = new URL(EXPECTED_SCOPE_PATH, window.location.origin).href;
  const scriptUrl = new URL("service-worker.js", scopeUrl).href;
  onStatus({ offlineReady: false, phase: "registering", updateAvailable: false });
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register(scriptUrl, {
      scope: EXPECTED_SCOPE_PATH,
      updateViaCache: "none",
    });
    if (registration.scope !== scopeUrl) throw new Error("Unexpected service worker scope.");
  } catch {
    onStatus({ offlineReady: false, phase: "error", updateAvailable: false });
    return undefined;
  }

  let disposed = false;
  let activatingUpdate = false;
  let installationFailed = false;
  let preparingOffline = false;
  const observedWorkers = new Map<ServiceWorker, () => void>();

  const refresh = async (checking = false): Promise<void> => {
    if (disposed) return;
    const waiting = registration.waiting;
    const active = registration.active;
    const [waitingVersion, activeVersion] = await Promise.all([
      waiting ? requestWorkerVersion(waiting) : undefined,
      active ? requestWorkerVersion(active) : undefined,
    ]);
    if (disposed) return;
    const compatibleWaitingVersion =
      waitingVersion?.compatibilityVersion === EXPECTED_COMPATIBILITY_VERSION
        ? waitingVersion
        : undefined;
    const version = compatibleWaitingVersion ?? activeVersion;
    const compatible = activeVersion?.compatibilityVersion === EXPECTED_COMPATIBILITY_VERSION;
    const offlineReady = Boolean(active && compatible && activeVersion?.offlineReady);
    onStatus({
      ...(version ? { buildId: version.buildId } : {}),
      offlineReady,
      phase: checking
        ? "checking"
        : offlineReady
          ? "ready"
          : installationFailed && !active
            ? "error"
            : "registering",
      updateAvailable: Boolean(waiting && compatibleWaitingVersion),
    });
    if (
      active &&
      compatible &&
      !offlineReady &&
      navigator.onLine &&
      !preparingOffline &&
      !checking
    ) {
      preparingOffline = true;
      let prepared = false;
      try {
        prepared = await prepareOfflineShell(active);
      } finally {
        preparingOffline = false;
      }
      if (disposed) return;
      if (prepared) await refresh();
      else {
        onStatus({
          ...(version ? { buildId: version.buildId } : {}),
          offlineReady: false,
          phase: "error",
          updateAvailable: Boolean(waiting && compatibleWaitingVersion),
        });
      }
    }
  };

  const observeWorker = (worker: ServiceWorker | null): void => {
    if (!worker || observedWorkers.has(worker)) return;
    const listener = (): void => {
      if (worker.state === "redundant" && !registration.active) installationFailed = true;
      void refresh();
    };
    observedWorkers.set(worker, listener);
    worker.addEventListener("statechange", listener);
  };
  const handleUpdateFound = (): void => {
    installationFailed = false;
    observeWorker(registration.installing);
    void refresh();
  };
  const handleControllerChange = (): void => {
    if (activatingUpdate) reload();
    else void refresh();
  };
  registration.addEventListener("updatefound", handleUpdateFound);
  navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
  observeWorker(registration.installing);
  observeWorker(registration.waiting);
  observeWorker(registration.active);
  await refresh();
  void navigator.serviceWorker.ready.then(() => refresh());

  return {
    async activateUpdate() {
      const worker = registration.waiting;
      if (!worker) return false;
      const version = await requestWorkerVersion(worker);
      if (!version || version.compatibilityVersion !== EXPECTED_COMPATIBILITY_VERSION) return false;
      try {
        activatingUpdate = true;
        worker.postMessage({
          buildId: version.buildId,
          compatibilityVersion: version.compatibilityVersion,
          type: "IMGCONVERT_ACTIVATE",
        });
        return true;
      } catch {
        activatingUpdate = false;
        return false;
      }
    },
    async checkForUpdate() {
      await refresh(true);
      try {
        installationFailed = false;
        await registration.update();
        await refresh();
      } catch {
        await refresh();
      }
    },
    dispose() {
      disposed = true;
      registration.removeEventListener("updatefound", handleUpdateFound);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      for (const [worker, listener] of observedWorkers) {
        worker.removeEventListener("statechange", listener);
      }
      observedWorkers.clear();
    },
  };
}
