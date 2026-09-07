# ImgConvert Web 转换器开发方案

> 状态：`WEB-011` 已完成开发、本地综合复审、Cloudflare Pages Preview 验收与修正；移动端真机门禁待外部环境
>
> 日期：2026-09-03
>
> 目标版本：Web v1
>
> 目标路由：`/convert/`

> 实施更新（2026-09-03）：`WEB-001` 与 `WEB-001B` 已完成。stock
> `@imagemagick/magick-wasm@0.0.43` 因 bundle 含 LGPL 组件判定 no-go；独立
> JPEG/PNG/WebP/AVIF codec 组合已通过三浏览器、许可、完整性、取消和 24 MP 基准门禁。
> `WEB-002` 至 `WEB-009` 已完成首版：除无 DOM contract 和 image engine 外，已新增 base
> 为 `/convert/` 的 Svelte 应用，实现真实本地导入、串行有界 probe、资源护栏、四格式按需
> raster codec Worker、严格 SVG 校验与独立 resvg Worker、有界 PDF.js 页面渲染 Worker、
> 质量/无损/缩放/背景色、真实取消、输出二次校验、前后预览、单页/单文件下载、目录写入、
> 有界 ZIP fallback、部分失败摘要、双语、明暗主题、响应式布局，以及限定 `/convert/` scope
> 的可安装 PWA。App shell 会预缓存，Worker/WASM 按格式首次使用缓存；更新由用户明确应用，
> 本地设置和离线缓存可一键清除。`WEB-010` 已新增安全组装、发布产物门禁、Cloudflare
> preview 响应 smoke、官网及内容页 Web 入口，并同步隐私、法律和运维文档。`WEB-011` 补齐
> 24/32-bit BMP 与单帧 GIF 输入、动画 GIF 拒绝和不可忽略提示；Worker 会重新探测输入字节、
> 复核方向归一化后的解码尺寸，并限制结果消息为 64 MiB。当前 contract 16 项、engine 61 项、
> web-app 34 项单测、根 135 项测试及三浏览器 76 项 E2E 均通过；另有 2 项目录 API 用例因浏览器
> 不支持而按设计跳过。组装后的 19 个关键路由与 22 个 Web App 文件通过产物门禁，24 MP
> Chromium 8 次内存趋势复测通过，npm audit 与许可证/NOTICE 门禁通过。Cloudflare Pages
> Preview `web-011-preview-20260903.imgconvert-cis.pages.dev`（Deployment
> `5737f0b8-369f-41d8-87ba-ebc7c0e56d25`，来源 commit `6ea348e`）已通过真实响应 smoke、
> 安全头与 `noindex` 检查；既有单 worker Chromium/Firefox/WebKit 完整矩阵 73 项通过、2 项
> 目录 API 用例按能力跳过，当前 commit 的站点导航/页脚定向远程回归 6/6 通过。Pixel 7/Chromium 与 iPhone 13/WebKit 移动模拟的上传、自动展示
> 队列反馈、转换和下载 2/2 通过。Production 未被更新，正式发布仍需移动 Safari 与 Android
> Chrome 真机预算确认。
> 详见
> [WEB_CONVERTER_P0_REPORT.md](WEB_CONVERTER_P0_REPORT.md)。

## 1. 最终决策

ImgConvert Web 采用“借鉴 VERT 的本地转换技术路线，但独立实现”的方案：

- 不 fork、不复制 VERT 的源代码、界面、文案或素材；VERT 使用 AGPL-3.0，直接基于其代码开发会改变本项目的分发义务。
- 浏览器 raster 引擎采用已通过 `WEB-001B` 的独立 jSquash codec 组合，并通过 ImgConvert 自己的适配层调用；stock magick-wasm 不进入产品依赖。
- Web v1 只做图片工作流；PDF 和 SVG 作为图片输入分别走 PDF.js 与 resvg-wasm，不让 ImageMagick 的外部 delegate 处理 PDF。
- UI 延续 ImgConvert 桌面版的米黄色、绿色、卡片密度和真实工作流，但根据 Web 实际能力显示控件，不能伪装成与桌面版完全等价。
- Web 应用与营销站部署到同一个 Cloudflare Pages 项目，但独立构建、独立缓存，Service Worker 只控制 `/convert/`。
- 桌面版继续是完整功能版本；浏览器扩展在 Web v1 稳定后复用转换契约和引擎，不与 Web MVP 同时开工。

这不是“把 VERT 换个皮”，而是把其已验证的浏览器内 WASM 思路收敛成符合 ImgConvert 许可证、产品语义和资源边界的新实现。

## 2. 复审结论与已修正项

