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
    platforms: string;
    desktop: string;
    extension: string;
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
  desktopEntryAction: string;
  desktopEntryNote: string;
  extensionEntryAction: string;
  extensionEntryNote: string;
  extensionStoreAction: string;
  extensionStoreNote: string;
  extensionZipAction: string;
  extensionZipNote: string;
  extensionSourceAction: string;
  extensionManualTitle: string;
  extensionManualBody: string;
  channelNavLabel: string;
  navTryNow: string;
  navTryNowLabel: string;
  navTryDesktop: string;
  navTryWeb: string;
  navTryExtension: string;
  platformsEyebrow: string;
  platformsTitle: string;
  platformsBody: string;
  platforms: {
    badge: string;
    name: string;
    tagline: string;
    body: string;
    action: string;
  }[];
  compareEyebrow: string;
  compareTitle: string;
  compareHeaders: {
    feature: string;
    desktop: string;
    web: string;
    extension: string;
  };
  compareRows: {
    feature: string;
    desktop: string;
    web: string;
    extension: string;
  }[];
  compareNote: string;
};

export const homeContent: Record<Locale, HomeLocaleContent> = {
  zh: {
    nav: {
      product: "产品",
      platforms: "平台",
      desktop: "桌面版",
      extension: "浏览器扩展",
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
    desktopEntryAction: "下载桌面版",
    desktopEntryNote: "macOS · Windows · Linux",
    extensionEntryAction: "浏览器扩展发布进展",
    extensionEntryNote: "Chrome · Edge · 发布准备中",
    extensionStoreAction: "Chrome 应用商店",
    extensionStoreNote: "商店上架准备中",
    extensionZipAction: "Chrome ZIP",
    extensionZipNote: "正式发布后开放下载",
    extensionSourceAction: "扩展源码",
    extensionManualTitle: "浏览器扩展正在准备发布",
    extensionManualBody:
      "Chrome 和 Edge 扩展尚未公开发布。安装包与源码公开后，这里会开放对应入口；现在可以使用 Web 版或桌面版。",
    channelNavLabel: "选择 ImgConvert 使用方式",
    navTryNow: "立即体验",
    navTryNowLabel: "选择 ImgConvert 体验方式",
    navTryDesktop: "下载桌面版",
    navTryWeb: "在线网页版",
    navTryExtension: "浏览器扩展版",
    platformsEyebrow: "ONE TOOL, EVERY PLATFORM",
    platformsTitle: "桌面、网页、浏览器扩展，全平台覆盖。",
    platformsBody:
      "电脑上用桌面版跑完整工作流；手机或平板直接打开网页版，还能安装为 PWA 离线使用；浏览网页时，浏览器扩展右键即转。三个版本都不上传原图。",
    platforms: [
      {
        badge: "完整功能",
        name: "桌面版",
        tagline: "macOS · Windows · Linux",
        body: "Rust 图像核心与并行批处理，独享 HEIC 输入、文件夹递归导入、目标体积压缩与元数据策略等专业能力。",
        action: "查看下载选项",
      },
      {
        badge: "免安装 · PWA",
        name: "网页版",
        tagline: "任意现代浏览器 · 手机友好",
        body: "打开即用，输出 AVIF / WebP / JPEG / PNG，支持 PDF 与 SVG 输入。安装为 PWA 后离线可用，手机、平板上也能批量转换。",
        action: "打开网页版",
      },
      {
        badge: "Chrome · Edge",
        name: "浏览器扩展",
        tagline: "右键即转网页图片",
        body: "在任意网页对图片右键，一键送入转换队列，侧边栏与全屏工作台随时处理。扩展商店上架筹备中。",
        action: "获取扩展",
      },
    ],
    compareEyebrow: "COMPARE",
    compareTitle: "三个版本，怎么选？",
    compareHeaders: {
      feature: "能力",
      desktop: "桌面版",
      web: "网页版",
      extension: "浏览器扩展",
    },
    compareRows: [
      {
        feature: "运行平台",
        desktop: "macOS · Windows · Linux",
        web: "任意现代浏览器（含手机）",
        extension: "Chrome · Edge（Chromium 116+）",
      },
      {
        feature: "输出格式",
        desktop: "AVIF · WebP · JPEG · PNG",
        web: "与桌面版一致",
        extension: "与桌面版一致",
      },
      {
        feature: "输入格式",
        desktop: "主格式 + PDF · SVG · HEIC",
        web: "主格式 + PDF · SVG · BMP · GIF（静态）",
        extension: "同网页版 + 网页图片右键导入",
      },
      {
        feature: "批量性能",
        desktop: "多核并行 · 内存感知调度",
        web: "单 Worker 串行",
        extension: "单 Worker 串行",
      },
      {
        feature: "目标体积压缩",
        desktop: "支持（自动质量寻优）",
        web: "—",
        extension: "—",
      },
      {
        feature: "元数据与色彩",
        desktop: "ICC · Display P3 · 元数据策略",
        web: "—",
        extension: "—",
      },
      {
        feature: "离线使用",
        desktop: "支持",
        web: "支持（安装 PWA 后）",
        extension: "支持",
      },
      {
        feature: "获取方式",
        desktop: "应用商店 · 安装包",
        web: "直接打开 · 可安装 PWA",
        extension: "扩展商店（上架筹备中）",
      },
      {
        feature: "推荐场景",
        desktop: "大批量 · 完整工作流",
        web: "手机 · 平板 · 临时任务",
        extension: "网页图片快速转换",
      },
    ],
    compareNote: "无论选择哪个版本，图片始终在你的设备或浏览器内完成处理，绝不上传。",
  },
  en: {
    nav: {
      product: "Product",
      platforms: "Platforms",
      desktop: "Desktop",
      extension: "Browser extension",
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
    desktopEntryAction: "Download desktop",
    desktopEntryNote: "macOS · Windows · Linux",
    extensionEntryAction: "Browser extension release status",
    extensionEntryNote: "Chrome · Edge · preparing release",
    extensionStoreAction: "Chrome Web Store",
    extensionStoreNote: "Store listing in preparation",
    extensionZipAction: "Chrome ZIP",
    extensionZipNote: "Download opens after publication",
    extensionSourceAction: "Extension source",
    extensionManualTitle: "Browser extension release in preparation",
    extensionManualBody:
      "The Chrome and Edge extensions are not publicly released yet. Package and source links will open when available. You can use the Web or desktop app now.",
    channelNavLabel: "Choose how to use ImgConvert",
    navTryNow: "Try it now",
    navTryNowLabel: "Choose how to try ImgConvert",
    navTryDesktop: "Download desktop",
    navTryWeb: "Open web app",
    navTryExtension: "Browser extension",
    platformsEyebrow: "ONE TOOL, EVERY PLATFORM",
    platformsTitle: "Desktop, web, and a browser extension.",
    platformsBody:
      "Run the complete workflow with the desktop app; on a phone or tablet, just open the web app—or install it as a PWA for offline use; and right-click any web image with the browser extension. None of the three ever uploads your originals.",
    platforms: [
      {
        badge: "Full feature set",
        name: "Desktop",
        tagline: "macOS · Windows · Linux",
        body: "A Rust imaging core with parallel batch processing, plus exclusive HEIC input, recursive folder imports, target-size compression, and metadata policies.",
        action: "See download options",
      },
      {
        badge: "No install · PWA",
        name: "Web app",
        tagline: "Any modern browser · Mobile-friendly",
        body: "Open and convert to AVIF / WebP / JPEG / PNG, with PDF and SVG input. Install it as a PWA for offline use—batch conversion works on phones and tablets too.",
        action: "Open the Web app",
      },
      {
        badge: "Chrome · Edge",
        name: "Browser extension",
        tagline: "Right-click any web image",
        body: "Send images from any page into the conversion queue, then work in the side panel or full-screen workbench. Extension store listings are in preparation.",
        action: "Get the extension",
      },
    ],
    compareEyebrow: "COMPARE",
    compareTitle: "Which version fits you?",
    compareHeaders: {
      feature: "Capability",
      desktop: "Desktop",
      web: "Web app",
      extension: "Extension",
    },
    compareRows: [
      {
        feature: "Platform",
        desktop: "macOS · Windows · Linux",
        web: "Any modern browser, incl. mobile",
        extension: "Chrome · Edge (Chromium 116+)",
      },
      {
        feature: "Output formats",
        desktop: "AVIF · WebP · JPEG · PNG",
        web: "Same as desktop",
        extension: "Same as desktop",
      },
      {
        feature: "Input formats",
        desktop: "Core formats + PDF · SVG · HEIC",
        web: "Core + PDF · SVG · BMP · GIF (static)",
        extension: "Web app inputs + right-click web images",
      },
      {
        feature: "Batch performance",
        desktop: "Parallel, memory-aware",
        web: "Single worker, serial",
        extension: "Single worker, serial",
      },
      {
        feature: "Target-size compression",
        desktop: "Yes (auto quality search)",
        web: "—",
        extension: "—",
      },
      {
        feature: "Metadata & color",
        desktop: "ICC · Display P3 · metadata policies",
        web: "—",
        extension: "—",
      },
      {
        feature: "Offline use",
        desktop: "Yes",
        web: "Yes (after PWA install)",
        extension: "Yes",
      },
      {
        feature: "How to get it",
        desktop: "App stores · installers",
        web: "Open in browser · installable PWA",
        extension: "Extension stores (in preparation)",
      },
      {
        feature: "Best for",
        desktop: "Large batches · full workflow",
        web: "Phones · tablets · quick tasks",
        extension: "Quick conversions of web images",
      },
    ],
    compareNote:
      "Whichever version you choose, images are always processed on your device or inside your browser—never uploaded.",
  },
};
