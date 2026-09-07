// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { expect, it } from "vitest";

it("rejects user image changes during upgraded app startup before recording removal baselines", () => {
  const source = readFileSync("scripts/smoke-linux-package-install.mjs", "utf8");
  const context = vm.createContext({
    options: { bundle: "deb", upgradeFrom: "previous", timeoutSeconds: 3 },
    process: { env: {} },
  });
  vm.runInContext(source.slice(source.indexOf("function dockerSmokeScript(")), context);
  // Only package-manager and application behavior are simulated; checksum sequencing is production code.
  context.conversionSmokeCommand = () =>
    'mkdir -p "$IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR"; printf image > "$IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR/smoke.png"';
  context.launchCommand = () => `
    if [ "$IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR" = /tmp/imgconvert-lifecycle/new-output ]; then
      if [ "$DAMAGE" = original ]; then printf damaged > /tmp/imgconvert-lifecycle/pictures/original.png; fi
      if [ "$DAMAGE" = old-output ]; then printf damaged > /tmp/imgconvert-lifecycle/old-output/smoke.png; fi
      printf '%s' '{ "settings": { "locale": "zh-CN", "quality": 37 } }' > "$XDG_CONFIG_HOME/com.ivmm.imgconvert/settings.json"
    fi`;
  const generated: string = vm.runInContext('dockerSmokeScript("/tmp/current.deb")', context);
  const lines = generated.split("\n");
  const start = lines.findIndex((line) => line.startsWith("export XDG_CONFIG_HOME="));
  const end = lines.findIndex((line) => line.includes("> /tmp/before-remove.sha256"));
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  for (const damage of ["none", "original", "old-output"]) {
    const root = mkdtempSync(path.join(tmpdir(), "imgconvert-lifecycle-files-"));
    try {
      const bin = path.join(root, "bin");
      mkdirSync(bin);
      writeFileSync(
        path.join(bin, "apt-get"),
        '#!/bin/sh\ncase "$*" in *previous*) echo 0.2.8 > "$FIXTURE_STATE";; *current*) echo 0.3.1 > "$FIXTURE_STATE";; esac\n',
        { mode: 0o755 },
      );
      writeFileSync(path.join(bin, "dpkg-query"), '#!/bin/sh\ncat "$FIXTURE_STATE"\n', {
        mode: 0o755,
      });
      const script =
        "set -eu\nold_version=0.2.8\nnew_version=0.3.1\npackage=img-convert\n" +
        lines.slice(start, end).join("\n").replaceAll("/tmp/", `${root}/`) +
        "\necho lifecycle-user-files-verified";
      const result = spawnSync("sh", ["-c", script], {
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FIXTURE_STATE: path.join(root, "state"),
          DAMAGE: damage,
        },
      });
      expect(result.status, result.stderr).toBe(damage === "none" ? 0 : 1);
      if (damage === "none") expect(result.stdout).toContain("lifecycle-user-files-verified");
      else {
        expect(result.stdout).toContain("FAILED");
        expect(result.stdout).not.toContain("lifecycle-user-files-verified");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
