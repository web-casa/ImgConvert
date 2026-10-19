# ImgConvert 开发方案 v3.1（2026-10-18）

> 本文把两类输入合并成一份可执行的切片计划：
>
> 1. `docs/GPUI_MIGRATION_PLAN.md`（以下称“迁移方案”，v0.10 基线）阶段 3 及之前**尚未完成**的事项；
> 2. 2026-10-18 对 Filee（`ff56a0c`，v1.11.0）与 ImgConvert（`4c2297c`）源码对照分析中**经核实后采纳**的建议。
>
> 本文不替代迁移方案：阶段 4、阶段 5、切换后条款与门槛 G1–G5 继续以迁移方案为准，这里只引用不改写。v1 经 Codex 只读评审（21 条），v2 经第二轮复核（7 条），处置见 §8。

## 0. 基线与核实

- 代码基线：`main` 头 `121295c`（阶段 3 第七片，PR #21）。文中行号均指该提交。
- 发布基线：GitHub 最新 Release `v0.3.1`（2026-09-02，非 draft，核实时间 2026-10-18）；`README.md:65`、`README.zh-CN.md:65`、`docs/public-release.json:2` 仍写 `0.2.22`。
- 迁移方案门槛状态：G0 已过；G1 代码已评审修复，待 0.3.x 三平台 QA 关闭；G2 的平台事项仍有未闭合项（§2.4）。本文任何次序都不表示 G1/G2 已满足。

### 0.1 对照分析断言的核实索引

对照分析来源为两份外部文本（未附仓库链接，Filee 侧结论以下列公开材料复核）。ImgConvert 侧断言全部在 `121295c` 上复核：

| 原断言 | 核实位置 | 结果 | 采纳编号 |
|---|---|---|---|
| 普通图片取消信号未进核心 | `crates/imgconvert-backend/src/convert.rs:1414`、`:1573`；核心 `convert_workflow_with_control` 于 `crates/imgconvert-core/src/lib.rs:1231` | 成立 | N1 |
| 新建输出直写最终路径 | `convert.rs:1373`（函数入口；`create_new(true)` 在 `:1376`） | 成立 | N2 |
| README 版本落后 | 见上 | 成立 | N3 |
| PNG 未调 APNG 检测 | `lib.rs:4751`（`decode_via_image`） | 成立 | N4 |
| AVIF 只取一帧不看 `imageCount` | `lib.rs:4984`–`:5007` | 成立 | N4 |
| GIF/WebP 探测与解码均拒绝动画 | WebP `lib.rs:3066`、`:4823`；GIF `:3296`、`:3310`、`:4920` | 成立 | N4 |
| `ImageProbe` 无动画事实 | `lib.rs:620` | 成立 | N4 |
| 无**统一的**编码器边长预检，只有 64 MP 像素预算（底层编码器自身仍有上限） | `lib.rs:42`、`:92` | 成立 | N5 |
| WebP/AVIF 编码前降到 8-bit | WebP 编码 `lib.rs:4848`；AVIF 编码 `:5066`/`:5076`/`:5118`；AVIF **解码**也固定 8-bit `:5021`；alpha 合成 `flatten_to_rgb` `:603` | 成立，且解码侧也有 | N6 |
| 正式缩放三分支皆双线性 | `lib.rs:2423`；缩略图面积过滤 `:2520` | 成立 | N12 |
| 无 EXIF 嵌入缩略图处理 | `lib.rs:3399` 附近只规范化 orientation | 成立 | N13 |
| 预设归一化重写版本 | `crates/imgconvert-platform/src/settings.rs:658`（赋当前版本在 `:683`） | 成立 | N8 |
| 768 MiB 调度预算 | `convert.rs:38` | 成立 | 不采纳换并发模型 |
| GPUI 壳 action 仅三项 | `apps/gpui/crates/shell/src/lib.rs:21` | 成立 | N9 |
| SSIMULACRA2 自动质量已存在 | 依赖 `crates/imgconvert-core/Cargo.toml:31`；调用 `lib.rs:1394`、`:1744` | 成立 | N15 |

Filee 侧复核（核实时间 2026-10-18，固定提交 `ff56a0cd1e2516516df3737d8d1cfb7ac69738dc`）：

| 断言 | 证据 | 结果 |
|---|---|---|
| 最新 Release v1.11.0，2026-10-17 发布，正文“244 formats” | `https://api.github.com/repos/KnifeLemon/Filee/releases/latest`（`tag_name`、`published_at`、`body`） | 成立 |
| Avalonia 12.1.3、Magick.NET-Q8 14.17.2 | `https://raw.githubusercontent.com/KnifeLemon/Filee/ff56a0cd1e2516516df3737d8d1cfb7ac69738dc/Directory.Packages.props` | 成立 |
| 圆环 5 s 后移交 toast，失败直接走 toast | `.../src/Filee.App/Services/RadialController.cs`（`HandOffAfter = TimeSpan.FromSeconds(5)`） | 成立 |
| 历史记录保存预设快照 | `.../src/Filee.Core/History/HistoryEntry.cs`（`Preset = failures.Count > 0 ? job.Preset.Clone() : null`） | 成立，但**只在有失败文件时** |
| 监控稳定等待 Windows 2 s、其他 5 s；去重为内存 `HashSet` | `.../src/Filee.Core/Watching/FolderWatcher.cs` | 成立 |
| CLI 退出码 0/1/2/3，`--json` 输出 | `https://filee.sh/cli` | 成立 |
| Linux 拖拽需 X11，Wayland 退回拖放区与右键 | `https://filee.sh/` Q&A | 成立 |
| ImgConvert 最新 Release 为 v0.3.1 | `https://api.github.com/repos/web-casa/ImgConvert/releases/latest`（`draft=false`，`published_at` 2026-09-02） | 成立 |

本文不复制 Filee 代码；Filee 主仓库 MIT，第三方代码引入仍走 `THIRD_PARTY_LICENSES.md` 流程，禁止 GPL/AGPL/LGPL。

## 1. 不变的约束

- 依赖方向：壳（`src-tauri`、`apps/gpui`、本文新增 `crates/imgconvert-cli`）→ `imgconvert-backend` → `imgconvert-platform` → `imgconvert-core`；backend 可直接依赖 core。GPUI 功能 crate 之间不得互相依赖，`shared` 不得依赖功能 crate（`scripts/check-architecture-guardrails.mjs:170`、`:574`）。
- Tauri 线自 G1 起冻结新 UI 功能；backend/core 的修复与能力两壳共享，本文 Track B、C 的后端改动对 0.3.x 维护线同样生效。
- **G5 放行前**，GPUI 构建与 CLI 构建只作为 CI 产物或内部测试构件，不进入任何公开 Release；`AGENTS.md` 的 Release 完整性条款（三系统六架构直发包、签名/公证、安装 smoke、来源证据、合并校验和、Windows 未签名提示）不变。阶段 3 的 macOS 验收不授权公开部分平台的 Release。
- 依赖锁：`gpui-kit = "=0.7.1"`（gpui-pre 0.3.8），升级只在季度窗口。许可证白名单以 `src-tauri/deny.toml` 为准。
- 每片流程：实现 → 根与 `apps/gpui` 的 fmt/clippy/测试 → guardrails → Codex 只读评审并修 P1/P2 → PR → CI 绿 → 用户确认后 rebase 合并。
- 有可见界面的切片过 `gpui-kit-design-guides` 的无障碍清单与设计评审清单，并在 PR 记录。

## 2. 未完成事项盘点（来源：迁移方案）

### 2.1 阶段 3 尚未开始的功能片

| 编号 | 事项 | 来源 |
|---|---|---|
| S8 | 更新器接入（`cargo-packager-updater` 清单、`minimum_system_version` 护栏）与更新对话框；完成迁移方案 §3.6 升级矩阵中 Linux 两项验证（Linux 上做，不等阶段 4）。演练只用**受控测试清单与内部产物**，不改生产更新端点 | 阶段 3 清单 |
| S9 | 剪贴板导入（位图与文件路径两类内容） | 阶段 3 清单 |
| S10 | 逐项格式（行级目标格式覆盖，受能力矩阵约束） | 阶段 3 清单 |
| S11 | 隐私/法律对话框：隐私说明与开源许可页。验收不是“文件已嵌入”，而是许可全文**覆盖 GPUI 实际构建依赖**（需 GPUI workspace 的 cargo-about 归属生成，迁移方案原定阶段 5，提前到此片）并复核原生库 NOTICE（`docs/LEGAL.md:79`–`:80`） | 阶段 3 清单 |
| S12 | 功能清单核对片：以 `src/lib/state.svelte.ts` 状态机与 17 个命令逐项核对 PDF 导入细节、扫描取消、临时文件清理、错误本地化、来源格式提示、i18n 占位符转换规则、Kit zh-CN 文案覆盖是否已被前七片覆盖，缺的补齐，出具覆盖表 | 阶段 3 清单、§8 |

