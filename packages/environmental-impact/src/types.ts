// SPDX-License-Identifier: Apache-2.0

export interface NumberRange {
  readonly min: number;
  readonly max: number;
}

export interface StorageImpactFactors {
  readonly gridIntensityGramsCo2PerKilowattHour: NumberRange;
  readonly pue: NumberRange;
  readonly replicationFactor: NumberRange;
  readonly storageEnergyWattHoursPerTerabyteHour: NumberRange;
}

export interface StorageImpactAssumptions extends StorageImpactFactors {
  readonly retentionDays: number;
}

export interface ByteReductionMeasurement {
  /** Positive when the output is smaller and negative when it is larger. */
  readonly byteDifference: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly reductionFraction: number;
  /** Never negative. */
  readonly savedBytes: number;
}

export interface StorageImpactEstimate {
  readonly assumptions: StorageImpactAssumptions;
  readonly carbonGramsCo2: NumberRange;
  readonly energyWattHours: NumberRange;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly savedBytes: number;
  readonly terabyteHours: number;
}

export type ReplacementStatus = "confirmed" | "hypothetical" | "retained";

export type ImpactUnavailableReason = "no-reduction" | "not-comparable" | "original-retained";

export interface ConversionImpactInput {
  /** False for transformations such as PDF-to-images where sizes do not represent the same artifact. */
  readonly comparable: boolean;
  readonly inputBytes: number;
  /** Sum all outputs only when they are jointly comparable with the input. */
  readonly outputBytes: number;
  readonly replacement: ReplacementStatus;
}

export interface ConversionImpactEstimateResult {
  readonly basis: "confirmed" | "hypothetical";
  readonly estimate: StorageImpactEstimate;
  readonly kind: "estimate";
  readonly measurement: ByteReductionMeasurement;
}

export interface ConversionImpactUnavailableResult {
  readonly kind: "unavailable";
  readonly measurement: ByteReductionMeasurement;
  readonly reason: ImpactUnavailableReason;
}

export type ConversionImpactResult =
  ConversionImpactEstimateResult | ConversionImpactUnavailableResult;

export interface DailyAccumulationInput {
  /** Number of equal daily additions in the modeled period. */
  readonly activeDays: number;
  readonly dailySavedBytes: number;
}

export interface DailyAccumulationEstimate {
  readonly activeDays: number;
  readonly carbonGramsCo2: NumberRange;
  readonly dailySavedBytes: number;
  readonly energyWattHours: NumberRange;
  readonly factors: StorageImpactFactors;
  readonly modelId: string;
  readonly modelVersion: string;
  /** Modeled quantity; it may be larger than JavaScript's safe-integer byte range. */
  readonly savedBytesAtPeriodEnd: number;
  readonly terabyteHours: number;
}
