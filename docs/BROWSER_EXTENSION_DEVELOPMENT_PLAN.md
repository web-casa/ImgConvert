# Chromium 浏览器扩展开发方案

> 当前实现基线（2026-09-05）：侧边栏工作台要求 Chrome / Edge ≥116，网页图片导入仅允许 HTTPS。
> 下文早期调研与 EXT-002 等完成记录中的 Chrome 102、独立标签页和 HTTP 候选是历史方案，
> 已被此基线取代，不能用作当前兼容性、权限或发布声明。

> 方案日期：2026-09-03
>
> 状态：EXT-002 至 EXT-010 已实现并复审；EXT-009 的生产隐私发布和最终冻结仍受外部门禁约束；禁止上传、提交或发布
>
> 目标平台：Google Chrome、Chromium 版 Microsoft Edge；Manifest V3

## 1. 最终决策

开发一个真正运行在扩展包内、完全本地处理的 ImgConvert 工作台。工具栏图标默认打开浏览器原生侧栏，侧栏内可打开独立的全屏标签页；同一转换页根据 surface 提供紧凑或完整布局，background 只负责浏览器事件和短事务协调。

首个可发布版本的必需能力：

- 本地拖放和文件选择。
- 复用 Web v1 已验证的 8 类输入与 4 类输出。
- 批量队列、取消、预览、单项与批量导出。
- 中文/英文、浅色/深色、键盘与 375/768/1440 响应式布局。
- 断网首次启动后可用：所有运行代码、Worker、WASM、字体和必要图标均在 ZIP 内。
- Chrome/Edge 两个 vendor build；可用 vendor 浏览器加载 unpacked 目录完成真实 sideload smoke，并分别校验可分发 ZIP。
- 默认在 Chrome/Edge 原生侧栏中工作；浏览器负责侧栏方向和宽度，扩展保证 320–480 px 可用并提供“全屏打开”。

网页图片右键导入是增强能力，不是本地转换基础能力的阻塞项。EXT-005 的安全/权限 spike 已进入 manifest；EXT-008 把公开候选收紧为 HTTPS-only；EXT-009 已在当前 build 上重新完成 Chrome for Testing 152 与 Microsoft Edge Stable 152 的真实 Allow/Deny 验收。生产隐私页仍是最终冻结前唯一未通过的工程证据门禁。

## 2. 范围与非目标

### 2.1 范围

- Chromium MV3 extension page、action、background service worker。
- WXT + Svelte，与项目当前 TypeScript/pnpm/Vitest/Playwright 工具链集成。
- 复用 `@imgconvert/conversion-contract`、`@imgconvert/web-image-engine`，抽出共享 codec/Worker runtime。
- Chrome Web Store 与 Microsoft Edge Add-ons 可审核 ZIP、双语素材、权限理由和隐私声明。
- 右键网页图片的精确 origin 可选权限方案与失败回退。

### 2.2 非目标

- Firefox、Safari、移动浏览器扩展。
- 用 iframe 或重定向包装现有 `/convert/`。
- 把转换委托给 Cloudflare、第三方 API 或桌面 Native Messaging。
- `<all_urls>` required host permission、网页常驻 content script、网页 DOM 修改。
- background/offscreen 中的长耗时转换或 keepalive 心跳。
- 自动收集 analytics、错误遥测、浏览历史、网页内容或用户文件名。
- 首版剪贴板写入、系统通知、自动无提示下载或新标签页替换。

## 3. 产品交互

### 3.1 核心路径

```text
工具栏 ImgConvert 图标
       │
       └── 打开/关闭浏览器原生 Side Panel
                                      │
                         “全屏打开” ──┴──► 独立 converter 标签页
                                      │
                         拖放/选文件 ─┤
                                      ▼
                              右侧 sticky 队列
                                      │
                            设置 ─► 转换 ─► 下载
```

- 不配置 popup。background 使用 `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`，工具栏图标直接切换原生侧栏。
- 浏览器决定侧栏在左还是右及其实际宽度；扩展不能强制“右侧 25%”，只对约 320–480 px 做完整响应式保证，用户可拖动浏览器分隔线调整。
- 侧栏头部的“全屏打开”使用打包内 `converter.html?surface=full`；两个 surface 共享偏好但不复制文件队列，避免把图片、Blob 或结果写入持久存储。
- 页面沿用当前 Web 转换器的 Softlab 米黄色/绿色 token、胶囊步骤导航、卡片/表单层级和品牌语言；去掉 PWA 安装/更新面板，增加“浏览器扩展，本地处理”的紧凑状态说明。
- 转换页不是官网壳：引擎、worker、codec 和导出逻辑都来自扩展自身资源。

### 3.2 右键导入候选路径

```text
用户右键图片 → “在 ImgConvert 中转换”
       │
       ├── background 校验 scheme/descriptor 长度
       └── 在用户手势仍有效时打开 Side Panel，再写入 storage.session
                    │
                    ├── https → 展示图片 origin 与权限用途
                    │               └── 用户点击“允许读取这张图片”
                    │                           ├── 同意精确 origin permission
                    │                           └── 拒绝 → 提示先保存再导入
                    └── data/blob/受限或私有网络地址 → 明确回退
                                      │
                                      ▼
                        工作台消费 descriptor 后立即删除
                                      │
             有界无凭据 fetch → MIME + magic/container probe → 队列
```

该功能不提供“任意网页都成功”的保证。商店与 UI 使用“支持浏览器允许读取的网页图片；不支持时可先保存再导入”的真实表述。

## 4. 技术架构

```text
browser-extension/ (WXT + Svelte + MV3)
  ├── action/background ─── 只处理 Side Panel、事件与一次性 descriptor
  └── converter page ────── side-panel/full 两种 responsive surface
        ├── ImgConvert UI/state
        ├── Serial scheduler
        ├── Raster Worker ──┐
        ├── SVG Worker ─────┼── @imgconvert/web-conversion-runtime
        ├── PDF Worker ─────┘       │
        ├── Archive Worker ──────────┤
        └── export adapter           ├── conversion-contract
                                     └── web-image-engine

web-app/ (Vite + Svelte + PWA)
  └── existing UI + thin worker entrypoints ──► 同一 shared runtime
```