| 初始设想 | 复审发现 | 修正后的方案 |
| --- | --- | --- |
| 直接裁剪 VERT | VERT 为 AGPL-3.0，会给 Apache-2.0 项目带来不匹配的分发义务 | 只参考公开架构，代码与 UI 完全独立实现 |
| 直接把现有 Rust core 编译到 WASM | 现有 core 依赖 `mozjpeg`、`libavif-sys`、`lcms2`、`resvg` 等原生链路，不能低风险直接进浏览器 | 新建 Web 引擎适配层，不改写桌面 core |
| 先抽取 Rust 共享核心 | 会让 Web MVP 被桌面重构阻塞，并扩大已有桌面功能的回归面 | 首期只共享契约、语义和测试向量；稳定后再评估抽取纯逻辑模块 |
| 所有格式都交给 ImageMagick | PDF delegate、SVG 外部引用和复杂格式会扩大安全面与包体 | Raster、SVG、PDF 使用独立受限管线 |
| “保留元数据”可以直接承诺 | 浏览器构建的容器元数据行为尚未逐格式验证 | 默认 `stripAll`；仅对通过 round-trip 测试的格式开放保留选项 |
| 按 `hardwareConcurrency` 并发转换 | WASM 工作集大，多任务会快速放大峰值内存 | v1 固定单转换 worker，队列串行；基准通过后才提高并发 |
| 只限制输入文件大小 | 小型压缩文件也可能解码成超大像素，PDF/SVG 还有独立风险 | 同时限制字节、像素、页数、元素复杂度和估算工作集 |
| PWA 首次缓存全部引擎 | 会让访问者在尚未转换前下载十余 MB WASM | App shell 与编解码器分开，按首次转换按需加载 |
| PWA 的 HTML 也使用 cache-first | 容易长期启动旧 UI，并与新版 worker/WASM 产生协议错配 | 导航/HTML 使用 network-first，带 hash 的静态资产才使用 cache-first |
| Web 与营销站共用一次 Vite 输出 | 两个构建都可能清空 `website/dist`，导致静态页面丢失 | 分别构建，再由受校验的 assemble 脚本复制到 `/convert/` |
| 中英文使用 `/convert/`、`/en/convert/` 两个 PWA | 两个作用域会使缓存和更新复杂化，根作用域又可能控制营销站 | 单一 `/convert/` 应用，通过 `?lang=en` 设置初始语言并持久化 |
| Web 功能照搬桌面控件 | Web 首期没有系统 codec、完整 ICC 及全部工作流语义 | 使用 capability-driven UI，隐藏或禁用不可验证的能力并说明原因 |
| 把 64 MP 当作所有设备都能处理的目标 | Safari、移动端和低内存设备的可用预算明显更低 | 64 MP 只作为绝对天花板，运行时预算可以更低且必须提前拒绝 |
| 动画 WebP “拒绝或首帧”留到实现时决定 | 同一输入在不同浏览器出现不同结果会造成数据语义不确定 | Web v1 统一拒绝动画 WebP；静态 GIF 才允许首帧导入并强提示 |
| 未验证 ICC 仍输出并警告可能色偏 | 生成已知不可靠的颜色结果不符合转换工具的正确性要求 | 非 sRGB/未知 ICC 无法可靠转换时 fail closed，并推荐桌面版 |
| Web 版完成时同时发布扩展 | 会同时承担 PWA、MV3、多浏览器权限与商店审核风险 | 扩展单列后续阶段，先证明 Web 引擎稳定 |

## 3. 范围

### 3.1 Web v1 必须交付

- 拖放、文件选择和剪贴板粘贴导入。
- 文件队列、缩略图、输入探测、失败隔离、取消、重试和移除。
- 单文件或批量设置输出格式、质量、无损模式和尺寸规则。
- 转换前后预览、尺寸和实际文件大小展示。
- 单文件下载；批量时优先目录写入，无法使用目录 API 时提供受内存上限保护的归档下载。
- JPEG、PNG、静态 WebP、AVIF 的输入与输出；动画 WebP 在 v1 明确拒绝。
- BMP、静态 GIF 的输入；GIF 只读取第一帧并明确提示。
- SVG 输入，经安全校验和受限渲染后输出为栅格图片。
- PDF 输入，可选择页码范围与渲染 DPI，再输出为栅格图片。
- 简体中文和英文、浅色和深色模式、键盘操作、移动端布局。
- 可安装 PWA；已访问且引擎已缓存时支持离线转换。
- 页面明确显示“文件留在本地”，并由自动化网络测试验证该声明。
- 对超出 Web 能力或资源预算的任务，提供桌面版下载入口。

### 3.2 Web v1 明确不做

- 视频、音频、文档转码及 VERT 的其他非图片功能。
- HEIC/HEIF。只有在浏览器兼容性、专利/分发与测试矩阵均通过专项评审后才能加入。
- 动图保真转换、动画编辑或多帧输出。
- 云端上传、账号、同步、历史记录或服务器转换兜底。
- 外部 URL 导入、远程图片抓取、ZIP 输入。
- 桌面版的完整自动质量、目标体积搜索、代际损失保护和所有 ICC 工作流。
- 在浏览器存储中持久保存用户输入文件。
- 复刻 VERT 或其他产品的视觉资产、Logo、文案和组件代码。

## 4. v1 格式与功能矩阵

| 输入 | 输出 JPEG | 输出 PNG | 输出 WebP | 输出 AVIF | v1 备注 |
| --- | ---: | ---: | ---: | ---: | --- |
| JPEG | 是 | 是 | 是 | 是 | 校验 EXIF orientation；元数据能力按测试开放 |
| PNG | 是 | 是 | 是 | 是 | 保留 alpha；输出 JPEG 时必须选择背景色 |
| WebP | 是 | 是 | 是 | 是 | 仅静态 WebP；动画输入统一拒绝 |
| AVIF | 是 | 是 | 是 | 是 | alpha、方向和质量映射必须过跨浏览器测试 |
| BMP | 是 | 是 | 是 | 是 | 仅输入 |
| GIF | 是 | 是 | 是 | 是 | 仅首帧并显示不可忽略的提示 |
| SVG | 是 | 是 | 是 | 是 | 单独的安全验证与 resvg-wasm 渲染管线 |
| PDF | 是 | 是 | 是 | 是 | PDF.js 串行渲染页面；不使用 Ghostscript 或远程服务 |
| HEIC/HEIF | 否 | 否 | 否 | 否 | v1 不宣称支持 |

输出设置的语义必须按格式拆分：JPEG/WebP/AVIF 的同一 `quality` 数值只是统一 UI 范围，不得假定三种编码器的视觉质量相等；PNG 与无损模式不显示无意义的质量控件。

