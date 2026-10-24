# 桌面端性能基线（Tauri → GPUI 迁移阶段 0）

状态：工具初版已就绪并经 Codex 评审修订（2026-10-12），真机数据待采集。本文件是 `docs/GPUI_MIGRATION_PLAN.md` 阶段 0 的交付物：测量协议、方法、脚本用法、结果有效性规则，以及待填写的结果表。阶段 2 的 GPUI 原型必须实现 §2 的协议并满足 §7 的契约，用同一脚本测量。

## 1. 为什么要先测

迁移的收益假设是"空闲内存更低、长队列滚动更顺、启动更快"。这些数字没有公开基准，必须在同一台机器、同一数据集、同一就绪点上自测。G2 门槛（PoC 不劣于基线且空闲内存降低 ≥ 25%）只能对这里记录的数字比较，而且 §3 规定了"空闲内存"具体指哪一列。

## 2. 探针协议

应用在 `IMGCONVERT_PERF_PROBE=1` 时向 stderr 打印 JSON 行。未设置该变量时不输出标记、不驱动任何场景；应用仍会在启动时做一次探针配置查询，开销可忽略但不是零。

```json
{"imgconvert_perf":1,"mark":"ready","elapsed_ms":412.3,"unix_ms":1760000000123.4,"value":0}
```

| 字段 | 含义 |
|---|---|
| `imgconvert_perf` | 协议版本，当前为 `1`；脚本解析 JSON 后校验此字段，不依赖字节串格式 |
| `mark` | 标记名，`[A-Za-z0-9_]{1,64}` |
| `elapsed_ms` | 自进程 `main` 开始的毫秒数（不含加载器时间），可为 null |
| `unix_ms` | 墙钟时间，脚本用它减去自己的 spawn 时间得到含加载器的耗时 |
| `value` | 可选数值 |

环境变量：

| 变量 | 作用 |
|---|---|
| `IMGCONVERT_PERF_PROBE=1` | 启用探针 |
| `IMGCONVERT_PERF_PROBE_IMPORT=<dir>` | UI 就绪后自动导入该目录（递归） |
| `IMGCONVERT_PERF_PROBE_SCROLL=1` | 静默后自动滚动队列并统计回调间隔 |
| `IMGCONVERT_PERF_PROBE_SCROLL_MS=<ms>` | 滚动时长，默认 10000，范围 1000–120000 |
| `IMGCONVERT_PERF_PROBE_BATCH_OUT=<dir>` | `probe_done` 之后自动以默认参数把整个队列转换到该目录（仅 GPUI 壳实现；Tauri 壳忽略，仍需人工点击）。脚本的 `--batch-out=<dir>` 会为每次运行建一个空子目录并设置它 |
| `IMGCONVERT_PERF_PROBE_BATCH_FORMAT=<fmt>` | 自动批次的输出格式（如 `avif`），不设则用面板当前选择；脚本参数 `--batch-format=<fmt>`。与 Tauri 侧人工选择的格式对齐后数字才可比 |

标记序列（Rust 侧只接受下表中前端标记的固定集合，每进程最多 10,000 条）：

| 标记 | 发出方 | 时机 | value |
|---|---|---|---|
| `main_start` | Rust `main` 第一行 | 进程启动 | 无 |
| `rust_run` | Rust | 进入 UI 运行时之前 | 无 |
| `ready` | 前端 | 见 §7 就绪契约 | 队列长度 |
| `import_start` | 前端 | 任何导入扫描开始 | 输入路径数 |
| `import_done` / `import_failed` | 前端 | 扫描结束并加入队列 / 扫描失败 | 队列长度 |
| `probe_import_settled` | 前端 | 探针驱动的导入已结束 | 队列长度 |
| `probe_quiescent` | 前端 | 没有导入在进行、没有缩略图在生成 | 队列长度 |
| `scroll_refresh_interval_ms` | 前端 | 滚动前静止 1 s 的回调间隔中位数（刷新周期估计） | 毫秒 |
| `scroll_intervals`、`scroll_interval_p50_ms`、`scroll_interval_p95_ms`、`scroll_interval_p99_ms`、`scroll_interval_max_ms`、`scroll_long_intervals`、`scroll_distance_px`、`scroll_px_per_s` | 前端 | 滚动测试结束 | 对应统计量；long = 间隔 > 33 ms 的次数 |
| `batch_start` | 前端 | 输出目录授权、覆盖确认等全部用户决策完成后、调用后端批次之前 | 本批次任务数 |
| `batch_done` / `batch_failed` / `batch_cancelled` | 前端 | 后端批次返回 / 调用异常 / 后端报告取消 | 本批次中状态为 done 的任务数 |
| `probe_done` | 前端 | 自动场景全部结束且再次静默 | 队列长度 |
| `probe_error`、`probe_error_import`、`probe_error_import_timeout`、`probe_error_no_scroll_container`、`probe_error_scroll_range`、`probe_error_quiescence_timeout`、`probe_error_frame_timeout` | 前端 | 自动场景失败；失败后不再发 `probe_done`。`probe_error_frame_timeout` 表示刷新率估计或滚动阶段在标称时长加 60 s 内没有结束（webview 停止派发动画帧，例如窗口被遮挡、软件渲染每帧耗时数分钟），`value` 为截止前收到的帧数 | 视情况 |

