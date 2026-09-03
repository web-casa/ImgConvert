// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import type { Locale } from "./content";

type HomeMetric = {
  value: string;
  label: string;
  detail: string;
};

type ProductScreenshot = {
  title: string;
  body: string;
  alt: string;
};

type HomeLocaleContent = {
  nav: {
    product: string;
    formats: string;
    guides: string;
    faq: string;
    webApp: string;
    github: string;
    homeLabel: string;
    primaryLabel: string;
    languageLabel: string;
    footerLabel: string;
  };
  localBadge: string;
  trustTitle: string;
  trustItems: string[];
  metricsEyebrow: string;
  metricsTitle: string;
  metricsBody: string;
  metrics: HomeMetric[];
  realUi: string;
  workflow: string;
  formats: string;
  inputFormatsLabel: string;
  privacy: string;
  productGalleryEyebrow: string;
  productGalleryTitle: string;
  productGalleryBody: string;
  screenshots: {
    dark: ProductScreenshot;
    presets: ProductScreenshot;
    plugins: ProductScreenshot;
  };
  downloadsEyebrow: string;
  recommended: string;
  recommendedStore: string;
  githubPackages: string;
  resolvingDownload: string;
  downloadFallback: string;
  linuxAlternatives: string;
  linuxEyebrow: string;
  linuxTitle: string;
  linuxBody: string;
  linuxDistros: string[];
  resourcesEyebrow: string;
  resourcesTitle: string;
  resourcesBody: string;
  allGuides: string;
  finalEyebrow: string;
  finalTitleBefore: string;
  finalTitleEm: string;
  finalBody: string;
  webEntryAction: string;
  webEntryNote: string;
};

