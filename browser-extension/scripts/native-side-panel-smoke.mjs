// SPDX-License-Identifier: Apache-2.0

// Exercise real native panels: a tab at the same URL does not reproduce their
// missing MessageSender.tab/documentId or getContexts().windowId === -1.
export async function smokeNativeSidePanels(context, worker, extensionOrigin) {
  const control = await context.newPage();
  const windows = [];
  const windowsApi = async (method, args) =>
    control.evaluate(({ method, args }) => chrome.windows[method](args), { method, args });
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const result = await predicate();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Native side-panel smoke timed out: ${label}`);
  };
  try {
    await control.goto(`${extensionOrigin}/converter.html?surface=full`);
    await control.locator("#workspace").waitFor({ state: "visible" });
    for (let index = 0; index < 2; index++) {
      const window = await windowsApi("create", { url: "about:blank", focused: true });
      if (!Number.isSafeInteger(window.id)) throw new Error("Missing native smoke window ID");
      windows.push(window.id);
      await control.evaluate((windowId) => chrome.sidePanel.open({ windowId }), window.id);
    }
    const nativeContexts = await waitFor(async () => {
      const contexts = await worker.evaluate(() =>
        chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }),
      );
      const panels = contexts.filter(
        (item) => item.documentUrl === `${extensionOrigin}/converter.html?surface=side-panel`,
      );
      return panels.length === 2 ? panels : undefined;
    }, "two browser-owned side panels");

    await worker.evaluate(async (windowIds) => {
      const items = {};
      for (const windowId of windowIds) {
        items[`imgconvert.pendingImport.${windowId}`] = {
          createdAt: Date.now(),
          displayName: `native-${windowId}.png`,
          kind: "remote",
          nonce: crypto.randomUUID(),
          permissionPattern: "https://cdn.example.net/*",
          schemaVersion: 1,
          sourceOrigin: "https://cdn.example.net",
          sourceUrl: `https://cdn.example.net/native-${windowId}.png`,
        };
      }
      await chrome.storage.session.set(items);
    }, windows);
    await waitFor(
      async () =>
        worker.evaluate(async (windowIds) => {
          const stored = await chrome.storage.session.get(null);
          const local = await chrome.storage.local.get(null);
          const leases = Object.entries(local).filter(([key]) =>
            key.startsWith("imgconvert.permissionLease."),
          );
          return windowIds.every(
            (windowId) =>
              !(`imgconvert.pendingImport.${windowId}` in stored) &&
              leases.some(([, value]) => value.windowId === windowId),
          );
        }, windows),
      "each panel claims its own descriptor and registers a permission lease",
    );
    for (const id of windows) await windowsApi("remove", id);
    windows.length = 0;
    await waitFor(
      async () =>
        worker.evaluate(
          async () =>
            !Object.keys(await chrome.storage.local.get(null)).some((key) =>
              key.startsWith("imgconvert.permissionLease."),
            ),
        ),
      "closing native panels releases their leases",
    );
    return {
      windows: 2,
      nativeContextTypes: nativeContexts.map((item) => item.contextType),
      contextWindowIds: nativeContexts.map((item) => item.windowId),
      descriptorsConsumed: true,
      leaseRegistration: true,
      closeCleanup: true,
    };
  } finally {
    for (const id of windows) await windowsApi("remove", id).catch(() => undefined);
    await control.close();
  }
}
