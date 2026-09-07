// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = path.join(root, "packaging", "store-assets", "v0.3.1");
const msRoot = path.join(assetRoot, "ms-store");
const masRoot = path.join(assetRoot, "mas");
const previewRoot = path.join(assetRoot, "preview");
const heroSource = path.join(assetRoot, "source", "imgconvert-store-hero-source.png");
const iconSource = path.join(root, "src-tauri", "icons", "icon.png");
const defaultCaptureUrl = "http://127.0.0.1:1420";

const locales = {
  "en-US": {
    switchTitle: "语言",
    states: [
      {
        slug: "01-batch-workspace",
        headline: "Convert a whole batch at once",
        subhead: "Keep format, quality, and output rules consistent across the queue.",
      },
      {
        slug: "02-batch-resize",
        action: /Batch resize rule/,
        headline: "One size rule for the whole batch",
        subhead: "Resize by width, height, long edge, short edge, or exact dimensions.",
      },
      {
        slug: "03-privacy-metadata",
        action: /Privacy metadata/,
        headline: "You choose what metadata stays",
        subhead: "Preserve everything, remove location data, or strip all metadata.",
      },
      {
        slug: "04-format-quality",
        action: /Format parameters/,
        headline: "Precise format and quality control",
        subhead: "Tune JPEG, PNG, WebP, and AVIF for each job.",
      },
      {
        slug: "05-import-formats",
        empty: true,
        headline: "Images, HEIC, and PDF in one queue",
        subhead: "PDF converts page by page. HEIC input depends on available system decoding.",
      },
    ],
  },
  "zh-CN": {
    states: [
      {
        slug: "01-batch-workspace",
        headline: "一次处理整批图片",
        subhead: "统一格式、质量与输出规则，队列状态一目了然。",
      },
      {
        slug: "02-batch-resize",
        action: /批量尺寸规则/,
        headline: "一条尺寸规则，应用到整批文件",
        subhead: "按宽度、高度、长边、短边或精确尺寸统一调整。",
      },
      {
        slug: "03-privacy-metadata",
        action: /隐私元数据/,
        headline: "元数据由你决定",
        subhead: "保留全部、仅移除位置，或移除全部元数据。",
      },
      {
        slug: "04-format-quality",
        action: /格式参数/,
        headline: "精确控制格式与质量",
        subhead: "JPEG、PNG、WebP 与 AVIF，按任务调整编码参数。",
      },
      {
        slug: "05-import-formats",
        empty: true,
        headline: "常见图片、HEIC 与 PDF 一站导入",
        subhead: "PDF 按页转为图片；HEIC 输入取决于系统可用解码能力。",
      },
    ],
  },
};

for (const directory of [
  msRoot,
  masRoot,
  previewRoot,
  ...Object.keys(locales).flatMap((locale) => [
    path.join(msRoot, locale),
    path.join(masRoot, locale),
  ]),
  path.join(msRoot, "shared"),
]) {
  mkdirSync(directory, { recursive: true });
}

const { url: captureUrl, server } = await ensureCaptureServer();
const browser = await chromium.launch();

try {
  for (const [locale, localeConfig] of Object.entries(locales)) {
    for (const state of localeConfig.states) {
      const output = path.join(msRoot, locale, `${state.slug}.png`);
      await captureProductUi(browser, captureUrl, locale, localeConfig, state, output);
    }
  }

  await renderSuperHero(browser);

  for (const [locale, localeConfig] of Object.entries(locales)) {
    for (const [index, state] of localeConfig.states.entries()) {
      await renderMasScreenshot(browser, locale, state, index);
    }
    await renderContactSheet(browser, "mas", locale, localeConfig.states);
    await renderContactSheet(browser, "ms-store", locale, localeConfig.states);
  }
} finally {
  await browser.close();
  server?.kill("SIGTERM");
}

console.log(`Rendered Store assets in ${path.relative(root, assetRoot)}`);

