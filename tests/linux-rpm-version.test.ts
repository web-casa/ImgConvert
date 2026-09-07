// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("rejects an old RPM header despite a current-version filename", () => {
  const root = mkdtempSync(path.join(tmpdir(), "imgconvert-rpm-version-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(path.join(root, "bin"));
    const bundles = path.join(root, "src-tauri/target/release/bundle/rpm");
    mkdirSync(bundles, { recursive: true });
    copyFileSync("scripts/check-linux-bundle-artifacts.mjs", path.join(root, "scripts/check.mjs"));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.3.1" }));
    writeFileSync(path.join(bundles, "ImgConvert-0.3.1-1.aarch64.rpm"), "simulated old RPM");
    // Mock only the external RPM tools; execute the entire production gate.
    writeFileSync(
      path.join(root, "bin/rpm"),
      '#!/bin/sh\nif [ "$1" = "-qp" ] && [ "$2" = "--queryformat" ]; then printf 0.2.23; exit 0; fi\necho unexpected-rpm-query >&2; exit 9\n',
      { mode: 0o755 },
    );
    for (const name of ["rpm2cpio", "cpio"]) {
      writeFileSync(
        path.join(root, "bin", name),
        "#!/bin/sh\necho unexpected-extraction >&2; exit 9\n",
        { mode: 0o755 },
      );
    }
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts/check.mjs"), "--bundles=rpm"],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` },
        timeout: 10000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("rpm version mismatch: expected 0.3.1, got 0.2.23");
    expect(result.stderr).not.toContain("unexpected-");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