### 元数据策略

Web v1 使用能力驱动的元数据选项：

1. `stripAll`：默认值；输出不得携带 EXIF、XMP、IPTC 或源 ICC。若源图包含非 sRGB/未知 ICC，必须先完成经过验证的色彩转换；当前 Web 管线无法可靠转换时直接拒绝并推荐桌面版，不能输出已知可能色偏的结果。
2. `preserveAll`：只有某一“输入 × 输出”组合通过容器 round-trip、方向归一化和隐私测试后才显示。
3. `colorOnly` 与显式 `ConvertToSrgb`：不进入首个可发布版本，除非 P0/P2 已获得与桌面语义一致的验证证据。

产品文案不能把“本地处理”等同于“自动清除隐私元数据”；两者分别说明。

## 5. 用户体验与信息架构

### 5.1 页面结构

`/convert/` 是独立应用，不是营销首页上的大型演示组件：

1. 顶栏：ImgConvert 品牌、隐私状态、语言、主题、帮助和桌面版入口。
2. 导入区：拖放、粘贴、选择文件，列出真实支持格式和资源上限。
3. 队列区：缩略图、文件信息、任务状态、错误与逐项操作。
4. 设置区：输出格式、质量/无损、尺寸、背景色、PDF 页码/DPI 等能力相关设置。
5. 操作区：转换、取消、清空、下载；始终显示当前任务的预计资源风险。
6. 预览层：前后对比、尺寸、输出大小和警告；完整键盘焦点管理。

### 5.2 与桌面版保持一致的部分

- 复用现有品牌 Logo、米黄色/绿色 CSS token、圆角、边框、字号层级和状态色语义。
- 沿用“先导入队列，再设置，再转换，再下载”的真实工作流。
- 复用格式名称、错误分类、元数据策略名和中英文术语表。
- 响应式重新排布，不把桌面双栏机械压缩到手机屏幕。

### 5.3 Web 专属反馈

- 初次转换前显示“正在加载本地转换引擎”及真实下载进度。
- 明确区分“读取文件”“转换”“准备下载”“完成”。
- 浏览器能力不足时显示原因和桌面版替代入口，不展示无效按钮。
- 取消必须能真正终止计算，而不是只隐藏进度条。
- 关闭/刷新页面前，如存在未下载结果，提供离开提醒。
- 辅助技术可读出队列进度、错误和转换完成状态；交互目标在触屏上至少 44 × 44 CSS px。

## 6. 技术架构

```text
Svelte Web UI
    │
    ▼
Conversion Controller ── Capability Registry
    │
    ▼
Serial Job Scheduler
    ├── Raster Worker ── independent codec adapter
    ├── SVG Worker ───── validator + resvg-wasm adapter
    └── PDF Worker ───── PDF.js render ──► Raster Worker
    │
    ▼
Result Store (memory only) ── Download Adapter
                               ├── File System Access API
                               └── bounded archive/blob fallback
```

### 6.1 建议目录

```text
packages/
  conversion-contract/      # 无 DOM/Svelte/Tauri 依赖的 TypeScript 契约
  web-image-engine/         # worker、格式适配、探测、资源预算和下载适配
web-app/                    # Svelte/Vite PWA，base=/convert/
browser-extension/          # Web v1 后再创建，WXT + MV3
scripts/
  assemble-web-release.mjs  # 安全组装 website/dist 与 web-app/dist
```

首期不新建共享 UI 组件库。先从桌面 UI 提取稳定的设计 token 和文案语义，等 Web 与桌面确实出现两个消费者后再抽公共组件，避免为了复用把 Tauri 依赖带进 Web。

### 6.2 转换契约

适配层必须先定义能力，UI 不直接判断浏览器或导入引擎：

```ts
type WebImageFormat = "jpeg" | "png" | "webp" | "avif";

interface WebImageBackend {
  capabilities(): Promise<ConversionCapabilities>;
  probe(input: File, signal: AbortSignal): Promise<ProbeResult>;
  convert(
    request: ConversionRequest,
    signal: AbortSignal,
    onProgress: (event: ProgressEvent) => void,
  ): Promise<ConversionResult>;
  dispose(): Promise<void>;
}
```

契约还要固定：

- magic bytes 优先于扩展名；两者冲突时警告，未知格式拒绝。
- 在进入 ImageMagick/PDF.js/resvg 前，用有界头部解析器读取 raster 尺寸、帧/动画标志和基础容器信息；不能依赖一次完整解码才发现像素炸弹。
- 每个任务包含规范化后的设置快照，排队后 UI 修改不应改变正在执行的任务。
- 输出必须重新 probe，确认容器格式、像素尺寸、alpha 和大小符合请求。
- 警告使用稳定错误码 + 本地化参数，不从 worker 返回任意 HTML。
- 取消后所有临时 ArrayBuffer、Blob URL 和 worker 引用可释放。

### 6.3 Worker 与内存模型

- 编解码必须在 Web Worker 内执行，主线程只做 UI、轻量探测和消息调度。
- v1 同时只执行一个重任务。PDF 页面也串行渲染，不与 raster 转换叠加。
- 文件和结果使用 transferable `ArrayBuffer`，避免结构化克隆整份像素数据。
- 对同步且不可中断的 WASM 调用，取消方式为终止 worker；调度器随后按需创建新 worker。
- 每次任务结束显式释放 WASM image/heap 对象；定期重建 worker 的阈值由内存基准确定。
- 只在用户首次需要某条管线时加载对应 WASM；访问营销页或只打开转换页不能自动下载所有 codec。
- 所有 worker、WASM、字体和运行时代码均同源托管，禁止运行时 CDN 与远程代码。

