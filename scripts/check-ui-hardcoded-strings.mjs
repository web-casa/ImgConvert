// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");
const excludedDirs = new Set(["lib/i18n/messages"]);
const failures = [];

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
    if (/[\u3400-\u9fff]/.test(line)) {
      failures.push(`${path.relative(repoRoot, file)}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (failures.length > 0) {
  console.error("Hardcoded CJK UI strings found in src/:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("UI hardcoded string check passed (no CJK outside i18n messages).");

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
