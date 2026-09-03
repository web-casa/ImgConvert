import type { ConversionErrorCode } from "@imgconvert/conversion-contract";
import type { ConversionProgressPhase } from "@imgconvert/web-image-engine";

import type { QueueFailureCode } from "./queue";

export type Locale = "en" | "zh";

interface Copy {
  actions: {
    cancelProbe: string;
    cancelConversion: string;
    clear: string;
    close: string;
    closePreview: string;
    confirmClear: string;
    download: string;
    preview: string;
    remove: string;
    retry: string;
    select: string;
  };
  batch: {
    archiveComplete: string;
    archiveError: string;
    archiving: string;
    body: string;
    cancel: string;
    cancelled: string;
    directoryComplete: string;
    directoryError: string;
    downloadZip: string;
    eyebrow: string;
    estimatedZip: string;
    failureCount: string;
    failureReport: string;
    folderUnavailable: string;
    outputCount: string;
    recommended: string;
    saveFolder: string;
    summary: string;
    title: string;
    tooLarge: string;
    useDesktop: string;
    writing: string;
  };
  conversionErrors: Record<ConversionErrorCode, string>;
  dialog: { body: string; title: string };
  drop: {
    body: string;
    formats: string;
    limit: string;
    pasteHint: string;
    title: string;
  };
  errors: Record<QueueFailureCode, string>;
  footer: {
    back: string;
    blog: string;
    docs: string;
    guides: string;
    legal: string;
    linksLabel: string;
    privacy: string;
    macStore: string;
    repository: string;
    store: string;
    tagline: string;
    webApp: string;
  };
  header: {
    close: string;
    download: string;
    faq: string;
    formats: string;
    github: string;
    guides: string;
    home: string;
    languageLabel: string;
    menu: string;
    primaryLabel: string;
    product: string;
    themeDark: string;
    themeLight: string;
    webApp: string;
  };
  intro: { body: string; eyebrow: string; title: string };
  queue: {
    converted: string;
    emptyBody: string;
    emptyTitle: string;
    imported: string;
    pageFailed: string;
    pageReady: string;
    pageLabel: string;
    pagesFailed: string;
    pagesReady: string;
    pdfTotal: string;
    rejected: string;
    title: string;
  };
  rail: {
    converted: string;
    imported: string;
    localOnly: string;
    outbound: string;
    ready: string;
    title: string;
    verified: string;
  };
  settings: {
    background: string;
    convert: string;
    convertAgain: string;
    convertHint: string;
    dimensionError: string;
    customSize: string;
    height: string;
    lossless: string;
    metadata: string;
    metadataValue: string;
    originalSize: string;
    output: string;
    pdfDpi: string;
    pdfError: string;
    pdfHint: string;
    pdfPages: string;
    pdfTitle: string;
    quality: string;
    resize: string;
    title: string;
    width: string;
  };
  preview: {
    converted: string;
    duration: string;
    larger: string;
    original: string;
    renderedPage: string;
    saved: string;
    title: string;
  };
  pwa: {
    body: string;
    checkUpdate: string;
    checking: string;
    clearData: string;
    cleared: string;
    error: string;
    install: string;
    offline: string;
    online: string;
    preparing: string;
    ready: string;
    title: string;
    unsupported: string;
    update: string;
    updateReady: string;
  };
  pwaDialog: {
    body: string;
    cancel: string;
    confirm: string;
    error: string;
    title: string;
    working: string;
  };
  progress: Record<ConversionProgressPhase, string>;
  pdfProgress: string;
  states: Record<
    "cancelled" | "converting" | "done" | "failed" | "probing" | "queued" | "ready",
    string
  >;
  warning: { gifFirstFrame: string; mismatch: string };
}

