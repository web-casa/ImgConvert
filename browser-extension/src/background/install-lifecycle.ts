// SPDX-License-Identifier: Apache-2.0

export interface ExtensionInstallTasks {
  clearOwnedTransientSessionState(): Promise<unknown>;
  installContextMenu(): Promise<unknown>;
  migratePreferences(): Promise<unknown>;
  restrictLocalStorage(): Promise<unknown>;
}

export async function runExtensionInstallLifecycle(
  reason: string,
  tasks: ExtensionInstallTasks,
): Promise<void> {
  const operations = [tasks.restrictLocalStorage(), tasks.installContextMenu()];
  if (reason === "update") {
    operations.push(tasks.clearOwnedTransientSessionState(), tasks.migratePreferences());
  }
  await Promise.all(operations);
}