### 4.1 建议目录

```text
packages/
  conversion-contract/
  web-image-engine/
  web-conversion-runtime/       # 新增；codec adapters 与 UI 无关 Worker 执行函数
web-app/
  src/lib/*-codec.worker.ts     # 缩成 Vite 消费端薄入口
browser-extension/
  entrypoints/
    background.ts
    converter/
      index.html
      main.ts
      App.svelte
  src/
    runtime/
      worker-factories.ts
      workers/
        raster-codec.worker.ts
        svg-codec.worker.ts
        pdf-codec.worker.ts
        archive.worker.ts
    lib/import-descriptor.ts
    lib/preferences.ts
    lib/extension-api.ts
  public/icons/
  wxt.config.ts
```

不要建立新的通用 UI package 作为前置依赖。第一版可以在扩展中适配 Web 工作台组件；只有当两个消费者的 API 已稳定且重复持续存在时，再抽纯 UI 组件，避免将 PWA、网站导航或 extension API 互相带入。

### 4.2 Runtime 抽取原则

- `web-conversion-runtime` 不依赖 Svelte、WXT、Chrome API、PWA API 或路由。
- codec npm 包只在 runtime package 声明并精确锁版本，Web app 不再私有持有第二份实现。
- runtime 导出构建器无关的 worker runner/adapter；Vite 和 WXT 各自保留最薄的 `self` 接线与 `new Worker(new URL(...))` 资产入口。
- 先做 Vite/WXT 双构建 spike，确认 `?url`、WASM、PDF worker 和动态 import 的最终 URL 都是 `chrome-extension://<id>/…` 或 `extension://` 内资源，再迁移生产代码。
- 迁移每个 Worker 后立即运行现有 Web 单元/E2E，不能等三个转换 Worker 与归档 Worker 全迁完才发现 PWA 回归。
- extension page 内部加载的 WASM 不声明为 `web_accessible_resources`；只有网页上下文必须读取的资源才允许列入，而当前方案没有这种需求。

### 4.3 Background 边界

允许：

- 顶层同步注册 `runtime.onInstalled`、`contextMenus.onClicked`，并配置 action 点击切换 Side Panel。
- 在右键图片的原生用户手势内打开 Side Panel。
- 校验并写入长度受限、带 nonce/版本/创建时间的 pending descriptor。
- 对安装/更新执行小型、版本化设置迁移。

禁止：

- 解码、编码、PDF/SVG 渲染、ZIP 或图片字节转发。
- 持有队列/进度全局状态。
- keepalive alarm、空 port 消息、定时 ping。
- 接受任意扩展页面消息后按其 URL 做高权限 fetch。
- 读取或持久化普通网页的 title、history、cookie 或完整页面内容。

## 5. Manifest 与数据预算

### 5.1 基础版本 manifest

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "sidePanel"],
  "action": {},
  "side_panel": { "default_path": "converter.html?surface=side-panel" },
  "background": {
    "service_worker": "...",
    "type": "module"
  }
}
```

实际文件由 WXT 生成，以上只是必须由测试锁定的语义，不手写猜测输出路径。

### 5.2 右键功能通过后允许增加

```json
{
  "permissions": ["storage", "contextMenus", "sidePanel"],
  "optional_host_permissions": ["https://*/*"]
}
```

background 的 context-menu handler 不直接弹权限框。它只打开工作台；工作台解释权限用途后，在用户再次点击时向 `permissions.request()` 传入 descriptor 对应的精确 HTTPS origin pattern。context menu 还必须用 `documentUrlPatterns` 与 `targetUrlPatterns` 同时限定 HTTPS 页面和 HTTPS 图片。若 Chrome/Edge 的真实行为不能稳定支持这种请求，删除右键远程导入，而不是退回 required `<all_urls>`。

右键导入还必须满足：

- fetch 只在可见 converter page 执行，并固定 `credentials: "omit"`、`cache: "no-store"`、`referrerPolicy: "no-referrer"`。
- URL 只来自真实 context-menu 事件产生的一次性 descriptor；普通 runtime message 不能触发任意 URL fetch。
- 拒绝 browser/file/filesystem/data/blob/未知 scheme，以及 localhost、loopback、link-local 和 private-network literal host；所有 redirect 直接回退，不跟随第二个地址。
- 远程响应执行 Content-Length 预检和 streaming hard limit；图片 bytes、base64 或响应片段绝不写入扩展存储。
- 下载后的 bytes 仍走现有 MIME/magic/container probe 和资源预算，不能信任响应头、后缀或网页提供的尺寸。

### 5.3 存储

| 区域                   | 允许内容                                                                           | 禁止内容                                   |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| `storage.local`        | schema version、语言、主题、默认输出、质量/缩放等有界偏好                          | 图片、文件名、缩略图、结果、网页 URL、历史 |
| `storage.session`      | 一个按窗口、带 TTL 的 pending import descriptor；升级时兼容清理旧 converter tab ID | 图片 bytes/base64、长期历史、转换队列      |
| `storage.sync`         | 不使用                                                                             | 全部                                       |
| IndexedDB/CacheStorage | 首版不使用                                                                         | 转换输入/输出和持久 cache                  |

初始化时把 `storage.local` 的 access level 收敛为 `TRUSTED_CONTEXTS`，避免未来误加 content script 后自动暴露偏好。卸载由浏览器清理 extension storage；设置页还应提供“清除本地偏好”，并验证所有受控 key 均被删除。

### 5.4 CSP 与代码

- extension page CSP 仅允许 self 与本地 WASM 所需的 `wasm-unsafe-eval`；不允许 `unsafe-eval`、inline script 或远程 script。
- 构建产物扫描 `http(s)://`、`eval`、`new Function`、动态远程 import 和 source map 泄漏；图片 fetch 代码中的允许 scheme/测试 fixture 必须显式白名单。
- 所有 JS/WASM/Worker、字体和图标随 ZIP；不从 ImgConvert 网站加载运行时配置或 codec。
- 生成 SBOM/第三方许可证和 WASM SHA-256，复用现有 npm license policy；WXT 与新增依赖必须精确版本并进入 audit。

