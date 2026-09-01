// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { requiresForbiddenLicense } from "../scripts/license-policy.mjs";

describe("npm license policy", () => {
  it("allows a permissive SPDX OR choice", () => {
    expect(requiresForbiddenLicense("(MIT OR GPL-3.0-or-later)")).toBe(false);
    expect(requiresForbiddenLicense("Apache-2.0 OR MIT")).toBe(false);
  });

  it("requires every SPDX AND term to remain permissive", () => {
    expect(requiresForbiddenLicense("(MIT OR GPL-3.0-or-later) AND Apache-2.0")).toBe(false);
    expect(requiresForbiddenLicense("MIT AND LGPL-3.0-only")).toBe(true);
  });

  it("rejects expressions with no permissive choice and legacy GPL labels", () => {
    expect(requiresForbiddenLicense("GPL-2.0-only OR AGPL-3.0-only")).toBe(true);
    expect(requiresForbiddenLicense("GNU General Public License v3")).toBe(true);
  });
});