### 2.2 前七片“记入后续”的事项

| 编号 | 事项 | 出处 | 性质 |
|---|---|---|---|
| R1 | 0.3.x 过渡版在 Tauri 侧写 `instance.lock`（随 G1 补丁） | 首片 | 可立即执行 |
| R2 | 崩溃注入与互斥启动的端到端演练（需两个安装件） | 首片 | 等安装件 |
| R3 | MSIX/Snap/Flatpak 设置路径实机核对；MSIX AppData 虚拟化 | 首片、§8 | 阶段 4 实机 |
| R4 | 滑杆无头指针拖动测试；真实 `Select` 确认/Escape 驱动测试；真实系统外观切换事件测试 | 第二、六、七片 | 随 Kit 测试 API 复查 |
| R5 | 无障碍人工清单（VoiceOver 朗读顺序，含悬浮操作栏） | 第二、六片 | 等虚拟机辅助功能授权；**后续平台专项**归阶段 4/5 |
| R11 | **G2 必需项**：VoiceOver 基本朗读、IME 候选框定位、MAS 沙盒授权路径冒烟（迁移方案阶段 2 门槛 G2 原文要求，未达标即停止迁移） | 迁移方案 `:346`–`:355` | 阻塞条件：虚拟机辅助功能授权、签名构建；**必须在关闭 G3、启动阶段 4 之前完成**，通过证据记入迁移方案 §4 阶段 2 |
| R6 | PDF 项逐页预览选择；预览图 HiDPI 像素级核对与透明 PNG 预乘 alpha；10k 队列内存观察 | 第三片，§8 | 部分可立即执行 |
| R7 | Windows WIC 探测项在 Windows runner 人工核对显示 | 第五片 | **归 G4**，不作 G3 条件 |
| R8 | Kit 对话框（预览、诊断、安全提示、情景）玻璃化与否的统一决定；操作栏 760 px 最小宽度截图核对 | 第六片 | 可立即执行 |
| R9 | Tauri 侧环境情景面板合并时改用 `imgconvert_backend::environmental_impact`；`estimateDailyAccumulationImpact` 不移植的决定复核 | 第七片 | 随 Tauri 面板合并 |
| R10 | 来源格式提示（Tauri `FormatSelect` 的行为）在 GPUI 的对应物 | 第二片 | 并入 S12 |

### 2.3 阶段 3 门槛 G3（迁移方案 `:467` 原文）

G3：`docs/RELEASE_QA.md` macOS 条目全部通过；两架构 DMG 公证完成；MAS PKG 校验与 TestFlight 验收通过；完整候选测量**不劣于基线**。失败回退：继续发布 Tauri 0.3.x。

为达成 G3 需要的非功能工作：

| 编号 | 事项 | 性质 |
|---|---|---|
| G3-1 | Developer ID 签名 + 公证 + staple，x64 与 arm64 各一 | 等证书与 runner |
| G3-2 | MAS 构建脚本迁移、App Store Connect 校验、TestFlight 实机沙盒验收（含重启、拒绝、取消、写权限授权路径） | 等账号与实机 |
| G3-3 | Kit UI 测试覆盖每个对话框与主流程；像素敏感性测试接入 macOS 与 Linux CI；拖放/取消/淘汰路径的无头测试 | 可立即执行 |
| G3-4 | 真实 GUI 自动化在 macOS 跑通 | 等 macOS runner |
| G3-5 | 对完整候选重跑阶段 0 测量并与基线比较，不劣于基线 | 等完整候选 |
| G3-6 | `docs/RELEASE_QA.md` macOS 条目逐项通过 | 等 G3-1/2 |

### 2.4 更早阶段遗留

| 编号 | 事项 | 出处 | 去向 |
|---|---|---|---|
| L1 | `assets/brand/` 图标迁移 | 阶段 1 | 挂到阶段 5 资源迁移，作为删除 `src-tauri` 的前置检查（迁移方案 `:507`） |
| L2 | 0.3.x 补丁发布与三平台 QA（关闭 G1） | 阶段 1 | 与 R1、S8 同期 |
| L3 | Windows Store 实跑 | `docs/ROADMAP.md:225` | 阶段 4/5 |
| L4 | ROADMAP P0.5 的 AVIF `maxThreads=1` 多核观测遗留项 | `docs/ROADMAP.md:101` | 阶段 4 测量时顺带 |
| L5 | 阶段 2 平台事项：真机 GPU 纹理回收；Windows MSI 实际安装范围（per-user/per-machine）核实 | 迁移方案 `:191`、`:346` | 阶段 4 |
| L6 | GPUI workspace cargo-about 归属生成 | 迁移方案 `:346` | 提前到 S11 |

### 2.5 迁移方案 §8“未核实事项”的去向

| §8 事项 | 去向 |
|---|---|
| 旧 Tauri updater 能否安装 cargo-packager 产物、minisign 密钥复用 | S8 |
| 无 Vulkan 适配器时的失败行为 | 阶段 4 Linux 验收 |
| 新依赖图许可证白名单 | C1 新增的根 workspace 许可证门禁（§5 C1）；GPUI 侧随 S11 |
| MSIX AppData 虚拟化 | R3 |
| `RenderImage` 预乘 alpha 与 HiDPI | R6 |
| rust-i18n 占位符与 TS `{count}` 转换；Kit zh-CN 覆盖度 | S12 |
| Linux fontconfig / Windows DirectWrite CJK 回退 | 阶段 4 验收 |
| 设置文件物理路径（MSIX/Snap/Flatpak） | R3 |

阶段 4、阶段 5、切换后三节的事项全部保留，不在本文重排。

## 3. 本次新增事项（来源：对照分析，经核实采纳）

### 3.1 已核实的缺陷

| 编号 | 事项 | 位置 | 修法要点 |
|---|---|---|---|
| N1 | 普通图片处理中不可取消。批次与文件边界已有取消（`convert.rs:2796`、`:2803`），但 `convert_with_control` 只把 token 传给 PDF 分支，普通图片走 `convert_workflow`/`convert_workflow_with_timeout`（`:1573`），核心收到 `None` | 核心接口 `lib.rs:1231`；最终输出提交在 backend `convert.rs:1625`–`:1633` | **backend 两处改动**：（a）改调 `convert_workflow_with_control` 并传 `is_cancelled` 闭包；（b）在 `write_output` 之前再查一次 token，取消则不提交。核心在解码后、每个候选编码前、SSIMULACRA2 评分前检查回调并返回 `Error::Cancelled`。backend 把 `Cancelled` 映射到现有取消终态，不经通用错误映射记为失败。单次原生编码调用不中断，文档如实说明。取消与提交的并发判定点：以 `write_output` 前的那次检查为准 |
| N2 | 新建输出直写最终路径：`write_new_output` 以 `create_new(true)` 打开目标后写入，写完前外部可见 | `convert.rs:1373` | 同目录临时文件写入 + `sync_all` 后以“不覆盖”语义提交。提交原语放在 `imgconvert-platform`（已直接依赖 `libc` 与 `windows`，二者 `MIT OR Apache-2.0`，在白名单内）：Linux `renameat2(RENAME_NOREPLACE)`、macOS `renamex_np(RENAME_EXCL)`、Windows 不带 `MOVEFILE_REPLACE_EXISTING` 且**不带** `MOVEFILE_COPY_ALLOWED` 的 `MoveFileExW`。只有原语返回“不支持”（`EINVAL`/`ENOTSUP`/`EXDEV`、`ERROR_NOT_SUPPORTED`）时改用 `std::fs::hard_link` + 删临时文件；hard-link 成功即视为已提交，删临时名失败只作清理告警。目标已存在、权限错误等**不进入降级路径**，直接返回 `OutputExists` 或 IO 错误。两种原语都不支持时返回明确错误，**不退回直写**。临时文件名纳入现有残留清理规则 |
| N3 | 版本文档落后 | 见 §0 | 先核对主仓库未提交批次是否已改；同步到 v0.3.1。PR 内的 CI 只检查 README 与 `public-release.json` 内部一致；与 Release API 的比对放到发布后/定时任务，避免历史提交因 latest 推进而失败 |

### 3.2 输入事实与编码能力

