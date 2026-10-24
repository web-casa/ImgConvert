# GPUI macOS 生命周期与平台惯例修复方案

状态：v3（2026-10-25），已按 Codex 三轮评审修正（A：退出与临时文件；B：菜单、App Nap、窗口状态；C：v2 复核），修正记录见 §6。范围仅 GPUI 壳（`apps/gpui`）及其共用后端；Tauri 0.3.x 线不改。

## 1. 问题清单

| # | 问题 | 证据 | 级别 |
| --- | --- | --- | --- |
| L1 | 关闭最后一个窗口后进程仍在运行、无窗口，Dock 点击也不会重开 | 虚拟机复现；gpui `QuitMode::Default` 在 macOS 等于 `Explicit`（`vendor/gpui-pre/src/app.rs:3063`）；未注册 `on_reopen` | 高 |
| L2 | 幽灵进程继续持有单实例锁，后续启动只激活无窗口进程或（`open -n`）进入“另一实例运行中”窗口 | 同上 | 高（L1 的后果） |
| L3 | Dock“退出”、注销、关机走 `applicationWillTerminate` → `on_app_quit`，只刷新设置，不取消批次、不等原子写 | `settings_model.rs:220`；`shell/src/lib.rs:40` 只在 `Quit` 动作里调用 `Services::shutdown` | 高 |
| L4 | 批次运行中退出无确认；`Services::shutdown` 在 UI 线程同步阻塞最多 10 s，窗口无响应 | `shell/src/lib.rs:40-44`，`SHUTDOWN_TIMEOUT` | 中 |
| L5 | 强退/崩溃/等待超时后输出目录留下隐藏 `.imgconvert-<pid>-<nanos>-<n>.tmp`；替换已有输出时若中断在“旧文件改名为 `imgconvert-backup-*` 之后、新文件就位之前”，原输出只剩备份名 | `convert.rs:1231`、`:1309-1332`；启动只清剪贴板临时目录 | 高（可能丢原文件） |
| L7 | 退出时正在编辑的数值/后缀输入框草稿丢失（只在失焦/回车提交） | `settings_form.rs:587`、`:1061` | 中 |
| L6 | 批次期间未申请活动断言，后台/遮挡时可能被 App Nap 降速，空闲睡眠会中断长批次 | gpui 已有 `App::prevent_idle_sleep`（`app.rs:1522`），但我们没调用 | 中 |
| M1 | 应用菜单只有“退出”：缺关于、设置（⌘,）、隐藏（⌘H）、隐藏其他（⌥⌘H）、显示全部、服务 | `shell/src/lib.rs:79` | 中 |
| M2 | 编辑菜单只有“粘贴”：缺撤销/重做/剪切/拷贝/全选（输入框快捷键本身可用：Kit Input 在 `Input` 上下文绑定了 ⌘A/C/X/V/Z、⇧⌘Z，`gpui-base-0.7.1/src/input/base/state.rs:248`）；另外菜单“粘贴”落到只读输入框时会冒泡成“从剪贴板导入” | 同上；`workspace.rs:276` | 中 |
| M3 | 无窗口菜单：缺关闭窗口（⌘W）、最小化（⌘M）、缩放、全屏（⌃⌘F） | 同上 | 中 |
| W1 | 不记住窗口大小/位置，每次居中 1080×720 | `shell/src/workspace.rs:339` | 低 |
| D1 | 不能拖图片到 Dock 图标，无“打开方式” | 无 `on_open_urls`、无 `CFBundleDocumentTypes` | 低，另立 |

## 2. 设计

### 2.1 退出协调器（L1–L4、L7）

新增 `shell/src/lifecycle.rs`，全局 `QuitCoordinator`，状态 `Running → Confirming → Stopping → Exiting`，另有 `TerminateDeferred`（AppKit 等待回复，见 2.2）；重复请求幂等。

