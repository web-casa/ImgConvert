// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type AssemblyResult = {
  bytes: number;
  destination: string;
  files: number;
};

type AssemblerModule = {
  assembleWebRelease(repositoryRoot: string): Promise<AssemblyResult>;
};

type PreviewSmokeModule = {
  assertPreviewDocumentHeaders(headers: Headers, pathname: string): void;
  parsePreviewOrigin(argv: string[]): string;
};

const temporaryRoots: string[] = [];

async function loadAssembler(): Promise<AssemblerModule> {
  const moduleUrl = pathToFileURL(path.resolve("scripts/assemble-web-release.mjs")).href;
  return (await import(moduleUrl)) as AssemblerModule;
}

async function loadPreviewSmoke(): Promise<PreviewSmokeModule> {
  const moduleUrl = pathToFileURL(path.resolve("scripts/smoke-cloudflare-web-preview.mjs")).href;
  return (await import(moduleUrl)) as PreviewSmokeModule;
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "imgconvert-web-release-"));
  temporaryRoots.push(root);
  const websiteDist = path.join(root, "website", "dist");
  const webAppDist = path.join(root, "web-app", "dist");
  mkdirSync(path.join(webAppDist, "assets"), { recursive: true });
  mkdirSync(websiteDist, { recursive: true });
  writeFileSync(path.join(websiteDist, "index.html"), "marketing-site");
  writeFileSync(path.join(webAppDist, "index.html"), "web-app");
  writeFileSync(path.join(webAppDist, "manifest.webmanifest"), "{}");
  writeFileSync(path.join(webAppDist, "service-worker.js"), "// worker");
  writeFileSync(path.join(webAppDist, "assets", "index-abcdefgh.js"), "// app");
  return { root, webAppDist, websiteDist };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Web release assembly", () => {
  it("copies only the Web app subtree and preserves the marketing build", async () => {
    const fixture = createFixture();
    const { assembleWebRelease } = await loadAssembler();

    const result = await assembleWebRelease(fixture.root);

    expect(result.files).toBe(4);
    expect(result.destination).toBe(path.join(fixture.websiteDist, "convert"));
    expect(readFileSync(path.join(fixture.websiteDist, "index.html"), "utf8")).toBe(
      "marketing-site",
    );
    expect(readFileSync(path.join(result.destination, "index.html"), "utf8")).toBe("web-app");
    expect(readFileSync(path.join(result.destination, "assets", "index-abcdefgh.js"), "utf8")).toBe(
      "// app",
    );
  });

  it("replaces an existing converter build without retaining stale files", async () => {
    const fixture = createFixture();
    const staleDirectory = path.join(fixture.websiteDist, "convert");
    mkdirSync(staleDirectory);
    writeFileSync(path.join(staleDirectory, "stale.js"), "stale");
    const { assembleWebRelease } = await loadAssembler();

    await assembleWebRelease(fixture.root);

    expect(() => readFileSync(path.join(staleDirectory, "stale.js"), "utf8")).toThrow();
    expect(readFileSync(path.join(staleDirectory, "service-worker.js"), "utf8")).toBe("// worker");
  });

  it("rejects source symbolic links before touching an existing release", async () => {
    const fixture = createFixture();
    const releaseDirectory = path.join(fixture.websiteDist, "convert");
    mkdirSync(releaseDirectory);
    writeFileSync(path.join(releaseDirectory, "keep.txt"), "keep");
    symlinkSync(
      path.join(fixture.websiteDist, "index.html"),
      path.join(fixture.webAppDist, "escape"),
    );
    const { assembleWebRelease } = await loadAssembler();

    await expect(assembleWebRelease(fixture.root)).rejects.toThrow("contains a symbolic link");
    expect(readFileSync(path.join(releaseDirectory, "keep.txt"), "utf8")).toBe("keep");
  });

  it("rejects a symbolic-link destination without modifying its target", async () => {
    const fixture = createFixture();
    const outside = path.join(fixture.root, "outside");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "keep.txt"), "keep");
    symlinkSync(outside, path.join(fixture.websiteDist, "convert"));
    const { assembleWebRelease } = await loadAssembler();

    await expect(assembleWebRelease(fixture.root)).rejects.toThrow("must not be a symbolic link");
    expect(readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("keep");
  });
});

describe("Cloudflare Preview release gates", () => {
  it("accepts only a credential-free HTTPS pages.dev origin", async () => {
    const { parsePreviewOrigin } = await loadPreviewSmoke();

    expect(parsePreviewOrigin(["--url=https://feature.imgconvert.pages.dev"])).toBe(
      "https://feature.imgconvert.pages.dev",
    );
    expect(() => parsePreviewOrigin(["--url=https://imgconvert.web.casa"])).toThrow(
      "preview URL must use a Cloudflare pages.dev host",
    );
    expect(() =>
      parsePreviewOrigin(["--url=https://feature.imgconvert.pages.dev/convert/"]),
    ).toThrow("preview URL must be an origin only");
  });

  it("requires security and noindex headers on every Preview document", async () => {
    const { assertPreviewDocumentHeaders } = await loadPreviewSmoke();
    const headers = new Headers({
      "content-security-policy":
        "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
      "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex",
    });

    expect(() => assertPreviewDocumentHeaders(headers, "/")).not.toThrow();
    headers.delete("x-robots-tag");
    expect(() => assertPreviewDocumentHeaders(headers, "/")).toThrow("/ is indexable");
  });
});
