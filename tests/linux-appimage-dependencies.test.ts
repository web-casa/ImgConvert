// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import vm from "node:vm";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "linux")(
  "resolves AppImage private libraries but still rejects a missing library",
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "imgconvert-appimage-libs-"));
    try {
      const lib = path.join(root, "usr/lib");
      mkdirSync(lib, { recursive: true });
      writeFileSync(path.join(root, "dependency.c"), "int fixture_value(void) { return 42; }");
      writeFileSync(
        path.join(root, "plugin.c"),
        "extern int fixture_value(void); int fixture_plugin(void) { return fixture_value(); }",
      );
      const dependency = path.join(lib, "libimgconvert_test_private.so");
      const plugin = path.join(lib, "plugin.so");
      execFileSync("cc", [
        "-shared",
        "-fPIC",
        path.join(root, "dependency.c"),
        "-Wl,-soname,libimgconvert_test_private.so",
        "-o",
        dependency,
      ]);
      execFileSync("cc", [
        "-shared",
        "-fPIC",
        path.join(root, "plugin.c"),
        `-L${lib}`,
        "-limgconvert_test_private",
        "-o",
        plugin,
      ]);
      const source = readFileSync("scripts/check-linux-bundle-artifacts.mjs", "utf8");
      const context = vm.createContext({ spawnSync, path, process, options: { target: "" } });
      vm.runInContext(source.slice(source.indexOf("function inspectLinuxExecutable(")), context);
      const inspect = vm.runInContext("inspectLinuxExecutable", context);
      expect(inspect(plugin, "plain").join(" ")).toContain(
        "libimgconvert_test_private.so => not found",
      );
      expect(inspect(plugin, "AppImage bundled ELF", root)).toEqual([]);
      rmSync(dependency);
      expect(inspect(plugin, "AppImage bundled ELF", root).join(" ")).toContain(
        "libimgconvert_test_private.so => not found",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