### 6.4 资源护栏

先沿用桌面版 64 MP 单图像素绝对上限，并增加 Web 专属上限。64 MP 是不可绕过的天花板，不是所有浏览器都能完成该尺寸转换的承诺；基于 P0 数据计算出的运行时工作集预算可以提前采用更低上限。

| 资源 | v1 初始上限 | 行为 |
| --- | ---: | --- |
| 单个 raster 文件 | 32 MiB | 导入时拒绝并推荐桌面版；后续只能根据真机基准上调 |
| 单个 PDF | 256 MiB | 导入时拒绝；页数与页面像素仍单独受限 |
| 单个 SVG | 16 MiB | 导入时拒绝 |
| 单图或单页运行时预算 | 24 MP | 首轮桌面浏览器上限；移动/低内存设备必须更低 |
| 单图或单页绝对上限 | 64 MP | 不允许绕过；当前实现仍会在更低的运行时预算提前拒绝 |
| 一次队列文件数 | 100 | 超出部分不加入 |
| 一次选择的源文件总量 | 2 GiB | 拒绝超出部分，不能提前读入内存 |
| PDF 总页数 | 500 | 超出时拒绝 |
| 单次 PDF 导出的选中页 | 100 | 要求分批处理 |
| fallback 归档的预计输出 | 256 MiB | 超出时要求目录写入或分批下载 |

P0 的 24 MP 基准已经证明：不能把 RGBA 的 4 bytes/px 当作完整工作集。Chromium 8 次循环没有持续增长趋势，但进程树 RSS 峰值约 2.50 GiB，Firefox 单次 AVIF 编码约 51.5 秒。因此 24 MP 只是首轮桌面浏览器工程上限，不是移动端承诺。发布前必须根据移动 Safari/Android 真机数据锁定更保守的动态预算；在公式锁定前，任何超过预算的任务 fail closed。

### 6.5 SVG 安全边界

SVG 不是普通文本图片。进入渲染器前必须：

- 拒绝脚本、事件处理属性、`foreignObject`、外部链接、网络字体和 CSS `url()`。
- 拒绝 `data:`、`http:`、`https:`、协议相对 URL 和文件系统引用。
- 限制 XML 深度、节点数、滤镜复杂度、画布尺寸与最终像素数。
- 禁止 DTD/外部实体；解析失败即拒绝，不做猜测性修复。
- 使用自有安全 corpus 覆盖 XXE、实体扩张、外链、嵌套滤镜和超大 viewBox。

`WEB-006` 实施记录（2026-09-03）：

- 使用 `saxes@6.0.0` 做严格流式 XML 校验，依赖锁定在 pnpm lockfile；为兼容当前
  TypeScript 严格模式，仅通过 pnpm patch 修正上游声明文件，不修改运行时代码。
- 使用 `@resvg/resvg-wasm@2.6.2` 做受限栅格化，MPL-2.0 许可已进入 npm gate 与第三方
  notice；发布 WASM 的 SHA-256 为
  `22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70`。
- 当前只接受可证明安全的静态矢量几何。除既有要求外，主动拒绝动画、`use`、CSS/style、
  live text/font、linked image、processing instruction、foreign namespace 与 CSS 转义属性；
  需要文字的 SVG 必须先将文字转为 path。
- validator 在主线程有界 probe 时执行，SVG Worker 收到原始字节后再次校验；resvg 输出 PNG
  还要经过容器、尺寸、像素预算校验，再进入既有 raster 输出管线。
- resvg Worker 和 WASM 都按首次 SVG 转换懒加载。E2E 已验证仅导入安全/恶意 SVG 不加载
  resvg、转换无外部请求、终止 Worker 可取消初始化且下一任务能以新 Worker 恢复。

### 6.6 PDF 安全边界

- 仅使用自托管 PDF.js worker，把选定页面渲染到受限尺寸画布。
- 不执行 PDF 内 JavaScript，不跟随附件、链接或外部资源。
- 加密/密码 PDF 在 v1 显式拒绝并说明；不尝试绕过保护。
- DPI 限制在 72–600，实际页面像素仍受 64 MP 上限。
- 页范围解析不得展开超大列表；页间检查取消和 wall-clock 预算。
- 页面逐张进入 raster 输出适配器，任何页面失败不会把其他页面标记为成功。

`WEB-007` 实施记录（2026-09-03）：

- 使用精确锁定的 `pdfjs-dist@6.3.289`（Apache-2.0）；该版本要求 Node 22.13+，本项目 CI
  使用 Node 24。升级后的生产依赖审计为 0 个已知漏洞，第三方 notice 已重新生成并验证。
- 主线程只读取有界文件头；开始转换后才加载 633,903-byte PDF 适配 Worker，并由它创建
  2,228,489-byte 自托管 PDF.js Worker。普通导入不会提前下载 PDF.js。
- 原始字节通过 transferable 移交，Worker 内再次验证 `%PDF-` 与版本。单文件 256 MiB、
  总页数 500、单次选择 100 页、DPI 72–600、单页运行时 24 MP 和绝对 64 MP 上限均为
  不可绕过的契约。
- PDF.js 只接收内存中的 `Uint8Array`，关闭 range/stream/auto-fetch、XFA、annotation、系统
  字体、ImageDecoder、WASM 和 worker fetch；文档 JavaScript 与密码保护 PDF 显式拒绝，
  链接和附件不跟随。
- 页面严格串行渲染为白底 PNG，再进入已有 raster 转换与输出复检管线。结果命名为
  `原文件名-page-001.png`；页面失败按页显示，其他成功页仍可预览和下载。
