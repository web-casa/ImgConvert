// SPDX-License-Identifier: Apache-2.0

import type { NumberRange, StorageImpactAssumptions, StorageImpactFactors } from "./types.js";

function range(min: number, max: number): NumberRange {
  return Object.freeze({ max, min });
}

export const STORAGE_IMPACT_MODEL_V1 = Object.freeze({
  byteUnit: "decimal-si",
  exclusions: Object.freeze([
    "conversion-energy",
    "storage-hardware-embodied-emissions",
    "network-transfer-energy",
    "marginal-capacity-effects",
  ]),
  id: "imgconvert.storage-operational-impact",
  releasedOn: "2026-09-05",
  sources: Object.freeze([
    Object.freeze({
      accessedOn: "2026-09-05",
      id: "cloud-carbon-footprint-methodology",
      title: "Cloud Carbon Footprint methodology",
      url: "https://www.cloudcarbonfootprint.org/docs/methodology/",
    }),
    Object.freeze({
      accessedOn: "2026-09-05",
      id: "ember-global-electricity-review-2025",
      title: "Ember Global Electricity Review 2025",
      url: "https://ember-energy.org/app/uploads/2025/04/Report-Global-Electricity-Review-2025.pdf",
    }),
  ]),
  version: "1.0.0",
});

export const DEFAULT_STORAGE_IMPACT_FACTORS_V1: StorageImpactFactors = Object.freeze({
  gridIntensityGramsCo2PerKilowattHour: range(473, 473),
  pue: range(1.1, 1.185),
  replicationFactor: range(1, 3),
  storageEnergyWattHoursPerTerabyteHour: range(0.65, 1.2),
});

export const DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1: StorageImpactAssumptions = Object.freeze({
  ...DEFAULT_STORAGE_IMPACT_FACTORS_V1,
  retentionDays: 365,
});
