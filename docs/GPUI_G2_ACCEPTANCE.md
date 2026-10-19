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

这些仍是开发候选证据。实际撤销沙盒访问、完整重启/取消矩阵的最终候选复测、连续录屏及完整 VoiceOver/IME 场景仍需补齐，G2 不关闭。
