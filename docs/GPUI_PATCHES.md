# GPUI 补丁登记

当前 GPUI workspace 已用 `[patch.crates-io]` 接入 `gpui-pre` / `gpui-pre-macos` 0.3.8 的 IME 焦点修复与共享焦点 Tab 排序修复。Kit 五包仍为 0.7.1，所有依赖版本不变，锁文件仅移除这两项 registry 来源/checksum。正常 `cargo build --locked` 直接使用接入后的源码。

迁移方案 §3.1 要求阻塞 bug 先向上游提交最小复现；正式本地补丁须记录目的、来源、验证与退出条件，不 vendor 整个框架。最小复现已获用户明确授权，并于 2026-10-19 提交 [longbridge/gpui-kit#3605](https://github.com/longbridge/gpui-kit/issues/3605)，内容见 [GPUI_IME_REPRO.md](GPUI_IME_REPRO.md)，没有公开账号路径或原始媒体；不把实验构件当作产品修复。

## 已接入：macOS owner 焦点、原生会话清理与共享 Tab 排序

差分与可重复准备工具见 [`patches/gpui-ime-focus`](../patches/gpui-ime-focus/README.md)，正式来源目录为 `apps/gpui/vendor/gpui-pre` 与 `gpui-pre-macos`；只保留这两个必须修改的 crate 的运行源码、Windows 构建资源、完整 Apache 许可及原始 manifest/README，共 116 个文件。移除上游示例/测试 target 和媒体，清单设为不可发布，两包不成为 workspace 成员；Kit、组件库和其他平台实现继续来自 registry。来源为接入前锁定的 Apache-2.0 `gpui-pre` / `gpui-pre-macos` 0.3.8 原始 crates.io 归档；两包完整 SHA256、补丁及修改后文件校验值保存在候选 manifest。准备工具拒绝旧输出、错误包/锁版本、路径穿越/链接，仅在本检出 `apps/gpui/target/tmp` 新目录生成本地源码与 opt-in config，不下载、不执行 Cargo、不改 registry、产品清单或锁。含 emoji 的路径由真实 Cargo TOML 解析回归覆盖。

候选在注册时保留 FocusId 与 entity client identity，绘制后依据最终焦点选中真实处理器，覆盖输入→输入/只读区域/无输入、绘制中焦点转移和控件移除。先对旧 owner 清 marked range / 提交 undo transaction，再同步调用该窗口 view 的 `inputContext.discardMarkedText`；当前版本还在该 context 仍属本窗口时停用/重新激活会话，保留 view/context 到回调结束，检查关闭状态、key window / first responder 及其他活动 context，防止抢走别的窗口输入。期间平台 handler 为空且不持 native mutex；全局 context 只用于身份保护，不作取消目标，也不安排延迟清理任务。绘制后的清理在退出绘制阶段后补帧；首次晚到焦点只对缺失目标尝试一次恢复，永久缺失不持续重绘。同帧 A→B→A 未安装过 B 时保留 A 组合。无 entity identity 的 custom handler 退回 FocusId；复用同一 FocusId 的自定义 client 需明确提供不同稳定身份。

验证使用独立 Kit 工程承载显式 macOS 控件与调度回归；工程以产品锁为种子，解析后逐个核对包名/版本/来源，并检查 assets/macros 同样锁在 0.7.1。框架只在既有 test-support context 增加不触发绘制的 frame-wake / handler-exists 观察接口，不暴露底层测试窗口，不编译发布 crate 中缺少外部字体夹具/存在宏错误的无关 unit suite。产品源码和锁不必为无头回归临时变更。原生系统候选必须另验。早期 discard-only 版本的 13 项 macOS 无头回归通过，但真实 AXPress 激活隐私对话框仍有旧系统候选，不能宣称完成修复；加入上下文重置后的版本必须另记原生结果。首轮 owner 误记/消失遗漏、后续候选选择顺序/补帧阶段、首次无旧 handler 的恢复与 Unicode 配置问题都纳入 review 处置。各版实验结论不互相替代，最终结果见 G2 清单和 PR。

接入验证：`verify.py` 核对全部源码清单、六个修改文件、实际 Cargo 来源、固定版本和 workspace 成员；重建 registry 锁条目必须得到接入前完整锁 hash，保证只换来源。独立归档审计逐字节复现全部保留文件，架构护栏与 GPUI CI 运行核验。`check.py --active` 的 13 项回归必须选中正式来源目录，原生验证使用不带额外 config 的正常 `--locked` 构建；结果记在 G2 清单。上游版本包含同等修复后，删除候选并在无补丁版本重跑相同回归与原生场景。当前 G2 未关闭。

共享焦点排序修复针对 `TabStopMap::insert`：同一 `FocusId` 再次注册时，`by_id` 已指向最后一次注册，但 `order` 仍保留旧节点，反向遍历可能反复回到同一 handle。修复在更新 `by_id` 前删除同 ID 的旧排序项，保持最后一处注册为唯一停靠点。最小复现已获用户明确授权，于 2026-10-20 提交 [longbridge/gpui-kit#3612](https://github.com/longbridge/gpui-kit/issues/3612)，代码与步骤见 [GPUI_TAB_STOP_REPRO.md](GPUI_TAB_STOP_REPRO.md)。产品侧新增 `tests/tab_stop.rs` 三项无头回归（原始共享 handle、缓存重放、Tab stop 状态切换）；前两项在未修源码上失败、在正式接入源码上通过，状态切换项作为不变量在两边均通过；法律弹窗的四控件反向循环 UI 测试在未修源码上失败、接入后通过。这项修复只证明焦点排序，不替代原生键盘/VoiceOver 验收。

## 未采纳：macOS FocusLost 只清理系统候选框

- 目的：清理组合输入时打开对话框后滞留的原生 `InputMethodCandidateList`。
- 范围：独立 worktree 的 `target/tmp/g2-scope/g2-focus-platform`，只复制 `gpui-pre-macos 0.3.8` 叶子 crate，在现有 `TextInputStateChange::FocusLost` 通知上延迟调用当前 native view 的 `inputContext.discardMarkedText`，以 Weak、closed 和重新聚焦状态保护窗口生命周期；不使用全局 `currentInputContext`。
- 评审：旧 client 的 marked range / composition transaction 尚未统一清理；最后一次 draw 的 focus 标志不能完全排除同帧重新聚焦风险。AppKit 头文件明确要求 client 自行清除 marked range，不能只关系统候选框。
- 原生结果：实验编译成功、最小 entitlement 的 ad-hoc GPUI 候选 strict 验签通过；真实 `ni hao` 候选存在时打开隐私对话框，`absent` 断言仍失败。FocusLost 仅区分有无接受文本的区域，不能代表所有控件切换。此次实验没有证明修复有效。
- 处置：实验不进入产品源码、依赖清单或锁文件，停止并退出实验 App，恢复未打补丁的正式开发候选。原始实验日志留在忽略的 `target/tmp` / `artifacts/reviews`，无需生成或发布分发产物。
- 后续要求：在能定位旧 client 的边界完成 owner 与系统两侧清理；验证原生候选、标记范围、撤销事务、返回后继续输入、快速重聚焦及窗口关闭。仅原生正向结果与 review 均通过后才考虑正式接入，届时登记上游来源和删除补丁的版本/验证条件。

窗口移动时已有组合候选停在旧位置的坐标失效实验也未被采纳；同机 Cocoa 对照会出现相同行为。两种观察应分开记录，不以一个补丁宣称修复全部 IME 场景。
