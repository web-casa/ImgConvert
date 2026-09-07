// SPDX-License-Identifier: Apache-2.0
import { mount } from "svelte";

import App from "./App.svelte";
import "./style.css";

declare const __IMGCONVERT_RUNTIME_DIAGNOSTICS__: boolean;

const target = document.querySelector<HTMLDivElement>("#app");

if (target === null) {
  throw new Error("ImgConvert extension root element is missing");
}

mount(App, { target });

async function runPackagedRuntimeDiagnostics(status: HTMLOutputElement): Promise<void> {
  try {
    const { runRuntimeDiagnostics } = await import("../../src/runtime/diagnostics");
    const result = await runRuntimeDiagnostics((progress) => {
      status.textContent = JSON.stringify(progress);
    });
    status.dataset.state = "passed";
    status.textContent = JSON.stringify(result);
  } catch (error) {
    status.dataset.state = "failed";
    status.textContent =
      error instanceof Error ? error.message.slice(0, 512) : "Unknown runtime diagnostics failure";
  }
}

if (
  __IMGCONVERT_RUNTIME_DIAGNOSTICS__ &&
  new URL(window.location.href).searchParams.get("__imgconvert_runtime_check") === "1"
) {
  const status = document.createElement("output");
  status.id = "runtime-diagnostics";
  status.hidden = true;
  status.dataset.state = "running";
  document.body.append(status);
  void runPackagedRuntimeDiagnostics(status);
}
