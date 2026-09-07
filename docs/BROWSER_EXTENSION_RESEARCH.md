# Chromium 浏览器扩展产品与技术调研

> 当前实现基线（2026-09-05）：侧边栏工作台要求 Chrome / Edge ≥116，网页图片导入仅允许 HTTPS。
> 下文早期调研与 EXT-002 等完成记录中的 Chrome 102、独立标签页和 HTTP 候选是历史方案，
> 已被此基线取代，不能用作当前兼容性、权限或发布声明。

> 调研日期：2026-09-03
>
> 范围：Google Chrome、Chromium 版 Microsoft Edge、Manifest V3
>
> 结论：建议开发，但首版应以扩展内完整转换工作台为核心；网页图片右键导入必须经过独立权限与兼容性门禁

## 1. 执行结论

ImgConvert 已有的 Web 转换器适合复用于 Chromium 扩展，但不能简单把 `/convert/` 套进扩展，也不能照搬同类扩展常见的 `<all_urls>` + 隐藏 Canvas 实现。

推荐产品形态：

- 点击工具栏图标，打开或聚焦一个打包在扩展内的完整转换页。
- 页面支持本地拖放/文件选择、批量队列、JPEG/PNG/WebP/AVIF/BMP/静态 GIF/SVG/PDF 输入，以及 JPEG/PNG/WebP/AVIF 输出。
- 转换、预览和导出继续在本机的可见 extension page 与 Web Worker 中完成；图片、文件名、缩略图和结果不进入远程服务或持久存储。
- “右键网页图片并导入 ImgConvert”是有价值的浏览器增强，但需要对图片源 origin 临时申请可选 host permission；在完成真实兼容性 spike 前不能宣称支持任意网站或任意图片。
- Chrome 与 Edge 共用 Chromium MV3 源码和转换运行时，但分别生成、验收和提交商店 ZIP；不开发 Firefox、Safari 或移动扩展分支。

## 2. 当前项目可复用基础

### 2.1 已验证能力

当前 Web v1 已实现并通过本地与 Cloudflare Pages Preview 验收：

- 输入：JPEG、PNG、WebP、AVIF、BMP、静态 GIF、SVG、PDF。
- 输出：JPEG、PNG、WebP、AVIF。
- 独立 raster/SVG/PDF Worker、真实取消与 Worker 恢复。
- magic/container probe、格式专属字节上限、动态像素预算、64 MiB 输出硬上限。
- SVG 外部资源拒绝、PDF JavaScript/加密/页数/DPI 边界、动画 GIF 拒绝。
- 批量队列、目录/ZIP fallback、下载、双语、主题、键盘和响应式工作台。
- 全部 codec、Worker 和 WASM 本地加载；转换内容无出站请求。

生产构建当前约 13 MiB（未压缩），主要资产为 AVIF encoder、resvg、PDF.js worker 和各格式 codec。扩展不能把这些资产塞进 background、popup 或 content script；必须只由转换页按需加载。

### 2.2 需要抽取的边界

`@imgconvert/conversion-contract` 与 `@imgconvert/web-image-engine` 已经是 UI 无关 package，可以直接复用。真正的 codec adapter、三个转换 Worker 和一个归档 Worker 入口仍位于 `web-app/src/lib/`：

- `raster-codecs.ts`
- `raster-codec.worker.ts`
- `svg-codec.worker.ts`
- `pdf-codec.worker.ts`
- `archive.worker.ts` 与 archive/export 运行时

扩展不能跨 package 深层导入这些 Web app 私有文件。实施时应先抽出构建器无关的 `@imgconvert/web-conversion-runtime`，再让 Vite Web app 与 WXT 扩展分别保留很薄的 Worker 入口。抽取必须经过双消费者构建和 Web 全量回归，不能为了扩展破坏现有 PWA。

> 2026-09-04 实施更新：上述边界已在 EXT-003 落地。四类 Worker 执行函数、codec 依赖、归档协议/调度器与安全文件名规则现统一由 `@imgconvert/web-conversion-runtime` 持有；Web 与 WXT 只保留各自的薄 Worker 资产入口。

## 3. 同类产品观察

商店页面只能证明开发者公开声明和当前展示信息，不能独立证明其隐私、安全或全部运行时行为。

