import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";

import {
  ARCHIVE_SCHEMA_VERSION,
  assertArchiveRequest,
  type ArchiveFailureReason,
  type ArchiveOutcome,
  type ArchiveWorkerCommand,
  type ArchiveWorkerProgress,
  type ArchiveWorkerResult,
} from "../archive-protocol.js";
import { asRuntimeWorkerScope, isWorkerCommand, type RuntimeWorkerScope } from "../worker-scope.js";

type ArchiveWorkerMessage = ArchiveWorkerProgress | ArchiveWorkerResult;

const FIXED_ARCHIVE_DATE = new Date("2000-01-01T00:00:00.000Z");

function failure(reason: ArchiveFailureReason): ArchiveOutcome {
  return Object.freeze({ ok: false, reason });
}

async function createArchive(
  command: ArchiveWorkerCommand,
  workerScope: RuntimeWorkerScope<ArchiveWorkerMessage>,
): Promise<ArchiveOutcome> {
  try {
    assertArchiveRequest(command.request);
  } catch {
    return failure("invalid-request");
  }
  const blobWriter = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(blobWriter, {
    bufferedWrite: false,
    extendedTimestamp: false,
    keepOrder: true,
    level: 0,
    useCompressionStream: false,
    useWebWorkers: false,
    zip64: false,
  });
  try {
    for (let index = 0; index < command.request.files.length; index += 1) {
      const file = command.request.files[index];
      if (!file) return failure("invalid-request");
      await zipWriter.add(file.name, new BlobReader(file.blob), {
        bufferedWrite: false,
        dataDescriptor: true,
        extendedTimestamp: false,
        lastModDate: FIXED_ARCHIVE_DATE,
        level: 0,
        useCompressionStream: false,
        useWebWorkers: false,
        zip64: false,
      });
      if (blobWriter.size > command.request.maxBytes) return failure("archive-too-large");
      workerScope.postMessage({
        completed: index + 1,
        executionId: command.executionId,
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        total: command.request.files.length,
        type: "archive-progress",
      });
    }
    const archive = await zipWriter.close();
    if (archive.size > command.request.maxBytes) return failure("archive-too-large");
    const magic = new Uint8Array(await archive.slice(0, 4).arrayBuffer());
    if (magic[0] !== 0x50 || magic[1] !== 0x4b || magic[2] !== 0x03 || magic[3] !== 0x04) {
      return failure("worker-failed");
    }
    return Object.freeze({ archive, entryCount: command.request.files.length, ok: true });
  } catch {
    return failure("worker-failed");
  }
}

export function registerArchiveWorker(workerGlobal: unknown): void {
  const workerScope = asRuntimeWorkerScope<ArchiveWorkerMessage>(workerGlobal);
  workerScope.addEventListener("message", (event) => {
    if (!isWorkerCommand(event.data, "create-archive", ARCHIVE_SCHEMA_VERSION)) return;
    const command = event.data as ArchiveWorkerCommand;
    void (async () => {
      const outcome = await createArchive(command, workerScope);
      workerScope.postMessage({
        executionId: command.executionId,
        outcome,
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        type: "archive-result",
      });
    })();
  });
}
