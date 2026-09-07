// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import vm from "node:vm";
import { expect, it } from "vitest";

it("infers the container architecture from the build target", () => {
  const source = readFileSync("scripts/smoke-linux-package-install.mjs", "utf8");
  const parse = source.slice(source.indexOf("const options ="), source.indexOf("const artifact ="));
  for (const [target, platform] of [
    ["x86_64-unknown-linux-gnu", "linux/amd64"],
    ["aarch64-unknown-linux-gnu", "linux/arm64"],
    ["", ""],
  ]) {
    const context = vm.createContext({
      process: { argv: ["node", "smoke", "--image=ubuntu:22.04", `--target=${target}`] },
      fail: (message: string) => {
        throw new Error(message);
      },
    });
    vm.runInContext(parse, context);
    expect(vm.runInContext("options.platform", context)).toBe(platform);
  }
});

it("rejects unsupported, host-only and conflicting Docker platforms before execution", () => {
  for (const args of [
    ["--platform=linux/amd64"],
    ["--image=unused", "--platform=linux/unknown"],
    ["--image=unused", "--platform=linux/arm64", "--target=x86_64-unknown-linux-gnu"],
  ]) {
    const run = spawnSync(process.execPath, ["scripts/smoke-linux-package-install.mjs", ...args], {
      encoding: "utf8",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("--platform");
  }
});

it("passes the selected platform as Docker arguments", () => {
  const source = readFileSync("scripts/smoke-linux-package-install.mjs", "utf8");
  let captured: string[] = [];
  const context = vm.createContext({
    path,
    options: { platform: "linux/amd64", image: "ubuntu:22.04" },
  });
  vm.runInContext(source.slice(source.indexOf("function smokeInDocker(")), context);
  context.resolveDockerCommand = () => ({ command: "docker", prefixArgs: [] });
  context.dockerSmokeScript = () => "exit 0";
  context.run = (_command: string, args: string[]) => {
    captured = args;
  };
  vm.runInContext('smokeInDocker("/tmp/candidate.deb")', context);
  expect(captured.slice(0, 4)).toEqual(["run", "--rm", "--platform", "linux/amd64"]);
  expect(captured).toContain("/tmp/candidate.deb:/tmp/imgconvert-package.deb:ro");
});
