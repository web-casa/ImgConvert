// SPDX-License-Identifier: Apache-2.0
import type { ConversionErrorCode, JobState } from "@imgconvert/conversion-contract";
import type { ConversionProgressPhase } from "@imgconvert/web-image-engine";
import type { QueueFailureCode } from "@imgconvert/web-conversion-runtime";

import type { PendingImportBlockCode } from "../web-import/descriptor";
import type { RemoteImageFetchErrorCode } from "../web-import/remote-fetch";

type WebImportUiErrorCode =
  | RemoteImageFetchErrorCode
  | "permission-check-failed"
  | "permission-cleanup-failed"
  | "permission-request-failed"
  | "queue-rejected";

export interface WorkbenchCopy {
  readonly actions: Readonly<{
    cancel: string;
    cancelConversion: string;
    clear: string;
    close: string;
    confirmClear: string;
    convert: string;
    convertAgain: string;
    download: string;
    downloadZip: string;
    preview: string;
    remove: string;
    reset: string;
    retry: string;
    select: string;
  }>;
  readonly archive: Readonly<{
    blocked: string;
    cancelled: string;
    complete: string;
    error: string;
    preparing: string;
    title: string;
  }>;
  readonly conversionErrors: Readonly<Record<ConversionErrorCode, string>>;
  readonly dialog: Readonly<{
    clearBody: string;
    clearTitle: string;
    resetBody: string;
    resetError: string;
    resetTitle: string;
  }>;
  readonly drop: Readonly<{
    body: string;
    formats: string;
    hint: string;
    title: string;
  }>;
  readonly errors: Readonly<Record<QueueFailureCode, string>>;
  readonly footer: Readonly<{
    desktopDownload: string;
    docs: string;
    github: string;
    navigation: string;
    newTab: string;
    privacy: string;
    website: string;
  }>;
  readonly header: Readonly<{
    badge: string;
    fullscreen: string;
    fullscreenHint: string;
    reset: string;
    theme: string;
    toggleLocale: string;
  }>;
  readonly intro: Readonly<{
    eyebrow: string;
    lead: string;
    local: string;
    title: string;
  }>;
  readonly ledger: Readonly<{
    engine: string;
    persisted: string;
    session: string;
    storageError: string;
    uploads: string;
  }>;
  readonly preview: Readonly<{
    converted: string;
    duration: string;
    original: string;
    page: string;
    title: string;
  }>;
  readonly progress: Readonly<Record<ConversionProgressPhase, string>>;
  readonly queue: Readonly<{
    empty: string;
    emptyBody: string;
    imported: string;
    mismatch: string;
    page: string;
    pagesReady: string;
    title: string;
  }>;
  readonly settings: Readonly<{
    background: string;
    custom: string;
    dimensions: string;
    dimensionsError: string;
    height: string;
    hint: string;
    lossless: string;
    metadata: string;
    original: string;
    output: string;
    pages: string;
    pdf: string;
    pdfError: string;
    quality: string;
    resize: string;
    title: string;
    width: string;
  }>;
  readonly states: Readonly<Record<JobState, string>>;
  readonly warning: Readonly<{
    gif: string;
  }>;
  readonly webImport: Readonly<{
    alreadyAllowed: string;
    authorize: string;
    badge: string;
    blocked: Readonly<Record<PendingImportBlockCode, string>>;
    checking: string;
    chooseLocal: string;
    claimError: string;
    denied: string;
    dismiss: string;
    errors: Readonly<Record<WebImportUiErrorCode, string>>;
    fetching: string;
    permission: string;
    queued: string;
    ready: string;
    requesting: string;
    retry: string;
    retryCleanup: string;
    retryPermission: string;
    source: string;
    title: string;
  }>;
}

