// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  json: false,
  check: false,
  requireReady: false,
  requirePublishable: false,
  scope: "github",
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg === "--json") {
    options.json = true;
  } else if (arg === "--check") {
    options.check = true;
  } else if (arg === "--require-ready") {
    options.requireReady = true;
  } else if (arg === "--require-publishable") {
    options.requirePublishable = true;
  } else if (arg.startsWith("--scope=")) {
    options.scope = arg.slice("--scope=".length);
    if (!["github", "all"].includes(options.scope)) {
      fail(`unsupported scope: ${options.scope}`);
    }
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const packageScripts = packageJson.scripts ?? {};

const report = buildReport();

if (options.check) {
  const missingLocalChecks = report.localChecks.filter((item) => item.status === "missing");
  if (missingLocalChecks.length > 0) {
    for (const item of missingLocalChecks) {
      console.error(`missing local check script: ${item.id}`);
    }
    process.exit(1);
  }
  console.log("release readiness report check passed.");
} else if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

if (options.requirePublishable) {
  const publishBlocking = inScopeItems(report).filter((item) => item.status !== "ready");
  if (publishBlocking.length > 0) {
    console.error("release scope is not publishable:");
    for (const item of publishBlocking) {
      console.error(`- [${item.status}] ${item.label}: ${item.detail}`);
    }
    process.exit(1);
  }
} else if (options.requireReady && report.summary.blocking > 0) {
  process.exit(1);
}

function buildReport() {
  const localChecks = githubLocalChecks();
  const artifacts = githubArtifacts();
  const externalPrerequisites = [updaterPrerequisite(), updaterUpgradeSmokePrerequisite()];
  const deferredPrerequisites = [];

  if (options.scope === "all") {
    localChecks.splice(4, 0, ...storeAndFlatpakLocalChecks());
    artifacts.push(...platformArtifacts());
    externalPrerequisites.unshift(
      macosDirectPrerequisite(),
      macosMasPrerequisite(),
      windowsSigningPrerequisite(),
      windowsStorePrerequisite(),
    );
    externalPrerequisites.push(
      flathubMainPrerequisite(),
      flathubHeicPrerequisite(),
      macosBenchmarkPrerequisite(),
      windowsBenchmarkPrerequisite(),
      realCorpusFuzzPrerequisite(),
    );
  } else {
    deferredPrerequisites.push(
      flathubMainPrerequisite(),
      flathubHeicPrerequisite(),
      macosDirectPrerequisite(),
      macosMasPrerequisite(),
      windowsSigningPrerequisite(),
      windowsStorePrerequisite(),
      macosBenchmarkPrerequisite(),
      windowsBenchmarkPrerequisite(),
      realCorpusFuzzPrerequisite(),
    );
  }

  const allItems = [...localChecks, ...artifacts, ...externalPrerequisites];
  const summary = summarize(allItems);

  return {
    generatedAt: new Date().toISOString(),
    scope: options.scope,
    project: {
      packageName: packageJson.name,
      version: packageJson.version,
      productName: tauriConfig.productName,
      identifier: tauriConfig.identifier,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
    },
    summary,
    localChecks,
    artifacts,
    externalPrerequisites,
    deferredPrerequisites,
    nextActions: nextActions(localChecks, artifacts, externalPrerequisites),
  };
}

function githubLocalChecks() {
  return [
    commandReadiness("docs:check", "README and public status text must match the current roadmap."),
    commandReadiness("architecture:check", "Main architecture and license boundary guardrails."),
    commandReadiness(
      "ci:cost:check",
      "Public-repo GitHub Actions free standard runner guardrails.",
    ),
    commandReadiness(
      "release:platform:check",
      "macOS/Windows/Flatpak/updater static release guardrails.",
    ),
    commandReadiness("release:linux:verify", "Verify GitHub Release Linux package artifacts."),
    commandReadiness("release:updater:verify", "Verify Tauri updater latest.json and signatures."),
    commandReadiness("release:updater:smoke", "Verify public GitHub Release updater assets."),
    commandReadiness(
      "release:updater:upgrade-smoke:eligibility",
      "Verify old/new updater release metadata before the real GUI upgrade smoke.",
    ),
    commandReadiness(
      "test:image-quality",
      "Deterministic generated image quality/corruption suite.",
    ),
    commandReadiness(
      "fuzz:smoke",
      "Low-cost fuzz seed preparation, target compile, and corpus replay.",
    ),
  ];
}

function storeAndFlatpakLocalChecks() {
  return [
    commandReadiness(
      "release:flatpak:verify",
      "Flatpak main manifest and optional HEIC extension static checks.",
    ),
    commandReadiness(
      "release:flathub:metadata",
      "Flathub AppStream metadata and optional local linter entrypoint.",
    ),
    commandReadiness(
      "release:flathub:pr",
      "Generate main package and HEIC extension PR workspaces for Flathub review.",
    ),
    commandReadiness("bench:platform", "Local platform benchmark report generator."),
  ];
}

function githubArtifacts() {
  return [
    artifactReadiness(
      "linux-deb",
      "Linux .deb",
      "release:linux",
      [artifactDir("release", "bundle", "deb")],
      hasExtensionAndVersion(".deb"),
    ),
    artifactReadiness(
      "linux-rpm",
      "Linux .rpm",
      "release:linux",
      [artifactDir("release", "bundle", "rpm")],
      hasExtensionAndVersion(".rpm"),
    ),
    artifactReadiness(
      "linux-appimage",
      "Linux AppImage",
      "release:linux",
      [artifactDir("release", "bundle", "appimage")],
      hasExtensionAndVersion(".appimage"),
    ),
    linuxChecksumsReadiness(),
    artifactReadiness(
      "updater-appimage-signature",
      "Tauri updater AppImage signature",
      "release:updater:local",
      [artifactDir("release", "bundle", "appimage")],
      hasExtensionAndVersion(".appimage.sig"),
    ),
    updaterManifestReadiness(),
  ];
}

function platformArtifacts() {
  return [
    artifactReadiness(
      "macos-dmg",
      "macOS DMG",
      "release:macos",
      [artifactDir("release", "bundle", "dmg")],
      hasExtension(".dmg"),
    ),
    artifactReadiness(
      "macos-mas-app",
      "macOS MAS .app candidate",
      "release:macos:mas",
      [artifactDir("release", "bundle", "macos")],
      hasExtension(".app"),
    ),
    artifactReadiness(
      "windows-msi",
      "Windows MSI",
      "release:windows",
      [artifactDir("release", "bundle", "msi")],
      hasExtension(".msi"),
    ),
    artifactReadiness(
      "windows-nsis",
      "Windows NSIS .exe",
      "release:windows",
      [artifactDir("release", "bundle", "nsis")],
      hasExtension(".exe"),
    ),
  ];
}

function commandReadiness(scriptName, description) {
  const command = packageScripts[scriptName] ? `pnpm run ${scriptName}` : null;
  return {
    id: scriptName,
    label: scriptName,
    status: command ? "ready" : "missing",
    description,
    command,
    detail: command ? "script is wired" : "package.json script is missing",
  };
}

function artifactReadiness(id, label, buildScript, directories, matcher) {
  const artifacts = directories
    .flatMap((dir) => collectArtifacts(dir, matcher))
    .filter((artifact) => statSync(artifact).size > 0);
  return {
    id,
    label,
    status: artifacts.length > 0 ? "ready" : "missing",
    description: `${label} release artifact.`,
    command: packageScripts[buildScript] ? `pnpm run ${buildScript}` : null,
    detail:
      artifacts.length > 0
        ? artifacts.map((file) => path.relative(repoRoot, file)).join(", ")
        : `no artifact found under ${directories.map((dir) => path.relative(repoRoot, dir)).join(", ")}`,
  };
}

function linuxChecksumsReadiness() {
  const file = artifactDir("release", "bundle", "SHA256SUMS");
  const command = packageScripts["release:linux:checksums"]
    ? "pnpm run release:linux:checksums"
    : null;
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size <= 0) {
    return {
      id: "linux-sha256sums",
      label: "Linux SHA256SUMS",
      status: "missing",
      description: "Linux SHA256SUMS generated release file.",
      command,
      detail: `missing ${path.relative(repoRoot, file)}`,
    };
  }

  const artifactRoot = artifactDir("release", "bundle");
  const currentArtifacts = [
    ...collectArtifacts(path.join(artifactRoot, "deb"), hasExtensionAndVersion(".deb")),
    ...collectArtifacts(path.join(artifactRoot, "rpm"), hasExtensionAndVersion(".rpm")),
    ...collectArtifacts(path.join(artifactRoot, "appimage"), hasExtensionAndVersion(".appimage")),
  ];
  const expectedEntries = currentArtifacts
    .map((artifact) => path.relative(path.dirname(file), artifact))
    .sort();
  const checksumText = readFileSync(file, "utf8");
  const missingEntries = expectedEntries.filter((entry) => !checksumText.includes(`  ${entry}`));

  return {
    id: "linux-sha256sums",
    label: "Linux SHA256SUMS",
    status: expectedEntries.length > 0 && missingEntries.length === 0 ? "ready" : "missing",
    description: "Linux SHA256SUMS generated release file.",
    command,
    detail:
      expectedEntries.length === 0
        ? `no current-version Linux artifacts found under ${path.relative(repoRoot, artifactRoot)}`
        : missingEntries.length === 0
          ? `${path.relative(repoRoot, file)} covers ${expectedEntries.join(", ")}`
          : `missing checksum entries: ${missingEntries.join(", ")}`,
  };
}

