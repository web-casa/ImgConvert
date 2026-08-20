// SPDX-License-Identifier: Apache-2.0

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  profile: "release",
  bundles: ["dmg"],
  requireSigned: false,
  requireNotarized: false,
  requireMas: false,
  artifacts: [],
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--bundles=")) {
    options.bundles = arg
      .slice("--bundles=".length)
      .split(",")
      .map((bundle) => bundle.trim().toLowerCase())
      .filter(Boolean);
  } else if (arg === "--require-signed") {
    options.requireSigned = true;
  } else if (arg === "--require-notarized") {
    options.requireNotarized = true;
  } else if (arg === "--require-mas") {
    options.requireMas = true;
  } else if (arg.startsWith("--artifact=")) {
    options.artifacts.push(path.resolve(arg.slice("--artifact=".length)));
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!["debug", "release"].includes(options.profile)) {
  fail(`unsupported profile: ${options.profile}`);
}

for (const bundle of options.bundles) {
  if (!["app", "dmg"].includes(bundle)) {
    fail(`unsupported macOS bundle: ${bundle}`);
  }
}
if (options.artifacts.length > 0 && options.bundles.length !== 1) {
  fail("--artifact requires exactly one --bundles value");
}

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const tauriConfig = JSON.parse(
  readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"),
);
const expectedName = tauriConfig.productName ?? "ImgConvert";
const bundleRoot = path.join(cargoTargetRoot(), options.profile, "bundle");
const failures = [];
const verified = [];

for (const bundle of options.bundles) {
  const bundleDir = path.join(bundleRoot, bundle === "app" ? "macos" : bundle);
  const artifacts =
    options.artifacts.length > 0
      ? options.artifacts
      : collectFiles(bundleDir).filter((file) => {
          if (bundle === "dmg") return file.toLowerCase().endsWith(".dmg");
          return file.toLowerCase().endsWith(".app");
        });
  if (artifacts.length === 0) {
    failures.push(`missing ${bundle} artifact under ${path.relative(repoRoot, bundleDir)}`);
    continue;
  }

  for (const artifact of artifacts) {
    const expectedExtension = bundle === "dmg" ? ".dmg" : ".app";
    if (!artifact.toLowerCase().endsWith(expectedExtension)) {
      failures.push(`explicit artifact does not match ${bundle}: ${artifact}`);
      continue;
    }
    if (!existsSync(artifact)) {
      failures.push(`explicit artifact does not exist: ${artifact}`);
      continue;
    }
    verifyArtifact(bundle, artifact, expectedName, packageJson.version);
  }
}

for (const item of verified) {
  console.log(`ok ${path.relative(repoRoot, item.artifact)} (${item.size} bytes)`);
}

if (failures.length > 0) {
  console.error("macOS bundle artifact check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`macOS bundle artifact check passed (${verified.length} artifact(s)).`);

function verifyArtifact(bundle, artifact, expectedName, expectedVersion) {
  const basename = path.basename(artifact);
  const size = statSync(artifact).size;
  if (size <= 0) {
    failures.push(`empty artifact: ${path.relative(repoRoot, artifact)}`);
    return;
  }
  if (!basename.toLowerCase().includes(expectedName.toLowerCase())) {
    failures.push(
      `artifact name must include ${expectedName}: ${path.relative(repoRoot, artifact)}`,
    );
    return;
  }
  if (bundle === "dmg" && !basename.includes(expectedVersion)) {
    failures.push(
      `DMG artifact name does not contain version ${expectedVersion}: ${path.relative(repoRoot, artifact)}`,
    );
    return;
  }
  if (bundle === "app") {
    verifyAppBundle(artifact, expectedName, expectedVersion);
  }
  if (options.requireSigned) {
    verifyCodesign(artifact);
  }
  if (options.requireMas && bundle === "app") {
    verifyMasAppBundle(artifact, tauriConfig.identifier);
  }
  if (options.requireNotarized) {
    verifyGatekeeper(artifact);
  }
  verified.push({ artifact, size });
}

function verifyAppBundle(appPath, expectedName, expectedVersion) {
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  const executableName =
    process.platform === "darwin" && existsSync(infoPlist)
      ? readPlistValue(infoPlist, "CFBundleExecutable")
      : null;
  const executableCandidates = [
    executableName,
    expectedName,
    packageJson.name,
    "imgconvert",
  ].filter(Boolean);
  const executable = executableCandidates
    .map((name) => path.join(appPath, "Contents", "MacOS", name))
    .find((candidate) => existsSync(candidate));
  if (!existsSync(infoPlist)) {
    failures.push(`missing app Info.plist: ${path.relative(repoRoot, appPath)}`);
  }
  if (!executable) {
    failures.push(
      `missing app executable under ${path.relative(repoRoot, path.join(appPath, "Contents", "MacOS"))}`,
    );
  }
  if (process.platform === "darwin" && existsSync(infoPlist)) {
    const name = readPlistValue(infoPlist, "CFBundleName");
    const shortVersion = readPlistValue(infoPlist, "CFBundleShortVersionString");
    const identifier = readPlistValue(infoPlist, "CFBundleIdentifier");
    if (name && name !== expectedName) {
      failures.push(`unexpected CFBundleName ${name}, expected ${expectedName}`);
    }
    if (shortVersion && shortVersion !== expectedVersion) {
      failures.push(
        `unexpected CFBundleShortVersionString ${shortVersion}, expected ${expectedVersion}`,
      );
    }
    if (identifier && identifier !== "com.ivmm.imgconvert") {
      failures.push(`unexpected CFBundleIdentifier ${identifier}`);
    }
  }
}

function verifyCodesign(artifact) {
  if (process.platform !== "darwin") {
    failures.push("--require-signed can only be verified on macOS");
    return;
  }
  if (artifact.toLowerCase().endsWith(".dmg")) {
    verifyAppsInsideMountedDmg(artifact);
    return;
  }
  verifyCodesignTarget(artifact);
}

function verifyAppsInsideMountedDmg(dmgPath) {
  const mountPoint = mkdtempSync(path.join(os.tmpdir(), "imgconvert-dmg-mount-"));
  const attach = spawnSync(
    "hdiutil",
    ["attach", dmgPath, "-nobrowse", "-noautoopen", "-readonly", "-mountpoint", mountPoint],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PAGER: "/bin/cat" },
      input: "Y\n",
    },
  );
  if (attach.status !== 0) {
    const details = `${attach.stdout ?? ""}\n${attach.stderr ?? ""}`.trim();
    failures.push(`failed to mount DMG for codesign verification: ${details || "unknown error"}`);
    return [];
  }
  try {
    const apps = collectFiles(mountPoint).filter((file) => file.toLowerCase().endsWith(".app"));
    if (apps.length === 0) {
      failures.push(
        `mounted DMG does not contain an .app bundle: ${path.relative(repoRoot, dmgPath)}`,
      );
    }
    for (const app of apps) {
      verifyCodesignTarget(app);
    }
  } finally {
    const detach = spawnSync("hdiutil", ["detach", mountPoint, "-quiet"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (detach.status === 0) {
      rmSync(mountPoint, { recursive: true, force: true });
    } else {
      failures.push(`failed to detach verified DMG: ${detach.stderr.trim() || "unknown error"}`);
    }
  }
}

function verifyCodesignTarget(artifact) {
  const result = spawnSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", artifact],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    failures.push(
      `codesign verification failed for ${path.relative(repoRoot, artifact)}: ${result.stderr.trim()}`,
    );
  }
}