export const translations: Readonly<Record<Locale, Copy>> = Object.freeze({
  en: {
    actions: {
      cancelConversion: "Cancel Conversion",
      cancelProbe: "Cancel Check",
      clear: "Clear Queue",
      close: "Keep Files",
      closePreview: "Close Preview",
      confirmClear: "Clear Files",
      download: "Download Result",
      preview: "Compare Images",
      remove: "Remove File",
      retry: "Check Again",
      select: "Choose Images",
    },
    batch: {
      archiveComplete: "ZIP download started. The converted results are marked as downloaded.",
      archiveError: "The local ZIP could not be created. Retry or save the files to a folder.",
      archiving: "Preparing a local ZIP…",
      body: "Export every verified result together. Folder saving writes one file at a time; ZIP is the compatible fallback.",
      cancel: "Cancel Export",
      cancelled: "Batch export cancelled. Your converted results remain available.",
      directoryComplete: "Saved {count} result files to the selected folder.",
      directoryError:
        "Folder export stopped. Files already shown as completed remain in the folder; retry to save the rest with conflict-safe names.",
      downloadZip: "Download ZIP",
      eyebrow: "BATCH / LOCAL OUTPUT",
      estimatedZip: "Estimated ZIP",
      failureCount: "Failed · {count}",
      failureReport: "JSON report included",
      folderUnavailable:
        "This browser does not support folder saving. Download a bounded local ZIP instead.",
      outputCount: "Results · {count}",
      recommended: "Recommended",
      saveFolder: "Save to Folder",
      summary: "Batch export summary",
      title: "Export the Batch",
      tooLarge:
        "These results exceed the 256 MiB ZIP safety limit. Save to a folder, export a smaller batch, or use the desktop app.",
      useDesktop: "Get the Desktop App",
      writing: "Writing files to your folder…",
    },
    conversionErrors: {
      "animated-input":
        "Animated input is not supported. Export a still frame or use the desktop app.",
      cancelled: "Conversion was cancelled. Start again when you are ready.",
      "decode-failed":
        "The local engine could not decode this image. Re-export it or use the desktop app.",
      "encode-failed":
        "The local engine could not create this output. Try another format or the desktop app.",
      "encrypted-pdf": "Encrypted PDF files are not supported in the Web converter.",
      "format-mismatch": "The decoded format did not match the verified input.",
      "input-empty": "This file is empty. Choose a file that contains image data.",
      "input-too-large": "This file exceeds the Web limit. Open it in the desktop app instead.",
      "invalid-settings": "These output settings are not valid. Check the size and format options.",
      "output-validation-failed":
        "The output did not pass its format check. Retry or choose another format.",
      "pixel-budget-exceeded":
        "The requested dimensions exceed the browser budget. Choose a smaller size.",
      "unsafe-pdf":
        "This PDF contains document JavaScript or unsupported active content. Export a flattened PDF or use the desktop app.",
      "unsafe-svg":
        "This SVG uses unsupported or unsafe content. Convert text to paths and remove scripts, animation, styles, links, or embedded images, then retry.",
      "unsupported-color-profile":
        "This color profile cannot be converted reliably in the browser. Use the desktop app.",
      "unsupported-input": "This input format is not available in the raster converter.",
      "unsupported-output": "This output format is not available for the selected input.",
      "worker-failed":
        "The local conversion worker stopped. Retry the file; the next job can continue.",
    },
    dialog: {
      body: "This removes every file from this browser session. Your original files stay unchanged.",
      title: "Clear the Import Queue?",
    },
    drop: {
      body: "Drop images here or choose them from this device.",
      formats: "JPEG · PNG · static WebP · AVIF · BMP · static GIF · safe SVG · PDF",
      limit: "Raster 32 MiB · SVG 16 MiB · PDF 256 MiB · 24 MP per page",
      pasteHint: "You can also paste an image from the clipboard.",
      title: "Bring images to the workbench",
    },
    errors: {
      "animated-input":
        "Animated images are not supported yet. Use the desktop app or export a still frame.",
      "input-empty": "This file is empty. Choose a file that contains image data.",
      "input-too-large":
        "This file exceeds the Web limit for its format. Open it in the desktop app instead.",
      "invalid-container":
        "The image container is damaged or incomplete. Export the image again and retry.",
      "pixel-budget-exceeded":
        "The image exceeds the 24 MP browser budget. Use the desktop app for this file.",
      "probe-limit-exceeded":
        "The image header is unusually large. Re-export it or use the desktop app.",
      "queue-byte-limit":
        "The selected files exceed the 2 GiB session limit. Add them in smaller groups.",
      "queue-file-limit":
        "The queue already contains 100 files. Clear or remove files before adding more.",
      "read-failed": "The browser could not read this file. Check its permissions and retry.",
      "unsafe-svg":
        "This SVG uses unsupported or unsafe content. Convert text to paths and remove scripts, animation, styles, links, or embedded images, then retry.",
      "unsafe-pdf":
        "This PDF contains unsupported active content. Export a flattened PDF or use the desktop app.",
      "unsupported-input":
        "This is not a supported Web image. Choose JPEG, PNG, static WebP, AVIF, BMP, static GIF, SVG, or PDF.",
    },
    footer: {
      back: "Back to top",
      blog: "Blog",
      docs: "Documentation",
      guides: "Guides",
      legal: "Open source & legal",
      linksLabel: "Footer navigation",
      privacy: "Privacy",
      macStore: "Mac App Store",
      repository: "GitHub",
      store: "Microsoft Store",
      tagline: "Local image conversion for desktop and the browser.",
      webApp: "Open Web app",
    },
    header: {
      close: "Close navigation",
      download: "Download",
      faq: "FAQ",
      formats: "Formats",
      github: "GitHub",
      guides: "Guides",
      home: "ImgConvert home",
      languageLabel: "Language selection",
      menu: "Open navigation",
      primaryLabel: "Primary navigation",
      product: "Product",
      themeDark: "Use Dark Theme",
      themeLight: "Use Light Theme",
      webApp: "Web app",
    },
    intro: {
      body: "Convert raster images, validated vector SVG, and selected PDF pages in local workers, then export verified results together.",
      eyebrow: "Local image desk / Web",
      title: "Convert images where they already are.",
    },
    queue: {
      converted: "converted",
      emptyBody:
        "Add images or a PDF above. ImgConvert checks each source locally before conversion.",
      emptyTitle: "The Queue Is Ready",
      imported: "files in queue",
      pageFailed: "Page failed",
      pageReady: "page ready",
      pageLabel: "Page {page}",
      pagesFailed: "Pages failed",
      pagesReady: "pages ready",
      pdfTotal: "PDF · {count} pages total",
      rejected: "Some files were not added. Review the limit message below.",
      title: "Import Queue",
    },
    rail: {
      converted: "Converted",
      imported: "Imported",
      localOnly: "Browser Memory Only",
      outbound: "0 B Outbound",
      ready: "Ready",
      title: "Local Route",
      verified: "Verified",
    },
    settings: {
      background: "JPEG background",
      convert: "Start Conversion",
      convertAgain: "Convert Again",
      convertHint:
        "Ready files run one at a time in a local worker. Each result is checked before download.",
      dimensionError: "Choose whole-number dimensions within the 24 MP browser budget.",
      customSize: "Custom dimensions",
      height: "Height",
      lossless: "Lossless output",
      metadata: "Metadata",
      metadataValue: "Remove EXIF, XMP, IPTC & source ICC",
      originalSize: "Keep original dimensions",
      output: "Output format",
      pdfDpi: "Render DPI",
      pdfError: "Use pages such as 1-3,5 and choose a whole-number DPI from 72 to 600.",
      pdfHint: "Up to 100 selected pages. Each page must stay within the 24 MP browser budget.",
      pdfPages: "Pages",
      pdfTitle: "PDF pages",
      quality: "Quality",
      resize: "Image size",
      title: "Output Setup",
      width: "Width",
    },
    preview: {
      converted: "Converted",
      duration: "Local conversion time",
      larger: "Result is larger than the source",
      original: "Original",
      renderedPage: "Rendered PDF page",
      saved: "smaller",
      title: "Before & After",
    },
    pwa: {
      body: "Only the app shell and codecs are cached. Images, filenames, previews, and results are never written there.",
      checkUpdate: "Check for Updates",
      checking: "Checking for an update…",
      clearData: "Clear Local Data",
      cleared: "Local settings and offline cache cleared",
      error: "Offline tools need an online retry",
      install: "Install Web App",
      offline: "Offline",
      online: "Online",
      preparing: "Preparing offline tools…",
      ready: "Offline tools are ready",
      title: "Use ImgConvert Offline",
      unsupported: "Use the browser menu to install when available",
      update: "Update & Reload",
      updateReady: "A new version is ready",
    },
    pwaDialog: {
      body: "This removes saved output settings, language and theme choices, plus cached app code and codecs. Files and results in the open queue stay in memory until you close or clear them.",
      cancel: "Keep Local Data",
      confirm: "Clear Local Data",
      error: "The browser could not clear all offline data. Close other ImgConvert tabs and retry.",
      title: "Clear Local Settings & Offline Cache?",
      working: "Clearing…",
    },
    progress: {
      decoding: "Decoding pixels…",
      encoding: "Encoding output…",
      loading: "Loading local codec…",
      rendering: "Rendering source content…",
      resizing: "Preparing dimensions…",
      validating: "Checking output…",
    },
    pdfProgress: "Page {page} of {total}",
    states: {
      cancelled: "Cancelled",
      converting: "Converting locally",
      done: "Ready to download",
      failed: "Needs attention",
      probing: "Checking header…",
      queued: "Waiting to check",
      ready: "Ready to configure",
    },
    warning: {
      gifFirstFrame:
        "GIF input is decoded as one still frame. Animated GIFs are rejected by the Web app.",
      mismatch:
        "The extension says {expected}, but the file data is {actual}. ImgConvert uses the file data.",
    },
  },
  zh: {
    actions: {
      cancelConversion: "取消转换",
      cancelProbe: "取消检测",
      clear: "清空队列",
      close: "保留文件",
      closePreview: "关闭预览",
      confirmClear: "清空文件",
      download: "下载结果",
      preview: "对比图片",
      remove: "移除文件",
      retry: "重新检测",
      select: "选择图片",
    },
    batch: {
      archiveComplete: "ZIP 下载已开始，转换结果已标记为已下载。",
      archiveError: "无法在本地生成 ZIP，请重试或将文件保存到文件夹。",
      archiving: "正在本地生成 ZIP…",
      body: "一次导出全部已校验结果。保存到文件夹会逐个写入文件，ZIP 则作为跨浏览器兼容方案。",
      cancel: "取消导出",
      cancelled: "批量导出已取消，转换结果仍然保留。",
      directoryComplete: "已将 {count} 个结果文件保存到所选文件夹。",
      directoryError:
        "文件夹导出已停止。界面显示已完成的文件仍保留在文件夹中；重试时会使用防冲突文件名保存剩余内容。",
      downloadZip: "下载 ZIP",
      eyebrow: "批量 / 本地输出",
      estimatedZip: "预计 ZIP",
      failureCount: "失败 · {count}",
      failureReport: "已附 JSON 报告",
      folderUnavailable: "当前浏览器不支持保存到文件夹，请改为下载受限的本地 ZIP。",
      outputCount: "结果 · {count} 个",
      recommended: "推荐",
      saveFolder: "保存到文件夹",
      summary: "批量导出摘要",
      title: "批量导出结果",
      tooLarge:
        "这些结果超过 256 MiB 的 ZIP 安全上限。请保存到文件夹、缩小导出批次，或使用桌面应用。",
      useDesktop: "获取桌面应用",
      writing: "正在将文件写入所选文件夹…",
    },
    conversionErrors: {
      "animated-input": "暂不支持动画输入，请先导出静态帧或使用桌面版。",
      cancelled: "转换已取消，可以在准备好后重新开始。",
      "decode-failed": "本地引擎无法解码这张图片，请重新导出或使用桌面版。",
      "encode-failed": "本地引擎无法生成这个格式，请改用其他格式或桌面版。",
      "encrypted-pdf": "Web 版不支持加密 PDF。",
      "format-mismatch": "解码格式与已检测的输入不一致。",
      "input-empty": "这个文件是空的，请选择包含图片数据的文件。",
      "input-too-large": "文件超过 Web 版上限，请改用桌面版。",
      "invalid-settings": "输出设置无效，请检查尺寸和格式选项。",
      "output-validation-failed": "输出没有通过格式校验，请重试或选择其他格式。",
      "pixel-budget-exceeded": "请求尺寸超过浏览器预算，请选择更小的尺寸。",
      "unsafe-pdf": "这个 PDF 包含文档脚本或不支持的活动内容，请导出扁平化 PDF 或使用桌面版。",
      "unsafe-svg":
        "这个 SVG 包含 Web 版不支持或不安全的内容。请将文字转为路径，移除脚本、动画、样式、链接或嵌入图片后重试。",
      "unsupported-color-profile": "浏览器无法可靠转换这个色彩配置，请使用桌面版。",
      "unsupported-input": "当前栅格转换器不支持这种输入格式。",
      "unsupported-output": "所选输入不支持这种输出格式。",
      "worker-failed": "本地转换 Worker 已停止。请重试该文件，其余任务仍可继续。",
    },
    dialog: {
      body: "这会移除当前浏览器会话中的全部文件，不会改动你的原始文件。",
      title: "确定清空导入队列？",
    },
    drop: {
      body: "将图片拖到这里，或从这台设备中选择。",
      formats: "JPEG · PNG · 静态 WebP · AVIF · BMP · 静态 GIF · 安全 SVG · PDF",
      limit: "栅格图 32 MiB · SVG 16 MiB · PDF 256 MiB · 每页 24 MP",
      pasteHint: "也可以直接从剪贴板粘贴图片。",
      title: "把图片放到工作台",
    },
    errors: {
      "animated-input": "暂不支持动画图片。请改用桌面版，或先导出静态帧。",
      "input-empty": "这个文件是空的。请选择包含图片数据的文件。",
      "input-too-large": "文件超过该格式的 Web 版上限，请改用桌面版打开。",
      "invalid-container": "图片容器损坏或不完整，请重新导出后再试。",
      "pixel-budget-exceeded": "图片超过浏览器 24 MP 预算，请使用桌面版处理。",
      "probe-limit-exceeded": "图片头部异常大，请重新导出或使用桌面版。",
      "queue-byte-limit": "所选文件超过当前会话 2 GiB 上限，请分批添加。",
      "queue-file-limit": "队列已经有 100 个文件，请先清空或移除部分文件。",
      "read-failed": "浏览器无法读取这个文件，请检查权限后重试。",
      "unsafe-svg":
        "这个 SVG 包含 Web 版不支持或不安全的内容。请将文字转为路径，移除脚本、动画、样式、链接或嵌入图片后重试。",
      "unsafe-pdf": "这个 PDF 包含不支持的活动内容，请导出扁平化 PDF 或使用桌面版。",
      "unsupported-input":
        "这不是 Web 版支持的图片，请选择 JPEG、PNG、静态 WebP、AVIF、BMP、静态 GIF、SVG 或 PDF。",
    },
    footer: {
      back: "回到顶部",
      blog: "Blog",
      docs: "产品文档",
      guides: "实用指南",
      legal: "开源与法律信息",
      linksLabel: "页脚导航",
      privacy: "隐私政策",
      macStore: "Mac App Store",
      repository: "GitHub",
      store: "Microsoft Store",
      tagline: "桌面与浏览器内本地处理的图片转换工具。",
      webApp: "打开网页版",
    },
    header: {
      close: "关闭导航",
      download: "下载应用",
      faq: "FAQ",
      formats: "格式",
      github: "GitHub",
      guides: "指南",
      home: "ImgConvert 首页",
      languageLabel: "语言选择",
      menu: "打开导航",
      primaryLabel: "主要导航",
      product: "产品",
      themeDark: "切换到深色模式",
      themeLight: "切换到浅色模式",
      webApp: "网页版",
    },
    intro: {
      body: "在本地 Worker 中转换栅格图片、安全 SVG 和选定 PDF 页面，校验后可将结果一起导出。",
      eyebrow: "本地图片工作台 / Web",
      title: "图片留在原地，转换现在开始。",
    },
    queue: {
      converted: "个已转换",
      emptyBody: "从上方添加图片或 PDF。转换前，ImgConvert 会在本地检查每个文件。",
      emptyTitle: "队列已经就绪",
      imported: "个文件已加入队列",
      pageFailed: "页面转换失败",
      pageReady: "页可下载",
      pageLabel: "第 {page} 页",
      pagesFailed: "页面转换失败",
      pagesReady: "页可下载",
      pdfTotal: "PDF · 共 {count} 页",
      rejected: "部分文件未加入队列，请查看下方的限制提示。",
      title: "导入队列",
    },
    rail: {
      converted: "已转换",
      imported: "已导入",
      localOnly: "仅在浏览器内存中",
      outbound: "出站 0 B",
      ready: "可配置",
      title: "本地处理路径",
      verified: "已检测",
    },
    settings: {
      background: "JPEG 背景色",
      convert: "开始转换",
      convertAgain: "再次转换",
      convertHint: "可转换文件会在本地 Worker 中逐个处理，每个结果都在下载前再次校验。",
      dimensionError: "请输入整数尺寸，并确保总像素不超过浏览器 24 MP 预算。",
      customSize: "自定义尺寸",
      height: "高度",
      lossless: "无损输出",
      metadata: "元数据",
      metadataValue: "移除 EXIF、XMP、IPTC 和源 ICC",
      originalSize: "保持原始尺寸",
      output: "输出格式",
      pdfDpi: "渲染 DPI",
      pdfError: "页码格式请使用 1-3,5，并输入 72 到 600 之间的整数 DPI。",
      pdfHint: "单次最多选择 100 页，每页不得超过浏览器 24 MP 预算。",
      pdfPages: "页码范围",
      pdfTitle: "PDF 页面",
      quality: "质量",
      resize: "图片尺寸",
      title: "输出设置",
      width: "宽度",
    },
    preview: {
      converted: "转换结果",
      duration: "本地转换耗时",
      larger: "结果比源文件更大",
      original: "原图",
      renderedPage: "渲染后的 PDF 页面",
      saved: "更小",
      title: "转换前后对比",
    },
    pwa: {
      body: "缓存只保存应用界面和编解码器，不会写入图片、文件名、预览或转换结果。",
      checkUpdate: "检查更新",
      checking: "正在检查更新…",
      clearData: "清除本地数据",
      cleared: "已清除本地设置和离线缓存",
      error: "离线工具需要联网重试",
      install: "安装 Web 应用",
      offline: "离线",
      online: "在线",
      preparing: "正在准备离线工具…",
      ready: "离线工具已就绪",
      title: "离线使用 ImgConvert",
      unsupported: "支持时可通过浏览器菜单安装",
      update: "更新并重新加载",
      updateReady: "新版本已准备好",
    },
    pwaDialog: {
      body: "这会移除已保存的输出设置、语言和主题选择，以及缓存的应用代码与编解码器。当前队列中的文件和结果仍留在内存中，直到关闭或清空。",
      cancel: "保留本地数据",
      confirm: "清除本地数据",
      error: "浏览器未能清除全部离线数据。请关闭其他 ImgConvert 标签页后重试。",
      title: "清除本地设置和离线缓存？",
      working: "正在清除…",
    },
    progress: {
      decoding: "正在解码像素…",
      encoding: "正在编码输出…",
      loading: "正在加载本地编解码器…",
      rendering: "正在渲染源内容…",
      resizing: "正在处理尺寸…",
      validating: "正在校验输出…",
    },
    pdfProgress: "正在处理第 {page} 页，共 {total} 页",
    states: {
      cancelled: "已取消",
      converting: "正在本地转换",
      done: "可以下载",
      failed: "需要处理",
      probing: "正在检测文件头…",
      queued: "等待检测",
      ready: "可以配置",
    },
    warning: {
      gifFirstFrame: "GIF 输入只会解码为单张静态画面；Web 版会拒绝动画 GIF。",
      mismatch: "扩展名表示 {expected}，文件数据实际为 {actual}。ImgConvert 将以文件数据为准。",
    },
  },
});
