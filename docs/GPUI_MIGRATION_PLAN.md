# ImgConvert 桌面端 Tauri → GPUI 迁移方案

状态：草案 v0.11（2026-10-18）。阶段 3 前七片已合并 main（含“液态玻璃”视觉方案与“存储与环境情景面板”）；剩余切片的次序见 `docs/DEVELOPMENT_PLAN_2026-10.md`。阶段 0 已通过 G0；阶段 1 代码经 Codex 评审并修复，待 0.3.x 三平台 QA 后关闭 G1。§6 的六项决定已由用户确认，阶段 0 工具已在 Parallels macOS 虚拟机上验证。v0.1、v0.2、v0.3 各经一轮 Codex 只读评审后修订；v0.4 与 v0.5 的改动未再经 Codex 复核。v0.5 依据已安装的 `gpui-kit`、`gpui-kit-design-guides`、`rust-best-practices` 三个 skill 的规范校对。修订点见 §9。本方案是迁移立项文档，不是已验收结论；每个阶段的门槛未通过前不进入下一阶段。

## 0. 决策前提

- 用户已决定迁移到 GPUI。本方案的目标是把迁移做成可控的分阶段工程，而不是再论证是否迁移。
- `AGENTS.md` 的发布完整性规则不变：公开 GitHub Release 必须同时具备 Linux `amd64`/`arm64`、macOS `x64`/`arm64`、Windows `x64`/`arm64` 直发包、浏览器扩展 zip 与合并后的 `SHA256SUMS`，并通过来源校验。Mac App Store 与 Microsoft Store 是独立渠道，其审核状态不是公开 GitHub Release 的前提，也不能用"记录阻塞项"豁免直发包的签名、公证、smoke 和来源证据。
- GPUI 版本在直发包三平台六架构全部达标前，只以 CI 构件和内部测试包形式存在，不进入公开 Release，不走 `github-release-publish.yml`。
- 许可证规则不变：ImgConvert 保持 Apache-2.0，禁止 GPL/AGPL/LGPL 依赖。GitComet（AGPL-3.0）、VisiGrid（AGPL-3.0）、SotF（GPL-3.0）、Frame（GPL-3.0）只参考设计与验收思路，不复制代码或脚本。
- `crates/imgconvert-core`（8,040 行，零 Tauri 依赖）原样保留，不因 UI 迁移改动编解码行为。

## 1. 现状基线（2026-10-12，本地工作树 `release/web-v1-rc-20260903`）

| 部分 | 规模 | Tauri 耦合点 |
|---|---|---|
| `crates/imgconvert-core` | 8,040 行 | 无 |
| `src-tauri/src` Rust 后端 | 16,060 行 | 18 个 `#[tauri::command]`；`convert.rs` 用 `ipc::Channel<BatchProgressEvent>` 作进度出口，发送失败会取消并终止批次（`batch_progress_send_failure_aborts_batch` 测试固定了这一行为）；`preview.rs` 用 `ipc::Response` 返回二进制；`access.rs` 用 `tauri::Url`；7 处 `tauri::async_runtime::spawn_blocking`；`lib.rs` 注册 7 个无条件插件和 1 个由 `updater` feature 控制的插件 |
| Svelte 前端 | 10,466 行；`state.svelte.ts` 2,952 行 | 17 个 invoke 命令；`@tauri-apps/api/{core,window,webview}` 与 dialog/store/updater/process/os/opener 插件；设置加载后执行 `normalizeSettings`（版本迁移、类型归一化、旧覆盖模式转换、预设归一化） |
| 缩略图 | `thumbnail.rs` 263 行 + 前端队列 | 已有并发上限、去重、对象 URL 释放；缺少按内存预算淘汰的 LRU |
| i18n 文案 | en-US 588 行、zh-CN 554 行（TS 对象，含 `{count}` 等插值） | 纯数据 |
| 共享资源 | `src-tauri/icons/*`、`src/lib/assets/app-icon.png` | 前者被 `browser-extension/scripts/check-store-draft.mjs`、`web-app/scripts/generate-pwa.mjs`、`snap/snapcraft.yaml`、`packaging/flatpak/io.github.yeagoo.imgconvert.yml` 引用；后者被 `web-app/src/lib/Header.svelte`、`SiteFooter.svelte` 引用 |
| 发布链路 | 18 个 workflow；`packaging/{appimagehub,aur,flatpak,linux,macos,store-assets,windows}`；`scripts/` 下 22 个发布脚本 | 分四层：构建层依赖 tauri bundler/配置；渠道包装层（MAS PKG、MSIX、Snap、Flatpak、AUR、AppImageHub）部分依赖 Tauri 产物命名；附件归集层（资产 allowlist、来源证据、`SHA256SUMS`）与框架无关但固定了产物名；公开发布层（`github-release-publish.yml`、扩展 finalizer、Snap metadata）与框架无关 |
| 桌面 E2E | `e2e-desktop`（WebdriverIO + tauri-driver） | 完全依赖 WebView |
| 打包后 smoke | `IMGCONVERT_PATH_CONVERT_SMOKE` 与 `IMGCONVERT_PACKAGE_CONVERT_SMOKE` 两个入口在 `main.rs` 进入 GUI 前执行；`scripts/smoke-windows-installers.mjs` 依赖后者；`check-platform-release-guardrails.mjs` 直接读取 `src-tauri/Cargo.toml`、`lib.rs`、`build.rs`、`capabilities/*.json` | 只证明编解码与输出，不证明窗口与输入 |
| 最低系统版本 | macOS 直发 10.13、MAS 12.0；MSIX 清单 `MinVersion=10.0.17763.0`；Windows 直发未显式声明 | 见 §3.2 |
| 安装身份 | WiX `upgradeCode`、每架构 en-US/zh-CN 两个 MSI + 一个 NSIS（NSIS `installMode=currentUser`；MSI 安装范围未核实）、`com.ivmm.imgconvert`、MSIX identity、直发 Linux `ImgConvert.desktop`、Flatpak/Snap `io.github.yeagoo.imgconvert` | 见 §3.6 |

公共 `main` 分支为 15 个 workflow；差异来自本分支新增的扩展与 Windows finalize 工作流。

## 2. 目标架构

```text
ImgConvert/
├── assets/brand/               # 新：图标等共享资源（从 src-tauri/icons 与 src/lib/assets 迁出，先于任何删除）
├── crates/
│   ├── imgconvert-core/        # 不变
│   ├── imgconvert-platform/    # 新：系统能力，依赖 core，不依赖 tauri/gpui
│   │   ├── external_codecs.rs  #   HEIC helper 发现、诊断（与系统 codecs 同 crate，消除互相引用）
│   │   ├── macos_system_codecs.rs / windows_system_codecs.rs
│   │   ├── macos_security.rs   #   security-scoped resource RAII shim（原样移入）
│   │   ├── paths.rs            #   各渠道配置目录解析（§3.5）
│   │   ├── settings.rs         #   设置读写、归一化、备份、原子替换
│   │   └── dialogs.rs          #   FilePicker trait（只定义接口）
│   ├── imgconvert-backend/     # 新：业务服务，依赖 platform + core
│   │   ├── convert.rs / import.rs / preview.rs / thumbnail.rs / result_cache.rs / pdf.rs
│   │   ├── access.rs           #   tauri::Url → url crate
│   │   ├── command_error.rs / environment.rs
│   │   ├── progress.rs         #   ProgressSink trait（§2.2）
│   │   └── service.rs          #   BatchService：任务所有权与生命周期（§2.3）
│   └── imgconvert-i18n/        # 新：rust-i18n 文案
├── apps/
│   └── gpui/                   # 新：GPUI Kit 应用（独立 workspace，按能力拆 crate，见 §2.4）
│       ├── crates/shell/       #   main、窗口、Global 服务、菜单、退出；不含功能逻辑
│       ├── crates/queue/       #   导入、队列模型、虚拟列表、缩略图、拖放
│       ├── crates/workflow/    #   格式/质量/工作流预设、覆盖策略（Form + Settings 组件）
│       ├── crates/preview/     #   对比预览、滑块、大图分块
│       ├── crates/diagnostics/ #   HEIC helper 选择、插件诊断、环境影响
│       ├── crates/app-settings/#   设置页、语言、更新对话框、隐私/法律
│       └── crates/adapters/    #   FilePicker 的 GPUI 实现、ProgressSink 的前台桥接
├── src-tauri/                  # 迁移期保留：command 适配 + FilePicker/ProgressSink 的 Tauri 实现
├── src/                        # Svelte UI，迁移期保留
└── web-app/ browser-extension/ # 运行时代码不变，但对 src-tauri/icons 与 src/lib/assets 的引用改到 assets/brand
```

### 2.1 依赖方向

`apps/gpui` 与 `src-tauri` → `imgconvert-backend` → `imgconvert-platform` → `imgconvert-core`。实现前先提交 crate 依赖图并在 CI 用 `cargo deny` 的 bans 或自定义脚本禁止反向依赖。`external_codecs` 与两个系统 codecs 模块当前互相引用（`external_codecs.rs:31`、`macos_system_codecs.rs:12`），因此三者同放 `imgconvert-platform`，不拆散。

根 workspace 当前只含 `imgconvert-core` 并排除 `src-tauri`。三个新 crate 加入根 workspace；`apps/gpui` 单独 workspace 与 lockfile，并纳入 `ci.yml` 现有的 `cargo deny`/`cargo audit`/`cargo about` 检查（当前只覆盖根 workspace 和 `src-tauri`）。

`apps/gpui` 内所有 crate 只依赖 `gpui-kit` 一个 UI crate（`use gpui_kit::*`，各层经 `gpui_kit::component`/`base`/`assets`/`platform` 访问），不直接依赖 `gpui`、`gpui_platform` 或 `gpui-component`。Edition 2024。工作区 `[workspace.lints]` 统一开启 `clippy::all`、`clippy::pedantic` 为 warn，CI 以 `cargo clippy --all-targets --locked -- -D warnings` 执行；局部豁免只用 `#[expect(...)]` 加原因注释。backend/platform 的错误类型用 `thiserror`，只有 shell 二进制用 `anyhow`；backend/platform 不得 `unwrap`/`expect`/`panic`。

### 2.2 ProgressSink 契约

```rust
pub trait ProgressSink: Send + Sync {
    /// 只能在 backend 协调线程调用，禁止在 UI 线程调用。
    /// 可靠事件在有界通道满时最多阻塞 `max_block`（默认 5 s），超时视为接收方失效并返回 Err；
    /// FileProgress 永不阻塞。返回 Err 表示接收方已关闭或失效。
    fn send(&self, batch_id: BatchId, event: BatchProgressEvent) -> Result<(), SinkClosed>;
}
```

- 保持现有语义：`send` 返回 Err（接收方关闭）时批次取消并以错误结束。若未来要改成"UI 断开后继续"，作为独立行为变更单独立项，不混入阶段 1。
- 每个事件带 `BatchId`；UI 丢弃不属于当前批次的事件。
- 事件可靠性：除 `FileProgress` 可在 UI 侧按 index 合并外，`Started`、`FileFinished`、`FileSkipped`、`FileError`、`Finished`、`Cancelled` 保持顺序且不得丢弃。
- 接收方是**应用级**接收器（由 `BatchService` 的订阅者持有，生命周期与应用相同），不是窗口。窗口关闭后接收器继续消费并更新 `BatchSnapshot`，重新打开窗口从快照恢复；只有应用级接收器关闭才触发"接收方关闭"语义。
- 传输：backend 内部 worker → 协调线程继续用现有无界 `mpsc`；协调线程 → 应用级接收器用两条通道：可靠事件走有界通道（容量 4,096，满时 `send` 按上述 `max_block` 阻塞协调线程而不是丢弃，超时按接收方失效处理并终止批次，记录阻塞时长指标）；`FileProgress` 走每 index 一个槽位的"最新值覆盖"结构。阻塞只发生在协调线程，UI 线程从不等待。
- 测试：满队列、接收器关闭、协调线程 panic、窗口关闭后重开四种路径各有测试。

### 2.3 任务生命周期

- `BatchService` 持有自己的执行器（独立 `tokio` runtime 或线程池，不依赖 `tauri::async_runtime`），持有每个批次的 `JoinHandle`、`CancellationToken` 与状态快照（可查询的 `BatchSnapshot`）。
- `finish()` 改为 Drop guard，保证 panic、调度失败、取消三种路径都清理 `BatchState`。
- GPUI 侧的 `Task` 只订阅快照，不持有批次；窗口关闭不取消批次。应用退出时 `BatchService::shutdown(timeout)` 先取消，再等待进行中的原子写入完成，超时则记录日志退出。
- 预览与批量转换的内存互斥（`WorkflowExecutionGate`）随 service 移入 backend。
- GPUI 侧桥接（`crates/adapters`）：`BatchService` 以 `cx.set_global` 注册为应用级 Global；应用级接收器是一个在 shell 启动时 `cx.spawn` 的前台任务，句柄存放在该 Global 内（不是任何窗口视图），循环从 `async-channel` 接收 `ProgressSink` 事件并更新 `Entity<BatchModel>`。GPUI 实体只能在前台线程更新，因此 backend 线程只写通道，不触碰实体。每批已到达的事件合并后 `cx.notify()` 一次；`BatchId` 不匹配的事件丢弃。窗口视图用 `cx.observe(&batch_model)` 订阅，持有 `WeakEntity`，不持有任务。
- 退出：shell 定义 `Quit` action 与菜单项，最后一个窗口关闭不自动退出（GPUI 默认行为），退出路径统一调用 `BatchService::shutdown(timeout)`。

### 2.4 GPUI Kit 编码规范（来自 `gpui-kit` skill，作为 PR 检查项）

