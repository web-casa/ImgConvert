// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";

const browser = process.argv
  .find((argument) => argument.startsWith("--browser="))
  ?.slice("--browser=".length);

if (browser !== "chrome" && browser !== "edge") {
  throw new Error("Expected --browser=chrome or --browser=edge");
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(pnpm, ["exec", "wxt", "build", "-b", browser], {
  env: { ...process.env, IMGCONVERT_RUNTIME_DIAGNOSTICS: "1" },
  shell: false,
  stdio: "inherit",
});

const exitCode = await new Promise((resolvePromise, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`Diagnostics build terminated by ${signal}`));
      return;
    }
    resolvePromise(code ?? 1);
  });
});

if (exitCode !== 0) process.exitCode = exitCode;
