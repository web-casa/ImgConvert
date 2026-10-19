# GPUI 补丁登记

当前没有启用的 GPUI / Kit 本地补丁。`apps/gpui/Cargo.lock` 保持既有锁定版本，没有因本次 G2 验收加入 `[patch.crates-io]`。

迁移方案 §3.1 要求阻塞 bug 先向上游提交最小复现；正式本地补丁须记录目的、来源、验证与退出条件，不 vendor 整个框架。对外报告草稿见 [GPUI_IME_REPRO.md](GPUI_IME_REPRO.md)，尚未提交，等待用户明确授权；不把实验构件当作产品修复。

## 未采纳：macOS FocusLost 只清理系统候选框

- 目的：清理组合输入时打开对话框后滞留的原生 `InputMethodCandidateList`。
- 范围：独立 worktree 的 `target/tmp/g2-scope/g2-focus-platform`，只复制 `gpui-pre-macos 0.3.8` 叶子 crate，在现有 `TextInputStateChange::FocusLost` 通知上延迟调用当前 native view 的 `inputContext.discardMarkedText`，以 Weak、closed 和重新聚焦状态保护窗口生命周期；不使用全局 `currentInputContext`。
- 评审：旧 client 的 marked range / composition transaction 尚未统一清理；最后一次 draw 的 focus 标志不能完全排除同帧重新聚焦风险。AppKit 头文件明确要求 client 自行清除 marked range，不能只关系统候选框。
- 原生结果：实验编译成功、最小 entitlement 的 ad-hoc GPUI 候选 strict 验签通过；真实 `ni hao` 候选存在时打开隐私对话框，`absent` 断言仍失败。FocusLost 仅区分有无接受文本的区域，不能代表所有控件切换。此次实验没有证明修复有效。
- 处置：实验不进入产品源码、依赖清单或锁文件，停止并退出实验 App，恢复未打补丁的正式开发候选。原始实验日志留在忽略的 `target/tmp` / `artifacts/reviews`，无需生成或发布分发产物。
- 后续要求：在能定位旧 client 的边界完成 owner 与系统两侧清理；验证原生候选、标记范围、撤销事务、返回后继续输入、快速重聚焦及窗口关闭。仅原生正向结果与 review 均通过后才考虑正式接入，届时登记上游来源和删除补丁的版本/验证条件。

窗口移动时已有组合候选停在旧位置的坐标失效实验也未被采纳；同机 Cocoa 对照会出现相同行为。两种观察应分开记录，不以一个补丁宣称修复全部 IME 场景。