function updaterManifestReadiness() {
  const file = path.join(repoRoot, "target", "updater", "latest.json");
  const command = packageScripts["release:updater:manifest"]
    ? "pnpm run release:updater:manifest"
    : null;
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size <= 0) {
    return {
      id: "updater-latest-json",
      label: "Tauri updater latest.json",
      status: "missing",
      description: "Tauri updater latest.json generated release file.",
      command,
      detail: `missing ${path.relative(repoRoot, file)}`,
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      id: "updater-latest-json",
      label: "Tauri updater latest.json",
      status: "missing",
      description: "Tauri updater latest.json generated release file.",
      command,
      detail: `invalid JSON: ${error.message}`,
    };
  }

  const platforms =
    manifest && typeof manifest.platforms === "object" && manifest.platforms
      ? Object.entries(manifest.platforms)
      : [];
  const invalidPlatform = platforms.find(([, entry]) => {
    if (!entry || typeof entry !== "object") {
      return true;
    }
    return (
      typeof entry.url !== "string" ||
      !entry.url.includes(packageJson.version) ||
      typeof entry.signature !== "string" ||
      entry.signature.trim().length < 40
    );
  });
  const ready =
    manifest?.version === packageJson.version && platforms.length > 0 && !invalidPlatform;

  return {
    id: "updater-latest-json",
    label: "Tauri updater latest.json",
    status: ready ? "ready" : "missing",
    description: "Tauri updater latest.json generated release file.",
    command,
    detail: ready
      ? `${path.relative(repoRoot, file)} version=${manifest.version} platforms=${platforms
          .map(([target]) => target)
          .join(", ")}`
      : `manifest must use version ${packageJson.version}, include at least one platform, and point at current signed artifacts`,
  };
}