export const homeContent: Record<Locale, HomeLocaleContent> = {
  zh: {
    nav: {
      product: "产品",
      formats: "格式",
      guides: "指南",
      faq: "FAQ",
      webApp: "网页版",
      github: "GitHub",
      homeLabel: "ImgConvert 首页",
      primaryLabel: "主要导航",
      languageLabel: "语言选择",
      footerLabel: "页脚导航",
    },
    localBadge: "免费 · 开源 · 本机处理",
    trustTitle: "为每一台桌面准备的本地图片工作流",
    trustItems: ["macOS", "Windows", "Linux", "Apache-2.0"],
    metricsEyebrow: "LOCAL BY DESIGN",
    metricsTitle: "把图片处理留在你看得见的地方。",
    metricsBody:
      "桌面版承载完整工作流，Web 版适合免安装的快速任务；两者都让导入、设置、进度和结果留在你的设备上。",
    metrics: [
      { value: "0", label: "原图上传", detail: "处理发生在你的设备上" },
      { value: "4", label: "主要输出格式", detail: "AVIF · WebP · JPEG · PNG" },
      { value: "3", label: "桌面系统", detail: "macOS · Windows · Linux" },
      { value: "1", label: "统一工作区", detail: "导入、设置、进度与结果" },
    ],
    realUi: "真实产品界面",
    workflow: "批量工作流",
    formats: "格式选择",
    inputFormatsLabel: "也可作为输入",
    privacy: "本地与隐私",
    productGalleryEyebrow: "THE APP, FOR REAL",
    productGalleryTitle: "功能不是概念，\n都在真实界面里。",
    productGalleryBody: "浅色与深色模式、场景预设、格式选择和插件诊断，都来自当前产品界面。",
    screenshots: {
      dark: {
        title: "深色模式",
        body: "同一套批量工作流，在低亮度环境中保持清晰。",
        alt: "ImgConvert 中文深色模式批量转换工作区",
      },
      presets: {
        title: "场景预设",
        body: "在网页分享、邮件附件与高质量归档之间快速切换。",
        alt: "ImgConvert 场景预设选择界面",
      },
      plugins: {
        title: "插件扩展",
        body: "查看 HEIC 等可选输入能力、系统解码器与 helper 状态。",
        alt: "ImgConvert 插件诊断与扩展能力界面",
      },
    },
    downloadsEyebrow: "CHOOSE YOUR DESKTOP",
    recommended: "适合当前设备",
    recommendedStore: "推荐",
    githubPackages: "GitHub Latest 安装包",
    resolvingDownload: "正在查找最新的 GitHub 安装包…",
    downloadFallback: "无法自动定位安装包，正在打开 GitHub Latest 页面。",
    linuxAlternatives: "点击架构后自动从 GitHub Latest 定位对应安装包",
    linuxEyebrow: "LINUX, WITHOUT GUESSWORK",
    linuxTitle: "从桌面发行版，到对应安装包。",
    linuxBody:
      "提供 amd64 与 arm64 构建，并通过 Snap、AppImage、deb 与 rpm 覆盖常见 Linux 桌面发行版。",
    linuxDistros: [
      "Debian",
      "Ubuntu",
      "Fedora",
      "AlmaLinux",
      "Deepin",
      "UOS",
      "Kylin",
      "openEuler",
      "openAnolis",
    ],
    resourcesEyebrow: "GUIDES & KNOWLEDGE",
    resourcesTitle: "先看清边界，再开始转换。",
    resourcesBody: "从具体系统和格式问题出发，了解真实支持的操作路径、压缩取舍与平台限制。",
    allGuides: "查看指南",
    finalEyebrow: "READY WHEN YOU ARE",
    finalTitleBefore: "图片处理，",
    finalTitleEm: "留在你的设备。",
    finalBody: "打开 Web 版立即开始，或为完整工作流选择桌面应用。",
    webEntryAction: "直接使用网页版",
    webEntryNote: "图片、SVG 与 PDF · 浏览器内处理",
  },
  en: {
    nav: {
      product: "Product",
      formats: "Formats",
      guides: "Guides",
      faq: "FAQ",
      webApp: "Web app",
      github: "GitHub",
      homeLabel: "ImgConvert home",
      primaryLabel: "Primary navigation",
      languageLabel: "Language selection",
      footerLabel: "Footer navigation",
    },
    localBadge: "Free · open source · on-device",
    trustTitle: "A local image workflow for every desktop",
    trustItems: ["macOS", "Windows", "Linux", "Apache-2.0"],
    metricsEyebrow: "LOCAL BY DESIGN",
    metricsTitle: "Keep image work where you can see it.",
    metricsBody:
      "The desktop app carries the complete workflow; the Web app handles quick, install-free tasks. Both keep imports, settings, progress, and results on your device.",
    metrics: [
      { value: "0", label: "original uploads", detail: "Processing happens on your device" },
      { value: "4", label: "primary outputs", detail: "AVIF · WebP · JPEG · PNG" },
      { value: "3", label: "desktop systems", detail: "macOS · Windows · Linux" },
      { value: "1", label: "shared workspace", detail: "Import, settings, progress, results" },
    ],
    realUi: "The real product UI",
    workflow: "Batch workflow",
    formats: "Format choices",
    inputFormatsLabel: "Also accepted as input",
    privacy: "Local and private",
    productGalleryEyebrow: "THE APP, FOR REAL",
    productGalleryTitle: "Real features,\nin the real interface.",
    productGalleryBody:
      "Light and dark modes, scenario presets, format choices, and plugin diagnostics—all captured from the current product.",
    screenshots: {
      dark: {
        title: "Dark mode",
        body: "The complete batch workflow stays legible in lower-light environments.",
        alt: "The ImgConvert batch workspace in dark mode",
      },
      presets: {
        title: "Scenario presets",
        body: "Move quickly among web sharing, email attachment, and archival settings.",
        alt: "The ImgConvert scenario preset picker",
      },
      plugins: {
        title: "Plugin extensions",
        body: "Inspect optional HEIC input, system decoders, and helper status.",
        alt: "The ImgConvert plugin diagnostics and extension interface",
      },
    },
    downloadsEyebrow: "CHOOSE YOUR DESKTOP",
    recommended: "Best for this device",
    recommendedStore: "Recommended",
    githubPackages: "GitHub Latest packages",
    resolvingDownload: "Finding the latest GitHub package…",
    downloadFallback: "The package could not be resolved automatically. Opening GitHub Latest.",
    linuxAlternatives: "Choose an architecture to resolve its package from GitHub Latest",
    linuxEyebrow: "LINUX, WITHOUT GUESSWORK",
    linuxTitle: "From desktop distro to the right package.",
    linuxBody:
      "amd64 and arm64 builds are available through Snap, AppImage, deb, and rpm for widely used Linux desktop distributions.",
    linuxDistros: [
      "Debian",
      "Ubuntu",
      "Fedora",
      "AlmaLinux",
      "Deepin",
      "Kylin",
      "openEuler",
      "openAnolis",
    ],
    resourcesEyebrow: "GUIDES & KNOWLEDGE",
    resourcesTitle: "See the boundary before converting.",
    resourcesBody:
      "Start with a concrete platform and format question, then see the supported path, compression trade-offs, and real limits.",
    allGuides: "Open guide",
    finalEyebrow: "READY WHEN YOU ARE",
    finalTitleBefore: "Image work,",
    finalTitleEm: "on your device.",
    finalBody: "Start immediately in the Web app, or choose desktop for the complete workflow.",
    webEntryAction: "Open the Web app",
    webEntryNote: "Images, SVG & PDF · processed in-browser",
  },
};