## 3. 测量口径

| 指标 | 口径 |
|---|---|
| `readyMs` | 脚本 spawn 墙钟时间到 Rust 收到 `ready` 的 `unix_ms`；含加载器与 IPC 调度 |
| `readyElapsedMs` | `ready` 的 `elapsed_ms`，不含加载器 |
| `idleRssBytes` / `idleAltBytes` | 场景结束后静置窗口（`idleStart`–`idleEnd`，在清理之前记录）内所有采样的中位数；进程树求和 |
| `peakRssBytes` | 整个运行期间进程树 RSS 的**采样**最大值，受采样周期限制 |
| `importMs` | `import_start` 到 `import_done` |
| `quiescenceMs` | `import_done` 到 `probe_quiescent`，即首屏缩略图工作时长 |
| 滚动指标 | 自动滚动期间动画回调间隔的统计，不是呈现帧时间 |
| `batchMs`、`batchPeakRssBytes` | `batch_start` 到 `batch_done`，期间采样峰值 |
| `samplerIntervalMs`、`samplerQueryMs` | 实际采样周期与每次枚举进程的耗时，用于判断采样器自身的扰动 |

内存列按平台定义，**只在同一平台内比较 Tauri 与 GPUI**，不跨平台比较：

| 平台 | `rssBytes` | `altBytes`（`altKind`） | G2 使用的列 |
|---|---|---|---|
| Linux | `/proc/<pid>/status` `VmRSS` 的进程树求和，共享页会在多进程间重复计入 | `smaps_rollup` `Pss` 求和（`pss`），共享页按比例分摊 | `idleAltBytes` |
| macOS | `ps rss` 的进程树求和，加上启动后新出现的 `com.apple.WebKit.*` XPC 进程（它们不是子进程；归属的 pid 记录在 `attributedHelperPids`） | 无 | `idleRssBytes`，并说明多进程 → 单进程会让共享页重复计数消失，不把这部分全部当作收益 |
| Windows | `Win32_Process.WorkingSetSize` 求和（含共享页） | `PrivatePageCount` 原始值（`win32_private_page_count_raw`），单位未核实，只记录不换算 | `idleRssBytes` |

GPUI 版若仍有编解码 helper 子进程，同样计入进程树。

统计：每个场景跑 `--runs` 次（默认 10），每次都是新进程；报告中位数、p95、最小、最大和有效样本数 n。比较时用中位数，容差 ±5%。

## 4. 运行有效性

脚本对每次运行做校验，不满足则该次 `ok=false`，不进入汇总，并在 Markdown 里列出原因：

