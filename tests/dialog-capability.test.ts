// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".mjs", ".svelte", ".ts"].includes(extname(path)) ? [path] : [];
  });
}

function capabilityPermissionsForWindow(windowLabel: string): string[] {
  return readdirSync(join("src-tauri", "capabilities"))
    .filter((entry) => entry.endsWith(".json"))
    .flatMap((entry) => {
      const capability = JSON.parse(
        readFileSync(join("src-tauri", "capabilities", entry), "utf8"),
      ) as {
        windows?: string[];
        permissions?: Array<string | { identifier?: string }>;
      };
      if (!(capability.windows ?? []).includes(windowLabel)) return [];
      return (capability.permissions ?? []).map((permission) =>
        typeof permission === "string" ? permission : (permission.identifier ?? ""),
      );
    });
}

describe("dialog capability guardrail", () => {
  it("grants dialog:allow-message whenever the frontend uses native confirmations", () => {
    const usesMessageDialog = sourceFiles("src").some((path) => {
      const source = readFileSync(path, "utf8");
      if (!source.includes("@tauri-apps/plugin-dialog")) return false;
      return /\b(confirm|ask|message)\b/.test(source);
    });
    expect(usesMessageDialog).toBe(true);

    // plugin-dialog's confirm()/ask()/message() invoke `plugin:dialog|message`,
    // which is denied unless a capability explicitly allows it.
    expect(capabilityPermissionsForWindow("main")).toContain("dialog:allow-message");
  });
});