| 编号 | 事项 | 位置 | 修法要点 |
|---|---|---|---|
| N4 | 动画判定不一致（见 §0.1）。另外导入探测只读前 512 KiB 且吞掉探测错误（`crates/imgconvert-backend/src/import.rs:32`、`:858`–`:862`），转换路径也 `.ok()`（`convert.rs:1504`） | `lib.rs:620`、`:4751`、`:4984` | **分离“输入事实探测”与“可转换性校验”**：`ImageProbe`（core 内部类型，无 serde）新增 `animation: AnimationStatus { Static, Animated, Unknown }`，所有构造点同步；探测不因动画报错，只记录事实；探测预算不足或头部截断记 `Unknown`。解码入口与开始前预检拒绝 `Animated`（统一 `Unsupported`），`Unknown` 放行到解码再判。给前端的事实经 `ImportImageMetadata`（`import.rs:89`）新增字段 `animation`，旧 Tauri 前端忽略未知 JSON 字段即可；GPUI 队列行显示“动画”标记，预检计数。测试：APNG、多帧 AVIF/GIF/WebP、大于探测预算的文件、截断文件 |
| N5 | 无编码器边长预检：只有 64 MP 总像素预算 | `lib.rs:42`、`:92` | core 新增 `EncoderCapabilities { max_side, max_pixels, bit_depths, alpha, animation, lossless }` 作为 `Format` 的关联常量（WebP `max_side = 16_383`；其余按各库上限与现有预算填写）；`convert_workflow_inner` 在解码后、编码前检查并返回可读错误；默认不自动缩小，只有尺寸规则明确允许时才适配。Tauri 能力矩阵命令与 GPUI 预检都读它 |
| N6 | 精度损失不报告：WebP 编码前 `rgba8_cow()`（`lib.rs:4848`）；AVIF 编码固定 `depth = 8`（`:5066`/`:5076`/`:5118`）；AVIF **解码**也固定 8-bit（`:5021`）；JPEG 等无 alpha 目标经 `flatten_to_rgb`（`:602`） | 告警枚举 `crates/imgconvert-core/src/workflow.rs:126` | 新增 `WorkflowWarning::{BitDepthReduced { from, to }, AlphaFlattened}`。`BitDepthReduced` 记录**实际发生**的损失，源位深事实来自解码器（AVIF 解码降位深也要报，不能只在编码前看像素类型）；`AlphaFlattened` 只在存在非不透明像素且目标无 alpha 时产生。两壳按现有告警通道显示：Tauri 侧需同步 `src/lib/state.svelte.ts:2505` 的 formatter（当前对未知 code 无兜底）与双语文案，GPUI 侧同步 `app.yml`。结果缓存键纳入新告警。验收分 JPEG、WebP、AVIF、PNG 量化四条路径 |

### 3.3 自动化入口与可复用预设

| 编号 | 事项 | 说明 |
|---|---|---|
| N7 | 正式 CLI：新 crate `crates/imgconvert-cli`（根 workspace 成员，二进制 `imgconvert-cli`，不依赖 GPUI 或 Tauri） | 命令：`convert <paths..> (--to <fmt> \| --preset <id>) [--output DIR] [--recursive] [--overwrite \| --skip] [--json] [--quiet] [--no-history]`、`capabilities --json`、`presets list --json`、`version`。契约见 §5 C1。**不替代**安装包 smoke：`src-tauri/src/main.rs:17` 的 `IMGCONVERT_PACKAGE_CONVERT_SMOKE` 隐藏入口继续运行安装后的桌面可执行文件（`scripts/smoke-windows-installers.mjs:125`、`:134`，`AGENTS.md` 要求安装 smoke）；CLI 另加独立 smoke。只有 CLI 进入安装包并实际运行安装所得 CLI 后才评估替换。G5 前 CLI 只作 CI 产物 |
| N8 | 预设导出/导入文件 | 文件只含处理参数（格式、质量、尺寸、目标体积、元数据与色彩策略、格式参数）；不含输出目录、覆盖授权等本机行为。`schemaVersion` 严格解析：高于当前拒绝并提示升级；低于当前按显式迁移表；未知字段**拒绝**而非忽略。不走 `normalize_custom_workflow_presets`（`settings.rs:658`，它会把版本重写为当前值，只用于本地设置）。ID 契约见 §5 C2 |
| N9 | 系统入口与快捷面板 | 第一步：系统“打开方式”/argv/平台 open-file 事件进 GPUI（扩展 `OpenFiles`）。第二步：主窗口内可折叠的紧凑面板，列出最近 3–5 个预设与“沿用上次方案”，一键按预设开始，任务仍由 `BatchService` 持有。第三步按平台评估右键菜单（macOS Services、Windows 注册表动词、Linux desktop action）。**不做**圆环拖放菜单：依赖全局输入监听与透明置顶窗口，GPUI 无对应 API，Linux 仅 X11 可行 |

### 3.4 持久历史与自动化

| 编号 | 事项 | 说明 |
|---|---|---|
| N10 | 跨重启任务历史与失败重试 | 存于 `imgconvert-platform` 数据目录 `history.jsonl`。每条：处理参数快照（与 `WorkflowPresetSnapshot` 同构）、输入身份（路径、大小、mtime、可选内容哈希前缀）、输出路径与大小、逐文件 `ConversionErrorKind`、来源 `origin ∈ {gui, quick_panel, cli, watch}`、应用与 core 版本。**跨进程协议**：追加、恢复、压缩都持同一把 `fd-lock` 文件锁（platform 已用于设置）；压缩时持锁读取、写新文件、原子替换；启动时处理被截断的尾记录。路径、输入身份、重试参数**不截断**，只裁剪展示性详情。保留策略默认 90 天或 5,000 条（可关闭历史）。重试前核对源文件身份、输出目录可写、快照的平台能力仍满足。GPUI `QueueModel` 保持内存态，历史是只读视图加“重试”入口 |
| N11 | 监控文件夹 | 规则 = 目录 + 预设 ID + 输出目录 + 是否递归。事件先进应用级排队再交 `BatchService`。稳定判定：大小与 mtime 连续 N 秒不变 + 独占打开尝试（Windows 2 s、其他 5 s，可调），文案如实说明是启发式。跳过临时后缀（`.tmp .part .partial .crdownload .download .filepart` 等）、隐藏文件、输出目录与原件目录内文件。**去重状态与可裁剪的历史分离**：独立的 `watch-state.json`，按稳定 `ruleId` 分区，键为 `(ruleId, 路径|大小|mtime)` → 结果；不随 N10 的保留策略被裁剪，否则全量重扫会重做旧成功文件。两条规则处理同一输入互不干扰；修改监控目录生成新 `ruleId`，修改预设或输出目录保留已有成功状态；删除规则只删其分区。状态文件原子持久化（临时文件 + rename），损坏时整文件丢弃并全量重扫；“输出已提交但状态未落盘”在重扫时按输出目录已有同名文件且 `OutputExists` 处理为已成功，不重复转换。事件缓冲溢出或启动时全量重扫；失败重试有次数与间隔上限；单实例运行（随 `instance_lock`，CLI `watch` 与 GUI 互斥）。沙盒渠道（Flatpak/MAS）第一期只允许已授权目录或不提供 |

### 3.5 引擎质量（独立于壳）

| 编号 | 事项 | 位置 | 说明 |
|---|---|---|---|
| N12 | 正式路径大比例缩小改面积过滤 | `lib.rs:2423`；缩略图 `:2520` | 推广到 RGBA8/16/F32 三分支，阈值与缩略图一致；保持线性光与预乘 alpha。输出字节会变：结果缓存键加 resize 算法版本；图像质量测试与 Fuzz Corpus Replay 黄金样本更新作为独立提交并附对比图；发布说明写明。Lanczos/Mitchell 为后续评估项 |
| N13 | 画面变化后清理 EXIF 嵌入缩略图 | `lib.rs:3399` 附近 | `preserveMetadata` 模式下，旋正、缩放、灰度等像素变化后删除 IFD1 缩略图（不重建）；同步 `PixelXDimension/YDimension`；MakerNote 只识别不改写 |
| N14 | ICO/ICNS 输出 | 固定格式边界：`WRITABLE_FORMATS` 护栏精确字符串（`check-architecture-guardrails.mjs:270`、`:275`）、`settings.rs:43`、前端格式契约 | 不是“加一个 encoder”：需协调格式枚举、能力矩阵、设置与预设归一化、前端契约、护栏字符串；先定义 ICO/ICNS 的 lossless 参数、尺寸规则、跨版本预设行为；HEIC/PDF 只读边界不变。第一版只做输出：透明补方、多尺寸、ICNS 复用同尺寸 PNG。候选 crate 过许可证白名单。排在 S10 之后 |
| N15 | JPEG 源量化表作为自动质量提示 | 现有 SSIMULACRA2 自动质量 | 探测量化表指纹、质量估计与可信度、色度采样；只用于收窄搜索区间，不做 `min(源质量, 用户质量)` 硬规则。分两步：先做探测与观测，再评估是否影响搜索 |