- 取消和 300 秒 wall-clock 都通过终止 Worker 回收；过期/畸形消息、页码或格式不匹配会
  fail closed 并回收 Worker，下一任务可创建全新实例恢复。
- 三浏览器 E2E 覆盖 375 px 布局、DPI/页范围、逐页下载、JavaScript、加密 PDF、外部链接、
  混合成功/像素超限、按需加载、零外部请求和取消恢复。PDF 适配 Worker 与 PDF.js Worker
  的 SHA-256 分别为 `83c8c308cdb1dc9affde63beed86d9d9d8774c70867a96ae863ed2a2fa7a57bd`
  和 `f2870db902eaff8397442c912b69459980ac91f6f4b5ed827167b12cf7057930`。

## 7. PWA、本地存储与隐私

- Service Worker 文件位于 `/convert/`，scope 固定为 `/convert/`，不得控制 `/`、`/docs/`、`/blog/` 等营销和内容页。
- 导航请求和 HTML 使用 network-first，并提供已验证的离线 fallback；带内容 hash 的 App shell 资产使用 cache-first；WASM/worker 按需缓存。UI、worker 和 WASM 通过同一兼容版本标识进行原子切换。
- Cache Storage 只保存公开静态资源，不能保存用户输入、转换结果、文件名或缩略图。
- 设置只保存格式、质量、主题、语言等非内容数据；提供“一键清除本地设置和离线缓存”。
- 转换路由不接入会采集文件名、Blob URL、转换参数或内容的埋点。若保留页面级匿名统计，必须能证明请求不包含这些字段。
- 自动化隐私测试拦截所有请求：转换开始后只允许同源静态资源请求，且 URL、query、headers 和 body 均不得包含输入片段、文件名、转换设置或输出内容。
- 默认 CSP 只开放自托管脚本、worker、图片 Blob 和必要的 WASM 能力。只有引入 `SharedArrayBuffer`/多线程的实测收益明确时，才考虑 COOP/COEP；v1 不为未来假设提前改变全站隔离策略。

`WEB-009` 实施记录（2026-09-03）：

- 构建后生成 manifest、192/512 图标和带 16 位内容 build ID 的 Service Worker。注册路径与
  scope 均固定为 `/convert/`；根站、文档、博客和法律页面不被控制。
- App shell 预缓存使用 build ID 隔离，导航采用 network-first + 离线 fallback；带内容 hash
  的静态资源 cache-first。Raster、SVG、PDF 和归档 Worker/WASM 不首屏预取，只在真实使用后
  进入对应 build 的 engine cache。
- Service Worker 不在 install 阶段强制接管。新版本保持 waiting，只有用户点击“更新并重新
  加载”且兼容版本匹配时才 `skipWaiting`；激活时仅清理 ImgConvert 自身的旧 cache。
- 只持久化经过有界校验的输出格式、质量、尺寸、PDF 页码/DPI、语言和主题。清理入口会尝试
  删除全部这些键与 ImgConvert cache，不触碰其他同源产品 cache；浏览器拒绝任何一步时不
  伪报成功。
- Cloudflare `/convert/*` 使用独立 CSP：脚本、连接和 Worker 仅同源，图片额外允许本地
  `blob:`，WASM 仅开放 `wasm-unsafe-eval`；不启用 COOP/COEP，也不继承营销站统计脚本。
- 自动化覆盖 scope、首屏不预取引擎、缓存后断网转换、显式更新、旧 cache 清理、非本产品
  cache 保留以及本地数据清除。WebKit 测试因 Playwright `setOffline` 会错误阻断本地
  `blob:`，改为切断全部 HTTP(S)，并断言离线转换期间零 HTTP(S) 请求。

## 8. 下载策略

1. 支持 File System Access API 且用户选择目录时，逐个写入并在写入完成后释放结果。
2. 不支持目录写入时，小批量结果使用流式归档；归档库必须通过许可证、安全和内存评审。
3. 若无法可靠流式归档，则只对不超过 256 MiB 预计输出开放归档；更大的任务要求分批或使用桌面版。
4. 所有文件名经过路径字符清理和冲突编号，不能生成路径穿越片段。
5. 写入前展示最终扩展名、数量和预计大小；部分失败时归档内附结构化失败摘要，不伪报全部成功。

`WEB-008` 实施记录（2026-09-03）：

- 增加共享的 `maxFallbackArchiveBytes = 256 MiB` 资源契约。归档入口会同时校验条目数、
  原始 Blob 总量、保守估算和最终 ZIP 大小，任一超限都 fail closed；最大条目数由 100 个
  队列文件与每个 PDF 最多 100 个选中页面推导，并为失败摘要保留 1 个条目。
- 支持 File System Access API 的安全上下文优先显示“保存到文件夹（推荐）”。结果严格串行
  写入，写入过程不创建整批归档副本；写入前探测已存在文件并追加 `(2)` 等编号，避免默认
  覆盖。取消会 abort 当前 writable，后续条目不再创建。
- Firefox、WebKit 及其他不支持目录选择 API 的浏览器使用 ZIP fallback。精确锁定
  `@zip.js/zip.js@2.9.0`（BSD-3-Clause），在 145,140-byte 独立懒加载 Worker 内运行，发布
  SHA-256 为 `046ede06bb8c08d3f0fbc6b760c34a3441f265d6aa47c4cbf2d56e2574dfaf5a`；关闭 zip.js
  内层 Worker、CompressionStream、压缩和 Zip64，以串行 STORE 方式封装已经压缩的图片，
  避免远程 Worker、无意义的重复压缩与额外 WASM。
- 输出文件名按 NFC 规范化，移除路径字符、控制字符、双向文本控制符与 Windows 保留设备名；
  冲突比较采用大小写不敏感的 NFKC key，跨输入和已有目录文件统一编号，不能生成路径层级。
