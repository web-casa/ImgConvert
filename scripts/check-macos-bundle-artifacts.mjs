// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  profile: "release",
  bundles: ["dmg"],
  requireSigned: false,
  requireNotarized: false,
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
  const artifacts = collectFiles(bundleDir).filter((file) => {
    if (bundle === "dmg") return file.toLowerCase().endsWith(".dmg");
    return file.toLowerCase().endsWith(".app");
  });
  if (artifacts.length === 0) {
    failures.push(`missing ${bundle} artifact under ${path.relative(repoRoot, bundleDir)}`);
    continue;
  }

  for (const artifact of artifacts) {
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
  const mountPoint = path.join(
    "/Volumes",
    `imgconvert-verify-${process.pid}-${Date.now().toString(16)}`,
  );
  const attach = spawnSync(
    "hdiutil",
    ["attach", dmgPath, "-nobrowse", "-readonly", "-mountpoint", mountPoint],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  if (attach.status !== 0) {
    failures.push(`failed to mount DMG for codesign verification: ${attach.stderr.trim()}`);
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
    spawnSync("hdiutil", ["detach", mountPoint, "-quiet"], { cwd: repoRoot });
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
