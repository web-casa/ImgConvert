// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { expect, it } from "vitest";

it("refuses lifecycle removal outside Docker or for AppImage", () => {
  for (const args of [["--bundle=deb"], ["--bundle=appimage", "--image=unused"]]) {
    const run = spawnSync(
      process.execPath,
      ["scripts/smoke-linux-package-install.mjs", ...args, "--upgrade-from=/missing"],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("host removal is not supported");
  }
});

it("rejects same-version and downgrade fixtures before installing either package", () => {
  const source = readFileSync("scripts/smoke-linux-package-install.mjs", "utf8");
  const context = vm.createContext({
    options: { bundle: "deb", upgradeFrom: "previous", timeoutSeconds: 3 },
    process: { env: {} },
  });
  vm.runInContext(source.slice(source.indexOf("function dockerSmokeScript(")), context);
  const script = vm.runInContext('dockerSmokeScript("/tmp/current.deb")', context);
  const root = mkdtempSync(path.join(tmpdir(), "imgconvert-lifecycle-guard-"));
  try {
    writeFileSync(
      path.join(root, "apt-get"),
      '#!/bin/sh\ncase "$*" in *deb*) echo unexpected-package-install >&2; exit 90;; esac\nexit 0\n',
      { mode: 0o755 },
    );
    writeFileSync(
      path.join(root, "dpkg-deb"),
      '#!/bin/sh\ncase "$3" in Package) printf img-convert;; Architecture) printf arm64;; Version) case "$2" in *previous*) printf "$OLD_VERSION";; *) printf 0.3.1;; esac;; esac\n',
      { mode: 0o755 },
    );
    for (const oldVersion of ["0.3.1", "0.4.0", "invalid"]) {
      const run = spawnSync("sh", ["-c", script], {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, OLD_VERSION: oldVersion },
      });
      expect(run.status).toBe(1);
      expect(run.stderr).not.toContain("unexpected-package-install");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
