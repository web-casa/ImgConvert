// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import { nextConversionIncludesPdf } from "./pdf-settings";

const pdf = Object.freeze({ format: "pdf" });
const png = Object.freeze({ format: "png" });

describe("PDF settings scope", () => {
  it("validates PDF settings when a ready PDF will be converted", () => {
    expect(nextConversionIncludesPdf([{ probe: pdf, state: "ready" }])).toBe(true);
    expect(
      nextConversionIncludesPdf([
        { probe: png, state: "ready" },
        { probe: pdf, state: "ready" },
      ]),
    ).toBe(true);
  });

  it("does not let completed or cancelled PDFs block unrelated ready images", () => {
    expect(
      nextConversionIncludesPdf([
        { probe: pdf, state: "done" },
        { probe: png, state: "ready" },
      ]),
    ).toBe(false);
    expect(
      nextConversionIncludesPdf([
        { probe: pdf, state: "cancelled" },
        { probe: png, state: "ready" },
      ]),
    ).toBe(false);
  });

  it("validates a completed PDF when Convert again will reset completed entries", () => {
    expect(nextConversionIncludesPdf([{ probe: pdf, state: "done" }])).toBe(true);
    expect(
      nextConversionIncludesPdf([
        { probe: pdf, state: "done" },
        { probe: png, state: "done" },
      ]),
    ).toBe(true);
  });

  it("ignores failed, cancelled, and unprobed entries", () => {
    expect(
      nextConversionIncludesPdf([
        { probe: pdf, state: "failed" },
        { probe: pdf, state: "cancelled" },
        { state: "ready" },
      ]),
    ).toBe(false);
  });
});