- 部分失败批次额外写入 `imgconvert-failures.json`，只包含有界、去双向控制符的源文件名、
  页码和稳定错误码。界面明确展示成功数量、失败数量、最终扩展名与预计 ZIP 大小。
- ZIP Worker 使用单任务调度、300 秒 wall-clock、单调进度、execution id、结果条目数/大小/
  MIME/ZIP 魔数复检；取消、超限、异常或畸形消息均终止 Worker，下一次操作创建干净实例。
- Chromium E2E 验证目录串行写入与不覆盖；Chromium、Firefox、WebKit 均验证 ZIP 解包、
  同名编号、部分失败摘要、按需加载、375 px 无横向溢出及取消恢复。生产依赖审计为 0 个
  已知漏洞，第三方许可证 notice 已重新生成并通过校验。

## 9. 构建与 Cloudflare Pages 部署

### 9.1 工作区与构建

- 将 `web-app`、`packages/conversion-contract`、`packages/web-image-engine` 加入 `pnpm-workspace.yaml`。
- `web-app` 使用与仓库一致的 Svelte/Vite 主版本，依赖精确锁定在 `pnpm-lock.yaml`。
- `web-app` 单独输出到 `web-app/dist`，不能直接把 Vite `outDir` 指到 `website/dist/convert`。
- 新增 `scripts/assemble-web-release.mjs`：先校验输入/输出都位于允许目录，再把 `web-app/dist` 复制到 `website/dist/convert`；拒绝 symlink、绝对路径和目录穿越。
- Cloudflare Pages 的最终命令改为一个明确的 release 脚本：依次构建网站、构建 Web 应用、组装、执行产物检查。

### 9.2 产物检查

发布门禁至少验证：

- 营销站现有中英文、docs、blog、legal、privacy 与 SEO 静态路由仍存在。
- `/convert/index.html` 的资源 URL 全部落在 `/convert/` 或允许的同源公共资产中。
- 营销首页不引用转换器 WASM；访问 `/convert/` 但未转换时不下载 PDF/SVG 引擎。
- 对 preview 部署发起真实请求，验证 `/convert/*` 的 WASM、worker、JS 和 manifest MIME；`_headers` 负责 `nosniff`、CSP 和缓存策略，不能只靠源码推断响应头。
- Service Worker 的注册 scope 和缓存 key 都不能越过 `/convert/`。
- Cloudflare preview 环境通过 smoke 后才能部署 production。

`WEB-010` 实现使用 `pnpm run web:release:build` 作为唯一发布构建入口；它依次执行官网构建、
Web App 构建、安全组装和产物检查。Git-connected Pages 的非生产分支生成 preview 后，运行
`pnpm run web:release:preview:smoke -- --url=https://BRANCH.PROJECT.pages.dev`，以真实响应验证
HTML、manifest、Service Worker、JS、worker、WASM 的 MIME、CSP、`nosniff`、framing、
referrer、permissions、`noindex` 与缓存头。再通过 `IMGCONVERT_WEB_PREVIEW_ORIGIN` 对同一
Preview 执行三浏览器功能矩阵。两个入口都只接受 HTTPS `*.pages.dev` origin；本地 Vite
preview 不应用 `_headers`，不能替代这些门禁。

## 10. 许可证与供应链

- 项目继续使用 Apache-2.0；Web 新包必须进入现有 npm license gate、third-party notice 生成与依赖审计。
- 四个 jSquash raster codec、PDF.js、resvg-wasm 采用精确版本并由 lockfile 固定；每次升级必须重新跑格式、内存、artifact 哈希和许可证测试。
- 不只检查 npm 包声明，还要检查发布的 WASM 内实际包含的 delegate、字体、数据文件及其许可证。
- 发布仓库中增加一份 Web 第三方许可清单，并在应用“关于/开源许可”入口可访问。
- 保存独立实现说明：允许参考的只有公开行为、标准和架构思想；禁止引入 VERT 文件、CSS、图标、翻译、测试 fixture 和复制性实现片段。
- HEIC/HEIF、专利 codec 或新的 native/WASM delegate 必须经过单独的法律和技术准入，不因引擎“碰巧能读”就进入产品矩阵。

参考来源：

- VERT 仓库与许可证：<https://github.com/VERT-sh/VERT>
- magick-wasm：<https://github.com/dlemstra/magick-wasm>
- PDF.js：<https://mozilla.github.io/pdf.js/>
- resvg-js：<https://github.com/thx/resvg-js>
- Chrome Manifest V3：<https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3>

## 11. 测试与验收标准

### 11.1 自动化测试

- 单元测试：magic 探测、设置归一化、能力矩阵、尺寸计算、页范围、文件名、错误映射和调度状态机。
- worker 集成测试：每个允许的输入/输出组合、alpha、orientation、损坏输入、取消、超限和资源释放。
- 元数据测试：按格式写入自有 EXIF/XMP/ICC fixture，验证 `stripAll` 与已开放的 preserve 行为。
- 图像质量测试：自生成和自有许可 corpus，检查输出可解码、尺寸、alpha、像素误差阈值和完整文件字节。
- 浏览器 E2E：Playwright Chromium、Firefox、WebKit；覆盖导入、设置、转换、取消、下载、语言、主题和键盘流。
- 移动预检：独立 Playwright 配置串行执行 Pixel 7/Chromium 与 iPhone 13/WebKit 模拟，覆盖上传后队列可见性、实际转换、下载、溢出和无内容出站；它不替代[真机验收](WEB_CONVERTER_MOBILE_DEVICE_ACCEPTANCE.md)。
- 隐私 E2E：转换时拦截网络并校验请求目的地、body 与 headers。
- PWA E2E：首次在线加载、离线重开、版本升级、旧缓存清理和 scope 隔离。
- 构建测试：验证网站所有既有静态路由未被 Web 应用构建覆盖。