- 出现任何 `probe_error*` 标记（即使之后收到 `probe_done`）。
- 缺少该场景的必需标记（startup：`main_start`、`rust_run`、`ready`；import 另需导入、静默、全部滚动标记与 `probe_done`；manual-batch 另需 `batch_start` 与 `batch_done`）。
- 出现 `import_failed`、`batch_failed`、`batch_cancelled`。
- 应用在场景结束前退出，或在静置窗口内退出。
- 静置窗口采样少于 3 个；任一采样失败；任一采样找不到应用主进程；任一采样中有进程读不到内存。
- 空闲 RSS 缺失；Linux 上空闲 PSS 缺失。
- import/manual-batch 场景导入数缺失或少于语料目录（递归）中的图片文件数。
- import 场景滚动距离或回调间隔数缺失或为零，或任一滚动分位数缺失。
- manual-batch 场景批次任务数少于语料文件数、`batch_done` 的成功数不等于任务数（前端在部分失败时直接发 `batch_failed`），或批次窗口内没有采样。
- `--purge` 已请求但清缓存失败。
- 终止后仍有进程存活。

脚本启动应用前会清除操作员 shell 中所有 `IMGCONVERT_PERF_PROBE*` 变量，再按场景设置。

## 5. 操作步骤

### 5.1 准备

1. 关闭其他应用，接电源，关闭自动亮度，保持同一分辨率与缩放；macOS 上不要同时运行其他使用 WKWebView 的应用。
2. 用正式发布构建（macOS：公证后的 `.app`；Windows：安装后的 exe；Linux：AppImage 或 deb 安装后的 `/usr/bin/imgconvert`）。调试构建的数字只能用于联调。
3. 生成数据集（同一数据集在所有平台和两套 UI 上复用；生成器用整数运算，`<out>.manifest.json` 记录每个文件的 SHA-256，复制到另一台机器后可校验）：

```bash
pnpm run bench:desktop:corpus --out=/tmp/imgconvert-corpus-1k --count=1000 --size=512
pnpm run bench:desktop:corpus --out=/tmp/imgconvert-corpus-10k --count=10000 --size=512
```

数据集是确定性渐变 PNG，只用于导入、队列和缩略图负载；编码速度基准另见 `bench:platform`。

通过 SSH 远程运行时：被测用户必须已登录桌面会话；语料和输出目录放在家目录一级下（如 `~/imgconvert-bench`），不要放"桌面/文稿/下载"，否则 SSH 启动的进程会被 TCC 拦住；`--purge` 需要免密 `sudo /usr/sbin/purge`。直接执行 `Contents/MacOS/imgconvert` 与通过 `open` 启动在 10k 停摆问题上表现一致，但前者会以 nice 5 运行，正式采集用 GUI 会话里的终端启动脚本。

### 5.2 启动与空闲（空队列）

```bash
pnpm run bench:desktop:baseline --app=/Applications/ImgConvert.app --label=tauri --scenarios=startup --runs=10 --note="v0.3.1 release, 2x scale, warm cache"
```

### 5.3 导入 + 静默 + 滚动 + 空闲（已加载队列）

```bash
pnpm run bench:desktop:baseline --app=/Applications/ImgConvert.app --label=tauri \
  --corpus=/tmp/imgconvert-corpus-1k --scenarios=import --runs=10
pnpm run bench:desktop:baseline --app=/Applications/ImgConvert.app --label=tauri \
  --corpus=/tmp/imgconvert-corpus-10k --scenarios=import --runs=10
```

### 5.4 批量转换峰值（人工触发）

转换需要输出目录授权，脚本不代替用户点击。它在队列加载完成后提示你在应用里选择输出目录并点击开始，然后自动等待 `batch_start` 与 `batch_done`（默认最多 60 分钟，`--batch-timeout-min` 可调），不需要回到终端操作。

GPUI 壳不需要人工点击：加 `--batch-out=<dir>` 后，脚本为每次运行创建 `<dir>/run-<n>-<时间戳>` 并通过 `IMGCONVERT_PERF_PROBE_BATCH_OUT` 传给应用，应用在 `probe_done` 后自动以当前格式（默认 WebP）开始转换。Tauri 壳没有实现该变量，比较两端的 `batchPeakRssBytes` 时要记住 Tauri 侧的数字来自人工触发、GPUI 侧来自自动触发，但两者的批次都始于全部用户决策完成之后。

```bash
pnpm run bench:desktop:baseline --app=/Applications/ImgConvert.app --label=tauri \
  --corpus=/tmp/imgconvert-corpus-1k --scenarios=manual-batch --runs=3
```