- 按能力拆 crate：shell 只组合窗口与功能 crate；功能 crate 持有自己的模型、视图、命令、对话框；不建全局 `views/`、`models/`、`modals/` 目录；功能 crate 不依赖 shell，也不深入另一个功能 crate 内部。
- `gpui_kit::init(cx)` 必须最先调用；窗口用 `gpui_kit::open_window` 打开，由它挂载 `Root`，每个窗口一个 `Root`，不在视图里再渲染 overlay 层。
- `RenderOnce` 用于值型元素（队列行、空状态、徽标）；`Entity<T>` 用于跨帧保持行为的单元（输入框、列表状态、预览状态）。不把每个视觉片段做成实体。
- 状态归属：领域状态在 backend 模型；瞬时视图状态在渲染它的视图；可复用行为状态用组件自带的 `*State`；共享服务用 Global。受控值模式：传入当前值，回调只报告请求的变化，由所有者更新后 `cx.notify()`。`render` 内不得变更状态或无条件 `notify`。
- 稳定身份：队列行、标签、重复控件的 `ElementId` 必须来自领域 id（沿用现有 `item.key`），不得用列表索引或翻译后的文案；不在 `render` 内生成随机 id。
- 异步：从事件或命名方法启动，不在 `render` 内启动；闭包捕获 `WeakEntity`；后台计算用 `background_spawn`，结果回到前台再更新实体；带修订号拒绝过期结果；显式表示 idle/loading/loaded/failed 四态；错误在 UI 呈现，不只写日志。
- 公共 API：跨 crate 的类型不暴露 `pub` 字段，用 builder 与 reader；确需公开字段的记录型结构加 `#[non_exhaustive]`。
- 不臆造 API：写任何组件调用前先取 `https://gpui-kit.com/component/{name}.md` 或本地依赖源码核对签名；不从 React/CSS/旧 GPUI 示例类比。
- 每个 UI 改动在 PR 描述中写明：行为所有者与呈现所有者、保持的身份与状态生命周期、指针/键盘/焦点/无障碍契约、布局与溢出所有者、主题 token 与例外、回归时会失败的测试。

## 3. 技术选型与锁定策略

### 3.1 GPUI 发行线

选 `gpui-kit = "=0.7.1"`，由它带入 `gpui-pre = 0.3.8`（Zed 提交 `279fe070`，2026-10-04）。理由：

- 唯一同时具备组件库、每周快照、精确锁定的路线；官方 `gpui` 0.2.2 自 2025-10-22 无新版本。
- `279fe070` 晚于 Zed PR #56315（2026-07-28 合并，删除 `CGSMainConnectionID`/`CGSSetWindowBackgroundBlurRadius`）。这只解决已知阻碍，MAS 可审核性仍以 §5.3 扫描和 TestFlight 实机为准。
- 不混用 `gpui`、`gpui-ce`、`gpui-unofficial`、`gpui-fast`。`gpui-fast` 在 Kit v0.7.1 feature 表中不存在。

锁定规则：

- 提交 `apps/gpui/Cargo.lock`；CI 用 `--locked`。
- 升级只升 `gpui-kit`，不单独改 `gpui-pre`。每次升级独立 PR，必须跑 Kit UI 测试与 macOS 像素敏感性测试，并重跑许可证与漏洞扫描。
- 阻塞 bug 先向上游提最小复现；本地补丁用 `[patch.crates-io]` 并在 `docs/GPUI_PATCHES.md` 记录目的与退出条件。不 vendor 整个框架。
- `rust-toolchain.toml` 固定工具链（Kit 要求 ≥ 1.92，当前 1.96）。

### 3.2 最低系统版本（已确认，2026-10-12）

| 平台 | 现状 | 建议 | 依据 |
|---|---|---|---|
| macOS 直发 | 10.13 | 12.0 | Zed 将 macOS 12+ 列为完全支持；#56315 删除了 <12 路径；MAS 已是 12.0 |
| macOS MAS | 12.0 | 12.0 | 不变 |
| Windows 直发 | 未显式声明 | Windows 10 1903+（10.0.18362），64 位 | Zed Windows 要求；D3D11 |
| Windows MSIX | 10.0.17763.0 | 提到 10.0.18362 与直发一致 | `AppxManifest.xml.template` |
| Linux | 未声明 | x86_64/aarch64，Vulkan 1.3 | Zed Linux 要求 |

Linux GPU 策略：在创建 GPUI 窗口之前，用独立的 `wgpu`/`ash` 探测枚举适配器。无任何适配器或驱动初始化失败时，通过 `zenity`/`kdialog`/XDG portal 或 stderr 输出可读错误并退出码 71，不依赖 GPUI 自身显示错误（GPUI 在该状态下能否弹窗未核实）。只有 llvmpipe 时弹一次性提示后继续运行，并给出 Web 版 `imgconvert.web.casa` 链接。

### 3.3 UI、状态与缓存

- 组件选择：常规控件用 `gpui_kit::component`；设置栏用 `Settings` 组件（页/组/项，getter/setter 闭包读写 backend 的 `Settings` 结构，自带搜索）；工作流参数用 `Form`/`Field`；覆盖确认用 `AlertDialog`（不可点外关闭，标题写对象、按钮写动词）；可逆低风险操作不弹确认；外部链接用 `Link`，应用内命令一律 `Button`；颜色与间距只用 `cx.theme()` token 与 rem 辅助，不写字面量。
- 队列用 `v_virtual_list`：行高统一，`item_sizes` 在 rem/缩放变化时重建；选择与键盘导航以领域 id（`item.key`）为坐标，不以可见索引为坐标；空状态说明下一步动作。
- 对比预览、拖放区用自定义 Element，必须提供无障碍角色与名称并接入键盘路径。
- 不引入 Kit 的 Shell/WebView 扩展。
- UI 状态用 `Entity<T>`；业务状态结构体在 backend 定义，不含 GPUI 类型。
- 缩略图渲染走 GPUI 的 `img()` 与 `Arc<RenderImage>`（backend 解码为帧，UI 不再经编码字节），为每个 `img` 预留固定尺寸避免布局跳动，`with_fallback` 处理失败；失败结果会被 GPUI 缓存，重试前先 `remove_asset`。
- 内存预算分三类，各自独立且都可配置：GPU 侧由自定义 `ImageCache`（`image_cache(provider)` 作用于队列子树）按容量淘汰并调用 `cx.drop_image` 释放纹理，容量必须大于可见行数否则每帧重载；CPU 侧由 backend 的缩略图缓存按字节预算（初始 128 MiB）淘汰；在途解码与 RGBA staging 的并发上限与现有缩略图并发一致；预览与批量工作集沿用 `convert.rs` 的 768 MiB 批量预算。`result_cache.rs` 的 4,096 条、30 天 metadata 缓存与此无关，保持不变。
- 缓存失效：文件 mtime/size 变化、队列项移除、滚出视口超过阈值后允许释放；重复请求合并；滚出视口后已完成的结果仍写入 CPU 缓存。
- 像素一致性：Kit 文档未说明 `RenderImage` 的预乘 alpha 与 HiDPI 处理，阶段 2 用透明 PNG 与 2x 显示实测后在 backend 固定转换规则；`docs/RELEASE_QA.md` 的预览一致性样本扩展为含透明 PNG、ICC 配置 JPEG、2x/3x 缩放各一组。
- 字体：Kit 默认 `.SystemUIFont`，CJK 回退依赖平台（macOS CoreText、Windows DirectWrite、Linux fontconfig），Kit 文档未说明 Linux/Windows 的 CJK 回退细节。Linux 包声明 `fonts-noto-cjk` 为推荐依赖，Flatpak/Snap 确认运行时含 CJK 字体；阶段 2 六平台探针包含中英混排与长译文的渲染检查。不内嵌 CJK 字体。

### 3.4 国际化

- `rust-i18n >= 4.2`（Kit i18n 文档要求），`rust_i18n::i18n!("locales", fallback = "en")` 放在 shell crate 根；`rust_i18n::extend!` 在 `gpui_kit::init` 之前调用一次，用 `gpui_component` 命名空间覆盖 Kit 组件自带文案（Kit 内置 `en`/`zh-CN`/`zh-HK`/`zh-TW`，覆盖度按键不同，阶段 3 逐键核对 zh-CN）。
- 脚本把 `src/lib/i18n/messages/{en-US,zh-CN}.ts` 转成 `locales/ui.yml`（`_version: 2` 格式），键名不变；占位符从 TS 的 `{count}` 转成 rust-i18n 语法（具体语法在阶段 1 核对，不假定一致）；CI 校验两种语言的键集合与每条消息的占位符集合一致，并校验转义与换行。
- 运行时切换：`set_locale` 后 locale 是 GPUI 变更跟踪之外的全局状态，必须 `cx.refresh_windows()` 并显式重建菜单与缓存的标签。
- 切换时 YAML 成为唯一文案源；TS 文件随 `src/` 删除。切换前不允许双向维护，所有文案改动先改 TS 再重新生成。
- 验收：窗口标题、已存储的本地化错误消息、系统对话框标题、原生菜单；长译文下的窄按钮、输入框 placeholder、缩放文本在三平台各查一次；文本宽度用 shaped layout 测量，不用字符数。

### 3.5 设置持久化

- 物理路径表（2026-10-17 按源码核实，写入 `docs/GPUI_SETTINGS_PATHS.md`；`tauri-plugin-store` 把 `settings.json` 解析到 `BaseDirectory::AppData` = `dirs::data_dir()/<identifier>`，v0.7 把 Linux 写成 `$XDG_CONFIG_HOME` 是错的）：

| 渠道 | Tauri 版路径 | GPUI 版要求 |
|---|---|---|
| macOS 直发 | `~/Library/Application Support/com.ivmm.imgconvert/settings.json` | 同路径（已实现） |
| MAS | 沙盒容器内同相对路径 | 同 bundle id，容器自动一致 |
| Windows 直发 | `%APPDATA%\com.ivmm.imgconvert\settings.json` | 同路径（已实现） |
| MSIX | 同上（runFullTrust，不虚拟化 AppData 的情况需核实） | 核实后决定 |
| Linux deb/rpm/AppImage | `$XDG_DATA_HOME/com.ivmm.imgconvert/settings.json`（默认 `~/.local/share/...`） | 同路径（已实现） |
| Snap/Flatpak | 沙盒 home 内同相对路径 | 同 app id |

- 读取：同文件、同 `settings` 键；移植 `normalizeSettings` 全部规则（版本迁移、类型归一化、数值约束、覆盖模式转换、metadata 策略、预设归一化）并用现有 TS 测试用例生成 Rust 测试。
- 写入：首次写入前备份为 `settings.json.pre-gpui`，该备份一经创建不再覆盖；原子替换（临时文件 + rename），rename 失败时保留临时文件并下次启动重试；保留 store 顶层与 `settings` 内所有未知字段（不限于嵌套预设）；退出时 flush；移植 `CoalescingWriter` 的合并写与 300 ms autoSave 语义。
- 跨进程互斥：旧 Tauri 版由 `tauri-plugin-store` 自动保存，无法参与文件锁协议。因此不承诺两版本并发安全，改为互斥运行：GPUI 版与 0.3.x 过渡版都在配置目录创建 `instance.lock`（含 pid 与版本），启动时发现另一版本正在运行则提示并退出。GPUI 版内部仍用文件锁（`fd-lock`）序列化自身多实例写入。
- 损坏文件：解析失败时保留原文件为 `.corrupt-<ts>` 并用默认值启动。
- 验收：旧版写 → 新版读 → 新版写 → 旧版读 的往返测试；崩溃注入（写到一半 kill）后可恢复；互斥启动测试（先启旧版再启新版、反之）通过。
- 实现落点（2026-10-17）：`crates/imgconvert-platform/{paths,settings,instance_lock}.rs`（经 `imgconvert_backend` 导出）；`crates/imgconvert-backend/src/conversion_request.rs` 是 `buildConvertRequest` 的移植，GPUI 工作流只经它生成 `ConvertOptions`；GPUI 侧 `imgconvert_gpui_shared::SettingsModel`（`AppModels` 的第三个模型）负责合并写与退出 flush。

### 3.6 打包、安装身份与更新

打包工具：`cargo-packager` 0.11.8（仓库 2026-10-09 仍有提交），覆盖 DMG、NSIS、WiX MSI、deb、AppImage、pacman。RPM 不在其列，用 `cargo-generate-rpm` 或现有 rpmbuild 流程补齐。Kit 自己的打包文档不推荐任何打包框架，只给出手写脚本（`hdiutil`/`codesign`/`notarytool`、Inno Setup、`dpkg-deb`），且示例 `Info.plist` 不设 `LSMinimumSystemVersion`；本方案因需保持 WiX `upgradeCode` 与现有产物命名而选 cargo-packager，并在其配置中显式写入 `LSMinimumSystemVersion = 12.0`、`CFBundleIdentifier`、`CFBundleVersion`。Kit 文档与现有 `packaging/macos` 一致地要求嵌套代码先签、`--deep` 只用于验证。所有产物名必须与 `scripts/github-release-assets.mjs`、`scripts/windows-release-assets.mjs` 的 allowlist 一致，或同步修改 allowlist 与 `docs/RELEASE_QA.md`。

安装身份（跨框架升级必须保持）：

| 平台 | 必须保持的身份 | 来源 |
|---|---|---|
| Windows MSI | WiX `upgradeCode`（`ba075ad0-…`）、每架构 en-US/zh-CN 两个语言 MSI、`allowDowngrades=false`；实际安装范围（per-user 或 per-machine）在阶段 2 从 Tauri 产物的 MSI 属性表读取后固定，当前未核实 | `src-tauri/tauri.windows.conf.json`、`packaging/windows/README.md` |
| Windows NSIS | `installMode=currentUser`、安装目录与注册表卸载键命名、English/SimpChinese 语言 | 同上 |
| MSIX | Partner Center identity、publisher、四段版本独立递增规则 | `packaging/windows/msix` |
| macOS | bundle id `com.ivmm.imgconvert`、`CFBundleVersion` 单调递增 | `tauri.conf.json` |
| Linux 直发 deb/rpm/AppImage/AUR | 包名 `imgconvert`、`/usr/bin/imgconvert`、`/usr/share/applications/ImgConvert.desktop`、AppImage 命名与别名 | `scripts/check-linux-bundle-artifacts.mjs`、`packaging/aur/PKGBUILD.template`、`scripts/github-release-assets.mjs` |
| Flatpak / Snap | app id `io.github.yeagoo.imgconvert`、snap 名与 confinement | `packaging/flatpak`、`snap/snapcraft.yaml` |

每个安装件的验收单位是"系统×架构×包型×语言"，每项记录：干净安装、从最后一个 Tauri 版覆盖升级（设置保留）、转换一张、卸载无残留。