const en: WorkbenchCopy = {
  actions: {
    cancel: "Cancel",
    cancelConversion: "Stop conversion",
    clear: "Clear",
    close: "Close",
    confirmClear: "Clear queue",
    convert: "Convert ready files",
    convertAgain: "Convert again",
    download: "Download",
    downloadZip: "Download all as ZIP",
    preview: "Preview",
    remove: "Remove",
    reset: "Reset",
    retry: "Retry",
    select: "Choose files",
  },
  archive: {
    blocked: "The ZIP would exceed the local archive limit. Download results individually.",
    cancelled: "ZIP creation stopped. Your converted files remain available.",
    complete: "ZIP verified and downloaded.",
    error: "The local ZIP could not be created. Individual downloads are still available.",
    preparing: "Preparing verified ZIP",
    title: "Batch export",
  },
  conversionErrors: {
    "animated-input": "Animated input is not supported by this conversion path.",
    cancelled: "Conversion was cancelled.",
    "decode-failed": "The image could not be decoded.",
    "encode-failed": "The output could not be encoded.",
    "encrypted-pdf": "Encrypted PDFs are not supported.",
    "format-mismatch": "The detected format does not match the request.",
    "input-empty": "This file is empty.",
    "input-too-large": "This file exceeds the local byte limit.",
    "invalid-settings": "Review the conversion settings and try again.",
    "output-budget-exceeded":
      "Stored results exceed the local limit. Select fewer PDF pages, or download and remove completed items before retrying.",
    "output-validation-failed": "The generated file failed output validation.",
    "pixel-budget-exceeded": "Image dimensions exceed the local pixel budget.",
    "unsafe-pdf": "This PDF is outside the safe local rendering policy.",
    "unsafe-svg": "This SVG contains unsupported or unsafe content.",
    "unsupported-color-profile": "This color profile is not supported safely.",
    "unsupported-input": "This input format is not supported.",
    "unsupported-output": "This output is unavailable for the detected input.",
    "worker-failed": "The local conversion worker stopped unexpectedly.",
  },
  dialog: {
    clearBody:
      "This removes every source and result from this workspace. Downloaded files are not affected.",
    clearTitle: "Clear the in-memory queue?",
    resetBody: "Only language, theme, and conversion defaults are removed from extension storage.",
    resetError: "The browser did not allow the preference record to be cleared.",
    resetTitle: "Reset local preferences?",
  },
  drop: {
    body: "Drop images, SVG, or PDF here. Files stay in this workspace.",
    formats: "JPEG · PNG · WebP · AVIF · BMP · GIF · SVG · PDF",
    hint: "You can also paste copied image files",
    title: "Import local files",
  },
  errors: {
    "animated-input": "Animated input is outside this local path.",
    "input-empty": "This file is empty.",
    "input-too-large": "This file exceeds the local byte limit.",
    "invalid-container": "The image container is damaged or incomplete.",
    "pixel-budget-exceeded": "Image dimensions exceed the local pixel budget.",
    "probe-limit-exceeded": "The file header exceeds the safe probe limit.",
    "queue-byte-limit": "The queue has reached its total source-byte limit.",
    "queue-file-limit": "The queue has reached its file-count limit.",
    "read-failed": "The browser could not read this local file.",
    "unsafe-pdf": "This PDF is outside the safe local rendering policy.",
    "unsafe-svg": "This SVG contains unsupported or unsafe content.",
    "unsupported-input": "The file signature is not a supported input.",
  },
  footer: {
    desktopDownload: "Desktop downloads",
    docs: "Docs",
    github: "GitHub",
    navigation: "ImgConvert links",
    newTab: "opens in a new tab",
    privacy: "Privacy",
    website: "Website",
  },
  header: {
    badge: "Chromium extension",
    fullscreen: "Full screen",
    fullscreenHint: "Open a separate full-screen workspace; the current queue stays in this panel",
    reset: "Reset local preferences",
    theme: "Switch color theme",
    toggleLocale: "切换到中文",
  },
  intro: {
    eyebrow: "LOCAL ROUTE / READY",
    lead: "Eight input formats, four outputs, one private route. Nothing leaves this workspace while you convert.",
    local: "No upload · No history access · No remote code",
    title: "Image conversion,\nback at your browser.",
  },
  ledger: {
    engine: "Worker engine",
    persisted: "Local preference storage ready",
    session: "Files live only in this workspace",
    storageError: "Preferences are session-only right now",
    uploads: "File uploads",
  },
  preview: {
    converted: "Converted",
    duration: "Duration",
    original: "Original",
    page: "Rendered page",
    title: "Verified preview",
  },
  progress: {
    decoding: "Decoding locally",
    encoding: "Encoding locally",
    loading: "Loading local codec",
    rendering: "Rendering locally",
    resizing: "Resizing locally",
    validating: "Validating output",
  },
  queue: {
    empty: "No files yet",
    emptyBody:
      "Imported files appear here immediately, so you always know what is in this workspace.",
    imported: "imported",
    mismatch: "Extension suggests {expected}; detected bytes are {actual}.",
    page: "Page {page}",
    pagesReady: "{count} pages ready",
    title: "Live queue",
  },
  settings: {
    background: "JPEG background",
    custom: "Custom dimensions",
    dimensions: "Resize",
    dimensionsError: "Dimensions must fit the 24 MP runtime budget.",
    height: "Height",
    hint: "Metadata is stripped. Files are processed one at a time to bound memory.",
    lossless: "Lossless output",
    metadata: "Strip all metadata",
    original: "Keep original size",
    output: "Output format",
    pages: "Pages, for example 1,3-5",
    pdf: "PDF rendering",
    pdfError: "Use valid pages and an integer DPI from 72 to 600.",
    quality: "Quality",
    resize: "Resize mode",
    title: "Output settings",
    width: "Width",
  },
  states: {
    cancelled: "Cancelled",
    converting: "Converting",
    done: "Ready",
    failed: "Needs attention",
    probing: "Checking",
    queued: "Queued",
    ready: "Checked",
  },
  warning: { gif: "Animated GIF input uses the first frame only." },
  webImport: {
    alreadyAllowed: "This site is already allowed. ImgConvert will read only the selected URL.",
    authorize: "Allow and import",
    badge: "WEB IMAGE / ONE-TIME",
    blocked: {
      "embedded-credentials":
        "URLs containing embedded credentials are not read. Save the image and import the file instead.",
      "invalid-url":
        "The browser did not provide a valid image URL. Save the image and import the file instead.",
      "private-host":
        "Local, private, single-label, and direct IP hosts are outside the web-image safety policy.",
      "unsupported-page": "Web-image import is available only from ordinary HTTP or HTTPS pages.",
      "unsupported-scheme":
        "Data, blob, file, browser, and other non-web image URLs are not stored or fetched.",
      "url-too-long": "This image URL exceeds the bounded handoff limit and was not stored.",
    },
    checking: "Checking whether this origin is already allowed…",
    chooseLocal: "Choose a local file",
    claimError:
      "The one-time browser handoff could not be read. You can retry or use a local file.",
    denied:
      "Site access was not granted. The image was not requested; you can save it and import the file.",
    dismiss: "Dismiss",
    errors: {
      "empty-response": "The selected URL returned an empty response.",
      "http-error": "The selected URL returned an unsuccessful HTTP response.",
      "invalid-content-length": "The server returned an invalid Content-Length value.",
      "network-error": "The selected image could not be read without page credentials.",
      "permission-check-failed":
        "The browser did not allow ImgConvert to check this site's access state.",
      "permission-cleanup-failed":
        "The browser kept the new site permission. Revoke it before retrying the import.",
      "permission-request-failed": "The browser could not request access to this site.",
      "queue-rejected": "The local queue limit was reached, so the fetched image was discarded.",
      "redirect-blocked": "The image URL redirected. ImgConvert does not follow a second address.",
      "response-too-large": "The response exceeded the 32 MB web-image limit and was stopped.",
      "stream-unavailable": "The browser did not provide a bounded response stream.",
      timeout: "The image request exceeded 20 seconds and was stopped.",
      "unexpected-origin": "The final response origin differed from the approved site.",
      "unsupported-content-type": "The server returned a non-image content type.",
    },
    fetching: "Reading the selected image without cookies or referrer · {bytes}",
    permission:
      "Chrome or Edge will request access only to this exact HTTPS host and port. ImgConvert omits credentials and referrer, blocks redirects, caps the response at 32 MB, and removes a newly granted permission afterward.",
    queued: "The image is in the local queue and is now being checked by its actual bytes.",
    ready: "Ready to ask the browser for one-site access. No request has been sent yet.",
    requesting: "Waiting for the browser's site-access decision…",
    retry: "Retry handoff",
    retryCleanup: "Retry permission removal",
    retryPermission: "Retry access check",
    source: "Selected origin",
    title: "Import the image you selected?",
  },
};