### 3.6 明确不采纳

- 圆环拖放菜单（N9）。
- 更换图片引擎或引入 ImageMagick 系依赖。
- 纯色背景转透明、位图描摹 SVG、完整动画转码：等 N4 落地后按需求单独评估。
- Filee 按 CPU 核数的并发模型：保留 768 MiB 工作集预算调度。

## 4. 排期：五条工作线与切片次序

原则：先收口迁移，再插入自动化产品线。只有已核实的正确性缺陷（B1、B2a）插在阶段 3 功能片之前；C 线不构成 G3 前置，放在 G3 之后或 G3 的外部等待窗口（证书、runner、实机）里。单人维护时按次序串行，同一时刻最多两条线各一个切片在评审中。

| 次序 | 线 | 切片 | 内容 | 验收 |
|---|---|---|---|---|
| 1 | B | B1a | N1 取消接线（backend + core 回调） | 单测：取消后不提交输出、取消终态不记失败；两壳无接口变化 |
| 2 | B | B1b | N2 原子新建输出（platform 原语 + backend 接入）+ N3 版本同步 | 单测：写入中断无半成品可见、已存在不覆盖、不支持原语返回错误而非直写；三平台 CI 原生文件系统各跑一次 |
| 3 | A | R1 + L2 | 0.3.x 过渡版写 `instance.lock`，补丁发布与三平台 QA，关闭 G1 | 迁移方案 G1 勾选 |
| 4 | A | S8 | 更新器接入与更新对话框 | `docs/GPUI_MIGRATION_PLAN.md` §3.6 升级矩阵的 Linux 两项在 Linux 上用受控测试清单跑通；对话框 Kit UI 测试；Codex 评审 |
| 5 | B | B2a | N4 中的动画**拒绝**与 `Unknown` 放行 + N5 能力表与边长预检 | core 单测：APNG、多帧 AVIF、1,000 × 20,000 WebP、截断文件；旧功能兼容测试 |
| 6 | A | S9 | 剪贴板导入 | 位图与路径两类；Kit UI 测试 |
| 7 | A | S10 | 逐项格式 | 行级覆盖 + 能力矩阵 + 预检联动 |
| 8 | A | S11 + L6 | 隐私/法律对话框 + GPUI cargo-about | 许可全文覆盖 GPUI 实际依赖；NOTICE 复核记录 |
| 9 | A | S12 + R10 | 功能清单核对片 | 17 个命令覆盖表 |
| 10 | B | B2b | N4 的 DTO/队列标记/预检计数 + N6 告警（含 Tauri formatter 与文案、缓存键） | 四条路径验收；Tauri 旧功能兼容测试 |
| 11 | A | G2 收口 | R11（VoiceOver 基本朗读、IME、MAS 沙盒授权冒烟） | 迁移方案 G2 全部勾选，证据记入阶段 2 进度 |
| 11b | A | G3 收口 | R4、R6、R8、G3-3 可立即执行项；G3-1/2/4/5/6 随证书、runner、实机到位 | 迁移方案 G3 全部勾选 |
| 12a | D | D1a | N10 历史**存储层**：`history.jsonl` 格式、`history.lock` 协议、追加接口（C1 前置） | 双进程追加与压缩竞态、崩溃恢复 |
| 12b | C | C1 | N7 CLI 第一期 + 根 workspace 护栏与许可证门禁 | 契约测试、退出码测试、CI 产物、独立 CLI smoke |
| 13 | C | C2 | N8 预设导出/导入 | 严格版本解析单测；GPUI 导入 UI；Tauri 只读兼容 |
| 14 | C | C3 | N9 系统入口 + 快捷面板 | argv/open-file 三平台测试；面板 Kit UI 测试 |
| 15 | E | E1a | N12 面积过滤 | 黄金样本更新有评审记录；像素测试通过 |
| 16 | E | E1b | N13 EXIF 缩略图 | 元数据语义测试 |
| 17 | D | D1b | N10 历史视图与失败重试 | 跨重启重试端到端；保留策略测试 |
| 18 | D | D2a | N11 单规则执行（稳定判定、排除、去重持久化） | 各项单测 |
| 19 | D | D2b | N11 可靠性（溢出重扫、重试上限、规则变更语义、沙盒授权） | 端到端 |
| 20 | E | E2 | N14 ICO/ICNS | 协调变更清单全部落地；许可证白名单 |
| 21 | E | E3 | N15 量化表探测与观测；是否影响搜索另评估 | 画质测试不劣化 |

- 阶段 4、阶段 5 在次序 11 之后按迁移方案启动；C、D、E 线可穿插在阶段 4 的等待期。
- 第 12a/12b 项（D1a、C1）可提前到 G3 的外部等待窗口执行，但不得挤占 4–11 项，且不得早于 G2 收口。
- R2、R3、R5、R7、L3、L4、L5 按 §2 的去向归阶段 4/5 实机项。R9 随 Tauri 面板合并执行。

### 4.1 规模估算

分开计开发人日、验证人日、外部等待。不作为交付承诺。

| 切片 | 开发 | 验证（含 Codex 评审与跨平台 CI） | 外部等待 |
|---|---|---|---|
| B1a | 1 d | 1 d | 无 |
| B1b | 2 d | 2 d（三平台文件系统） | 无 |
| R1 + L2 | 1 d | 3 d（三平台 QA） | macOS/Windows 环境 |
| S8 | 4 d | 3 d | 更新签名密钥 |
| B2a | 2 d | 1 d | 无 |
| S9 / S10 / S11 / S12 | 各 2–3 d | 各 1 d | 无 |
| B2b | 2 d | 2 d（两壳） | 无 |
| G2 收口 | 1 d | 2 d | 虚拟机辅助功能授权、签名构建 |
| G3 收口 | 3 d（可立即项） | 5 d | 证书、runner、TestFlight、实机 |
| D1a | 2 d | 2 d | 无 |
| C1 | 5 d | 2 d | 无 |
| C2 | 3 d | 1 d | 无 |
| C3 | 5 d | 2 d（三平台入口） | 无 |
| E1a / E1b | 2 d / 2 d | 2 d / 1 d | 无 |
| D1b | 2 d | 2 d | 无 |
| D2a / D2b | 3 d / 3 d | 2 d / 3 d | 沙盒渠道实机 |
| E2 | 4 d | 2 d | 无 |
| E3 | 2 d | 1 d | 无 |

### 4.2 进度

G2 后缀反馈修复（2026-10-20，分支 `fix/gpui-suffix-feedback`）：#40 已按用户授权合并 main `924a550`，同 head CI 与 Windows x64/ARM64 GPUI 探针整体通过。修复真实 IME 组合失焦后字段恢复已保存值、Required 却残留的问题，仅清理旧空草稿的错误；保留空草稿默认值回退和 Adjusted 行为，并为实际反馈补原生 Label。三项真实组件回归通过，移除修复时失焦回归明确失败；Mac 继续用正常构建的专用沙盒候选复测。最终测试、原生证据及只读 review/CI 以本片 PR 和 `GPUI_G2_ACCEPTANCE.md` 为准；G2 的 VoiceOver 连续记录与剩余沙盒矩阵仍开放，不进入 D1a/C1 或阶段 4/5。

G2 IME 正式源码接入（2026-10-19，分支 `fix/gpui-ime-patch-integration`）：PR #39 已按用户授权合并（main `03c54cf`，7 个必需 CI 作业通过）。本片把已验证的 owner / AppKit 上下文修复接入正常 GPUI Cargo workspace，无需实验性配置；仅保留两个 0.3.8 包的 116 个运行时/构建/许可文件，Kit 五包仍为 0.7.1，锁文件只改变两个来源。新增原始归档加差分的逐字节来源审计、完整文件清单与实际 metadata 路径检查，接入架构护栏和 CI；独立回归增加 `--active`，强制对实际产品源码运行。来源、许可证、工具测试及原生普通构建的结果见 `GPUI_G2_ACCEPTANCE.md`；只读 review 和最终 CI 以本片 PR 为准。完整 VoiceOver 连续记录与剩余沙盒矩阵未齐，G2 不关闭，不进入 D1a/C1 或阶段 4/5。

