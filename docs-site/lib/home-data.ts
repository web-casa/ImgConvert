import type { IconName } from "@/components/icons";
import type { DocsLocale } from "@/lib/locale-routing";

type HomeData = {
  entryPoints: ReadonlyArray<{
    desc: string;
    href: string;
    icon: IconName;
    label: string;
  }>;
  formats: ReadonlyArray<{
    desc: string;
    glyph: string;
    name: string;
    tag: string;
  }>;
  hero: {
    description: string;
    download: string;
    eyebrow: string;
    headingAccent: string;
    headingLeading: string;
    install: string;
  };
  highlights: ReadonlyArray<{
    detail: string;
    icon: IconName;
    index: string;
    title: string;
  }>;
  mockup: {
    compression: string;
    cores: string;
    drop: string;
    format: string;
    lossless: string;
    noTelemetry: string;
    noUpload: string;
    offline: string;
    preset: string;
    processed: string;
    quality: string;
    queued: string;
    skip: string;
  };
  sections: {
    ctaDescription: string;
    ctaEyebrow: string;
    ctaTitle: string;
    docsEyebrow: string;
    formatsDescription: string;
    formatsEyebrow: string;
    formatsLink: string;
    formatsLinkHref: string;
    formatsTitle: string;
    getStarted: string;
    navigationTitle: string;
    principlesEyebrow: string;
    principlesTitle: string;
  };
  stats: ReadonlyArray<{
    label: string;
    value: string;
  }>;
};

