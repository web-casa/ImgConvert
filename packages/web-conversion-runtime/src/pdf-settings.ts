// SPDX-License-Identifier: Apache-2.0

interface QueueLikeEntry {
  readonly probe?: Readonly<{ format: string }>;
  readonly state: string;
}

export function nextConversionIncludesPdf(entries: readonly QueueLikeEntry[]): boolean {
  const hasReadyEntry = entries.some(
    ({ probe, state }) => state === "ready" && probe !== undefined,
  );
  return entries.some(
    ({ probe, state }) =>
      probe?.format === "pdf" && (state === "ready" || (!hasReadyEntry && state === "done")),
  );
}