const zh: WorkbenchCopy = {
  actions: {
    cancel: "取消",
    cancelConversion: "停止转换",
    clear: "清空",
    close: "关闭",
    confirmClear: "清空队列",
    convert: "转换已就绪文件",
    convertAgain: "再次转换",
    download: "下载",
    downloadZip: "全部下载为 ZIP",
    preview: "预览",
    remove: "移除",
    reset: "重置",
    retry: "重试",
    select: "选择文件",
  },
  archive: {
    blocked: "ZIP 会超过本地归档上限，请逐个下载结果。",
    cancelled: "已停止创建 ZIP，转换结果仍然可用。",
    complete: "ZIP 已验证并下载。",
    error: "无法在本地创建 ZIP，仍可逐个下载结果。",
    preparing: "正在准备并验证 ZIP",
    title: "批量导出",
  },
  conversionErrors: {
    "animated-input": "这条转换路径不支持动画输入。",
    cancelled: "转换已取消。",
    "decode-failed": "无法解码这张图片。",
    "encode-failed": "无法编码输出文件。",
    "encrypted-pdf": "暂不支持加密 PDF。",
    "format-mismatch": "检测格式与转换请求不一致。",
    "input-empty": "文件内容为空。",
    "input-too-large": "文件超过本地字节上限。",
    "invalid-settings": "请检查转换设置后重试。",
    "output-budget-exceeded": "结果占用空间已达上限。请减少 PDF 页数，或下载并移除已完成项后重试。",
    "output-validation-failed": "生成文件未通过输出校验。",
    "pixel-budget-exceeded": "图片尺寸超过本地像素预算。",
    "unsafe-pdf": "PDF 不符合安全的本地渲染规则。",
    "unsafe-svg": "SVG 含有不支持或不安全的内容。",
    "unsupported-color-profile": "无法安全处理该颜色配置。",
    "unsupported-input": "不支持这种输入格式。",
    "unsupported-output": "检测到的输入不支持这个输出。",
    "worker-failed": "本地转换 Worker 意外停止。",
  },
  dialog: {
    clearBody: "这会从当前工作台移除所有源文件和结果，已经下载的文件不受影响。",
    clearTitle: "清空内存中的队列？",
    resetBody: "只会清除扩展存储中的语言、主题和转换默认值。",
    resetError: "浏览器未允许清除偏好记录。",
    resetTitle: "重置本地偏好？",
  },
  drop: {
    body: "拖入图片、SVG 或 PDF。文件只留在这个工作台。",
    formats: "JPEG · PNG · WebP · AVIF · BMP · GIF · SVG · PDF",
    hint: "也可以直接粘贴复制的图片文件",
    title: "导入本地文件",
  },
  errors: {
    "animated-input": "动画输入不适用于这条本地路径。",
    "input-empty": "文件内容为空。",
    "input-too-large": "文件超过本地字节上限。",
    "invalid-container": "图片容器已损坏或不完整。",
    "pixel-budget-exceeded": "图片尺寸超过本地像素预算。",
    "probe-limit-exceeded": "文件头超过安全探测上限。",
    "queue-byte-limit": "队列已达到源文件总大小上限。",
    "queue-file-limit": "队列已达到文件数量上限。",
    "read-failed": "浏览器无法读取这个本地文件。",
    "unsafe-pdf": "PDF 不符合安全的本地渲染规则。",
    "unsafe-svg": "SVG 含有不支持或不安全的内容。",
    "unsupported-input": "文件签名不是受支持的输入。",
  },
  footer: {
    desktopDownload: "下载桌面版",
    docs: "使用文档",
    github: "GitHub",
    navigation: "ImgConvert 相关链接",
    newTab: "在新标签页打开",
    privacy: "隐私政策",
    website: "官网",
  },
  header: {
    badge: "Chromium 扩展",
    fullscreen: "全屏打开",
    fullscreenHint: "打开独立的全屏工作台；当前队列仍留在这个侧栏",
    reset: "重置本地偏好",
    theme: "切换颜色主题",
    toggleLocale: "Switch to English",
  },
  intro: {
    eyebrow: "本地路径 / 已就绪",
    lead: "八种输入、四种输出、一条私密路径。转换期间没有内容离开当前工作台。",
    local: "不上传 · 不读取浏览历史 · 不加载远程代码",
    title: "图片转换，\n回到你的浏览器。",
  },
  ledger: {
    engine: "Worker 引擎",
    persisted: "本地偏好存储已就绪",
    session: "文件只存在于当前工作台",
    storageError: "偏好目前仅在本次会话有效",
    uploads: "文件上传",
  },
  preview: {
    converted: "转换结果",
    duration: "耗时",
    original: "原图",
    page: "渲染页面",
    title: "已验证预览",
  },
  progress: {
    decoding: "正在本地解码",
    encoding: "正在本地编码",
    loading: "正在加载本地编解码器",
    rendering: "正在本地渲染",
    resizing: "正在本地调整尺寸",
    validating: "正在验证输出",
  },
  queue: {
    empty: "还没有文件",
    emptyBody: "导入后文件会立即出现在这里，当前工作台里有什么始终清楚可见。",
    imported: "已导入",
    mismatch: "扩展名表示 {expected}，实际字节检测为 {actual}。",
    page: "第 {page} 页",
    pagesReady: "{count} 页已就绪",
    title: "实时队列",
  },
  settings: {
    background: "JPEG 背景色",
    custom: "自定义尺寸",
    dimensions: "调整尺寸",
    dimensionsError: "尺寸必须符合 2400 万像素运行预算。",
    height: "高度",
    hint: "默认移除元数据，并逐个处理文件以控制内存。",
    lossless: "无损输出",
    metadata: "移除全部元数据",
    original: "保持原始尺寸",
    output: "输出格式",
    pages: "页码，例如 1,3-5",
    pdf: "PDF 渲染",
    pdfError: "请输入有效页码，以及 72 到 600 的整数 DPI。",
    quality: "质量",
    resize: "尺寸模式",
    title: "输出设置",
    width: "宽度",
  },
  states: {
    cancelled: "已取消",
    converting: "转换中",
    done: "已就绪",
    failed: "需要处理",
    probing: "检查中",
    queued: "排队中",
    ready: "已检查",
  },
  warning: { gif: "动画 GIF 输入只转换第一帧。" },
  webImport: {
    alreadyAllowed: "浏览器已经允许这个站点；ImgConvert 仍只读取这一次选中的 URL。",
    authorize: "允许并导入",
    badge: "网页图片 / 一次性",
    blocked: {
      "embedded-credentials": "不会读取 URL 内嵌账号信息的地址。请先保存图片，再导入本地文件。",
      "invalid-url": "浏览器没有提供有效的图片地址。请先保存图片，再导入本地文件。",
      "private-host": "本地、私有、单标签及直接 IP 地址不符合网页图片安全规则。",
      "unsupported-page": "网页图片导入只适用于普通 HTTP 或 HTTPS 页面。",
      "unsupported-scheme": "data、blob、file、浏览器内部及其他非网页地址不会被存储或读取。",
      "url-too-long": "图片地址超过一次性交接长度上限，扩展没有保存它。",
    },
    checking: "正在确认浏览器是否已经允许这个来源…",
    chooseLocal: "选择本地文件",
    claimError: "无法读取浏览器的一次性交接信息。可以重试，或改用本地文件。",
    denied: "没有获得站点读取权限，扩展没有请求图片；可以先保存再导入。",
    dismiss: "忽略",
    errors: {
      "empty-response": "所选地址返回了空内容。",
      "http-error": "所选地址返回了失败的 HTTP 状态。",
      "invalid-content-length": "服务器返回了无效的 Content-Length。",
      "network-error": "无法在不携带页面身份信息的情况下读取这张图片。",
      "permission-check-failed": "浏览器不允许检查这个站点的授权状态。",
      "permission-cleanup-failed": "浏览器仍保留刚才授予的站点权限，请撤销后再重试。",
      "permission-request-failed": "浏览器无法请求这个站点的读取权限。",
      "queue-rejected": "本地队列已达到上限，读取到的图片已丢弃。",
      "redirect-blocked": "图片地址发生跳转；ImgConvert 不会继续访问第二个地址。",
      "response-too-large": "响应超过 32 MB 网页图片上限，读取已停止。",
      "stream-unavailable": "浏览器没有提供可执行大小限制的响应流。",
      timeout: "图片请求超过 20 秒，已经停止。",
      "unexpected-origin": "最终响应来源与已批准的站点不一致。",
      "unsupported-content-type": "服务器返回的不是受支持的图片内容类型。",
    },
    fetching: "正在读取所选图片，不携带 Cookie 或来源页信息 · {bytes}",
    permission:
      "Chrome 或 Edge 只会请求这个 HTTPS 主机和端口的访问权。ImgConvert 不携带身份信息和来源页、不跟随跳转、限制响应为 32 MB，并在读取后移除本次新增权限。",
    queued: "图片已经进入本地队列，正在按实际字节检查格式。",
    ready: "可以向浏览器请求单站点访问权；目前尚未发送图片请求。",
    requesting: "正在等待浏览器的站点授权结果…",
    retry: "重试交接",
    retryCleanup: "重试移除权限",
    retryPermission: "重试权限检查",
    source: "所选来源",
    title: "导入刚才选中的图片？",
  },
};

export const workbenchTranslations = Object.freeze({ en, zh });