渠道编译隔离基线（阶段 1 从现有脚本与清单抽成 `docs/GPUI_CHANNELS.md`，对最终包验证生效，不以"复用脚本"替代）：

| 渠道 | 外部 codec helper | 应用内更新器 | 来源 |
|---|---|---|---|
| macOS 直发 | 开 | 开 | `packaging/macos/README.md` |
| MAS | 关（`IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`） | 关（`IMGCONVERT_DISABLE_UPDATER=1`） | 同上 |
| Windows 直发 | 开 | 开 | `packaging/windows/README.md` |
| MSIX | 关 | 关 | `packaging/windows/README.md:139` |
| Linux 直发 | 开 | 开 | `docs/UPDATER.md` |
| Snap | 关 | 关 | `snap/snapcraft.yaml:70` |
| Flatpak | codec extension 契约 | 现状为开（清单按默认 feature 构建，默认含 `updater`，`src-tauri/Cargo.toml:25`）；阶段 1 修正为关，Flathub 不允许应用自更新 | `packaging/flatpak/*.yml` |

更新器：

- 现状：`docs/UPDATER.md` 记录 macOS 尚无已发布的自动更新资产；`updater-upgrade-smoke.yml` 只覆盖 Linux x86_64。
- 新实现用 `cargo-packager-updater` 0.2.3。其清单比现有 `generate-tauri-updater-manifest.mjs` 产出多一个必需字段 `format`（`app`/`appimage`/`nsis`/`wix`），现有 JSON 不能原样复用；保留 GitHub Releases 静态托管方式，新通道独立使用 `releases/latest/download/latest-v2.json`，旧 `latest.json` 永久只保留 0.3.x。
- 旧客户端升级矩阵（阶段 3 前完成，验收证据按 docs/UPDATER.md 记录，SDK 演练不能代替 GUI/GPU 与最终安装件验收）：

| 旧客户端 | 渠道 | 需验证 |
|---|---|---|
| Tauri 0.3.x Linux x86_64 AppImage | GitHub updater | 旧 Tauri updater 能否验签并安装 cargo-packager 产出的 AppImage；minisign 密钥能否复用 |
| Tauri 0.3.x Linux aarch64 | GitHub updater | 同上 |
| Tauri 0.3.x Windows NSIS/MSI | GitHub updater | 旧 updater 能否安装新 NSIS/MSI；upgradeCode 一致 |
| Tauri 0.3.x macOS | 无自动更新 | 手动下载；发布说明与应用内提示 |
| MAS / MSIX / Snap / Flatpak | 商店或包管理器 | 不走应用内更新；身份一致即可 |

- 若密钥或包格式不兼容，在 0.3.x 侧先发一个由旧信任链签名的过渡版本，内置新公钥并能安装新格式；"在清单里声明换密钥"不能让已安装客户端获得新信任根。
- 升级矩阵是门禁：Linux 两项在 G3 验收，Windows 两项在 G4 验收，全部实际已分发 updater 渠道在 G5 复验；未分发渠道（macOS）标为不适用并引用 `docs/UPDATER.md` 作依据。新旧客户端分别验证清单解析与安装。
- 系统版本与 GPU 护栏：旧客户端运行在低于 §3.2 要求的系统（如 macOS 10.13–11）或无 Vulkan 的 Linux 上时，不得收到不可运行的更新。实现方式：
  - 现有端点 `releases/latest/download/latest.json` 永久只指向 0.3.x 过渡版本（0.3.z），这样所有现存 Tauri 客户端只能先升到过渡版。
  - 过渡版本改用新端点 `latest-v2.json`，并在检查更新前执行两项护栏：比较本机系统版本与清单扩展字段 `minimum_system_version`；Linux 上用 `ash` 做一次 `vkEnumeratePhysicalDevices` 探测，无物理设备或仅软件设备时不升级并提示。
  - 0.4.0 只出现在 `latest-v2.json`。过渡版本是唯一通往 0.4.0 的路径，这一约束在 `updater-upgrade-smoke.yml` 中用"旧端点永不出现 0.4.x"断言固定。
- 坏更新止损：删除或回退 `latest-v2.json` 只停止后续分发，不回滚已安装客户端。已安装新版的回退按包型执行并在阶段 5 用最终安装件演练（回退前恢复 `settings.json.pre-gpui`；用户输出文件不受影响）：

| 包型 | 回退步骤 | 备注 |
|---|---|---|
| macOS DMG | 删除 `.app`，安装 0.3.x DMG | 需 0.3.x DMG 继续可下载 |
| Windows MSI | 先卸载 0.4.0，再安装 0.3.x MSI | `allowDowngrades=false` 禁止直接降级 |
| Windows NSIS | 同上 | 卸载键一致 |
| Linux deb | `apt install imgconvert=0.3.x`（本地 .deb 文件） | 包管理器降级 |
| Linux rpm | `dnf downgrade ./imgconvert-0.3.x.rpm` | 同上 |
| AppImage | 替换文件 | 无身份问题 |
| Snap | `snap revert imgconvert` | 商店保留上一 revision |
| Flatpak | `flatpak update --commit=<旧 commit> io.github.yeagoo.imgconvert` | 需记录 0.3.x commit |
| MSIX（Store） | 用户无法自行降级；发布方可在 Partner Center 回退提交 | 因此 Store 提交在直发渠道稳定 14 天后再做（hold-back） |
| MAS | 用户无法自行降级；发布方可暂停分发或提交修复版 | 同上 hold-back，并使用 App Store 分阶段发布 |

MAS：复用 `packaging/macos` 现有流程，显式恢复以下 Tauri 配置带入的步骤：编译时 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` 与 `IMGCONVERT_DISABLE_UPDATER=1`；universal 构建并对主程序与任何 helper 分别 `lipo`；`PrivacyInfo.xcprivacy` 与用途字符串落位；profile 证书与签名证书交叉校验；Installer 签名；`otool -L` 确认无 `libheif`/`libx265`。network client entitlement 是否移除，以 GPUI 最终包在 MAS 配置下的实际网络行为（应为零）为准。`macos_security.rs` 只是 best-effort RAII shim，不创建或恢复 bookmark；MAS 当前依赖每次启动由 `NSOpenPanel` 重新授权，GPUI 的 `prompt_for_paths`、拖放输入和输出目录授权必须在阶段 2 重新验证重启、拒绝、取消三条路径，并在阶段 3 通过 TestFlight 实机沙盒验收。

Microsoft Store：维持 MSIX 路线，复用 `packaging/windows/msix`；直发 MSI/NSIS 继续不签名，发布说明保留 SmartScreen 提示。直发包由 `windows-smoke.yml` 构建，Store workflow 不能替代。

Snap/Flatpak：保留 strict confinement、portal 文件选择、隐藏/可移动文件测试；Flatpak 重建离线依赖来源并保留 codec extension 契约；确认沙盒内 GPU 驱动可见（`--device=dri`）、portal 父窗口关联；检查全部打包 ELF 的 GLIBC 基线不高于现有 `packaging/linux/Dockerfile.jammy`。AUR 与 AppImageHub 的准备步骤目前在 `release-updater.yml`，随之迁移。

### 3.7 测试

| 层 | 迁移后 | 证明什么 |
|---|---|---|
| core 单元测试、fuzz | 不变 | 编解码 |
| backend/platform 测试 | 随代码移入；`ProgressSink` 与 `FilePicker` 用测试实现 | 业务规则 |
| 无头业务 smoke | 保留 `IMGCONVERT_PATH_CONVERT_SMOKE` 与 `IMGCONVERT_PACKAGE_CONVERT_SMOKE` 两个入口及 benchmark 入口，行为与退出码不变 | 打包产物能编解码；现有 `smoke-windows-installers.mjs` 等脚本继续可用 |
| Kit UI 交互测试 | `gpui-kit` dev-dependency 加 `test-support`（与正常依赖同源同版本）；`#[gpui_kit::test]` + `TestWindowExt` 在无头窗口内点击、拖拽、键盘、滚动、焦点、`find_by_role`/`find_by_label` 无障碍树断言；`TestInput` 驱动 IME 组合转换；三平台 CI 都能跑，进程内执行 | 控件逻辑与键盘路径；不证明朗读、像素与 OS IME |
| 像素敏感性 | Kit 渲染目标：macOS（Metal）与 Linux（WGPU，允许 Mesa lavapipe）；Windows 因 GPUI 0.3.8 无无头渲染器而跳过 | 渲染回归 |
| 真实 GUI 自动化 | 每平台启动打包产物、用 OS 级自动化（macOS AppleScript/XCUITest、Windows UIA、Linux AT-SPI）点击导入与转换、截图、正常退出 | 窗口、输入、拖放、权限 |
| 人工平台验收 | VoiceOver/NVDA、中文 IME 候选框、Windows ARM64 真机、Linux Wayland/X11、MAS TestFlight 沙盒 | 平台行为 |

三类证据分别记录，不互相替代。测试分层按 Kit 规范：纯逻辑用 `#[test]`；实体/订阅/异步用 `TestAppContext`；焦点/键盘/指针/布局用无头窗口交互测试；完整流程用打包后 smoke 与 GUI 自动化。交互测试导入生产视图，通过真实事件路径，不直接调用回调或设置控件状态。`e2e-desktop` 在切换后删除。

## 4. 阶段计划与门槛

工作量按单人、熟悉 Rust、AI 辅助估算，含 20% 平台阻塞预留；商店审核等待与证书申请不计入。

### 阶段 0：基线与验收指标（1 周）

- 测量方法：同一台机器、关闭其他应用、冷启动指清空页缓存后首次启动、每项 10 次取中位数与 p95；"不劣于"容差 ±5%；帧时间采样窗口为滚动 10,000 项队列 10 秒。
- 指标：冷启动到可交互；空闲总内存（Tauri 版含 WebView 子进程，GPUI 版单进程，两者都按进程树统计）；导入 1,000 与 10,000 张耗时；队列滚动 p99 帧时间；批量转换峰值内存。
- 平台（2026-10-12 用户决定）：macOS arm64 基线在 Parallels macOS 13.6 虚拟机上采集，不在宿主机裸机采集；阶段 2 的 GPUI PoC 在同一台虚拟机、同一语料、同一脚本下对比，只认相对差异，绝对数字不外推到裸机。虚拟机无 GPU 直通，import 10k 在 WebKit 下停摆（`docs/GPUI_BASELINE.md` §8），该场景只对 GPUI PoC 要求"能完成并有数据"，不与 Tauri 比。Windows x64 与 Linux x86_64 没有专用机器，阶段 4 用 CI runner 或临时虚拟机各采一次 startup 与 import 1k 作为参照，不用 macOS 数字约束其他平台。
- 工具（已交付，2026-10-12）：探针协议 `IMGCONVERT_PERF_PROBE`（`src-tauri/src/perf_probe.rs`、`src/lib/perf-probe.ts`），数据集生成 `scripts/generate-baseline-corpus.mjs`，采样脚本 `scripts/measure-desktop-baseline.mjs`，口径与步骤见 `docs/GPUI_BASELINE.md`。GPUI 原型必须实现同一协议。
- 产出：`docs/GPUI_BASELINE.md` §6 的数字与 `artifacts/baseline/*.json`（虚拟机上的原始 JSON 在 `~/imgconvert-bench/out`，需拷回仓库的 `artifacts/baseline/`）。

门槛 G0：macOS arm64 虚拟机上 startup（热/冷）、import 1k、manual-batch 1k 各有完整有效数据，import 10k 记录为"虚拟机不可测"并附调用栈证据；Windows x64 与 Linux x86_64 推迟到阶段 4。2026-10-12 三项均已达标（manual-batch 1k 有效 2 次，按 §4 要求的 3 次少 1 次，已注明），G0 通过。

### 阶段 1：后端解耦（3–4 周）

- 先迁 `src-tauri/icons` 与 `src/lib/assets/app-icon.png` 到 `assets/brand/`，更新扩展商店素材校验、PWA 生成器、`Header.svelte`、`SiteFooter.svelte`、`snap/snapcraft.yaml`、Flatpak 清单的引用；通过 Web/PWA/扩展构建与校验。
- 旧路径引用扫描：`rg "src-tauri/|src/lib/" scripts/ packaging/ snap/ web-app/ browser-extension/ .github/` 的每一条命中登记为"迁移"或"退役"，`check-platform-release-guardrails.mjs` 对 `src-tauri/Cargo.toml`、`lib.rs`、`build.rs`、`capabilities/*.json` 的读取改为新 crate 路径或退役。
- 新建 `imgconvert-platform`、`imgconvert-backend`，按 §2 移入模块；`ProgressSink`、`FilePicker`、`BatchService`、Drop guard 清理；`tauri::Url` 换 `url` crate。
- `src-tauri` 变成适配层。
- 行为兼容清单（逐条有测试）：进度发送失败终止批次；取消信号与任务生命周期；预览与批量转换的内存互斥；进度事件顺序；覆盖保护与原子写入；剪贴板导入与临时文件清理；扫描取消。
- 新 crate 纳入 `cargo deny`/`audit`/`about`。
- 以 0.3.x 补丁版本发布一次 Tauri 版。

进度（2026-10-12，未提交）：

- 已完成：`crates/imgconvert-platform`（external_codecs、两个系统 codecs、macos_security、`dialogs::FilePicker` 契约、`build.rs` 透传 `IMGCONVERT_DISABLE_EXTERNAL_CODECS`）与 `crates/imgconvert-backend`（convert/import/preview/thumbnail/result_cache/pdf/access/command_error/environment/native_dialog/fuzzing、`progress::ProgressSink` + `BatchId` + 有界 `ProgressChannel`、`service::BatchService` + `BatchSnapshot` + Drop guard + `shutdown(timeout)`）加入根 workspace；`tauri::Url` 换 `url`；Preview/ImportScan 注册改为 Drop guard；`src-tauri` 只剩 command 适配、`TauriProgressSink`、预览 IPC 响应、插件注册与退出时 `shutdown`；守卫脚本改读新路径并新增依赖方向检查；CI 根 workspace 改为 `--workspace --all-features`。
- 未做（留给本阶段后续 PR）：`assets/brand/` 图标迁移（现阶段迁移只带来发布链路改动风险，删除 `src-tauri` 前再做）；`platform::settings`/`paths`（GPUI 壳才需要，放到阶段 2）；`imgconvert-i18n`（阶段 2）；0.3.x 补丁发布与三平台 QA。