- **入口**：`Quit` 动作（⌘Q/菜单）、主窗口关闭（`on_window_should_close` 返回 false 后交给协调器）、⌘W（新的 `CloseWindow` 动作直接进协调器；`Window::remove_window` 不经过 `windowShouldClose`，不能依赖它）、系统终止（见 2.2）。
- **退出闩先于采样**：任何退出请求一进入协调器就先置闩，再判断活动；所有开始路径（`start`、选择输出目录回调、`start_batch`、`start_decided`）检查闩并拒绝，覆盖无活动分支下异步 `cx.quit()` 与排队中的开始之间的竞态。
- **“活动”判定**：`BatchService::is_active`、`progress_bridge::is_busy`、工作流面板的新状态 `start_requested`（在打开输出目录选择器之前就设置，`workflow_panel.rs:270`）、planning / `pending_start`（`:312-314`）任一成立。“继续转换”时清除闩。
- **无活动**：提交表单草稿 → `settings_model::flush` → `cx.quit()`。
- **有活动**：先关闭已打开的对话框（输出安全确认、预览、设置删除确认等）并放弃 `pending_start`，再弹 AlertDialog“转换尚未完成…”，按钮“继续转换”（默认/Esc，清除闩）与“停止并退出”。确认后 `Stopping`：克隆 `BatchService`（`service.rs:155`），在后台线程调用公开的 `shutdown(timeout)`（不暴露内部 completion），UI 显示“正在停止…”并禁用操作；返回后前台提交草稿、flush、`cx.quit()`。
- **表单草稿（L7）**：数值与后缀输入在 Change 时写入 `SettingsModel` 的草稿字段（校验失败不覆盖已保存值）。`commit_drafts` 定义在 `SettingsModel` 上，绕过表单的“批次进行中不可编辑”闸门（`settings_form.rs:638`），因为 `shutdown` 返回时 `BatchModel` 可能尚未结算；协调器与系统终止路径在 flush 前调用。
- **关闭主窗口 = 退出应用**（与 Tauri 0.3.x 一致）。保留 `QuitMode::Explicit`，避免窗口先被销毁导致确认框无处显示。`cx.quit()` 不会重入 `windowShouldClose`（评审确认），`Exiting` 只用于幂等，并补回归测试。
- **`on_reopen` 按模式处理**：持锁模式下若无窗口则开主窗口；阻塞模式只重新显示阻塞窗口（不得绕过实例锁开工作区）；`Exiting` 时忽略。
- **阻塞窗口**：关闭即退出，不触碰设置。

### 2.2 系统终止：纳入 gpui-pre-macos 补丁（L3）

`on_app_quit` 不可靠：`app.rs:1022` 在 AppCell 被借用时直接返回 false，`platform.rs:1475` 忽略该结果，回调可能整体跳过；且此时已无法取消、窗口已清空。因此 PR-A 内新增源码补丁（登记到 `patches/gpui-ime-focus` 覆盖登记表）：

- 在 `gpui-pre-macos` 的 app delegate 实现 `applicationShouldTerminate:`，转发给新的平台回调 `on_should_terminate() -> TerminateReply {Now, Cancel, Later}`。
- 协调器处理：`Exiting` 或无活动 → `Now`（先同步提交草稿与 flush）；有活动且是用户退出（Dock 菜单“退出”）→ `Cancel` 并转入 `Confirming` 弹框；注销/关机（当前 Apple Event 带 `kAEQuitReason`）→ `Later` 并进入 `TerminateDeferred`：后台 `shutdown(5 s)`，回到主队列提交草稿、flush，然后**恰好一次** `replyToApplicationShouldTerminate:YES`；此分支不调用 `cx.quit()`。`TerminateDeferred` 中的其他退出请求被吸收。
- `will_terminate` 仍保留 flush 作兜底。

### 2.3 中断的原子写（L5）

不扫描用户目录。改为**写入日志 + 启动恢复**：

