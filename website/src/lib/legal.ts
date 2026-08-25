// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import type { Locale } from "./content";

type PolicySection = {
  title: string;
  intro?: string;
  paragraphs?: string[];
  items?: string[];
  outro?: string;
};

type LegalSection = {
  title: string;
  body: string;
  linkKey: "license" | "thirdParty" | "notice";
  linkLabel: string;
};

type LegalLocaleContent = {
  common: {
    home: string;
    privacy: string;
    legal: string;
    language: string;
    skip: string;
  };
  privacy: {
    metaTitle: string;
    metaDescription: string;
    eyebrow: string;
    title: string;
    intro: string;
    effectiveDate: string;
    sourceNote: string;
    sections: PolicySection[];
    contactTitle: string;
    contact: string;
    contactLink: string;
  };
  legal: {
    metaTitle: string;
    metaDescription: string;
    eyebrow: string;
    title: string;
    intro: string;
    note: string;
    sections: LegalSection[];
  };
};

export const legalContent: Record<Locale, LegalLocaleContent> = {
  zh: {
    common: {
      home: "首页",
      privacy: "隐私政策",
      legal: "开源与法律信息",
      language: "语言",
      skip: "跳至主要内容",
    },
    privacy: {
      metaTitle: "隐私政策 | ImgConvert",
      metaDescription:
        "ImgConvert 隐私政策：图片转换、压缩和缩略图生成在本机完成；不上传或收集图片、路径、剪贴板内容或转换结果。",
      eyebrow: "PRIVACY POLICY",
      title: "用清楚的话，\n说明隐私。",
      intro:
        "ImgConvert 是一款在本机运行的图片批量转换工具。我们默认按“本地优先、最小收集”的原则处理数据。",
      effectiveDate: "生效日期：2026-08-25",
      sourceNote: "以下内容与项目公开隐私政策保持一致。",
      sections: [
        {
          title: "适用范围",
          paragraphs: [
            "本政策适用于当前 ImgConvert 的官方桌面版。若不同分发渠道的数据处理方式不同，本政策会明确标注对应渠道。",
            "本政策不替代 Apple、Microsoft、GitHub 或操作系统提供方各自的隐私政策。",
          ],
        },
        {
          title: "核心承诺",
          items: [
            "图片转换、压缩、缩略图生成和处理均在本机完成。",
            "不上传，也不会向我们或第三方收集你的图片、文件路径、剪贴板内容或转换结果。",
            "不包含广告 SDK、行为统计 SDK、第三方埋点或账号系统。",
            "Mac App Store 和 Microsoft Store 版本均不启用应用内更新，软件更新由各自的应用商店提供。",
          ],
        },
        {
          title: "我们不会收集的数据",
          intro: "ImgConvert 不会上传、收集或向第三方传输以下信息：",
          items: [
            "你导入或转换的图片内容。",
            "图片文件名、完整路径或目录结构。",
            "剪贴板中的图片或文本。",
            "转换后的输出文件。",
            "EXIF、XMP、ICC、IPTC 等图片元数据。",
            "设备标识、硬件信息、系统日志或使用行为。",
          ],
        },
        {
          title: "文件与权限使用",
          intro: "ImgConvert 只在必要时访问你主动选择的文件或文件夹：",
          items: [
            "你通过系统文件选择器授权的输入文件。",
            "你选择的输出目录。",
            "你主动使用剪贴板导入功能时提供的剪贴板图片。",
          ],
          outro: "应用不会后台扫描相册、硬盘或网络位置。",
        },
        {
          title: "本机设置、缓存与临时文件",
          paragraphs: [
            "应用会在本机保存转换偏好设置。若你主动选择自定义输出目录，其路径会保存在本机设置中，以便下次继续使用。在允许用户选择 HEIC helper 的版本中，所选 helper 的路径也可能保存在本机。",
            "转换过程中，应用还可能在本机临时目录或应用数据目录中创建临时文件、缩略图缓存和结果缓存记录。结果缓存记录只包含用于校验或复用转换结果的哈希值和文件大小，不包含图片字节或文件路径；它可能在当前任务结束后继续保留，直至被清除。",
            "临时文件仅用于完成当前转换任务，用户可以随时删除。设置、缓存和临时文件都不会同步到任何服务器；你可以在应用中关闭结果复用。如需删除已保存的设置和缓存记录，请删除相应的本机应用数据或缓存目录。",
          ],
        },
        {
          title: "Apple 平台访问与 HEIC 解码",
          paragraphs: [
            "Mac App Store 版本不会访问 Apple Music、你的 Apple Music 资料库或照片图库，也不会请求通讯录、相机、麦克风或位置数据访问权限。",
            "当你在 Mac App Store 版本中主动选择 HEIC 文件时，ImgConvert 可能通过 macOS 内置的 ImageIO 框架在本机解码该文件。该版本不输出 HEIC，不捆绑外部 HEIC/HEVC 编解码器，也不发现第三方 codec helper。",
          ],
        },
        {
          title: "Windows HEIC 解码",
          paragraphs: [
            "Microsoft Store 版本默认不捆绑外部 HEIC/HEVC 编解码器，也不自动发现第三方 helper。",
            "如果系统已安装 Microsoft HEIF Image Extensions 或 HEVC Video Extensions，应用可能通过 Windows 系统接口读取 HEIC 文件；该过程仍由操作系统在本机完成。",
          ],
        },
        {
          title: "元数据处理",
          paragraphs: [
            "默认情况下，输出图片不会自动保留原图元数据。只有在你明确开启“保留元数据”选项时，应用才会把受支持的 ICC、EXIF、XMP 等元数据写入输出文件。",
          ],
        },
        {
          title: "儿童隐私",
          paragraphs: ["ImgConvert 不面向儿童提供定向内容，也不主动收集任何用户的个人信息。"],
        },
        {
          title: "更新与第三方服务",
          paragraphs: [
            "Mac App Store 和 Microsoft Store 版本不使用应用内更新通道。单独配置的直发版本仅会在你主动检查或安装更新时连接 GitHub Releases；该连接受 GitHub 隐私政策约束，且不会上传你的图片或转换数据。",
            "除上述可选、由用户主动触发的直发更新连接外，ImgConvert 不会为了应用运行调用第三方网络服务，也不包含分析、广告、崩溃报告或远程配置服务。",
          ],
        },
        {
          title: "政策更新",
          paragraphs: ["如果隐私处理方式发生变化，我们会更新本页面并同步修改生效日期。"],
        },
      ],
      contactTitle: "联系我们",
      contact: "如需支持或对隐私政策有任何问题，请使用项目 issue tracker。",
      contactLink: "前往 ImgConvert Issues",
    },
    legal: {
      metaTitle: "开源与法律信息 | ImgConvert",
      metaDescription: "ImgConvert 的 Apache-2.0 许可、NOTICE 与第三方许可证入口。",
      eyebrow: "OPEN SOURCE & LEGAL",
      title: "开源，\n也把归属说清楚。",
      intro:
        "ImgConvert 以 Apache License 2.0 发布。本页提供项目许可、NOTICE 与第三方归属信息的稳定入口。",
      note: "以下为工程资料整理，不替代法律意见。",
      sections: [
        {
          title: "项目许可",
          body: "本产品以 Apache License, Version 2.0 发布；分发时应保留适用的版权、许可与 NOTICE 声明。",
          linkKey: "license",
          linkLabel: "查看 LICENSE",
        },
        {
          title: "NOTICE 与第三方归属",
          body: "项目包含第三方开源软件，其许可证与通知列在 NOTICE、THIRD_PARTY_LICENSES.md 和项目文档中。",
          linkKey: "thirdParty",
          linkLabel: "查看第三方许可证",
        },
        {
          title: "NOTICE",
          body: "NOTICE 汇总了在分发时需要随项目保留的适用通知与归属信息。",
          linkKey: "notice",
          linkLabel: "查看 NOTICE",
        },
      ],
    },
  },
  en: {
    common: {
      home: "Home",
      privacy: "Privacy",
      legal: "Open source & legal",
      language: "Language",
      skip: "Skip to main content",
    },
    privacy: {
      metaTitle: "Privacy Policy | ImgConvert",
      metaDescription:
        "ImgConvert privacy policy: conversion, compression, and thumbnails run on your device; images, paths, clipboard content, and conversion results are not uploaded or collected.",
      eyebrow: "PRIVACY POLICY",
      title: "Privacy,\nin plain language.",
      intro:
        "ImgConvert is a local image batch-conversion tool. We process data according to the principles of local-first operation and minimal collection.",
      effectiveDate: "Effective date: August 25, 2026",
      sourceNote: "This page stays aligned with the public project privacy policy.",
      sections: [
        {
          title: "Scope",
          paragraphs: [
            "This policy covers the current official ImgConvert desktop releases. Where a data practice differs by distribution channel, this policy identifies that channel specifically.",
            "It does not replace the privacy policies of Apple, Microsoft, GitHub, or your operating-system provider.",
          ],
        },
        {
          title: "Core commitments",
          items: [
            "Image conversion, compression, thumbnail generation, and processing run on your device.",
            "We do not upload or collect your images, file paths, clipboard content, or conversion results for us or a third party.",
            "ImgConvert contains no advertising SDK, behavioral analytics SDK, third-party tracking, or account system.",
            "The Mac App Store and Microsoft Store editions do not enable an in-app updater. Their software updates are delivered by the respective store.",
          ],
        },
        {
          title: "Data we do not collect",
          intro:
            "ImgConvert does not upload, collect, or transmit the following information to a third party:",
          items: [
            "The content of images you import or convert.",
            "Image file names, complete paths, or directory structures.",
            "Images or text in the clipboard.",
            "Converted output files.",
            "Image metadata such as EXIF, XMP, ICC, or IPTC.",
            "Device identifiers, hardware information, system logs, or usage behavior.",
          ],
        },
        {
          title: "File access and permissions",
          intro:
            "ImgConvert accesses only files or folders that you actively select when they are needed:",
          items: [
            "Input files authorized through the system file picker.",
            "The output directory you choose.",
            "Clipboard images only when you actively choose the clipboard-import feature.",
          ],
          outro:
            "The app does not scan photo libraries, disks, or network locations in the background.",
        },
        {
          title: "Local settings, caches, and temporary files",
          paragraphs: [
            "ImgConvert stores conversion preferences locally. If you actively choose a custom output directory, its path is stored in local settings for your next use. On editions that allow a user-selected HEIC helper, that selected helper path may also be stored locally.",
            "During conversion, ImgConvert may also create temporary files, thumbnail caches, and result-cache records in the local temporary directory or app-data directory. Result-cache records contain only hashes and file sizes used to verify or reuse conversion results; they do not contain image bytes or file paths and may remain after a task completes until you clear them.",
            "Temporary files are used only to complete the current conversion task, and you may delete them at any time. Settings, caches, and temporary files are never synchronized to a server; you can disable result reuse in the app. To remove saved settings and cache records, delete the relevant local app-data or cache directory.",
          ],
        },
        {
          title: "Apple platform access and HEIC decoding",
          paragraphs: [
            "The Mac App Store edition does not access Apple Music, your Apple Music library, or your Photos library. It does not request access to contacts, camera, microphone, or location data.",
            "When you actively select a HEIC file in the Mac App Store edition, ImgConvert may use the built-in macOS ImageIO framework to decode that selected file on your device. It does not create HEIC output, bundle an external HEIC/HEVC codec, or discover third-party codec helpers in that edition.",
          ],
        },
        {
          title: "Windows HEIC decoding",
          paragraphs: [
            "The Microsoft Store edition does not bundle external HEIC/HEVC codecs and does not automatically discover third-party helpers.",
            "If Microsoft HEIF Image Extensions or HEVC Video Extensions are installed on your system, ImgConvert may use Windows system interfaces to read HEIC files. This processing remains local to your device. ImgConvert does not create HEIC output files.",
          ],
        },
        {
          title: "Metadata handling",
          paragraphs: [
            "Output images do not preserve source metadata by default. Only when you explicitly enable the Preserve metadata setting does ImgConvert write supported ICC, EXIF, XMP, or IPTC metadata to the output file.",
          ],
        },
        {
          title: "Children's privacy",
          paragraphs: [
            "ImgConvert does not provide targeted content for children and does not actively collect personal information from any user.",
          ],
        },
        {
          title: "Updates and third-party services",
          paragraphs: [
            "The Mac App Store and Microsoft Store editions do not use an in-app update channel. A separately configured direct-distribution build can contact GitHub Releases only after you choose to check for or install an update; that connection is governed by GitHub's privacy practices and does not upload your images or conversion data.",
            "Apart from that optional, user-initiated direct-update connection, ImgConvert does not call third-party network services for app operation. It does not include analytics, advertising, crash reporting, or remote-configuration services.",
          ],
        },
        {
          title: "Policy updates",
          paragraphs: [
            "If our data practices change, we will update this policy and its effective date before releasing the affected version.",
          ],
        },
      ],
      contactTitle: "Contact",
      contact: "For support or questions about this policy, use the project issue tracker.",
      contactLink: "Open ImgConvert Issues",
    },
    legal: {
      metaTitle: "Open source & legal | ImgConvert",
      metaDescription:
        "Entry points for ImgConvert's Apache-2.0 license, NOTICE, and third-party licenses.",
      eyebrow: "OPEN SOURCE & LEGAL",
      title: "Open source,\nwith clear attribution.",
      intro:
        "ImgConvert is released under the Apache License 2.0. This page provides stable entry points for the project license, NOTICE, and third-party attribution material.",
      note: "This is an engineering resource summary and is not legal advice.",
      sections: [
        {
          title: "Project license",
          body: "This product is licensed under the Apache License, Version 2.0. Applicable copyright, license, and NOTICE statements should be retained when distributing it.",
          linkKey: "license",
          linkLabel: "Read the LICENSE",
        },
        {
          title: "NOTICE and third-party attribution",
          body: "The project includes third-party open-source software. Its licenses and notices are listed in NOTICE, THIRD_PARTY_LICENSES.md, and project documentation.",
          linkKey: "thirdParty",
          linkLabel: "Read third-party licenses",
        },
        {
          title: "NOTICE",
          body: "NOTICE collects applicable notices and attributions that should remain with the project when it is distributed.",
          linkKey: "notice",
          linkLabel: "View NOTICE",
        },
      ],
    },
  },
};