Codex 只读评审（2026-10-17，结论"修后可合并"，4 项 P1、3 项 P2，记录在 `artifacts/reviews/codex-stage1-review-2026-10-17.md`）与修复：

- P1 进度合并越过终态：`ProgressChannel` 现在把文件终态事件（`FileFinished`/`FileSkipped`/`FileError`）作为该索引的屏障、把批次边界（`Started`/`Cancelled`/`Finished`）作为全部索引的屏障，清掉已合并但未投递的 `FileProgress`；4 个新测试覆盖单索引、批次终态、跨批次。
- P1 `shutdown()` 误报完成：`BatchService` 不再依赖 `JoinHandle`，改为 Drop guard 在协调线程退出路径上发出的完成信号；启动中、运行中、首次超时后再次调用都按真实状态等待；新增运行中超时→释放→完成、非空批次经 service 取消、worker 已启动时协调线程 panic 三个测试，并把"窗口关闭"测试改为保留应用级接收器、只关窗口订阅、批次必须成功。
- P1 Drop guard 未跟随后台任务：`src-tauri` 的 `scan_import_paths` 与 `generate_comparison_preview` 把注册 guard 移入 `spawn_blocking` 闭包，IPC future 被丢弃时槽位仍由真正在跑的任务持有；backend 新增"注册随 worker 存活、调用方放手后仍可取消、worker panic 后清理"测试。
- P1 Windows HEIC CI 读旧路径：`scripts/test-external-codecs-ci.mjs` 改读 `crates/imgconvert-platform/src`；`check-architecture-guardrails.mjs` 新增 `checkMovedSourcePaths`，扫描 `scripts/`、`.github/`、`packaging/`、`snap/` 中对已迁出模块的字面路径与 `"src-tauri", "src", "x.rs"` 参数形式引用，并要求 codec harness 指向 platform（已做阴性验证：注入旧路径时脚本退出 1）。
- P2 接收器不响应失效：`ProgressReceiver::recv` 在队列排空且 `receiver_failed` 时返回 `None`，新增测试。
- P2 第二套批次生命周期：删除 `convert::BatchState`/`BatchRegistration`；`pdf` 模块改为 `pub(crate)`，对外只保留 `convert::PdfConvertOptions`。
- P2 测试缺口：新增"运行中进度发送失败 ⇒ 取消令牌、worker 停止、不再发任何终态事件"测试；剩余缺口（预览与 service 的真实竞争集成测试、IPC future 取消的 Tauri 侧测试）需要 GUI 运行时，留给阶段 2 的 Kit UI 测试。
- `cargo about` 复核：重新生成 `THIRD_PARTY_LICENSES.md`，相比迁移前只多出 `imgconvert-backend`/`imgconvert-platform` 两个工作区 crate，没有新增第三方依赖。

R1 收口准备（2026-10-18）：Tauri 在任何 WebView/store 插件启动前取得共享 `instance.lock`，由应用状态持有至退出。占用或锁 IO 失败只显示原生提示并退出，不启动读写设置的前端。实现与验证记录见 `docs/GPUI_R1_L2_QA.md`。L2 补丁发布、三平台完整安装 QA 未完成，G1 **未关闭**；不要把 R1 的代码测试当作发布验收。

门槛 G1：全部现有 Rust 测试、fuzz 回放、`e2e-desktop` 通过；0.3.x 完成三平台 QA；许可证扫描通过。

### 阶段 2：GPUI 技术验证（3 周）

macOS 功能范围严格限定：拖放/选择导入、虚拟队列、缩略图 LRU、格式选择、开始/取消、进度、中英文切换。不做设置面板、对比预览、更新。

同时完成六平台探针（不做功能，只做可行性）：

- CI 在 macOS arm64/x64、Windows x64/ARM64（`windows-11-arm` runner）、Linux x86_64/aarch64 六个目标上构建，并用 `cargo-packager` 产出最小安装件。
- 每个目标至少一次真实启动、打开文件选择器、输入一个中文字符、正常退出（Linux CI 允许 llvmpipe）。
- 记录每个目标的安装件名与安装身份是否符合 §3.6。

平台事项：

- 对两架构 `.app` 运行 `nm -u`/`otool -L` 扫描，无 `_CGS`/`_SLS`/PrivateFrameworks 符号；记录扫描范围与输出。
- macOS 12 虚拟机或真机可启动。
- 中文输入法候选框定位；VoiceOver 朗读按钮、队列项、进度。
- 拖放与 `prompt_for_paths` 在 MAS 配置（沙盒 entitlements）下的授权、重启、拒绝、取消路径。
- `ImageCache` 容量淘汰与 `cx.drop_image` 生效验证：滚动 10,000 项后 GPU 纹理数不超过容量；透明 PNG 与 2x 显示下的 alpha/HiDPI 实测。
- Linux 探针加入 lavapipe 下的 Kit 渲染目标与中英混排字体检查。
- 对照阶段 0 基线跑同一套测量。

进度（2026-10-17，首批，未经 Codex 评审）：

- 已搭建 `apps/gpui` 独立 workspace（Edition 2024，`gpui-kit = "=0.7.1"`，lockfile 把 gpui-component/gpui-base/gpui-kit-assets/gpui-component-macros 全部钉在 0.7.1，`gpui-pre 0.3.8`）。按 §2 拆为 `crates/shell`（窗口、菜单、`Quit`/`OpenFiles`/`ToggleLanguage` action、探针驱动）、`crates/shared`（`QueueModel`/`BatchModel`、`Services`/`AppModels` Global、`ProgressChannel` → 前台任务定时轮询（16 ms）→ 模型的进度桥接（最初用转发线程 + async-channel 唤醒前台任务，CI 的 GPUI 测试调度器断言唤醒必须来自主线程，遂改为轮询并去掉 async-channel 依赖）、`prompt_for_paths` 封装、rust-i18n 文案、探针协议）、`crates/queue`（拖放与选择器导入、`v_virtual_list` 队列、缩略图按视口附近行有界并发解码为 `ImageSource::Render`、CPU 字节预算 LRU 并在淘汰时 `cx.drop_image`）、`crates/workflow`（`Select` 输出格式、输出目录、开始/取消、`Progress`）。功能范围严格按本阶段清单：导入、虚拟队列、缩略图、格式选择、开始/取消、进度、中英文切换；没有设置面板、对比预览、更新器。
- 与方案的偏差：GPU 侧没有自建 `ImageCache`，改为"模型持有 `Arc<RenderImage>` + 淘汰时 `drop_image`"，因为 `ImageSource::Render` 不经过 GPUI 的 asset 缓存，纹理生命周期由我们直接控制，容量含义更清楚；`FilePicker` 没有做成 trait 实现，直接用 GPUI 的 `prompt_for_paths`（macOS 上即 `NSOpenPanel`），trait 适配留到 Tauri 线退役时再统一。
- 探针：shell 实现了 §7 契约（`ready` 在能力检查后等两次重绘；导入、静默、刷新率估计、三角波滚动、帧看门狗、批次标记），标记名与 Svelte 版一致，`measure-desktop-baseline.mjs --app <binary>` 可直接测。
- 护栏与 CI：`check-architecture-guardrails.mjs` 新增 `checkGpuiShellLayering`（只允许 gpui-kit、精确钉版、功能 crate 不依赖 shell 与彼此、不依赖 Tauri）；`ci.yml` 新增 `rust-gpui` Linux job（fmt、clippy `--locked -D warnings`、无头 Kit UI 测试）并纳入 CI 成本守卫；`cargo deny`/`cargo audit` 覆盖 `apps/gpui/Cargo.lock`（新增 0BSD、bzip2-1.0.6 两个宽松许可证；GPUI 0.3.8 的 4 条 unmaintained 公告按 ID 豁免并注明随 gpui-kit 升级复查）。
- macOS 构建不需要完整 Xcode：gpui-kit 0.7.1 默认开启 `runtime_shaders`，Command Line Tools 即可；代价是首次启动时编译 Metal shader，冷启动数字会含这部分。
- 首批测量（同一台 Parallels 虚拟机、同一语料、同一脚本，详见 `docs/GPUI_BASELINE.md` §6.1 的"GPUI PoC"列与采集记录）：startup 热就绪 404 ms（Tauri 1164 ms）、冷 1432 ms（3673 ms），空闲 49.5 MiB（159.3 MiB，−69%）；import 1k 97 ms（96 ms），整段三角波滚动的回调 p99 52 ms（402 ms），空闲 163 MiB（862.5 MiB，−81%）；import 10k 1.55 s、滚动 p99 53 ms、空闲 258 MiB（Tauri 在虚拟机上不可测）；AVIF 批量 1k 30.7 s（33.4 s），峰值 155.3 MiB（1123 MiB）。按 G2 口径 startup、import 1k、batch 1k 都达标，10k 有数据。尚未采集：Windows/Linux 探针、私有 API 扫描、VoiceOver/IME/沙盒冒烟。
- 过程中修掉的两个 GPUI 用法错误值得记入 §2.4：`Window::request_animation_frame` 只能在渲染中调用（渲染外用 `window.refresh()` 驱动下一帧）；`ScrollHandle::max_offset` 是正的滚动范围而 `set_offset` 取负值。
- 自动批次：`IMGCONVERT_PERF_PROBE_BATCH_OUT` / `IMGCONVERT_PERF_PROBE_BATCH_FORMAT`（脚本 `--batch-out` / `--batch-format`）让 GPUI 壳在 `probe_done` 后自行开始转换，manual-batch 场景不再需要操作者；为此把 backend 的 `path_conversion_smoke_options` 拆成产品默认值 `default_conversion_options`（质量 80、`%name%`、skip）加 smoke 覆盖（后缀、覆盖写、AVIF speed 10），GPUI 工作流只用前者。

Codex 只读评审（2026-10-17，结论"修后可合并"，8 项 P1、7 项 P2，记录在 `artifacts/reviews/codex-stage2-review-2026-10-17.md`）与处置：

- 已修（P1 1、2）：进度桥接改为"先建接收端（通道 + 转发线程）再启动后端、最后标记模型运行"；转发线程或后端启动失败时直接返回错误并补发 `batch_failed`，模型不会停在 Running；桥接任务带 `settled` 标志，`progress_bridge::is_busy` 在收尾完成前一直为真，`start_batch` 拒绝新批次（`StartError::Settling`），面板的 Start 与队列的 Clear 都按它门控，旧批次的终态标记不会再被第二批次替换掉。
- 已修（P1 3、4）：缩略图请求改为带队列代次的 `ThumbnailTicket`；结果先经应用级 `AsyncApp` 写回 Global 模型再更新视图，窗口关闭也不会留下 Loading；清空/重导后的旧结果被拒绝并交回释放，替换 Ready 图时扣账并释放旧图；LRU 改为"最近展示 tick + 淘汰时扫描"（touch O(1)）。
- 已修（P1 5、6、7、8）：滚动改为按 `elapsed/duration` 的一次完整三角波，距离从句柄实际偏移累计，无滚动范围发 `probe_error_scroll_range`；各帧阶段由帧回调自行判定完成，墙钟只做 `nominal + 60 s` 看门狗，不再有同步伪首帧；`ready` 在两次强制重绘之后发出，静默判定加入视图的在途/待调度缩略图工作并经一次帧屏障复核（§7 的"设置已读取"在 PoC 中没有设置可读，注释已改为如实描述）；Clear 改按 `BatchModel::is_active() || is_busy()` 门控并在命令入口复查。
- 已修（P2）：渲染闭包只在 `(revision, range)` 变化时调度一次 deferred 缩略图扫描并带单一 pending 标记；扫描时提供"停止"按钮；菜单 `File` 入 YAML；面板提示改存语义键（`Notice` 枚举）随 locale 重译；未选目录时 Start 文案带省略号；`ProbeConfig`/`IntervalSummary` 加 `#[non_exhaustive]`，`QueueItem` 加 `#[non_exhaustive]`；行高回退不再用 `px(56.)`；i18n 单测用互斥锁串行；UI 测试改为等桥接 `settled` 并连续跑第二批次验证交接（第二批次对已存在输出应为 Skipped）。
- 后续事项承接：GPUI workspace 的 cargo-about 归属生成已提前至 S11 + L6（生成与复核范围见 `GPUI_LICENSE_AUDIT.md`）；拖放/取消/淘汰路径的无头 Kit 测试（阶段 3 的 Kit UI 测试计划）；真机 GPU 纹理回收、透明 PNG/HiDPI、VoiceOver/IME、MAS 沙盒写权限（本阶段平台事项，需要裸机或签名构建）。

平台事项进度（2026-10-17）：

- 私有 API 扫描（macOS arm64 发布构建，虚拟机上 `nm -u` + `otool -L`）：`_CGS`/`_SLS` 符号 0 个，无 PrivateFrameworks 链接；链接的系统框架为 AppKit、Metal、CoreText、ImageIO、QuartzCore 等公开框架（GPUI 还带入 CoreLocation、CloudKit、UserNotifications，MAS 审核时要确认用途说明）。x64 构建已由 `GPUI Probe` 首次运行（main，run 38957214119）在 `macos-15-intel` 上完成：构建、`ready`（2.37 s，冷缓存 runner）、私有符号 0 个；arm64 runner 同样通过（`ready` 3.03 s）。
- Linux aarch64 探针（本机 OrbStack Debian，Xvfb + lavapipe，debug 构建）：启动、导入 200 张、缩略图、整段三角波滚动、`probe_done` 全部完成；刷新周期估计 46 ms（软件渲染）。其余目标由手动工作流 `.github/workflows/gpui-probe.yml` 覆盖（build + 探针启动 + macOS 私有符号扫描）。PR #10 合并后的首次运行：macOS 两个架构通过；Windows x64/ARM64 编译 `vswhom-sys` 时找不到 `cl`（缺 VS 开发环境导入步骤）；Linux x86_64/aarch64 构建通过但 lavapipe ICD 路径列表含不存在的文件导致 `vkCreateInstance` 失败。两处都是工作流问题而非应用问题。经 PR #11/#12/#13 三轮工作流修复（VS 开发环境导入、Windows 短目标目录规避 MAX_PATH、ARM64 用 clang-cl、Ubuntu 的 lavapipe ICD 文件名、产物暂存进工作区、Linux 自管 Xvfb），第四次运行（run 39008501338）六个目标全部通过：启动就绪 Windows x64 331 ms、Windows ARM64 279 ms、Linux x86_64 1.70 s、Linux aarch64 0.99 s、macOS arm64 1.96 s、macOS Intel 4.21 s（都是冷缓存 CI runner，Linux 为 Xvfb + lavapipe 软件渲染，只证明"能启动并出帧"，不作性能数据）；macOS 两个架构私有符号均为 0。G2 的"六平台探针全部启动成功"与"私有 API 扫描为空"两项据此满足，尚未满足的只剩 VoiceOver、IME、沙盒授权冒烟三项人工事项。
- VoiceOver/辅助功能树：虚拟机里通过 `osascript` 读取 System Events 的 UI 元素被 TCC 拒绝（"osascript 不允许辅助访问"），需要有人在虚拟机的"隐私与安全性 → 辅助功能"里给终端/`sshd` 授权一次，之后可以无人值守地校验按钮名称与角色；IME 候选框定位同样需要人工。
- 代码已作为 PR #10（分支 `feat/gpui-stage1-2`，基于 `main` 的 7 个提交）提交评审。

