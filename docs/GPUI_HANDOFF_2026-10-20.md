# GPUI 迁移开发交接（2026-10-20）

> **已过时（2026-10-24）**：本文是当时的快照。G2 的三项原生冒烟已于 2026-10-24 完成，G2 本身仍待裸机性能基线；最新状态见 `GPUI_G2_ACCEPTANCE.md` 末节与 `DEVELOPMENT_PLAN_2026-10.md` §4.2。

本文是当前 GPUI 迁移开发状态快照。长期门槛和逐项验收标准以[迁移方案](GPUI_MIGRATION_PLAN.md)、[开发方案](DEVELOPMENT_PLAN_2026-10.md)及[G2 验收记录](GPUI_G2_ACCEPTANCE.md)为准；这份快照不取代它们。

## 项目背景

ImgConvert 是 Rust 图片批量转换工具，核心为 `imgconvert-core`，由 `imgconvert-backend`、`imgconvert-platform` 提供共享业务和平台能力，桌面端正从 Tauri 迁移到 GPUI。用户已决定迁移方向，不需要重新论证框架选择。迁移按阶段门槛推进：阶段 2 的 G2 原生无障碍、IME 和沙盒验收必须通过，之后才进入阶段 3 收口及阶段 4/5；G1、G2、G3、G4、G5 是相互独立门槛。

实现分为五条线：A 为 GPUI 产品功能，B 为共享引擎正确性，C 为 CLI/预设/系统入口，D 为历史与文件夹监控，E 为图像质量与格式。开发方案 §4 是权威切片顺序。G2 未关闭前不得启动 D1a/C1 或阶段 4/5；视觉连续性改进也按用户此前决定暂缓。

## 开发历史

- PR #32 完成 S12/R10 功能对照、错误本地化和来源格式提示；PR #33 起推进 G2 原生验收。
- PR #34/#35 补齐队列辅助树语义；PR #36/#37 验证沙盒恢复、IME 原生流程并收集证据。
- PR #38 隔离并修复 GPUI 输入焦点 owner 生命周期；其最小 IME 复现经用户授权提交为 `longbridge/gpui-kit#3605`。
- PR #39 将经验证的最小 GPUI 源码覆盖正式接入；只覆盖必要的 `gpui-pre`/`gpui-pre-macos` 文件，Kit 仍固定 0.7.1，保持来源清单与差分校验。
- PR #40 修复 IME 失焦后的 Required 状态误报；PR #41 改进 VoiceOver 采集与证据保护。
- PR #42 已合并，main 为 `e858689`。本次已合并内容主要是 VoiceOver 证据采集保护，不表示 G2 完成。

## 当前开发进度

工作分支为 `fix/gpui-voiceover-modal-focus`，基于 `e858689`。`/home/ivmm/tools/imgconvert-pr` 是唯一可写开发检出；同机 `/home/ivmm/tools/imgconvert` 有大量用户改动，不得切分支、stash、重置或提交其中内容。Mac 上也只使用专用独立 worktree 和测试账号，不触碰原始检出、用户资料或真实媒体。

本分支改动已提交为 `5bcc62f`，PR #43 已创建；同 head CI run 39402451663 与 Windows/macOS probe 已通过；正式接入候选的正常构建 Mac 原生复验已取得双语正文 AX 焦点、正反四控件循环、Escape 返回触发入口，实际 VO 正文朗读仍待补；21:40 专用 Mac GUI 会话退出，需重新登录后才能继续视频/VO：