function macosDirectPrerequisite() {
  const notarizationModes = [
    ["IMGCONVERT_NOTARYTOOL_PROFILE"],
    ["APPLE_API_KEY", "APPLE_API_ISSUER", "APPLE_API_KEY_PATH"],
    ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"],
  ];
  const hasNotarization = notarizationModes.some((mode) => envSet(mode));
  const hasSigningIdentity =
    envIsSet("APPLE_SIGNING_IDENTITY") || envIsSet("APPLE_DIRECT_CERTIFICATE");
  return {
    id: "macos-direct-notarization",
    label: "macOS direct signing/notarization",
    status:
      process.platform === "darwin" && hasSigningIdentity && hasNotarization ? "ready" : "external",
    description: "Requires a real macOS host plus Developer ID signing and notary credentials.",
    command: "pnpm run release:macos && pnpm run release:macos:notarize",
    detail:
      process.platform === "darwin"
        ? envDetail([
            "APPLE_SIGNING_IDENTITY",
            "APPLE_DIRECT_CERTIFICATE",
            ...notarizationModes.flat(),
          ])
        : "requires macOS runner or real macOS machine",
  };
}

function macosMasPrerequisite() {
  const envNames = [
    "APPLE_TEAM_ID",
    "IMGCONVERT_MAS_PROVISION_PROFILE",
    "IMGCONVERT_MAS_PROVISION_PROFILE_BASE64",
  ];
  const hasProvisionProfile =
    envIsSet("IMGCONVERT_MAS_PROVISION_PROFILE") ||
    envIsSet("IMGCONVERT_MAS_PROVISION_PROFILE_BASE64");
  return {
    id: "macos-mas-submission",
    label: "Mac App Store candidate",
    status:
      process.platform === "darwin" && envIsSet("APPLE_TEAM_ID") && hasProvisionProfile
        ? "ready"
        : "external",
    description:
      "Requires Apple Team ID, provisioning profile, signing identity, and MAS GUI acceptance.",
    command: "pnpm run release:macos:mas && pnpm run release:macos:mas:pkg",
    detail:
      process.platform === "darwin"
        ? envDetail(envNames)
        : "requires macOS runner or real macOS machine",
  };
}