G2/R11 原生验收及修复（2026-10-19，分支 `feat/gpui-g2-acceptance`，未收口）：B2b 已按用户授权合并 PR #33（main `c35d3c7`）。修复 `ScopedResource::started()` 的状态误报，3 项 macOS 原生回归及旧 getter 负向验证通过。用户确认专用账号并授权辅助功能后，在 macOS 13.6 arm64 实际发现并修复设置分组/滑块名称缺失、下拉选项无辅助文本及最低质量 Off 无法递增；原生动作、键盘与忙碌保护共用既有模型入口。真实拼音逐键输入的候选、确认和 Escape，以及窗口缩放时定位已取得辅助树证据。启用 App Sandbox 的本地 ad-hoc 签名 GPUI 候选已完成选择器导入和选输出转换；这不是正式 MAS 签名或 TestFlight 验收。实际朗读、连续录屏和剩余沙盒矩阵仍待完成，详见 `GPUI_G2_ACCEPTANCE.md`，G2 不关闭，不提前推进 D1a/C1 或阶段 4/5。本地根 workspace 397、GPUI 89（含 shell UI 31）、前端 161 项及 clippy/check/build、许可证/护栏通过；review 发现的质量步进 P2 已修复复核。最终候选、CI/review 与剩余人工项以 PR #34 记录为准。

G2 后续（2026-10-19，`fix/gpui-g2-native-input`）：#34/#35 已合并，继续修复实际 VoiceOver 导航遗漏的队列文件名、来源事实和逐项状态原生节点，保留原布局。双语六态组件回归与原生朗读复测分别记录；IME 移动中候选停留已在同机 Cocoa NSTextField 对照复现，不引入未证明有效的依赖补丁。完整原生矩阵与连续录屏仍未齐，G2 保持开放，详见 `GPUI_G2_ACCEPTANCE.md`。

G2 IME 记录（2026-10-19，`test/gpui-g2-ime-evidence`）：#36/#37 已合并（main `fd630b2`）。连续视频已核对逐键组合、退格、确认、翻页/取消及移动/缩小、滚动后重新组合；原生脚本避免把字母输入或普通浮窗当作通过。组合中打开对话框的候选滞留由不含业务回调的 Kit 例程复现，未通过；不完整且实际无效的平台实验未接入，见 `GPUI_IME_REPRO.md` / `GPUI_PATCHES.md`。VoiceOver 连续记录、该焦点问题及剩余沙盒事项尚未齐，G2 不关闭。

门槛 G2：只比较 PoC 已覆盖的同等功能（导入、队列、缩略图、转换、取消）与相同数据集，统一"可交互"就绪点、缓存状态与进程树内存口径；在此口径下不劣于基线且空闲内存降低 ≥ 25%（PoC 结论，完整功能性能结论只由 G3/G4 给出）；六平台探针全部启动成功；私有 API 扫描为空；VoiceOver、IME、沙盒授权冒烟通过。未达标则停止迁移，回到 Tauri 并反向移植虚拟列表与缩略图 LRU。

### 阶段 3：macOS 功能对等（8–10 周）

- 功能清单以 `src/lib/state.svelte.ts` 的状态机与 17 个命令为准逐项核对：设置栏、工作流预设、对比预览、PDF 导入、HEIC helper 选择与插件诊断、环境影响面板、隐私/法律对话框、更新对话框、剪贴板导入、逐项格式、覆盖询问、扫描取消、临时文件清理、错误本地化。
- 设置兼容（§3.5）含往返、崩溃注入、并发写测试；更新器接入并完成 §3.6 升级矩阵中 Linux 两项的验证（在 Linux 上做，不等阶段 4）。
- Developer ID 签名 + 公证 + staple，x64 与 arm64 各一。
- MAS 构建脚本迁移，通过 App Store Connect 校验，并做一次 TestFlight 实机沙盒验收。
- Kit UI 测试覆盖每个对话框与主流程；像素敏感性测试接入 macOS 与 Linux CI；真实 GUI 自动化在 macOS 跑通。
- 每个屏幕完成前过一遍 `gpui-kit-design-guides` 的无障碍清单（键盘可达、焦点可见且 overlay 后恢复、控件有可访问名称、状态不只靠颜色、长译文与大字号可用）与设计评审清单八问，并在 PR 中记录。
- 对完整候选重跑阶段 0 测量。

进度（2026-10-17，首片：设置持久化，未经 Codex 评审）：

- 已实现 §3.5 的读写规则：`imgconvert-platform` 新增 `paths`（与 Tauri 同一 `dirs::data_dir()` 解析）、`settings`（`Settings`/`WorkflowPresetSnapshot`/`CustomWorkflowPreset` 类型，camelCase 序列化，`#[serde(flatten)]` 保留未知键；`normalize` 逐条移植 `normalizeSettings` 及后缀、转换策略迁移、预设归一化四个辅助函数，TS 用例改写为 Rust 单测；`load` 处理残留 `.tmp` 与 `.corrupt-<ts>` 隔离；`save` 走 `fd-lock` + 一次性 `settings.json.pre-gpui` 备份 + 临时文件 `fsync` + rename）、`instance_lock`（`{pid, flavor, version}` 标记，另一 flavor 存活即 `HeldByOther`，pid 存活用 `kill(0)`/`OpenProcess` 判定）。
- 发现并纠正：Tauri 的 `settings.json` 在 Linux 上位于 `$XDG_DATA_HOME`（`~/.local/share`），不是 v0.7 表中的 `$XDG_CONFIG_HOME`；macOS/Windows 不受影响。详见 `docs/GPUI_SETTINGS_PATHS.md`。
- backend 新增 `conversion_request`：`conversion_options_for(settings, item, format, quality_floor, lossless_supported, output_suffix)` 是 `buildConvertRequest` 的移植（含 PDF 输入禁用三项跳过策略、尺寸字段按模式清零、`webpNearLossless` 只随无损 WebP、`relativeDir` 只在有输出目录时传），`conversion-options.test.ts` 的用例改写为 Rust 单测。GPUI 工作流的 `build_options` 改为经它生成，批次因此使用持久化记录里的全部转换参数（质量、尺寸、元数据策略、并发数等），`default_conversion_options` 只剩探针/smoke 使用。
- GPUI 壳：`SettingsModel`（`AppModels::settings()`）持有记录与文档，`update` 比较前后相等才通知与排程写入，300 ms 合并、最长 2 s 必写；`Quit` action 与 `on_app_quit` 都同步 flush；写失败在面板状态区以危险色显示并保留 dirty。启动 locale 取自 `settings.locale`，语言切换回写；工作流面板的格式 `Select` 与输出目录读写 `format`/`outDir`，`observe_in` 把外部修改镜像回控件。`main` 启动时写 `instance.lock`，被另一版本占用时只开一个"ImgConvert 已在运行"窗口（`Alert` + 退出按钮）。
- 测试：`imgconvert-platform` 54 个单测（含往返、备份只做一次、损坏隔离、残留临时文件重试）；shell 的无头 Kit UI 测试新增"持久化的格式与目录驱动面板并随编辑回写"与"编辑合并为一次写入、按需 flush"；现有三条 UI 测试改用内存设置模型，不碰真实用户文件。
- 未做、记入后续：0.3.x 过渡版写 `instance.lock`（Tauri 侧，随 G1 补丁；按同一协议对文件持 `File::try_lock` 独占锁）；崩溃注入与互斥启动的端到端演练（需两个安装件）；MSIX/Snap/Flatpak 路径实机核对；设置面板本身（下一片：工作流参数表单与预设）。

Codex 只读评审（2026-10-17，结论"修后可合并"，5 项 P1、9 项 P2、1 项 P3，记录在 `artifacts/reviews/codex-stage3-settings-review-2026-10-17.md`）与处置：

- 已修（P1）：`instance.lock` 改为操作系统独占文件锁（`File::try_lock`，进程退出即释放，获取原子，任何存活持有者都阻止启动，同 flavor 也算），同时消除"先查后写"竞争、pid 复用与多 GPUI 进程互相覆盖 `settings.json` 三个问题；被阻止的启动改为先于 `init_app` 判定，设置只建内存模型，不会排程写入共享文件；读取失败（非"不存在"）时本会话不持久化，不再可能用默认值覆盖原配置；两条 UI 测试的断言按实际行为修正（夹具补 `outputSuffixEnabled`，默认输出为 `one_done.avif`）。
- 已修（P2/P3）：`conversionPolicyVersion` 数值相等；JS `trim` 空白集合、UTF-16 `slice`、`String(["webp"])`、`Math.round` 四处语义对齐（含单测）；`outDir: ""` 视为假值不传 `relativeDir`；残留 `.tmp` 只在"完整 JSON 且不早于主文件"时提升，否则删除；备份经 `.pre-gpui.tmp` rename 发布；隔离文件名同秒内加 `-n`；写锁最多等 500 ms；启动时把持久化的 `heicHelperPath` 经 `set_selected_heic_helper` 重新选中（后台执行）。
- 未采纳：IO 错误（目录不可写等）导致无法建立标记时仍放行启动，原因是此时设置同样无法保存、面板已显示错误，而把应用挡在门外对用户没有额外保护；评审建议的"fail closed"记入阶段 5 打包验收时按渠道复核。

进度（2026-10-17，第二片：工作流参数表单与预设，未经 Codex 评审）：

- 平台层新增 `workflow_presets`（四个内置预设、`matching_workflow_preset_id`、`create_custom_workflow_preset`、`next_custom_preset_id`，id 生成与 Svelte 的 base36 时间戳一致）；backend `conversion_request` 新增 `effective_quality_for`、`has_invalid_target_size_configuration`、`validate_pdf_page_range`（`PdfPageRangeError` 枚举由壳翻译，`MAX_PDF_PAGES_PER_JOB = 500`），均带 TS 用例改写的单测。
- GPUI `crates/workflow` 新增 `SettingsForm` 实体：顶部常驻"格式 + 质量"（含有效质量 `80 → 85` 与"质量上限"标题切换），其下一个 Kit `Accordion`（单开）承载 10 个分区：输出行为（并发、已存在文件、后缀开关与输入、文件名模板）、压缩策略（5 个开关，说明文字随控件）、色彩管理（按 `icc_transform` 能力禁用）、结果缓存（开关 + 后台清理按钮与结果）、格式参数（JPEG/PNG/WebP/AVIF 各自的开关与滑杆、自动质量目标分、最低质量）、场景预设（内置 + 自定义选择、保存、带 `AlertDialog` 确认的删除）、PDF（页面范围校验与 DPI）、尺寸规则（模式 + 按模式显示的数字输入 + 放大开关）、目标体积、隐私元数据。每个分区标题右侧显示摘要，错误分区以危险色加图标标出；忙碌（导入/转换中）时全部禁用。
- 受控值：所有控件以 `SettingsModel` 为唯一事实来源，控件事件只报告请求值，`sync_controls` 把记录镜像回 Kit 的保留状态（`syncing` 标志防止镜像被当作编辑；获得焦点的文本框不被覆盖，后缀框例外以显示实时归一化）；语言切换时重建选择项标签与占位符。数字输入在 Enter/失焦时按 `setNumber` 语义解析、四舍五入并夹取；后缀输入实时归一化并给出"已调整/必填"反馈。
- 工作流面板改为"设置滚动区 + 固定决策区"（输出目录、进度、状态、开始/取消），宽度 `w_96`；Start 在目标体积配置无效或 PDF 页面范围无效时拒绝并提示。
- 测试：shell UI 测试新增"每种可写格式下 10 个分区都能在真实窗口渲染；开关点击写入记录；目标体积在 AVIF 下被拒、在 JPEG 下关闭自动质量与无损；应用/保存/删除预设；数字夹取与百分比上限；AVIF + 目标体积为无效配置"。
- 未做、记入后续：Tauri 侧 `FormatSelect` 的来源格式提示与 HEIC helper 选择、插件诊断、环境影响面板（属于后续切片）；滑杆的无头指针拖动测试（Kit 滑杆无 `id`，键盘路径已测）；设置面板的无障碍清单人工过一遍（VoiceOver 仍待虚拟机授权）。

Codex 只读评审（2026-10-17，结论"修后可合并"，0 项 P1、7 项 P2、2 项 P3，记录在 `artifacts/reviews/codex-stage3-settings-form-review-2026-10-17.md`）与处置：