G2 IME owner 焦点修复候选（2026-10-19，分支 `fix/gpui-ime-focus-lifecycle`）：PR #38 按用户授权合并 main `a00e9e1`。实现隔离差分候选，保存注册时的焦点/实体身份，在绘制后、安装新处理器前清理旧 owner 及本窗口原生组合会话；覆盖绘制中转移、输入消失、缓存、同焦点换实体与首次延迟聚焦的一次恢复。准备工具核对包/补丁/源码校验值，仅写 `target/tmp`；产品依赖与锁不变。评审发现的 owner、候选选择与补帧问题逐项修正；具体验证见 `GPUI_G2_ACCEPTANCE.md` 与候选 README。上游最小复现已获用户明确授权提交为 longbridge/gpui-kit#3605；早期 discard-only 版本原生 AXPress 仍失败；后续上下文重置候选已通过真实最小例程/沙盒应用新旧对照、首个 Escape、直接返回组合及独立窗口输入保护，补丁未正式接入，G2 保持开放。

G2 IME 连续验收与复现工具（2026-10-19，分支 `test/gpui-g2-ime-evidence`）：PR #37 按用户授权合并 main `fd630b2`。在原开发沙盒候选上取得连续 H.264 记录，逐键组合、退格、确认、展开/翻页、Escape、移动/缩小及滚动后重新组合分别有原生证据；新增精确文本/系统候选只读检查脚本及只含 Kit 的最小复现例程。真实发现组合中打开对话框仍滞留候选，最小程序同样复现；隔离平台实验虽编译成功，实际隐私对话框仍失败，review 另指出 client 清理/重聚焦缺口，未进入产品或依赖锁。例程的版本指引、退出生命周期及错误退出码已修正并复核。证据、上游报告草稿与未采纳项见 G2 清单及 `GPUI_IME_REPRO.md`、`GPUI_PATCHES.md`；G2 仍开放，后续不得绕过门槛进入 D1a/C1 或阶段 4/5。

G2 沙盒恢复与批次进度（2026-10-19，分支 `fix/gpui-g2-sandbox-recovery`）：用户授权后合并 PR #36（main `3a66b5a`，全部 7 个必需 CI 作业通过）。继续非视觉验收：最小 entitlement 的 ad-hoc GPUI 沙盒候选在自有不可写目录返回明确错误且无半成品，重选自有可写目录后 4 项重试成功；来源与输出重合出现明确覆盖原图确认，取消后 4 个源 hash 不变。发现总进度条没有原生名称，补双语名称并新增只读 macOS 进度语义回归脚本。最终候选、负向验证、review 与 CI 以本片 PR 及 `GPUI_G2_ACCEPTANCE.md` 为准；POSIX 拒绝不冒充沙盒撤权，G2 仍未关闭。

G2 队列内容朗读补齐（2026-10-19，分支 `fix/gpui-g2-native-input`）：PR #34/#35 已按用户授权合并（main `ee24b3a`），本片只修复原生辅助树缺失的队列内容语义，不继续视觉重排。原生旧候选只能找到对比/移除/格式等按钮，文件名、元数据及等待/结果状态没有原生节点；新增 Group/Label 和逐项操作/进度名称，以同一模型动态提供中英状态、错误及精度告警。真实组件测试覆盖两行、两语言、等待/运行/完成/告警/跳过/失败六态，另做移除 Group 的负向验证。IME 组合期间移动窗口的旧候选停留也在 macOS 13.6 原生 NSTextField 对照中复现，保留为平台行为观察；此前无效的坐标失效 observer 与新的隔离平台实验都不进入产品。最终原生复测、review 和 CI 以本片 PR 记录为准；VoiceOver 连续录屏、完整 IME/沙盒矩阵未齐，G2 保持开放。

用户指定卡片分栏重排（2026-10-19，分支 `feat/gpui-card-layout`，基于未合并的 PR #34）：按新 `~/jietu/001.png` 实现区域快捷导航、集中导入卡片、顶部预设及固定底栏，保留既有转换/队列/取消/预览/输出安全入口；新增仅选目录入口复用原扫描。设计和测试边界见 `GPUI_CARD_LAYOUT.md`，原生截图、review 和 CI 以本片 PR 为准。本项是用户明确要求的现有界面调整，不关闭 G2、不进入 D1a/C1 或阶段 4/5，PR #34 仍等待用户合并授权。

G2/R11 原生验收及修复（2026-10-19，分支 `feat/gpui-g2-acceptance`，未收口）：B2b 已按用户授权合并 PR #33（main `c35d3c7`）。修复 `ScopedResource::started()` 的状态误报，3 项 macOS 原生回归及旧 getter 负向验证通过。用户确认专用账号并授权辅助功能后，在 macOS 13.6 arm64 实际发现并修复设置分组/滑块名称缺失、下拉选项无辅助文本及最低质量 Off 无法递增；原生动作、键盘与忙碌保护共用既有模型入口。真实拼音逐键输入的候选、确认和 Escape，以及窗口缩放时定位已取得辅助树证据。启用 App Sandbox 的本地 ad-hoc 签名 GPUI 候选已完成选择器导入和选输出转换；这不是正式 MAS 签名或 TestFlight 验收。实际朗读、连续录屏和剩余沙盒矩阵仍待完成，详见 `GPUI_G2_ACCEPTANCE.md`，G2 不关闭，不提前推进 D1a/C1 或阶段 4/5。本地根 workspace 397、GPUI 89（含 shell UI 31）、前端 161 项及 clippy/check/build、许可证/护栏通过；review 发现的质量步进 P2 已修复复核。最终候选、CI/review 与剩余人工项以 PR #34 记录为准。

B2b（2026-10-19，分支 `feat/animation-precision-warnings`，实现与本地验证完成）：动画三态经 backend 导入 DTO 传给 GPUI，队列行与待转换计数区分动画和未知，实际拒绝继续由共享 preflight/完整解码负责。新增 Workflow/Convert 的位深降低及透明合成告警；AVIF 解码降 8-bit 保留来源记录，PNG 按选中输出判断，不误报未选候选。两壳同步双语 formatter，Tauri 补未知 code 兜底，GPUI 完成项保留/重译告警。缓存语义键 v7、记录 v4 保存并重建新告警。新增 16-bit PNG→JPEG/WebP/AVIF/PNG 量化与保真、真实 10/12-bit AVIF 解码/缩放后 PNG、三态 DTO/探测预算、缓存记录及双语 formatter 测试；UI 通过独立入库的真实双帧 APNG、透明 RGBA16 PNG 验证计数、拒绝和告警。本地根 workspace 397 项、GPUI 87 项（含 shell UI 29 项）、前端 161 项通过；两套 clippy、无 updater 编译、前端 check/build、许可证与仓库护栏通过。负向移除 AVIF 位深记录时新测试按预期失败，还原后通过。Codex 首轮仅 1P3（候选落选覆盖），补确定 PNG16 选中及双顺序断言后复核无新问题；原生 Smoke 与最终 CI 以 PR 记录为准。S12+R10 已通过用户授权合并 PR #32（main `44d78c5`）；本片之后按方案收口 G2/R11，G1/G2/G3 仍需各自原生/签名验收证据。

S12 + R10（2026-10-19，PR #32 已合并 main `44d78c5`）：17 个生产命令的入口、状态机与测试覆盖表见 `GPUI_FEATURE_PARITY.md`，额外排除 desktop_e2e_seed/perf 测试入口。补齐 23 类共享错误的双语呈现、参数兜底及切换语言后重译；扫描错误/上限/取消汇总、剪贴板问题类型保留到渲染翻译；来源格式提示与只读输出边界；逐项移除、临时文件清理及缩略图 ticket 恢复。普通扫描取消与 Tauri 一致丢弃本次部分结果，注册持有到前台提交。计划与执行新增额外来源保护入口，始终保护整个队列（含完成项和硬链接别名），执行任务仍只取待转换项目。修复完成项被下一批重复转换/状态重置，以及 macOS 保存目录不能代替会话授权。单次模板插值避免用户参数二次替换，双语全键检查发现并修正两个 YAML Off 文案；固定 Kit 0.7.1 文案静态核对 78/78 zh-CN。新增真实 UI 与模型回归测试；Codex 首轮 1P1/2P2/1P3：完成来源保护、完成 PDF 排除、全局 Select 来源同步和取消测试增强均已修复；第二轮只读复核无新 P1/P2/P3。根 workspace 394 项（另 1 项原生测试 ignored）、GPUI 85 项（shell UI 27 项，SEED=7 全部复跑）、前端 160 项通过；两 workspace fmt/clippy、前端 check/build、许可流水线及文档/架构/发布/成本护栏通过，无 updater 构建检查通过。负向绕过额外来源保护时回归失败，逐字节恢复后通过；首轮 CI 发现未跟踪的 fuzz PDF 夹具依赖，已改为独立入库的 GPUI 测试 PDF 并以 -text 固定字节；Windows 式 checkout-index 逐字节检查、局部只读复核及 85 项复跑通过。最终 CI 与 macOS/Windows 原生 Smoke 结果以 PR 记录为准。G1/G2/G3 与 R6/R7/R11 等原生验收边界保持开放，下一片仍为 B2b。

