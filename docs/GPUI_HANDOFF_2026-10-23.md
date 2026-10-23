# GPUI 界面重设计交接（2026-10-23）

本文是“清透玻璃 2.0”界面重设计的开发状态快照，接续 [2026-10-20 交接](GPUI_HANDOFF_2026-10-20.md)。长期门槛与验收标准仍以 [迁移方案](GPUI_MIGRATION_PLAN.md)、[开发方案](DEVELOPMENT_PLAN_2026-10.md) 和 [G2 验收记录](GPUI_G2_ACCEPTANCE.md) 为准；设计本身的权威记录是 [GPUI_GLASS_LAYOUT.md](GPUI_GLASS_LAYOUT.md)。

## 背景

用户认为卡片分栏版（`GPUI_CARD_LAYOUT.md`）“失去美感”，要求重新设计。2026-10-22 做了五个方向的设计稿（A 工作台、B 清透玻璃 2.0、C 暗房、D 三步流程、E 账本），用户选定 B，并要求单独的浅色版。设计画布（私有）：https://claude.ai/artifact/3ZFD9o2fZWgdigZzUy5nM8 ，页面“B 清透玻璃 · 完整稿”含空队列、导入中、完成、隐私与偏好、窄窗口、前后对比、存储情景七块画板，每块可切浅 / 深。

用户此前“暂缓视觉重排”的决定由这次选定解除。G2 的非视觉验收（IME、VoiceOver、沙盒）不受影响，仍未关闭。

另评估过两份外部建议（sonorahq/gpui、gpui-fusion、gpui-ce、bezel、Glassy UI、gpui-ai、palette、kurbo 等），结论：不切换 GPUI 分支、不引入新依赖、不做背景模糊和折射；玻璃效果全部用现有的半透明、内阴影、渐变和令牌实现，所有表面集中在 `theme.rs` 的 helper，将来若评估模糊只改这一层。

## 已完成（四片 PR）

| 片 | PR | 状态 | 内容 |
|---|---|---|---|
| 1 窗口骨架 | #50 | 已合并 | 浅色 Clear / 深色 Obsidian 配色与玻璃令牌；删导航栏与齿轮；标题行命令胶囊（插件诊断、更新、隐私、许可、语言、外观）；操作栏变为队列面板底部悬浮胶囊；<66rem 紧凑模式 |
| 2 设置标签页 | #51 | 已合并 | 格式 / 输出 / 处理 / 隐私四标签；格式卡片单选组；分区改为标题 + 底板；跨标签警告；外观移入标题行弹出层 |
| 3 队列与状态 | #52 | 已合并 | 4.25rem 两行队列行与紧凑结果列；空队列插画与虚线拖放框；导入横幅；完成摘要“完成 N · 节省 X”（`ItemStatus::Done::complete` + `net_saving`）；测试等待修复 |
| 4 对话框 | #53 | 已合并 | `glass_dialog` 用于全部 7 个对话框；深色危险色、输入框边框、焦点环对比度；预览图片叠加令牌 |

四片均已 rebase 合并，main 当前头为 `db5a98f`（#53），功能分支已删除，worktree 在 main。每片都经过 fmt、clippy `-D warnings`、GPUI 全量测试（本地 `-j 1`）、架构护栏、Prettier 和 Codex 只读评审（P1/P2 全部处理，评审原文在忽略目录 `artifacts/reviews/gpui-glass-b-pr{1..4}-codex-review.md`，截图在 `artifacts/reviews/gpui-glass-b-pr{1..4}/`）。

## 与设计稿的有意偏离

- 窄窗口设置抽屉不做：760px 最小窗口两块面板都放得下；规范要求检查器不遮主对象；抽屉会带来视图双处渲染与焦点迁移风险。
- 队列行的命令不收进“…”菜单，而是三个常显图标按钮（情景、对比、移除）。
- “打开输出文件夹”未做：需要新的平台接口（系统文件管理器 + macOS 沙盒授权），建议单独立项。
- 队列行保留两行：单行在 760px 会挤掉文件名。

## 关键实现事实

- 颜色只在 `apps/gpui/crates/shared/themes/imgconvert-glass.json` 与 `crates/shared/src/theme.rs`；业务代码用 `GlassStyled`（`glass_panel` / `glass_bar` / `glass_capsule` / `glass_well` / `glass_dialog`）和 `ActiveGlass` 的令牌（chip、chip_strong、lift_shadows、well、accent_soft、accent_edge、illustration、dialog、image_label_*）。
- Kit 0.7.1：主按钮画 `tokens.button_primary`（不是 `tokens.primary`），渐变两者都要写；`Tab` 不能获得焦点（源码 TODO），所以标签列表、格式卡片、主题选择都是“自有 `FocusHandle`（`.tab_stop(true)`）+ 方向键 + `tab_stop(false)` 的按钮”；`Button` 的焦点句柄在 `use_keyed_state(id)` 里，外部无法直接聚焦；`cx.focus_handle()` 默认不是 Tab 停靠点；Dialog / AlertDialog 实现 `Styled`，可整体改表面。
- 设置表单 API：`SettingsTab`、`Section::tab()`、`active_tab` / `set_tab` / `show_section` / `tab_has_issue` / `focus_format`（取代旧的 `open_section` / `set_open_section` / `focus_appearance`）。
- 节省量：`imgconvert_gpui_workflow::action_bar::net_saving(items, jobs)` 只计本批任务中 `complete` 的完成行，checked 求和。
- 对话框所在 crate 的单元测试要按应用顺序初始化：`services::init_with_settings` → `gpui_kit::init` → `theme::install`。

