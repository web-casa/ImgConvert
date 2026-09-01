// SPDX-License-Identifier: Apache-2.0

const EMPTY = Symbol("empty-coalescing-write");

/**
 * Serializes asynchronous writes and collapses queued values to the newest
 * snapshot. Callers that enqueue while a write is active share the same drain
 * promise, so no write can overtake an earlier one.
 */
export class CoalescingWriter<T> {
  private pending: T | typeof EMPTY = EMPTY;
  private active: Promise<void> | null = null;

  constructor(private readonly write: (value: T) => Promise<void>) {}

  get busy(): boolean {
    return this.active !== null;
  }

  enqueue(value: T): Promise<void> {
    this.pending = value;
    if (!this.active) {
      this.active = this.drain();
    }
    return this.active;
  }

  private async drain(): Promise<void> {
    let latestError: unknown = null;
    try {
      while (this.pending !== EMPTY) {
        const value = this.pending;
        this.pending = EMPTY;
        try {
          await this.write(value);
          latestError = null;
        } catch (error) {
          latestError = error;
        }
      }
    } finally {
      // Clear synchronously inside the drain continuation. An enqueue after this point starts its
      // own drain instead of attaching to a promise that has already stopped inspecting pending.
      this.active = null;
    }
    // A failed obsolete snapshot followed by a successful newest snapshot is fully recovered.
    // Reject only when the latest attempted state was not persisted.
    if (latestError !== null) throw latestError;
  }
}