S11 + L6（2026-10-19，PR #31 已合并 main `1b46532`）：app-settings 新增离线隐私与许可对话框，隐私政策复用仓库双语全文，支持链接由用户点击后在浏览器打开；Kit 只读多行控件提供选择、复制、滚动和标准 Dialog 关闭/焦点行为。GPUI 使用独立锁文件的 cargo-about 0.9.0 生成物，Cargo 实际依赖树核对覆盖，保守包含全部目标、feature 与工作区 build/dev 依赖；额外保留原生编解码器、加密库、Lucide/Feather 与所有根 NOTICE，以及固定上游提交的许可补充文本。清单记录全文哈希和来源，复现/过期检查接入 license:check；人工原生 NOTICE 复核见 `GPUI_LICENSE_AUDIT.md`。根 workspace 393 项（另 1 项原生测试 ignored）、GPUI 72 项（shell UI 22 项，另含 app-settings 全文滚动 UI）、前端 160 项通过；两 workspace fmt/clippy、前端 check/build、完整 license:check 与文档/架构/发布/成本护栏通过，关闭 updater 的构建检查通过。负向破坏图标归属时 GPUI 校验失败，恢复后的完整许可流水线通过；core.autocrlf=true 的真实检出模拟确认 22 份文件逐字节相同。Codex 首轮 2P2/1P3 均修：Base Link 键盘支持、LF 换行和实际滚动/缩放断言；第二轮和最终局部命令路由复核无新 P1/P2/P3。另修正只读正文 Tab 导航与模态 Enter 截断；完整键盘隐私流程在 SEED=7 下通过。最终 CI 证据在 PR 记录，不据此关闭 G1/G2/G3 或最终包审计。

S10（2026-10-18，PR #30 已合并 main `f9829ad`）：逐项格式菜单与全局跟随/批量重置，值限能力矩阵 writable，仅存队列内存，编辑恢复 Pending。批次、比较预览和输出路径预检共用逐项有效格式；独立转换请求代次避免格式变动破坏在途缩略图。首轮 Codex review 发现 2 项 P2：旧预检回调可借用新请求句柄、目标体积配置仍仅看全局格式；已加入请求身份检查、按逐项格式校验及回归。菜单提交复查执行/收尾/导入门禁；最小窗口调整为两行工具栏与项目。混合 JPEG/WebP 实际文件输出、源文件冲突规划、目标体积正反例、预览过期、缩略图代次和过期预检成功/失败均有测试；根 workspace 393 项（另 1 项原生剪贴板测试保持 ignored）、GPUI 69 项（含 20 项真实 UI）、前端 160 项通过；clippy、格式、前端类型/lint/构建、文档/架构/发布/成本护栏与 GPUI 许可证扫描通过。临时绕过请求身份检查时过期预检回归变红，恢复后 workflow 7 项重跑通过；新增 UI 在 SEED=7 下通过。GNU 链接器在本机共享内存压力下被终止后，用任务临时目录的 LLVM 链接器重跑成功，未修改仓库工具链配置。菜单关闭动画由测试时钟显式推进；中文、115% 字号、760×480 边界断言通过。第二轮 Codex 复核无 P1/P2/P3；最终 CI 证据在 PR 记录。不触发 Release，也不关闭 G1/G2/G3。

S9（2026-10-18，PR #29 已合并 main `19a3ef7`）：队列粘贴按钮、标准 Paste action、编辑菜单与 Ctrl/Command+V；嵌套设置输入框仍由 Kit 消费文本粘贴，模态焦点不落回队列。共享 backend 的临时文件、session lock、128 MiB 编码文件上限、扫描与取消注册；清空只清理本进程注册文件，停止仅回收本次创建的位图，重复扫描已有临时图不获得删除所有权。平台层新增可选 `clipboard`（arboard 3.7.0，MIT/Apache），原生读取全程后台，统一文件列表→位图→文本优先级；位图归一化为 PNG，尺寸/RGBA 长度复用 core 64 MP 边界。Wayland 使用 data-control 或 XWayland 桥，均不可用时明确提示读取失败，不回退到同步读取。文件 URL 解码继续交给 backend access，原生非 UTF-8 路径给出计数，文本路径保留尾部空格；部分失败、扫描上限与无效内容有双语反馈。新增 Kit 真实 click/press、受控调度的晚取消、旧源保留与纯路径回归；原生文件/半透明位图/文字往返以隔离 Xvfb 和 macOS/Windows Smoke 验证。Codex 首轮 6 项 P2、2 项 P3，第二轮定位 3 项依赖层 P2 和 1 项夹具 P3，全部修复；第三轮无新增 P1/P2/P3，确认闭环。arboard 窄补丁与完整许可在 `vendor/arboard`，非 UTF-8/CRLF/尾部编码空白/Windows 失败分类有回归。根 workspace 393 项、GPUI 63 项（19 项 UI）、前端 160 项通过，额外隔离 Xvfb 原生往返与独立 URI 回归通过，变更调度种子的剪贴板 UI 测试通过；原生往返夹具按 canonical 路径比较，兼容 Windows CF_HDROP 去除 verbatim 前缀的行为；负向副本移除字节保留后回归失败。clippy、格式、许可证与架构/发布/成本护栏通过。实际 CI、三平台原生结果与未完成的平台人工项在 PR 记录；G1/G2/G3 不因此关闭。

B2a（2026-10-18，PR #28 已合并 main `4757a03`；重放到已合并的 S8 后重新验证）：core 新增动画事实三态，探测不再把 GIF/WebP 动画当作探测错误；PNG 与 AVIF 在完整解码入口拒绝动画。新增编码器能力表、按明确缩放后的尺寸预检，以及 backend 缓存前的共享检查；能力矩阵命令新增 encoders，缓存语义版本 v6。测试覆盖真实双帧 APNG/AVIF、GIF/WebP、探测预算不足、截断文件、1,000×20,000 WebP、显式缩小与两壳共享预检。B2b 的导入 DTO、队列标记与动画计数保持后续切片。根 workspace 387 项、前端 153 项通过，最终修复后的 GPUI 44 项通过；clippy、格式、架构/成本护栏、许可证清单校验通过。负向验证确认绕过边长护栏会使测试失败。Codex 首轮发现 1 项 P1（AVIF major brand 只选主图会漏判序列）；已独立检查 TRACKS、保留未确认轨道 Unknown 并在完整解码拒绝，增加有/无 avis 品牌和缺轨道回归；第二轮无 P1/P2/P3。macOS/Windows Smoke 增加 core 回归测试；合并态 CI 39135733048、macOS arm64 39135766824、Windows x64 39135769327 全通过，两个工作流均保留 S8 updater policy 与 B2a core 测试。


B1a（2026-10-18，分支 `feat/backend-cancel-wiring`，PR #23 已合并 main 8347cc4）：`convert_with_control` 的普通图片分支改调 `convert_workflow_with_control` 并传入 token 钩子；`write_output` 前与结果缓存查找前各加一次 `ensure_not_cancelled` 作为两条提交路径的判定点；新增 `ConversionErrorKind::Cancelled`（核心 `Error::Cancelled` 的映射，单文件入口仍报 `conversion_failed`，批次 worker 对已取消 token 下的错误照旧丢弃）。测试：预先取消的 token 不写输出且同选项无 token 可转换；测试专用的检查点钩子让 worker 停在核心第一个取消检查点、另一线程取消后放行，确定性地证明核心内取消时输出不落盘、`cancelled=true`、`completed=failed=skipped=0`。Codex 评审 0 P1/2 P2/1 P3，已全修（缓存命中路径的提交判定点、竞态测试改为同步钩子、ENGINE 文案收窄）。两壳无接口变化。`docs/ENGINE.md` §7 补取消点说明。

