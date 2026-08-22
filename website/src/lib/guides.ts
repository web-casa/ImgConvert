// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import { releaseUrl, storeUrl, type Locale } from "./content";

export const guideIds = [
  "windows-png-to-avif",
  "windows-batch-image-compression",
  "macos-heic-to-jpg",
  "macos-png-to-webp",
  "ubuntu-webp-lossless-compression",
  "linux-jpeg-to-avif",
] as const;

export type GuideId = (typeof guideIds)[number];

type GuideStep = {
  title: string;
  body: string;
};

type GuideQuestion = {
  question: string;
  answer: string;
};

type GuideCta = {
  label: string;
  href: string;
};

export type GuidePage = {
  eyebrow: string;
  platform: string;
  input: string;
  output: string;
  processing: string;
  title: string;
  lede: string;
  requirements: string[];
  steps: GuideStep[];
  notes: string[];
  questions: GuideQuestion[];
  primaryCta: GuideCta;
  secondaryCta?: GuideCta;
};

type GuideLocaleContent = {
  common: {
    home: string;
    guides: string;
    docs: string;
    blog: string;
    privacy: string;
    language: string;
    navigation: string;
    skip: string;
    breadcrumbHome: string;
    breadcrumbGuides: string;
    local: string;
    platform: string;
    input: string;
    output: string;
    processing: string;
    requirements: string;
    steps: string;
    notes: string;
    faq: string;
    related: string;
    allGuides: string;
    download: string;
    localNote: string;
    homeEyebrow: string;
    homeTitle: string;
    homeBody: string;
    workspaceEyebrow: string;
    workspaceTitle: string;
    workspaceBody: string;
    workspaceAlt: string;
    workspaceCaption: string;
  };
  pages: Record<GuideId, GuidePage>;
};

export const guidePaths: Record<Locale, Record<GuideId, string>> = {
  zh: {
    "windows-png-to-avif": "/windows/png-to-avif/",
    "windows-batch-image-compression": "/windows/batch-image-compression/",
    "macos-heic-to-jpg": "/macos/heic-to-jpg/",
    "macos-png-to-webp": "/macos/png-to-webp/",
    "ubuntu-webp-lossless-compression": "/ubuntu/webp-lossless-compression/",
    "linux-jpeg-to-avif": "/linux/jpeg-to-avif/",
  },
  en: {
    "windows-png-to-avif": "/en/windows/png-to-avif/",
    "windows-batch-image-compression": "/en/windows/batch-image-compression/",
    "macos-heic-to-jpg": "/en/macos/heic-to-jpg/",
    "macos-png-to-webp": "/en/macos/png-to-webp/",
    "ubuntu-webp-lossless-compression": "/en/ubuntu/webp-lossless-compression/",
    "linux-jpeg-to-avif": "/en/linux/jpeg-to-avif/",
  },
};

