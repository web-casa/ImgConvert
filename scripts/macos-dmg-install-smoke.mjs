// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function smokeInstalledMacApp(
  appPath,
  executableName,
  { execute = spawnSync, platform = process.platform } = {},
) {
  if (platform !== "darwin") throw new Error("DMG installation smoke requires macOS");
  if (!/^[A-Za-z0-9._-]+$/u.test(executableName)) throw new Error("unsafe app executable name");
  const root = mkdtempSync(path.join(tmpdir(), "imgconvert-dmg-install-"));
  const installed = path.join(root, "中文 安装", "ImgConvert.app");
  const output = path.join(root, "中文 转换 输出");
  const invoke = (command, args, env = process.env) => {
    const result = execute(command, args, {
      encoding: "utf8",
      timeout: 60_000,
      killSignal: "SIGKILL",
      env,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error(
        `DMG installation smoke failed: ${result.error?.message ?? result.stderr ?? result.status}`,
      );
    return result.stdout ?? "";
  };
  try {
    invoke("ditto", [appPath, installed]);
    invoke("codesign", ["--verify", "--deep", "--strict", installed]);
    const log = invoke(path.join(installed, "Contents", "MacOS", executableName), [], {
      ...process.env,
      IMGCONVERT_PACKAGE_CONVERT_SMOKE: "1",
      IMGCONVERT_PACKAGE_CONVERT_SMOKE_FORMATS: "jpeg,webp,png,avif",
      IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR: output,
    });
    if (
      !log
        .split(/\r?\n/u)
        .includes("imgconvert package conversion smoke passed: jpeg,webp,png,avif")
    ) {
      throw new Error("DMG installation smoke missing conversion success marker");
    }
    for (const extension of ["jpg", "webp", "png", "avif"]) {
      const stat = lstatSync(path.join(output, `smoke.${extension}`));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0)
        throw new Error(`DMG installation smoke missing ${extension} output`);
    }
    console.log("DMG installed copy passed jpeg,webp,png,avif conversion smoke");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