每次运行用同一输出格式（默认 AVIF）与质量设置；每次运行选择一个空的输出目录。脚本不知道也不会清理输出目录；应用默认覆盖策略是 skip，重复选择同一目录会让全部任务被跳过，探针发 `batch_failed`（值 0），该次判无效。方案要求每项 10 次，人工场景按 3 次执行并在结果中注明。

### 5.5 冷缓存

默认每次运行是新进程但共享页缓存，报告中称为 warm。真正的冷启动加 `--purge`（macOS `sudo purge`，Linux 写 `drop_caches`，Windows 不支持），运行前先 `sudo -v`；清缓存失败的运行会被判无效。冷启动与热启动分开记录，不混在一张表里。

### 5.6 产出

结果写到 `artifacts/baseline/<label>-<platform>-<arch>-<timestamp>.json` 与同名 `.md`（`artifacts/` 已在 `.gitignore`）。JSON 含每次运行的全部标记序列（`events`）、原始内存采样序列（`memorySamples`，含成功采样的时间、枚举耗时、各进程 pid、归属的 helper pid、缺失计数，以及失败采样的时间与错误）、二进制 SHA-256 与仓库 commit。把 `.md` 的表格贴到第 6 节，并保留 JSON 文件备查。

## 6. 结果

填写时注明：构建版本与 commit、二进制 SHA-256、冷/热缓存、机器型号、显示缩放与刷新率（来自 `scrollRefreshIntervalMs`）。

### 6.0 协议验证记录（Parallels 虚拟机，不是基线）

2026-10-12，Parallels macOS 13.6 虚拟机（Apple M4 Max 虚拟 4 vCPU、8 GiB、无 GPU 直通），release 构建、ad-hoc 签名，仓库 03b692f（工作树含阶段 0 未提交改动），二进制 SHA-256 前缀 `e0754068`。用途是证明脚本、探针、WebKit XPC 归属和有效性规则在 macOS 上成立；数字受软件渲染影响，不得与裸机或 GPUI 对比。

| 场景 | 有效运行 | readyMs 中位 | idleRssBytes 中位 | 其他 |
|---|---|---|---|---|
| startup（热） | 8/10 | 1164 ms | 159.3 MiB | 2 次无效：应用在 `rust_run` 后 60 s 内未创建 webview，同时段出现一个由 LaunchServices 启动、不带探针环境的孤立实例；之后 8 次正常 |
| startup（冷，`--purge`） | 5/5 | 3673 ms | 157.3 MiB | |
| import 1k | 5/5 | 1258 ms | 862.5 MiB | importMs 96 ms；quiescenceMs 1775 ms；scrollIntervalP50 176 ms、P99 402 ms；`scrollRefreshIntervalMs` 269–1155 ms，即软件渲染 |
| import 10k | 0/2 | | | `probe_quiescent` 后 WebContent 停在 CoreAnimation backing-store 刷新（见 §8），脚本 `importTimeoutMs` 判无效 |
| manual-batch 1k（AVIF） | 2/3 | | | batchMs 中位 33.4 s；batchPeakRssBytes 中位 1123 MiB；1 次无效：重复选择了已有输出的目录，1000 项全部被 skip，`batch_failed`=0 |

WebKit XPC 归属：每次运行归属到 2 个新出现的 `com.apple.WebKit.*` 进程（WebContent 与 Networking），`idleProcesses` 恒为 3，`attributedHelperPids` 已记录。

### 6.1 macOS arm64（Parallels 虚拟机，主基线；GPUI PoC 必须在同一虚拟机上对比）