## 6. 工作项与验收

| ID                      | 工作项                               | 依赖                        | 主要交付                                                                           | 退出条件                                                                                                                                    |
| ----------------------- | ------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| EXT-001                 | 调研、Skills 与审定方案              | WEB-011                     | 本调研、开发方案、项目级 Skills                                                    | 文档复审与格式/链接/工作区检查通过                                                                                                          |
| EXT-002（已完成并复审） | WXT Chromium 壳与 manifest guardrail | EXT-001                     | `browser-extension/`、action/background、converter 空壳、Chrome/Edge build         | Chrome/Edge unpacked 目录通过可用 vendor sideload；两个 ZIP 结构通过；基础 manifest 只有 `storage`；无 popup/content script/host permission |
| EXT-003（已完成并复审） | Shared runtime 抽取与双构建          | EXT-002                     | `web-conversion-runtime`、四个薄 Worker 入口、资产检查器                           | Web 全量回归；扩展 8 输入 × 4 输出与归档 smoke；全部资产为扩展内 URL                                                                        |
| EXT-004（已完成并复审） | 本地转换工作台                       | EXT-003                     | 导入、队列、设置、进度、取消、预览、下载、双语/主题                                | Chrome/Edge 实际 UI 完成批量转换；刷新/关闭提示、键盘和响应式通过                                                                           |
| EXT-005（已完成并复审） | 右键网页图片安全 spike               | EXT-004                     | context menu、optional origin permission、pending descriptor、有界 fetch、fallback | Chromium 安全矩阵与本地转换回归通过；Edge 原生提示框保留为 EXT-007 vendor gate                                                              |
| EXT-006（已完成并复审） | 更新/迁移、包体与离线                | EXT-004，按结果吸收 EXT-005 | storage migrations、bundle report、断网启动、版本升级 smoke                        | 更新不丢偏好、不保留内容；无远程代码；包体预算通过                                                                                          |
| EXT-007（已完成并复审） | Chrome/Edge 自动化与综合 review      | EXT-006                     | Playwright persistent-context、vendor smoke、安全/无障碍 review                    | 当前 vendor stable + 选定最低版本矩阵通过；权限/网络/资源/恢复无阻塞发现                                                                    |
| EXT-008（已完成并复审） | 商店素材与发布草稿                   | EXT-007                     | Chrome/Edge ZIP、SHA-256、双语 listing、隐私/权限说明、真实截图                    | 两个商店草稿材料齐全；未经用户明确授权不公开提交或发布                                                                                      |
| EXT-009（流水线已完成） | 发布前验收与候选冻结                 | EXT-008                     | 生产依赖、隐私部署、双 vendor Allow/Deny、结构化最终证据                           | 所有证据绑定当前包/lock/deployment；当前生产隐私未通过，因此 fail closed 且不生成最终冻结证据                                               |
| EXT-010（已完成并复审） | Side Panel 与 Web 视觉统一           | EXT-009                     | 原生侧栏入口、全屏选择、Softlab 双 surface、窗口绑定 handoff                       | Chrome/Edge 构建门禁通过；400 px 侧栏无横向溢出；全屏切换、离线转换、键盘与 axe 通过                                                        |

预计工程量：10–15 人日，不含商店人工审核等待。旧方案的 6–8 人日遗漏了 runtime 抽取、网页图片权限 spike、两个 vendor 包和商店材料，已在复审中修正。

### 6.1 EXT-002 完成记录（2026-09-03）

- 使用 WXT 0.21.4、Svelte 5.56.4、Manifest V3；扩展 workspace 明确要求 Node 22.13+。
- action 无 popup；同步注册 background listeners。每个窗口仅在 `storage.session` 保存自己创建的 converter tab ID，通过 ID 创建/聚焦，不读取 URL、title 或网页内容。
- 基础 manifest 只有 `storage`，最低 Chrome 版本依据 `storage.session`/`setAccessLevel` 官方 API 固定为 102；无 `tabs`、`activeTab`、content script、host/optional permission、offscreen、downloads 或 web-accessible resources。
- Chrome/Edge unpacked 产物各 84.63 KiB，background 1.84 KiB；两个 vendor ZIP 各 56.25 KiB，均与 unpacked 文件清单逐项一致。
- Chromium 149 已真实加载 `chrome-mv3`，确认 MV3 service worker、converter 页面与 0 个 HTTP(S) 请求。当前 Linux 主机没有 Edge，Edge 原生 smoke 保留到 EXT-007 的 Windows/vendor 矩阵；Edge manifest、静态门禁与 ZIP 已本地通过。
- 工作台使用现有米黄色/绿色 token、中英文、明暗主题、375/768/1440 响应式结构和右侧队列，但明确显示“转换引擎待接入”，不把 EXT-002 空壳描述成已完成转换功能。
- `CHROMEWEBSTORE.md` 已建立且标记为 **DO NOT SUBMIT**；真实转换、隐私页扩展段落、真实截图与 vendor 矩阵完成前不得提交。

### 6.2 EXT-003 完成记录（2026-09-04）

- 新增 UI/WXT/PWA 无关的 `@imgconvert/web-conversion-runtime`，统一持有精确锁定的 raster、SVG、PDF 与 ZIP 依赖、文件名规则、归档协议/调度器和四个 Worker 执行函数。
- Web app 的四个 Worker 文件缩为 `self` 注册薄入口；扩展通过静态 `new Worker(new URL(...), { type: "module" })` 工厂消费同一实现，没有跨 package 深层导入 Web UI。
- 普通扩展页面首屏仍不加载 Worker、WASM 或诊断模块；内部查询参数诊断入口仅用于 unpacked smoke，完成 JPEG/PNG/WebP/AVIF/BMP/GIF/SVG/PDF × 四种输出及 32 项 ZIP 归档验证，不向用户展示未完成的工作台能力。
- Chrome/Edge manifest 都保持只有 `storage` 权限、无 host/content script/WAR，并使用只允许本地脚本与本地 WASM 的 MV3 CSP。两份 unpacked 产物各 27 个文件、12,127,527 bytes；ZIP 各 3,825,749 bytes，均通过资产引用、远程代码、初始 bundle 和总包体门禁。
- Chromium 149 已真实加载 Chrome unpacked 产物，确认普通首屏 codec-lazy、0 个 HTTP(S) 请求，并通过 8 × 4 转换与 32 项 ZIP smoke。当前主机没有 Edge binary，因此 Edge 只完成独立 build/manifest/ZIP 门禁，原生 Edge smoke 仍是 EXT-007 外部验收项。
- Web 单元、构建及三浏览器 E2E 全量回归通过；其中 E2E 为 76 passed、2 个基于浏览器能力的预期 skipped。Kimi 调整后的 UI 所有权、导航/页脚和右侧 sticky 队列均保持不变。
- 扩展 UI 仍明确显示转换引擎尚未接入；真实导入、队列、设置、预览和下载属于 EXT-004，`CHROMEWEBSTORE.md` 继续保持 **DO NOT SUBMIT**。

