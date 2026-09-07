// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import vm from "node:vm";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "linux")(
  "rejects misleading ldd static output for an ELF with real dynamic dependencies",
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "imgconvert-ldd-arch-"));
    try {
      const input = path.join(root, "main.c");
      writeFileSync(input, '#include <stdio.h>\nint main(void) { return puts("fixture") < 0; }');
      const binary = path.join(root, "dynamic");
      execFileSync("cc", [input, "-o", binary]);
      expect(execFileSync("readelf", ["-d", binary], { encoding: "utf8" })).toContain("(NEEDED)");
      const source = readFileSync("scripts/check-linux-bundle-artifacts.mjs", "utf8");
      for (const output of ["not a dynamic executable", "statically linked"]) {
        const context = vm.createContext({
          spawnSync,
          path,
          process,
          options: { target: "" },
        });
        vm.runInContext(source.slice(source.indexOf("function inspectLinuxExecutable(")), context);
        const original = context.commandOutput;
        context.commandOutput = (command: string, ...args: unknown[]) =>
          command === "ldd"
            ? { ok: false, stdout: "", stderr: output }
            : original(command, ...args);
        const inspect = vm.runInContext("inspectLinuxExecutable", context);
        expect(inspect(binary, "fixture").join(" ")).toContain("matching-architecture runtime");
        context.commandOutput = (command: string, ...args: unknown[]) =>
          command === "readelf"
            ? { ok: false, stdout: "", stderr: "unreadable" }
            : command === "ldd"
              ? { ok: false, stdout: "", stderr: output }
              : original(command, ...args);
        expect(inspect(binary, "fixture").join(" ")).toContain("cannot verify");
      }
      const staticBinary = path.join(root, "static");
      execFileSync("cc", ["-static", input, "-o", staticBinary]);
      const context = vm.createContext({ spawnSync, path, process, options: { target: "" } });
      vm.runInContext(source.slice(source.indexOf("function inspectLinuxExecutable(")), context);
      expect(
        vm.runInContext("inspectLinuxExecutable", context)(staticBinary, "static fixture"),
      ).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
