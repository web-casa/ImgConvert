// SPDX-License-Identifier: Apache-2.0

export interface SidePanelConfigurationDependencies {
  readonly action: {
    setBadgeBackgroundColor(details: { color: string }): Promise<void>;
    setBadgeText(details: { text: string }): Promise<void>;
  };
  readonly sidePanel: {
    setPanelBehavior(details: { openPanelOnActionClick: boolean }): Promise<void>;
  };
}

export async function configureActionSidePanel(
  dependencies: SidePanelConfigurationDependencies,
): Promise<void> {
  try {
    await dependencies.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await dependencies.action.setBadgeText({ text: "" });
  } catch (error) {
    await Promise.allSettled([
      dependencies.action.setBadgeBackgroundColor({ color: "#a64a42" }),
      dependencies.action.setBadgeText({ text: "!" }),
    ]);
    throw error;
  }
}