### 11.2 发布验收

Web v1 只有同时满足以下条件才可公开：

- JPEG/PNG/WebP/AVIF 的 4 × 4 raster round-trip 矩阵在三个浏览器引擎通过。
- SVG 与 PDF 的安全 corpus、像素上限和取消测试通过。
- 桌面浏览器连续处理至少 8 个允许预算内的大图后，worker 生命周期没有持续增长的不可回收内存趋势；当前 Chromium 24 MP 基线门槛为预热后 RSS 增长不超过 `max(64 MiB, 15%)`。移动端使用真机预算，不强制尝试 24 MP。对运行时预算不允许的 48/64 MP 样本，提前拒绝同样是合格行为。
- 主线程不执行编解码；转换期间 UI、取消和无障碍状态仍响应。
- 未开始转换时不加载 ImageMagick/PDF.js/resvg 的重型资源。
- 转换阶段没有用户内容出站，且隐私页和界面声明与测试事实一致。
- npm audit、license gate、第三方 notice、类型检查、lint、format、单测和 E2E 全绿。
- 375 px、768 px、1440 px 三档视觉与交互复审通过，无水平溢出或遮挡。
- Cloudflare preview 通过真实缓存、MIME、CSP、离线和下载 smoke。

## 12. 分阶段开发计划

工期按一名熟悉仓库的开发者估算，不含商店审核等待。

### P0：技术与许可证 Spike（已完成）

- 建最小 worker 原型，验证 stock magick-wasm 与独立 codec 的 JPEG/PNG/WebP/AVIF 解码与编码。
- 测量包体、首次加载、每像素内存、24/48/64 MP 的成功或提前拒绝行为，以及取消重建成本。
- 验证 Safari/WebKit 的 AVIF、WASM、Blob 下载和内存表现。
- 用最小可构建原型核对候选包的真实导入/API，再审计 WASM/native 组件、artifact 哈希和发布资产；不根据包名或文档片段猜测接口。PDF.js 与 resvg-wasm 在各自管线开始前单独审计。
- 已验证 alpha 和默认 metadata strip；EXIF orientation、ICC、真实容器 round-trip 和跨编码器质量映射保留为 P2 发布门禁，不因引擎准入而假定通过。
- 写出 P0 决策记录，锁定实际性能预算与最终矩阵。

退出条件：四个 raster 输出格式至少有一条受支持且跨浏览器一致的实现路径；没有无法接受的许可证项；串行 worker 与动态资源预算能让超限任务在重型解码前被拒绝。若 AVIF、64 MP 或 Safari 未达标，可以按能力降级，但必须先修订公开格式矩阵，不能带病宣称支持。

### P1：应用骨架与契约（已完成首版）

- 建 `conversion-contract`、`web-image-engine`、`web-app` 三个 package。
- 完成 capability registry、错误码、任务状态机、串行调度器和 worker 生命周期。
- 接入品牌 token、中英文、主题、响应式应用骨架和导入队列。
- 建资源护栏、magic sniffing、设置规范化及其单元测试。

退出条件：可导入并 probe 文件，超限/错误可解释，队列可取消和清空，尚未包含真实转换也不会展示虚假成功。

### P2：Raster MVP（已完成并复审，6–9 人日）

- 接入独立 codec adapter 与按格式按需加载。
- 完成 JPEG/PNG/WebP/AVIF 输出和 BMP/GIF 输入。
- 完成尺寸、质量、无损、alpha 背景、预览和单文件下载。
- 完成格式 conformance、元数据、损坏输入、取消和内存测试。

退出条件：四格式 round-trip 矩阵与三浏览器 E2E 全部通过；失败不会阻塞队列；输出都经过二次 probe。

### P3：SVG、PDF、批量下载与 PWA（已完成，6–9 人日）

- 实现 SVG 安全验证与 resvg-wasm 管线（`WEB-006` 已完成并复审）。
- 实现 PDF.js 页范围/DPI/串行渲染管线（`WEB-007` 已完成并复审）。
- 实现目录写入和有界 fallback 归档（`WEB-008` 已完成并复审）。
- 完成 Service Worker、离线缓存、更新与清除入口（`WEB-009` 已完成并复审）。
- 完成隐私、CSP、scope 和大任务保护测试（真实 Cloudflare header smoke 归 `WEB-010`）。

退出条件：SVG/PDF 恶意 corpus 无越界或出站；批量输出有明确部分失败语义；在线访问一次后可离线完成已缓存格式的转换。

### P4：网站集成与发布复审（本地及 Pages Preview 门禁已完成，移动真机待执行，4–6 人日）

- 增加安全 assemble 脚本与 Cloudflare Pages preview 流程。
- 首页和内容页增加 Web 版入口，同时保留 macOS/Windows/Linux 下载入口。
- 执行视觉、无障碍、许可证、安全、性能、隐私和多浏览器复审。
- 修复审查结果，更新隐私、法律、README、部署与运维文档。

退出条件：第 11 节全部发布验收通过，preview 经人工 smoke 后再部署 production。

### P5：Chromium 浏览器扩展（独立执行，10–15 人日）

完整产品调研、权限模型、架构、工作项和复审修正见
[Chromium 浏览器扩展开发方案](BROWSER_EXTENSION_DEVELOPMENT_PLAN.md)。关键边界为：

