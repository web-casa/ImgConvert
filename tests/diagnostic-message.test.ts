// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { diagnosticDetailForDisplay } from "../src/lib/diagnostic-message";

describe("plugin diagnostic details", () => {
  it("redacts backend detail in production", () => {
    expect(
      diagnosticDetailForDisplay(
        "Unable to read /Users/alice/private-codecs",
        false,
        "Details are hidden.",
      ),
    ).toBe("Details are hidden.");
  });

  it("keeps backend detail available while developing", () => {
    expect(
      diagnosticDetailForDisplay("decoder HRESULT 0x80004005", true, "Details are hidden."),
    ).toBe("decoder HRESULT 0x80004005");
  });
});