function windowsSigningPrerequisite() {
  const hasCertificate =
    envIsSet("WINDOWS_CERTIFICATE_BASE64") ||
    envIsSet("WINDOWS_CERTIFICATE_PATH") ||
    envIsSet("WINDOWS_CERTIFICATE_SHA1");
  return {
    id: "windows-codesign",
    label: "Windows installer code signing",
    status: process.platform === "win32" && hasCertificate ? "ready" : "external",
    description: "Requires a Windows host, Authenticode certificate, and timestamp service.",
    command: "pnpm run release:windows && pnpm run release:windows:sign",
    detail:
      process.platform === "win32"
        ? envDetail([
            "WINDOWS_CERTIFICATE_BASE64",
            "WINDOWS_CERTIFICATE_PATH",
            "WINDOWS_CERTIFICATE_SHA1",
            "WINDOWS_CERTIFICATE_PASSWORD",
            "WINDOWS_TIMESTAMP_URL",
          ])
        : "requires Windows runner or real Windows machine",
  };
}

function windowsStorePrerequisite() {
  return {
    id: "windows-store",
    label: "Microsoft Store/MSIX submission",
    status: "external",
    description:
      "Requires Partner Center identity, MSIX signing, runFullTrust validation, assets, and store review.",
    command: "IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 pnpm run release:windows:store:check",
    detail: "repo-side preflight is wired; real Partner Center submission is external",
  };
}

function updaterPrerequisite() {
  const defaultKey = path.join(os.homedir(), ".tauri", "imgconvert-updater.key");
  const defaultPubkey = `${defaultKey}.pub`;
  const hasLocalKeyFiles = existsSync(defaultKey) && existsSync(defaultPubkey);
  const hasSigningKey =
    envIsSet("TAURI_SIGNING_PRIVATE_KEY") ||
    envIsSet("TAURI_SIGNING_PRIVATE_KEY_PATH") ||
    hasLocalKeyFiles;
  const hasPubkey =
    envIsSet("TAURI_UPDATER_PUBKEY") || envIsSet("TAURI_UPDATER_PUBKEY_PATH") || hasLocalKeyFiles;
  const ready =
    hasSigningKey &&
    hasPubkey &&
    (envIsSet("TAURI_UPDATER_ENDPOINTS") || packageScripts["release:updater:local"]);
  return {
    id: "tauri-updater-release",
    label: "Tauri updater release",
    status: ready ? "ready" : "external",
    description:
      "Requires updater signing key material and a HTTPS release endpoint; local defaults support GitHub Releases.",
    command: "pnpm run release:updater:local",
    detail: [
      `local default key files=${hasLocalKeyFiles ? "present" : "missing"}`,
      envDetail([
        "TAURI_UPDATER_PUBKEY",
        "TAURI_UPDATER_PUBKEY_PATH",
        "TAURI_SIGNING_PRIVATE_KEY",
        "TAURI_SIGNING_PRIVATE_KEY_PATH",
        "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
        "TAURI_UPDATER_ENDPOINTS",
        "TAURI_UPDATER_ARTIFACT_BASE_URL",
      ]),
    ].join("; "),
  };
}