| 指标 | Tauri 0.3.x | GPUI PoC | GPUI 完整候选 |
|---|---|---|---|
| readyMs（startup，中位数） | 1164 ms 热 / 3673 ms 冷 | 404 ms 热（5/5 有效，p95 1093 ms；首次运行含 runtime shader 编译）/ 1432 ms 冷（3/3 有效，`--purge`） | 384 ms 热（5/5，p95 1187 ms，首次运行含 shader 编译）/ 1463 ms 冷（3/3，`--purge`） |
| idleRssBytes（startup） | 159.3 MiB | 49.5 MiB 热 / 42.1 MiB 冷（单进程，−69%） | 57.9 MiB 热 / 58.0 MiB 冷（−64%） |
| importMs（1k / 10k） | 96 ms / 虚拟机不可测 | 97 ms（3/3 有效）/ 1550 ms（2/2 有效） | 77 ms（3/3）/ 1727 ms（2/2） |
| scrollIntervalP99Ms（1k） | 402 ms | 52 ms（刷新周期估计 49 ms，虚拟机软件渲染上限；p50 48 ms；整段 0→底→0 三角波，11 k px/s） | 33.5 ms（刷新周期 16.7 ms，p50 16.7 ms） |
| idleRssBytes（import 1k） | 862.5 MiB | 163.0 MiB（−81%；滚完全程后缩略图缓存占到 128 MiB 预算） | 179.8 MiB（−79%） |
| quiescenceMs（10k） | 虚拟机不可测 | 162 ms | 218 ms |
| scrollIntervalP99Ms（10k） | 虚拟机不可测 | 53 ms（p50 46 ms，111 k px/s） | 32.8 ms（p50 16.7 ms） |
| scrollLongIntervals（10k） | 虚拟机不可测 | 237（刷新周期 49 ms，几乎每个间隔都 >33 ms；只有分位数可比） | 6（刷新周期 16.6 ms） |
| idleRssBytes（import 10k） | 虚拟机不可测 | 258.1 MiB | 172.3 MiB |
| batchPeakRssBytes（1k，AVIF） | 1123 MiB（batchMs 33.4 s，n=2，人工点击） | 155.3 MiB（batchMs 30.7 s，3/3 有效，`--batch-out --batch-format=avif` 自动触发；WebP 对照 76.5 MiB / 10.9 s） | 178.5 MiB（batchMs 31.3 s，3/3，1000/1000 完成） |

GPUI 完整候选采集记录（2026-10-24，G3-5，同一台 Parallels 虚拟机、同一语料与脚本，main `6fb4487` 发布构建，二进制 SHA-256 前缀 `0f343865`，原始文件在测试机 `~/imgc-glass/g3-perf/*.json`）：全部场景有效（startup 热 5/5、冷 3/3，import 1k 3/3、10k 2/2，AVIF 批次 3/3、每次 1000 项完成）。与 PoC 相比，虚拟机此时的刷新周期为 16.7 ms（PoC 时 49 ms），滚动分位数随之下降，不能把这部分改善归因于应用；启动与 1k 导入后的空闲内存因完整功能（设置面板、预览、诊断等）比 PoC 高 8–17 MiB，10k 导入后反而低 86 MiB（缩略图缓存按预算回收），批次峰值高 23 MiB、耗时相当。按用户 2026-10-24 批准的虚拟机例外，完整候选在全部同等指标上不劣于 Tauri 参照，**G3-5 通过**。

GPUI PoC 采集记录（2026-10-17，同一台 Parallels 虚拟机，`apps/gpui` 发布构建，二进制 SHA-256 前缀 `ebf787c8`，gpui-kit 0.7.1 默认 `runtime_shaders`，脚本 `measure-desktop-baseline.mjs --label=gpui`，原始文件 `artifacts/baseline/gpui-*.json`）：

- startup 热 5/5 有效：readyMs 中位 404 ms、min 292 ms、p95 1093 ms（首次运行含 Metal shader 运行时编译），空闲 RSS 49.5 MiB，进程树只有 1 个进程。
- import 1k 3/3 有效（Codex 评审后改为与 Svelte 相同的整段三角波）：importMs 97 ms，quiescenceMs 161 ms，刷新周期估计 49 ms，滚动回调间隔 p50 48 ms / p95 50 ms / p99 52 ms / max 53 ms，`long`（>33 ms）236 次——虚拟机软件渲染的刷新周期本身就超过 33 ms，所以 `long` 计数在两端都接近"全部"，只有分位数的相对值有意义；空闲 RSS 163.0 MiB（滚完全程后缩略图 CPU 缓存达到 128 MiB 预算；早先只滚前段时为 87 MiB）。
- import 10k 2/2 有效：importMs 1.55 s，静默 162 ms，滚动 p99 53 ms，空闲 RSS 258 MiB；10k 在这台虚拟机上 Tauri 版无法完成，此处只记录 GPUI 有数据。
- startup 冷 3/3 有效（`--purge`）：readyMs 1432 ms（Tauri 3673 ms），空闲 RSS 42.1 MiB。
- manual-batch 1k：AVIF 3/3 有效，batchMs 30.7 s，峰值 RSS 155.3 MiB，1000 项全部完成；WebP 对照 10.9 s / 76.5 MiB。Tauri 侧的 1123 MiB 含 WebKit 进程树（队列缩略图与页面），GPUI 侧是单进程，口径按 §3 都是进程树求和。
- 在该口径下 G2 的"不劣于基线且空闲内存降低 ≥ 25%"在 startup（热/冷）、import 1k、batch 1k 上都满足，import 10k 有数据；还没有的：Windows/Linux 探针、私有 API 扫描、VoiceOver/IME/沙盒冒烟（§4 阶段 2 其余事项）。

