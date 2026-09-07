// SPDX-License-Identifier: Apache-2.0

export class AsyncOperationLock {
  private gate: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.gate;
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    this.gate = current;

    await previous;
    try {
      return await operation();
    } finally {
      releaseCurrent?.();
      if (this.gate === current) this.gate = Promise.resolve();
    }
  }
}