| 产品                                                                                                                       | 当前公开形态                                                               | 可参考点                                               | 不应照搬                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [Save image as Type](https://chromewebstore.google.com/detail/save-image-as-type/agddafeppiiohhalnjfhcfjemjjcgmcb)         | Featured，约 8 万用户；右键选择 JPG/PNG/PDF/GIF/WebP；声明本地处理、无注册 | 右键入口直接、格式选择层级短、多语言、文件名提示       | “任意网页/任意图片”是商店方声明；没有公开代码证明其站点兼容和资源边界                                           |
| [Save Image As Type](https://chromewebstore.google.com/detail/save-image-as-type/bhihbcbjolcjdpfmjoifajkkmcfgopen)         | 轻量、开源替代；声明离线、无追踪、不修改页面                               | 隐私与可审计代码是明确卖点；设置默认格式/质量          | 页面中的安全历史指控未经本调研独立验证，不能用于 ImgConvert 营销                                                |
| [Simple Image Converter](https://chromewebstore.google.com/detail/simple-image-converter/clinbfiephmemllcffpddoabnknkaeki) | 右键保存或复制 PNG/JPEG；质量、缩放、智能命名、暗色模式                    | 把权限用途直接写入商店说明；受限页面给出可理解失败提示 | 源码使用 `<all_urls>`、content script、scripting、offscreen、clipboard、downloads，权限面明显大于本项目首版所需 |
| 其他同类扩展                                                                                                               | 常见 URL 粘贴、拖放、批量、质量/缩放、复制图片                             | 用户已经理解“右键转换”和“本地离线”的价值               | 不少描述存在关键词堆叠和“所有网站都可用”式承诺；不能作为功能真实性依据                                          |

### 3.1 产品机会

市场上轻量右键转换器很多，但多数只调用 Canvas 原生编码并输出 PNG/JPEG/WebP。ImgConvert 不应与它们只比菜单项数量，而应突出：

- 复用已经验证的容器 probe、像素/内存预算和真实 Worker 取消。
- 本地批量队列，而不只是一张图的即时另存。
- 安全的 SVG/PDF 输入管线和四种现代 raster 输出。
- 明确解释权限、站点限制和失败回退，不把浏览器安全边界包装成“万能转换”。
- 不接入 analytics，不把图片、浏览 URL 或文件名发给开发者服务器。

## 4. 开源实现审计

GitHub 没有发现同时具备较高采用度、活跃维护和严格资源安全的成熟图片转换扩展。以下仓库只用于观察实现取舍，不作为依赖或平台事实源。

| 仓库                                                                                                | 2026-09-03 快照                   | 实现方式                                                                | 审计结论                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [saoud30/Safe-Image-Converter-Extension](https://github.com/saoud30/Safe-Image-Converter-Extension) | 13 stars，MIT，未归档             | MV3 background + offscreen document + Canvas；右键菜单后 fetch `srcUrl` | 直接申请 `<all_urls>`、downloads、notifications、offscreen、storage；没有响应字节/像素/MIME/重定向边界，偏好用 `storage.sync`。只参考入口，不复用架构        |
| [opzozi/simple-image-converter](https://github.com/opzozi/simple-image-converter)                   | 7 stars，MIT，未归档              | background + offscreen Canvas + content script；保存/剪贴板 fallback    | 申请 `<all_urls>`、scripting、clipboard、downloads、offscreen，并允许跨源 fetch 携带 credentials。功能覆盖较全，但凭据与注入面不符合 ImgConvert 最小权限基线 |
| `stufently/save-as-img-chrome-extension`                                                            | 搜索结果存在，GitHub API 返回 404 | 无法复核                                                                | 排除，不引用不可审计实现                                                                                                                                     |

两个可审计样本都没有 ImgConvert 已有的格式探测、资源预算、SVG/PDF 安全管线或批量队列。它们说明 offscreen Canvas 是常见做法，不说明它是本项目的正确做法。

## 5. Chromium 平台约束

### 5.1 生命周期与执行上下文

[Chrome extension service worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)要求后台能承受意外终止：空闲约 30 秒会停止，单次请求通常也受 5 分钟上限约束。Chrome 114 起，仅打开 port 已不会重置空闲计时器。因此：

- background 只注册 action、context menu、安装/更新和短事务消息。
- 所有监听器在顶层同步注册。
- 不在 background 全局变量中保存作业、图片或转换进度。
- 不使用 alarm、空消息或 port 心跳维持转换。
- 长任务由用户可见的 extension page 持有，实际计算仍在可终止/重建的 Web Worker 中。

[Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)需要 `offscreen` 权限，一次只能打开一个隐藏文档，且该文档只能访问 runtime 扩展 API。首版已有可见工作台，没有必须隐藏使用 DOM/Canvas 的场景，所以不采用 offscreen document。

### 5.2 权限

[Chrome 最小权限政策](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)要求 required 与 optional 权限都必须是当前功能所需的最窄集合。首版权限预算应为：

| 能力                       | 权限                                             | 决策                                                                                          |
| -------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 打开扩展转换页             | `action` manifest key；`tabs.create/update`      | 不申请 `tabs`；按窗口保存扩展自己创建的 tab ID，不读取网页 tab URL/title                      |
| 小型偏好与一次性导入描述符 | `storage`                                        | required；持久偏好只放 `storage.local`，一次性 URL 只放 `storage.session` 并设 TTL            |
| 右键图片入口               | `contextMenus`                                   | 只有 EXT-005 spike 通过后才进入正式 manifest                                                  |
| 跨源读取用户点选的图片     | `optional_host_permissions` 中的 HTTP(S) 模式    | 先打开工作台解释用途；用户再次点击后只请求 `srcUrl` 的精确 origin；拒绝后仍可使用本地文件导入 |
| 页面脚本注入               | `activeTab` / `scripting` / content scripts      | 首版不需要，不申请                                                                            |
| 自动下载、剪贴板、通知     | `downloads` / `clipboardWrite` / `notifications` | 首版不需要；使用现有用户触发下载流和页面内状态提示                                            |
| 隐藏 DOM                   | `offscreen`                                      | 首版不需要                                                                                    |

右键入口不能假设 `activeTab` 能读取所有图片：图片常来自与页面不同的 CDN origin，blob URL 也属于创建它的页面上下文。为避免依赖 background context-menu handler 是否保留权限请求所需的用户手势，右键事件只写入一次性描述符并打开工作台；工作台先解释 origin，再由用户点击按钮触发 `permissions.request()`。真正的 spike 必须覆盖可选 host permission、redirect、data/blob URL、认证资源、CORS、受限页面、MIME 欺骗和超限响应。

### 5.3 数据与安全

- 远程图片请求默认 `credentials: "omit"`、`cache: "no-store"`、`referrerPolicy: "no-referrer"`。
- URL 只能来自实际 context-menu 事件生成的一次性描述符；extension page 不能通过普通消息把任意 URL 交给高权限 background fetch。
- context menu 的 `documentUrlPatterns` 只覆盖 HTTP(S) 页面；不在 `chrome://`、扩展页或本地文件页显示入口。
- 只允许 `https:` 和显式兼容的 `http:`；拒绝 `file:`、`filesystem:`、任意 `chrome*:`、未知 scheme，以及 localhost、loopback、link-local 和 private-network literal host。内网站点仍可先保存再导入。
- 先检查 `Content-Length`，再以流式 reader 实施真实字节硬上限；最终仍走既有 magic/container probe，不信任 URL 后缀或响应 MIME。
- 跨 origin redirect 默认失败并提示用户“先保存再导入”，不能在一次手势消失后静默扩大权限。
- 图片字节只存在转换页内存；`storage.session` 最多保存有 TTL、长度上限和随机 nonce 的 URL 描述符，消费后立即删除。`data:` URL 另设远低于 storage quota 的编码长度上限，超限直接回退。
- 本地数据处理仍需公开隐私政策，并准确披露 transient webpage URL access。Chrome 的本地存储说明并不豁免隐私政策。

### 5.4 打包与商店

[Manifest V3 商店政策](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)禁止远程托管可执行代码。所有 JS、Worker、WASM 和 codec 必须随 ZIP 提交，且可从源码和包内容看懂完整功能。

[Chrome Web Store 质量政策](https://developer.chrome.com/docs/webstore/program-policies/policies)还明确禁止只打开网站、没有自身转换能力的壳扩展。转换页必须运行扩展包中的本地引擎，而不是嵌入或重定向到 `/convert/`。

商店准备至少包括：

- Chrome：128 × 128 PNG 扩展图标、至少一张 1280 × 800 或 640 × 400 真实截图、440 × 280 promo、双语 listing、权限理由和隐私字段。
- Edge：独立 ZIP、Partner Center 权限/remote-code/data-use 说明、隐私 URL、每个包内 locale 的说明与图标、认证测试备注。
- 商店截图必须来自真实扩展 UI；不能拿桌面版或网页版截图冒充扩展能力。

## 6. Chrome 与 Edge 兼容结论

[Microsoft 的移植说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/port-chrome-extension)确认已支持的 Chrome API 和 manifest key 在 Edge 中基本代码兼容，但仍要求逐项核对 API 支持、删除 `update_url`、在 Edge sideload 实测并单独发布。

因此采用同一源码、两个受控构建目标：

- `chrome-mv3`：Chrome Web Store ZIP。
- `edge-mv3`：移除/覆盖商店特有字段，使用 Edge 品牌文案和独立 ZIP。
- 两个 ZIP 都执行 manifest permission snapshot、无远程代码、资产完整性和转换 smoke。
- 不因 WXT 能生成 Firefox 目标就保留 Firefox 分支或测试矩阵。

浏览器最低版本不能凭框架文档猜测。EXT-002/003 应根据实际使用 API、WASM/Worker 能力和 vendor browser smoke 得出 `minimum_chrome_version` 与 Edge 支持下限，并把结果固定到 manifest 与支持文档。

## 7. Skills 搜索与安装

本轮使用 `find-skills` 搜索 Chrome extension、Manifest V3 和 WXT 候选，再按仓库来源、许可证、维护状态、stars、适配度和重复度审计。

### 7.1 已安装到项目

| Skill                                                | 项目路径                                | 固定上游 revision                          | 用途                                                        |
| ---------------------------------------------------- | --------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `GoogleChrome/modern-web-guidance@chrome-extensions` | `.codex/skills/chrome-extensions/`      | `56c61c9ee79a8df1a98822309c04847a57f56000` | Chrome 官方 MV3、权限、生命周期、UI surface、Web Store 清单 |
| `pproenca/dot-skills@wxt-browser-extensions`         | `.codex/skills/wxt-browser-extensions/` | `cf93c57cac89d6fc3e4194686000411567f5caf3` | WXT 入口、bundle/WASM、消息、storage 和 manifest 工程检查表 |

第二项位于上游 experimental 目录，只作为框架检查表。平台行为与商店规则始终以 Chrome、Microsoft 和 WXT 官方文档为准。当前 npm 快照为 `wxt@0.21.4`、`@wxt-dev/module-svelte@2.0.5`；正式 scaffold 时再由 lockfile 精确固定并执行供应链门禁。

### 7.2 未安装候选

- `clerk/skills@clerk-chrome-extension-patterns`：面向 Clerk 认证，仓库没有适合本项目的通用许可证/范围优势。
- `samber/cc-skills@chrome-extension`：与 Chrome 官方 Skill 重叠，且默认引导 CRXJS，不符合既定 WXT 方向。
- `quangpl/browser-extension-skills`：仓库采用度低于审计阈值，拆分规则没有超过官方资料的独有价值。
- `mindrally/skills@chrome-extension-development`：虽可用，但两项已选 Skill 已覆盖所需范围，继续安装只会增加冲突指导。

## 8. 最终建议

可以进入开发，但按以下顺序降低风险：

1. 先建立零网页读取权限的 WXT MV3 壳和完整 extension page。
2. 再抽共享 runtime，并让 Web/PWA 与扩展双构建、双测试。
3. 完成本地文件转换工作台；此时扩展已经具备可上架的独立价值。
4. 最后对右键网页图片做独立 spike。只有精确 origin 权限、无凭据 fetch、资源边界和跨站失败 UX 全部通过，才把 `contextMenus` 与 optional host permission 加入正式版本。

详细阶段、验收门禁和复审修正见 [Chromium 浏览器扩展开发方案](BROWSER_EXTENSION_DEVELOPMENT_PLAN.md)。
