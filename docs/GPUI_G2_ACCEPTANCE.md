# GPUI G2 / R11 原生验收

G2 当前保持未关闭。Kit 无头快照、绿色 CI、Tauri 的 macOS Smoke 都不能证明 GPUI 的 VoiceOver 朗读、IME 候选框定位或 App Sandbox 授权正常。本清单只接受 GPUI 实际候选上的原生证据；失败必须记录，不能用“接口存在”替代通过。

## 候选和隔离环境

- 在专用 macOS 测试账号上执行，使用项目自有合成 PNG/PDF；不打开用户真实图片、设置或缓存。不要把真实账号的设置复制进测试账号。授权、取消和拒绝测试均使用该账号新建的夹具目录。
- 记录源码提交、Kit/GPUI 锁定版本、macOS 版本、硬件/架构、屏幕缩放、语言、输入法、候选 `.app` 路径及主可执行文件 SHA256。中英界面各执行一次，证据标明场景和时间。
- VoiceOver/IME 可先用 direct GPUI 候选；沙盒项必须另用实际启用 App Sandbox、用户所选文件读写 entitlement 的签名 GPUI `.app`。签名身份、entitlements、profile（若构建要求）和构建日志与证据一起保存；验证签名后再启动。
- GPUI Probe 的裸二进制和现有 Tauri MAS 包不满足 GPUI 沙盒候选条件。现有正式 MAS 打包链仍以 `src-tauri` 为输入；本地开发候选需单独装配 GPUI `.app` 并核验签名，不能拿 Tauri 的成功记录勾选 GPUI。不要用开启 broad filesystem 权限的候选绕过授权路径。
- `apps/gpui` 的 Store 构建须 `--no-default-features`，同时遵守外部 codec 禁用和既有 entitlement 护栏。这里不授权上传、公证、TestFlight 或公开发布；G3 的正式包及 TestFlight 验收另外执行。

在目标 Mac 的专用账号中可先记录以下信息（路径替换成实际候选）：

```bash
sw_vers
uname -m
/usr/bin/codesign --verify --deep --strict --verbose=2 /path/to/ImgConvert.app
/usr/bin/codesign -d --verbose=4 --entitlements :- /path/to/ImgConvert.app
/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' /path/to/ImgConvert.app/Contents/Info.plist
/usr/bin/shasum -a 256 /path/to/ImgConvert.app/Contents/MacOS/imgconvert-gpui
```

签名核验失败或主程序不是本次 GPUI 候选时停止该候选的沙盒验收。仅有 `com.apple.security.app-sandbox=true` 也不能代替运行验收。

## VoiceOver 基本朗读

1. 在专用账号开启 VoiceOver，用 VO 导航实际 GPUI 窗口；记录朗读音频或带 VoiceOver 字幕面板的连续录屏。
2. 空队列检查导入、粘贴、语言切换、格式与输出目录控件的名称、角色和禁用状态。导入合成夹具后检查文件名、来源格式、动画/未知标记和转换状态可以理解。
3. 通过键盘依次进入设置区与悬浮操作栏，检查焦点可见、顺序合理、按钮可触发。选择输出目录并转换，记录运行/完成/告警的真实朗读。
4. 打开隐私或许可对话框，检查标题、关闭按钮、Escape 返回触发点。切换语言后名称跟随，未出现只有颜色或无名称按钮的关键操作。
5. 将实际朗读与操作者观察写入记录。若使用 System Events 辅助检查，需给实际运行它的终端/远程会话相应辅助功能及自动化权限；不自动改 TCC，不关闭 SIP。AX 树可见只是补充证据，不能代替朗读。

### 实际 VO 输出的辅助采集

在专用账号手动开启 VoiceOver 及字幕面板、开始全屏连续录屏，并把 VO 光标放到候选主窗口中的项目后，可运行：

```bash
osascript scripts/record-gpui-macos-voiceover.applescript "$CANDIDATE_PID" 20 first > voiceover.txt
```

`first` 从当前 VO 容器的首项开始；`continue` 从当前项向右继续。进入/退出队列行等容器、激活控件仍由实际 VO 操作完成。每次最多 100 步，记录实际 `text under cursor`、`last phrase` 与光标矩形；不根据 AX 名称拼接朗读，不调用 `output` 或 `say` 合成预期文字。脚本要求候选前台、原生聚焦窗口为 `ImgConvert`，拒绝额外窗口/选择器 sheet，并检查 VO 光标矩形完整位于候选窗口内，防止将菜单栏等独立 VO 上下文归给候选 PID。

