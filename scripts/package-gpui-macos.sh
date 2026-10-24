#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Assembles the GPUI build into ImgConvert.app and a DMG, signed with the
# given identity (or ad hoc with "-"). Notarization is a separate step.
#
# Usage: scripts/package-gpui-macos.sh <binary> <out-dir> [identity]
set -euo pipefail

binary=$1
out=$2
identity=${3:--}
root=${IMGCONVERT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}

test -x "$binary" || { echo "not an executable: $binary" >&2; exit 1; }
# The bundle version is the GPUI crate version without a pre-release suffix:
# CFBundleShortVersionString accepts only numeric components.
version=$(sed -n 's/^version = "\(.*\)"/\1/p' "$root/apps/gpui/Cargo.toml" | head -1)
short_version=${version%%-*}
[[ $short_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "unexpected version: $version" >&2; exit 1; }

app="$out/ImgConvert.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/imgconvert"
cp "$root/src-tauri/icons/icon.icns" "$app/Contents/Resources/icon.icns"
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
  <key>CFBundleVersion</key><string>$short_version</string>
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
echo "$dmg"