B1b（2026-10-18，分支 `feat/atomic-new-output`，PR #24 已合并 main 1528ba3；三平台实跑：Linux CI、macOS 虚拟机 APFS、Windows 手动 Smoke x64 NTFS）：新增 `imgconvert_platform::atomic_output`（`commit_new_file`：Linux `renameat2(RENAME_NOREPLACE)` 走原始 syscall、macOS `renamex_np(RENAME_EXCL)`、Windows `MoveFileExW(0)`；仅“不支持”类错误退到 `hard_link`，已存在/权限错误直接返回，无直写回退）；backend `write_new_output` 改为临时文件 + `sync_all` + 提交，`OutputExists` 语义不变，新增 `temporaryFileRetained` 告警（GPUI 与 Tauri 前端各加一条文案）。Codex 评审后修正：硬链接失败单独分类（仅 `EPERM`/`ERROR_INVALID_FUNCTION` 等能力类错误算不支持，其余按 IO 错误原样返回）；Windows 路径先转 `\\?\` verbatim 形式再调 `MoveFileExW`，与 std 的长路径行为一致；`preserve_source_modified_time` 改为返回告警列表，`temporaryFileRetained` 与 `modifiedTimeNotPreserved` 可并存（`warning` 兼容字段取首条）。单测：提交前不可见、已存在（文件/目录/悬空链接）不覆盖、注入“不支持”走硬链接且仍不覆盖、硬链接成功但删临时名失败仍算提交、权限错误不进回退、硬链接 IO 错误保留原义、两者都不支持报“请更换输出目录”、Windows verbatim 路径转换。N3：README 两份与 `docs/public-release.json` 同步到 v0.3.1（`docs:check` 已校验三者一致）。三平台验证：Linux 由 CI `Rust Core` 覆盖，macOS 在 Parallels 虚拟机实跑，Windows 走手动 `Windows Smoke` 新增的平台/backend 写出测试步骤。

R1 + L2（2026-10-18，PR #26 已合并；L2 仍待发布 QA）：Tauri 启动最前端接入共享 `instance.lock`，flavor=`tauri`、version 为包版本，app state 持锁到退出；同 flavor 或 GPUI 占用时仅原生提示并退出，无 WebView/store/业务服务。数据目录缺失或锁 IO 错误也停止启动，防止 Tauri store 无锁写入。单测覆盖 Tauri→GPUI、GPUI→Tauri、同 flavor、释放后可重启、残留标记恢复、IO/路径失败和设置不变；Linux 启动模块 4 项与 platform 锁测试 2 项通过，根 376 项、GPUI 44 项、前端 153 项通过；负向验证确认绕过占用检查会变红。Codex 无 P1/P2、1 项 P3 文案已修；顺带修正 platform 既有 Windows 持锁读 marker 的测试断言并纳入 Windows Smoke。L2 的补丁说明与逐项 QA 状态见 `docs/GPUI_R1_L2_QA.md`；R1 已获授权合并，尚未获得打 tag/发布授权，三平台安装件 QA 与签名/公证证据未齐，**G1 保持未关闭**。

S8（2026-10-18，PR #27 已合并 main `aba3c09`）：新增 app-settings 功能 crate 和 Kit 更新对话框，检查/下载/验签/安装状态由应用持有；Linux AppImage 有显式配置、有限下载、架构检查与原子替换，商店构建可完全关闭 updater。platform 共享系统/GPU 护栏接入 Tauri 过渡版；旧清单生成/校验拒绝 0.4.x，新清单含 format 与 OS-keyed minimum_system_version。新增原生 Linux 双架构受控 SDK 演练，使用真实 cargo-packager 包与临时 Tauri 密钥验证旧/新 SDK。生产端点、真实设置和公开 Release 均未改动；SDK 验证、GUI/GPU 验收与 G1/G3 门槛分开记录，根 workspace 380 项、前端 160 项、GPUI workspace 50 项已通过；新增异架构签名拒绝测试单独复跑。GPUI 默认与无 updater 的 clippy、许可证扫描及架构/成本/发布护栏通过；旧端点护栏负向验证通过。Codex 未发现 P1/P2，两项 P3（严格限定 0.3.x、macOS 双 SDK 平台键别名）已修复并加测。Linux aarch64 本机真实 SDK 验签/安装/运行通过；最终 CI 39130326034、Linux 双架构 SDK 39130328273、macOS 39130328079、Windows 39130328031 全通过，原生版本检测有证据；macOS 虚拟机当前 DNS 不可达，原生验证使用手动 Smoke runner。


## 5. 各切片的设计要点

### B1：取消与原子新建输出

- 取消点（core 回调）：解码后、每个候选编码前、SSIMULACRA2 评分前。取消点（backend token）：`write_output` 前。`Error::Cancelled` 走取消终态。
- 原子提交：`<目标>.imgconvert-<pid>-<随机>.tmp` → `sync_all` → NOREPLACE 改名；“已存在”返回 `OutputExists` 并删临时文件；“不支持”才走 hard-link 路径；其余错误原样返回。
- 不改变覆盖路径（已有临时写 + rename + Windows 回滚）。
- Linux NOREPLACE 取决于文件系统（ext4/btrfs/xfs/tmpfs 支持；SMB/FAT 可能不支持）；Windows 禁止跨卷复制回退；分别验证“不覆盖”与“提交前不可见”。
- 文档：`docs/ENGINE.md` 输出写入一节补“新建输出在提交前对外不可见；不支持原子提交的文件系统返回错误”。

### B2：输入事实与能力表

- `AnimationStatus` 由各容器头部判定：PNG `acTL`（`PngDecoder::is_apng()`，image 0.25.10）、AVIF `imageCount > 1`、GIF 多个 image descriptor（已有）、WebP `has_animation`（已有）；预算内读不到判定依据记 `Unknown`。
- `EncoderCapabilities` 放 core；Tauri 能力矩阵命令与 GPUI 预检都读它。
- 告警进入 `WorkflowResult.warnings`；Tauri `state.svelte.ts:2505` formatter 加未知 code 兜底文案；结果缓存键纳入新告警与 `AnimationStatus`。

### C1：CLI

- 位置 `crates/imgconvert-cli`，依赖 `imgconvert-backend` 与 `imgconvert-platform`；参数解析优先用依赖图已有或白名单内 crate。
- **同片必做的仓库配套**：`check-architecture-guardrails.mjs:207` 的 workspace 成员精确字符串改为 TOML 集合校验；新增 CLI 规则（禁止 UI 依赖、禁止 GPL 系）；CI 增加根 workspace `cargo deny check licenses`（现在 `ci.yml:245` 只查 bans/sources/advisories，`package.json:42` 只查 Tauri）与 CLI 归属文本生成/校验（`scripts/generate-third-party-licenses.mjs` 目前只读 Tauri manifest）；CLI 三平台产物上传为 CI artifact。
- 输出 JSON 顶层：`{ schemaVersion, app: {version, core}, preset, target, summary: {done, skipped, failed}, files: [{source, state, outputs, bytesIn, bytesOut, warnings, error: {code, message}}] }`；`--json` 时 stdout 只在结束输出一个文档，进度与日志走 stderr，`--quiet` 关闭。
- 退出码：0 全部成功（含部分 skipped）；1 部分或全部失败；2 参数/预设/格式错误、设置文件缺失或损坏、预设不存在（不静默替换为默认）、输出目录不可写；3 无可处理输入或**全部 skipped**；130 被中断。JSON `summary` 增加 `cancelled` 计数与顶层 `interrupted: bool`。
- 中断收尾：首次 SIGINT/Ctrl+C 设置取消 token，等待在途任务到达取消或提交判定点（N1），然后追加历史（`--no-history` 时跳过）、输出最终 JSON，再以 130 退出；第二次 SIGINT 立即退出，不写历史。
- 历史：依赖 D1a 的存储层；默认写，`--no-history` 优先于“已完成项仍写历史”。
- 覆盖策略非交互：默认等价 `skip`，`--overwrite` 显式开启；禁止隐式覆盖源文件（输出路径等于输入路径时报错）。
- 设置：提供**只读加载**入口，只读取正式 `settings.json` 并在内存归一化：缺失 → 使用默认并在 stderr 提示；存在有效 `.tmp` 而正式文件缺失 → 视为缺失，不恢复；损坏 → 退出码 2 并指出路径，不重命名；权限错误 → 退出码 2。现有 `load`（`settings.rs:965`）会恢复 `.tmp`、隔离损坏文件并写盘，CLI 不用它。CLI 不写设置、不取 `instance_lock`（`instance_lock.rs:88` 只有独占获取，只读加载也不需要它）。
- 测试：契约测试固定 JSON 形状；退出码测试；与 GUI `conversion_options_for` 的参数一致性测试。

### C2：预设文件

- 扩展名 `.imgconvert-preset.json`；顶层 `{ schemaVersion, exportedBy: {app, version}, presets: [ { id, name, workflow } ] }`。
- 导入：`schemaVersion` 大于当前拒绝；小于当前按迁移表升级；未知字段拒绝。
- ID 契约：“新增副本”生成**新 ID**（名字加序号）；“替换”保留**现有 ID**、更新内容，并提示引用该 ID 的监控规则与快捷面板项会随之变化；替换需确认对话框，文案写明被替换的预设名。

### D1：历史

