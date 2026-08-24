// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauriRoot = path.join(repoRoot, "src-tauri");
const generatedRoot = path.join(srcTauriRoot, "target", "macos-mas");

const options = {
  allowMissingProfile: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg === "--allow-missing-profile") {
    options.allowMissingProfile = true;
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!truthy(process.env.IMGCONVERT_DISABLE_UPDATER)) {
  fail(
    "MAS/Store build requires IMGCONVERT_DISABLE_UPDATER=1; Mac App Store updates must come from the App Store",
  );
}

const tauriConfig = readJson(path.join(srcTauriRoot, "tauri.conf.json"));
const identifier = tauriConfig.identifier;
const teamId = process.env.APPLE_TEAM_ID?.trim();
const profile = provisionProfilePath();

if (!/^[A-Z0-9]{10}$/.test(teamId ?? "")) {
  fail(
    "APPLE_TEAM_ID is required for MAS entitlements and must look like a 10-character Apple team ID",
  );
}
if (!/^([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+$/.test(identifier ?? "")) {
  fail(`tauri.conf.json identifier is not a reverse-DNS bundle id: ${identifier ?? "<missing>"}`);
}
if (!profile && !options.allowMissingProfile) {
  fail(
    "IMGCONVERT_MAS_PROVISION_PROFILE or IMGCONVERT_MAS_PROVISION_PROFILE_BASE64 is required for MAS release builds",
  );
}

mkdirSync(generatedRoot, { recursive: true });

const generatedProfile = profile?.generatedPath ?? profile?.path;
const entitlementsPath = path.join(generatedRoot, "entitlements.macos.mas.generated.plist");
const configPath = path.join(generatedRoot, "tauri.macos.mas.generated.conf.json");
const entitlementTemplatePath = path.join(srcTauriRoot, "entitlements.macos.mas.plist");

writeFileSync(
  entitlementsPath,
  masEntitlements(readFileSync(entitlementTemplatePath, "utf8"), teamId, identifier),
);
writeFileSync(
  configPath,
  JSON.stringify(
    {
      $schema: "https://schema.tauri.app/config/2",
      app: {
        security: {
          // MAS updates come from the App Store; omit the updater capability.
          capabilities: ["default"],
        },
      },
      bundle: {
        macOS: {
          minimumSystemVersion: "12.0",
          hardenedRuntime: true,
          entitlements: "target/macos-mas/entitlements.macos.mas.generated.plist",
          infoPlist: "Info.macos.mas.plist",
          files: generatedProfile
            ? {
                "embedded.provisionprofile": generatedProfile,
              }
            : {},
        },
      },
    },
    null,
    2,
  ),
);

console.log(path.relative(repoRoot, configPath));

function provisionProfilePath() {
  const base64 = process.env.IMGCONVERT_MAS_PROVISION_PROFILE_BASE64?.trim();
  if (base64) {
    const generatedPath = path.join(generatedRoot, "embedded.provisionprofile");
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(generatedPath, Buffer.from(base64, "base64"));
    return { generatedPath };
  }

  const configured = process.env.IMGCONVERT_MAS_PROVISION_PROFILE?.trim();
  if (!configured) {
    return null;
  }
  const profilePath = path.resolve(configured);
  if (!existsSync(profilePath)) {
    fail(`MAS provisioning profile does not exist: ${configured}`);
  }
  return { path: profilePath };
}

function masEntitlements(template, teamId, identifier) {
  const closingDict = "</dict>";
  const closingDictIndex = template.lastIndexOf(closingDict);
  if (closingDictIndex < 0 || template.indexOf(closingDict) !== closingDictIndex) {
    fail("entitlements.macos.mas.plist must contain exactly one closing dict");
  }
  for (const dynamicKey of [
    "com.apple.application-identifier",
    "com.apple.developer.team-identifier",
  ]) {
    if (template.includes(`<key>${dynamicKey}</key>`)) {
      fail(`entitlements.macos.mas.plist must not define generated entitlement ${dynamicKey}`);
    }
  }

  const generatedEntitlements = `  <key>com.apple.application-identifier</key>
  <string>${escapeXml(`${teamId}.${identifier}`)}</string>
  <key>com.apple.developer.team-identifier</key>
  <string>${escapeXml(teamId)}</string>
`;
  return `${template.slice(0, closingDictIndex)}${generatedEntitlements}${template.slice(
    closingDictIndex,
  )}`;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`failed to read ${path.relative(repoRoot, file)}: ${error.message}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