## 未解决与风险

1. **CI 间歇失败**：`start_walks_the_output_safety_prompts`（Linux GPUI Shell）在 #51 首轮与 #52 两轮中失败，表现为“覆盖”确认点“确定”后新批次未启动；本地正常、单核、三份并行均复现不了，`progress_bridge` 的迟到事件已排除。#52 加入了 `wait_for_batch_after_explained`，超时会打印“对话框是否开着 / 是否在规划 / 面板提示 / 批次 id 与阶段 / 桥接是否忙 / 文件状态”。再次失败时先读这行诊断定位根因，不要放宽断言或加重试。怀疑方向：`output_safety` 的 `window.defer(advance)` 后是否还有提示框、`start_decided` 的设置快照比较是否因某个异步写入失配。
2. **本机资源**：`/tmp` tmpfs 常被其他项目占满（交接时 91%），会让 GPUI 编译或链接被 OOM 杀掉。2026-10-22 经用户同意清理过 `.pnpm-store`、`node-compile-cache` 和两个旧 `dsh-workspace-changes-*`；其他项目会话的临时目录不要动。构建用 `-j 1`/`-j 2` 并 `export TMPDIR=apps/gpui/target/tmp`。
3. **CI 触发**：`ci.yml` 只在 `pull_request` 的 opened / synchronize / reopened 触发，改 PR 基础分支不会触发；需要关闭再重开 PR。
4. 原生 macOS / Windows 截图与 VoiceOver 复验未随本次重设计更新；属于 G2 验收范围。

## 接下来

1. 若间歇失败再现，按诊断修根因，单独 PR。
2. 视需要：原生平台截图与 VoiceOver 复验；“打开输出文件夹”立项；设计画布中未实现的细节（如逐项“…”菜单）由用户决定是否需要。
3. 之后回到开发方案的既定次序（G2 收口等）。合并一律等用户明确同意。

## 工作方式

- 只在 `/home/ivmm/tools/imgconvert-pr` 开发；`/home/ivmm/tools/imgconvert` 有大量用户未提交改动，不切分支、不 stash、不提交。
- 切片流程：实现 → 正反路径测试 → fmt / clippy / 全量测试 / 护栏 → Codex 只读评审（`codex exec -s read-only -C <repo> --output-last-message <file> - < prompt.md`，结果立即拷到 `artifacts/reviews/`）→ 修 P1/P2 → 英文 commit、中文 PR → 看精确 head 的 CI。后台跑测试时不要改代码（曾两次因竞态作废）。
- 截图：`IMGCONVERT_PERF_PROBE=1 IMGCONVERT_PERF_PROBE_IMPORT=<dir>`（加 `_BATCH_OUT` / `_BATCH_FORMAT` 自动转换）可预填队列；设置文件写在 `$XDG_DATA_HOME/com.ivmm.imgconvert/settings.json`，内容形如 `{"settings":{"theme":"dark","locale":"zh-CN"}}`。
- 叠加 PR：前一片合并后 `git rebase --onto origin/main <旧父提交> <分支>`，`--force-with-lease` 推送，`gh pr edit --base main`，关闭重开触发 CI。

## 可直接交给其他模型的提示词

```text
你接手 ImgConvert（Rust + GPUI 桌面图片转换工具）的开发。先阅读 AGENTS.md、docs/GPUI_HANDOFF_2026-10-23.md、docs/GPUI_GLASS_LAYOUT.md、docs/DEVELOPMENT_PLAN_2026-10.md、docs/GPUI_MIGRATION_PLAN.md、docs/GPUI_G2_ACCEPTANCE.md、docs/GPUI_PATCHES.md，以及 gpui-kit 和 gpui-kit-design-guides 两份 skill（界面改动前必须读 Design Guides 全文）。迁移到 GPUI 与“清透玻璃 2.0”设计都已由用户决定，不再论证；不切换 GPUI 分支、不新增依赖、不做背景模糊。

只在 /home/ivmm/tools/imgconvert-pr 开发；/home/ivmm/tools/imgconvert 有用户未提交改动，禁止切分支、stash、重置或提交。“清透玻璃 2.0”四片（#50–#53）已全部合并进 main（db5a98f）。先看 git status 与 main 最新 CI，然后向用户确认下一项任务；任何合并都必须等用户明确说“合并”。

若 Linux CI 的 start_walks_the_output_safety_prompts 再次失败，读失败日志里的诊断行（对话框 / 规划 / 提示 / 批次 / 文件状态）定位根因并单独修复，不要放宽断言或加重试。颜色只写在主题层；键盘可达、无障碍名称、对比度不得回退。

按切片流程工作：实现、正反路径测试、fmt、clippy -D warnings、GPUI 全量测试（本地 -j 1，TMPDIR=apps/gpui/target/tmp）、架构/许可护栏、Prettier，再用 Codex 只读评审并修复 P1/P2，评审原文存 artifacts/reviews/。英文 commit、中文 PR，结尾带规定的署名。/tmp 满导致 OOM 时不要删除其他项目的临时目录，先向用户报告。G2 未关闭前不启动 D1a/C1 或阶段 4/5，不创建公开 Release。最终用中文汇报改动、验证、评审处置和未完成项。
```
