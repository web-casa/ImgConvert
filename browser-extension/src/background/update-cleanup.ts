// SPDX-License-Identifier: Apache-2.0
import { isPendingImportStorageKey } from "../web-import/pending-storage";
import { isConverterTabStorageKey } from "./converter-tab-storage";

export interface UpdateSessionStorage {
  get(keys: null): Promise<Record<string, unknown>>;
  remove(keys: string[]): Promise<void>;
}

export function isOwnedTransientSessionKey(key: string): boolean {
  return isConverterTabStorageKey(key) || isPendingImportStorageKey(key);
}

export async function clearOwnedTransientSessionState(
  session: UpdateSessionStorage,
): Promise<number> {
  const stored = await session.get(null);
  const ownedKeys = Object.keys(stored).filter(isOwnedTransientSessionKey);
  if (ownedKeys.length > 0) await session.remove(ownedKeys);
  return ownedKeys.length;
}