export const homeData: Record<DocsLocale, HomeData> = {
  "zh-CN": {
    entryPoints: [
      {
        label: "安装指南",
        desc: "下载、校验、AppImage / deb / rpm 安装",
        href: "/docs/install",
        icon: "download",
      },
      {
        label: "使用说明",
        desc: "批量导入、格式选择、压缩与元数据",
        href: "/docs/usage",
        icon: "book",
      },
      {
        label: "命令速查",
        desc: "开发、质量、发布与文档站的常用命令",
        href: "/docs/commands",
        icon: "terminal",
      },
      {
        label: "排障手册",
        desc: "Linux / AppImage / HEIC / updater 常见问题",
        href: "/docs/troubleshooting",
        icon: "wrench",
      },
      {
        label: "隐私政策",
        desc: "本机数据处理、缓存和权限使用说明",
        href: "/docs/privacy",
        icon: "shield",
      },
      {
        label: "发布流程",
        desc: "GitHub Releases 范围、资产与发布前检查",
        href: "/docs/release",
        icon: "rocket",
      },
      {
        label: "架构设计",
        desc: "前端、Tauri 后端与 Rust 图像核心边界",
        href: "/docs/architecture",
        icon: "blueprint",
      },
      {
        label: "格式能力",
        desc: "支持的输入输出格式、压缩与元数据",
        href: "/docs/formats",
        icon: "image",
      },
      {
        label: "HEIC 策略",
        desc: "为什么主程序不内置，平台后续路线",
        href: "/docs/heic",
        icon: "camera",
      },
      {
        label: "开发质量",
        desc: "本地开发、guardrail 与长期质量项目",
        href: "/docs/development",
        icon: "check",
      },
    ],
    formats: [
      {
        glyph: "LOSSY · COMPAT",
        name: "JPEG",
        desc: "兼容性最佳，支持自动质量与可选的更小输出策略",
        tag: "mozjpeg encoder",
      },
      {
        glyph: "LOSSLESS · ALPHA",
        name: "PNG",
        desc: "无损输出，保留透明度与 ICC/EXIF/XMP",
        tag: "oxipng",
      },
      {
        glyph: "VERSATILE · WEB",
        name: "WebP",
        desc: "体积与质量平衡，无损与有损双模式",
        tag: "libwebp",
      },
      {
        glyph: "NEXT-GEN · 10BIT",
        name: "AVIF",
        desc: "下一代格式，真无损 + 极致压缩比",
        tag: "libavif (rav1e + aom)",
      },
    ],
    hero: {
      description:
        "Tauri 2 + Rust 图像核心的桌面工具。拖拽导入、选择格式、压缩策略——全部本机完成，不上传、不依赖云、无需网络。",
      download: "下载",
      eyebrow: "本地优先 · 图像批量转换管线",
      headingAccent: "装回你自己的机器",
      headingLeading: "把图像工作流，",
      install: "开始安装",
    },
    highlights: [
      {
        index: "01",
        title: "本地优先",
        detail:
          "转换与压缩默认在本机完成，不上传用户图片到任何远端服务。隐私内置在管线里，不靠开关。",
        icon: "shield",
      },
      {
        index: "02",
        title: "Linux 先行",
        detail:
          "第一期 GitHub Releases 提供 amd64/aarch64 AppImage、arm64 deb 与 aarch64 rpm；AppImage 配套 Tauri updater 资产。",
        icon: "launch",
      },
      {
        index: "03",
        title: "许可洁净",
        detail:
          "主程序 Apache-2.0，主依赖树禁止 GPL / AGPL / LGPL，为个人使用、企业内部署与商店上架留门。",
        icon: "scale",
      },
    ],
    mockup: {
      compression: "极致压缩",
      cores: "2 核 SIMD",
      drop: "拖拽图片到这里",
      format: "格式",
      lossless: "无损",
      noTelemetry: "无遥测 · 无云调用",
      noUpload: "零上传",
      offline: "● 本机 · 离线",
      preset: "预设",
      processed: "0 / 12 已处理 · 节省 1.2 MB",
      quality: "质量 · 85",
      queued: "ImgConvert — 12 个文件待处理",
      skip: "跳过更大结果 ✓",
    },
    sections: {
      ctaDescription: "主程序和核心依赖树均采用宽松许可证，适合个人使用、企业内部部署与商店上架。",
      ctaEyebrow: "开源 & 上架友好",
      ctaTitle: "Apache-2.0 许可证",
      docsEyebrow: "文档目录",
      formatsDescription: "HEIC 通过平台系统能力或外部 helper 作为可选输入，不进入主 codec 矩阵。",
      formatsEyebrow: "格式能力矩阵",
      formatsLink: "详见 HEIC 策略 →",
      formatsLinkHref: "/docs/heic",
      formatsTitle: "支持的核心格式",
      getStarted: "开始使用",
      navigationTitle: "快速导航",
      principlesEyebrow: "为什么选择 ImgConvert",
      principlesTitle: "设计原则",
    },
    stats: [
      { value: "4", label: "主格式 · JPEG/PNG/WebP/AVIF" },
      { value: "2", label: "AppImage · amd64 + aarch64" },
      { value: "2", label: "系统包 · arm64 deb / aarch64 rpm" },
      { value: "∞", label: "本机转换次数 · 不上传任何图" },
    ],
  },
  "en-US": {
    entryPoints: [
      {
        label: "Installation",
        desc: "Download, verify, and install AppImage, deb, or rpm packages",
        href: "/docs/install",
        icon: "download",
      },
      {
        label: "Usage",
        desc: "Batch import, formats, compression, and metadata",
        href: "/docs/usage",
        icon: "book",
      },
      {
        label: "Troubleshooting",
        desc: "Common Linux, AppImage, HEIC, and updater issues",
        href: "/docs/troubleshooting",
        icon: "wrench",
      },
      {
        label: "Privacy policy",
        desc: "How local data, caches, and permissions are handled",
        href: "/docs/privacy",
        icon: "shield",
      },
    ],
    formats: [
      {
        glyph: "LOSSY · COMPAT",
        name: "JPEG",
        desc: "Best compatibility, with auto quality and an optional keep-smaller policy",
        tag: "mozjpeg encoder",
      },
      {
        glyph: "LOSSLESS · ALPHA",
        name: "PNG",
        desc: "Lossless output with alpha and ICC/EXIF/XMP support",
        tag: "oxipng",
      },
      {
        glyph: "VERSATILE · WEB",
        name: "WebP",
        desc: "A balance of size and quality, with lossless and lossy modes",
        tag: "libwebp",
      },
      {
        glyph: "NEXT-GEN · 10BIT",
        name: "AVIF",
        desc: "A next-generation format with true lossless output and high compression",
        tag: "libavif (rav1e + aom)",
      },
    ],
    hero: {
      description:
        "A desktop tool powered by Tauri 2 and a Rust imaging core. Drop files, choose a format and compression strategy—everything runs locally, with no upload, cloud dependency, or network requirement.",
      download: "Download",
      eyebrow: "Local-first · Batch image conversion pipeline",
      headingAccent: "back on your own machine",
      headingLeading: "Bring your image workflow",
      install: "Install ImgConvert",
    },
    highlights: [
      {
        index: "01",
        title: "Local first",
        detail:
          "Conversion and compression run on your device by default. Your images are not uploaded to a remote service; privacy is part of the pipeline, not a switch.",
        icon: "shield",
      },
      {
        index: "02",
        title: "Linux first",
        detail:
          "The first GitHub Releases provide amd64/aarch64 AppImages, arm64 debs, and aarch64 rpms. AppImages include the Tauri updater assets.",
        icon: "launch",
      },
      {
        index: "03",
        title: "License-clean",
        detail:
          "The app is Apache-2.0 and the primary dependency tree excludes GPL / AGPL / LGPL, keeping room for personal use, internal deployment, and stores.",
        icon: "scale",
      },
    ],
    mockup: {
      compression: "Maximum compression",
      cores: "2-core SIMD",
      drop: "Drop images here",
      format: "format",
      lossless: "Lossless",
      noTelemetry: "No telemetry · No cloud calls",
      noUpload: "No uploads",
      offline: "● Local · Offline",
      preset: "preset",
      processed: "0 / 12 processed · 1.2 MB saved",
      quality: "Quality · 85",
      queued: "ImgConvert — 12 files queued",
      skip: "conversion-first ✓",
    },
    sections: {
      ctaDescription:
        "The app and its primary dependency tree use permissive licenses, fitting personal use, internal deployment, and store distribution.",
      ctaEyebrow: "Open source & store-ready",
      ctaTitle: "Apache-2.0 license",
      docsEyebrow: "Documentation",
      formatsDescription:
        "HEIC is an optional input through platform support or an external helper; it is outside the core codec matrix.",
      formatsEyebrow: "Format capability matrix",
      formatsLink: "Read the usage guide →",
      formatsLinkHref: "/docs/usage",
      formatsTitle: "Core supported formats",
      getStarted: "Get started",
      navigationTitle: "Quick navigation",
      principlesEyebrow: "Why ImgConvert",
      principlesTitle: "Design principles",
    },
    stats: [
      { value: "4", label: "Core formats · JPEG/PNG/WebP/AVIF" },
      { value: "2", label: "AppImages · amd64 + aarch64" },
      { value: "2", label: "System packages · arm64 deb / aarch64 rpm" },
      { value: "∞", label: "Local conversions · no image uploads" },
    ],
  },
};

export const downloadHref = "https://github.com/web-casa/ImgConvert/releases/tag/v0.1.2";
export const repoHref = "https://github.com/web-casa/ImgConvert";
export const version = "v0.1.2";