矩形检查约束屏幕位置，不能识别覆盖在同一区域的其他辅助表面；仍须按连续视频排除。可按 [Apple 的 VO 光标导航说明](https://support.apple.com/guide/voiceover/navigation-commands-cpvokys04/10/mac/27) 将 VO 光标移回键盘焦点，不能把强制回到首项用于证明对话框自动聚焦。

输出不是验收通过结论。0.5 秒等待不能证明本次产生了新朗读，容器末尾可能反复返回最后一句；字幕中的操作提示也可能替换控件名称。必须结合连续视频、操作步骤及逐项结果核对。脚本不启动 VO、不修改字幕偏好、不激活产品操作，错误直接退出；采集者负责开始/停止录屏、恢复测试设置和原有 VO/字幕状态。原生 picker 与 VO 关闭/窗口外光标等拒绝路径须在实机负向核对。

## 中文 IME 候选框

1. 使用 macOS 简体拼音，键盘聚焦“文件名后缀”或“预设名称”文本框。实际逐键输入拼音，观察候选框靠近当前插入光标，不以粘贴汉字代替输入法。
2. 检查候选确认、翻页、Escape 取消组合、继续输入和退格。确认汉字不丢失、不重复，未确认的组合文字不会被设置同步覆盖。
3. 在窗口移动、调整大小、设置区滚动后重复；可用时在不同屏幕缩放的显示器间移动后重复。记录候选框与输入光标同时可见的录屏。
4. 组合过程中打开/关闭弹层或移动焦点，确认不会把未完成文本写入错误字段。数字输入保留既有数字校验；不要求其接受中文数值。
5. 记录输入法名称、步骤、实际文字结果与候选框定位。Kit Input 的 `firstRectForCharacterRange` 接口或无头文本测试只说明接口/逻辑存在，不证明原生定位。

## 签名 GPUI 沙盒授权

每条均记录候选 SHA256、选择器操作、实际输出和错误呈现；使用文件内容 hash 核对源未改变。

| 场景 | 必须观察的结果 |
| --- | --- |
| 选输入并选输出目录 | 原生选择器授权后转换成功，输出位于所选目录；不得依赖 broad filesystem entitlement |
| 取消输入或输出选择器 | 保留先前状态，不凭空添加文件或授权，不启动错误目标的转换 |
| 取消首次输出授权 | 没有输出目录会话授权时要求重新选择；不把保存的路径当授权 |
| 已选输出后取消再次选择 | 维持本会话此前有效的授权和目录，取消不指向新目录 |
| 拒绝/撤销访问或选择不可写位置 | 返回可理解的失败且可重选目录恢复，不产生半成品，不改动源文件；记录实际 OS 拒绝方式 |
| 关闭并重新启动相同候选 | 保存路径不能代替本次会话授权；重新选择输出目录后可转换 |
| 来源与输出重合 | 执行既有覆盖确认/来源保护策略，取消后源 hash 不变 |

这里的“授权”指实际沙盒文件操作。`ScopedResource::started()` 只表示 Core Foundation 是否开启 security-scoped session；普通 CFURL 可能创建成功但 start 返回 false。`false` 不等于选择器拒绝：PowerBox 可在当前进程授予访问，direct 运行也不需要 security scope。因此不以该布尔值阻止合法 I/O，也不把 `true` 当作完整沙盒验收。

## 证据和收口

每次记录一行，使用真实附件路径/链接，不预填通过：

| 提交 / 候选 SHA256 | Mac / OS / 架构 | 语言 / 输入法 / 缩放 | 场景 | 实际结果 | 录屏 / 日志 / 签名证据 | 操作者 / 时间 |
| --- | --- | --- | --- | --- | --- | --- |

当前记录（2026-10-19）：目标为 `ivmmdexuniji.local` 的 macOS 13.6 / arm64，用户确认 `ivmm` 为专用测试账号并授予辅助功能；此前的 `-25211` 已解除。所有候选、截图助手和日志位于独立 worktree 的 `target/tmp/g2-scope`，不改原有脏检出。钥匙串仍无正式签名身份；本地 ad-hoc 签名仅用于开发沙盒行为检查，不代表 MAS 信任、profile、公证或 TestFlight 验收（参见 [Apple 官方示例的 Debug 与 Distribution 区别](https://github.com/Apple-Actions/Example-macOS)）。

已取得的原生补充证据：

- scope 回归：独立 worktree 原生 Cargo 3 项通过；临时副本恢复旧 getter 时，未 start URL 回归失败，其余 2 项通过。产品源码未被负向验证修改；macOS Smoke 显式执行这些测试。
- 设置辅助树：11 个分组按钮均有名称及 toggled 状态（不等同 expanded 属性）；每个可见滑块只保留一个有名称的原生节点。Quality 原生 Increment/Decrement 得到 80→81→80；最低质量原生动作得到 30→关闭→30→31→30→关闭→30。无头 UI 同时覆盖键盘、边界与 busy，不能代替实际朗读。
- IME：direct 候选 SHA256 `8b7652ef6e54a41df56a94f4a4994a80cc527410cc671cfc9043d2515c0dfd30`，简体拼音逐键 n/i/h/a/o，候选含“你好”，Space 确认后 Enter 得到“你好”。字段位置 (930,595)、大小 (324,24)，候选 (923,623)、大小 (410,32)；窗口从 1080×748 调整到 1000×700 后，字段与候选 X 同步减 80，Escape 取消组合并关闭候选。已恢复 ABC、后缀 `_done` 和原窗口大小；窗口移动、滚动/焦点切换等完整矩阵尚未验收，且该候选早于最后的选项文本修复。
- 沙盒预检：使用 `--no-default-features`、禁用外部 codec/updater 的 GPUI 候选，仅授予 app-sandbox 与 user-selected.read-write，经本地 ad-hoc 签名及 strict 验签；OS 创建专属 `com.ivmm.imgconvert.g2-smoke` 容器。通过原生选择器导入 `precision16.png`、取消首次输出选择后重选自有目录，实际输出 580 字节 AVIF。源 SHA256 `8ec201a3a90d37cca5c5c47e4fad89b25f53c7e28d673444c91506abd2a43d32`，输出 `2712ac93e286cec5bcf4b464962a23060092918b66dbeb0d085b5dfe20feadc0`。此预检候选早于最后的选项文本修复，最终候选与复测另记 PR。

- 最终开发沙盒候选：`target/tmp/g2-scope/sandbox-final/ImgConvertG2.app`，签名后二进制 SHA256 `9d0222e6e3af68872c56efb4b80c9754c07b566cff0e3b888420342026f45d9f`，同一 Store 功能开关与最小 entitlement、strict 验签通过；新 `choice.rs` / `settings_form.rs` 与 PR 源码 hash 一致。原生树已包含 JPEG/PNG/WEBP/AVIF 文本，键盘 Up/Enter 可从 AVIF 切换为 WEBP；文本节点没有广告 AXPress，不能把菜单显示名称当作 VoiceOver 交互通过。原生选择器导入 PNG 后输出 154 字节 WebP，取消再次选目录保留此前目录与授权。重启相同候选后，保存路径仍显示，但点击 Start 实际再次打开原生目录选择器；取消后未产生新输出。拒绝/撤销访问、重选恢复和来源重合等剩余场景仍逐项待验。

仍缺实际 VoiceOver 朗读记录、可见窗口的连续录屏和完整 IME/沙盒场景矩阵。最初远程 `screencapture` 只取得壁纸；独立“ImgConvert G2 Capture”助手发起权限申请后，用户已开启屏幕录制，实际窗口截图成功，权限障碍已解除。静态截图仍不能替代完整连续录屏和朗读记录。辅助树与逐键输入已有补充结果，三项仍未全部通过，G2 保持未关闭。

三项全部有通过证据后，把对应提交和证据补入 `GPUI_MIGRATION_PLAN.md` 阶段 2，再按 G2 原文判断是否收口。若原生验收失败，先修复并复测；G2 未关闭前不提前推进阶段 4/5 或 D1a/C1。G1/G3 的发布、签名、公证和正式包验收依然独立。


## 2026-10-19 后续：队列内容语义与 IME 对照

PR #34/#35 已合并，main `ee24b3a`。旧卡片候选的辅助树含对比、移除和逐项格式按钮，却缺少文件名、元数据和状态节点；仅有 `aria_label` 和 test-support 不能使默认忽略的 Div 成为原生节点。本片补原生角色和值，验证状态与语言切换，具体候选 SHA256/实际朗读和 CI 记在 PR；不得以组件断言代替朗读通过。

IME 观察进一步核对：实际鼠标拖动也能复现组合候选停在原位置。自建无文件读写的 Cocoa NSTextField 对照在同一 macOS 13.6、同一简体拼音下：字段由 (340,540) 移到 (424,555) 再到 (484,585)，已有候选仍为 (328,564)，组合文字 `ni hao` 保留。GPUI 对照字段由 (930,560) 移到 (1014,575) 再到 (1074,591)，候选也停在旧点，重开组合后重新定位。该现象不能单凭 GPUI 的一次 AX 移动认定为其独有缺陷；也不能据此将整个 IME 验收勾选通过。继续执行移动/滚动后重新组合、确认/取消、翻页/退格和弹层焦点矩阵，保留同时可见的原生证据。隔离平台实验不进入依赖锁文件或产品源码。

自动化须核对实际输入框内容及候选位置；对文本框发送辅助功能 click 不一定聚焦，不能把按键发送成功当成输入成功。候选窗口无名称时，按明确的主窗口标题定位字段，避免把 IME 浮窗当成主窗口。截图采集须等待本次文件更新时间，不能读取前一次成功遗留的图片。

原生首轮补齐后已能朗读文件名、PNG/尺寸和等待状态，但同文案 label+value 导致重复朗读；后续改为静态文本只提供 value，运行 Group 只提供 title、保留命名的数值进度后代。此修复也覆盖共用 Choice、空状态和底栏；以最终实际朗读复测为准。

## 2026-10-19 后续：不可写输出与来源保护

PR #36 已合并到 main `3a66b5a`。其最终开发沙盒候选 `target/tmp/g2-scope/g2-queue-speech/ImgConvertCards.app`（签名后二进制 SHA256 `429011c2bcbf155a85f3217a46ea7c12c804ebde812107cf26746031384a9a0d`）在同一 macOS 13.6 arm64 专用账号补验：

- 原生选择器选择自有 `g2-denied-output`（目录权限 `0500`），4 项转换全部返回本地化的“没有权限写入输出目录：…请…选择文件夹后重试”；目录内无输出和临时文件。这证明启用沙盒时的实际 POSIX 不可写失败，不代表已测试 PowerBox 撤权。
- 重选自有 `g2-recovered-output`，不重启、不清空队列，直接重试得到 4 个完整 AVIF（580 字节及 3 个 39393 字节文件），完成 4 / 跳过 0 / 失败 0；4 个源文件 hash 不变。
- 输出选回源夹具目录，PNG、关闭后缀、覆盖模式，重置后开始；实际出现“取消”及“确认覆盖原图”按钮。点击取消后源目录仍只有原 4 个 PNG，hash 不变。16-bit 源 SHA256 `8ec201a3a90d37cca5c5c47e4fad89b25f53c7e28d673444c91506abd2a43d32`；3 个独立 4096×4096 PNG 均为 `a5cca739f3913c048db101b6f6bf172b587f7c7e24f5831c022afdad4b45833f`。操作后已恢复 AVIF、跳过、后缀 `_done`、自动并发及中文。

同次检查发现底栏总进度是无名称 `AXProgressIndicator`（完成批次 value 100）。本片补“批量转换进度”/“Batch conversion progress”，继续保留原数值、生命周期和相邻成功/失败汇总。新增原生只读回归脚本：

```bash
# 在专用 Mac 上运行；候选须已显示运行中或已结束批次的总进度。
# PID 换成该 GPUI 候选的进程号，不以其他 Tauri/GPUI 窗口代替。
osascript scripts/check-gpui-macos-progress.applescript 12345 '批量转换进度'
# 切换英文、重新读取原生窗口后：
osascript scripts/check-gpui-macos-progress.applescript 12345 'Batch conversion progress'
```

脚本明确按 PID 和 `ImgConvert` 主窗口定位（不遍历文件选择器或 IME 浮窗），要求所有原生进度条有名称及 0–100 数值，且恰好一个名称匹配预期的总进度条。旧候选负向执行确实报 `Unnamed native progress indicator`；修复候选的签名 hash、双语正向结果、运行状态及沙盒复测记录在本片 PR。脚本不点击、不授权、不操作文件；未显示进度时应失败，不能用空树充当通过。

运行过程中原生节点可能在读取前被状态更新替换（实测 `-1728`）；脚本仅对此错误重新读取完整树，最多 3 次，仍失败则退出。名称/数值断言失败不重试、不吞错。

本片修复候选 `target/tmp/g2-scope/g2-recovery-final/ImgConvertCards.app`，签名后二进制 SHA256 `bed2800f73c589706c05e8aedf8be1ddf2ddb8f0415e9b37a4b159469feb0ec9`；同样禁用 updater/外部 codec、`--no-default-features --locked`，仅 app-sandbox/user-selected.read-write，strict ad-hoc 验签通过。两份改动运行源码 hash 与本地一致。复测自有 `g2-final-denied` 的 4 项权限失败、无半成品，重选 `g2-final-recovered` 后直接重试得到 4 个完整 AVIF，4 个源 hash 仍一致。中英总进度名称与 100 数值通过；运行时同一原生树包含“large-0.png 的转换进度”5 和“批量转换进度”25，结束后 100。错误预期名称的稳定状态负向执行报匹配 0 个，不能误通过。原始日志与最后脚本复核记录在 PR。

这些仍是开发候选证据。实际撤销沙盒访问、完整重启/取消矩阵的最终候选复测、连续录屏及完整 VoiceOver/IME 场景仍需补齐，G2 不关闭。

## 2026-10-19 后续：IME 连续记录与最小复现

PR #37 已合并（main `fd630b2`）。继续使用其未打框架补丁的沙盒候选，主程序 SHA256 `bed2800f73c589706c05e8aedf8be1ddf2ddb8f0415e9b37a4b159469feb0ec9`，同一 macOS 13.6 arm64 专用账号。系统 Screenshot 界面可录到实际窗口，已取得 H.264 3024×1900 连续视频；CLI `screencapture -v` 失败及早期仅输入字母的尝试不计通过。截图助手的二进制及 TCC 授权未被替换。

| 场景 | 实际结果 |
| --- | --- |
| 逐键 n/i/h/a/o | 字段 `ni hao`，系统候选含“你好”，字段 (930,560,324,24)，候选 (923,588,410,32)；保存值仍为 `_done` |
| 退格、继续输入、确认 | `ni hao` → `ni ha` → `ni hao`；Space + Enter 得到“你好”，候选关闭 |
| 展开与翻页 | 输入 `shi`，PageDown 展开候选网格，再次 PageDown 后可见页首“适/示/狮/始/驶/仕”；Space + Enter 确认“适” |
| Escape 取消组合 | 组合字段清空，候选关闭；已保存的上一次确认值保留 |
| 移动、缩小后重新组合 | 窗口 (300,100)、1000×700，字段 (998,575,260,24)，候选 (991,603,410,32) |
| 设置区滚动后重新组合 | 字段由 y575 到 y495，候选由 y603 到 y523，均上移 80；组合文字及候选正常 |
| 组合中打开隐私对话框 | **未通过**：AX 激活及物理点击均复现旧候选仍覆盖对话框；字段恢复已保存值，Space 先收起候选，未触发对话框操作 |

上述“移动/滚动后重新组合”不表示“组合中移动”通过，也不替代原有 Cocoa 对照记录。输入法辅助程序报告选中拼音不足以证明目标窗口正在组合；本次也遇到仅得到字母的激活尝试。必须确认标记文字与真实系统候选，再记录结果。

原始视频保存在隔离 Mac 的 `target/tmp/g2-scope/g2-ime-recordings`，本机核验副本在 `artifacts/reviews/g2-ime-2026-10-19`，均不入 Git 或公开上传。`ffprobe` 核验 H.264/分辨率/时长，复制后 SHA256 一致，并抽帧检查实际内容：

| 本机副本 | 时长 | SHA256 | 内容 |
| --- | --- | --- | --- |
| `g2-recording-03.mov` | 501.720 s | `a1761d42ade3654cf68ba9ca235197e5b95b366e340eb9d504282f49c37db2fe` | 组合、退格、确认、翻页、取消和弹层问题 |
| `g2-recording-04.mov` | 82.667 s | `4731548cb852aa9a657a3abbae4c803a14bf8083f9cafced731539edbe5a0762` | 移动/缩小与滚动后重新组合 |
| `g2-recording-05.mov` | 43.450 s | `377e43fc1977511632ef37ce469e16f1f7fb6cb1527a016b04e736a735958ee2` | 不含业务回调的 Kit 最小程序也复现候选覆盖对话框 |

新增 `scripts/check-gpui-macos-ime.applescript` 只读核对 PID、指定字段精确文本（区分大小写/变音符号）、原生 `InputMethodCandidateList` 的出现/消失并报告 bounds；不输入文字、不改设置、不以坐标自动判断通过。候选列表内所有 AX 按钮不一定等于当前可见页，翻页须结合视频。脚本不能证明焦点归属、保存值或完整 IME 验收。

```bash
osascript scripts/check-gpui-macos-ime.applescript 12345 '文件名后缀' 'ni hao' present
osascript scripts/check-gpui-macos-ime.applescript 12345 '文件名后缀' '你好' absent
```

原生负向测试：保存 `_done` 时预期 `_DONE` 明确失败；没有候选却要求 `present` 明确失败，避免将普通字母输入当作组合输入。只对陈旧原生引用的 `-1728` 限次重取完整状态，语义断言错误立即退出。

最小复现及未采纳的平台实验见 [GPUI_IME_REPRO.md](GPUI_IME_REPRO.md)、[GPUI_PATCHES.md](GPUI_PATCHES.md)。只读评审发现最小程序的版本指引、关窗退出和启动失败退出码问题，已修正后复核；平台实验的清理/重聚焦问题没有被带入产品。当前仍缺焦点切换修复、完整 VoiceOver 连续记录与沙盒撤权等证据，G2 保持开放，不推进阶段 4/5。

修订后的最小程序在 Mac 以原锁 `--locked` 重新构建，本地/远端源码 SHA256 同为 `711f73d89feb5d33e44b6cfdc9af13994b47375a9a47eb3f0768c1bf6e7d97be`；测试 App 主程序 SHA256 `602aa2e89792a032a66db444176c0d577c335da7a1a1e82450f4b6b0f95c4e91`。实际渲染字段后点击唯一窗口的红色关闭按钮，进程退出。测试结束已停止临时例程/对照/平台实验，恢复原未打补丁的沙盒候选、ABC、中文、AVIF、跳过、`_done`、自动并发与原窗口尺寸，VoiceOver 保持关闭；录屏临时目的地偏好也恢复。

## 2026-10-19 后续：owner 状态回归与上游报告

PR #38 已按用户授权合并（main `a00e9e1`）。本片继续 G2，不推进视觉重排或后续阶段。用户明确授权提交最小复现后，已创建并核对 [longbridge/gpui-kit#3605](https://github.com/longbridge/gpui-kit/issues/3605)：只包含最小代码、锁定版本、步骤和实验边界，没有上传账号路径、截图或录像。

隔离候选及准备/核验工具见 [`patches/gpui-ime-focus`](../patches/gpui-ime-focus/README.md)。正常产品 manifest / Cargo.lock 没有改变，也没有启用框架补丁。Mac 独立 Kit harness 核对全部依赖仍属于原产品锁的包名/版本/来源集合，Kit 五个包保持 0.7.1，core/macOS 保持 0.3.8。显式运行的 13 项 macOS 无头回归通过；同矩阵未打补丁的十项控件测试为 3 通过、7 失败，失败包括对话框转移、输入消失、文本间转移和同 FocusId 更换实体。普通缓存与同帧返回原焦点的对照保持通过。Python 准备/核验工具 13 项测试通过，覆盖 Unicode TOML、错误来源/版本、陈旧测试副本、测试入口替换、13 个无关测试冒充通过、符号链接重定向和零测试误通过等边界。

这些结果仅证明旧 client 状态及补帧调度。真实原生复测中，最小 entitlement 的 ad-hoc 沙盒候选 strict 验签通过，主程序 SHA256 `43645640e5d5278b1d58cc298965b2a44700b6c142a716e998a67a6d101251a3`：

| 路径 | 实际结果 | 结论 |
| --- | --- | --- |
| AXPress 激活隐私 | 先验证 `ni hao` 与系统候选存在；对话框出现、字段及保存值恢复 `_done`，旧 `InputMethodCandidateList` 仍存在 | **未通过**；清 marked range 加 `discardMarkedText` 尚未证明结束系统会话 |
| CG 鼠标激活隐私 | 候选消失，字段与保存值变为原始 `nihao` | 后端已有 MouseDown 先交 `inputContext.handleEvent:` 的路径；需与未打补丁版本比较，不作为 AX 路径修复或新保存策略的证明 |
| 最小例程的鼠标路径 | 候选关闭，返回输入可再次组合确认；组合中关闭窗口后进程退出 | 仅此路径通过，不覆盖 AX 路径 |

以上为早期 discard-only 版本的失败记录，不能被无头通过覆盖。后续上下文重置版本另按下面的实际候选验证；G2 仍保持开放。


### 最终隔离候选：AppKit 上下文重置

同日最终候选不含诊断日志，保持原产品依赖版本与同一专用沙盒容器。主程序 SHA256 `82aed64053aa58c418e439a377ea67ebffcef03b077776572a26b7153bec6ae9`，Kit 最小例程 SHA256 `4cb2c09c4da24616ded3ae3d79719584f52f3e0b50f310d8c1d9787e9161e102`；两 App 均以 ad-hoc runtime 签名并通过 deep/strict 验签，主程序只含既有最小沙盒 entitlements。这不是正式 MAS / G3 签名候选。

修订在清旧 client、discard 后结束该 view 的活动输入上下文，并在窗口未关闭、仍是 key window 的同一 first responder、没有其他活动 context 时重新激活。view/context 以局部强引用跨越回调，不持 native mutex；读取全局 context 只作身份保护，不对全局或其他窗口发取消。没有延迟任务可以在稍后取消新组合。测试脚本按是否存在关闭控件判断模态状态；最小例程标题栏与 footer 都叫 `Close`，不可要求恰好一个。

| 场景 | 最终候选 | 同机未打补丁对照 |
| --- | --- | --- |
| 最小例程 AX 打开对话框 | `ni hao` + 候选 → 对话框出现、候选关闭；首个 Escape 关闭对话框 | 已由前片复现旧候选滞留 |
| 不切换输入法、不借 Cocoa 预热直接返回 | `shi` 真实候选，确认“适”；另连续三次 `ni hao` → AX 模态 → Escape 均通过 | 不作为旧版通过结论 |
| 其他窗口正在组合，后台 AX 打开 GPUI 模态 | Cocoa 保持 frontmost、`ni hao` 和系统候选均不变；仍可确认“你好” | 不取消其他上下文 |
| 组合中关闭最小例程窗口 | 进程正常退出 | 不以强制停止冒充退出通过 |
| 沙盒应用 AX 打开隐私 | 字段和保存值 `_done`，候选关闭，首个 Escape 关闭对话框；直接重新组合确认“适”并保存 | 同样恢复 `_done`，但候选仍在；首个 Escape 只消候选，第二个才关闭对话框 |
| 沙盒应用 CG 鼠标打开隐私 | 字段和保存值 `nihao`，候选关闭；首个 Escape 生效，直接返回组合确认成功 | 同样为 `nihao` 且候选关闭；证明这条原始拼音提交来自既有 MouseDown 输入法处理，不是本补丁改写保存策略 |

前片的点击观察没有独立确认 AX 合成动作与实际 CG 鼠标事件的差异；本片明确区分两条路径，旧版 CG 控制通过，可靠失败路径为 AXPress。复现指引以本片分类为准，不把早期“物理点击”措辞当作 CG 控制必须失败的依据。

最终连续视频已复制校验并用 ffprobe 核对 H.264 / 3024×1900，抽帧可见新旧隐私对话框的候选差异；原始媒体仍只保存在忽略目录，不上传 Git 或上游 issue：

| 副本 | 时长 | SHA256 | 内容 |
| --- | --- | --- | --- |
| `verified-recording-01.mov` | 58.817 s | `7b6f96df71c505d64f47258d06a1910bbce871143d1190669944e15523fd0206` | 最小例程 AX、直接返回及三次重入、独立 Cocoa 上下文、组合中关窗 |
| `verified-recording-02.mov` | 120.800 s | `d981cf1022546318d82fef1c7a27d64a834300fa92005931f3915081a49a6217` | 沙盒应用 AX/CG、新旧对照、首个 Escape 和返回输入，最后恢复保存值 |

本片没有正式启用补丁。G2 剩余完整 VoiceOver 连续记录、沙盒撤权等原生矩阵，以及候选的正式来源/许可证/构建接入仍待完成；不据此关闭 G2，也不进入 D1a/C1 或阶段 4/5。

最终源码与 manifest 校验后，独立 Kit harness 再次跑满预期名称的 13 项 macOS 回归，全部通过；Python 工具 13 项通过。只读 review 中的 owner、最终焦点选择、补帧阶段、首次无旧 client 恢复、Unicode TOML、替换测试入口误通过及符号链接输出越界均已修复并复核，最终无新增 P1/P2/P3。测试结束核对专用设置与开始前逐字段一致，ABC、VoiceOver 关闭及录屏三项目的地偏好恢复；Cocoa/最小例程进程已退出，原未打补丁的预览继续运行，既有其他开发实例未动。

## 2026-10-19 正式源码接入：普通开发构建

PR #39 已按用户授权合并 main `03c54cf`（7 个必需 CI 作业通过）。本片把上面最终候选的同一份运行时代码接入正常 GPUI workspace；不再要求额外 Cargo config、改写锁文件或临时替换 registry 源码。仅对 `gpui-pre` / `gpui-pre-macos` 0.3.8 使用本地来源覆盖，Kit 五包保持 0.7.1；其他平台包仍来自 registry。

- 保留 116 个必要运行时、构建资源、原始 manifest 与完整许可文件，共约 3.7 MiB；不复制上游示例/测试媒体或整个 Kit 框架。必要 Windows manifest 资源保留。
- 新锁 SHA256 `3b7fc3c9646e8d4c22f47018bdc2f4d7b4fff6d22a2c3cfcf2fcf324699a5a3a`；补回这两个原有 source/checksum 后严格恢复旧锁 SHA256 `3c0ef2dbf7b91fd868acdf79bf48f85e0b295f50242ed763708a9188f63afed1`，没有新增或升级依赖。
- `verify.py --archives` 按已锁定的原始发布归档加差分逐字节重建全部保留文件；`--metadata` 核对普通产品构建实际选中路径、版本和八个自有 workspace 成员。来源审计接入架构护栏，metadata 审计接入 CI。真实 `core.autocrlf=true` checkout-index 验证 116 文件及锁逐字节一致；保留上游注释空白，不以格式化改写归档字节。
- 工具 19 项测试通过，覆盖额外文件、源码/Windows 资源漂移、重定向链接、registry 回退、错误路径及首次临时目录创建；护栏负向加入直接 `gpui-pre` 依赖时明确失败，恢复后通过。
- 许可证重新生成核验通过：898 包、210 正文、281 补充文本，入库生成物逐字节不变。两轮 Codex 只读评审无确证 P1/P2/P3；评审不代替实际测试。

Mac 独立 Kit harness 用 `--active` 指向实际产品覆盖源码，13 项 owner/调度回归全部通过。Linux GPUI fmt/clippy 及 95 项测试通过；首次并行链接因 SIGKILL 失败，改为 `-j1` 后全部通过。根 workspace fmt/clippy、397 项测试（另 1 项原生测试 ignored）、前端 check/161 项、全仓格式、完整许可证、文档/成本/架构护栏通过。Mac 普通 `cargo build --release --locked`（无额外 config，`--no-default-features`）已构建应用和最小例程，锁文件逐字节不变；两 App 以既有 ad-hoc runtime 签名通过 deep/strict 验签，主应用使用既有最小沙盒 entitlements。主程序 SHA256 `c96e5bde22143282e8baf3206cbdc10e7a4df41c2428abcbe7e89d493e53691c`，最小例程 `cdfa60b4cc677be844b44b6745208111aae111532bc52f4b5c992222ddb7b3e8`。普通产品 workspace 无额外 config 的十项 macOS 控件回归也全部通过，锁保持不变；现有探针口径的 CGS/SLS 未定义符号与 PrivateFrameworks 链接扫描为零命中。最终 CI 以本片 PR 为准。此接入不关闭 G2：完整 VoiceOver 连续记录、沙盒撤权等矩阵仍须完成，不进入 D1a/C1 或阶段 4/5。

普通构建的原生复测再次通过上表同一矩阵：最小例程 AX 候选关闭、首个 Escape、直接 `shi` 确认“适”、连续三次直接重入、后台 GPUI 动作保留 Cocoa 的 `ni hao` 与候选、组合中关闭进程正常退出；沙盒主应用 AX 恢复 `_done` 且候选关闭，首个 Escape 关闭隐私，直接新组合确认“适”并保存。旧版对照仍保留候选且首个 Escape 只消候选。两版 CG 鼠标路径同样保存原始 `nihao`，没有改写既有保存策略。随后真实组合确认“你好”通过。

连续记录已复制并逐字节核对 SHA256，ffprobe 均为 H.264 / 3024×1900；对话框期间抽帧可见新版无候选、旧版仍有候选。媒体只保存在忽略目录，不上传 Git / 上游：

| 副本 | 时长 | SHA256 | 内容 |
| --- | --- | --- | --- |
| `active-recording-01.mov` | 63.567 s | `3463acc2667b82324a21bd1b53c70dc49a321c894150d0dcf52a0fa257be4af4` | 普通构建最小例程 AX、直接返回/三次重入、独立上下文、组合中关闭 |
| `active-recording-02.mov` | 130.400 s | `2d27654ed3167f68dc6d165593a2fbc0714783573a339afb6ce03a1daaef63b7` | 普通构建沙盒主应用 AX/CG 与旧版对照、Escape、重新组合确认与保存 |

结束后专用设置与开始前逐字段一致，ABC、VoiceOver 关闭及录屏三项目的地偏好恢复；Cocoa/最小例程已退出，恢复原预览，其他既有开发实例未动。构建缓存中保留当前正式接入的普通产物，没有回写旧版源码/锁。仍观察到既有后缀校验反馈在恢复保存值后可能残留 Required 文案，留待独立修正；本片不改变 blur 的保存策略。完整 G2 原生矩阵仍保持开放。

## 2026-10-20 后缀 Required 反馈修复

#40 已获用户授权合并 main `924a550`：同一 head 的 CI run 39282414018 与 Windows x64/ARM64 GPUI Probe run 39282425362 整体 completed/success。GitHub 故障期间部分 job 详情的陈旧状态已在 PR 评论记录；CI/探针结果不再是待运行。

本片修复上段记录的旧 Required 提示：清空草稿产生 Required，IME preedit 不发普通 Change，打开隐私导致 blur 恢复已保存 `_done` 时旧错误仍留下。现在仅在非空草稿提交/恢复时清除旧 Required；真正空草稿的默认值回退和 Required 提示、归一化的 Adjusted 提示保留原行为。反馈本身增加原生 Label 和双语名称，布局不变。

真实组件三项回归覆盖组合 marked range、清空时有效错误、隐私对话框失焦恢复、保存值不变、返回后输入确认、空值回退和一次粘贴的归一化/Enter；测试明确激活窗口以取得真实焦点事件。移除清理逻辑后，失焦回归在旧反馈残留断言失败，还原后三项通过。无头组合直接驱动真实 InputState 的输入 handler，不宣称系统候选框通过；修复后 GPUI 98 项、clippy/fmt、根 workspace 397 项（另 1 项 ignored）、前端 check/161 项及完整格式/许可/文档/成本/架构检查通过。原生复测发现仅设置 `aria_label` 的静态文字在 Mac 上值为空，已复用队列反馈的 `aria_value` 写法，并加强组件断言；修正版已完成下面的原生复测；只读首轮评审与属性修正复核均无确证 P1/P2/P3，不能用无头可读名称替代原生文字值。

修正版普通 `--release --locked --no-default-features` 构建与最小 entitlement 的 ad-hoc runtime deep/strict 验签通过，主程序 SHA256 `09a8df50ec87aa8d2f91b7d62dbf65df49f15ae4a932d4803cb18dbc0e68685e`。在同一专用沙盒容器取得真实 `ni hao` + 系统候选后，Required 原生文字值数量为 1；AX 打开隐私后字段/保存值恢复 `_done`，候选为 0、Required 为 0，首个 Escape 关闭隐私。直接返回、不切换输入法或借其他输入框预热时，`shi` 真实候选确认“适”并保存；空草稿失焦仍回退 `_done` 且保留原 Required 提示；输入 `bad/` 后的 `bad_` 及 Adjusted 原生文字值也通过。

连续视频 `suffix-feedback-recording.mov` 已复制核对 SHA256 `fb353a00a3dd6cc033a063b50ce61ddd9f215be5ee81d10ffa5eddd638b29988`，ffprobe 为 H.264 / 3024×1900 / 85.750 s；抽帧核对组合时的候选和红色提示、隐私打开后两者消失。媒体只保存在本地忽略目录。结束后逐字段核对专用设置恢复，ABC、VoiceOver 关闭与录屏三项偏好恢复，临时 Cocoa 已退出、原预览恢复，其他既有开发实例未动。这是原生 AX/IME 证据，不替代完整 VoiceOver 朗读记录、正式 MAS 签名或沙盒撤权矩阵。最终同 head CI 结果见本片 PR。

## 2026-10-20：实际 VO 字幕连续记录与采集保护

#41 已合并 main `40536dc`。本轮复用该片正常构建并验签的专用沙盒候选，主程序 SHA256 `09a8df50ec87aa8d2f91b7d62dbf65df49f15ae4a932d4803cb18dbc0e68685e`；运行时源码未再修改。macOS 13.6 / arm64、中文系统、ABC、2× 屏幕，实际开启 VoiceOver 及原有字幕面板，使用 Screenshot UI 全屏连续录制；没有调用 `say` 或 VO `output` 拼接预期朗读。

| 视频（本地忽略目录 `artifacts/reviews/g2-voiceover-2026-10-20/`） | 实际覆盖 | SHA256 |
| --- | --- | --- |
| `屏幕录制2026-10-20 01.20.01.mov`，H.264 / 3024×1900 / 153.000 s | 空队列实际 VO 导航：添加文件/文件夹、粘贴、语言、格式、质量、设置分组与底栏输出目录/开始转换；字幕面板可见 | `848ad175ee910a875e2f53ecb605d7d069fc9cccbc079f0887d201f683f9dca6` |
| `屏幕录制2026-10-20 01.24.31.mov`，同规格 / 747.700 s | 原生选择器导入自有 16-bit PNG；VO 进入队列行后朗读文件名、`PNG · 16 × 16`、逐项按钮和等待状态；实际 Control-Option-Space 切换到英文，核对 Plugin diagnostics / Privacy / About / Queue / Conversion settings 等名称更新 | `2c868793eb25ecd28a56f56eb917c38e8b6608349f5706947110ec13a7db7f63` |

两个视频均已复制到本地并校验，抽帧检查空队列、质量/底栏焦点、队列与英文名称；原始媒体未上传到 PR 或上游。实际 `last phrase` 与 VO cursor 日志保留在同目录，`keyboard-main-en.txt` 包含逐步矩形。容器末尾重复最后一条，以及字幕被操作提示覆盖均实际出现，不把这些重复算作额外覆盖。

本轮对话框/反向切换的两段自动操作没有得到完整通过结果：预期隐私阶段的采集仍读到背景主界面；最后一次反向切换未满足持久设置为中文的断言。失败保留在 `queue-dialog.log`、`keyboard-phase.log` 及相应 JSON 中，不将文件名带 `privacy` / `en` 的失败输出当作通过证据。尚需用稳定渲染后的实际键盘步骤定位激活、模态焦点与脚本重定位之间的影响；运行/完成/告警的字幕记录、完整键盘/模态结果与剩余沙盒矩阵仍未完成，G2 保持开放。

只读 review 首轮发现 1P2：全局 VO cursor 可与候选键盘焦点独立。新增实际聚焦窗口及初始/逐步光标矩形保护后，两轮复核无新增 P1/P2/P3。原生负向测试的最初一次准备先运行旧采集器，改变了 VO 上下文，新采集时得到窗口内矩形与旧 `Apple` phrase，未触发预期拒绝；该次断言明确失败并保留在 `validate-restore.log`，不算保护通过。这也证明固定延时及窗口内矩形不能独自证明 phrase 新鲜或归属，仍须结合视频。

本地根 workspace fmt/clippy 与 397 项测试（另 1 项 ignored）、GPUI fmt/clippy 与 98 项测试（shell UI 37）、前端 check/161 项、全仓格式、完整许可证（898 包 / 210 正文 / 281 补充）及文档/成本/架构护栏通过。候选测试结束后专用设置逐字段恢复，原未打补丁预览恢复为 PID `13304`，VoiceOver 关闭、字幕原开启状态及录屏三项偏好恢复；后续仅在该专用预览上复核采集工具拒绝路径，不能当作当前产品候选的新增行为验收。最终同 head CI 及拒绝路径复核结果见本片 PR。

拒绝路径最终复核已完成：在专用原预览上用实际 VO 菜单栏快捷键重新建立上下文，记录到状态菜单矩形 `{1173,-3,1195,26}`；早期脚本继续返回 0，最终脚本在初始矩形检查明确报 `VoiceOver cursor is outside the candidate window`，移回键盘焦点后又正常采集。字幕关闭、原生 Open 选择器聚焦、无效 PID、步数 101、错误模式及 VO 关闭均以非零退出且无成功输出；窗口内正例正常记录。`guards-recheck-final.log` / `results.json` 保留实际结果。拒绝路径复核结束后设置仍逐字段相同、VoiceOver 关闭、字幕偏好保持原开启值，录屏三项偏好恢复。此正反例验证的是采集工具，不补算产品模态或转换场景通过。


## 2026-10-20：模态焦点修复（无头回归已接入）

#42 已按用户授权合并 main `e858689`。实际 VO 复查发现旧自动流程可能把陈旧的 `last phrase` 当作当前按钮身份；改为等待实际 cursor 稳定并检查真实弹窗与语言持久化后，两种语言的激活/关闭及语言往返可以完成，但文档初始朗读仍不稳定。因此这些自动操作失败不能直接归因于产品按钮失效，也不能把历史 phrase 当作通过证据。

Kit 0.7.1 的 Textarea 将有辅助角色的 frame 与真正编辑控件分别绑定到不同焦点 handle；真实键盘聚焦编辑器后，原生 `AXFocusedUIElement` 仍可能为窗口。应用候选在原有文档包装上绑定真实编辑焦点与只读文本角色，取消内部重复辅助节点，打开后一次聚焦正文，并在模态存在时隐藏背景辅助子树。只读输入的 Tab/Shift-Tab 转发 Kit 已注册的 `root::Tab` / `root::TabPrev`，复用 Root 的焦点约束；不在 render 中强制抢焦点。

review 随后发现共享 handle 触发底层 TabStopMap 的独立 P2：lookup 保留最后注册，排序树却保留此前注册，反向切换反复遇到同一 handle。`tests/tab_stop.rs` 在原源码实跑失败；仅在隔离路径删除同 ID 的旧排序项后实跑通过。最小代码、版本、步骤与候选差分见 `GPUI_TAB_STOP_REPRO.md`。按迁移方案 §3.1，正式接入前先向上游提交最小复现。用户明确授权后，已提交 [longbridge/gpui-kit#3612](https://github.com/longbridge/gpui-kit/issues/3612)；正式 vendor 已接入同一行修复，`patches/gpui-ime-focus` 的差分、manifest 与文件清单同步更新，锁文件与依赖版本不变。未修源码上原始回归与法律弹窗循环失败，接入后通过。

Mac 初版候选确认模态期间背景入口从 2 个变为 0，关闭后恢复 2 个；中文曾进入文档，英文仍停在窗口，故不判定完整通过。一次 macOS 听写系统提示干扰已通过“以后”取消，未启用听写或变更系统权限；该次失败保留、不计入通过。最新语义绑定与底层修复已在正式 vendor 接入，仍需用正常产品构建重做原生复验。全部原始媒体和探针留在本地忽略目录 `artifacts/reviews/g2-vo-modal-2026-10-20/`；完整 G2、后续运行/完成/告警朗读及沙盒矩阵继续开放。


正式 vendor 接入后本地 GPUI 全部 102 项及 `clippy --workspace --all-targets -- -D warnings` 通过，包含 38 项 shell UI、3 项 `tab_stop` 边界回归、两种离线文档的初始复制、四个控件的完整反向循环与关闭后返回触发入口。原支持链接测试把 Tab/Enter 放在同一事件中，因 Root 延后分发而失败；拆成实际独立按键事件后完整重跑通过。首轮 readonly review 未发现 P1/P2，提出 4 项 P3：两份文档的旧状态、测试计数、无头测试对只读值/隐藏子树的覆盖不足，以及补丁文件 EOF 空行。旧状态、计数和 EOF 已修正；UI 测试补充了可访问名称断言，只读值、`set_hidden` 后的原生树与完整朗读仍只能由原生证据确认。共享 handle、缓存重放与 `tab_stop` 状态切换已用 3 项 `tab_stop` 回归覆盖，未另增原生覆盖。

Mac 隔离构建（显式 `--config`，不是正式源码接入）已完成 ad-hoc 沙盒 deep/strict 验签，主程序 SHA256 `a74bd4f37fb4cd6bbf4c42cb70f897c334ee49d378beaea164bc93c871d4c715`，锁文件保持原字节。首次探针在弹窗刚出现即断言 `AXFocusedUIElement=AXTextArea`，实际仍为 AXWindow，未通过。复测等待稳定后，实际 VO cursor 连续四次分别为“隐私与支持 编辑文本”与“Privacy and support 编辑文本”；没有在打开后调用 AXRaise、移至第一项或重定位 cursor。实际 Escape 后模态消失且背景入口恢复；精确 current 正例和错误大小写拒绝均有原始记录。字幕 `last phrase` 此时为空、原生 focus 属性仍为 AXWindow，因此仅确认双语 VO 光标进入文档，不据此声称完整朗读/原生焦点验收通过。


最新复测最终因附加键盘步骤在 45 次 Tab 内未从进程的 `AXFocusedUIElement` 观察到 Privacy 而退出失败，不能证明原生键盘返回入口。此前双语实际 cursor、真实模态关闭与语言往返的记录保留，但整段探针不记为通过。finally 已逐字段核对专用设置恢复、关闭 VoiceOver、恢复字幕与录屏偏好、退出候选并重新启动原预览 PID `14937`。原始结果已取回本地 `modal-native18-retry.log`。改动已提交为 `5bcc62f` 并创建 PR #43；正式补丁已通过本地来源/差分核验与 102 项无头回归。同 head CI run 39402451663 全部必需作业通过；Windows probe run 39402722966（x64/arm64）与 macOS probe run 39405422780（x64/arm64）通过。上面较早的 Mac 证据来自隔离候选；正式接入候选的正常构建原生复验已在下节记录。无头/构建 CI 与 Windows/macOS probe 已完成，详见 PR #43。


## 2026-10-20：正式接入候选 Mac 原生模态焦点与键盘复验

在专用 macOS 13.6 / arm64 测试账号，用 PR #43 的提交 `7285d43` 做正常 `cargo build --release --locked --no-default-features -p imgconvert-gpui`（无额外 config；`IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`、`IMGCONVERT_DISABLE_UPDATER=1`），再以 ad-hoc runtime 签名、最小 entitlements（`com.apple.security.app-sandbox`、`com.apple.security.files.user-selected.read-write`）做 deep/strict 验签。主程序 SHA256 `79fd63feb08b76f743d7628ee630a3a6f5d951de2bc1a01ba31be1504099e7d7`；`legal.rs` / `workspace.rs` / `tab_stop.rs` / 锁文件 hash 与提交一致，补丁前的隔离构建和实验性 `div.rs` 改动未用于本候选。

实际结果（中英各一次，中文在前）：

- 原生 AX 树中正文节点为 `AXTextArea|隐私与支持` 与 `AXTextArea|Privacy and support`，`focused=true`；进程级 `AXFocusedUIElement` 仍返回 `AXWindow`，属于该 API 的读取差异（正文节点自身 focus 属性为真），不再据此判焦点失败。
- 实际 VO cursor 连续三次分别读到“隐私与支持 编辑文本”和“Privacy and support 编辑文本”；`last phrase` 仍为“你当前在‘窗口’中。”，不是正文朗读，因此仅确认光标/焦点进入正文，不声称完整 VO 朗读通过。
- 键盘正向循环：正文 → 支持链接 → 页脚关闭 → 标题栏关闭 → 正文；反向循环为严格逆序，两种语言均通过。`AXButton|关闭` 与 `AXButton|Close` 的两个关闭控件用屏幕位置区分。
- `Escape` 关闭弹窗并返回触发按钮（`AXButton|隐私` / `AXButton|Privacy`）；`Return` 重新打开后正文再次获得焦点。
- 探针结束时关闭 VoiceOver、恢复中文界面与原预览（PID `18684`），未修改 TCC/SIP 或系统权限；测试只使用专用账号及合成文档。

这次正常构建原生复验补上了正文 AX 焦点、键盘进入/离开/反向循环和 Escape 返回触发入口；实际 VO 标题/正文朗读记录、连续录屏及剩余 IME/沙盒矩阵仍开放，G2 不关闭。


### 2026-10-20 21:40：Mac GUI 会话阻塞

尝试用 `screencapture`/Screenshot 继续实际 VO 正文朗读与连续录屏时，专用 Mac 的 console 登录会话在 21:40 结束：`/dev/console` 归 `root`，`launchctl print gui/501` 返回 “Domain does not support specified action”，`open` 返回 `RBSRequestErrorDomain Code=5`，无法再启动候选或旧预览。该次尝试没有取得可用的正文朗读视频，不记通过；此前正常构建上的 AX 正文焦点、键盘正反循环与 Escape 返回结果仍然有效。需要重新登录专用测试账号后才能继续 VO 朗读/连续录屏、IME 与沙盒矩阵。


### 正文朗读修复：synthetic TextRun

只给只读文档包装节点设置 `aria_value` 时，VoiceOver 进入正文后读“空的 / 文本的结尾”；实际 AX 值虽有全文，但文本接口不完整。本片在包装节点上增加 synthetic `TextRun`（正文 value + 按 UTF-8 字节的 character lengths），保留只读语义。

在 v24 候选（同 PR 代码 + 该修复）上实际复测：VO cursor 进入 `隐私与支持` 后，`last phrase` 为“隐私与支持 编辑文本 在文本的开头插入的内容。 # ImgConvert 隐私政策……”；继续用 VO 向右可读到“GitHub 项目支持 link”“关闭 button”“Close button”。这证明正文开头、支持链接和关闭按钮可被 VoiceOver 实际朗读，不再只说“空的”。

限制：在 VO 交互（VO+Shift+Down）时系统仍会弹出“你要启用‘听写’吗？”提示并抢走焦点；本次没有启用听写，也没有把该轮当作连续录屏证据。实际正文连续朗读、连续录屏和剩余矩阵仍开放。


### 模态 VoiceOver 连续录屏（中英）

在 v24 候选（SHA256 `f84fc4f85b0b076615a81abc5285eb19897dcee5a13edc74519706ebabc1c363`）上补录两段连续屏幕视频，保留本地忽略目录 `artifacts/reviews/g2-modal-native-2026-10-20/`：

| 语言 | 文件 | 时长 | 视频 | SHA256 |
|---|---|---|---|---|
| 中文 | `modal-vo-video.mov` | 9.75 s | h264 3024x1900 | `f3dea97f342bf65d76644e8ef17e98263e56d8ce89919633b12ddf1994527754` |
| 英文 | `modal-vo-video-en.mov` | 14.10 s | h264 3024x1900 | `8d6c109675af03927dfed47a5c166a8b285f3232895350277db5882a6b161426` |

两段视频都在弹窗打开、VO 光标已进入正文后开始录制；随后用 VO+Shift+F4 把光标移回键盘焦点，再以 VO+Down 遍历。没有在打开后强制回到首项。实际帧：
- 中文 2 s：字幕“隐私与支持 编辑文本 在文本的开头插入的内容。 # ImgConvert 隐私政策”；5 s 与 8 s：焦点在“关闭”按钮，字幕“关闭, button”
- 英文 2 s：字幕“Privacy and support 编辑文本 在文本的开头插入的内容。 # ImgConvert Privacy Policy”；6 s：焦点在“Close”，字幕“Close, button”
- 两段结束时界面语言恢复为中文，原预览恢复，VoiceOver 关闭

这补齐了模态标题、正文开头和关闭按钮的双语连续录屏；实际 AX 焦点标记在本轮新会话中仍为 `NONE`（与语音证据分开记录），完整正文滚动朗读、IME 矩阵和沙盒矩阵仍开放。


### 2026-10-21：IME 矩阵补充（v24 正常候选）

在同一 v24 候选（SHA256 `f84fc4f85b0b076615a81abc5285eb19897dcee5a13edc74519706ebabc1c363`）上补测原生中文拼音矩阵，原始数值见本地 `artifacts/reviews/g2-ime-matrix-2026-10-21/results.md`：

| 场景 | 实际结果 |
| --- | --- |
| 初始组合 `ni hao` | 字段 `930,560,324,24`，候选 `963,588,410,32`，候选含“你好” |
| 组合中移动窗口到 300,100 | 字段 `1014,575`，候选仍为 `963,588`，直到下一次按键 |
| 组合中缩小到 1000x700 | 字段 `998,575,260,24`，候选仍为 `963,588` |
| 移动/缩放后重新组合 | 字段 `998,575`，候选 `1031,603`，重新贴近字段 |
| 设置区滚动 300 px 后重新组合 | 字段 `998,275`，候选 `1031,303` |
| 组合中打开隐私弹窗 | 候选消失，对话框 `AXTextArea` 聚焦；Escape 后字段 `_done`，候选不存在 |
| 确认、翻页、Escape、退格 | Space 确认“你好”；PageDown 候选高度 208；Escape 清空组合并保留 `_done`；退格后重输并再次确认“你好” |

结论：候选定位、确认、翻页、Escape、退格及组合中打开隐私弹窗在本候选通过；**组合进行中移动/缩放窗口时，候选窗停留在旧位置，直到下一次按键或重新组合才重新定位**，这与之前 Cocoa 对照的观察一致，记录为平台行为而非本轮新缺陷。数字字段未在本轮原生矩阵中覆盖，完整连续录屏仍缺，G2 不关闭。


### 2026-10-21：沙盒重启、同名覆盖与不可写恢复（v24）

同一 v24 候选（SHA256 `f84fc4f85b0b076615a81abc5285eb19897dcee5a13edc74519706ebabc1c363`）上补测：

| 场景 | 实际结果 |
| --- | --- |
| 重启后再次转换 | 保存的输出目录仍显示，但 Start 再次打开原生目录选择器；取消后没有新输出，队列保持“等待中” |
| 来源与输出同名 | 目标格式 PNG、关闭 `_done` 后缀、输出目录选为源目录；出现“取消 / 继续转换”确认；取消后源 SHA256 仍为 `8ec201a3a90d37cca5c5c47e4fad89b25f53c7e28d673444c91506abd2a43d32`，队列回到“等待中” |
| 不可写输出目录 | `chmod 500` 后开始转换，实际提示“失败 · 没有权限写入输出目录：…/g2-sandbox-locked”，目录内无半成品 |
| 恢复后重试 | `chmod 755` 后再次开始，完成 638 B → 109 B，输出 `a-precision16.png`（109 B）写入成功 |

确认框的正文是自绘区域，原生 AX 只暴露“取消 / 继续转换”两个按钮；本轮以按钮动作、文件 hash、错误文本和实际输出为证据，没有连续录屏。沙盒撤权重授权仍以重启授权路径覆盖，正式 MAS/TestFlight 仍属 G3。