- 已修（P2）：选择项改为 `ChoiceItem { id, label }` 实现 `SearchableListItem`，`Select` 以稳定 id 为值，同名预设或与内置同名的自定义预设不再误应用；`edit` 统一在每次修改后清掉目标格式不支持的 `lossless`（覆盖格式选择与预设应用）；Start 的 PDF 页面范围校验改为与批次提交的同一集合（队列中全部 PDF 项），语法级反馈只在面板显示、不再阻止纯图片批次；数字输入在 Enter/失焦提交后显式回写该字段（即使仍有焦点）；后缀输入改为显式归一化草稿回写并对所有文本框一律跳过有焦点的同步；分区标题改为 Kit `Button`（Tab 可达、Enter/Space 切换）+ `Collapsible`，不再使用无焦点路径的 `Accordion`；滑杆外包一层带 `FocusHandle`（Tab stop）、`aria_label` 与可见焦点环的容器，支持方向键/PageUp/PageDown/Home/End；所有 `Input` 加 `aria_label`，所有 `Select` 加 `accessibility_label`。
- 已修（P3）：空字符串按 `Number("") === 0` 处理后夹到最小值；语言切换时重建选择的已提交项，辅助技术读到新语言。
- 测试补充：同名预设各自可应用；聚焦质量滑杆后按键改变记录；分区在每种格式下渲染。

进度（2026-10-17，第三片：前后对比预览，未经 Codex 评审）：

- 新增功能 crate `crates/preview`（`imgconvert-gpui-preview`）：`ComparisonPreview` 实体 + `open_comparison_preview(key, window, cx)` 用 Kit `Dialog` 承载。生成走后端 `preview::generate_preview`（与批次相同的内存工作流，最长边 1200），在 GPUI 后台执行器上持 `BatchService::execution_gate()` 运行，`PreviewState::begin()` 让新请求取消旧请求；请求号丢弃迟到结果并释放其纹理。前后 PNG 由 shared 新增的 `images::decode_png` 解码为 `RenderImage`，关闭对话框时经 `observe_release` 释放 GPU 纹理并取消在途生成。
- 对话框内容：原图与转换后两层 `img`（`ObjectFit::Contain`），转换后一层按 `reveal` 百分比裁剪（`relative(reveal)` 容器 + `relative(1/reveal)` 内图），白色分界线与"原图/转换后"角标；加载、错误、过期三种状态各自覆盖层或提示条；揭示滑杆同样套键盘容器；四格统计（前后尺寸、预计体积与实际质量、目标体积是否达成）与转换警告列表（`conversion::warning_texts` 移植 `formatConvertWarning`）。
- 过期判定：观察 `SettingsModel`，以 `workflow_snapshot` + PDF 参数的 JSON 作签名，与打开/刷新时的基线不同即标记过期；队列项被移除时自动关闭。
- 队列行新增"前后对比"幽灵按钮（忙碌时禁用），通过 `QueueViewEvent::ComparePreview` 交给 shell 路由，功能 crate 之间不互相依赖；护栏脚本把 `preview` 纳入分层检查。`Services` 增加 `PreviewState`。批次与预览共用的 `options_for_item` 移到 shared `conversion`。
- 测试：UI 测试点击行按钮打开对话框，驱动一次真实生成（1×1 PNG → 默认 AVIF），断言尺寸、体积、图片就绪；改质量后标记过期，刷新后清除；关闭全部对话框后实体被释放。
- 未做、记入后续：PDF 项的逐页预览选择（当前预览选区首页，与 Tauri 一致）；预览图在 HiDPI 下的像素级核对与 10k 队列下的内存观察（阶段 3 平台事项）。

Codex 只读评审（2026-10-17，结论"修后可合并"，1 项 P1、5 项 P2，记录在 `artifacts/reviews/codex-stage3-preview-review-2026-10-17.md`）与处置：

- 已修（P1）：生成改在专用 `std::thread` 上等待执行门与跑原生编码，GPUI 后台执行器只以 50 ms 定时轮询 `is_finished` 后 `join`，不再占用共享工作线程；`refresh` 在加载中直接返回，刷新按钮加载中禁用；进入执行门前后各检查一次取消；线程 panic 经 `join` 转为错误文案而不是杀死执行器工作线程。
- 已修（P2）：设置观察器不再因加载中而忽略变化，结果落地时再比对一次签名，生成期间的改动会让落地结果直接带过期提示；批次开始时取消生成并关闭对话框（对应 Svelte `convertAll` 先关预览）；对话框正文改为 `overflow_y_scrollbar` 的有界滚动区，舞台高度与正文上限随窗口高度；揭示滑杆与设置表单的滑杆一样只在启用时才是 Tab stop 并处理按键。
- 未采纳/受限：Kit 0.7.1 的 `Slider` 没有可访问名称 builder，名称仍挂在可聚焦容器上（已在代码注释中说明，随 Kit 升级复查）。
- 测试补充：改用行按钮打开的那个对话框实体；加载中二次刷新不重复提交、加载中改设置后落地结果过期、禁用时按键不改变揭示值。

进度（2026-10-17，第四片：开始前的输出安全决策与覆盖询问，未经 Codex 评审）：

- 此前 GPUI 的 Start 直接把持久化的 `overwrite` 交给后端，`ask` 模式下后端会以"输出已存在（需要确认覆盖）"报错而不是询问。现在 Start（用户路径）先在工作线程上跑 `convert::conversion_plan`，再按 Svelte `applyOutputSafetyDecisions` 的顺序走提示：与队列中其他输入同名的输出先报一次（继续其余 / 取消）；`ask` 模式下逐个已存在输出询问（覆盖/跳过，与原图同一文件时用"可能覆盖原图 / 确认覆盖原图"的措辞，多页 PDF 用页数措辞），不存在的输出直接设为 skip；非 `ask` 模式下与原图同一文件的输出按模式处理（`skip` 只告知，`overwrite` 需明确确认并只对这些任务设置 `allow_source_overwrite`）。全部回答后才 `start_batch`；关闭按钮或 Escape（仅取消类提示）视为放弃。规划期间 Start 禁用并显示"正在检查输出路径…"。
- 实现：`crates/workflow/src/output_safety.rs`（`PendingStart` + `next_prompt` 状态机 + 用 Kit `AlertDialog` 回调续跑的 `advance`，每个对话框只接受一次回答，`on_close` 仅在未回答时放弃）；shared 新增 `tasks::run_blocking`（专用线程 + 执行器轮询），对比预览也改用它。探针与测试用的 `start_with_output_dir` 保持无提示路径。
- 测试：`next_prompt` 的单测（ask 只问已存在的输出、冲突优先、按模式处理原图碰撞）；UI 测试：ask 模式下 Escape 不算回答、"跳过"保留旧文件、"覆盖"替换；skip 模式下输出即原图时出现一次告知提示并跳过；无需确认时不出提示直接开始。

Codex 只读评审（2026-10-17，结论"需修改"，3 项 P1、2 项 P2、1 项 P3，记录在 `artifacts/reviews/codex-stage3-safety-review-2026-10-17.md`）与处置：

- 已修（P1）：规划完成后在实体更新之外调用 `advance`，无提示直开不再触发 GPUI 的嵌套更新 panic；面板持有待开始状态（`PendingHandle`：决策状态 + 队列 `revision` + 设置快照），队列结构变化、导入开始或设置被改时关闭提示并放弃（提示"队列或设置已更改，请重新开始"），提交前再核对一次；`AlertDialog` 加 `.confirm()`，否则 Kit 0.7.1 不显示第二个按钮。
- 已修（P2）：Kit 把 Escape 路由到第二个按钮，因此"跳过"类提示关闭键盘关闭（`keyboard(false)`），Escape 不会悄悄回答"跳过"；取消/放弃类提示保持 Escape = 取消；每个对话框只接受一次回答；面板自己持有并清理待开始状态，不再只依赖 `on_close`。
- 已修（P3）：`tasks::run_blocking` 保留 panic 载荷文本并带线程名。
- 未做：Kit 的 `AlertDialog` 默认不允许点遮罩关闭，进度块中"遮罩关闭视为放弃"的描述据此修正为"关闭按钮/Escape"。

进度（2026-10-17，第五片：插件诊断与 HEIC helper 选择，未经 Codex 评审）：

- 新增功能 crate `crates/diagnostics`：`PluginDiagnostics` 实体 + Kit `Dialog`，工具栏"插件诊断…"按钮打开（shell 路由）。内容按 Svelte `PluginDiagnosticsDialog` 的分区移植：HEIC 状态（启用/未启用、扩展名、禁用原因、激活 provider 卡片）、探测摘要六格、许可与渠道边界说明、系统 codec、手动 helper（选择…/清除、已选路径与诊断）、系统 helper、manifest 搜索目录与各 manifest 状态。状态芯片以文字表意，颜色与图标只作强化。
- 数据：`external_codecs::codec_diagnostics()` 与 `set_selected_heic_helper()` 都经 `tasks::run_blocking` 在专用线程上执行；请求号丢弃过期结果；加载中不重复探测。选择 helper 用 `PromptKind::SingleFile` 的原生文件选择器，之后像 Svelte 一样把 provider 解析出的路径（不可用时保留所键入路径）写入 `heicHelperPath`，再重新探测；启动时 shared `services::init` 已会把持久化的路径重新选中。诊断消息按 code 翻译，`detail`（路径、主机信息）只在 debug 构建显示，与 `diagnosticDetailForDisplay` 一致。
- 测试：UI 测试从工具栏打开对话框、等待探测完成并核对 `heic.enabled` 与 `external_codecs::heic_available()` 一致、选择一个不存在的 helper 后设置被写入且诊断为"不可用"、清除后设置为空。
- 未做、记入后续：环境影响面板（`runtime_diagnostics`）；Windows WIC 探测项只能在 Windows runner 上人工核对显示。

Codex 只读评审（2026-10-17，结论"需修改"，0 项 P1、3 项 P2、3 项 P3，记录在 `artifacts/reviews/codex-stage3-diagnostics-review-2026-10-17.md`）与处置：

- 已修（P2）：helper 选择的持久化改为直接经设置实体写入，对话框在工作线程结束前关闭也不会丢（进程内 helper 与下次启动一致）；探测进行中的刷新请求记为待办并在当前探测结束后补做，选择/清除 helper 后的重新探测不再被旧快照吞掉；对话框内容 id 改为 `plugin-diagnostics-view`，与工具栏按钮不再同名（原测试会因 ambiguous ElementId 失败）。
- 已修（P3）：路径与参数改为换行显示而不是截断；状态芯片区分"失败"（拒绝/不受信任/不可读，危险色 + 图标）与"缺失"（中性）；zh-CN 文案把 helper/provider/manifest/codec 统一为辅助程序/提供方/清单/编解码器，保留 ImageIO、WIC 等标识符。
- 测试补充：选择 helper 后立刻关闭对话框，设置仍被写入。

进度（2026-10-18，第六片：视觉方案“液态玻璃”落地）：

- 设计决策：用户在 14 个风格参考与 3 个液态玻璃变体中拍板——浅色用 9A Clear 清透、深色用 9B Obsidian 黑曜石、借鉴 9C 的底部悬浮操作栏（设计画布 F1/F2 为高保真，F3 为 token 表）。
- 主题层（shared `theme` 模块，裸色值只允许出现在这里和 `themes/imgconvert-glass.json`）：两份 Kit `ThemeConfig`（`ImgConvert Glass Light` / `Dark`，radius 10、radius.lg 16）注册进 `ThemeRegistry` 并替换 Kit 的默认浅/深主题；`theme::install` 在 `gpui_kit::init` 与 services 之后调用，按持久化的 `theme`（跟随系统/浅/深，跟随系统取窗口外观并经 `observe_window_appearance` 跟随切换）调用 `Theme::change`，把 `reduceMotion` 映射到 GPUI 的 `set_reduce_motion`，并观察 `SettingsModel`——模式或主题名未变时不重载，所以逐键编辑设置不会触发主题重载。深色的主按钮通过 `tokens.primary` 携带竖向渐变（颜色仍为实色供文字与边框使用）。
- 应用自有 `GlassTokens`（Global，按模式解析）：光斑背景、玻璃面板填充/描边/顶部内高光/外阴影、悬浮操作栏表面与阴影、主按钮光晕；`GlassStyled` 给任意元素 `glass_panel` / `glass_bar`。gpui-pre 0.3.8 没有径向渐变与模糊，背景改为 CPU 生成的 192×120 高斯光斑 `RenderImage`（Bayer 抖动防色带），按模式缓存一次，以 `ObjectFit::Cover` 铺满窗口；因此 Windows/Linux 没有系统级模糊时表现一致。
- 主窗口：背景图层之上是透明工具栏（胶囊幽灵按钮）、队列玻璃卡（圆角内裁剪，行改为圆角悬停面、第二行显示像素尺寸·页数·来源文件夹而不是完整路径）、设置玻璃卡（在操作栏之上结束）；输出文件夹、状态/进度与开始/取消移入新的 `ActionBar` 实体（workflow crate），由 shell 以绝对定位浮在底部居中，队列列表底部预留 `ACTION_BAR_CLEARANCE` 让末行能滚到操作栏之上。`WorkflowPanel` 只剩标题与滚动的设置表单，仍是开始决策（规划、安全提示、提交）的所有者，操作栏通过实体调用它。
- 设置表单新增“外观”分区：主题 `Select`（跟随系统/浅色/深色）与“减少动画”开关，写入同一条记录，与 Tauri 的 `theme` / `reduceMotion` 字段互通。
- 测试：shared 单测（偏好与系统外观的解析、主题文件声明两种模式、背景图尺寸）；UI 测试新增“主题偏好与减少动画随设置记录变化”（Dark→名称与 Glass 模式切换并能渲染一帧，reduceMotion→`cx.reduce_motion()`，无关编辑不改主题名）、空队列时操作栏的状态与输出目录文案、外观分区渲染并写入；原有测试沿用 `workflow-start` / `workflow-output-dir` / `workflow-status` 等 id。
Codex 只读评审（2026-10-18，结论"修后可合并"，0 项 P1、5 项 P2、1 项 P3，记录在 `artifacts/reviews/codex-stage3-glass-review-2026-10-18.md`）与处置：

