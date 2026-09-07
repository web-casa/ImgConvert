// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
  DEFAULT_STORAGE_IMPACT_FACTORS_V1,
  STORAGE_IMPACT_MODEL_V1,
  calculateConversionImpact,
  createStorageImpactAssumptions,
  estimateDailyAccumulationImpact,
  estimateStorageImpact,
  measureByteReduction,
} from "../src/index.js";

const DECIMAL_MEGABYTE = 1_000_000;

describe("byte reduction measurement", () => {
  it("reports measured savings without turning growth into negative savings", () => {
    expect(measureByteReduction(12_400_000, 3_100_000)).toEqual({
      byteDifference: 9_300_000,
      inputBytes: 12_400_000,
      outputBytes: 3_100_000,
      reductionFraction: 0.75,
      savedBytes: 9_300_000,
    });
    expect(measureByteReduction(100, 120)).toEqual({
      byteDifference: -20,
      inputBytes: 100,
      outputBytes: 120,
      reductionFraction: 0,
      savedBytes: 0,
    });
  });

  it("rejects unsafe, fractional, and negative byte counts", () => {
    expect(() => measureByteReduction(-1, 0)).toThrow(/inputBytes/u);
    expect(() => measureByteReduction(1.5, 0)).toThrow(/inputBytes/u);
    expect(() => measureByteReduction(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow(/inputBytes/u);
    expect(() => measureByteReduction(1, Number.NaN)).toThrow(/outputBytes/u);
  });
});

describe("storage impact estimate", () => {
  it("matches the documented one-megabyte, one-year model range", () => {
    const estimate = estimateStorageImpact(DECIMAL_MEGABYTE);

    expect(estimate.modelVersion).toBe("1.0.0");
    expect(estimate.terabyteHours).toBeCloseTo(0.00876, 12);
    expect(estimate.energyWattHours.min).toBeCloseTo(0.0062634, 12);
    expect(estimate.energyWattHours.max).toBeCloseTo(0.03737016, 10);
    expect(estimate.carbonGramsCo2.min).toBeCloseTo(0.0029625882, 12);
    expect(estimate.carbonGramsCo2.max).toBeCloseTo(0.01767608568, 10);
  });

  it("defensively copies and freezes caller-owned assumptions", () => {
    const mutable = {
      ...DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
      pue: { max: 1.2, min: 1.1 },
    };
    const assumptions = createStorageImpactAssumptions(mutable);
    mutable.pue.min = 1;

    expect(assumptions.pue.min).toBe(1.1);
    expect(Object.isFrozen(assumptions)).toBe(true);
    expect(Object.isFrozen(assumptions.pue)).toBe(true);
  });

  it("rejects physically invalid factors and numeric overflow", () => {
    expect(() =>
      createStorageImpactAssumptions({
        ...DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
        pue: { max: 1.1, min: 0.9 },
      }),
    ).toThrow(/pue.min/u);
    expect(() =>
      createStorageImpactAssumptions({
        ...DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
        replicationFactor: { max: 1, min: 2 },
      }),
    ).toThrow(/cannot exceed/u);
    expect(() =>
      estimateStorageImpact(Number.MAX_SAFE_INTEGER, {
        ...DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
        retentionDays: Number.MAX_VALUE,
      }),
    ).toThrow(/numeric range|terabyte-hours/u);
  });
});

describe("conversion claim boundary", () => {
  it("marks an explicit replacement and a hypothetical replacement differently", () => {
    const confirmed = calculateConversionImpact({
      comparable: true,
      inputBytes: 12_400_000,
      outputBytes: 3_100_000,
      replacement: "confirmed",
    });
    const hypothetical = calculateConversionImpact({
      comparable: true,
      inputBytes: 12_400_000,
      outputBytes: 3_100_000,
      replacement: "hypothetical",
    });

    expect(confirmed.kind).toBe("estimate");
    expect(confirmed.kind === "estimate" && confirmed.basis).toBe("confirmed");
    expect(hypothetical.kind === "estimate" && hypothetical.basis).toBe("hypothetical");
  });

  it("refuses claims for retained originals, incomparable conversions, and larger outputs", () => {
    expect(
      calculateConversionImpact({
        comparable: true,
        inputBytes: 200,
        outputBytes: 100,
        replacement: "retained",
      }),
    ).toMatchObject({ kind: "unavailable", reason: "original-retained" });
    expect(
      calculateConversionImpact({
        comparable: false,
        inputBytes: 200,
        outputBytes: 100,
        replacement: "hypothetical",
      }),
    ).toMatchObject({ kind: "unavailable", reason: "not-comparable" });
    expect(
      calculateConversionImpact({
        comparable: true,
        inputBytes: 100,
        outputBytes: 120,
        replacement: "hypothetical",
      }),
    ).toMatchObject({ kind: "unavailable", reason: "no-reduction" });
  });

  it("validates runtime values even when TypeScript declarations are bypassed", () => {
    expect(() =>
      calculateConversionImpact({
        comparable: "yes" as never,
        inputBytes: 200,
        outputBytes: 100,
        replacement: "hypothetical",
      }),
    ).toThrow(/comparable/u);
    expect(() =>
      calculateConversionImpact({
        comparable: true,
        inputBytes: 200,
        outputBytes: 100,
        replacement: "deleted" as never,
      }),
    ).toThrow(/replacement/u);
  });
});

describe("daily accumulation scenario", () => {
  it("models six billion daily one-megabyte savings over a year without telemetry", () => {
    const estimate = estimateDailyAccumulationImpact(
      { activeDays: 365, dailySavedBytes: 6_000_000_000_000_000 },
      {
        ...DEFAULT_STORAGE_IMPACT_FACTORS_V1,
        replicationFactor: { max: 1, min: 1 },
      },
    );

    expect(estimate.savedBytesAtPeriodEnd).toBe(2_190_000_000_000_000_000);
    expect(estimate.terabyteHours).toBe(9_618_480_000);
    expect(estimate.energyWattHours.min / 1_000_000_000).toBeCloseTo(6.8772132, 7);
    expect(estimate.energyWattHours.max / 1_000_000_000).toBeCloseTo(13.67747856, 7);
    expect(estimate.carbonGramsCo2.min / 1_000_000_000).toBeCloseTo(3.252922, 6);
    expect(estimate.carbonGramsCo2.max / 1_000_000_000).toBeCloseTo(6.469447, 6);
  });

  it("returns zero for an empty period and rejects unsafe day counts", () => {
    expect(estimateDailyAccumulationImpact({ activeDays: 0, dailySavedBytes: 1 })).toMatchObject({
      energyWattHours: { max: 0, min: 0 },
      savedBytesAtPeriodEnd: 0,
      terabyteHours: 0,
    });
    expect(() => estimateDailyAccumulationImpact({ activeDays: 1.5, dailySavedBytes: 1 })).toThrow(
      /activeDays/u,
    );
  });
});

describe("model metadata", () => {
  it("is versioned, source-linked, and deeply immutable at its public boundaries", () => {
    expect(STORAGE_IMPACT_MODEL_V1.id).toBe("imgconvert.storage-operational-impact");
    expect(STORAGE_IMPACT_MODEL_V1.sources).toHaveLength(2);
    expect(Object.isFrozen(STORAGE_IMPACT_MODEL_V1)).toBe(true);
    expect(Object.isFrozen(STORAGE_IMPACT_MODEL_V1.sources)).toBe(true);
    expect(Object.isFrozen(STORAGE_IMPACT_MODEL_V1.sources[0])).toBe(true);
    expect(Object.isFrozen(DEFAULT_STORAGE_IMPACT_FACTORS_V1.pue)).toBe(true);
  });
});