### 6.2 Windows x64

同上表，待测。

### 6.3 Linux x86_64

同上表（用 `idleAltBytes`），待测。

## 7. GPUI 原型必须满足的契约

- **就绪契约。** `ready` 的条件两端相同：设置已读取、编解码能力检查已完成、主界面已提交两帧并可接收输入。Tauri 版在 `App.svelte` 的 `onMount` 中等待两次 `requestAnimationFrame` 后发出；GPUI 版在 `gpui_kit::init`、设置加载、能力检查完成后，等待两次窗口重绘回调再发出。标记时间戳都是 Rust 侧收到标记的时刻。
- **滚动契约。** 输入为时长、逻辑位移轨迹（0 → 总高度 → 0 的三角波）、窗口尺寸；GPUI 版用虚拟列表的滚动句柄设置逻辑偏移，总高度按行高 × 行数计算，不依赖已实例化元素。两端报告 `scroll_distance_px` 与 `scroll_px_per_s`，位移不一致的结果不可比。
- **回调间隔契约。** 两端的滚动统计都是"动画回调间隔"，不是呈现帧时间；GPUI 版用窗口重绘回调（具体 API 以锁定的 `gpui-pre 0.3.8` 源码为准，未核实），并同样先报告静止时的回调间隔作为刷新周期估计。
- **静默契约。** `probe_quiescent` 表示没有导入在进行、没有缩略图在解码或上传；GPUI 版以 backend 缩略图任务计数为准。
- **能力声明。** 不支持的标记不得填 0；缺失标记会使该运行无效，由实现方在结果说明里解释。

## 8. 已知限制

- `readyMs` 包含脚本 `spawn` 到 `main` 的加载器时间与 IPC 调度；`readyElapsedMs` 不含加载器。
- 滚动是程序驱动的匀速三角波，不含惯性滚动与输入延迟；10k 队列在 10 s 内扫完意味着每帧跳过多行，缩略图懒加载不保证覆盖每一项。`scroll_px_per_s` 用于判断两端速度是否一致。
- macOS 的 WebKit XPC 归属靠"启动后新出现"推断，归属 pid 已记录以便审计；进程树不是原子快照。
- 峰值是采样峰值，短于采样周期的尖峰会漏掉；Windows 采样周期最低 1 s。
- 探针命令编译进所有构建；启用探针时，webview 内容可以伪造固定集合内的标记。结果只对未被篡改的应用内容有意义。
- 语料的跨 Node 版本字节一致性依赖 zlib 实现；用 manifest 校验而不是假定一致。
- **虚拟机只能验证协议，不能产出基线。** 在 Parallels macOS 13.6 虚拟机（4 vCPU、8 GiB、无 GPU 直通）上：startup 与 import 1k 全部有效，但 `scrollRefreshIntervalMs` 约 180 ms（软件渲染）；import 10k 在 `probe_quiescent` 之后 WebContent 主线程停在 `CA::Transaction::commit → CABackingStoreUpdate_ → CA::CG::Queue::flush → semaphore_wait`，CPU 为 0，连 `setTimeout` 都不再触发，所以探针侧的看门狗也无能为力，只能靠脚本的 `importTimeoutMs` 判无效。这是虚拟显卡在超大图层上的停摆，裸机上不会出现；10k 场景必须在裸机运行。
- 探针的帧看门狗（`probe_error_frame_timeout`）只覆盖"事件循环还在跑但没有动画帧"的情况（窗口被遮挡、渲染极慢）；整个渲染进程被阻塞时由脚本超时兜底。
