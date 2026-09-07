// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { githubApi } from "./github-release-client.mjs";

export function validateExtensionAvailability(release) {
  const extension = release.browserExtension;
  if (!extension || !/^\d{4}-\d{2}-\d{2}$/u.test(release.verifiedAt ?? ""))
    throw new Error("public release needs dated extension availability evidence");
  if (
    extension.sourceUrl !== null &&
    !/^https:\/\/github\.com\/web-casa\/ImgConvert\/tree\/[0-9a-f]{40}\/browser-extension$/u.test(
      extension.sourceUrl ?? "",
    )
  ) {
    throw new Error("extension source must use a verified immutable source URL or null");
  }
  if (extension.version === null) {
    if (extension.chromeZipUrl !== null || extension.edgeZipUrl !== null)
      throw new Error("unpublished extension must not expose ZIP download links");
    return;
  }
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/u.test(extension.version ?? ""))
    throw new Error("invalid published extension version");
  for (const browser of ["chrome", "edge"]) {
    const expected = `https://github.com/web-casa/ImgConvert/releases/download/v${release.version}/imgconvert-${browser}-mv3-${extension.version}.zip`;
    if (extension[`${browser}ZipUrl`] !== expected)
      throw new Error("extension ZIP must name an exact verified public release asset");
  }
}

export function verifyRemoteAvailability(release, api = githubApi) {
  validateExtensionAvailability(release);
  const remote = api("repos/web-casa/ImgConvert/releases/latest");
  if (remote.draft || remote.tag_name !== `v${release.version}`)
    throw new Error("public-release.json differs from the latest public GitHub Release");
  const extension = release.browserExtension;
  for (const browser of ["chrome", "edge"]) {
    const matches = remote.assets.filter(
      (asset) => asset.name.startsWith(`imgconvert-${browser}-mv3-`) && asset.name.endsWith(".zip"),
    );
    if (extension.version === null) {
      if (matches.length !== 0) throw new Error("extension availability record is stale");
    } else if (
      matches.length !== 1 ||
      matches[0].browser_download_url !== extension[`${browser}ZipUrl`] ||
      matches[0].size <= 0
    ) {
      throw new Error("declared extension ZIP is not available in the public Release");
    }
  }
  if (extension.sourceUrl) {
    const sha = extension.sourceUrl.split("/").at(-2);
    api(`repos/web-casa/ImgConvert/contents/browser-extension/package.json?ref=${sha}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== "--remote"))
      throw new Error("only --remote is supported");
    const root = new URL("../", import.meta.url);
    const release = JSON.parse(readFileSync(new URL("docs/public-release.json", root), "utf8"));
    validateExtensionAvailability(release);
    if (release.browserExtension.version === null) {
      for (const [file, required] of [
        ["README.md", "Browser-extension Release ZIPs are not yet published"],
        ["README.zh-CN.md", "浏览器扩展尚未发布 ZIP"],
      ]) {
        const text = readFileSync(new URL(file, root), "utf8");
        if (!text.includes(required) || /\[Chrome\/Edge ZIPs\]\[latest-release\]/u.test(text))
          throw new Error(`${file} overstates extension availability`);
      }
    }
    if (process.argv.includes("--remote")) verifyRemoteAvailability(release);
    console.log("Extension availability declarations verified");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
