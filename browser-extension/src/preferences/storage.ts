// SPDX-License-Identifier: Apache-2.0
import { storage } from "#imports";

import { validateExtensionPreferences, type ExtensionPreferences } from "./schema";
import {
  EXTENSION_PREFERENCES_STORAGE_VERSION,
  isCanonicalStoredExtensionPreferences,
  migrateExtensionPreferencesToV2,
} from "./migration";
import { AsyncOperationLock } from "./operation-lock";

const preferenceMutations = new AsyncOperationLock();

export const extensionPreferencesItem = storage.defineItem<unknown>(
  "local:imgconvert.preferences",
  {
    migrations: {
      2: migrateExtensionPreferencesToV2,
    },
    version: EXTENSION_PREFERENCES_STORAGE_VERSION,
  },
);

export interface ExtensionPreferenceLoad {
  readonly persistent: boolean;
  readonly preferences: ExtensionPreferences;
}

export async function migrateExtensionPreferencesStorage(): Promise<void> {
  await extensionPreferencesItem.migrate();
}

export async function loadExtensionPreferences(
  defaults: ExtensionPreferences,
): Promise<ExtensionPreferenceLoad> {
  try {
    const stored = await extensionPreferencesItem.getValue();
    const preferences = validateExtensionPreferences(stored) ?? defaults;
    if (stored !== null && !isCanonicalStoredExtensionPreferences(stored, preferences)) {
      const canonicalized = await preferenceMutations.run(async () => {
        try {
          await extensionPreferencesItem.setValue(preferences);
          return true;
        } catch {
          return false;
        }
      });
      return Object.freeze({ persistent: canonicalized, preferences });
    }
    return Object.freeze({
      persistent: true,
      preferences,
    });
  } catch {
    return Object.freeze({ persistent: false, preferences: defaults });
  }
}

export async function saveExtensionPreferences(
  preferences: ExtensionPreferences,
): Promise<boolean> {
  const validated = validateExtensionPreferences(preferences);
  if (!validated) return false;
  return preferenceMutations.run(async () => {
    try {
      await extensionPreferencesItem.setValue(validated);
      return true;
    } catch {
      return false;
    }
  });
}

export async function clearExtensionPreferences(): Promise<boolean> {
  return preferenceMutations.run(async () => {
    try {
      await extensionPreferencesItem.removeValue({ removeMeta: true });
      return true;
    } catch {
      return false;
    }
  });
}