function verifyMasAppBundle(appPath, identifier) {
  if (process.platform !== "darwin") {
    failures.push("--require-mas can only be verified on macOS");
    return;
  }

  const profile = path.join(appPath, "Contents", "embedded.provisionprofile");
  if (!existsSync(profile)) {
    failures.push(`missing MAS provisioning profile: ${path.relative(repoRoot, profile)}`);
    return;
  }

  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "imgconvert-mas-check-"));
  try {
    verifyMasSigningAuthority(appPath);
    verifyMasPlists(appPath, profile, identifier, temporaryRoot);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function verifyMasSigningAuthority(appPath) {
  const result = spawnSync("codesign", ["-d", "--verbose=4", appPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const details = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    failures.push(`unable to inspect MAS signing authority: ${details.trim()}`);
  } else if (!/Authority=(Apple Distribution|3rd Party Mac Developer Application):/.test(details)) {
    failures.push("MAS app is not signed by an Apple Distribution certificate");
  }
}

function verifyMasPlists(appPath, profile, identifier, temporaryRoot) {
  const entitlementsPath = path.join(temporaryRoot, "entitlements.plist");
  const profilePath = path.join(temporaryRoot, "profile.plist");
  if (!writeCodesignEntitlements(appPath, entitlementsPath)) return;
  if (!decodeProvisioningProfile(profile, profilePath)) return;

  const teamId = readPlistValue(profilePath, "TeamIdentifier:0");
  const expectedApplicationId = teamId ? `${teamId}.${identifier}` : null;
  requirePlistValue(entitlementsPath, "com.apple.security.app-sandbox", "true");
  requirePlistValue(entitlementsPath, "com.apple.security.files.user-selected.read-write", "true");
  requirePlistValue(entitlementsPath, "com.apple.security.files.bookmarks.app-scope", "true");
  requirePlistValue(entitlementsPath, "com.apple.developer.team-identifier", teamId);
  requirePlistValue(entitlementsPath, "com.apple.application-identifier", expectedApplicationId);
  requirePlistValue(
    profilePath,
    "Entitlements:com.apple.application-identifier",
    expectedApplicationId,
  );
  if (readPlistValue(entitlementsPath, "com.apple.security.get-task-allow") === "true") {
    failures.push("MAS app must not enable com.apple.security.get-task-allow");
  }
}

function writeCodesignEntitlements(appPath, destination) {
  const result = spawnSync("codesign", ["-d", "--entitlements", ":-", appPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    failures.push(`unable to read MAS entitlements: ${result.stderr.trim()}`);
    return false;
  }
  writeFileSync(destination, result.stdout);
  return true;
}

function decodeProvisioningProfile(profile, destination) {
  const result = spawnSync("security", ["cms", "-D", "-i", profile, "-o", destination], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0 || !existsSync(destination)) {
    failures.push(`unable to decode MAS provisioning profile: ${result.stderr.trim()}`);
    return false;
  }
  return true;
}

function requirePlistValue(plistPath, key, expected) {
  const value = readPlistValue(plistPath, key);
  if (!expected || value !== expected) {
    failures.push(`unexpected ${key}: ${value ?? "<missing>"}, expected ${expected ?? "<value>"}`);
  }
}

function verifyGatekeeper(artifact) {
  if (process.platform !== "darwin") {
    failures.push("--require-notarized can only be verified on macOS");
    return;
  }
  const result = spawnSync(
    "spctl",
    ["--assess", "--type", "open", "--context", "context:primary-signature", "-v", artifact],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    failures.push(
      `Gatekeeper assessment failed for ${path.relative(repoRoot, artifact)}: ${result.stderr.trim()}`,
    );
  }
}

function readPlistValue(plistPath, key) {
  const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plistPath], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function collectFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.endsWith(".app")) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isDirectory() && entry.name.endsWith(".app")) {
      files.push(entryPath);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function cargoTargetRoot() {
  return process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(repoRoot, "src-tauri", "target");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
