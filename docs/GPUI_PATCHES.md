# GPUI 补丁登记

当前 GPUI workspace 已用 `[patch.crates-io]` 接入 `gpui-pre` / `gpui-pre-macos` 0.3.8 的 IME 焦点修复、共享焦点 Tab 排序修复，以及辅助功能“按下”与滚动入视修复。Kit 五包仍为 0.7.1，所有依赖版本不变，锁文件仅移除这两项 registry 来源/checksum。正常 `cargo build --locked` 直接使用接入后的源码。

迁移方案 §3.1 要求阻塞 bug 先向上游提交最小复现；正式本地补丁须记录目的、来源、验证与退出条件，不 vendor 整个框架。最小复现已获用户明确授权，并于 2026-10-19 提交 [longbridge/gpui-kit#3605](https://github.com/longbridge/gpui-kit/issues/3605)，内容见 [GPUI_IME_REPRO.md](GPUI_IME_REPRO.md)，没有公开账号路径或原始媒体；不把实验构件当作产品修复。

## 已接入：macOS owner 焦点、原生会话清理与共享 Tab 排序

差分与可重复准备工具见 [`patches/gpui-ime-focus`](../patches/gpui-ime-focus/README.md)，正式来源目录为 `apps/gpui/vendor/gpui-pre` 与 `gpui-pre-macos`；只保留这两个必须修改的 crate 的运行源码、Windows 构建资源、完整 Apache 许可及原始 manifest/README，共 116 个文件。移除上游示例/测试 target 和媒体，清单设为不可发布，两包不成为 workspace 成员；Kit、组件库和其他平台实现继续来自 registry。来源为接入前锁定的 Apache-2.0 `gpui-pre` / `gpui-pre-macos` 0.3.8 原始 crates.io 归档；两包完整 SHA256、补丁及修改后文件校验值保存在候选 manifest。准备工具拒绝旧输出、错误包/锁版本、路径穿越/链接，仅在本检出 `apps/gpui/target/tmp` 新目录生成本地源码与 opt-in config，不下载、不执行 Cargo、不改 registry、产品清单或锁。含 emoji 的路径由真实 Cargo TOML 解析回归覆盖。

候选在注册时保留 FocusId 与 entity client identity，绘制后依据最终焦点选中真实处理器，覆盖输入→输入/只读区域/无输入、绘制中焦点转移和控件移除。先对旧 owner 清 marked range / 提交 undo transaction，再同步调用该窗口 view 的 `inputContext.discardMarkedText`；当前版本还在该 context 仍属本窗口时停用/重新激活会话，保留 view/context 到回调结束，检查关闭状态、key window / first responder 及其他活动 context，防止抢走别的窗口输入。期间平台 handler 为空且不持 native mutex；全局 context 只用于身份保护，不作取消目标，也不安排延迟清理任务。绘制后的清理在退出绘制阶段后补帧；首次晚到焦点只对缺失目标尝试一次恢复，永久缺失不持续重绘。同帧 A→B→A 未安装过 B 时保留 A 组合。无 entity identity 的 custom handler 退回 FocusId；复用同一 FocusId 的自定义 client 需明确提供不同稳定身份。

验证使用独立 Kit 工程承载显式 macOS 控件与调度回归；工程以产品锁为种子，解析后逐个核对包名/版本/来源，并检查 assets/macros 同样锁在 0.7.1。框架只在既有 test-support context 增加不触发绘制的 frame-wake / handler-exists 观察接口，不暴露底层测试窗口，不编译发布 crate 中缺少外部字体夹具/存在宏错误的无关 unit suite。产品源码和锁不必为无头回归临时变更。原生系统候选必须另验。早期 discard-only 版本的 13 项 macOS 无头回归通过，但真实 AXPress 激活隐私对话框仍有旧系统候选，不能宣称完成修复；加入上下文重置后的版本必须另记原生结果。首轮 owner 误记/消失遗漏、后续候选选择顺序/补帧阶段、首次无旧 handler 的恢复与 Unicode 配置问题都纳入 review 处置。各版实验结论不互相替代，最终结果见 G2 清单和 PR。

接入验证：`verify.py` 核对全部源码清单、修改过的源码文件（现为十一个）、实际 Cargo 来源、固定版本和 workspace 成员；重建 registry 锁条目必须得到接入前完整锁 hash，保证只换来源。独立归档审计逐字节复现全部保留文件，架构护栏与 GPUI CI 运行核验。`check.py --active` 的 13 项回归必须选中正式来源目录，原生验证使用不带额外 config 的正常 `--locked` 构建；结果记在 G2 清单。上游版本包含同等修复后，删除候选并在无补丁版本重跑相同回归与原生场景。当前 G2 未关闭。

共享焦点排序修复针对 `TabStopMap::insert`：同一 `FocusId` 再次注册时，`by_id` 已指向最后一次注册，但 `order` 仍保留旧节点，反向遍历可能反复回到同一 handle。修复在更新 `by_id` 前删除同 ID 的旧排序项，保持最后一处注册为唯一停靠点。最小复现已获用户明确授权，于 2026-10-20 提交 [longbridge/gpui-kit#3612](https://github.com/longbridge/gpui-kit/issues/3612)，代码与步骤见 [GPUI_TAB_STOP_REPRO.md](GPUI_TAB_STOP_REPRO.md)。产品侧新增 `tests/tab_stop.rs` 三项无头回归（原始共享 handle、缓存重放、Tab stop 状态切换）；前两项在未修源码上失败、在正式接入源码上通过，状态切换项作为不变量在两边均通过；法律弹窗的四控件反向循环 UI 测试在未修源码上失败、接入后通过。这项修复只证明焦点排序，不替代原生键盘/VoiceOver 验收。

## 已接入：辅助功能“按下”不再点到别的控件

- 问题：2026-10-23 在 macOS 13.6 虚拟机上对新界面做 VoiceOver 冒烟时发现，GPUI 对没有自带监听的节点，把辅助功能 `Click` 实现为在节点矩形中心合成一次鼠标点击。这个矩形没有按滚动容器裁剪。设置区滚动后，被滚到标签栏下面的“无损压缩”开关按下后，切到了“隐私”标签页，开关本身没变；被滚到窗口底边以下的开关按下后没有任何反应。同一按下作用于可见开关时正常切换。GPUI 也没有声明和处理 `ScrollIntoView`（macOS 的 `AXScrollToVisible`）。复现与分析见 [GPUI_A11Y_CLICK_REPRO.md](GPUI_A11Y_CLICK_REPRO.md)。
- 修改：在同一 `gpui-pre` 源码里改 `element.rs`、`elements/div.rs`、`window.rs`、`window/a11y.rs`、`view.rs` 五个文件。
  - 预绘制时为每个辅助功能节点记录三样东西：它所处的裁剪区域、它自己元素的 hitbox、外层滚动容器链（同一容器内的节点共享一份链，记录容器可滚动的轴）。另记下所有对指针按下有反应的 hitbox（带点击、mouse-down 或 mouse-up 监听的元素）。滚动容器内的节点声明 `ScrollIntoView`。
  - `Click` 先试节点可见部分的中心，再试 3×3 网格的其余各点，选第一个满足两点的位置：命中测试落到节点自己的 hitbox（判断方式与 `Hitbox::is_hovered` 相同），并且它上面没有别的对指针按下有反应的 hitbox（例如行内的命令按钮、只监听 mouse-down 的拖动把手）。父元素的 hitbox 总在子元素之下，不会被当成遮挡。都不满足时先把节点滚入视口，两帧后再试一次：第一帧应用滚动，第二帧按新布局命中测试。仍够不到就不点。
  - `ScrollIntoView` 从内到外移动滚动容器，只沿容器可滚动的轴移动，并夹在各自的范围内。只能纵向滚动的容器即使内容更宽也不会横向移动。
  - 辅助功能开启时不复用缓存视图的预绘制，否则被复用的子树不会重建辅助功能节点，会从树里消失。代价是辅助技术开启期间缓存视图每帧重建；本应用没有使用缓存视图。
  - test-support 新增两个接口：`simulate_a11y_activation` 和 `simulate_a11y_action`。后者和平台适配层一样，只对声明了该动作的节点生效，否则返回 `false`；多个节点的元素 id 末段相同时直接报错。
  - 暂不支持：`list` / `uniform_list` 这类自行管理偏移的虚拟列表，以及延迟绘制（`deferred` / `anchored`）层中的滚动登记。本应用目前没有用到。
  - 补丁登记、清单与源码清单同步更新，`verify.py --archives` 可以从原始归档逐字节复现。
- 验证：新增无头回归 `tests/a11y_actions.rs`（8 项）和 UI 测试 `a11y_press_on_a_setting_scrolled_under_the_tabs_reaches_the_setting`。
  - 把 `Click` 换回原实现时：
    - 被滚到标题下的行，标题被点击（计数 1，应为 0）；
    - 视口下方的行和 `ScrollIntoView` 两项，行都留在视口外；
    - UI 测试中活动标签变成 `Privacy`。
  - 再分别把遮挡判断、按轴滚动和缓存复用改回旧逻辑时：
    - 中心被行内命令盖住时，点到的是命令而不是行；只把点击监听算作遮挡时，只监听 mouse-down 的把手吞掉了按下，行没有被按到；
    - 纵向滚动容器被横向移动 2364 px；
    - 缓存视图里的按钮节点找不到。
  - 使用修复后的源码，全部通过。
  - 原生复验结果记录在 G2 清单。
- 产品侧同时修了一处：标题行“外观”按钮原本没有点击监听（它的弹出层由外层的 mouse-down 打开），所以节点不声明“按下”，VoiceOver/AXPress 完全按不动它。给它加了空的点击监听后可以打开；UI 测试 `a11y_press_opens_the_appearance_popover` 覆盖。
- 上游：尚未提交 issue。对外提交需要用户授权，复现文档已按可直接发布的形式写好。
- 退出条件：上游锁定版本包含等效修复后，删除这部分改动，在无补丁版本上重跑上述回归和原生按下场景。

## 已接入：live region（`aria_live`）

- 问题：批次开始和完成时，VoiceOver 不会主动播报，状态只能在用户把光标移到状态文字时读出，不满足 WCAG 4.1.3（状态消息）。AccessKit 的 macOS 适配层已经支持 live region：节点设了 `live` 后，值变化或 `live` 从关变开时会发出 `AnnouncementRequested`。缺的只是 GPUI 无法设置这个属性。
- 修改：在同一 `gpui-pre` 源码里，`elements/div.rs` 新增 `aria_live(Live)`，`gpui.rs` 再导出 `accesskit::Live`。test-support 新增 `a11y_node_for_test`，可以读取最后一帧的节点属性。
- 产品侧：操作栏里有一个不占尺寸的“播报”节点（`workflow-announcement`，Status 角色），只在进入这些里程碑时出现一帧：批次开始（“开始转换，共 N 个文件”）、取消、完成（与状态行相同的摘要）、失败，以及设置写入失败。
  - 节点在加入辅助功能树时被播报，下一帧就移除，所以每个事件只播报一次，同样的文字下次也会重新播报。
  - 失败和设置写入失败用 `Assertive`，其余用 `Polite`。
  - 状态行本身不是 live region，它的无障碍值始终等于可见文字（包括运行中的进度）。
  - 进度变化、就绪文字、提示，以及完成后编辑队列引起的摘要变化，都不播报。
  - 设置错误和批次里程碑分开跟踪，已有的设置错误不会挡住之后的批次播报。设置错误按文字跟踪，换成另一个错误也会播报，错误消失不播报。
  - 一批在两次渲染之间就开始并结束时，先说“开始转换”，再说结果，开始不会丢。
  - 播报节点同时设置名称和值：macOS 读值，Windows 和 Linux 的适配层按名称播报 live region。
- 验证：UI 测试覆盖以下行为。原生结果记录在 G2 清单。
  - `batch_milestones_are_announced_once`：每个里程碑只播报一次，运行中重绘与完成后编辑队列不再播报，两次渲染之间开始又结束的一批同时说开始和结果，取消与取消后的结果各播报一次，状态行读可见文字，播报节点的名称等于值；
  - `settings_and_batch_failures_are_both_announced`：在设置文件位置放一个目录，让写入在任何平台、任何用户下都确定失败。失败立即以 Assertive 播报；错误仍在时批次失败照样播报；写入恢复后错误消失，不播报。
- 退出条件：上游 GPUI 提供等效接口后，删除这部分改动。

## 未采纳：macOS FocusLost 只清理系统候选框

- 目的：清理组合输入时打开对话框后滞留的原生 `InputMethodCandidateList`。
- 范围：独立 worktree 的 `target/tmp/g2-scope/g2-focus-platform`，只复制 `gpui-pre-macos 0.3.8` 叶子 crate，在现有 `TextInputStateChange::FocusLost` 通知上延迟调用当前 native view 的 `inputContext.discardMarkedText`，以 Weak、closed 和重新聚焦状态保护窗口生命周期；不使用全局 `currentInputContext`。
- 评审：旧 client 的 marked range / composition transaction 尚未统一清理；最后一次 draw 的 focus 标志不能完全排除同帧重新聚焦风险。AppKit 头文件明确要求 client 自行清除 marked range，不能只关系统候选框。
- 原生结果：实验编译成功、最小 entitlement 的 ad-hoc GPUI 候选 strict 验签通过；真实 `ni hao` 候选存在时打开隐私对话框，`absent` 断言仍失败。FocusLost 仅区分有无接受文本的区域，不能代表所有控件切换。此次实验没有证明修复有效。
- 处置：实验不进入产品源码、依赖清单或锁文件，停止并退出实验 App，恢复未打补丁的正式开发候选。原始实验日志留在忽略的 `target/tmp` / `artifacts/reviews`，无需生成或发布分发产物。
- 后续要求：在能定位旧 client 的边界完成 owner 与系统两侧清理；验证原生候选、标记范围、撤销事务、返回后继续输入、快速重聚焦及窗口关闭。仅原生正向结果与 review 均通过后才考虑正式接入，届时登记上游来源和删除补丁的版本/验证条件。

窗口移动时已有组合候选停在旧位置的坐标失效实验也未被采纳；同机 Cocoa 对照会出现相同行为。两种观察应分开记录，不以一个补丁宣称修复全部 IME 场景。