### 6.3 EXT-004 完成记录（2026-09-04）

- 可见工作台已接入 shared runtime，支持文件选择、拖放和图片文件粘贴；队列探测、格式签名、文件/字节/像素预算与 Web 版共用同一实现。
- 桌面布局保持右侧 sticky 实时队列；窄屏在导入后立即放置队列，再进入设置与转换。中英文、浅色/深色、键盘焦点、原图/结果预览、单项下载、批量 ZIP、失败 manifest 和未下载结果离页提示均已实现。
- 队列、文件名、Blob、缩略图与结果只存在于当前 extension page 内存；刷新后清空。`storage.local` 只保存一个最大 4 KiB、schema version 1 的语言/主题/转换偏好项，清除时同时删除版本 metadata，且访问级别继续限制为 trusted contexts。
- 真实 Chromium 149 unpacked smoke 通过两张 PNG 的 UI 批量转换、原图/结果预览、WebP/PNG/ZIP 下载签名、BMP→AVIF 取消后重试为 PNG、未下载结果离页保护、偏好恢复与彻底清除、内容不落盘、刷新清队列与 375 px 顺序检查，并继续通过 8 输入 × 4 输出 + 32 项 ZIP runtime 矩阵；全过程 0 个 HTTP(S) 请求。
- Chrome/Edge 构建仍只有 `storage` 权限，无 host/content script/WAR/offscreen/popup/downloads 权限；初始 converter JS + CSS 约 201 KiB，unpacked 约 12.20 MB，均在预算内。Linux 主机没有 Edge binary，Edge 原生交互仍保留到 EXT-007 vendor gate。
- `CHROMEWEBSTORE.md` 继续保持 **DO NOT SUBMIT**：EXT-005/006、官网隐私扩展段落、真实商店截图与 EXT-007 vendor 验收尚未完成。

### 6.4 EXT-005 完成记录（2026-09-04）

- manifest 新增必需的 `contextMenus` 和候选 `optional_host_permissions`（EXT-008 商店复审后仅保留 `https://*/*`）；没有 required host permission、content script、`tabs`、`activeTab`、`scripting`、offscreen、downloads 或 WAR。
- 右键菜单当前只出现在 HTTPS 页面中的 HTTPS 图片上下文。background 只根据原生事件生成每窗口一个、最大 8 KiB、TTL 两分钟的版本化 descriptor；工作台通过仅接受自身 converter URL 的消息端点进行破坏性领取，并由 per-key lock 保证并发领取最多成功一次。
- `data:`、`blob:`、file/browser scheme、内嵌账号、直接 IP、单标签与已知本地/非公开后缀不会保存原 URL/bytes，只显示本地文件回退。DNS 重绑定无法由扩展字符串校验完全证明，因而没有把该风险写成“完全防御”；请求仍受显式 host prompt、无凭据、无跳转和无数据外传边界限制。
- 可见工作台按钮同步发起精确 canonical scheme/host/显式端口权限请求；只执行一次 `GET`，固定 `credentials: "omit"`、`referrerPolicy: "no-referrer"`、`cache: "no-store"`、`redirect: "manual"`，20 秒超时并以 Content-Length + streaming 双重限制 32 MiB。读取后的内存 `File` 继续走 shared runtime 的 magic/container/pixel/safety probe。
- 新授权在读取结束后立即移除并复查；预先已有的用户授权不会被扩展擅自撤销。原生授权期间取消/替换任务后会在 fetch 前再次检查 nonce，并先撤销刚获得的授权，避免已取消任务仍联网。
- 复审修复 Chrome 102 兼容性：`contextMenus.removeAll/create` 使用 callback 且在 callback 内检查 `runtime.lastError`，不依赖 Chrome 123 才支持的 Promise 返回；缺失有效 `windowId` 的事件直接失败，不建立可能被其他窗口领取的模糊 handoff。
- Chromium 149 的真实 Allow smoke 证明：授权前 0 请求；不提供 CORS 响应头的跨源 fixture 在精确 host permission 下只产生一个 GET；服务端未收到 Cookie、Authorization 或 Referer；PNG 进入既有队列，descriptor 消失且新权限被移除。真实 Deny smoke 证明 0 请求、0 残留权限；普通本地文件 smoke 继续保持 0 HTTP(S) 请求。
- Chrome/Edge 两份产物各 27 文件、12,228,693 bytes；background 3.99 KiB，初始 converter JS + CSS 约 219 KiB，均在既定预算内；两个结构一致的 vendor ZIP 各 3,857,719 bytes。48 项最终单测、TypeScript/Svelte、ESLint、Prettier、双 vendor build/ZIP 和静态 guardrail 通过。Linux 主机无 Edge binary，Edge 原生 Allow/Deny 行为不作未验证宣称。
- `CHROMEWEBSTORE.md` 已同步真实权限与数据用途，但仍为 **DO NOT SUBMIT**：EXT-006、官网隐私段落、素材与 EXT-007 vendor 验收尚未完成。

### 6.5 EXT-006 完成记录（2026-09-04）

