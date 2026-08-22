// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(repoRoot, "packaging", "flatpak", "extensions", "heic");

const manifestPath = path.join(extensionDir, "io.github.yeagoo.imgconvert.Codecs.Heic.yml");
const codecManifestPath = path.join(extensionDir, "imgconvert-codec-heic.json");
const helperPath = path.join(extensionDir, "imgconvert-heic-helper.sh");
const metainfoPath = path.join(
  extensionDir,
  "io.github.yeagoo.imgconvert.Codecs.Heic.metainfo.xml",
);
const noticePath = path.join(extensionDir, "LGPL_NOTICE.md");

const failures = [];

for (const file of [manifestPath, codecManifestPath, helperPath, metainfoPath, noticePath]) {
  if (!existsSync(file)) {
    failures.push(`missing ${path.relative(repoRoot, file)}`);
  }
}

if (failures.length === 0) {
  inspectManifest(readFileSync(manifestPath, "utf8"));
  inspectCodecManifest(JSON.parse(readFileSync(codecManifestPath, "utf8")));
  inspectHelper(readFileSync(helperPath, "utf8"));
  inspectMetainfo(readFileSync(metainfoPath, "utf8"));
  inspectNotice(readFileSync(noticePath, "utf8"));
}

if (failures.length > 0) {
  console.error("Flatpak HEIC extension check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Flatpak HEIC extension check passed.");

function inspectManifest(text) {
  for (const expected of [
    "id: io.github.yeagoo.imgconvert.Codecs.Heic",
    'branch: "1"',
    "runtime: io.github.yeagoo.imgconvert",
    "build-extension: true",
    "prefix: /app/extensions/codecs/Heic",
    "prepend-ld-library-path: /app/extensions/codecs/Heic/lib",
    "- /bin/dec265",
    "- /bin/heif-enc",
    "- /bin/heif-info",
    "- /bin/heif-test",
    "libde265-1.1.1.tar.gz",
    "fd48a927e94ed74fc7ce8829d222b9d8599fcbfe8b6448ba66705babc56ab219",
    "libheif-1.23.1.tar.gz",
    "0de0327f60fcd47de90d5654c6fe152232738d60d84fe084ec3e0f35e03b166a",
    "- -DWITH_LIBDE265=ON",
    "- -DLIBDE265_INCLUDE_DIR=/app/extensions/codecs/Heic/include",
    "- -DLIBDE265_LIBRARY=/app/extensions/codecs/Heic/lib/libde265.so",
    "- -DWITH_X265=OFF",
    "- -DENABLE_ENCODER=OFF",
    "- -DWITH_EXAMPLES=ON",
    "rm -f ${FLATPAK_DEST}/bin/heif-enc",
    "heif-dec --list-decoders | grep -i libde265",
    "imgconvert-heic-helper.sh",
    "imgconvert-codec-heic.json",
    "LGPL_NOTICE.md",
    "share/licenses/io.github.yeagoo.imgconvert.Codecs.Heic",
  ]) {
    requireText(text, expected, `extension manifest missing ${expected}`);
  }

  for (const forbidden of [
    "- -DWITH_X265=ON",
    "- -DWITH_X264=ON",
    "- -DWITH_KVAZAAR=ON",
    "- -DWITH_FFMPEG_DECODER=ON",
    "test -x ${FLATPAK_DEST}/bin/heif-enc",
  ]) {
    if (text.includes(forbidden)) {
      failures.push(`extension manifest must not enable ${forbidden}`);
    }
  }

  if (!/sha256:\s+[a-f0-9]{64}/.test(text)) {
    failures.push("extension source archives must pin sha256");
  }
}

function inspectCodecManifest(manifest) {
  if (manifest.protocol !== 1) {
    failures.push("HEIC extension codec manifest must use protocol 1");
  }
  if (!String(manifest.license ?? "").startsWith("LGPL-")) {
    failures.push("HEIC extension codec manifest must declare separate LGPL licensing");
  }
  if (!Array.isArray(manifest.readable) || !manifest.readable.includes("heic")) {
    failures.push("HEIC extension codec manifest must declare HEIC readable support");
  }
  if (!Array.isArray(manifest.writable) || manifest.writable.length !== 0) {
    failures.push("HEIC extension codec manifest must stay decode-only");
  }
  if (manifest.decode?.kind !== "heic-to-png-file") {
    failures.push("HEIC extension codec manifest must decode HEIC to PNG files");
  }
  if (manifest.decode?.command !== "bin/imgconvert-heic-helper") {
    failures.push("HEIC extension codec manifest must use the wrapper helper");
  }
  if (!manifest.decode?.args?.includes("{metadata}")) {
    failures.push("HEIC extension codec manifest should support metadata sidecar output");
  }
}

function inspectHelper(text) {
  for (const expected of [
    "set -eu",
    'if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then',
    'helper_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    '"$helper_dir/heif-dec" --quiet "$input" "$output"',
    'printf \'{"version":1}\\n\' > "$metadata"',
  ]) {
    requireText(text, expected, `helper wrapper missing ${expected}`);
  }
  if (text.includes("eval ") || text.includes("$*")) {
    failures.push("helper wrapper must not use shell eval or unstructured argv");
  }
}

function inspectMetainfo(text) {
  for (const expected of [
    "<id>io.github.yeagoo.imgconvert.Codecs.Heic</id>",
    "<extends>io.github.yeagoo.imgconvert</extends>",
    "<metadata_license>CC0-1.0</metadata_license>",
    "<project_license>LGPL-3.0-or-later</project_license>",
    '<developer id="io.github.yeagoo">',
    '<url type="homepage">https://imgconvert.web.casa/</url>',
    '<url type="vcs-browser">https://github.com/web-casa/ImgConvert</url>',
    "decode-only",
  ]) {
    requireText(text, expected, `extension metainfo missing ${expected}`);
  }
}

function inspectNotice(text) {
  for (const expected of ["libheif", "libde265", "LGPL", "decode-only", "x265"]) {
    requireText(text, expected, `LGPL notice missing ${expected}`);
  }
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) {
    failures.push(message);
  }
}
