// SPDX-License-Identifier: Apache-2.0
import { windowsReleaseAssetNames } from "./windows-release-assets.mjs";

export const releaseEvidenceWorkflows = Object.freeze({
  linux: "linux-release-assets-finalize.yml",
  windows: "windows-release-assets-finalize.yml",
  "macos-x64": "macos-notarization-finalize.yml",
  "macos-arm64": "macos-notarization-finalize.yml",
  extensions: "browser-extension-release-assets-finalize.yml",
  updater: "release-updater.yml",
});

export function releaseEvidenceName(group) {
  if (!Object.hasOwn(releaseEvidenceWorkflows, group))
    throw new Error("unknown release evidence group");
  return `release-evidence-${group}.json`;
}

// Finalizer ownership is also the publication allowlist. AppImageHub is an explicit,
// byte-identical alias of the updater AppImage, never a second architecture slot.
export function githubReleaseAssetGroups(version, extensionVersion) {
  windowsReleaseAssetNames(version); // Validate the desktop version before interpolating names.
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/u.test(extensionVersion ?? "")) {
    throw new Error("extension version must come from the release tag");
  }
  const updater = `ImgConvert_${version}_amd64.AppImage`;
  const hub = `ImgConvert-${version}-x86_64.AppImage`;
  return {
    linux: [
      `ImgConvert_${version}_amd64.deb`,
      `ImgConvert_${version}_arm64.deb`,
      `ImgConvert-${version}-1.x86_64.rpm`,
      `ImgConvert-${version}-1.aarch64.rpm`,
      `ImgConvert_${version}_aarch64.AppImage`,
    ],
    windows: windowsReleaseAssetNames(version),
    "macos-x64": [`ImgConvert_${version}_x64.dmg`],
    "macos-arm64": [`ImgConvert_${version}_arm64.dmg`],
    extensions: ["chrome", "edge"].map(
      (browser) => `imgconvert-${browser}-mv3-${extensionVersion}.zip`,
    ),
    updater: [updater, `${updater}.sig`, hub, `${hub}.sig`, "latest.json"],
  };
}