- 日志位于 `paths::app_data_dir()/pending-writes/<pid>.jsonl`，**预写**：每个原子写操作分配唯一 `op_id`，在任何文件改动之前追加并 `sync_all` 一条意图记录 `intent{op_id,tmp,out,backup}`（备份名预先确定）；每次 rename 后 fsync 父目录，再追加 `placed{op_id}`、最终 `done{op_id}` 或 `retained{op_id,reason}`（例如恢复失败留下备份时）。
- 日志只在其中每个 `op_id` 都有终结记录（`done`/`retained`）后才压缩或删除；批次 `Completed` 本身不足以删除（单项恢复失败仍可能把原文件留在备份名下，`convert.rs:1337`）。`TimedOut` 时保留。
- 恢复按 `op_id` 逐个处理，绝不按 `out` 路径合并不同操作。
- 启动恢复在与转换相同的执行闸门下运行（`service.rs:317`）；恢复完成前“开始转换”不可用。
- 对每个无终结记录的 `op_id`（意图可能尚未生效，须逐一检查实际文件）：
  - `backup` 存在：若 `out` 不存在则改回 `out`（恢复原文件）；若 `out` 已存在且 tmp 已不存在（新文件已就位）则删除备份。
  - 有 `tmp_created`：tmp 文件名须匹配 `^\.imgconvert-\d+-\d+-\d+\.tmp$`、是普通文件且非符号链接才删除。
  - 条目对应文件已不存在即视为完成。
- 无法访问（沙盒无权限、卷未挂载）的条目**保留**，连同首次发现时间重写回日志，下次再试；不做定期过期删除。MAS 沙盒下没有持久化书签（`access.rs:8,100`、`macos_security.rs:7`），重启后通常无权访问输出目录：当用户在本次会话里重新授权某目录时，再对该目录下的保留条目执行同样处理。
- 恢复/删除结果写入诊断日志；不弹框。

### 2.4 后台运行与睡眠（L6）

- 不新增原生代码，使用 gpui 已有的 `App::prevent_idle_sleep`（`UserInitiated` 已包含禁止空闲睡眠）。
- 在 `progress_bridge::start_batch` 中获取并 await 返回的 `Task<Result<ActivityGuard>>`，guard 存进 `ActiveBridge`，在批次结算（完成、取消、超时、退出）时释放。`BatchModel` 是 `Clone + PartialEq` 的值类型，不持有 guard。
- 虚拟机对比：批次中最小化 60 s，有无 guard 的吞吐与进度刷新。

### 2.5 标准菜单与快捷键（M1–M3）

- **应用菜单**：关于 ImgConvert（新增 About 对话框：版本、构建号、版权、链接到许可/隐私）、设置…⌘,（新 `OpenSettings` 动作，聚焦设置面板）、服务、隐藏 ⌘H、隐藏其他 ⌥⌘H、全部显示、退出 ⌘Q。
- **服务菜单补丁**：`gpui-pre-macos/src/platform.rs:494` 把 `NSMenuItem` 传给了 `setServicesMenu_`，应传 `submenu`；随 PR-B 加入覆盖登记表并在虚拟机验证。
- **编辑菜单**：撤销/重做/剪切/拷贝/粘贴/全选，用 `os_action`；交给 Kit Input 已有绑定，不新增 Workspace 级重复绑定。Undo/Redo 走 `handleGPUIMenuItem:` 而非原生 `undo:`，需分别测菜单点击与快捷键。
- **粘贴与剪贴板导入分离**：新增 `ImportFromClipboard` 动作给工作区（`secondary-v` 仅在非 `Input` 上下文绑定到它），菜单“粘贴”只发 `Paste`，避免只读输入框时误导入。另加“文件 → 从剪贴板导入”菜单项。
- **窗口菜单**：最小化 ⌘M、缩放、进入全屏 ⌃⌘F、关闭窗口 ⌘W（`CloseWindow` → 协调器）。菜单识别用不翻译的稳定名：`platform.rs:314` 仅在名称为 `"Window"` 时调用 `setWindowsMenu_`，补丁改为按显式标记识别，显示标题照常本地化。
- 九语言新增键，用词参照 macOS 系统本地化。

### 2.6 窗口状态（W1）

- 文件 `paths::window_state_file()` = `app_data_dir()/gpui-window-state.json`（MAS 容器重定向一致；仅 GPUI 使用，不写进与 Tauri 共享的 settings.json）。原子写；缺失或损坏时忽略。
- 内容：`{kind: windowed|fullscreen, maximized: bool, restore: {x,y,w,h}, display_uuid}`。macOS 的 `window_bounds()` 只返回 Windowed 或 Fullscreen（`window.rs:943`），最大化由 `is_maximized()`（`:862`）单独记录；恢复时先以 Windowed 打开再 `zoom()`。
- 坐标问题：`MacWindow::bounds()` x/y 的屏幕原点处理不一致（`window.rs:923`），`MacDisplay::bounds()` 原点恒为 0（`display.rs:108`）。方案：按 `display_uuid` 选显示器，保存/恢复**显示器内局部**矩形，并用该显示器 `visible_bounds()` 校验（至少 100×100 可见，否则居中默认尺寸）；显示器不存在时回到主显示器默认。显示器内局部坐标转换作为明确的 vendored 补丁（不再是“必要时”），登记到覆盖登记表，并配上下叠放双显示器的单元测试。
- 全屏状态恢复为“先按 restore 打开窗口，再进入全屏”。