export const guideContent: Record<Locale, GuideLocaleContent> = {
  zh: {
    common: {
      home: "首页",
      guides: "实用指南",
      docs: "文档",
      blog: "Blog",
      privacy: "隐私政策",
      language: "语言",
      navigation: "指南导航",
      skip: "跳至主要内容",
      breadcrumbHome: "首页",
      breadcrumbGuides: "实用指南",
      local: "本机处理",
      platform: "系统",
      input: "输入",
      output: "输出",
      processing: "处理方式",
      requirements: "开始前准备",
      steps: "操作步骤",
      notes: "使用边界与提示",
      faq: "常见问题",
      related: "继续阅读",
      allGuides: "查看全部实用指南",
      download: "获取 ImgConvert",
      localNote: "图片留在你的设备上处理，不上传到网页服务。",
      homeEyebrow: "PLATFORM & FORMAT GUIDES",
      homeTitle: "从一个具体的问题，\n开始处理图片。",
      homeBody:
        "Windows、macOS 和 Ubuntu 的操作边界各不相同。下面的页面说明当前产品真实支持的路径、设置和需要留意的限制。",
      workspaceEyebrow: "真实产品界面",
      workspaceTitle: "输出格式，在本地工作区中确认。",
      workspaceBody:
        "这里展示的是 ImgConvert 的实际格式选择界面。AVIF、WebP、JPEG 与 PNG 放在同一处；单张图片可跟随全局设置，也可按需单独选择。",
      workspaceAlt: "ImgConvert 的真实输出格式选择界面，显示 AVIF、WebP、JPEG 与 PNG 选项",
      workspaceCaption: "真实格式选择界面；选项会随应用版本与系统能力变化。",
    },
    pages: {
      "windows-png-to-avif": {
        eyebrow: "WINDOWS · PNG → AVIF",
        platform: "Windows",
        input: "PNG",
        output: "AVIF",
        processing: "本机",
        title: "Windows 下 PNG 转 AVIF 的本地工具与操作方法",
        lede: "想在 Windows 下把 PNG 转成 AVIF，又不想把图片上传到网页？ImgConvert 可处理你主动选择的 PNG 文件或文件夹，并把结果输出为 AVIF。",
        requirements: [
          "从 Microsoft Store 或 GitHub Releases 获取 ImgConvert。",
          "准备要转换的 PNG 文件，或包含 PNG 的文件夹。",
          "选择一个你有写入权限的输出目录。",
        ],
        steps: [
          {
            title: "导入 PNG 图片",
            body: "把 PNG 文件或文件夹加入任务队列；同一批任务可以包含多张图片。",
          },
          {
            title: "将目标格式设为 AVIF",
            body: "在输出设置中选择 AVIF。需要为个别图片使用不同格式时，可单独覆盖它的输出格式。",
          },
          {
            title: "按需要选择无损模式",
            body: "需要逐像素保留时，开启无损压缩。真无损 AVIF 与仅把质量调高并不是同一件事。",
          },
          {
            title: "确认输出目录并开始转换",
            body: "选择输出目录后开始转换；进度和结果会留在同一个桌面工作区中查看。",
          },
        ],
        notes: [
          "真无损 AVIF 可以保留像素，但输出文件不保证一定比原始 PNG 更小。",
          "若交付给旧版软件或浏览器，请同时保留 PNG 或 JPEG 备用格式。",
          "转换和压缩在你的设备上完成，原图不会被上传到 ImgConvert 的服务器。",
        ],
        questions: [
          {
            question: "Windows 版可以一次转换多个 PNG 文件吗？",
            answer: "可以。你可以把文件或文件夹加入同一个任务队列，再统一选择 AVIF 作为输出格式。",
          },
          {
            question: "AVIF 无损模式一定会把 PNG 压得更小吗？",
            answer:
              "不一定。无损模式的目标是像素可逆，不是保证体积最小；实际大小取决于图片内容和编码结果。",
          },
          {
            question: "PNG 转 AVIF 时图片会上传吗？",
            answer: "不会。ImgConvert 是桌面应用，文件处理发生在本机。",
          },
        ],
        primaryCta: {
          label: "在 Microsoft Store 获取 Windows 版",
          href: storeUrl,
        },
        secondaryCta: {
          label: "查看 GitHub Releases",
          href: releaseUrl,
        },
      },
      "windows-batch-image-compression": {
        eyebrow: "WINDOWS · BATCH COMPRESSION",
        platform: "Windows",
        input: "JPEG / PNG / WebP / AVIF",
        output: "按任务选择",
        processing: "本机",
        title: "Windows 下如何批量压缩图片（PNG、JPEG、WebP、AVIF）？",
        lede: "如果你想在 Windows 上批量处理图片，又不希望把文件交给网页服务，ImgConvert 可把你主动选择的文件或文件夹加入同一队列，并在本机完成格式转换和压缩设置。",
        requirements: [
          "从 Microsoft Store 获取 ImgConvert 的 Windows 版。",
          "准备一组要处理的 JPEG、PNG、WebP 或 AVIF 图片，或它们所在的文件夹。",
          "选择一个可写入的输出目录，并在重要任务前保留原图。",
        ],
        steps: [
          {
            title: "把文件或文件夹加入队列",
            body: "选择一批图片或整个文件夹导入。任务队列会把你主动选择的输入集中在同一个工作区中。",
          },
          {
            title: "先决定每批任务的目标格式",
            body: "在输出设置中选择 JPEG、PNG、WebP 或 AVIF。需要例外时，可以为个别图片单独选择输出格式。",
          },
          {
            title: "按用途调整质量或无损模式",
            body: "面向体积时调整质量；需要可逆像素输出时，只在支持的目标格式中开启无损。质量数值和真无损是两种不同的选择。",
          },
          {
            title: "保留“跳过更大输出”并开始处理",
            body: "确认目录后启动任务。若不希望候选输出比源文件更大，可以保持“跳过更大输出”开启。",
          },
        ],
        notes: [
          "压缩结果取决于原图内容、目标格式和编码设置；无法承诺每张图片都会更小。",
          "对 JPEG 这类有损来源，转换成无损输出不会恢复已经丢失的细节。",
          "处理只发生在你的 Windows 设备上；ImgConvert 不会上传你主动选择的图片。",
        ],
        questions: [
          {
            question: "Windows 版可以一次处理一个文件夹吗？",
            answer:
              "可以。你可以把主动选择的文件或文件夹加入同一任务队列，再统一设置输出格式和处理参数。",
          },
          {
            question: "为什么“压缩”后的图片可能没有更小？",
            answer:
              "图片内容、原有编码和目标设置都会影响结果。开启“跳过更大输出”时，候选结果若不更小可以不写入输出目录。",
          },
          {
            question: "批量处理时会上传图片吗？",
            answer: "不会。导入、转换、压缩和输出都在本机完成。",
          },
        ],
        primaryCta: {
          label: "在 Microsoft Store 获取 Windows 版",
          href: storeUrl,
        },
        secondaryCta: {
          label: "查看 GitHub Releases",
          href: releaseUrl,
        },
      },
      "macos-heic-to-jpg": {
        eyebrow: "MACOS · HEIC → JPEG",
        platform: "macOS",
        input: "HEIC / HEIF",
        output: "JPEG / JPG",
        processing: "本机",
        title: "macOS 下如何将 HEIC 转成 JPG？",
        lede: "如果 macOS 能通过系统 ImageIO 读取该 HEIC 或 HEIF 文件，ImgConvert 可以在本机将它转换为 JPEG/JPG。HEIC 是输入格式，JPEG 是输出格式。",
        requirements: [
          "从 GitHub Releases 获取 ImgConvert 的 macOS 版本。",
          "准备 macOS 可以读取的 HEIC 或 HEIF 图片。",
          "选择一个用于保存 JPEG 输出文件的目录。",
        ],
        steps: [
          {
            title: "导入 HEIC 或 HEIF 图片",
            body: "把要处理的图片或文件夹加入队列。macOS 会通过本机系统 ImageIO 读取支持的 HEIC 文件。",
          },
          {
            title: "将目标格式设为 JPEG",
            body: "在输出设置中选择 JPEG；JPG 是 JPEG 的常用文件扩展名，指向同一种输出格式。",
          },
          {
            title: "选择质量与元数据选项",
            body: "按用途调整 JPEG 质量。输出默认不保留原图元数据；只有明确需要时再开启保留元数据。",
          },
          {
            title: "选择目录并开始转换",
            body: "确认输出目录后开始任务，在同一个工作区查看处理进度和结果。",
          },
        ],
        notes: [
          "ImgConvert 目前不导出 HEIC；HEIC 是由平台能力支持的只读导入格式。",
          "默认不会自动保留原图元数据；你可以在需要时明确开启保留受支持的 ICC、EXIF、XMP 等数据。",
          "HEIC 读取依赖 macOS 本机的系统能力，不需要把图片提交给在线转换服务。",
        ],
        questions: [
          {
            question: "在 macOS 上转换 HEIC 需要网页上传吗？",
            answer:
              "不需要。支持的 HEIC 文件由 macOS 系统能力在本机读取，ImgConvert 在本机完成 JPEG 输出。",
          },
          {
            question: "可以把多个 HEIC 文件一次转成 JPG 吗？",
            answer: "可以。把多张图片或整个文件夹加入任务队列，统一设置 JPEG 输出即可。",
          },
          {
            question: "ImgConvert 可以输出 HEIC 吗？",
            answer: "不能。HEIC 目前是只读导入格式；此页面介绍的是将 HEIC 转为 JPEG/JPG。",
          },
        ],
        primaryCta: {
          label: "从 GitHub Releases 获取 macOS 版",
          href: releaseUrl,
        },
      },
      "macos-png-to-webp": {
        eyebrow: "MACOS · PNG → WEBP",
        platform: "macOS",
        input: "PNG",
        output: "WebP",
        processing: "本机",
        title: "macOS 下如何在本地将 PNG 转成 WebP？",
        lede: "想把 PNG 转成适合现代 Web 交付的 WebP，又不想上传原图？在 macOS 上，ImgConvert 可以处理你主动选择的 PNG 文件或文件夹，并把 WebP 写入你选择的本地目录。",
        requirements: [
          "从 GitHub Releases 获取 ImgConvert 的 macOS 版本。",
          "准备需要转换的 PNG 文件，或含有 PNG 的文件夹。",
          "选择一个可写入的输出目录；重要原图建议保留备份。",
        ],
        steps: [
          {
            title: "导入 PNG 文件或文件夹",
            body: "把 PNG 图片加入任务队列。文件夹导入适合需要一次处理多张素材的情况。",
          },
          {
            title: "选择 WebP 作为目标格式",
            body: "在输出设置中选择 WebP。若批次中有某一张图片需要不同格式，可为它单独覆盖输出选择。",
          },
          {
            title: "按交付场景设置编码方式",
            body: "根据体积、质量和兼容性需求调整参数。需要像素可逆时，使用 WebP 的无损模式；单纯把质量设高并不等于真无损。",
          },
          {
            title: "确认目录后开始转换",
            body: "检查输出目录并开始任务；进度、取消和结果都会显示在本地桌面工作区中。",
          },
        ],
        notes: [
          "无损 WebP 关注可逆像素，并不保证每一张 PNG 都比原图小。",
          "如果素材必须适配旧版软件或浏览器，请同时保留 PNG 或准备其他兼容格式。",
          "转换不需要在线上传；图片只在你的 macOS 设备上读取和输出。",
        ],
        questions: [
          {
            question: "macOS 上可以批量把 PNG 转成 WebP 吗？",
            answer: "可以。把多张 PNG 或包含它们的文件夹加入任务队列，再把目标格式设为 WebP。",
          },
          {
            question: "WebP 无损一定比 PNG 小吗？",
            answer: "不一定。无损模式的目标是可逆像素，实际文件大小仍由图片内容和编码结果决定。",
          },
          {
            question: "PNG 转 WebP 时是否会使用网页服务器？",
            answer: "不会。ImgConvert 是桌面应用，处理发生在本机。",
          },
        ],
        primaryCta: {
          label: "从 GitHub Releases 获取 macOS 版",
          href: releaseUrl,
        },
      },
      "ubuntu-webp-lossless-compression": {
        eyebrow: "UBUNTU · WEBP → WEBP",
        platform: "Ubuntu / Linux",
        input: "WebP",
        output: "WebP（无损）",
        processing: "本机",
        title: "Ubuntu 上如何为 WebP 图片进行本地无损压缩？",
        lede: "要在 Ubuntu 上为 WebP 图片做本地无损压缩，可把输出格式保持为 WebP，并开启无损模式。该过程会以无损编码重新输出图片，而不是上传到一个在线压缩器。",
        requirements: [
          "在 GitHub Releases 中选择适合你的 Linux 安装包并安装 ImgConvert。",
          "准备需要重新编码的 WebP 图片或文件夹。",
          "选择一个可写入的输出目录，并预留原图作为回退。",
        ],
        steps: [
          {
            title: "导入 WebP 图片",
            body: "将 WebP 文件或文件夹加入任务队列，便于一次处理多张图片。",
          },
          {
            title: "把目标格式保持为 WebP",
            body: "在输出设置中选择 WebP。这里的目标是重新编码 WebP，而不是把它转换成其他格式。",
          },
          {
            title: "开启无损并保留“跳过更大输出”",
            body: "启用无损压缩，并在需要避免体积变大时保留“跳过更大输出”。质量设为 100 或近无损不等于真无损。",
          },
          {
            title: "选择目录并开始处理",
            body: "确认输出目录后启动任务。如果候选输出不比源文件小，开启跳过选项时可以不写入它。",
          },
        ],
        notes: [
          "无损 WebP 的目标是像素可逆，不保证每张图片都更小。",
          "“跳过更大输出”可避免把体积相同或更大的候选文件写入输出目录。",
          "压缩和文件访问都在你的 Ubuntu 设备上完成，不会上传图片内容。",
        ],
        questions: [
          {
            question: "为什么有些 WebP 没有生成更小的输出？",
            answer:
              "无损重新编码不能保证更小。若已开启“跳过更大输出”，候选输出与源文件相同或更大时可以被跳过。",
          },
          {
            question: "把质量设为 100 就是真无损吗？",
            answer:
              "不是。质量设置与无损模式是不同的编码选择；需要可逆的像素结果时，应开启无损模式。",
          },
          {
            question: "Ubuntu 上压缩 WebP 时会上传图片吗？",
            answer: "不会。ImgConvert 在本机处理你主动选择的文件和输出目录。",
          },
        ],
        primaryCta: {
          label: "从 GitHub Releases 获取 Linux 版",
          href: releaseUrl,
        },
      },
      "linux-jpeg-to-avif": {
        eyebrow: "LINUX · JPEG → AVIF",
        platform: "Linux",
        input: "JPEG / JPG",
        output: "AVIF",
        processing: "本机",
        title: "Linux 下如何在本地将 JPEG 转成 AVIF？",
        lede: "如果你在 Linux 上需要把 JPEG/JPG 转成 AVIF，可以使用 ImgConvert 在本地导入主动选择的图片或文件夹，再把 AVIF 输出到指定目录，不需要在线转换服务。",
        requirements: [
          "在 GitHub Releases 中选择适合系统架构的 Linux 安装包并安装 ImgConvert。",
          "准备 JPEG/JPG 图片或包含它们的文件夹。",
          "选择一个可写入的输出目录，并保留原始 JPEG 作为回退。",
        ],
        steps: [
          {
            title: "导入 JPEG 或 JPG 图片",
            body: "将文件或文件夹加入任务队列；同一任务可包含多张你主动选择的图片。",
          },
          {
            title: "将目标格式设为 AVIF",
            body: "在输出设置中选择 AVIF。个别图片有不同交付要求时，可单独覆盖它的输出格式。",
          },
          {
            title: "根据用途调整质量",
            body: "JPEG 已经是有损来源。选择较高质量可以减少额外损失，但不能恢复 JPEG 在此前编码中已经丢失的细节。",
          },
          {
            title: "确认输出目录并处理任务",
            body: "选择目录后开始转换，在同一个桌面工作区查看进度与结果。需要避免更大候选文件时，可以启用“跳过更大输出”。",
          },
        ],
        notes: [
          "把 JPEG 转成 AVIF 可能适合某些现代交付场景，但兼容性要求更广时应保留 JPEG 备用。",
          "对 JPEG 开启无损 AVIF 只能保留解码后的当前像素，不能让原始照片恢复为未压缩状态。",
          "文件不会离开你的 Linux 设备；ImgConvert 只处理你主动选择的输入和输出目录。",
        ],
        questions: [
          {
            question: "Linux 版可以批量将 JPG 转为 AVIF 吗？",
            answer:
              "可以。将多张 JPEG/JPG 或它们所在的文件夹加入任务队列，再选择 AVIF 作为输出格式。",
          },
          {
            question: "无损 AVIF 能恢复 JPEG 的原始质量吗？",
            answer:
              "不能。JPEG 已是有损格式；无损 AVIF 最多保留当前解码后的像素，无法还原过去编码中损失的信息。",
          },
          {
            question: "Linux 上转换 JPEG 时会上传到云端吗？",
            answer: "不会。ImgConvert 在本机完成转换和输出。",
          },
        ],
        primaryCta: {
          label: "从 GitHub Releases 获取 Linux 版",
          href: releaseUrl,
        },
      },
    },
  },
  en: {
    common: {
      home: "Home",
      guides: "Guides",
      docs: "Docs",
      blog: "Blog",
      privacy: "Privacy",
      language: "Language",
      navigation: "Guide navigation",
      skip: "Skip to main content",
      breadcrumbHome: "Home",
      breadcrumbGuides: "Guides",
      local: "Local processing",
      platform: "Platform",
      input: "Input",
      output: "Output",
      processing: "Processing",
      requirements: "Before you start",
      steps: "Steps",
      notes: "Notes and limits",
      faq: "Common questions",
      related: "Keep reading",
      allGuides: "Browse all guides",
      download: "Get ImgConvert",
      localNote: "Your images stay on your device instead of going to a web service.",
      homeEyebrow: "PLATFORM & FORMAT GUIDES",
      homeTitle: "Start with one specific\nimage task.",
      homeBody:
        "Windows, macOS, and Ubuntu each have different capability boundaries. These guides cover the supported path, settings, and limits for the current product.",
      workspaceEyebrow: "THE REAL PRODUCT UI",
      workspaceTitle: "Confirm the output format in one local workbench.",
      workspaceBody:
        "This is the actual ImgConvert format picker. AVIF, WebP, JPEG, and PNG stay in one place; an image can follow the shared setting or receive its own format when needed.",
      workspaceAlt:
        "The real ImgConvert output-format picker showing AVIF, WebP, JPEG, and PNG options",
      workspaceCaption:
        "The actual format picker; options vary by app version and system capability.",
    },
    pages: {
      "windows-png-to-avif": {
        eyebrow: "WINDOWS · PNG → AVIF",
        platform: "Windows",
        input: "PNG",
        output: "AVIF",
        processing: "Local",
        title: "How to convert PNG to AVIF locally on Windows",
        lede: "Need a Windows PNG-to-AVIF tool without sending images to a website? ImgConvert can process the PNG files or folders you choose and write AVIF output on your device.",
        requirements: [
          "Get ImgConvert from Microsoft Store or GitHub Releases.",
          "Have the PNG files, or a folder containing PNG files, ready to import.",
          "Choose an output directory you can write to.",
        ],
        steps: [
          {
            title: "Import the PNG images",
            body: "Add PNG files or a folder to the task queue. One batch can contain multiple images.",
          },
          {
            title: "Set AVIF as the output format",
            body: "Choose AVIF in the output settings. You can override the format for an individual image when one item needs a different result.",
          },
          {
            title: "Choose lossless when pixels must be preserved",
            body: "Enable lossless compression when you need pixel-for-pixel preservation. True lossless AVIF is different from simply choosing a high quality value.",
          },
          {
            title: "Confirm the output directory and convert",
            body: "Choose the destination and start the task. Progress and results remain visible in the same desktop workspace.",
          },
        ],
        notes: [
          "True lossless AVIF preserves pixels, but it does not guarantee a smaller file than the source PNG.",
          "Keep a PNG or JPEG fallback when the recipient needs older application or browser compatibility.",
          "Conversion and compression happen on your device; ImgConvert does not upload the original images to its servers.",
        ],
        questions: [
          {
            question: "Can the Windows app convert multiple PNG files at once?",
            answer:
              "Yes. Add files or a folder to one queue, then choose AVIF as the shared output format.",
          },
          {
            question: "Will lossless AVIF always make a PNG smaller?",
            answer:
              "No. Lossless mode is about reversible pixels, not a promise of the smallest file. Results depend on the image content and the encoder output.",
          },
          {
            question: "Are PNG files uploaded during conversion?",
            answer: "No. ImgConvert is a desktop app and processes selected files locally.",
          },
        ],
        primaryCta: {
          label: "Get the Windows app from Microsoft Store",
          href: storeUrl,
        },
        secondaryCta: {
          label: "View GitHub Releases",
          href: releaseUrl,
        },
      },
      "windows-batch-image-compression": {
        eyebrow: "WINDOWS · BATCH COMPRESSION",
        platform: "Windows",
        input: "JPEG / PNG / WebP / AVIF",
        output: "Choose per task",
        processing: "Local",
        title: "How to batch-compress images on Windows",
        lede: "Need to batch-process images on Windows without handing files to a web service? ImgConvert can put the files or folders you intentionally select in one queue, then apply format-conversion and compression settings locally.",
        requirements: [
          "Get the Windows edition of ImgConvert from Microsoft Store.",
          "Have the JPEG, PNG, WebP, or AVIF images—or a folder containing them—ready to import.",
          "Choose a writable output directory and keep originals for important work.",
        ],
        steps: [
          {
            title: "Add files or a folder to the queue",
            body: "Select a group of images or a whole folder. The task queue keeps the inputs you explicitly selected in one visible workspace.",
          },
          {
            title: "Decide the output format for the task",
            body: "Choose JPEG, PNG, WebP, or AVIF in output settings. When one image is the exception, it can receive its own output format.",
          },
          {
            title: "Adjust quality or lossless mode for the job",
            body: "Adjust quality when file size is the goal. When you need reversible pixels, enable lossless only for a supported output format. A quality value and true lossless are different choices.",
          },
          {
            title: "Keep Skip larger outputs enabled and process",
            body: "Confirm the output directory and start the task. Keep Skip larger outputs on when you do not want a candidate larger than the source written to disk.",
          },
        ],
        notes: [
          "Results depend on image content, the target format, and encoder settings; no setting can promise every image will be smaller.",
          "Turning a lossy source such as JPEG into a lossless output cannot restore detail that was already lost.",
          "The work stays on your Windows device; ImgConvert does not upload the images you selected.",
        ],
        questions: [
          {
            question: "Can the Windows app process a folder at once?",
            answer:
              "Yes. Add files or a folder you intentionally select to one task queue, then set the shared output format and processing choices.",
          },
          {
            question: "Why might a compressed image not be smaller?",
            answer:
              "Image content, existing encoding, and the target settings all affect the result. With Skip larger outputs enabled, a candidate that is not smaller can be left unwritten.",
          },
          {
            question: "Are images uploaded during batch processing?",
            answer: "No. Import, conversion, compression, and output happen locally.",
          },
        ],
        primaryCta: {
          label: "Get the Windows app from Microsoft Store",
          href: storeUrl,
        },
        secondaryCta: {
          label: "View GitHub Releases",
          href: releaseUrl,
        },
      },
      "macos-heic-to-jpg": {
        eyebrow: "MACOS · HEIC → JPEG",
        platform: "macOS",
        input: "HEIC / HEIF",
        output: "JPEG / JPG",
        processing: "Local",
        title: "How to convert HEIC to JPG on macOS",
        lede: "When macOS can read a HEIC or HEIF file through its system ImageIO support, ImgConvert can convert it to JPEG/JPG locally. HEIC is the input format; JPEG is the output format.",
        requirements: [
          "Get the macOS edition of ImgConvert from GitHub Releases.",
          "Have HEIC or HEIF images that macOS can read.",
          "Choose a directory for the JPEG output files.",
        ],
        steps: [
          {
            title: "Import HEIC or HEIF images",
            body: "Add the images or a folder to the queue. macOS uses local system ImageIO support to read supported HEIC files.",
          },
          {
            title: "Choose JPEG as the output format",
            body: "Select JPEG in the output settings. JPG is the common filename extension for the same JPEG output format.",
          },
          {
            title: "Set quality and metadata choices",
            body: "Adjust JPEG quality for the intended use. Source metadata is not preserved by default; enable preservation only when you explicitly need it.",
          },
          {
            title: "Choose a folder and start conversion",
            body: "Confirm the output directory, start the task, and review progress and results in the same workspace.",
          },
        ],
        notes: [
          "ImgConvert does not export HEIC. HEIC is a platform-capability, read-only import format.",
          "Source metadata is not retained by default. You can explicitly choose to preserve supported ICC, EXIF, XMP, and related metadata when needed.",
          "HEIC reading relies on local macOS system support instead of sending images to an online converter.",
        ],
        questions: [
          {
            question: "Do I need to upload HEIC files to a website on macOS?",
            answer:
              "No. Supported HEIC files are read through macOS system support and ImgConvert writes JPEG output locally.",
          },
          {
            question: "Can I convert a batch of HEIC files to JPG?",
            answer:
              "Yes. Add multiple images or a folder to the task queue, then use JPEG as the output format for the batch.",
          },
          {
            question: "Can ImgConvert export HEIC?",
            answer:
              "No. HEIC is currently read-only input. This guide covers converting HEIC to JPEG/JPG.",
          },
        ],
        primaryCta: {
          label: "Get the macOS app from GitHub Releases",
          href: releaseUrl,
        },
      },
      "macos-png-to-webp": {
        eyebrow: "MACOS · PNG → WEBP",
        platform: "macOS",
        input: "PNG",
        output: "WebP",
        processing: "Local",
        title: "How to convert PNG to WebP locally on macOS",
        lede: "Want to turn PNG into WebP for modern web delivery without uploading the original? On macOS, ImgConvert can process the PNG files or folders you intentionally choose and write WebP to a local directory you select.",
        requirements: [
          "Get the macOS edition of ImgConvert from GitHub Releases.",
          "Have the PNG files, or a folder containing PNG files, ready to import.",
          "Choose a writable output directory and keep backups of important originals.",
        ],
        steps: [
          {
            title: "Import PNG files or a folder",
            body: "Add PNG images to the task queue. Folder import is useful when many assets need the same treatment.",
          },
          {
            title: "Choose WebP as the output format",
            body: "Select WebP in output settings. If one image in the batch has a different delivery requirement, its format can be overridden individually.",
          },
          {
            title: "Choose encoding settings for the delivery need",
            body: "Adjust settings for size, quality, and compatibility. When pixels must remain reversible, use WebP lossless mode; setting a high quality value is not the same as true lossless output.",
          },
          {
            title: "Confirm the directory and convert",
            body: "Review the output directory and start the task. Progress, cancellation, and results remain visible in the local desktop workspace.",
          },
        ],
        notes: [
          "Lossless WebP targets reversible pixels; it does not guarantee that every PNG will be smaller than the source.",
          "Keep PNG available, or prepare another compatible format, when an older application or browser must be supported.",
          "No online upload is needed. Images are read and written on your macOS device.",
        ],
        questions: [
          {
            question: "Can macOS batch-convert PNG images to WebP?",
            answer:
              "Yes. Add multiple PNG files or a folder containing them to the task queue, then choose WebP as the target format.",
          },
          {
            question: "Is lossless WebP always smaller than PNG?",
            answer:
              "No. Lossless mode is about reversible pixels. Actual file size still depends on image content and the encoder output.",
          },
          {
            question: "Does PNG-to-WebP conversion use a web server?",
            answer: "No. ImgConvert is a desktop app and processes the conversion locally.",
          },
        ],
        primaryCta: {
          label: "Get the macOS app from GitHub Releases",
          href: releaseUrl,
        },
      },
      "ubuntu-webp-lossless-compression": {
        eyebrow: "UBUNTU · WEBP → WEBP",
        platform: "Ubuntu / Linux",
        input: "WebP",
        output: "WebP (lossless)",
        processing: "Local",
        title: "How to compress WebP losslessly on Ubuntu",
        lede: "For local, lossless WebP compression on Ubuntu, keep WebP as the output format and enable lossless mode. The image is re-encoded losslessly on your device instead of being sent to an online compressor.",
        requirements: [
          "Choose a suitable Linux installer for your system from GitHub Releases and install ImgConvert.",
          "Have the WebP images or folders you want to re-encode ready.",
          "Choose a writable output directory and keep the originals as a fallback.",
        ],
        steps: [
          {
            title: "Import the WebP images",
            body: "Add WebP files or a folder to the task queue so multiple images can be handled together.",
          },
          {
            title: "Keep WebP as the output format",
            body: "Select WebP in the output settings. The goal is to re-encode WebP, not convert it to another format.",
          },
          {
            title: "Enable lossless and keep Skip larger outputs on",
            body: "Turn on lossless compression and keep Skip larger outputs enabled when you do not want larger files written. Quality 100 or near-lossless is not the same as true lossless mode.",
          },
          {
            title: "Choose a directory and process the batch",
            body: "Confirm the destination and start the task. With the skip option enabled, a candidate that is not smaller than the source can be left unwritten.",
          },
        ],
        notes: [
          "Lossless WebP targets reversible pixels; it cannot guarantee a smaller result for every image.",
          "Skip larger outputs helps avoid writing candidates that are the same size as or larger than the source file.",
          "Compression and file access happen on your Ubuntu device. Image content is not uploaded.",
        ],
        questions: [
          {
            question: "Why did some WebP images not produce a smaller output?",
            answer:
              "Lossless re-encoding cannot guarantee a smaller file. If Skip larger outputs is enabled, candidates equal to or larger than the source can be skipped.",
          },
          {
            question: "Is quality 100 the same as true lossless WebP?",
            answer:
              "No. Quality and lossless mode are separate encoding choices. Enable lossless mode when you need reversible pixel output.",
          },
          {
            question: "Are WebP images uploaded while compressing on Ubuntu?",
            answer:
              "No. ImgConvert processes the files and output directory you actively select on your device.",
          },
        ],
        primaryCta: {
          label: "Get the Linux app from GitHub Releases",
          href: releaseUrl,
        },
      },
      "linux-jpeg-to-avif": {
        eyebrow: "LINUX · JPEG → AVIF",
        platform: "Linux",
        input: "JPEG / JPG",
        output: "AVIF",
        processing: "Local",
        title: "How to convert JPEG to AVIF locally on Linux",
        lede: "Need to convert JPEG/JPG to AVIF on Linux? ImgConvert lets you import the images or folders you intentionally choose, then write AVIF to a local directory—without an online conversion service.",
        requirements: [
          "Choose an ImgConvert Linux installer for your system architecture from GitHub Releases and install it.",
          "Have the JPEG/JPG images, or a folder containing them, ready to import.",
          "Choose a writable output directory and keep the original JPEG files as a fallback.",
        ],
        steps: [
          {
            title: "Import JPEG or JPG images",
            body: "Add files or a folder to the task queue. One task can include multiple images you intentionally selected.",
          },
          {
            title: "Set AVIF as the target format",
            body: "Choose AVIF in output settings. When an individual image has a different delivery need, its output format can be overridden.",
          },
          {
            title: "Adjust quality for the intended use",
            body: "JPEG is already a lossy source. A higher quality value can reduce further loss, but it cannot restore detail lost in an earlier JPEG encoding step.",
          },
          {
            title: "Confirm the output directory and process",
            body: "Choose the directory and start conversion. Progress and results stay in the same desktop workspace. Enable Skip larger outputs when you want to avoid larger candidates.",
          },
        ],
        notes: [
          "JPEG-to-AVIF can suit some modern delivery targets, but keep JPEG available where broader compatibility is required.",
          "Lossless AVIF from a JPEG preserves the currently decoded pixels; it cannot make the photo uncompressed again.",
          "Files stay on your Linux device. ImgConvert handles only the input and output locations you explicitly select.",
        ],
        questions: [
          {
            question: "Can the Linux app batch-convert JPG to AVIF?",
            answer:
              "Yes. Add multiple JPEG/JPG files or a folder containing them to the task queue, then choose AVIF as the output format.",
          },
          {
            question: "Can lossless AVIF recover the original JPEG quality?",
            answer:
              "No. JPEG is already lossy. Lossless AVIF can preserve the current decoded pixels, not information removed by an earlier encoding step.",
          },
          {
            question: "Are JPEG images uploaded from Linux during conversion?",
            answer: "No. ImgConvert completes conversion and output locally.",
          },
        ],
        primaryCta: {
          label: "Get the Linux app from GitHub Releases",
          href: releaseUrl,
        },
      },
    },
  },
};
