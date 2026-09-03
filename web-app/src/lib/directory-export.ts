import {
  fileNameWithCollisionSuffix,
  isSafeBatchFileName,
  type BatchExportArtifact,
} from "./batch-export";

export interface DirectoryWritable {
  abort?(reason?: unknown): Promise<void>;
  close(): Promise<void>;
  write(data: Blob): Promise<void>;
}

export interface DirectoryFileHandle {
  createWritable(): Promise<DirectoryWritable>;
}

export interface DirectoryHandle {
  getFileHandle(
    name: string,
    options?: Readonly<{ create?: boolean }>,
  ): Promise<DirectoryFileHandle>;
}

export type DirectoryPicker = (
  options: Readonly<{ mode: "readwrite" }>,
) => Promise<DirectoryHandle>;

export interface DirectoryExportProgress {
  readonly completed: number;
  readonly name: string;
  readonly total: number;
}

export class DirectoryExportError extends Error {
  readonly writtenArtifactCount: number;

  constructor(message: string, writtenArtifactCount: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "DirectoryExportError";
    this.writtenArtifactCount = writtenArtifactCount;
  }
}

function abortError(): DOMException {
  return new DOMException("Directory export was cancelled.", "AbortError");
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

async function fileExists(directory: DirectoryHandle, name: string): Promise<boolean> {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function availableFileName(directory: DirectoryHandle, desired: string): Promise<string> {
  if (!(await fileExists(directory, desired))) return desired;
  for (let sequence = 2; sequence <= 10_000; sequence += 1) {
    const candidate = fileNameWithCollisionSuffix(desired, sequence);
    if (!(await fileExists(directory, candidate))) return candidate;
  }
  throw new Error("No available output filename remains in the selected directory.");
}

async function writeArtifact(
  directory: DirectoryHandle,
  artifact: BatchExportArtifact,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw abortError();
  const name = await availableFileName(directory, artifact.name);
  if (signal.aborted) throw abortError();
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  let closed = false;
  const abortWritable = () => {
    if (!closed) void writable.abort?.(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", abortWritable, { once: true });
  try {
    if (signal.aborted) throw abortError();
    await writable.write(artifact.blob);
    if (signal.aborted) throw abortError();
    await writable.close();
    closed = true;
    return name;
  } catch (error) {
    try {
      await writable.abort?.(error);
    } catch {
      // Preserve the original failure while still attempting to discard the partial file.
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", abortWritable);
  }
}

export async function writeBatchToDirectory(
  directory: DirectoryHandle,
  artifacts: readonly BatchExportArtifact[],
  signal: AbortSignal,
  onProgress?: (progress: DirectoryExportProgress) => void,
): Promise<readonly string[]> {
  if (artifacts.length < 1) throw new TypeError("Directory export requires at least one artifact.");
  const names = new Set<string>();
  for (const artifact of artifacts) {
    const key = artifact.name.normalize("NFKC").toLocaleLowerCase("en-US");
    if (!(artifact.blob instanceof Blob) || !isSafeBatchFileName(artifact.name) || names.has(key)) {
      throw new TypeError("Directory export artifacts must have safe, unique filenames.");
    }
    names.add(key);
  }
  const writtenNames: string[] = [];
  for (const artifact of artifacts) {
    try {
      const name = await writeArtifact(directory, artifact, signal);
      writtenNames.push(name);
      onProgress?.(
        Object.freeze({ completed: writtenNames.length, name, total: artifacts.length }),
      );
    } catch (error) {
      if (signal.aborted) throw abortError();
      throw new DirectoryExportError(
        "The browser could not finish writing the selected directory.",
        writtenNames.length,
        { cause: error },
      );
    }
  }
  return Object.freeze(writtenNames);
}

export function directoryPickerFromWindow(value: Window): DirectoryPicker | undefined {
  if (!value.isSecureContext) return undefined;
  const candidate = (value as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker;
  return typeof candidate === "function" ? (candidate.bind(value) as DirectoryPicker) : undefined;
}