- 只支持 Chrome 与 Chromium Edge；使用 WXT + Svelte 构建 MV3 双 vendor 产物。
- 工具栏 action 打开扩展内完整转换页，不使用 popup/offscreen/service-worker keepalive 承载作业。
- 先抽出 `web-conversion-runtime`，让 Web 与扩展以薄 Worker 入口复用 codec；禁止跨 package 深导入 `web-app` 私有文件。
- 所有 WASM/Worker 随扩展打包，禁止远程代码；本地文件转换版本只申请 `storage`。
- 右键网页图片是独立安全 spike。只有精确 origin optional host permission、无凭据有界 fetch 和失败回退通过后才进入正式 manifest；不得退回 required `<all_urls>`。
- Chrome/Edge 分别构建、sideload、smoke 和准备商店草稿；不开发 Firefox、Safari 或移动扩展。

退出条件：权限、CSP、包体、隐私声明、Web 无回归、Chrome/Edge vendor 测试与两个可复现 ZIP 全部通过。扩展失败不能阻塞已经稳定的 Web/PWA 发布。

总计：Web v1 约 22–33 人日；Chromium 浏览器扩展另计 10–15 人日。

## 13. 可直接建立的工作项

| ID | 工作项 | 依赖 | 验收产物 |
| --- | --- | --- | --- |
| WEB-001 | magick-wasm raster spike（已完成、no-go） | 无 | 基准报告、格式矩阵、许可证报告 |
| WEB-001B | 独立 codec 候选（已完成、通过） | WEB-001 | 可复现构建、bundle license gate、性能基线 |
| WEB-002 | Web 转换契约与能力注册（已完成首版） | WEB-001B | TS package + 单测 |
| WEB-003 | Worker 调度、取消与资源预算（已完成首版） | WEB-001B | worker integration tests |
| WEB-004 | Svelte 应用壳和导入队列（已完成首版） | WEB-002 | 响应式双语 UI |
| WEB-005 | Raster 转换、预览与下载（已完成首版） | WEB-002/003/004 | 四格式 E2E |
| WEB-006 | SVG 安全管线（已完成并复审） | WEB-003 | 安全 corpus + E2E |
| WEB-007 | PDF 页渲染管线（已完成并复审） | WEB-003 | 页范围/DPI/取消测试 |
| WEB-008 | 批量目录与归档下载（已完成并复审） | WEB-005 | 跨浏览器 fallback 测试 |
| WEB-009 | PWA 离线与更新（已完成并复审） | WEB-005/006/007 | 离线和 scope 测试 |
| WEB-010 | 网站构建组装与 CF preview（实现、本地复审及真实 Preview smoke 已完成） | WEB-009 | 可部署静态产物 |
| WEB-011 | 发布前综合 review 与修复（本地及 Pages Preview 门禁完成；移动真机待外部环境） | WEB-010 | [完整验收清单](WEB_CONVERTER_RELEASE_REVIEW.md) |
| EXT-001 | Chromium 扩展调研、项目级 Skills 与审定方案（已完成） | WEB-011 | [调研](BROWSER_EXTENSION_RESEARCH.md) + [开发方案](BROWSER_EXTENSION_DEVELOPMENT_PLAN.md) |
| EXT-002 | WXT Chromium 壳与 manifest guardrail（已完成并复审） | EXT-001 | 双 vendor build/ZIP、最小权限与 Chromium sideload 门禁 |
| EXT-003 | 共享 runtime 与双构建（已完成并复审） | EXT-002 | 双消费者 Worker、8 × 4 Chrome smoke 与 Web 全量回归 |
| EXT-004～008 | 工作台、右键安全 spike、vendor 验收与商店草稿 | EXT-003 | 逐项定义见扩展开发方案 |

## 14. 风险与应对

| 风险 | 概率/影响 | 应对 |
| --- | --- | --- |
| 独立 codec 的 AVIF 包体和首次加载较大 | 高/中 | 按格式加载、长缓存和真实进度；未选择 AVIF 时不下载 AVIF encoder |
| Safari/WASM 内存限制导致大图失败 | 中/高 | 串行 worker、动态预算、提前拒绝、桌面版兜底 |
| AVIF 编码速度不可接受 | 中/中 | 能力分级、默认较快参数、清楚展示预计耗时；必要时延后 Safari AVIF 输出 |
| 元数据/ICC 行为不一致 | 高/高 | 默认 strip、逐组合开放 preserve，不做未经验证的营销承诺 |
| SVG/PDF 恶意输入 | 中/高 | 独立管线、严格预算、安全 corpus、无外部资源 |
| Blob/归档导致内存翻倍 | 高/高 | 目录写入优先、流式归档、有界 fallback、逐项释放 |
| PWA 旧缓存造成引擎与 UI 不匹配 | 中/高 | 原子版本 manifest、兼容版本检查、可清缓存和回滚 |
| 未来扩展重复实现 | 中/中 | 先稳定无 DOM 的 contract/engine，扩展只做权限与入口适配 |
| 与现有网站构建互相覆盖 | 中/高 | 独立 dist + 受限 assemble + 路由完整性测试 |

## 15. 开工前需要产品确认的三项

以下选择不阻塞技术 Spike，但在 P1 结束前必须由产品负责人确认：

1. Web v1 的默认元数据策略是否确定为 `stripAll`。本方案推荐确定为默认值。
2. PDF 批量输出的默认文件名规则，例如 `原文件名-page-001.png`。
3. 当 Web 资源预算不足时，是仅推荐桌面版，还是同时允许用户强制尝试。基于浏览器崩溃风险，本方案推荐只允许桌面版兜底，不提供绕过硬上限的开关。

除这三项外，其余架构、许可证和安全边界可以直接按本方案进入 P0。
