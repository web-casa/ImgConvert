// SPDX-License-Identifier: Apache-2.0
import {
  DEFAULT_EXTENSION_PREFERENCES,
  validateExtensionPreferences,
  type ExtensionPreferences,
} from "./schema";

export const EXTENSION_PREFERENCES_STORAGE_VERSION = 2;

const EXTENSION_PREFERENCE_KEYS = Object.freeze(
  Object.keys(DEFAULT_EXTENSION_PREFERENCES) as (keyof ExtensionPreferences)[],
);

export function migrateExtensionPreferencesToV2(value: unknown): ExtensionPreferences {
  return validateExtensionPreferences(value) ?? DEFAULT_EXTENSION_PREFERENCES;
}

export function isCanonicalStoredExtensionPreferences(
  value: unknown,
  canonical: ExtensionPreferences,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === EXTENSION_PREFERENCE_KEYS.length &&
    EXTENSION_PREFERENCE_KEYS.every(
      (key) => Object.hasOwn(record, key) && Object.is(record[key], canonical[key]),
    )
  );
}
