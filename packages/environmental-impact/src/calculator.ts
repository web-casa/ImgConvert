// SPDX-License-Identifier: Apache-2.0

import {
  DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
  DEFAULT_STORAGE_IMPACT_FACTORS_V1,
  STORAGE_IMPACT_MODEL_V1,
} from "./model.js";
import type {
  ByteReductionMeasurement,
  ConversionImpactInput,
  ConversionImpactResult,
  DailyAccumulationEstimate,
  DailyAccumulationInput,
  NumberRange,
  ReplacementStatus,
  StorageImpactAssumptions,
  StorageImpactEstimate,
  StorageImpactFactors,
} from "./types.js";

const BYTES_PER_DECIMAL_TERABYTE = 1_000_000_000_000;
const HOURS_PER_DAY = 24;
const WATT_HOURS_PER_KILOWATT_HOUR = 1_000;

function assertFiniteAtLeast(value: number, minimum: number, name: string): void {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${name} must be a finite number greater than or equal to ${minimum}`);
  }
}

function assertSafeNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function assertBoolean(value: boolean, name: string): void {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean`);
  }
}

function copyRange(input: NumberRange, name: string, minimum: number): NumberRange {
  if (typeof input !== "object" || input === null) {
    throw new TypeError(`${name} must be a number range`);
  }
  assertFiniteAtLeast(input.min, minimum, `${name}.min`);
  assertFiniteAtLeast(input.max, minimum, `${name}.max`);
  if (input.min > input.max) {
    throw new RangeError(`${name}.min cannot exceed ${name}.max`);
  }
  return Object.freeze({ max: input.max, min: input.min });
}