- 偏好 payload 继续使用产品 schema version 1，不为里程碑虚构业务字段；WXT storage container 升到 version 2，并通过声明式 migration 把既有有效设置规范化为严格白名单。`files`、`history`、`sourceUrl` 等额外字段会被物理移除，损坏记录 fail closed 为不含内容的默认值。
- 偏好迁移在 background 与 converter 启动时幂等执行；`runtime.onInstalled` 明确区分 `update`，只在扩展版本更新时额外清除 `imgconvert.converterTab.*` 与 `imgconvert.pendingImport.*`。安装、浏览器更新、权限和未知 local/session key 不被误清。
- 新增同 profile、同绝对路径、同扩展 ID 的 Chromium 0.3.0→0.3.1 upgrade smoke：保留中文、深色、JPEG、质量、尺寸等有效偏好，storage metadata 升至 v2，多余内容字段消失，未知 local key 保留，当前页面 0 个 HTTP(S) 请求。命令行 sideload 会缓存 legacy service-worker registration，故 update 事件调度与精确 session 清理由 5 项生命周期/清理单测独立覆盖，不伪称该 runner 已复现商店更新事件。
- 新增 fresh-profile offline smoke：在打开工作台前设置 Chromium context offline，仍完成可见双 PNG 转换、预览、WebP/PNG/ZIP 下载、取消/重试、375 px 布局，以及 JPEG/PNG/WebP/AVIF/BMP/GIF/SVG/PDF × 四输出和 32 项 ZIP runtime matrix。
- Chrome/Edge guardrail 现在生成 `.output/reports/<vendor>-bundle.json`，记录 manifest、预算余量、background 可达的静态/动态本地 JS 图、converter 首屏资产，以及每个文件的 bytes/SHA-256。复审修复了旧门禁只统计 `background.js`、可通过拆 chunk 绕过 100 KiB 预算的问题。
- 最终两份 unpacked 产物各 28 文件、12,231,234 bytes；background 完整 JS 图 35,596 bytes，converter 初始 JS + CSS 224,970 bytes，均低于 100/500 KiB；两份 ZIP 各 3,859,704 bytes，低于 8 MiB 且文件清单逐项一致。63 项扩展单测、TypeScript/Svelte、ESLint、Prettier、双 vendor build/guardrail/ZIP 通过。
- 当前 Linux 主机仍没有 Edge binary；本阶段只证明 Edge 源码、manifest、包体报告和 ZIP 与 Chrome 静态一致，不把 Chrome 结果冒充 Edge 原生 offline/update 验收。该 vendor gate 保留给 EXT-007。

### 6.6 EXT-007 完成记录（2026-09-04）

- Smoke harness 现在分别记录构建目标、可执行文件路径与 `--version`、浏览器 runtime brand/major、构建文件数及 SHA-256 fingerprint；Chrome、Chromium、Edge 不再互相冒充。EXT-007 受测 build fingerprint 为 `dc36d5d30f1d4baeb55ab8220c480f67e76a9b92e0824621addc95cbe0a7f9f1`。
- 最低版本实测使用 Chromium 102.0.5005.40，完整通过 fresh-profile offline、可见工作台、375 px 布局、键盘、明暗主题、axe、8 输入 × 4 输出（含 PDF）及 24 MP 转换/回收。为兑现 manifest 的 Chrome 102 下限，WXT/Vite JS/CSS target 固定为 `chrome102`，PDF.js 改用官方 legacy build，并只为两个 PDF worker realm 补足 `Promise.withResolvers`。
- 当前 vendor 实测使用 Google Chrome for Testing 152.0.7977.82 与 Microsoft Edge Stable 152.0.4191.62；两者均通过与最低版本相同的完整功能、离线、无障碍和 24 MP 资源矩阵。测试在 ARM64 主机上的隔离 amd64 容器中运行，因此资源结果是功能/上限压力证据，不冒充原生硬件性能基准。
- 24 MP smoke 生成并转换精确的 6000 × 4000 PNG，校验下载签名与尺寸、移除/刷新后队列和 storage 无残留，并强制浏览器进程树至少回收 128 MiB、相对基线残留不超过 192 MiB。复审据此修复了队列自动解码全尺寸大图的问题：解码表面超过 16 MiB 时保留格式占位，显式预览仍可用。
- Chrome 与 Edge 均显示真实 optional-host 原生提示。Allow 各只产生一次 GET，服务端未收到 Cookie、Authorization 或 Referer，入队后新授权被移除；Deny 各保持零请求、零残留权限。测试夹具使用浏览器启动参数隔离映射的专用 hostname，不禁用 TLS、CORS、Private Network Access 或重定向保护。
- 可访问性覆盖 skip link、真实键盘导航、对话框 Escape/焦点恢复、375 px 无溢出、明暗主题 axe 扫描和关键 token 的 4.5:1 对比度门禁。复审修复 Chrome 102 的 `:has()`/`color-mix()` 降级、range media query 输出、无语义元素上的 `aria-label`，以及深色错误文本对比度。
- 安全复审确认 manifest 在 EXT-008 商店复审后只有 `storage`、`contextMenus` 与运行时精确请求的 optional HTTPS host candidate；无 content script、required host、remote code 或内容持久化。字符串校验会拒绝 literal/已知本地主机以及 `nip.io`、`sslip.io`、`localtest.me`、`lvh.me`、`vcap.me` 等已知私网映射别名，但不能证明任意公共 hostname 的最终 DNS 地址或消除 DNS rebinding；这是已披露的残余风险，不写成“完全阻断私网”。
- 8×4 codec runtime diagnostics 改为独立 diagnostics build；正式 Chrome/Edge/store 包在编译期移除查询参数触发器和 diagnostics module，生产 guardrail 会扫描并拒绝两类标记。
- 最终两份 unpacked 产物各 28 文件、11,300,446 bytes；background 完整图 35,656 bytes，converter 首屏 JS + CSS 225,835 bytes，均通过 100 KiB/500 KiB/16 MiB 预算。EXT-007 不部署、不创建商店记录、不上传、不提交审核，也不开始 EXT-008。

### 6.7 EXT-008 完成记录（2026-09-04）

