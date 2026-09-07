// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { estimateStorageImpact, formatImpactRange, scenarioAssumptions } from "../src/index.js";

describe("environmental scenario presentation", () => {
  it("keeps a 1 MB one-year hypothetical visible in milligrams", () => {
    const estimate = estimateStorageImpact(1_000_000, scenarioAssumptions(365, 0));
    expect(formatImpactRange(estimate.carbonGramsCo2, "carbon", "en-US")).toBe("2.96–17.7 mg CO₂");
    expect(formatImpactRange(estimate.energyWattHours, "energy", "en-US")).toBe(
      "0.00626–0.0374 Wh",
    );
    expect(formatImpactRange({ min: 0.000000001, max: 0.000000002 }, "carbon", "en-US")).not.toBe(
      "0 mg CO₂",
    );
  });
  it("supports a fixed copy count without compounding default replication", () => {
    const one = estimateStorageImpact(1_000_000, scenarioAssumptions(365, 1));
    const three = estimateStorageImpact(1_000_000, scenarioAssumptions(365, 3));
    expect(three.energyWattHours.max).toBeCloseTo(one.energyWattHours.max * 3, 12);
    expect(scenarioAssumptions(0, 0).retentionDays).toBe(0);
  });
  it("rejects blank, fractional, nonfinite and out-of-bounds scenario values", () => {
    for (const days of [NaN, Infinity, -1, 1.5, 3651])
      expect(() => scenarioAssumptions(days, 1)).toThrow();
    for (const copies of [-1, 1.5, 4, NaN])
      expect(() => scenarioAssumptions(365, copies)).toThrow();
    expect(() => formatImpactRange({ min: 1, max: Infinity }, "energy", "en-US")).toThrow();
    expect(() => formatImpactRange({ min: 2, max: 1 }, "carbon", "en-US")).toThrow();
  });
});