### 2.7 D1 另立

拖到 Dock/“打开方式”需改两个渠道的 Info.plist 与沙盒文件访问，单独排期。

## 3. 拆分与顺序

1. **PR-A 退出**：2.1 + 2.2（含 `applicationShouldTerminate` 补丁）+ L7 草稿提交。
2. **PR-B 中断写恢复**：2.3（涉及备份恢复，单独评审）。
3. **PR-C 菜单与快捷键**：2.5（含服务菜单与窗口菜单识别补丁、About 对话框）。
4. **PR-D 后台与窗口状态**：2.4 + 2.6。

## 4. 测试

- 单元：协调器状态机（无活动直接退出；planning/pending_start 也算活动；确认/继续；重复请求幂等；退出闩阻止新批次；超时仍退出；阻塞模式下 reopen 不开工作区）；终止应答（Exiting→Now、用户退出→Cancel、注销→Later 且有上限）；日志恢复（备份改回、新文件已就位删备份、非匹配名/符号链接不删、无权限条目保留、TimedOut 保留日志）；草稿提交；窗口状态序列化与显示器校验（含叠放双屏、显示器消失、损坏文件）。
- UI 测试：关闭主窗口与 ⌘W 进协调器；确认框；Stopping 时禁用；打开的对话框在退出前被关闭；只读输入框粘贴不触发导入。
- 虚拟机手测：红色关闭、⌘W、⌘Q、Dock 右键退出（批次中/空闲）、`kill -9` 批次中重启后输出与备份恢复、菜单全部项与快捷键、服务菜单、全屏与最小化后恢复、App Nap 对比。
- GUI 冒烟工作流：增加“关闭窗口后进程退出”断言。

## 5. 风险

- 新增 gpui-pre-macos 源码覆盖（终止应答、服务菜单、窗口菜单识别，可能还有坐标）：全部登记到覆盖登记表，并作为上游缺陷单独评估是否报告。
- 注销/关机给 app 的时间有限，5 s 上限内未完成的写交由 2.3 的启动恢复处理。
- 草稿实时写入可能产生更多保存：沿用现有防抖。

## 6. 评审修正记录（v1 → v2）

