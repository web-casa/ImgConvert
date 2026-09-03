import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit } from "@playwright/test";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const host = "127.0.0.1";
const port = 4399;
const origin = `http://${host}:${port}`;
const operationTimeoutMs = 300_000;

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

function validateLargeResult(browserName, result, iterations) {
  assert.equal(result.pixels, 24_000_000, `${browserName} benchmark pixel count changed.`);
  assert.equal(
    result.measurements.length,
    iterations,
    `${browserName} did not complete every 24 MP iteration.`,
  );
  for (const { result: measurement } of result.measurements) {
    assert.equal(measurement.width, 6000);
    assert.equal(measurement.height, 4000);
    assert.equal(measurement.output, "avif");
    assert.equal(measurement.format, "avif");
    assert.equal(measurement.iterations, 1);
    assert.equal(measurement.metadataMarkerPresent, false);
    assert.ok(measurement.bytes > 0);
    assert.ok(measurement.durationMs > 0);
  }

  const memoryMeasurements = result.measurements
    .map(({ memoryBytes }) => memoryBytes)
    .filter((value) => typeof value === "number");
  let memoryAssessment = { available: false };
  if (memoryMeasurements.length >= 2) {
    const warmMemory = memoryMeasurements[Math.min(1, memoryMeasurements.length - 1)];
    const finalMemory = memoryMeasurements.at(-1);
    const allowedGrowth = Math.max(64 * 1024 * 1024, warmMemory * 0.15);
    const growthAfterWarmup = finalMemory - warmMemory;
    assert.ok(
      growthAfterWarmup <= allowedGrowth,
      `${browserName} memory grew ${growthAfterWarmup} bytes after warm-up.`,
    );
    memoryAssessment = {
      allowedGrowth,
      available: true,
      finalMemory,
      growthAfterWarmup,
      warmMemory,
    };
  }
  return memoryAssessment;
}

async function processTreeRssBytes(rootPid) {
  const pending = [rootPid];
  const seen = new Set();
  let totalBytes = 0;
  while (pending.length > 0) {
    const pid = pending.pop();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    try {
      const [childrenText, status] = await Promise.all([
        readFile(`/proc/${pid}/task/${pid}/children`, "utf8"),
        readFile(`/proc/${pid}/status`, "utf8"),
      ]);
      for (const child of childrenText.trim().split(/\s+/)) {
        const childPid = Number(child);
        if (Number.isSafeInteger(childPid) && childPid > 0) pending.push(childPid);
      }
      const rssKilobytes = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] ?? 0);
      totalBytes += rssKilobytes * 1024;
    } catch {
      // The process may have exited between tree discovery and sampling.
    }
  }
  return totalBytes > 0 ? totalBytes : null;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function assessProcessMemory(samples, requireTrendCheck) {
  const values = [...samples]
    .sort((left, right) => left.timestamp - right.timestamp)
    .map(({ bytes }) => bytes)
    .filter((bytes) => typeof bytes === "number");
  if (values.length < 2) return { available: false, samples: values.length };

  const assessment = {
    available: true,
    finalBytes: values.at(-1),
    initialBytes: values[0],
    peakBytes: Math.max(...values),
    samples: values.length,
  };
  if (!requireTrendCheck || values.length < 10) return assessment;

  const warmStart = Math.floor(values.length * 0.55);
  const warmEnd = Math.max(warmStart + 1, Math.floor(values.length * 0.75));
  const finalStart = Math.max(warmEnd, Math.floor(values.length * 0.8));
  const warmMedianBytes = median(values.slice(warmStart, warmEnd));
  const finalMedianBytes = median(values.slice(finalStart));
  const growthAfterWarmup = finalMedianBytes - warmMedianBytes;
  const allowedGrowth = Math.max(64 * 1024 * 1024, warmMedianBytes * 0.15);
  assert.ok(
    growthAfterWarmup <= allowedGrowth,
    `Process-tree RSS grew ${growthAfterWarmup} bytes after warm-up.`,
  );
  return {
    ...assessment,
    allowedGrowth,
    finalMedianBytes,
    growthAfterWarmup,
    warmMedianBytes,
  };
}

async function testBrowser(name, browserType, iterations) {
  const browserServer = await browserType.launchServer({ headless: true });
  const rootPid = browserServer.process().pid;
  const browser = await browserType.connect(browserServer.wsEndpoint());
  const runtimeVersion = browser.version();
  const page = await browser.newPage();
  const consoleErrors = [];
  const requests = [];
  const rssSamples = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) =>
    requests.push({ method: request.method(), postData: request.postData(), url: request.url() }),
  );

  try {
    await page.goto(origin, { waitUntil: "networkidle" });
    assert.equal(
      await page.evaluate(() => crossOriginIsolated),
      true,
      `${name} benchmark page is not cross-origin isolated.`,
    );
    let sampleInFlight = null;
    const sampleRss = () => {
      if (sampleInFlight) return sampleInFlight;
      sampleInFlight = processTreeRssBytes(rootPid)
        .then((bytes) => {
          rssSamples.push({ bytes, timestamp: Date.now() });
        })
        .finally(() => {
          sampleInFlight = null;
        });
      return sampleInFlight;
    };
    await sampleRss();
    const sampler = setInterval(() => void sampleRss(), 250);
    let result;
    try {
      result = await withTimeout(
        page.evaluate(
          (count) => window.__imgConvertCodecSpike.runLargeBenchmark(count),
          iterations,
        ),
        operationTimeoutMs,
        `${name} 24 MP benchmark`,
      );
    } finally {
      clearInterval(sampler);
      if (sampleInFlight) await sampleInFlight;
      await sampleRss();
    }
    const memoryAssessment = validateLargeResult(name, result, iterations);
    const processMemoryAssessment = assessProcessMemory(rssSamples, iterations === 8);

    const externalRequests = requests.filter(({ url }) => new URL(url).origin !== origin);
    assert.deepEqual(externalRequests, [], `${name} 24 MP benchmark made external requests.`);
    for (const request of requests) {
      assert.equal(
        request.method,
        "GET",
        `Unexpected ${request.method} request to ${request.url}.`,
      );
      assert.equal(request.postData, null, `Request to ${request.url} included a body.`);
    }
    assert.deepEqual(consoleErrors, [], `${name} browser console contained errors.`);

    return {
      browser: name,
      iterations,
      memoryAssessment,
      processMemoryAssessment,
      result,
      runtimeVersion,
    };
  } finally {
    await browser.close();
    await browserServer.close().catch(() => undefined);
  }
}

const preview = spawn("pnpm", ["exec", "vite", "preview", "--host", host, "--port", String(port)], {
  cwd: packageDirectory,
  env: { ...process.env, IMGCONVERT_CODEC_ISOLATION: "1" },
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
  for (const [name, browserType, iterations] of [
    ["chromium", chromium, 8],
    ["firefox", firefox, 1],
    ["webkit", webkit, 1],
  ]) {
    results.push(await testBrowser(name, browserType, iterations));
  }
  process.stdout.write(
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
} catch (error) {
  if (previewOutput) process.stderr.write(previewOutput);
  throw error;
} finally {
  await stopPreview(preview);
}
