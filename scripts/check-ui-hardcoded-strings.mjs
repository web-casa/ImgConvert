// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const tauriCapabilityPath = path.join(repoRoot, "src-tauri", "capabilities", "default.json");
const excludedDirs = new Set(["lib/i18n/messages"]);
const failures = [];
const cjkPattern = /[\u3000-\u303f\u3400-\u9fff\ufe30-\ufe4f\uff00-\uffef]/;

for (const file of walk(srcRoot)) {
  const relative = path.relative(srcRoot, file).split(path.sep);
  if (
    relative.some((segment) =>
      excludedDirs.has(path.posix.join(...relative.slice(0, relative.indexOf(segment) + 1))),
    )
  ) {
    continue;
  }
  const source = readFileSync(file, "utf8");
  const codeOnly = stripComments(source);
  codeOnly.split(/\r?\n/).forEach((line, index) => {
    if (cjkPattern.test(line)) {
      failures.push(`${path.relative(repoRoot, file)}:${index + 1}: ${line.trim()}`);
    }
  });
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
for (const [index, windowConfig] of (tauriConfig.app?.windows ?? []).entries()) {
  if (typeof windowConfig.title === "string" && cjkPattern.test(windowConfig.title)) {
    failures.push(
      `${path.relative(repoRoot, tauriConfigPath)}: app.windows[${index}].title contains localized CJK text`,
    );
  }
}

for (const field of ["shortDescription", "longDescription"]) {
  const value = tauriConfig.bundle?.[field];
  if (typeof value === "string" && cjkPattern.test(value)) {
    failures.push(
      `${path.relative(repoRoot, tauriConfigPath)}: bundle.${field} contains localized CJK text`,
    );
  }
}

const tauriCapability = JSON.parse(readFileSync(tauriCapabilityPath, "utf8"));
if (!tauriCapability.permissions?.includes("core:window:allow-set-title")) {
  failures.push(
    `${path.relative(repoRoot, tauriCapabilityPath)}: missing core:window:allow-set-title`,
  );
}

if (failures.length > 0) {
  console.error("Hardcoded CJK UI text or punctuation found outside i18n messages:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "UI hardcoded string check passed (source UI and static window titles are locale-neutral).",
);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(svelte|ts)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("//", i)) {
      const newline = source.indexOf("\n", i);
      i = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}
