#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Assembles the GPUI build into ImgConvert.app and either a DMG (direct
# distribution, signed with the given identity or ad hoc with "-") or, with
# GPUI_MAS=1, a Mac App Store installer package. Notarization and App Store
# validation are separate steps.
#
# Usage: scripts/package-gpui-macos.sh <binary> <out-dir> [identity]
# Mac App Store mode also reads GPUI_MAS_INSTALLER_IDENTITY, APPLE_TEAM_ID and
# GPUI_MAS_PROFILE (the provisioning profile to embed).
set -euo pipefail

binary=$1
out=$2
identity=${3:--}
mas=${GPUI_MAS:-0}
root=${IMGCONVERT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}

test -x "$binary" || { echo "not an executable: $binary" >&2; exit 1; }
# The bundle version is the GPUI crate version without a pre-release suffix:
# CFBundleShortVersionString accepts only numeric components.
version=$(sed -n 's/^version = "\(.*\)"/\1/p' "$root/apps/gpui/Cargo.toml" | head -1)
short_version=${version%%-*}
[[ $short_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "unexpected version: $version" >&2; exit 1; }
# CFBundleVersion is a separate, increasing build number (App Store Connect
# rejects a build version it has already processed); CI passes its run
# number, local builds default to 1.
build_number=${GPUI_BUILD_NUMBER:-1}
[[ $build_number =~ ^[1-9][0-9]{0,8}$ ]] || { echo "GPUI_BUILD_NUMBER must be a positive integer: $build_number" >&2; exit 1; }

app="$out/ImgConvert.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/imgconvert"
cp "$root/src-tauri/icons/icon.icns" "$app/Contents/Resources/icon.icns"
# The same required-reason privacy manifest as the Tauri bundle.
cp "$root/src-tauri/PrivacyInfo.xcprivacy" "$app/Contents/Resources/PrivacyInfo.xcprivacy"

# The binary must really run on macOS 12: LSMinimumSystemVersion only gates
# launch, so check the deployment target each slice was built for.
for slice in $(lipo -archs "$binary"); do
  minos=$(otool -arch "$slice" -l "$binary" | awk '/LC_BUILD_VERSION/ { found = 1 } found && $1 == "minos" { print $2; exit }')
  [ -n "$minos" ] || { echo "no LC_BUILD_VERSION in the $slice slice" >&2; exit 1; }
  IFS=. read -r major minor _ <<< "$minos"
  if [ "$major" -gt 12 ] || { [ "$major" -eq 12 ] && [ "${minor:-0}" -gt 0 ]; }; then
    echo "the $slice slice requires macOS $minos; build with MACOSX_DEPLOYMENT_TARGET=12.0" >&2
    exit 1
  fi
done
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>ImgConvert</string>
  <key>CFBundleExecutable</key><string>imgconvert</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleIdentifier</key><string>com.ivmm.imgconvert</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleLocalizations</key>
  <array>
    <string>en</string><string>zh-Hans</string><string>zh-Hant</string><string>ja</string>
    <string>ko</string><string>fr</string><string>es</string><string>pt-BR</string><string>de</string>
  </array>
  <key>CFBundleName</key><string>ImgConvert</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$short_version</string>
  <key>CFBundleVersion</key><string>$build_number</string>
  <key>ITSAppUsesNonExemptEncryption</key><false/>
  <key>LSApplicationCategoryType</key><string>public.app-category.photography</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Copyright © 2026 ImgConvert contributors. Apache-2.0.</string>
  <key>NSAppleMusicUsageDescription</key>
  <string>ImgConvert scans the contents of folders you explicitly select, including a selected folder in your media library, to find image files for the local conversion queue. For example, it can convert album-art images in that folder locally; it does not read Apple Music playback or listening activity.</string>
</dict>
</plist>
PLIST
plutil -lint "$app/Contents/Info.plist" >/dev/null

if [ "$mas" = 1 ]; then
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required for the Mac App Store package}"
  : "${GPUI_MAS_PROFILE:?GPUI_MAS_PROFILE (provisioning profile) is required}"
  : "${GPUI_MAS_INSTALLER_IDENTITY:?GPUI_MAS_INSTALLER_IDENTITY is required}"
  [[ $APPLE_TEAM_ID =~ ^[A-Z0-9]{10}$ ]] || { echo "APPLE_TEAM_ID must be a 10-character team ID" >&2; exit 1; }
  [ "$identity" != "-" ] || { echo "the Mac App Store package needs a signing identity" >&2; exit 1; }
  cp "$GPUI_MAS_PROFILE" "$app/Contents/embedded.provisionprofile"
  # The sandbox template plus the identifiers the profile grants.
  entitlements=$(mktemp)
  cp "$root/apps/gpui/packaging/entitlements.macos.mas.plist" "$entitlements"
  plutil -insert com.apple.application-identifier -string "$APPLE_TEAM_ID.com.ivmm.imgconvert" "$entitlements"
  plutil -insert com.apple.developer.team-identifier -string "$APPLE_TEAM_ID" "$entitlements"
  codesign --force --sign "$identity" --options runtime --timestamp --entitlements "$entitlements" "$app"
  rm -f "$entitlements"
  codesign --verify --deep --strict --verbose=2 "$app"
  pkg="$out/ImgConvert_${short_version}_mas.pkg"
  rm -f "$pkg"
  # Only the package path goes to stdout: callers capture it.
  xcrun productbuild --sign "$GPUI_MAS_INSTALLER_IDENTITY" --component "$app" /Applications "$pkg" >&2
  echo "$short_version" > "$out/VERSION"
  echo "$pkg"
  exit 0
fi

sign_args=(--force --sign "$identity")
if [ "$identity" != "-" ]; then
  # Hardened runtime with no exceptions, as the Tauri direct build.
  sign_args+=(--options runtime --timestamp --entitlements "$root/src-tauri/entitlements.macos.direct.plist")
fi
codesign "${sign_args[@]}" "$app"
codesign --verify --deep --strict --verbose=2 "$app"

arch=$(lipo -archs "$app/Contents/MacOS/imgconvert" | tr ' ' '-')
dmg="$out/ImgConvert_${short_version}_${arch}.dmg"
staging=$(mktemp -d)
cp -R "$app" "$staging/"
ln -s /Applications "$staging/Applications"
rm -f "$dmg"
hdiutil create -volname ImgConvert -srcfolder "$staging" -ov -format UDZO "$dmg" >/dev/null
rm -rf "$staging"
if [ "$identity" != "-" ]; then
  codesign --force --sign "$identity" --timestamp "$dmg"
fi
echo "$short_version" > "$out/VERSION"
echo "$dmg"