- 商店安全复审把 manifest、context menu、descriptor、UI 和测试从 optional HTTP(S) 收紧到 HTTPS-only `https://*/*`；Chrome 数据表单保守披露 Web history（仅用户明确选择的 URL/来源）与 Website content（本地文件和所选图片），不把“本机处理”误写成“未处理数据”。
- Chrome 与 Edge 双语 listing、单一用途、逐项权限说明、remote-code 回答和 reviewer notes 已按真实功能完成；四个隐私来源同步扩展专属的内存处理、本机偏好、两分钟 session handoff、精确主机二次确认、无凭据/无来源页、拒绝跳转、32 MiB 上限、权限清理与 Limited Use 说明。
- `browser-extension/store/assets/v0.3.1/` 包含 128×128 Chrome icon、300×300 Edge logo、440×280/1400×560 无文字 promo，以及英文/中文各 5 张从实际 packaged Chrome UI 完成本地转换后截取的 1280×800 图片；`provenance.json` 绑定 browser/build/source/asset 哈希。视觉复审进一步修复了 sticky header 顶部空隙透出滚动残字的问题，并重新构建、截图和冻结证据。
- `pnpm extension:store:prepare` 可重建双 vendor、生成并校验 ZIP、真实截图、许可证、SHA256SUMS、文件清单、manifest 语义比较和 local-only release evidence。最终两个 ZIP 各 28 文件、3,779,726 bytes，当前 SHA-256 均为 `2867bfdb27e51d1566ec93bb03bf5f78c080bbf77f51bc16123e81460db978a8`；相同哈希源于两个独立 vendor build 的最终 payload 完全一致，不合并商店渠道。
- 最终扩展检查为 14 个测试文件 / 64 项测试，双 unpacked 产物各 11,292,157 bytes；Chromium 149 离线 smoke 通过 8×4 runtime、下载/预览/取消/偏好/375 px、skip link、键盘焦点及明暗主题 axe，0 violations，0 远程请求。Web engine 61 项、shared runtime 19 项、Kimi 调整后的 Web app 23 项/构建、官网构建、根 135 项测试和类型/Lint/Knip/格式/架构/文档/许可证门禁均通过。
- 本阶段没有建档、上传、提交或发布。发布前仍需账号所有者确认 publisher/联系邮箱，部署并复验隐私 URL，在冻结 HTTPS-only 候选上完成人机交互的原生 Chrome/Edge Allow/Deny vendor smoke，并在 npm audit endpoint 可用时完成生产依赖审计；当前端点返回 HTTP 500 后超时，不能声称零漏洞。

### 6.8 EXT-009 实施与门禁记录（2026-09-04）

- Web-import 报告升级为 schema 2，脱敏记录 Allow/Deny、请求数量/方法/路径、三类敏感请求头、队列准入、descriptor 消费和权限清理；最终化同时核对 vendor identity、expected major 和当前构建 fingerprint。
- Chrome for Testing `152.0.7977.82` 与 Microsoft Edge Stable `152.0.4191.62` 分别运行当前 HTTPS-only build 的原生 Allow/Deny。四项均通过：Allow 各 1 次无 Cookie/Authorization/Referer 的 GET，导入后无权限残留；Deny 各 0 请求、0 残留。
- 生产依赖审计按当前 lockfile 枚举扩展精确生产图（24 包），同时使用 canonical npm audit 与 OSV querybatch；npm 端点不可用时只有受控超时且 OSV 为零才可通过。全仓开发图的 `extract-zip@2.0.1` 版本级 symlink traversal 告警仅来自 WDIO/Puppeteer 开发链，已用 pnpm patch 加固并由恶意 ZIP 回归测试证明越界链接被拒绝。
- 双语隐私页已部署到隔离 Cloudflare Preview `1b56e7bc-e242-4c6f-bcff-78df25519ca6`，真实 Chromium 校验 HTTPS 200、CSP、nosniff、referrer policy 与可见扩展披露均通过。生产 deployment `3d3e7ff0-899b-4230-929d-91e503c08832` 两页虽为 HTTPS 200 且安全头通过，但仍缺扩展披露。
- 没有把整个 Web converter 越过既有移动 Safari/Android Chrome 真机门禁发布到生产，也没有部署会制造 `/convert/` 死链的 website-only artifact。最终化脚本会先重跑商店草稿检查，再核对当前 ZIP、文档、lockfile、四项 vendor 报告和 production-only 隐私报告；当前必须失败且不写 `final-evidence.json`。
- 本阶段未创建商店记录、上传 ZIP、提交审核或公开发布。即便生产隐私门禁通过，publisher/联系邮箱确认与所有 dashboard 状态变更仍需用户单独授权。

### 6.9 EXT-010 Side Panel 与视觉统一记录（2026-09-04）

