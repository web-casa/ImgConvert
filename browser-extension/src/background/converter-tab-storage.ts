// SPDX-License-Identifier: Apache-2.0
// Retain recognition of the old tab-based UI's keys solely for update cleanup.
const prefix = "imgconvert.converterTab";

export function isConverterTabStorageKey(key: string): boolean {
  return key === `${prefix}.current` || /^imgconvert\.converterTab\.\d+$/u.test(key);
}