- 单条记录上限只约束展示性字段；路径、身份、参数快照不截断。
- 锁协议：锁载体是独立且永不被替换的 `history.lock`（与设置实现一致，`settings.rs:1031`、`:1097` 锁的是 sidecar），所有追加、恢复、压缩先取其独占锁再打开数据文件；第一版锁竞争采用等待，不引入临时队列；压缩替换后追加者重新打开当前文件。
- 重试前检查：源文件身份一致（不一致时提示“源文件已变化，按当前文件重试？”）、输出目录可写、平台能力满足。

### D2：监控

- 规则存 `settings.json` 内 `settings` 对象的新键 `settings.watchRules`，示例：

  ```json
  { "settings": { "...": "...", "watchRules": [ { "id": "w1", "dir": "/in", "presetId": "p1", "outputDir": "/out", "recursive": false } ] } }
  ```

  保留机制：Tauri 侧 `Object.assign(settings, saved)` 后 `settingsSnapshot()` 以展开写回（`src/lib/state.svelte.ts:2678`、`:2711`），`normalizeSettings`（`:2754`）不删除未知键；GPUI 侧 `Settings.extra` 以 `#[serde(flatten)]` 保留（`settings.rs:220`）。两侧都不校验它，校验由监控服务做。新增“GPUI 写 → Tauri 加载并修改设置 → GPUI 读”的往返测试。
- 目录授权：复用“用户显式授权目录”抽象；沙盒渠道第一期只允许已授权目录或不提供。
- 规则变更语义：改预设或输出目录不重做已成功文件；改目录视为新规则；删除规则清理其 `watch-state.json` 条目。
- 监控服务在 backend 作为应用级服务，GPUI 只做规则 UI 与状态；CLI `watch` 子命令复用同一服务（C1 之后再加），与 GUI 互斥。

## 6. 风险与开放问题

| 风险 | 应对 |
|---|---|
| N2 的 NOREPLACE 在部分文件系统不支持 | hard-link 回退；都不支持时返回错误并提示用户换输出目录，不静默直写 |
| N12 改变输出字节 | 缓存键加算法版本；黄金样本更新独立提交附对比图；发布说明写明 |
| CLI 与 GUI 并存的设置与历史竞争 | CLI 只读设置；历史用文件锁；监控单实例 |
| 预设文件被当作共享渠道后的兼容预期 | 严格 `schemaVersion` 与迁移表；导入失败给具体原因 |
| 监控在 Flatpak/MAS 沙盒的目录授权 | 复用授权目录抽象；沙盒渠道第一期受限 |
| B/C 线挤占阶段 3 | 次序表与“两条线各一个切片”限制；C 线只用 G3 等待窗口 |
| N4 的 `Unknown` 放行导致解码阶段才发现动画 | 解码入口强制检查不变；预检文案区分“动画”与“未知” |

已决定（用户 2026-10-18 按推荐项全部采纳）：

1. **CLI 分发**：长期随桌面包分发（与主程序同目录的 `imgconvert-cli`，纳入各包型与 `SHA256SUMS`），落实放在阶段 5 的打包切片；G5 放行前只作 CI 产物与源码构建。随包分发后再评估用 CLI 承接安装包 smoke（§3.3 N7）。
2. **历史保留**：默认 90 天或 5,000 条，先到者为准；设置中提供“记录任务历史”开关（默认开），关闭时不写历史、不影响监控去重状态。
3. **快捷面板**：主窗口内可折叠区，不做独立窗口。
4. **N12 黄金样本**：接受更新，面积过滤成为正式路径大比例缩小的默认策略；黄金样本更新作为独立提交并附对比图，发布说明写明输出字节变化。

## 7. 修订记录

v3.1（2026-10-18）：§6 四个开放问题由用户按推荐项拍板，改为“已决定”。

v3（2026-10-18，Codex 第二轮复核后）：R11 把 G2 必需项单列并排在 G3/阶段 4 之前；监控去重键加 `ruleId` 分区与原子持久化；D1 拆 D1a（存储层，C1 前置）/D1b；CLI 补只读加载的异常行为、中断收尾、退出码与 JSON 中断字段；历史锁改为 `history.lock` sidecar；§0.1 补 Filee 证据链接；S8 的跨文档引用写全；§0.1 行号精确化。

v2（2026-10-18，Codex 评审后）：按 §8 的 21 条修订。主要变化：N4 分离探测与校验并新增 `Unknown`；N6 行号更正且覆盖 AVIF 解码降位深；N1 提交前检查放在 backend；N2 取消自动直写回退并把原语放 platform；C1 同片改 workspace 护栏与许可证门禁，保留安装包 smoke；`watchRules` 层级与保留机制改为可验证表述；历史加跨进程锁，去重状态独立；补 G1/G2 遗留、七片后续与 §8 映射；恢复 G3 原文条件，R7 归 G4；次序改为 B1 → G1 收口 → S8 → B2a → S9–S12 → B2b → G3 → C → E/D；估算拆开发/验证/等待。

v1（2026-10-18）：首版。

## 8. Codex 评审处置

评审全文存 `artifacts/reviews/codex-development-plan-review-2026-10-18.md` 与 `codex-development-plan-review2-2026-10-18.md`（不入库）。

### 8.1 第二轮（v2 → v3）

| # | 级别 | 结论 | 处置 |
|---|---|---|---|
| 1 | P1 | R5 把 G2 必需验收推到阶段 4/5 | 采纳：新增 R11 与“G2 收口”次序 11 |
| 2 | P1 | 监控去重键缺规则身份 | 采纳：`(ruleId, 输入身份)` 分区、原子持久化、未落盘策略 |
| 3 | P2 | C1 依赖 D1 | 采纳：拆 D1a/D1b，D1a 为 C1 前置 |
| 4 | P2 | CLI 只读加载异常与中断收尾 | 采纳：§5 C1 补齐 |
| 5 | P2 | 历史锁载体 | 采纳：`history.lock` sidecar，第一版等待 |
| 6 | P3 | Filee 证据链接 | 采纳：§0.1 证据表 |
| 7 | P3 | S8 裸写 §3.6 | 采纳 |

### 8.2 第一轮（v1 → v2）

| # | 级别 | 结论 | 处置 |
|---|---|---|---|
| 1 | P1 | `ImageProbe` 无 serde，“前端零改动”不成立 | 采纳：N4 改经 `ImportImageMetadata`；删除该验收 |
| 2 | P1 | 探测报错与队列标记矛盾；探测预算 512 KiB | 采纳：`AnimationStatus::Unknown`，探测与校验分离 |
| 3 | P1 | N6 行号错引；AVIF 解码也降位深 | 采纳：更正行号，告警记录实际损失 |
| 4 | P1 | 提交前取消检查应在 backend | 采纳 |
| 5 | P1 | 非原子回退推翻验收 | 采纳：不退回直写，错误分类 |
| 6 | P1 | 根 workspace 精确字符串护栏 | 采纳：C1 同片改为集合校验 |
| 7 | P1 | CLI 不能替代安装包 smoke | 采纳：保留隐藏入口 |
| 8 | P1 | `watchRules` 层级与依据 | 采纳：`settings.watchRules`，给示例与往返测试 |
| 9 | P1 | 历史跨进程一致性 | 采纳：`fd-lock` 协议；不截断关键字段 |
| 10 | P2 | G1/G2 遗留承接不全 | 采纳：L5、L6、G3-2 扩展、§2.5 |
| 11 | P2 | 七片后续与 §8 映射 | 采纳：R10、R4 扩展、§2.5 |
| 12 | P2 | G3 条件缩水、R7 归属 | 采纳：引用 G3 原文；R7 归 G4；L1 挂阶段 5 |
| 13 | P2 | N2 依赖落点 | 采纳：原语放 platform |
| 14 | P2 | 许可证 CI 与归属 | 采纳：C1 加根 deny licenses 与 CLI 归属；S11 验收改写 |
| 15 | P2 | ICO/ICNS 撞格式边界 | 采纳：N14 改为协调变更 |
| 16 | P2 | 先收口迁移再插自动化 | 采纳：C 线移到 G3 后；B2 拆 a/b |
| 17 | P2 | 估算偏低 | 采纳：§4.1 三列估算，删除“相容”结论 |
| 18 | P2 | CLI/预设/监控契约不全 | 采纳：§5 补退出码、覆盖策略、只读加载、ID 契约、规则变更语义 |
| 19 | P3 | 14 条核实无清单；Release API 比对位置 | 采纳：§0.1；N3 改定时任务 |
| 20 | P3 | 箭头方向、L4 撞号、§ 引用 | 采纳 |
| 21 | P3 | “不进入任何 Release”限定阶段；S8 内部渠道 | 采纳 |
