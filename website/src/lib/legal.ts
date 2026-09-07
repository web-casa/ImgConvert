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
    webApp: string;
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
      webApp: "网页版",
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
        "ImgConvert 提供桌面版、Web 版和 Chromium 浏览器扩展。我们默认按“本地优先、最小收集”的原则处理数据。",
      effectiveDate: "生效日期：2026-09-05",
      sourceNote: "以下内容与项目公开隐私政策保持一致。",
      sections: [
        {
          title: "适用范围",
          paragraphs: [
            "本政策适用于当前 ImgConvert 的官方桌面版、位于 imgconvert.web.casa/convert/ 的 Web 版，以及 Chrome Web Store / Microsoft Edge Add-ons 的浏览器扩展。若不同分发渠道的数据处理方式不同，本政策会明确标注对应渠道。",
            "本政策不替代 Apple、Microsoft、Google、GitHub、Cloudflare、图片来源网站或操作系统及浏览器提供方各自的隐私政策。",
          ],
        },
        {
          title: "核心承诺",
          items: [
            "图片转换、压缩、缩略图生成和处理均在你的设备上完成；Web 版与浏览器扩展在浏览器内处理。",
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
          title: "Web 版浏览器处理",
          paragraphs: [
            "Web 版从同源网站加载界面、Worker 和 WASM 编解码资源。你主动选择或粘贴的输入文件只在当前浏览器会话的内存中处理，不会发送给 ImgConvert 或第三方转换接口。转换结果只会在你主动下载、保存目录或导出 ZIP 时写入你选择的位置；Web 版不会把输入文件、文件名、缩略图或转换结果持久化到浏览器存储。",
            "Web 版会把语言、主题和转换参数保存在浏览器 localStorage 中。启用离线能力后，Service Worker 会在 Cache Storage 中保存公开的应用界面、Worker、WASM、图标和 manifest；这些缓存不包含用户文件或转换结果。页面内的“清除本地数据”操作只删除 ImgConvert Web 自己的设置与缓存，不触碰其他同源应用的数据，也不会删除你已经下载的文件。",
          ],
        },
        {
          title: "Chrome 与 Edge 浏览器扩展",
          paragraphs: [
            "浏览器扩展的本地文件、缩略图、预览和转换结果只在当前可见扩展工作台（侧栏或全屏标签页）的内存中处理；清空队列或关闭该工作台后即移除，不会写入扩展存储，也不会发送给 ImgConvert。侧栏与全屏工作台是独立会话，“全屏打开”不会复制当前队列。语言、主题和转换默认值以一个有界记录保存在浏览器本机存储中；扩展不使用同步存储、分析、广告、崩溃报告、账号或远程配置服务。",
            "当你在普通 HTTPS 页面上通过“使用 ImgConvert 转换”右键命令明确选择一张 HTTPS 图片时，浏览器会向扩展提供这一个图片 URL、来源和窗口标识。扩展只把 URL 与来源作为最长两分钟的一次性交接保存在浏览器会话存储中，不读取页面 DOM、标题、Cookie、浏览历史或其他标签页。为在中断或浏览器重启后继续回收权限，扩展会在受限的本机扩展存储中保存一个不含图片 URL 的临时权限租约，其中只有随机标识、窗口标识和准确主机权限模式，清理完成后即删除。可见工作台先显示准确来源，并在你再次点击同意后只请求该 HTTPS 主机和端口；请求不携带 Cookie、Authorization 或来源页信息，不跟随跳转，响应上限为 32 MB，并在导入完成、侧栏关闭、流程中断或后台恢复时移除本次新增的站点访问权；导入前已经存在的访问权不会被移除。拒绝权限不会发出图片请求。",
            "所选 HTTPS 图片的来源服务器必然会收到对其自身 URL 的普通网络请求，并可能按该网站自己的政策记录服务器日志；ImgConvert 的运营方不会收到该请求、URL 或图片内容。Chrome Web Store 数据披露会保守标记 Web history（仅这一次所选 URL/来源）和 Website content（本地文件与所选图片内容），即使处理仅发生在浏览器本机。",
            "ImgConvert 对从浏览器扩展 API 获得的信息的使用遵守 Chrome Web Store 用户数据政策，包括 Limited Use 要求。扩展只把这些信息用于用户明确请求的本地图片转换，不出售、不用于广告或信用评估、不允许人工读取，也不向 ImgConvert 或数据经纪商传输。",
          ],
        },
        {
          title: "本机设置、缓存与临时文件",
          paragraphs: [
            "应用会在本机保存转换偏好设置。若你主动选择自定义输出目录，其路径会保存在本机设置中，以便下次继续使用。在允许用户选择 HEIC helper 的版本中，所选 helper 的路径也可能保存在本机。",
            "桌面版转换过程中还可能在本机临时目录或应用数据目录中创建临时文件、缩略图缓存和结果缓存记录。结果缓存记录只包含用于校验或复用转换结果的哈希值和文件大小，不包含图片字节或文件路径；它可能在当前任务结束后继续保留，直至被清除。",
            "临时文件仅用于完成当前转换任务，用户可以随时删除。设置、缓存和临时文件都不会同步到任何服务器；你可以在桌面应用中关闭结果复用。如需删除已保存的设置和缓存记录，请删除相应的本机应用数据或缓存目录。",
          ],
        },
        {
          title: "Apple 平台访问与 HEIC 解码",
          paragraphs: [
            "当你明确选择位于受保护媒体资料库内的文件夹导入图片时，Mac App Store 版本可能请求 macOS 的“媒体资料库”访问权限。该权限只用于扫描所选文件夹的内容，找出要加入本地转换队列的图片；例如，可在本机转换所选文件夹中的专辑封面图片。应用不会查询 Apple Music 目录，也不会读取播放或收听活动。你可以在 macOS 隐私设置中拒绝或撤销该权限；ImgConvert 的其他功能仍可使用。该版本不会访问照片图库，也不会请求通讯录、相机、麦克风或位置数据访问权限。",
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
            "桌面版默认不会自动保留原图元数据；只有在你明确开启“保留元数据”选项时，应用才会把受支持的 ICC、EXIF、XMP 等元数据写入输出文件。Web v1 与浏览器扩展固定移除源 EXIF、XMP、IPTC 与 ICC，不提供保留元数据选项。",
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
            "Chrome Web Store 与 Microsoft Edge Add-ons 版本的扩展更新由对应浏览器商店提供。扩展自身不连接 ImgConvert 更新服务。",
            "除上述可选、由用户主动触发的直发更新连接外，ImgConvert 不会为了桌面应用运行调用第三方网络服务，也不包含分析、广告、崩溃报告或远程配置服务。",
            "访问 Web 版需要从 imgconvert.web.casa 加载静态应用资源；检查 Web 版更新也会请求同一来源。图片转换本身不使用网络接口。网站由 Cloudflare Pages 托管，因此常规 HTTP 请求会经过 Cloudflare 基础设施并受其隐私政策约束，但 /convert/ 不启用 Cloudflare Web Analytics 或其他客户端行为统计脚本。",
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
      webApp: "Web app",
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
        "ImgConvert offers desktop releases, a Web app, and Chromium browser extensions. We follow local-first operation and minimal collection.",
      effectiveDate: "Effective date: September 5, 2026",
      sourceNote: "This page stays aligned with the public project privacy policy.",
      sections: [
        {
          title: "Scope",
          paragraphs: [
            "This policy covers the current official ImgConvert desktop releases, the Web app at imgconvert.web.casa/convert/, and the extensions distributed through Chrome Web Store or Microsoft Edge Add-ons. Where a data practice differs by distribution channel, this policy identifies that channel specifically.",
            "It does not replace the privacy policies of Apple, Microsoft, Google, GitHub, Cloudflare, a selected image host, or your operating-system or browser provider.",
          ],
        },
        {
          title: "Core commitments",
          items: [
            "Image conversion, compression, thumbnail generation, and processing run on your device; the Web app and browser extensions perform this work in the browser.",
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
          title: "Web app browser processing",
          paragraphs: [
            "The Web app loads its interface, workers, and WASM codecs from the same-origin site. Input files that you actively select or paste are processed only in the memory of the current browser session. They are not sent to ImgConvert or a third-party conversion endpoint. Results are written only when you actively download them, choose an output directory, or export a ZIP. The Web app does not persist input files, file names, thumbnails, or conversion results in browser storage.",
            "The Web app saves language, theme, and conversion settings in browser localStorage. When offline support is enabled, its service worker stores only public application-shell, worker, WASM, icon, and manifest assets in Cache Storage. Those caches do not contain user files or results. The in-app Clear Local Data action removes only ImgConvert Web preferences and caches; it does not touch unrelated same-origin data or files that you have downloaded.",
          ],
        },
        {
          title: "Chrome and Edge browser extensions",
          paragraphs: [
            "Local files, thumbnails, previews, and conversion results are processed only in the memory of the current visible extension workspace, either the side panel or a full-screen tab. They are removed when you clear the queue or close that workspace, are not written to extension storage, and are not sent to ImgConvert. Side-panel and full-screen workspaces are independent, so opening Full screen does not copy the current queue. Language, theme, and conversion defaults are stored as one bounded record in local browser storage. The extension does not use synchronized storage, analytics, advertising, crash reporting, accounts, or remote configuration.",
            "When you explicitly choose “Convert with ImgConvert” for an HTTPS image on an ordinary HTTPS page, the browser provides that one image URL, its source, and a window identifier to the extension. The URL and source are kept in browser session storage only as a one-time handoff that expires after at most two minutes. The extension does not read the page DOM, title, cookies, general browsing history, or other tabs. To finish permission cleanup after an interruption or browser restart, restricted local extension storage holds a temporary lease containing no image URL—only a random identifier, window identifier, and exact-host permission pattern—and deletes it after cleanup. The visible workbench shows the exact source and, only after you confirm again, requests that HTTPS host and port. The request contains no Cookie, Authorization information, or referrer; redirects are rejected, the response is limited to 32 MB, and newly granted site access is removed after completion, panel closure, interruption, or background recovery without removing access that predates the import. Denying access sends no image request.",
            "The selected HTTPS image host necessarily receives a normal request for its own URL and may keep server logs under that website's policy. The ImgConvert operator does not receive the request, URL, or image content. Chrome Web Store disclosures conservatively mark Web history (only that selected URL/source) and Website content (local files and the selected image), even though processing remains on the user's device.",
            "ImgConvert's use of information received from browser extension APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. The extension uses this information only for the local image conversion the user requested. It does not sell it, use it for advertising or credit decisions, permit human reading, or transmit it to ImgConvert or a data broker.",
          ],
        },
        {
          title: "Local settings, caches, and temporary files",
          paragraphs: [
            "ImgConvert stores conversion preferences locally. If you actively choose a custom output directory, its path is stored in local settings for your next use. On editions that allow a user-selected HEIC helper, that selected helper path may also be stored locally.",
            "During desktop conversion, ImgConvert may also create temporary files, thumbnail caches, and result-cache records in the local temporary directory or app-data directory. Result-cache records contain only hashes and file sizes used to verify or reuse conversion results; they do not contain image bytes or file paths and may remain after a task completes until you clear them.",
            "Temporary files are used only to complete the current conversion task, and you may delete them at any time. Settings, caches, and temporary files are never synchronized to a server; you can disable result reuse in the app. To remove saved settings and cache records, delete the relevant local app-data or cache directory.",
          ],
        },
        {
          title: "Apple platform access and HEIC decoding",
          paragraphs: [
            "The Mac App Store edition may request macOS Media Library access only when you explicitly select a folder in that protected location for image import. It uses that access only to scan the selected folder for images to add to the local conversion queue. For example, it can locally convert album-art images in the selected folder. It does not query the Apple Music catalog or read playback or listening activity. You can deny or revoke this permission in macOS privacy settings; the rest of ImgConvert remains available. The edition does not access your Photos library or request access to contacts, camera, microphone, or location data.",
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
            "The desktop app does not preserve source metadata by default. Only when you explicitly enable Preserve metadata does it write supported ICC, EXIF, XMP, or IPTC metadata to the output file. Web v1 and the browser extensions always remove source EXIF, XMP, IPTC, and ICC data and do not offer a metadata-preservation setting.",
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
            "Extension updates for the Chrome Web Store and Microsoft Edge Add-ons editions are delivered by their respective browser stores. The extension does not contact an ImgConvert update service.",
            "Apart from that optional, user-initiated direct-update connection, ImgConvert does not call third-party network services for desktop app operation. It does not include analytics, advertising, crash reporting, or remote-configuration services.",
            "Visiting the Web app loads static application resources from imgconvert.web.casa; checking for a Web app update also requests that same origin. Image conversion itself uses no network endpoint. The site is hosted on Cloudflare Pages, so ordinary HTTP requests pass through Cloudflare infrastructure and are subject to Cloudflare's privacy practices, but /convert/ does not enable Cloudflare Web Analytics or another client-side behavioral analytics script.",
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