- `legal.rs` 将无障碍角色和焦点绑定到只读文档的真实编辑器，并在弹窗打开后聚焦文档；Tab/Shift-Tab 转发 Kit Root 已注册 action，复用焦点陷阱。
- `workspace.rs` 在模态弹窗打开时隐藏背景工作区辅助树。
- `ui.rs` 覆盖隐私/许可弹窗初始焦点、全文复制、四个弹窗控件的反向循环、Escape 与触发按钮焦点恢复。
- `tests/tab_stop.rs` 与 `GPUI_TAB_STOP_REPRO.md` 记录共享 `FocusHandle` 导致 Shift-Tab 卡住的最小复现；用户已授权提交 [longbridge/gpui-kit#3612](https://github.com/longbridge/gpui-kit/issues/3612)，正式 vendor 已接入一行 `TabStopMap` 修复，`patches/gpui-ime-focus` 的差分、manifest 与文件清单同步更新。
- VoiceOver 采集脚本增加基于当前真实 cursor 的精确检查；不再用可能陈旧的 `last phrase` 作为控件身份。

验证现状：正式 vendor 下完整 GPUI suite 102 项通过，workspace clippy `-D warnings` 通过，格式和架构护栏通过。原始共享焦点回归与缓存重放回归在未修源码上失败，在正式接入的 `gpui-pre` 上通过；法律弹窗四控件反向循环 UI 测试同样由失败转为通过。下列 Mac 证据仍来自显式隔离候选，不是接入补丁后的正式 `--locked` 构建。Mac 上显式加载隔离候选构建并 ad-hoc sandbox 签名的程序 SHA256 为 `a74bd4f37fb4cd6bbf4c42cb70f897c334ee49d378beaea164bc93c871d4c715`，不是正式产品构建。实际 VoiceOver cursor 在中英文弹窗中均能稳定进入“隐私与支持 / Privacy and support 编辑文本”，Escape 与语言往返可运行；但 `last phrase` 为空，原生 `AXFocusedUIElement` 仍报 `AXWindow`，附加键盘入口检查失败。该轮整体不能算通过。探针结束后专用设置、VoiceOver/录屏偏好已恢复，原预览 PID `14937` 已启动。

新的底层 Shift-Tab 问题已按迁移方案 §3.1 先向上游报告：用户明确授权后提交 #3612，随后才接入正式 vendor。该授权只覆盖这一份最小复现，不延伸为 PR 合并、发布或 TCC/SIP 变更授权；提交、合并、发布仍遵循既有明确授权边界。

## 接下来的计划

1. 已完成：用户授权后提交 #3612，正式 vendor 接入一行修复；改动提交 `5bcc62f`、PR #43 已创建，同 head CI 与 Windows/macOS probe 通过；合并等待用户明确授权。
2. 已完成无头边界回归与来源核验：相同 ID 重复注册、缓存 replay 和 `tab_stop` 状态变化；`verify.py --metadata` / `--archives`、Python 工具 19 项、GPUI fmt/clippy/102 项、根 workspace 当前参数 391 项、格式/许可/架构/成本护栏通过。剩余原生复验见下。
3. 修复 Mac 原生焦点和键盘证据缺口：确认稳定后的 AX focus、VO 标题/正文朗读、键盘进入/离开/反向循环、Escape 返回触发入口；每种语言均观察。测试使用专用候选和测试账号，操作前后核对设置并恢复环境。
4. 对隐私/许可、设置、队列、转换运行/完成/告警继续完成连续 VoiceOver 记录；补齐 G2 IME 窗口移动/缩放/滚动/弹层矩阵以及沙盒拒绝、撤权、重启重授权、恢复、来源与输出重合等场景。证据只记录实际结果，失败保留，不用无头测试代替原生验收。
5. G2 收口前不推进 D1a/C1 或阶段 4/5。G2 通过后按开发方案顺序处理 G3 可立即事项（R4/R6/R8/G3-3），并等待正式证书、runner、商店账号和实机完成 G3-1/2/4/5/6。后续 D/C/E 功能切片以方案表为准。
6. 每片完成本地验证、护栏、只读 Codex review 和修复，再提交 PR、观察同 head CI 并向用户汇报；合并永远等用户明确说“合并”。不创建/公开 Release；遵守根 `AGENTS.md` 的三平台、六架构、签名、公证、安装 smoke、校验和与 draft 完整性规则。

## 可直接交给其他模型的提示词（约 600 字）

```text
你接手 ImgConvert 的 GPUI 迁移开发。先阅读 AGENTS.md、docs/GPUI_HANDOFF_2026-10-20.md、docs/DEVELOPMENT_PLAN_2026-10.md、docs/GPUI_MIGRATION_PLAN.md、docs/ENGINE.md、docs/GPUI_G2_ACCEPTANCE.md、docs/GPUI_PATCHES.md，以及 GPUI Kit 和 Design Guides 两份 skill。项目方向已由用户决定，不再论证迁移。只在 /home/ivmm/tools/imgconvert-pr 开发；主检出含用户改动，禁止切分支、stash、重置或提交。当前分支 fix/gpui-voiceover-modal-focus 基于 main e858689，有未提交模态焦点候选；先检查 git status，保留现有改动。

按切片流程实现、验证正反路径、运行格式/clippy/测试和架构许可护栏，再做 Codex 只读 review 并修复 P1/P2。提交英文 commit、中文 PR，检查精确 head CI；任何合并都等用户明确授权。G2 未关闭前不启动 D1a/C1 或阶段 4/5，不做视觉重排，不创建公开 Release。缺少账号、签名或 runner 时记录阻塞。最终中文汇报改动、验证、review 处置、原生证据与未完成项。
```
