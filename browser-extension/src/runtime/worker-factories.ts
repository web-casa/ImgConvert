export function createRasterWorker(): Worker {
  return new Worker(new URL("./workers/raster-codec.worker.ts", import.meta.url), {
    type: "module",
  });
}

export function createSvgWorker(): Worker {
  return new Worker(new URL("./workers/svg-codec.worker.ts", import.meta.url), { type: "module" });
}

export function createPdfWorker(): Worker {
  return new Worker(new URL("./workers/pdf-codec.worker.ts", import.meta.url), { type: "module" });
}

export function createArchiveWorker(): Worker {
  return new Worker(new URL("./workers/archive.worker.ts", import.meta.url), { type: "module" });
}