- 用户的新交互要求取代了“首版不做 Side Panel”的旧边界：manifest 增加最小 `sidePanel` 权限与 `converter.html?surface=side-panel`，action 使用浏览器原生 `openPanelOnActionClick` 行为，不再自行创建或聚焦普通标签页。
- Side Panel API 的可用下限使 `minimum_chrome_version` 从历史候选的 102 提升到 116；Vite/CSS target、最低版本脚本、构建门禁和发布证据下限同步更新。Chromium 102 的旧报告只保留为历史功能证据，不能再代表当前 manifest。
- 右键图片处理顺序改为在 context-menu 用户手势仍有效时先调用 `sidePanel.open()`，随后写入一次性 descriptor；claim 消息携带经严格验证的窗口 ID，并在普通标签页 sender 存在时要求二者一致，从而兼容全局侧栏没有 `sender.tab` 的情况。
- 扩展与 Web 转换器统一为当前 Softlab 视觉系统：相同的奶油纸色/品牌绿 token、胶囊步骤导航、柔和卡片、居中导入区、右侧 sticky 队列和响应式表单。侧栏在 400 px 采用单列“导入 → 队列 → 设置 → 转换”，全屏保持双列工作台。
- 侧栏头部提供“全屏打开”并明确其为独立内存会话。浏览器 API 不允许扩展强制侧栏固定在右侧或精确占 25%，因此由用户在浏览器设置与拖拽分隔线决定；扩展只保证 320–480 px 的内容可用性。
- 复审修复 background 偏好迁移的 Service Worker 兼容性：原动态 `import()` 会让 Vite 注入依赖 `document`/`window` 的 module-preload helper，导致启动时出现 `ReferenceError: document is not defined`。迁移现改为静态 DOM-free 依赖，构建门禁拒绝 background 再次出现 `__vite__mapDeps`；该修复作为浏览器扩展独立补丁版本 0.3.2，不牵动仍处于 0.3.1 发布线的桌面应用。同 ID 0.3.1 → 0.3.2 upgrade smoke 已验证偏好迁移、敏感字段清理与零远程请求。
- 当前 Chromium 149 生产 build 已验证 `getPanelBehavior()`、默认 path、320/400/480 px 零横向溢出、全屏链接、fresh-profile offline、两文件转换/预览/WebP/ZIP、取消重试、偏好清理、375 px、键盘路径与明暗主题 axe，0 个远程请求。Chrome/Edge 构建与静态门禁均通过；最终商店冻结仍需重跑当前版本的两套 vendor 原生验收。
- 品牌区与页脚新增官网、本地化文档、隐私政策、桌面版下载和 GitHub 的显式入口；`homepage_url` 同步指向规范官网。入口只在用户点击后以新标签页打开，统一设置 `noopener noreferrer` 与 `no-referrer`，不会增加权限、不会把文件或当前网页上下文带到官网，也不会改变扩展内“全屏打开”的独立工作台行为。构建门禁与 320/400/480 px Side Panel smoke 会校验地址、安全属性和横向边界。

## 7. 测试矩阵

### 7.1 自动化

- Contract/engine/runtime 单元测试：继续覆盖运行时 DTO 校验、probe、限制、状态迁移和错误标量化。
- Manifest snapshot：Chrome/Edge 分别断言 required/optional permissions、CSP、background、action、locale、图标和禁止字段。
- Static bundle audit：无远程代码、无 source map、无宽泛 WAR、无重复 WASM、无网页 content script、无 PWA service worker。
- Playwright persistent context：加载 unpacked extension，验证 Side Panel behavior/path、400 px 布局、全屏切换，以及导入、队列、转换、取消、下载、刷新保护、语言、主题和键盘。
- Worker asset matrix：JPEG/PNG/WebP/AVIF/BMP/GIF/SVG/PDF × JPEG/PNG/WebP/AVIF，复用现有 magic/dimension/alpha/metadata 断言。
- 安全 corpus：伪 MIME、扩展名冲突、超字节/超像素、动画 GIF、外链 SVG、恶意/加密 PDF、损坏输入、oversized result。
- 网络门禁：本地文件路径转换期间不允许 HTTP(S)；右键路径只允许用户授权的精确 HTTPS 图片 origin，断言不带 Cookie、Authorization、Referer 或请求 body。
- 生命周期：background 重启、Side Panel 关闭/重开、全屏独立会话、取消时 terminate、扩展更新/偏好迁移、pending descriptor 超时/重复消费。

### 7.2 右键 spike fixture server

至少覆盖：

- 同 origin 200、缺失/错误 Content-Length、chunked oversize、MIME 欺骗。
- 同 origin redirect、跨 origin redirect、redirect loop。
- `data:`/`blob:` 不落存储的明确回退；`http:` 明确拒绝；`https:` 进入精确来源授权流程；受限 browser 页面明确回退。
- CDN origin 不同于 page origin。
- localhost、IPv4/IPv6 loopback、link-local、RFC1918/private-network literal host，以及 DNS 重绑定不能被简单字符串检查误宣称已完全防御。
- 需要 cookie/auth 的图片，确认不会携带凭据并给出回退。
- 用户拒绝权限、权限被撤回、Edge 与 Chrome prompt 差异。

### 7.3 人工/vendor 验收

- EXT-007 历史矩阵：Chromium 102.0.5005.40、Chrome for Testing 152.0.7977.82、Microsoft Edge Stable 152.0.4191.62 均真实加载当时对应的 unpacked build，并完成下载和 24 MP smoke；其中 Chrome/Edge 的 HTTP(S) Allow/Deny 结果不能替代当前 HTTPS-only 冻结候选的权限提示复验。
- EXT-009 当前候选：Chromium 149 的离线、功能、键盘与无障碍自动化继续通过；Chrome/Edge 152 原生 Allow/Deny 四项已绑定当前 fingerprint 并通过。
- Chrome/Edge vendor 行运行于隔离的 Linux amd64 环境；正式商店候选仍应在目标 Windows/macOS/Linux 真机做安装与视觉抽查，资源数字不得作为原生硬件 benchmark。
- 当前最低版本由 Side Panel 交互所需的 Chromium 116 API 下限确定；Chromium 102 只保留为 EXT-007 旧版候选的历史证据。最终冻结前必须补跑 Chromium 116 的当前构建，不以 Chromium 149 或单一 vendor 结果反推。
- 128 × 128 图标在明暗工具栏、扩展管理页和商店页检查视觉重量。
- 真实 1280 × 800 扩展截图，确认没有桌面版/Web 版冒充或不可见功能。

## 8. 性能与包体门禁

初始预算不是商店上限，而是本项目自己的回归线：

- background JS：压缩前不超过 100 KiB，且不含 codec/UI。
- converter 初始 JS + CSS：压缩前不超过 500 KiB；PDF、SVG、AVIF 和 archive 资产按功能延迟加载。
- unpacked 总体：以当前 Web v1 约 13 MiB 为基线，新增扩展框架/UI 后不得无解释超过 16 MiB。
- ZIP：每个 vendor build 不得无解释超过 8 MiB；以构建报告和 assets duplication 检查为准。
- 首屏不初始化 codec；第一项实际格式决定加载的 decoder/encoder。
- 24 MP 仍是桌面工程上限而非普遍承诺；Chrome/Edge vendor 进程树 benchmark 必须复验，无真机证据不提高能力文案。

若 WXT 生成物与 Vite 资产策略导致重复 codec/WASM 或超预算，先修 asset graph，不通过减少安全校验或远程加载绕过。

## 9. 商店与发布

