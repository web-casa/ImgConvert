import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit } from "@playwright/test";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const host = "127.0.0.1";
const port = 4397;
const origin = `http://${host}:${port}`;
const operationTimeoutMs = 120_000;

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForPreview(preview) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) {
      throw new Error(`Vite preview exited early with code ${preview.exitCode}.`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite preview did not become ready at ${origin}.`);
}

async function stopPreview(preview) {
  if (preview.exitCode !== null) return;
  const exited = once(preview, "exit");
  preview.kill("SIGTERM");
  try {
    await withTimeout(exited, 5_000, "Vite preview shutdown");
  } catch {
    preview.kill("SIGKILL");
    await withTimeout(exited, 5_000, "Forced Vite preview shutdown");
  }
}

function validateMatrix(result) {
  assert.equal(result.matrix.length, 16, "Expected the complete 4 × 4 raster matrix.");
  assert.equal(result.nativeDecodes.length, 4, "Expected one native decode check per format.");
  assert.match(result.engineVersion, /ImageMagick/i);
  for (const format of ["jpeg", "png", "webp", "avif"]) {
    const nativeDecode = result.nativeDecodes.find((item) => item.format === format);
    assert.ok(nativeDecode, `Missing native ${format} decode result.`);
    assert.equal(
      nativeDecode.supported,
      true,
      `Browser could not decode ${format}: ${nativeDecode.error}`,
    );
    assert.equal(nativeDecode.width, 96, `${format} native decode width changed.`);
    assert.equal(nativeDecode.height, 64, `${format} native decode height changed.`);
  }
  for (const format of ["AVIF", "JPEG", "PNG", "WEBP"]) {
    const capability = result.supportedFormats.find((item) => item.format === format);
    assert.ok(capability, `ImageMagick did not report ${format}.`);
    assert.equal(capability.supportsReading, true, `${format} reading is disabled.`);
    assert.equal(capability.supportsWriting, true, `${format} writing is disabled.`);
  }

  const pairs = new Set();
  for (const cell of result.matrix) {
    pairs.add(`${cell.input}->${cell.output}`);
    assert.equal(cell.width, 96);
    assert.equal(cell.height, 64);
    assert.equal(cell.profileNames.length, 0, `${cell.input}->${cell.output} retained profiles.`);
    assert.ok(cell.bytes > 0, `${cell.input}->${cell.output} produced no bytes.`);
    assert.ok(cell.durationMs >= 0, `${cell.input}->${cell.output} has invalid timing.`);
    const shouldBeOpaque = cell.input === "jpeg" || cell.output === "jpeg";
    assert.equal(
      cell.opaque,
      shouldBeOpaque,
      `${cell.input}->${cell.output} changed pixel transparency semantics.`,
    );
    assert.equal(
      cell.hasAlpha,
      !shouldBeOpaque,
      `${cell.input}->${cell.output} changed the expected alpha channel.`,
    );
  }
  assert.equal(pairs.size, 16, "Raster matrix contains duplicate or missing format pairs.");
}

function summarize(result) {
  return {
    ...result,
    matrix: {
      cells: result.matrix.length,
      slowestCell: result.matrix.reduce((slowest, cell) =>
        cell.durationMs > slowest.durationMs ? cell : slowest,
      ),
    },
  };
}

async function testBrowser(name, browserType) {
  const browser = await browserType.launch({ headless: true });
  const runtimeVersion = browser.version();
  const page = await browser.newPage();
  const consoleErrors = [];
  const requests = [];
  const wasmResponses = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) =>
    requests.push({ method: request.method(), postData: request.postData(), url: request.url() }),
  );
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(".wasm")) {
      wasmResponses.push({
        contentLength: Number(response.headers()["content-length"] ?? 0),
        contentType: response.headers()["content-type"] ?? "",
        status: response.status(),
        url: response.url(),
      });
    }
  });

  try {
    await page.goto(origin, { waitUntil: "networkidle" });
    const result = await withTimeout(
      page.evaluate(() => window.__imgConvertSpike.runMatrix()),
      operationTimeoutMs,
      `${name} conversion matrix`,
    );
    validateMatrix(result);

    const invalidInput = await withTimeout(
      page.evaluate(() => window.__imgConvertSpike.verifyInvalidInputRecovery()),
      operationTimeoutMs,
      `${name} invalid-input recovery`,
    );
    assert.deepEqual(invalidInput, { recovered: true, rejected: true });

    const cancellation = await withTimeout(
      page.evaluate(() => window.__imgConvertSpike.verifyCancellation()),
      operationTimeoutMs,
      `${name} cancellation recovery`,
    );
    assert.equal(cancellation.recovered, true, "Worker did not recover after cancellation.");

    const externalRequests = requests.filter(({ url }) => new URL(url).origin !== origin);
    assert.deepEqual(externalRequests, [], "The local conversion spike made external requests.");
    for (const request of requests) {
      assert.equal(
        request.method,
        "GET",
        `Unexpected ${request.method} request to ${request.url}.`,
      );
      assert.equal(request.postData, null, `Request to ${request.url} included a body.`);
    }
    assert.deepEqual(consoleErrors, [], "Browser console contained errors.");
    assert.ok(wasmResponses.length >= 1, "The browser did not request the local WASM asset.");
    for (const response of wasmResponses) {
      assert.ok(
        response.status === 200 || response.status === 304,
        `Unexpected WASM response status ${response.status}.`,
      );
      if (response.status === 200) {
        assert.match(response.contentType, /^application\/wasm(?:;|$)/i);
      }
    }

    return {
      browser: name,
      cancellation,
      delegates: result.delegates,
      engineVersion: result.engineVersion,
      externalRequests,
      features: result.features,
      initializationMs: result.initializationMs,
      invalidInput,
      matrix: result.matrix,
      nativeDecodes: result.nativeDecodes,
      runtimeVersion,
      sourceBytes: result.sourceBytes,
      supportedFormats: result.supportedFormats,
      wasmResponses,
    };
  } finally {
    await browser.close();
  }
}

const preview = spawn("pnpm", ["exec", "vite", "preview", "--host", host, "--port", String(port)], {
  cwd: packageDirectory,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let previewOutput = "";
preview.stdout.on("data", (chunk) => {
  previewOutput += chunk.toString();
});
preview.stderr.on("data", (chunk) => {
  previewOutput += chunk.toString();
});

try {
  await waitForPreview(preview);
  const results = [];
  for (const [name, browserType] of [
    ["chromium", chromium],
    ["firefox", firefox],
    ["webkit", webkit],
  ]) {
    results.push(await testBrowser(name, browserType));
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        origin,
        results: results.map(summarize),
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  if (previewOutput) process.stderr.write(previewOutput);
  throw error;
} finally {
  await stopPreview(preview);
}