- 已修（P2）：按评审的 sRGB 合成估算提高对比度——浅色 `muted.foreground` 改 `#5b6471`、主色改 `#0071e3`（白字 ≥4.5:1）、危险色改 `#d93036`，深色 `muted.foreground` 不透明度 0.55→0.70；输出目录按钮加本地化 `accessibility_label`（命令 + 当前目录）；状态文本截断时提供完整 tooltip；队列行以完整路径为 tooltip，元信息行保持紧凑；测试改为在高窗口里强制断言"外观"分区控件可见并点击开关、用 `radius` 哨兵证明无关编辑不重载主题、语言切换后操作栏文案跟随。
- 已修（P3）：输出目录为根目录（无 basename）时显示完整路径而不是"未选择"。
- 未做：真实 `Select` 的确认/Escape 交互与系统外观事件测试（测试平台没有外观切换入口），随 Kit 测试 API 复查。
- 未做、记入后续：Kit 对话框（预览、诊断、安全提示）仍是实色弹层，按设计评审“同类弹层同一处理”保留；滑杆/开关等 Kit 控件只吃主题色，没有做玻璃化；悬浮操作栏在 760 px 最小宽度下的截断只做了 `max_w` 约束，待 Windows/Linux 探针截图核对；无障碍清单人工项（VoiceOver 下操作栏朗读顺序）待虚拟机授权。

进度（2026-10-18，第七片：存储与环境情景面板）：

- 来源：Tauri 侧的 `EnvironmentalImpact.svelte` 与 `desktop-impact.ts` 仍在 web 线工作树里未提交，其模型 `@imgconvert/environmental-impact`（v1.0.0）只存在于 web 线。因此先把模型移植为 `imgconvert_backend::environmental_impact`：`measure_byte_reduction`、`estimate_storage_impact`、`calculate_conversion_impact`、`scenario_assumptions`（0–3650 天，副本 0 表示模型默认的 1–3 范围）、`format_impact_range`（三位有效数字、整段同一单位，`2.96–17.7 mg CO₂`）、`summarize_measurements`（批量净变化，大输出抵消小输出）、`STORAGE_IMPACT_MODEL_V1` 元数据与来源；字节数仍按 JavaScript 安全整数上限拒绝，vitest 用例改写为 12 条 Rust 单测（含与 Intl 一致的有效数字格式）。
- 数据：`ItemStatus::Done` 新增 `comparable`（后端 `environment_comparable` 且恰好一个输出且无跳过页），与 `captureDesktopImpact` 一致；批量口径 = 已完成且可比较的结果之净值，`excluded` = 其余已完成结果。
- GPUI：新功能 crate `crates/impact`（`ImpactView` + Kit `Dialog`）。内容按 Svelte 面板：字节变化行、边界说明、"存储情景"选择（本地/云）、云情景下的原文件状态、保留天数、副本数三个控件与结果区（估算 / 无净减少 / 原图保留 / 天数无效），"方法与来源"折叠区用 `Link` 打开两处来源。参数只存在实体内，关闭对话框即丢弃，不写设置。入口：队列行已完成项的"存储情景"按钮（`QueueViewEvent::EnvironmentalImpact`），以及批次结束且有可比较结果时操作栏的"批量情景…"（`ActionBarEvent::BatchImpact`），均由 shell 路由。`Choice`/`ChoiceItem` 从设置表单移到 shared `choice`，两处共用。
- 测试：UI 测试跑一次真实 PNG→PNG 批次，核对行按钮出现、对话框打开、本地情景无估算、云情景给出估算或"无净减少"、保留原图与无效天数的结果、关闭后实体释放、批量入口的 (1, 0) 计数。
Codex 只读评审（2026-10-18，结论"修后可合并"，0 项 P1、4 项 P2、3 项 P3，记录在 `artifacts/reviews/codex-stage3-impact-review-2026-10-18.md`）与处置：

- 已修（P2）：`format_significant` 改为与 `Intl.NumberFormat` 一致的实现——按十进制值四舍五入（半数远离零）、整数位也按有效数字舍入、千位分组（`12,300`、`1.13`、`9.996 → 10`），区间两端舍入后相同即合并；测量行改用模型自己的 `format_binary_bytes`（三位有效数字 + KiB/MiB 标签，`126464 B → 124 KiB`），其余界面保留原格式；"方法与来源"按钮加 `accessibility_label`；UI 测试在断言释放前先 `drop` 自己的实体句柄并推进关闭动画，再验证重开后参数恢复默认、测量行随语言切换。
- 已修（P3）：对话框宽度改为 rem；模型的记录类型加 `#[non_exhaustive]`；新增 impact crate 单测覆盖混合批次（可比较、净增大、多输出文档、不可比较栅格）的净值与 `excluded` 计数。
- 未做：通过真实 `Select` 确认事件驱动参数的测试（Kit 测试 API 对 Select 弹层的操作尚未梳理，setter 路径与订阅路径共用同一状态字段）；Escape 关闭与焦点恢复沿用 Kit `Dialog` 的既有行为。
- 未做、记入后续：Svelte 行内面板改为对话框是有意的（虚拟列表定高）；`estimateDailyAccumulationImpact`（网页侧的累计情景）未移植，桌面端不展示；Tauri 侧该面板本身尚未合并，合并时应改用同一后端模型（Tauri 命令或共享 crate）以免两套口径。

门槛 G3：`docs/RELEASE_QA.md` macOS 条目全部通过；两架构 DMG 公证完成；MAS PKG 校验与 TestFlight 验收通过；完整候选测量不劣于基线。失败回退：继续发布 Tauri 0.3.x；设置备份保证降级可读。

### 阶段 4：Windows 与 Linux（6–7 周）

- Windows x64/ARM64 各用原生 runner；NSIS 与两个语言 MSI；MSIX；WIC 系统编解码回归；中文 IME；NVDA 冒烟；每个安装件做干净安装、覆盖升级、卸载。
- Linux x86_64/aarch64：deb、rpm、AppImage；Flatpak、Snap；Wayland 与 X11；无 GPU 探测；portal 文件选择；GLIBC 基线。
- Windows ARM64 与 Linux aarch64 真机或等价环境验收。
- 各平台对完整候选重跑基线测量。

门槛 G4：每个"系统×架构×包型×语言"组合有安装、升级、卸载记录；Windows 两项 updater 升级验证通过；渠道编译隔离对最终包验证生效；产物名与 allowlist 一致；各平台测量不劣于各自基线。

### 阶段 5：发布链路与切换（6–8 周）

workflow 处置表：

| workflow | 处置 |
|---|---|
| `ci.yml` | 增加 GPUI 构建、Kit 测试、新 lockfile 的 deny/audit/about |
| `macos-smoke.yml`、`macos-intel-smoke.yml`、`windows-smoke.yml` | 改为构建 GPUI 直发包并跑无头 smoke + GUI 自动化 |
| `macos-release.yml`、`macos-notarization-finalize.yml` | 改为新 DMG |
| `macos-mas-release.yml` | 改为新 MAS 脚本 |
| `release-linux.yml`、`linux-release-assets-finalize.yml` | 改为新 deb/rpm/AppImage |
| `windows-release-assets-finalize.yml`、`windows-store-release.yml` | 改为新 MSI/NSIS/MSIX |
| `release-updater.yml`、`updater-upgrade-smoke.yml` | 改为新清单格式；AUR/AppImageHub 准备步骤随迁 |
| `snap-store-release.yml`、`snap-store-metadata.yml` | 清单改为纯 Rust 构建；metadata 不变 |
| `browser-extension-release-assets-finalize.yml` | 不变，图标路径改 `assets/brand` |
| `github-release-publish.yml` | 不变；仍是唯一解除 draft 的入口 |
| `pages.yml` | 不变 |

脚本迁移：`github-release-assets.mjs`、`windows-release-assets.mjs`、`github-release-evidence.mjs`、`verify-complete-github-release.mjs`、`verify-github-release-publication.mjs`、`generate-tauri-updater-manifest.mjs`（改名）、`prepare-*-release.mjs`、`check-platform-release-guardrails.mjs`；保留每 tag 的共享附件与发布锁。

- 文档：`AGENTS.md`（条款不变，仅更新产物名与验证脚本名）、`docs/RELEASE_QA.md`、`packaging/*/README.md`、`docs/CROSS_PLATFORM_DESKTOP_PLAYBOOK.md`（WebView2 章节退役）、`docs/UPDATER.md`。
- 0.4.0 Release 草稿集齐全部平台产物、扩展 zip、`SHA256SUMS`、来源证据；`github-release-publish.yml` 现有流程不变：先 `verify-github-release-publication.mjs` 做来源/字节验证并写快照，再复查快照后解除 draft。
- 回退演练：公开前按 §3.6 回退表，对每种直发包型各演练一次"撤回 `latest-v2.json` + 按包型回退到 0.3.x + 恢复设置备份"；Snap/Flatpak 在测试频道演练 revert；MSIX/MAS 以 hold-back 和分阶段发布代替演练。

门槛 G5：`AGENTS.md` 全部直发要求满足；全部已分发 updater 渠道跨框架升级复验通过；每种包型回退演练通过；MAS 与 Microsoft Store 提交完成（审核结果不阻塞 GitHub 公开）。

### 切换后

- Tauri 0.3.x 维护线保持可构建，直到以下三项都有证据：旧客户端跨框架升级成功、GPUI 0.4.x 的下一次自动更新成功、回退演练通过。维护期允许迁移回归修复，不限于安全修复。
- 满足后删除 `src-tauri`、`src`、`e2e-desktop`、Tauri 配置；删除前重跑阶段 1 的旧路径引用扫描，确认生产代码、脚本、测试、打包清单零命中，并运行 Web/PWA/扩展构建与全部发布校验脚本。

总计约 28–36 周（约 7–9 个月），含预留。不作为交付承诺。

## 5. 风险登记

| 风险 | 影响 | 应对 |
|---|---|---|
| 上游 GPUI 对非 Zed 需求不保证合并；Kit 每 1–2 周一版并含破坏性变更 | 持续升级成本 | §3.1 锁定；每季度升级窗口；业务代码零 GPUI 依赖 |
| 新依赖图（gpui-pre、Kit、packager、updater）的许可证与漏洞 | 违反许可证规则或带入漏洞 | 阶段 1 起纳入 deny/audit/about；白名单核对未完成前不进阶段 2 |
| 无障碍：AccessKit 只在快照内，Zed 自身仍关闭；Kit 文档明确无头断言不证明朗读 | 用户投诉 | 每里程碑 VoiceOver/NVDA 人工验收；自定义 Element 必须给角色与名称 |
| Linux 无硬件 Vulkan，或渲染器初始化失败时无法显示提示 | VM 与旧机器用户流失 | §3.2 窗口前探测与外部提示；Web 版兜底 |
| MAS 私有 API 扫描误判/漏判；沙盒授权路径变化 | 商店渠道阻塞 | 扫描只作预检；TestFlight 实机为准；阶段 2 验证授权路径 |
| 更新器密钥或包格式不兼容 | 老用户无法自动升级 | §3.6 升级矩阵；过渡版本 |
| 安装身份不一致 | 并存旧应用、丢设置 | §3.6 身份表；每安装件覆盖升级测试 |
| 预览颜色、alpha、HiDPI 差异；Kit 未文档化 `RenderImage` 的预乘与缩放 | 对比预览失真 | §3.3 样本与验收；阶段 2 实测后固定转换规则 |
| Linux/Windows CJK 字体回退未文档化 | 中文显示缺字或行高异常 | §3.3 字体策略；阶段 2 探针 |
| GPUI 默认图片缓存无上限且缓存失败结果 | 大队列内存增长、失败不重试 | §3.3 自定义 `ImageCache` 与 `remove_asset` |
| 功能不对等（剪贴板、扫描取消、覆盖询问等编排被遗漏） | 用户功能退化 | 阶段 3 以状态机与命令清单逐项核对 |
| smoke 覆盖被高估 | 窗口级回归漏网 | §3.7 三类证据分别记录 |
| 失去 WebDriver E2E | 回归覆盖下降 | Kit 测试 + GUI 自动化 + 人工清单 |
| 最低 macOS 10.13 → 12.0 | 少量老机器用户 | 发布说明；0.3.x 继续可下载 |
| 单人维护两套 UI 窗口期长 | 迁移拖延 | Tauri 线 G1 后冻结新功能，但保留回归修复 |
| 参考项目许可证污染 | 法律风险 | 只看思路；复制前过 `THIRD_PARTY_LICENSES.md` 流程 |

## 6. 已确认的决定（用户 2026-10-12 全部接受）

1. macOS 直发最低版本从 10.13 提到 12.0。10.13–11 用户停在 Tauri 0.3.x，由 §3.6 的 `minimum_system_version` 护栏阻止其收到 0.4.x。
2. 阶段 2 门槛 G2 不达标即停止迁移，回到 Tauri 并反向移植虚拟列表与缩略图 LRU；G2 是迁移的退出条件。
3. 更新器密钥或包格式不兼容时，在 0.3.x 侧发由旧信任链签名的过渡版本；旧端点永久只指向过渡版本。
4. Linux 无硬件 Vulkan：有软件适配器（llvmpipe/lavapipe）时提示一次后继续运行并给出 Web 版链接；没有任何 Vulkan 适配器时拒绝启动，退出码 71 并给可读错误。
5. 切换后 Tauri 维护线按 §4"切换后"三项证据保留，不设固定时长。
6. 阶段 2 六平台探针使用 GitHub 托管 runner（`windows-11-arm`、`ubuntu-24.04-arm`），不自备机器；本地 OrbStack Linux arm64 用作 Linux aarch64 复核。
7. （阶段 0 执行中追加）基线环境为 Parallels macOS 13.6 虚拟机而非宿主机裸机，见 §4 阶段 0；GPUI 原型在同一虚拟机上对比。

## 7. 已核实事实与来源（2026-10-12）