function assertFiniteResult(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} exceeds the supported numeric range`);
  }
}

function impactFromTerabyteHours(
  terabyteHours: number,
  factors: StorageImpactFactors,
): Pick<StorageImpactEstimate, "carbonGramsCo2" | "energyWattHours"> {
  const minimumEnergyWattHours =
    terabyteHours *
    factors.storageEnergyWattHoursPerTerabyteHour.min *
    factors.pue.min *
    factors.replicationFactor.min;
  const maximumEnergyWattHours =
    terabyteHours *
    factors.storageEnergyWattHoursPerTerabyteHour.max *
    factors.pue.max *
    factors.replicationFactor.max;
  const minimumCarbonGramsCo2 =
    (minimumEnergyWattHours / WATT_HOURS_PER_KILOWATT_HOUR) *
    factors.gridIntensityGramsCo2PerKilowattHour.min;
  const maximumCarbonGramsCo2 =
    (maximumEnergyWattHours / WATT_HOURS_PER_KILOWATT_HOUR) *
    factors.gridIntensityGramsCo2PerKilowattHour.max;

  assertFiniteResult(minimumEnergyWattHours, "minimum energy estimate");
  assertFiniteResult(maximumEnergyWattHours, "maximum energy estimate");
  assertFiniteResult(minimumCarbonGramsCo2, "minimum carbon estimate");
  assertFiniteResult(maximumCarbonGramsCo2, "maximum carbon estimate");

  return Object.freeze({
    carbonGramsCo2: Object.freeze({
      max: maximumCarbonGramsCo2,
      min: minimumCarbonGramsCo2,
    }),
    energyWattHours: Object.freeze({
      max: maximumEnergyWattHours,
      min: minimumEnergyWattHours,
    }),
  });
}

export function createStorageImpactFactors(
  input: StorageImpactFactors = DEFAULT_STORAGE_IMPACT_FACTORS_V1,
): StorageImpactFactors {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("storage impact factors must be an object");
  }
  return Object.freeze({
    gridIntensityGramsCo2PerKilowattHour: copyRange(
      input.gridIntensityGramsCo2PerKilowattHour,
      "gridIntensityGramsCo2PerKilowattHour",
      0,
    ),
    pue: copyRange(input.pue, "pue", 1),
    replicationFactor: copyRange(input.replicationFactor, "replicationFactor", 1),
    storageEnergyWattHoursPerTerabyteHour: copyRange(
      input.storageEnergyWattHoursPerTerabyteHour,
      "storageEnergyWattHoursPerTerabyteHour",
      0,
    ),
  });
}

export function createStorageImpactAssumptions(
  input: StorageImpactAssumptions = DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
): StorageImpactAssumptions {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("storage impact assumptions must be an object");
  }
  assertFiniteAtLeast(input.retentionDays, 0, "retentionDays");
  return Object.freeze({
    ...createStorageImpactFactors(input),
    retentionDays: input.retentionDays,
  });
}

export function measureByteReduction(
  inputBytes: number,
  outputBytes: number,
): ByteReductionMeasurement {
  assertSafeNonNegativeInteger(inputBytes, "inputBytes");
  assertSafeNonNegativeInteger(outputBytes, "outputBytes");

  const byteDifference = inputBytes - outputBytes;
  const savedBytes = Math.max(byteDifference, 0);

  return Object.freeze({
    byteDifference,
    inputBytes,
    outputBytes,
    reductionFraction: inputBytes === 0 ? 0 : savedBytes / inputBytes,
    savedBytes,
  });
}

export function estimateStorageImpact(
  savedBytes: number,
  input: StorageImpactAssumptions = DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
): StorageImpactEstimate {
  assertSafeNonNegativeInteger(savedBytes, "savedBytes");
  const assumptions = createStorageImpactAssumptions(input);
  const terabyteHours =
    (savedBytes / BYTES_PER_DECIMAL_TERABYTE) * assumptions.retentionDays * HOURS_PER_DAY;
  assertFiniteResult(terabyteHours, "terabyte-hours");
  const impact = impactFromTerabyteHours(terabyteHours, assumptions);

  return Object.freeze({
    assumptions,
    ...impact,
    modelId: STORAGE_IMPACT_MODEL_V1.id,
    modelVersion: STORAGE_IMPACT_MODEL_V1.version,
    savedBytes,
    terabyteHours,
  });
}

function assertReplacementStatus(value: ReplacementStatus): void {
  if (value !== "confirmed" && value !== "hypothetical" && value !== "retained") {
    throw new TypeError("replacement must be confirmed, hypothetical, or retained");
  }
}

export function calculateConversionImpact(
  input: ConversionImpactInput,
  assumptionsInput: StorageImpactAssumptions = DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
): ConversionImpactResult {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("conversion impact input must be an object");
  }
  assertBoolean(input.comparable, "comparable");
  assertReplacementStatus(input.replacement);
  const assumptions = createStorageImpactAssumptions(assumptionsInput);
  const measurement = measureByteReduction(input.inputBytes, input.outputBytes);

  if (!input.comparable) {
    return Object.freeze({ kind: "unavailable", measurement, reason: "not-comparable" });
  }
  if (measurement.savedBytes === 0) {
    return Object.freeze({ kind: "unavailable", measurement, reason: "no-reduction" });
  }
  if (input.replacement === "retained") {
    return Object.freeze({ kind: "unavailable", measurement, reason: "original-retained" });
  }

  return Object.freeze({
    basis: input.replacement,
    estimate: estimateStorageImpact(measurement.savedBytes, assumptions),
    kind: "estimate",
    measurement,
  });
}

export function estimateDailyAccumulationImpact(
  input: DailyAccumulationInput,
  factorsInput: StorageImpactFactors = DEFAULT_STORAGE_IMPACT_FACTORS_V1,
): DailyAccumulationEstimate {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("daily accumulation input must be an object");
  }
  assertSafeNonNegativeInteger(input.dailySavedBytes, "dailySavedBytes");
  assertSafeNonNegativeInteger(input.activeDays, "activeDays");
  const factors = createStorageImpactFactors(factorsInput);
  const cohortDays = (input.activeDays * (input.activeDays + 1)) / 2;
  const savedBytesAtPeriodEnd = input.dailySavedBytes * input.activeDays;
  const terabyteHours =
    (input.dailySavedBytes / BYTES_PER_DECIMAL_TERABYTE) * cohortDays * HOURS_PER_DAY;

  assertFiniteResult(cohortDays, "accumulated cohort-days");
  assertFiniteResult(savedBytesAtPeriodEnd, "saved bytes at period end");
  assertFiniteResult(terabyteHours, "terabyte-hours");
  const impact = impactFromTerabyteHours(terabyteHours, factors);

  return Object.freeze({
    activeDays: input.activeDays,
    ...impact,
    dailySavedBytes: input.dailySavedBytes,
    factors,
    modelId: STORAGE_IMPACT_MODEL_V1.id,
    modelVersion: STORAGE_IMPACT_MODEL_V1.version,
    savedBytesAtPeriodEnd,
    terabyteHours,
  });
}