### 9.1 两个独立产物

- `imgconvert-chrome-mv3-<version>.zip`
- `imgconvert-edge-mv3-<version>.zip`
- `SHA256SUMS`
- 对每个 ZIP 生成 manifest diff、文件清单、第三方许可和 smoke 记录。

Edge build 不得包含 Chrome Web Store `update_url` 或把产品描述成 Chrome 专属；Chrome/Edge 的 ID、商店 URL 与更新通道不混用。

### 9.2 发布材料

- 单一用途：在浏览器中本地转换用户选择的图片和文档图片页面。
- 权限说明：逐项对应 UI 功能；如果 EXT-005 no-go，商店材料中完全删除 context menu/host permission 描述。
- 隐私：图片与结果不上传、不持久化；偏好本地保存；网页右键只处理用户明确点选的 HTTPS 图片 URL/bytes，精确来源先展示、二次同意后无凭据读取，消费后清除。
- Remote code：No。远程图片是数据，不是代码；全部可执行内容随包提交。
- Support/Privacy URL：复用官网稳定 HTTPS 页面，但增加扩展专属段落后才提交。
- 截图、logo、promo 和双语说明均从实际冻结版本生成并校验尺寸。

EXT-008 只准备并验证草稿；EXT-009 只采集发布前证据并在全部门禁通过后冻结本地候选。创建商店记录、上传、提交审核或公开发布都属于外部状态变更，必须获得用户明确授权。

## 10. 方案复审与修正记录

| 初始假设/风险                                   | 复审发现                                                                             | 最终修正                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| popup 可承载完整转换                            | popup 失焦销毁且空间有限，AVIF/PDF 可长时运行                                        | 不建 popup；action 打开/聚焦完整 extension page                     |
| background/offscreen 负责转换                   | service worker 可终止；offscreen 增权限、单文档且隐藏失败                            | 可见 converter page 持有 Worker；首版无 offscreen、无 keepalive     |
| 右键图片是基础 MVP                              | `srcUrl` 不等于可读取；CDN/blob/auth/redirect 均可能失败                             | 本地文件转换先成为可发布核心；右键作为 EXT-005 可删除 spike         |
| 用 activeTab 避免 host permission               | activeTab 是 page origin 临时授权，图片可能来自另一 origin                           | 不申请 activeTab；只对实际图片 origin 请求 optional host permission |
| `<all_urls>` optional 就足够安全                | 最小权限政策同样审查 optional，运行时仍可能过度请求                                  | manifest 仅声明候选模式；每次只请求精确 origin，拒绝则回退          |
| context-menu handler 中立即请求 host permission | 后台事件是否持续满足权限 API 的用户手势条件需要 vendor 实测，且缺少解释页面          | 右键只打开工作台；用户看到 origin 和用途后再次点击申请              |
| 远程图片可带页面凭据提高成功率                  | cookie/auth 会扩大敏感数据与权限风险                                                 | 始终 `credentials: "omit"`；认证图片明确不支持                      |
| 直接导入 `web-app/src/lib` 最快                 | 跨 package 私有深导入会复制依赖并使 PWA/扩展互相耦合                                 | 抽 `web-conversion-runtime`，双消费者薄入口、逐 Worker 回归         |
| 使用 `storage.sync` 保存偏好                    | 会跨设备传输，且本产品没有必要                                                       | 只用 local/session；绝不存内容或历史                                |
| 扩展可以只打开现有网页版                        | Chrome Web Store 禁止只启动网站且无自身功能的转换器                                  | 完整本地引擎随包；官网只作为帮助/隐私外链                           |
| WXT 支持多浏览器就顺便测试 Firefox              | 用户明确只要 Chrome/Edge，会增加 manifest/UI 分支                                    | 只输出 `chrome-mv3` 与 `edge-mv3`                                   |
| Chrome/Edge 可用同一未经区分 ZIP                | Edge 要求独立审查、字段/品牌/商店通道不同                                            | 同源双构建、双 ZIP、双 smoke、双商店草稿                            |
| `contextMenus` 可统一按 Promise 等待            | `removeAll/create` 的 Promise 支持晚于最低 Chrome 102，create 错误只在 callback 暴露 | 最低版本路径统一使用 callback，并在回调内检查 `runtime.lastError`   |
| 授权返回即可直接读取旧 descriptor               | 用户可能在原生 prompt 期间取消或由新 handoff 替换旧任务                              | 授权后重新核对当前 nonce；过期任务先撤销新权限且不发起 fetch        |
| 原估算 6–8 人日足够                             | 漏掉 runtime 抽取、安全 fetch、vendor 与商店完整性                                   | 修正为 10–15 人日，并设置每阶段退出条件                             |

## 11. 放行标准

只有同时满足以下条件，才能把扩展标记为开发完成：

- EXT-002 至 EXT-008 全部退出条件通过；EXT-009 的 production-only 隐私证据和最终冻结通过；EXT-005 可以明确 no-go，但不能半实现。
- Web/PWA 现有质量和完整 E2E 无回归。
- Chrome 与 Edge vendor smoke 均有真实记录，最低版本和支持范围已写入文档。
- manifest 权限没有未使用项，host access 与商店文案完全一致。
- 所有可执行资产在包内，无远程代码、无宽泛 WAR、无内容出站。
- 包体、内存、24 MP、取消恢复和安全 corpus 门禁通过。
- 双语隐私/权限/商店材料与真实功能一致。
- Chrome/Edge 两个候选 ZIP、SHA-256、许可证和测试记录可复现。

即使以上工程门禁通过，也不会自动公开发布；商店提交与发布等待用户单独授权。

## 12. 下一步

EXT-009 的代码、生产依赖审计、Preview 隐私验收和当前 Chrome/Edge 原生 Allow/Deny 均已完成。下一步先完成 Web 版既有的 iOS Safari 与 Android Chrome 真机门禁，再把同一份已验收构建发布到 production；随后用正式 deployment ID 重跑双语隐私验证并执行最终冻结。账号所有者还需确认两个商店的 publisher/联系邮箱；创建商店记录、上传 ZIP、提交审核或公开发布仍等待用户单独明确授权。
