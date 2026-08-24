// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packScript = readFileSync(path.join(repoRoot, "scripts", "pack-windows-msix.mjs"), "utf8");
const storeWorkflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "windows-store-release.yml"),
  "utf8",
);

describe("Windows MSIX packaging contract", () => {
  it("round-trips a packed MSIX instead of invoking an unsupported MakeAppx command", () => {
    expect(packScript).toContain("inspectPackedMsix(makeappx, output, manifest, architecture)");
    expect(packScript).toContain('["unpack", "/p", output, "/d", inspectionDir]');
    expect(packScript).not.toContain('["validate", "/p", output]');
  });

  it("checks the packaged identity, executable architecture, and Store assets", () => {
    expect(packScript).toContain("packed MSIX Identity");
    expect(packScript).toContain("packed MSIX ImgConvert.exe architecture");
    expect(packScript).toContain("unpacked MSIX does not contain Store asset");
  });

  it("permits only the reviewed host-side packaging fix for legacy release tags", () => {
    expect(storeWorkflow).toContain("Verify trusted workflow ref");
    expect(storeWorkflow).toContain(
      "Restore reviewed Store packaging tooling for a legacy release tag",
    );
    expect(storeWorkflow).toContain(
      "git restore --source=$toolingCommit -- scripts/pack-windows-msix.mjs",
    );
    expect(storeWorkflow).toContain(
      "Legacy tooling compatibility may only replace scripts/pack-windows-msix.mjs",
    );
  });
});