function updaterUpgradeSmokePrerequisite() {
  const documentedPass = readText("docs/DEVLOG.md").includes(
    `Tauri in-app updater smoke passed: 0.1.0 -> ${packageJson.version}`,
  );
  const guiReady =
    process.platform === "linux" &&
    process.arch === "x64" &&
    commandExists("Xvfb") &&
    commandExists("xdotool");
  return {
    id: "tauri-in-app-updater-smoke",
    label: "Tauri in-app updater upgrade smoke",
    status: guiReady || documentedPass ? "ready" : "external",
    description:
      "Launches the old x86_64 AppImage, clicks the app update dialog, waits for replacement, then runs package smoke.",
    command: "pnpm run release:updater:upgrade-smoke",
    detail: documentedPass
      ? `GitHub workflow pass for 0.1.0 -> ${packageJson.version} is recorded in docs/DEVLOG.md`
      : guiReady
        ? "current host has linux/x64, Xvfb, and xdotool"
        : "requires linux/x64 desktop runner with Xvfb and xdotool; use the manual Updater Upgrade Smoke workflow",
  };
}

function flathubHeicPrerequisite() {
  const sampleConfigured = envIsSet("IMGCONVERT_FLATPAK_HEIC_SMOKE_INPUT");
  return {
    id: "flatpak-heic-addon-submission",
    label: "Flathub HEIC extension submission",
    status: sampleConfigured ? "ready" : "external",
    description:
      "Repo-side addon manifest and PR workspace are present; real Flathub addon review remains external.",
    command: "pnpm run release:flathub:heic-pr && pnpm run release:flatpak:heic:real-smoke",
    detail: sampleConfigured
      ? "IMGCONVERT_FLATPAK_HEIC_SMOKE_INPUT is set for real sandbox sample smoke"
      : "requires Flathub extension review, patent/channel acceptance, and a real HEIC sample or heif-enc",
  };
}

function flathubMainPrerequisite() {
  return {
    id: "flathub-main-submission",
    label: "Flathub main package submission",
    status: "external",
    description:
      "Repo-side Flatpak manifest, metadata checks, runtime smoke, and PR workspace generation are wired; real Flathub PR/review is external.",
    command:
      "pnpm run release:flatpak:verify && pnpm run release:flatpak:smoke && pnpm run release:flathub:main-pr",
    detail: "requires Flathub account/review and release source URL publication",
  };
}

function macosBenchmarkPrerequisite() {
  return {
    id: "macos-avif-arm64-benchmark",
    label: "Apple Silicon AVIF benchmark",
    status: process.platform === "darwin" && process.arch === "arm64" ? "ready" : "external",
    description: "Requires an Apple Silicon macOS host to lock platform AVIF speed assumptions.",
    command: "pnpm run bench:avif:macos",
    detail:
      process.platform === "darwin" && process.arch === "arm64"
        ? "current host can run the benchmark"
        : "requires Apple Silicon macOS runner or real machine",
  };
}

function windowsBenchmarkPrerequisite() {
  return {
    id: "windows-platform-benchmark",
    label: "Windows platform benchmark",
    status: process.platform === "win32" ? "ready" : "external",
    description:
      "Requires a real Windows host or runner to collect WebP/AVIF timing data for platform defaults.",
    command: "pnpm run bench:platform",
    detail:
      process.platform === "win32"
        ? "current host can run the Windows benchmark"
        : "requires Windows runner or real Windows machine",
  };
}

function realCorpusFuzzPrerequisite() {
  const configuredDirs = process.env.IMGCONVERT_REAL_CORPUS_DIRS?.trim();
  const localCorpusCount = countSupportedCorpusFiles(path.join(repoRoot, "corpus", "real"), 1);
  const ready = Boolean(configuredDirs) || localCorpusCount > 0;
  return {
    id: "real-image-corpus-fuzz",
    label: "Real image corpus fuzz/replay",
    status: ready ? "ready" : "external",
    description:
      "Generated seeds are repo-side; privacy-safe real-world corpus data must stay local and ignored.",
    command: "pnpm run fuzz:prepare:require-real && pnpm run fuzz:replay",
    detail: ready
      ? `real corpus source present (${configuredDirs ? "IMGCONVERT_REAL_CORPUS_DIRS" : "corpus/real"})`
      : "add private/copyright-cleared samples under corpus/real or set IMGCONVERT_REAL_CORPUS_DIRS",
  };
}

function summarize(items) {
  const summary = { ready: 0, missing: 0, external: 0, blocking: 0 };
  for (const item of items) {
    summary[item.status] = (summary[item.status] ?? 0) + 1;
    if (item.status === "missing") {
      summary.blocking += 1;
    }
  }
  return summary;
}

function inScopeItems(readinessReport) {
  return [
    ...readinessReport.localChecks,
    ...readinessReport.artifacts,
    ...readinessReport.externalPrerequisites,
  ];
}

