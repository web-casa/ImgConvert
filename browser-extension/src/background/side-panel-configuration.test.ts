// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";

import { configureActionSidePanel } from "./side-panel-configuration";

function fixture() {
  return {
    action: {
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      setBadgeText: vi.fn(async () => undefined),
    },
    sidePanel: {
      setPanelBehavior: vi.fn(async () => undefined),
    },
  };
}

describe("side-panel action configuration", () => {
  it("clears a stale error badge after configuration recovers", async () => {
    const dependencies = fixture();
    await expect(configureActionSidePanel(dependencies)).resolves.toBeUndefined();
    expect(dependencies.action.setBadgeText).toHaveBeenCalledWith({ text: "" });
  });

  it("shows a bounded error badge and preserves the configuration failure", async () => {
    const dependencies = fixture();
    dependencies.sidePanel.setPanelBehavior.mockRejectedValueOnce(new Error("temporary failure"));
    await expect(configureActionSidePanel(dependencies)).rejects.toThrow("temporary failure");
    expect(dependencies.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#a64a42" });
    expect(dependencies.action.setBadgeText).toHaveBeenCalledWith({ text: "!" });
  });
});