| 来源 | 级别 | 意见 | 处理 |
| --- | --- | --- | --- |
| A | P1 | 日志未覆盖 `imgconvert-backup-*`，强退可能丢原输出 | 2.3 记录各阶段状态并在启动时恢复备份；L5 升为高 |
| A | P2 | 整个日志删除会丢掉跳过的条目；超时后删日志不安全 | 条目保留重写；TimedOut 保留日志 |
| A | P2 | MAS 无持久化书签，前提错误 | 去掉书签假设，改为本会话重新授权后再处理；取消 7 天过期 |
| A | P2 | `completion.wait_until` 为私有 | 改用克隆 `BatchService::shutdown` 在后台调用 |
| A | P2 | 开批次过程中退出未覆盖 | 活动判定扩展 + 退出闩 |
| A | P2 | flush 不含未提交的输入草稿 | 新增 L7 与草稿提交 |
| A | P2 | `on_app_quit` 可能因 AppCell 借用被跳过 | 改用 `applicationShouldTerminate` 补丁，纳入 PR-A |
| A | P2 | 终止补丁在 Stopping 超时后会取消自身退出 | `Exiting` 返回 Now；注销用有上限的 Later |
| A | P3 | 对话框与 pending 状态不在状态机内 | 退出前关闭对话框并放弃 pending_start |
| A | P3 | §5 重入担忧不成立 | 改为回归测试 |
| A | P3 | 阻塞模式下 reopen 会绕过实例锁 | reopen 按模式处理 |
| B | P1 | App Nap 已有 `prevent_idle_sleep`；guard 不能放 BatchModel | 改用现有 API，guard 放 `ActiveBridge` |
| B | P1 | 服务菜单把 NSMenuItem 传给 `setServicesMenu_` | 加入补丁修正 |
| B | P2 | 菜单粘贴在只读输入框冒泡成导入 | 拆出 `ImportFromClipboard` |
| B | P2 | 本地化“Window”破坏窗口菜单识别 | 按稳定标记识别 |
| B | P2 | 没有 About/设置/关闭窗口的现成动作 | 新增动作与 About 对话框；⌘W 走协调器 |
| B | P2 | 窗口状态丢失全屏/最大化/显示器 | 带标签状态 + display_uuid |
| B | P2 | 多显示器坐标不一致 | 显示器内局部坐标 + 叠放屏测试，必要时修补 |
| B | P3 | 状态文件路径与失败处理 | `window_state_file()`、原子写、忽略损坏 |
| B | P3 | M2“待测”过时 | 已改为事实 |
| B | P3 | Undo/Redo 非原生 | 分别测菜单与快捷键 |
| C | P1 | 日志追加与 rename 之间仍有丢失窗口 | 预写意图 + `sync_all` + 父目录 fsync |
| C | P1 | 批次 Completed 即删日志不安全 | 每个 op 有终结记录后才压缩 |
| C | P2 | 启动恢复可能与新转换竞争 | 同一执行闸门；恢复完成前禁止开始 |
| C | P2 | 记录缺少操作标识 | 每条记录带 `op_id`，按操作恢复 |
| C | P2 | 终止延迟回复无状态归属 | 新增 `TerminateDeferred`，恰好一次回复，不调用 `cx.quit()` |
| C | P2 | 选择器阶段的开始未计入活动；闩置位太晚 | 先置闩再采样；新增 `start_requested` |
| C | P2 | 草稿经表单提交会被忙碌闸门拒绝 | `commit_drafts` 放在 `SettingsModel` |
| C | P3 | macOS 无 `Maximized` 边界；坐标修补应明确 | 单独记录 `maximized`；坐标补丁列为必做 |

## 7. 实现偏差记录

- PR-A：会话结束在 `applicationShouldTerminate:` 内同步等待最多 5 s 后回复“立即”，未使用 `NSTerminateLater`，因此不需要 `TerminateDeferred` 状态。
- PR-A：未注册 `on_reopen`：关闭唯一的窗口即退出应用，不会出现“无窗口但仍在运行”的状态。
- PR-A：活动判定只看批次（`progress_bridge::is_busy`、`BatchService::is_active`）。规划中或输出安全确认中退出不再询问：此时尚未写任何文件，退出闩会拒绝之后的开始。
- PR-A：确认前不关闭已打开的对话框：批次运行时不能再开始新批次，已打开的对话框不会导致写入。
- PR-A：草稿只在最终退出时提交（“继续转换”不改动草稿），提交绕过表单的忙碌闸门。
- PR-B：恢复在持有单实例标记后于启动时同步执行，不另设执行闸门：此时尚无批次，且所有已有日志都属于已结束的进程，因此不需要 pid 判断。操作 id 为“日志 id:序号”，跨日志唯一。
- PR-B：只有暂存备份的写入在结束时同步落盘结束记录；Windows 无法刷新目录，结束记录的持久性依赖卷缓存。
- PR-B：输出所在文件夹无法检查（未挂载、无权限）时条目保留，不视为已完成；每次选择输出文件夹后重试保留条目（覆盖 Mac App Store 沙盒重新授权的情形）。读到中间损坏的日志改名为 `*.unreadable` 保留，不再重试。
- PR-B：写入日志记录失败时不暂存原输出（报错“无法记录写入日志”）；日志无法启动时写入照常进行，与引入日志前相同。
- PR-B（复核后）：恢复全程串行；保留条目先写入 `.partial` 再改名；损坏日志仍读取全部可解析记录（含结束记录）。备份与输出都不存在时视为无法判断而保留（卸载卷的挂载点可能仍是空文件夹），因此用户之后删除了该输出时，条目会一直保留，但只占日志中的一行。重试在界面线程同步执行，且仅在没有批次时（选择输出文件夹、点击开始前），不会与写入竞争。
