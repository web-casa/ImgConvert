// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readRequiredJson } from "../scripts/read-required-json.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "imgconvert-required-json-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("readRequiredJson", () => {
  it("reports a missing required file without throwing", () => {
    const failures: string[] = [];

    expect(readRequiredJson(temporaryDirectory(), "docs/public-release.json", failures)).toEqual(
      {},
    );
    expect(failures).toEqual(["docs/public-release.json is required but missing"]);
  });

  it("reports malformed JSON without throwing", () => {
    const root = temporaryDirectory();
    writeFileSync(path.join(root, "broken.json"), '{"version":');
    const failures: string[] = [];

    expect(readRequiredJson(root, "broken.json", failures)).toEqual({});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^broken\.json must contain valid JSON:/);
  });

  it("rejects non-object documents and returns valid objects", () => {
    const root = temporaryDirectory();
    writeFileSync(path.join(root, "array.json"), "[]");
    writeFileSync(path.join(root, "object.json"), '{"published":true}');
    const failures: string[] = [];

    expect(readRequiredJson(root, "array.json", failures)).toEqual({});
    expect(readRequiredJson(root, "object.json", failures)).toEqual({ published: true });
    expect(failures).toEqual(["array.json must contain a JSON object"]);
  });
});
