import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- Native runner helper intentionally uses dependency-free ESM.
import { smokeInstalledMacApp } from "../scripts/macos-dmg-install-smoke.mjs";

describe("final DMG installed-copy conversion smoke", () => {
  it.each(["valid", "timeout", "crash", "missing-marker", "missing-output"])(
    "handles %s without altering the mounted app",
    (mode) => {
      const calls: Array<{ command: string; args: string[] }> = [];
      const execute = (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        calls.push({ command, args });
        if (!command.endsWith("/imgconvert")) return { status: 0, stdout: "" };
        expect(command).not.toContain("/mounted/");
        expect(command).toContain("中文 安装/ImgConvert.app/Contents/MacOS/imgconvert");
        if (mode === "timeout") return { status: null, error: new Error("ETIMEDOUT") };
        if (mode === "crash") return { status: 70, stderr: "conversion failed" };
        const output = options.env.IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR!;
        mkdirSync(output, { recursive: true });
        for (const extension of ["jpg", "webp", "png", "avif"]) {
          if (mode !== "missing-output" || extension !== "avif")
            writeFileSync(path.join(output, `smoke.${extension}`), "converted bytes");
        }
        return {
          status: 0,
          stdout:
            mode === "missing-marker"
              ? ""
              : "imgconvert package conversion smoke passed: jpeg,webp,png,avif\n",
        };
      };
      const invoke = () =>
        smokeInstalledMacApp("/mounted/ImgConvert.app", "imgconvert", {
          execute,
          platform: "darwin",
        });
      if (mode === "valid") expect(invoke).not.toThrow();
      else expect(invoke).toThrow();
      expect(calls[0].command).toBe("ditto");
      expect(calls[1].command).toBe("codesign");
    },
  );
});