async function ensureCaptureServer() {
  const configuredUrl = process.env.IMGCONVERT_STORE_CAPTURE_URL;
  if (configuredUrl) {
    await waitForUrl(configuredUrl);
    return { url: configuredUrl, server: null };
  }

  if (await isReachable(defaultCaptureUrl)) {
    return { url: defaultCaptureUrl, server: null };
  }

  const server = spawn("pnpm", ["dev", "--host", "127.0.0.1"], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForUrl(defaultCaptureUrl);
  return { url: defaultCaptureUrl, server };
}

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for the ImgConvert preview at ${url}`);
}

async function captureProductUi(browserInstance, url, locale, localeConfig, state, output) {
  const context = await browserInstance.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "zh-CN",
    colorScheme: "light",
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "ImgConvert" }).waitFor();
    if (locale === "en-US") {
      await page.getByTitle(localeConfig.switchTitle).click();
      await page.locator('html[lang="en-US"]').waitFor();
    }

    if (state.empty) {
      await page.getByRole("button", { name: locale === "zh-CN" ? /清空/ : /Clear/ }).click();
      await page.locator("details").first().locator("summary").click();
    } else if (state.action) {
      await page.getByRole("button", { name: state.action }).click();
    }

    await page.waitForTimeout(180);
    await page.screenshot({ path: output, animations: "disabled" });
  } finally {
    await context.close();
  }
}

async function renderSuperHero(browserInstance) {
  const page = await browserInstance.newPage({ viewport: { width: 3840, height: 2160 } });
  const hero = dataUrl(heroSource);
  await page.setContent(`
    <!doctype html>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #071a14; }
      img { display: block; width: 100%; height: 100%; object-fit: cover; }
    </style>
    <img src="${hero}" alt="" />
  `);
  await page.screenshot({ path: path.join(msRoot, "shared", "super-hero-3840x2160.png") });
  await page.close();
}

async function renderMasScreenshot(browserInstance, locale, state, index) {
  const page = await browserInstance.newPage({ viewport: { width: 2880, height: 1800 } });
  const screenshot = dataUrl(path.join(msRoot, locale, `${state.slug}.png`));
  const icon = dataUrl(iconSource);
  const dark = index % 2 === 0;
  const background = dark ? "#0b241b" : "#f3eddf";
  const foreground = dark ? "#fbf7ed" : "#10251e";
  const muted = dark ? "#b9c9bf" : "#52635d";
  const frame = dark ? "rgba(251, 247, 237, 0.20)" : "rgba(16, 37, 30, 0.16)";
  const accent = index === 2 ? "#b8dc59" : "#ee6c4d";
  const fontFamily =
    locale === "zh-CN"
      ? "'Noto Sans CJK SC', 'Noto Sans SC', sans-serif"
      : "Lato, 'Segoe UI', sans-serif";

  await page.setContent(`
    <!doctype html>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      body {
        position: relative;
        background: ${background};
        color: ${foreground};
        font-family: ${fontFamily};
      }
      .orb {
        position: absolute;
        width: 740px;
        height: 740px;
        border: 150px solid ${accent};
        border-radius: 50%;
        opacity: ${dark ? "0.09" : "0.08"};
        left: -410px;
        bottom: -390px;
      }
      .rule {
        position: absolute;
        width: 12px;
        height: 620px;
        left: 152px;
        top: 178px;
        border-radius: 99px;
        background: ${accent};
      }
      .brand {
        position: absolute;
        left: 152px;
        top: 92px;
        display: flex;
        align-items: center;
        gap: 26px;
        font-size: 42px;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .brand img { width: 74px; height: 74px; border-radius: 18px; }
      .copy {
        position: absolute;
        left: 216px;
        top: 292px;
        width: 610px;
      }
      h1 {
        margin: 0;
        font-size: ${locale === "zh-CN" ? "108px" : "100px"};
        line-height: ${locale === "zh-CN" ? "1.16" : "0.98"};
        letter-spacing: -0.055em;
        font-weight: 900;
      }
      p {
        margin: 50px 0 0;
        color: ${muted};
        font-size: ${locale === "zh-CN" ? "42px" : "39px"};
        line-height: 1.42;
        font-weight: 500;
      }
      .index {
        position: absolute;
        left: 216px;
        bottom: 158px;
        font-size: 29px;
        font-weight: 800;
        letter-spacing: 0.14em;
        color: ${accent};
      }
      .frame {
        position: absolute;
        left: 895px;
        top: 222px;
        width: 1900px;
        height: 1069px;
        overflow: hidden;
        border: 10px solid ${frame};
        border-radius: 38px;
        background: #faf7f0;
        box-shadow: 0 64px 140px rgba(0, 0, 0, ${dark ? "0.35" : "0.22"});
      }
      .frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .platform {
        position: absolute;
        left: 1020px;
        top: 1355px;
        width: 1640px;
        height: 190px;
        border-radius: 50%;
        background: rgba(0, 0, 0, ${dark ? "0.20" : "0.09"});
        filter: blur(48px);
      }
      .pill {
        position: absolute;
        right: 86px;
        bottom: 82px;
        padding: 22px 34px;
        border: 3px solid ${frame};
        border-radius: 999px;
        color: ${muted};
        font-size: 26px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
    </style>
    <div class="orb"></div>
    <div class="rule"></div>
    <div class="brand"><img src="${icon}" alt="" /> ImgConvert</div>
    <div class="copy"><h1>${escapeHtml(state.headline)}</h1><p>${escapeHtml(state.subhead)}</p></div>
    <div class="index">${String(index + 1).padStart(2, "0")} / 05</div>
    <div class="platform"></div>
    <div class="frame"><img src="${screenshot}" alt="" /></div>
    <div class="pill">${locale === "zh-CN" ? "本地处理 · 批量工作流" : "LOCAL PROCESSING · BATCH WORKFLOW"}</div>
  `);
  await page.screenshot({ path: path.join(masRoot, locale, `${state.slug}.png`) });
  await page.close();
}

async function renderContactSheet(browserInstance, channel, locale, states) {
  const page = await browserInstance.newPage({
    viewport: { width: 2400, height: channel === "mas" ? 2820 : 2600 },
  });
  const cards = states
    .map((state, index) => {
      const imagePath = path.join(
        channel === "mas" ? masRoot : msRoot,
        locale,
        `${state.slug}.png`,
      );
      return `<figure><img src="${dataUrl(imagePath)}" alt="" /><figcaption>${String(index + 1).padStart(2, "0")} · ${escapeHtml(state.headline)}</figcaption></figure>`;
    })
    .join("");
  await page.setContent(`
    <!doctype html>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; min-height: 100%; background: #e8e1d3; color: #12251f; }
      body { padding: 82px; font-family: ${locale === "zh-CN" ? "'Noto Sans CJK SC', sans-serif" : "Lato, sans-serif"}; }
      header { display: flex; align-items: end; justify-content: space-between; margin-bottom: 50px; }
      h1 { margin: 0; font-size: 72px; letter-spacing: -0.04em; }
      header p { margin: 0 0 8px; font-size: 28px; color: #64716c; }
      main { display: grid; grid-template-columns: repeat(2, 1fr); gap: 42px; }
      figure { margin: 0; background: #f9f6ef; padding: 18px; border-radius: 28px; box-shadow: 0 22px 70px rgba(18, 37, 31, 0.12); }
      figure:last-child { grid-column: 1 / -1; width: calc(50% - 21px); justify-self: center; }
      figure img { display: block; width: 100%; aspect-ratio: ${channel === "mas" ? "16 / 10" : "16 / 9"}; object-fit: cover; border-radius: 15px; }
      figcaption { padding: 20px 8px 6px; font-size: 28px; font-weight: 800; }
    </style>
    <header><h1>ImgConvert · ${channel === "mas" ? "Mac App Store" : "Microsoft Store"}</h1><p>${locale} · v0.3.1</p></header>
    <main>${cards}</main>
  `);
  await page.screenshot({
    path: path.join(previewRoot, `${channel}-${locale}-contact-sheet.png`),
  });
  await page.close();
}

function dataUrl(file) {
  return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