- 官方 `gpui` 0.2.2（2025-10-22）；`gpui-pre` 0.3.8（2026-10-05，快照 `279fe070`，提交 2026-10-04）；`gpui-kit` 0.7.1（2026-10-05）；`gpui-ce` 0.2.2（2026-08-28）；`gpui-unofficial` 1.23.2（2026-10-08）。
- Kit 0.7.1 features：`default = ["component","assets"]`，`test-support`、`profiler`、`inspector`；无 `gpui-fast`。
- Kit 安装文档：开发环境 macOS 15+、Windows 10+、Linux 需 Wayland/X11 会话与 Vulkan；Rust ≥ 1.92。这是开发要求，不是运行时最低版本。
- Kit 测试文档：离屏像素渲染仅 macOS Metal；无障碍树断言不证明朗读；文本输入不模拟完整 IME。
- Kit 更新文档：Kit 不选择版本、不替换安装；macOS 需替换整个签名 `.app`；Windows 由安装器拥有；deb/rpm 由包管理器拥有。
- Zed PR #56315 于 2026-07-28 合并；VisiGrid `gpui-app/Cargo.toml` 注释记录其曾为 MAS 审核维护分叉、上游修复后回到 `v1.22.0`。
- GitComet v0.3.0（2026-10-09）资产含 macOS x86_64/arm64 DMG、Windows x86_64/arm64 MSI 与便携 zip、Linux x86_64/arm64 AppImage/tar.gz/deb/rpm。
- VisiGrid v0.53.0（2026-10-10）资产：macOS universal DMG/zip、Linux x86_64/aarch64 tar.gz、x86_64 AppImage、Windows x64 Setup/zip；无 Windows ARM64。README 与 workflow 无 Mac App Store 链接，"VisiGrid 已上架 MAS"未核实。
- SotF README 链接 Microsoft Store（9NXCMV37NXJ7）与 App Store（6754237332）；最新 v0.6.6（2026-05-15）资产只有 macOS arm64 DMG、universal PKG、Linux x86_64 AppImage、Windows x86_64 TUI。
- `cargo-packager` 0.11.8，仓库 2026-10-09 有提交；支持 DMG、deb、AppImage、pacman、NSIS、WiX；`cargo-packager-updater` 0.2.3 清单要求 `platforms.<os>-<arch>.{url,signature,format}`。
- Zed 运行要求：macOS 12+ 完全支持（10.15 部分支持）；Windows 10 1903+ 64 位；Linux Vulkan 1.3、x86_64/aarch64。

## 8. 未核实事项

- 各渠道设置文件物理路径是否与 Tauri 版一致（§3.5）：源码层面已核实（见 `docs/GPUI_SETTINGS_PATHS.md`），MSIX/Snap/Flatpak 仍待实机。
- 旧 Tauri updater 能否安装 cargo-packager 产物；minisign 密钥能否复用（§3.6）。
- GPUI 在无 Vulkan 适配器时的失败行为（§3.2）。
- 新依赖图是否满足许可证白名单（§5）。
- MSIX 下 AppData 是否被虚拟化（§3.5）。
- `RenderImage` 的预乘 alpha 与 HiDPI 处理（§3.3）。
- rust-i18n 占位符语法与 TS `{count}` 的转换规则（§3.4）。
- Linux fontconfig 与 Windows DirectWrite 的 CJK 回退行为（§3.3）。
- Kit 内置 zh-CN 组件文案的覆盖度（§3.4）。

## 9. 修订记录

G2 VoiceOver 后续（2026-10-20，`test/gpui-voiceover-acceptance`）：#41 已按用户授权合并 main `40536dc`。取得实际 VO 字幕连续视频，补空队列、合成 PNG 队列事实及英文名称更新的证据；新增有 PID/聚焦窗口/选择器/光标矩形保护的真实 VO 输出采集脚本。只读 review 的光标上下文 P2 已修复。对话框与反向切换尝试没有完成，运行/完成/告警与剩余沙盒矩阵仍开放；具体失败及证据见 `GPUI_G2_ACCEPTANCE.md`，不据此关闭 G2 或推进阶段 4/5。

2026-10-20（G2 后缀反馈）：#40 已合并 main `924a550`，CI 与 Windows 双架构 GPUI 探针整体通过。继续修复真实 IME 失焦恢复有效后缀后 Required 残留，保留空值回退与归一化保存策略，补反馈的原生可读名称及真实组件负向回归。证据见 `GPUI_G2_ACCEPTANCE.md`；这不关闭完整 VoiceOver/沙盒验收门槛，不提前推进后续阶段。

2026-10-19（G2 IME 正式源码接入）：#39 已获授权合并 main `03c54cf`。正常 GPUI workspace 选中两个本地运行时源码覆盖，保持 core/macOS 0.3.8 与 Kit 五包 0.7.1；仅复制必要源码、构建资源、manifest 和许可，不引入整个 Kit 框架。来源按原始发布归档加已评审差分逐字节核验，锁版本不变；实际路径/版本检查接入 CI。普通构建与原生回归证据见 `GPUI_G2_ACCEPTANCE.md`，来源/退出条件见 `GPUI_PATCHES.md`。这完成修复接入，仍不代替完整 VoiceOver、沙盒撤权等 G2 验收，不提前启动后续阶段。

2026-10-19（G2 owner / 原生会话调查）：PR #38 已按用户授权合并；上游最小复现已获明确授权提交为 [longbridge/gpui-kit#3605](https://github.com/longbridge/gpui-kit/issues/3605)，不附账号路径或原始媒体。新增隔离差分、锁定矩阵与 13 项 macOS owner/补帧回归；系统候选框需独立验证，产品尚未启用本地框架补丁。实验版本、真实失败与后续原生结果见 `GPUI_G2_ACCEPTANCE.md` / `GPUI_PATCHES.md`；G2 不因无头测试通过或报告提交而关闭。

v0.12（S8 实现，验证中）：新增可禁用的 app-settings 更新对话框、共享 OS/GPU 护栏、latest-v2 清单生成器与旧 latest.json 版本护栏。Linux AppImage 下载有限且验签后原子替换；双架构内部 SDK 测试用 cargo-packager 包与临时密钥，不修改生产端点。macOS/Windows 当前仅手动更新提示；不据此关闭 G1/G3 或最终发布门槛，详见 UPDATER.md。


v0.11（2026-10-18，开发方案并入）：

- 新增：`docs/DEVELOPMENT_PLAN_2026-10.md` 把本方案阶段 3 及更早的未完成项与 Filee 对照分析的采纳项合并为切片次序；阶段 4、5、切换后条款仍以本方案为准。

v0.10（2026-10-18，阶段 3 第七片）：

- 新增：§4 阶段 3 “存储与环境情景面板”进度块——模型从 web 线的 TypeScript 包移植为 `imgconvert_backend::environmental_impact`，GPUI 新功能 crate `impact`，`ItemStatus::Done` 的 `comparable` 口径。

v0.9（2026-10-18，阶段 3 第六片）：

- 新增：§4 阶段 3 “视觉方案‘液态玻璃’落地”进度块——shared `theme` 主题层、`GlassTokens`、悬浮 `ActionBar`、设置表单“外观”分区，以及 gpui-pre 0.3.8 无径向渐变/模糊时的背景实现方式。
- 说明：§2.4 “颜色只从 `cx.theme()` 读取”在本片的落点是“或产品主题层（shared `theme`）”，裸色值只允许在主题层与主题文件中出现。

v0.8（2026-10-17，阶段 3 首片）：

- 纠正：§3.5 路径表 Linux 行由 `$XDG_CONFIG_HOME` 改为 `$XDG_DATA_HOME`，依据 `tauri-plugin-store` 与 Tauri `app_data_dir` 源码；新增 `docs/GPUI_SETTINGS_PATHS.md`。
- 新增：§3.5 实现落点；§4 阶段 3 的设置持久化进度与后续事项；§8 路径项改为"源码已核实、实机待核"。

v0.7（2026-10-17，阶段 1 Codex 评审后）：

- §4 阶段 1：记录评审结论与 7 项修复（进度终态屏障、shutdown 完成信号、guard 随 worker、CI 旧路径守卫、recv 失效退出、旧 API 清理、测试补齐）。
- 阶段 1 剩余事项不变：图标迁移、0.3.x 补丁发布与三平台 QA。

v0.6（2026-10-12，阶段 0 执行后，阶段 1 首批改动）：

- 阶段 1 首批：platform/backend 两个 crate 落地，`ProgressSink`/`BatchService`/Drop guard 按 §2.2、§2.3 实现，进度记录见 §4 阶段 1。

- §6 六项决定全部由用户确认，并追加第 7 项：基线在 Parallels 虚拟机采集。
- §4 阶段 0：平台与 G0 改为虚拟机口径；startup 与 import 1k 已达标，import 10k 在虚拟机 WebKit 下停摆（`docs/GPUI_BASELINE.md` §8），manual-batch 1k 有效 2/3。
- 探针新增帧看门狗 `probe_error_frame_timeout`；脚本忽略 pnpm 10 透传的裸 `--`。


- 纠正：进度发送失败的现有语义是终止批次，不是继续执行（`convert.rs:2538`、`:6118`）。
- 纠正：插件在 `lib.rs` 注册，7 个无条件 + 1 个 feature 控制。
- 纠正：发布链路分四层，不是全部依赖 Tauri。
- 纠正：设置兼容需移植 `normalizeSettings`，不是零迁移。
- 纠正：更新清单缺 `format` 字段，不同构。
- 纠正：`src-tauri/icons` 被扩展、PWA、Snap 共享，删除前必须迁移。
- 新增：crate 依赖方向与 `external_codecs` 互引处理（§2.1）；`ProgressSink` 契约（§2.2）；任务生命周期（§2.3）。
- 新增：安装身份表、旧客户端升级矩阵、MAS 编译隔离与 universal 步骤、`macos_security.rs` 能力边界（§3.6）。
- 新增：阶段 2 六平台探针；测量方法与容差；完整候选重测；G3/G4/G5 回退；Tauri 维护线保留条件。
- 新增：workflow 处置表与脚本迁移清单（阶段 5）。
- 新增风险：供应链、渲染器初始化失败、像素一致性、功能编排遗漏、smoke 覆盖、扫描局限。
- 工期从 23–31 周改为 28–36 周（含 20% 预留）。

v0.3（第二轮 Codex 评审后）：

- 纠正：Web 站点引用的是 `src/lib/assets/app-icon.png`，Flatpak 清单直接安装 `src-tauri/icons`；两者都进入阶段 1 迁移清单。
- 纠正：直发 Linux 的 desktop 文件是 `ImgConvert.desktop`，`io.github.yeagoo.imgconvert` 只是 Flatpak/Snap 身份。
- 纠正：MSIX 已声明最低 Windows 10.0.17763；`currentUser` 是 NSIS 配置，MSI 安装范围未核实。
- 纠正：`github-release-publish.yml` 的门禁是 `verify-github-release-publication.mjs` 两次调用；`AGENTS.md` 没有 WebView2 条款。
- 纠正：保留 `IMGCONVERT_PACKAGE_CONVERT_SMOKE` 入口，否则 `smoke-windows-installers.mjs` 失效。
- 新增：事件可靠性清单含 `FileSkipped`/`FileError`；应用级接收器与窗口关闭衔接；有界通道容量与溢出策略；四类测试。
- 新增：设置写入的文件锁、备份不可覆盖、rename 失败恢复、崩溃注入测试。
- 新增：渠道编译隔离基线表；升级矩阵按 G3/G4/G5 分配；系统版本护栏；按包型的回退步骤与演练。
- 新增：旧路径引用扫描作为阶段 1 与删除前门禁；G2 可比条件。

v0.4（第三轮 Codex 评审后，未再复核）：

- 纠正：Flatpak 现状按默认 feature 构建，更新器是开的；阶段 1 修正为关。
- 修正：`ProgressSink::send` 的阻塞语义改为"协调线程有界阻塞、超时按失效处理、UI 线程从不等待"，消除"非阻塞"与"满队列阻塞"的矛盾。
- 修正：设置并发由"文件锁"改为"版本互斥运行"，因为旧 Tauri 版无法参与锁协议。
- 新增：旧端点永久指向过渡版、过渡版走新端点、Linux `ash` 探测，使护栏成为旧客户端升级的唯一路径。
- 新增：按包型的回退表，覆盖 Snap、Flatpak、MSIX、MAS；商店渠道 hold-back。

v0.5（按 `gpui-kit`、`gpui-kit-design-guides`、`rust-best-practices` skill 校对，未经 Codex 复核）：

- 纠正：像素渲染测试不是"仅 macOS"，Kit 渲染目标覆盖 macOS（Metal）与 Linux（WGPU，lavapipe 可用）；Windows 因 GPUI 0.3.8 无无头渲染器而跳过。交互测试三平台都能跑。
- 纠正：缩略图 GPU 缓存改用 GPUI 自带 `ImageCache` 机制（容量淘汰 + `drop_image`），不自建第二套 GPU 缓存；默认缓存无上限且缓存失败结果。
- 新增：`apps/gpui` 按能力拆为 shell + 功能 crate（§2）；一依赖规则、Edition 2024、workspace lints、`thiserror`/`anyhow` 分工、`#[expect]`（§2.1）。
- 新增：GPUI 侧桥接的具体形态（Global 服务、前台接收任务、`WeakEntity` 订阅、`Quit` action）（§2.3）。
- 新增：§2.4 GPUI Kit 编码规范作为 PR 检查项。
- 新增：组件选择（`Settings`、`Form`、`AlertDialog`、`Button`/`Link`）、虚拟列表以领域 id 为坐标、字体与 CJK 回退策略（§3.3）。
- 修正：i18n 接入方式（`i18n!` 位置、`extend!` 先于 `init`、`ui.yml` `_version: 2`、`refresh_windows`、占位符语法待核对）（§3.4）。
- 补充：Kit 打包文档的立场与 `LSMinimumSystemVersion` 必须显式设置（§3.6）。
- 新增：阶段 2 的 `ImageCache`、alpha/HiDPI、lavapipe、CJK 探针；阶段 3 的无障碍清单与设计评审清单门禁；三条新风险与四条未核实事项。


2026-10-20（G2 模态焦点修复，开发中）：#42 已授权合并 main `e858689`。文档 AX/键盘焦点分离及共享 handle 的 Shift-Tab 排序 P2 已定位；最小复现经用户授权提交为 [longbridge/gpui-kit#3612](https://github.com/longbridge/gpui-kit/issues/3612)，见 `GPUI_TAB_STOP_REPRO.md`。正式 vendor 已接入一行 TabStopMap 修复，差分/manifest/文件清单同步更新；原始共享 handle 与缓存重放两项回归在未修源码上失败、接入后通过，法律弹窗反向循环 UI 测试同样转为通过；Tab stop 状态切换作为不变量两边均通过。同 head CI 与 Windows/macOS probe 已完成；正常构建的原生复验及完整 VO/模态证据仍待完成，见 `GPUI_G2_ACCEPTANCE.md`。G2 不关闭，后续阶段不提前启动。
