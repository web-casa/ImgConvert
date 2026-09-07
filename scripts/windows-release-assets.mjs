// SPDX-License-Identifier: Apache-2.0
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configuration = JSON.parse(
  readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src-tauri/tauri.windows.conf.json",
    ),
    "utf8",
  ),
);
export const windowsReleaseLanguages = Object.freeze(configuration.bundle.windows.wix.language);
if (
  !Array.isArray(windowsReleaseLanguages) ||
  windowsReleaseLanguages.length === 0 ||
  new Set(windowsReleaseLanguages).size !== windowsReleaseLanguages.length ||
  windowsReleaseLanguages.some((language) => !/^[a-z]{2}-[A-Z]{2}$/u.test(language))
) {
  throw new Error("Windows release requires distinct explicit WiX language names");
}

export function windowsReleaseAssetNames(version, architectures = ["x64", "arm64"]) {
  if (!/^\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error("invalid Windows release version");
  }
  if (
    architectures.length === 0 ||
    architectures.some((arch) => !["x64", "arm64"].includes(arch))
  ) {
    throw new Error("invalid Windows release architecture");
  }
  return architectures.flatMap((architecture) => [
    ...windowsReleaseLanguages.map(
      (language) => `ImgConvert_${version}_${architecture}_${language}.msi`,
    ),
    `ImgConvert_${version}_${architecture}-setup.exe`,
  ]);
}

export function verifyWindowsReleaseAssetNames(assets, version, architectures) {
  const expected = windowsReleaseAssetNames(version, architectures);
  for (const name of expected) {
    if (assets.filter((asset) => asset === name).length !== 1) {
      throw new Error(`Windows release requires exactly one ${name}`);
    }
  }
  for (const name of assets.filter((asset) => /\.(?:msi|exe)$/iu.test(asset))) {
    if (!expected.includes(name)) throw new Error(`unexpected Windows installer: ${name}`);
  }
  return expected;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = Object.fromEntries(
      process.argv.slice(2).map((arg) => {
        const match = /^--(assets-dir|bundle-root|release-tag|architecture)=(.+)$/u.exec(arg);
        if (!match) throw new Error(`unknown argument: ${arg}`);
        return [match[1], match[2]];
      }),
    );
    if (!!args["assets-dir"] === !!args["bundle-root"] || !args["release-tag"]?.startsWith("v")) {
      throw new Error(
        "one of --assets-dir/--bundle-root and --release-tag=v<version> are required",
      );
    }
    const paths = args["bundle-root"]
      ? ["msi", "nsis"].flatMap((bundle) => {
          const directory = path.join(args["bundle-root"], bundle);
          return readdirSync(directory)
            .filter((name) => /\.(?:msi|exe)$/iu.test(name))
            .map((name) => path.join(directory, name));
        })
      : readdirSync(args["assets-dir"]).map((name) => path.join(args["assets-dir"], name));
    const assets = paths.map((file) => path.basename(file));
    const expected = verifyWindowsReleaseAssetNames(
      assets,
      args["release-tag"].slice(1),
      args.architecture ? [args.architecture] : undefined,
    );
    if (assets.length !== expected.length) throw new Error("unexpected Windows staging asset");
    for (const file of paths) {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
        throw new Error(`Windows installer must be a non-empty regular file: ${file}`);
      }
    }
    console.log(`Windows release matrix verified (${expected.length} installers)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
