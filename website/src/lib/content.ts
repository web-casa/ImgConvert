// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

export type Locale = "zh" | "en";

export const siteOrigin = "https://imgconvert.web.casa";
export const releaseUrl = "https://github.com/web-casa/ImgConvert/releases/latest";
export const storeUrl = "https://apps.microsoft.com/store/detail/9P1BWD965DBX?cid=DevShareMCLPCS";
export const snapUrl = "https://snapcraft.io/imgconvert";

export const links = {
  repository: "https://github.com/web-casa/ImgConvert",
  issues: "https://github.com/web-casa/ImgConvert/issues",
  license: "https://github.com/web-casa/ImgConvert/blob/main/LICENSE",
  notice: "https://github.com/web-casa/ImgConvert/blob/main/NOTICE",
  thirdParty: "https://github.com/web-casa/ImgConvert/blob/main/THIRD_PARTY_LICENSES.md",
  privacyZh: "/privacy/",
  privacyEn: "/en/privacy/",
  legalZh: "/legal/",
  legalEn: "/en/legal/",
  docsZh: "/docs/",
  docsEn: "/en/docs/",
  blogZh: "/blog/",
  blogEn: "/en/blog/",
} as const;

export const translations = {
  zh: {
    meta: {
      title: "ImgConvert — 本地图片转换、批量压缩与格式转换",
      description:
        "ImgConvert 是一款本地优先的跨平台图片转换工具，用于批量转换、压缩 JPEG、PNG、WebP、AVIF 等图片；原图不上传，处理在你的设备上完成。",
    },
    nav: {
      features: "工作流",
      guides: "指南",
      docs: "文档",
      blog: "Blog",
      local: "隐私",
      faq: "常见问题",
      download: "下载应用",
      menu: "打开导航",
      close: "关闭导航",
      skip: "跳至主要内容",
    },
    hero: {
      eyebrow: "一款本地图片转换工具",
      titleBefore: "图片转换，",
      titleEm: "留在本地。",
      body: "批量转换、压缩并整理 JPEG、PNG、WebP 与 AVIF 图片。无需账号，原图不上传，所有处理都发生在你的设备上。",
      allDownloads: "查看全部平台",
      note: "macOS · Windows · Linux",
      visualAlt: "ImgConvert 本地批量图片转换工作区界面",
      caption: "真实工作区：导入、格式选择、压缩设置与进度放在一起。",
      tags: ["批量转换", "原图不上传", "跨平台桌面应用"],
    },
    tour: {
      eyebrow: "真实产品界面",
      title: "格式选择，应该一眼看明白。",
      body: "导入区、批量设置和输出状态在同一个桌面工作区。需要例外时，可以针对单张图片选择输出格式，而不必重建整批任务。",
      points: [
        "文件、文件夹与剪贴板导入",
        "AVIF、WebP、JPEG 与 PNG 输出",
        "单张图片可跟随或覆盖全局格式",
      ],
      workspaceAlt: "ImgConvert 正在运行的本地图片转换工作区，显示导入区和 AVIF 输出设置",
      workspaceCaption: "真实运行界面；可用语言和格式会随应用版本与系统能力变化。",
      pickerAlt: "ImgConvert 真实的输出格式选择界面，显示 AVIF、WebP、JPEG 与 PNG 选项",
      pickerCaption: "真实格式选择界面。",
    },
    proof: {
      title: "需要处理的，是图片。\n不是你的隐私。",
      body: "ImgConvert 是桌面应用。格式转换、压缩、缩略图和队列管理都在本机完成，而不是把你的文件送往一个陌生的网页服务。",
      visualAlt: "放在纸张上的半透明照片联络表和外置硬盘",
      visualCaption: "文件在身边，处理在设备上。",
      points: [
        "默认不上传原始图片",
        "没有账号、广告或行为统计",
        "只访问你主动选择的文件、目录或剪贴板图片",
      ],
    },
    features: {
      eyebrow: "A CALMER BATCH WORKFLOW",
      title: "一批图片，\n一套清晰的工作流。",
      body: "从导入到输出，每一步都留在同一个可见、可控的桌面工作区。",
      cards: [
        {
          number: "01",
          title: "集中导入",
          body: "文件、目录和主动粘贴的剪贴板图片，进入同一个任务队列。",
          chips: ["文件", "目录", "剪贴板"],
        },
        {
          number: "02",
          title: "按图调整",
          body: "单张图片可以覆盖输出格式，不必为了一个例外重做整批任务。",
          chips: ["AVIF", "WebP", "JPEG"],
        },
        {
          number: "03",
          title: "看得见结果",
          body: "进度、取消和输出结果留在同一处，处理过程不再是黑箱。",
          chips: ["进度", "取消", "结果"],
        },
      ],
    },
    formats: {
      eyebrow: "FORMAT, WITH INTENT",
      title: "不是所有图片，\n都该用同一种出口。",
      body: "为常用图像格式给出明确选择；HEIC 是由平台能力支持的只读导入，而不是输出格式。",
      list: [
        { format: "AVIF", detail: "高效编码 · 支持真无损" },
        { format: "WEBP", detail: "现代 Web 交付" },
        { format: "JPEG", detail: "广泛兼容" },
        { format: "PNG", detail: "通用无损" },
        { format: "HEIC", detail: "平台能力支持的只读导入" },
      ],
    },
    privacy: {
      title: "隐私不该是一句口号。",
      body: "我们把数据处理方式写清楚：图片不上传；没有账号、广告 SDK、行为统计或第三方埋点；本机设置和缓存也不会同步到服务器。",
      items: [
        "图片、路径、剪贴板内容和转换结果不会被收集",
        "输出默认不保留原图元数据，可由你明确开启",
        "结果缓存只包含用于校验或复用的哈希值和文件大小",
      ],
      action: "阅读完整隐私政策",
    },
    downloads: {
      title: "在你的桌面上，\n开始处理。",
      body: "Windows 版从 Microsoft Store 获取，Linux 可通过 Snap Store 安装；其他可用安装包和校验信息发布在 GitHub Releases。",
      items: [
        { platform: "macOS", detail: "Apple silicon · DMG", href: releaseUrl },
        { platform: "Windows", detail: "Microsoft Store · x64", href: storeUrl },
        { platform: "Linux · Snap Store", detail: "amd64 / arm64 · 自动更新", href: snapUrl },
        {
          platform: "Linux · GitHub",
          detail: "amd64 / arm64 · AppImage / deb / rpm",
          href: releaseUrl,
        },
      ],
      platformDownload: {
        windows: { label: "从 Microsoft Store 获取 Windows 版", href: storeUrl },
        macos: { label: "获取 macOS 版", href: releaseUrl },
        linux: { label: "从 Snap Store 获取 Linux 版", href: snapUrl },
        other: { label: "选择你的平台", href: "#download" },
      },
      trust: [
        "开源发布采用 Apache-2.0 许可证",
        "Linux amd64 与 arm64 版本已在 Snap Store 的 stable 渠道发布",
        "其他可用安装包和校验信息发布在 GitHub Releases",
        "Windows 版通过 Microsoft Store 分发",
      ],
      releaseNotes: "查看发布说明与校验信息",
    },
    faq: {
      title: "常见问题",
      items: [
        {
          question: "图片会被上传到服务器吗？",
          answer:
            "不会。图片转换、压缩、缩略图生成和处理都在你的设备上完成；不会向我们或第三方上传、收集图片内容、路径、剪贴板内容或转换结果。",
        },
        {
          question: "需要注册账号吗？",
          answer:
            "不需要。ImgConvert 不包含账号系统，也不包含广告 SDK、行为统计 SDK 或第三方埋点。",
        },
        {
          question: "应用会访问哪些文件或权限？",
          answer:
            "只在必要时访问你主动选择的输入文件、输出目录，以及你主动使用剪贴板导入功能时提供的图片；不会在后台扫描相册、硬盘或网络位置。",
        },
        {
          question: "应用会在本机保存哪些数据？",
          answer:
            "转换偏好、临时文件、缩略图缓存和结果缓存记录可能保存在本机。结果缓存只包含用于校验或复用的哈希值和文件大小，不包含图片字节或文件路径；你可以关闭结果复用并清理本机应用数据或缓存。",
        },
        {
          question: "可以保留 EXIF 或其他元数据吗？",
          answer:
            "默认不会自动保留原图元数据。只有在你明确开启“保留元数据”时，应用才会把受支持的 ICC、EXIF、XMP 等元数据写入输出文件。",
        },
        {
          question: "支持 HEIC 输出吗？",
          answer:
            "不支持。HEIC 仅作为由平台能力支持的只读导入；在 Windows 上，具体可用性取决于系统扩展或可选 helper。",
        },
        {
          question: "在哪里获取最新版本？",
          answer:
            "Windows 版可从 Microsoft Store 获取，Linux 可通过 Snap Store 安装；其他可用安装包和校验信息在 GitHub Releases。",
        },
      ],
    },
    resources: {
      eyebrow: "KNOWLEDGE BASE",
      title: "做选择之前，\n把边界看清。",
      body: "文档记录当前真实支持的能力；文章把格式、压缩和本地处理这些选择讲得更明白。",
      docs: {
        label: "PRODUCT DOCUMENTATION",
        title: "支持什么，也说明不支持什么。",
        body: "格式、批量任务、缓存和元数据的实际边界。",
        action: "查看文档",
      },
      blog: {
        label: "IMGCONVERT JOURNAL",
        title: "给图片交付一个更清楚的判断。",
        body: "AVIF、WebP、PNG 与无损压缩的具体取舍。",
        action: "阅读文章",
      },
    },
    footer: {
      tagline: "本地优先的跨平台图片批量转换与压缩工具。",
      guides: "实用指南",
      docs: "产品文档",
      blog: "Blog",
      privacy: "隐私政策",
      legal: "开源与法律信息",
      store: "Microsoft Store",
      snap: "Snap Store",
      repository: "GitHub",
      back: "回到顶部",
    },
  },
  en: {
    meta: {
      title: "ImgConvert — Local image conversion & batch compression",
      description:
        "ImgConvert is a local-first, cross-platform image converter for batch conversion and compression of JPEG, PNG, WebP, and AVIF images. Your originals stay on your device.",
    },
    nav: {
      features: "Workflow",
      guides: "Guides",
      docs: "Docs",
      blog: "Blog",
      local: "Privacy",
      faq: "FAQ",
      download: "Download",
      menu: "Open navigation",
      close: "Close navigation",
      skip: "Skip to main content",
    },
    hero: {
      eyebrow: "A local image converter",
      titleBefore: "Image conversion,",
      titleEm: "close to home.",
      body: "Batch-convert, compress, and organize JPEG, PNG, WebP, and AVIF images. No account, no upload: the work happens on your device.",
      allDownloads: "See all platforms",
      note: "macOS · Windows · Linux",
      visualAlt: "The ImgConvert local batch image conversion workspace",
      caption:
        "The real workbench: import, format choices, compression settings, and progress together.",
      tags: ["Batch conversion", "No cloud upload", "Cross-platform desktop app"],
    },
    tour: {
      eyebrow: "THE REAL PRODUCT UI",
      title: "Format choices should be obvious.",
      body: "Import, batch settings, and output status live in one desktop workbench. When one image needs an exception, choose its output format without rebuilding the whole batch.",
      points: [
        "Files, folders, and intentional clipboard import",
        "AVIF, WebP, JPEG, and PNG output",
        "Per-image format can follow or override the shared setting",
      ],
      workspaceAlt:
        "The ImgConvert local image conversion workspace running with its import area and AVIF output settings visible",
      workspaceCaption:
        "A real running interface; available language and formats vary by app version and system capability.",
      pickerAlt:
        "The real ImgConvert output-format picker showing AVIF, WebP, JPEG, and PNG options",
      pickerCaption: "The real output-format picker.",
    },
    proof: {
      title: "The work is on images.\nNot on your privacy.",
      body: "ImgConvert is a desktop app. Format conversion, compression, thumbnails, and queue management happen on your device instead of sending your files to an unfamiliar web service.",
      visualAlt:
        "A translucent photo contact sheet and external drive on a paper-covered worktable",
      visualCaption: "Files stay close. The work stays on your device.",
      points: [
        "Original images stay on your device by default",
        "No accounts, ads, or behavioral analytics",
        "Only files, folders, or clipboard images you actively select are accessed",
      ],
    },
    features: {
      eyebrow: "A CALMER BATCH WORKFLOW",
      title: "One batch.\nA clearer workflow.",
      body: "From import to output, each step stays visible and controllable in one desktop workbench.",
      cards: [
        {
          number: "01",
          title: "Bring it together",
          body: "Files, folders, and clipboard images you intentionally paste can join one queue.",
          chips: ["Files", "Folders", "Clipboard"],
        },
        {
          number: "02",
          title: "Tune by image",
          body: "Override the output format for one image without rebuilding the whole batch around an exception.",
          chips: ["AVIF", "WebP", "JPEG"],
        },
        {
          number: "03",
          title: "See the result",
          body: "Progress, cancellation, and output stay together, so the process is never a black box.",
          chips: ["Progress", "Cancel", "Results"],
        },
      ],
    },
    formats: {
      eyebrow: "FORMAT, WITH INTENT",
      title: "Not every image\nneeds the same exit.",
      body: "Choose deliberate output formats for common image work. HEIC is a platform-capability read-only import, not an output format.",
      list: [
        { format: "AVIF", detail: "Efficient encoding · true lossless" },
        { format: "WEBP", detail: "Modern web delivery" },
        { format: "JPEG", detail: "Wide compatibility" },
        { format: "PNG", detail: "Everyday lossless" },
        { format: "HEIC", detail: "Platform-capability read-only import" },
      ],
    },
    privacy: {
      title: "Privacy should not be a slogan.",
      body: "We spell out how data is handled: no image upload; no accounts, ad SDKs, behavioral analytics, or third-party tracking; local settings and caches are never synchronized to a server.",
      items: [
        "Images, paths, clipboard content, and conversion results are not collected",
        "Source metadata is not preserved by default; you explicitly choose when to keep it",
        "Result-cache records contain only hashes and file sizes for verification or reuse",
      ],
      action: "Read the full privacy policy",
    },
    downloads: {
      title: "Get to work\non your own desktop.",
      body: "Get the Windows app from Microsoft Store or install Linux through Snap Store. Other available installers and checksums are published on GitHub Releases.",
      items: [
        { platform: "macOS", detail: "Apple silicon · DMG", href: releaseUrl },
        { platform: "Windows", detail: "Microsoft Store · x64", href: storeUrl },
        {
          platform: "Linux · Snap Store",
          detail: "amd64 / arm64 · automatic updates",
          href: snapUrl,
        },
        {
          platform: "Linux · GitHub",
          detail: "amd64 / arm64 · AppImage / deb / rpm",
          href: releaseUrl,
        },
      ],
      platformDownload: {
        windows: { label: "Get the Windows app from Microsoft Store", href: storeUrl },
        macos: { label: "Get the macOS app", href: releaseUrl },
        linux: { label: "Get the Linux app from Snap Store", href: snapUrl },
        other: { label: "Choose your platform", href: "#download" },
      },
      trust: [
        "Open-source releases are licensed under Apache-2.0",
        "Linux amd64 and arm64 builds are available in the Snap Store stable channel",
        "Other available installers and checksums are published in GitHub Releases",
        "The Windows app is distributed through Microsoft Store",
      ],
      releaseNotes: "View release notes and checksums",
    },
    faq: {
      title: "Common questions",
      items: [
        {
          question: "Are images uploaded to a server?",
          answer:
            "No. Image conversion, compression, thumbnail generation, and processing run on your device. We do not upload or collect image contents, paths, clipboard contents, or conversion results for us or a third party.",
        },
        {
          question: "Do I need an account?",
          answer:
            "No. ImgConvert contains no account system, advertising SDK, behavioral analytics SDK, or third-party tracking.",
        },
        {
          question: "Which files and permissions does the app access?",
          answer:
            "Only the input files, output directory, and clipboard images you actively choose when needed. It does not scan photo libraries, disks, or network locations in the background.",
        },
        {
          question: "What does the app store locally?",
          answer:
            "Conversion preferences, temporary files, thumbnail caches, and result-cache records may be stored locally. Result-cache records contain hashes and file sizes used to verify or reuse work, not image bytes or file paths. You can disable reuse and clear local app data or cache records.",
        },
        {
          question: "Can I keep EXIF or other metadata?",
          answer:
            "Source metadata is not preserved by default. Only when you explicitly enable Preserve metadata does ImgConvert write supported ICC, EXIF, XMP, or IPTC metadata to the output file.",
        },
        {
          question: "Can ImgConvert export HEIC?",
          answer:
            "No. HEIC is a platform-capability read-only import. On Windows, availability depends on installed system extensions or an optional helper.",
        },
        {
          question: "Where do I get the newest build?",
          answer:
            "Get the Windows app from Microsoft Store or install Linux through Snap Store. Other available installers and checksums are published on GitHub Releases.",
        },
      ],
    },
    resources: {
      eyebrow: "KNOWLEDGE BASE",
      title: "See the boundary\nbefore making the choice.",
      body: "Docs record what the product really supports. Articles make the choices around formats, compression, and local processing easier to reason about.",
      docs: {
        label: "PRODUCT DOCUMENTATION",
        title: "What it supports, and what it does not.",
        body: "The real boundaries for formats, batches, cache, and metadata.",
        action: "Browse docs",
      },
      blog: {
        label: "IMGCONVERT JOURNAL",
        title: "A clearer call\nfor image delivery.",
        body: "Concrete trade-offs among AVIF, WebP, PNG, and lossless compression.",
        action: "Read articles",
      },
    },
    footer: {
      tagline: "A local-first, cross-platform app for batch image conversion and compression.",
      guides: "Guides",
      docs: "Documentation",
      blog: "Blog",
      privacy: "Privacy",
      legal: "Open source & legal",
      store: "Microsoft Store",
      snap: "Snap Store",
      repository: "GitHub",
      back: "Back to top",
    },
  },
} as const;
