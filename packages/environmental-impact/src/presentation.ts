// SPDX-License-Identifier: Apache-2.0
import { createStorageImpactAssumptions } from "./calculator.js";
import { DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1 } from "./model.js";
import type { NumberRange } from "./types.js";

/** Bounded UI inputs; the calculation model itself remains independent of the UI. */
export function scenarioAssumptions(days: number, copies: number) {
  if (!Number.isInteger(days) || days < 0 || days > 3650) {
    throw new RangeError("retention days must be an integer from 0 to 3650");
  }
  if (![0, 1, 2, 3].includes(copies)) throw new RangeError("unsupported replica count");
  return createStorageImpactAssumptions({
    ...DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
    retentionDays: days,
    replicationFactor: copies === 0 ? { min: 1, max: 3 } : { min: copies, max: copies },
  });
}

/** One unit for the whole range, with significant digits so small values stay visible. */
export function formatImpactRange(
  range: NumberRange,
  quantity: "energy" | "carbon",
  locale: string,
) {
  if (![range.min, range.max].every(Number.isFinite) || range.min < 0 || range.max < range.min) {
    throw new RangeError("invalid impact range");
  }
  const units: readonly (readonly [number, string])[] =
    quantity === "energy"
      ? [
          [1e9, "GWh"],
          [1e6, "MWh"],
          [1e3, "kWh"],
          [1, "Wh"],
        ]
      : [
          [1e6, "t CO₂"],
          [1e3, "kg CO₂"],
          [1, "g CO₂"],
          [0.001, "mg CO₂"],
        ];
  const [divisor, unit] =
    units.find(([threshold]) => range.max >= threshold) ?? units[units.length - 1]!;
  const formatter = new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 });
  const low = formatter.format(range.min / divisor);
  const high = formatter.format(range.max / divisor);
  return `${low === high ? low : `${low}–${high}`} ${unit}`;
}