function nextActions(localChecks, artifacts, externalPrerequisites) {
  const actions = [];
  const missingLocal = localChecks.filter((item) => item.status === "missing");
  if (missingLocal.length > 0) {
    actions.push(
      `restore missing package scripts: ${missingLocal.map((item) => item.id).join(", ")}`,
    );
  } else {
    actions.push("run cheap static checks: pnpm run release:platform:check");
  }

  const missingArtifacts = artifacts.filter((item) => item.status === "missing");
  if (missingArtifacts.length > 0) {
    actions.push(
      `build release artifacts when needed: ${[...new Set(missingArtifacts.map((item) => item.command).filter(Boolean))].join(", ")}`,
    );
  }

  const external = externalPrerequisites.filter((item) => item.status === "external");
  if (external.length > 0) {
    actions.push(`external validation remains: ${external.map((item) => item.label).join("; ")}`);
  }
  return actions;
}

function printReport(readinessReport) {
  console.log("ImgConvert release readiness");
  console.log(
    `scope=${readinessReport.scope} version=${readinessReport.project.version} product=${readinessReport.project.productName} platform=${readinessReport.project.platform}/${readinessReport.project.arch}`,
  );
  console.log(
    `summary ready=${readinessReport.summary.ready} missing=${readinessReport.summary.missing} external=${readinessReport.summary.external}`,
  );

  printSection("Local checks", readinessReport.localChecks);
  printSection("Artifacts", readinessReport.artifacts);
  printSection("External prerequisites", readinessReport.externalPrerequisites);
  if (readinessReport.deferredPrerequisites.length > 0) {
    printSection("Deferred for this scope", readinessReport.deferredPrerequisites);
  }

  console.log("\nNext actions:");
  for (const action of readinessReport.nextActions) {
    console.log(`- ${action}`);
  }
}

function printSection(title, items) {
  console.log(`\n${title}:`);
  for (const item of items) {
    console.log(`[${item.status}] ${item.label}`);
    if (item.command) {
      console.log(`  command: ${item.command}`);
    }
    console.log(`  detail: ${item.detail}`);
  }
}

function artifactDir(...segments) {
  return path.join(cargoTargetRoot(), ...segments);
}

function cargoTargetRoot() {
  return process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(repoRoot, "src-tauri", "target");
}

function collectArtifacts(dir, matcher) {
  if (!existsSync(dir)) {
    return [];
  }
  const artifacts = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (matcher(entryPath)) {
      artifacts.push(entryPath);
    } else if (entry.isDirectory()) {
      artifacts.push(...collectArtifacts(entryPath, matcher));
    }
  }
  return artifacts;
}

function hasExtension(extension) {
  return (file) => file.toLowerCase().endsWith(extension);
}

function hasExtensionAndVersion(extension) {
  return (file) =>
    hasExtension(extension)(file) && path.basename(file).includes(packageJson.version);
}

function envSet(envNames) {
  return envNames.every((name) => envIsSet(name));
}

function envIsSet(name) {
  return Boolean(process.env[name]?.trim());
}

function commandExists(command) {
  return existsSync(`/usr/bin/${command}`) || existsSync(`/usr/local/bin/${command}`);
}

function envDetail(envNames) {
  return envNames.map((name) => `${name}=${envIsSet(name) ? "set" : "missing"}`).join(", ");
}

function countSupportedCorpusFiles(dir, limit) {
  if (!existsSync(dir) || limit <= 0) {
    return 0;
  }
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (count >= limit) {
      break;
    }
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countSupportedCorpusFiles(entryPath, limit - count);
    } else if (entry.isFile()) {
      const extension = path.extname(entry.name).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".webp", ".avif"].includes(extension)) {
        count += 1;
      }
    }
  }
  return count;
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function printHelp() {
  console.log(`Usage: node scripts/report-release-readiness.mjs [options]

Options:
  --json             Print machine-readable JSON.
  --check            Validate report generation and local script wiring only.
  --require-ready    Exit non-zero when missing repo-local items are reported.
  --require-publishable
                     Exit non-zero when any in-scope item is not ready.
  --scope=<scope>    Release scope: github (default) or all.

This report is intentionally read-only. It does not build artifacts, run GitHub
Actions, perform network requests, or print secret values.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
