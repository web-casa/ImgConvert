<!-- SPDX-License-Identifier: Apache-2.0 -->

# R1 + L2：过渡版互斥启动与 G1 验收记录

日期：2026-10-18。源码分支：`fix/tauri-instance-lock`，基线 `1528ba3`。
本记录准备下一个 0.3.x 补丁；版本号尚未指定，仍保留现有 0.3.1 版本字段。
`v0.3.1` 是既有发布，不移动旧 tag，不把新代码的测试归给旧包。

## 补丁说明草稿

- 修复普通图片处理中取消不生效的问题；取消结果在提交判定点前不会写出。
- 新建输出采用同目录临时文件和不覆盖原子提交，避免暴露写入中的半成品。
- Tauri 过渡版与 GPUI 使用同一实例锁，阻止并发写共享设置。另一实例运行时显示提示并退出；无法锁定数据目录时停止启动。
- Windows 直发安装包按项目政策保持未签名，运行时可能显示 Microsoft Defender SmartScreen 提示。

只发布 Tauri 维护线；G5 前 GPUI/CLI 不进入公开 Release。

## R1 行为与验证范围

锁路径复用 `imgconvert_backend::paths::instance_lock_file()`，锁协议复用
`imgconvert_backend::instance_lock::acquire`，无新依赖。Tauri 在清理缓存、
注册插件和创建 WebView 前取锁；成功后交给 app state，退出等待批次收尾期间仍持锁。
占用分支只注册 dialog 插件并清空配置中的窗口，不注册 store、业务 IPC 和业务服务。
提示使用中英双语，避免为读取 locale 访问共享设置；不依赖锁描述可读（Windows 的独占锁会阻止读取）。

Tauri 没有 GPUI 的内存设置降级模式，因此路径/IO 错误拒绝启动。
锁文件永不删除，崩溃后由 OS 释放锁，旧 JSON 不构成存活依据。
未接入协议的历史 Tauri 安装件不能被该锁约束。

新增 Tauri 单测仅使用 `$TMPDIR` 内的自建夹具，不访问真实 settings/cache：
Tauri 持锁阻止 GPUI 和同 flavor、GPUI 持锁阻止 Tauri 且设置与标记不变、
释放后 GPUI 可取得原文件、损坏的无锁旧标记可恢复、路径缺失/IO 失败拒绝启动。
顺便修复 platform 既有锁测试在 Windows 持锁期间读取 marker 的断言：
描述通过 guard reader 校验，文件内容等释放锁后再读取。Windows Smoke 新增 platform 锁测试步骤。
这些是模块测试；两套安装件的互斥、崩溃和对话框交互实测属于 R2，不能据此标记完成。

## G1 证据表

下表记录开 PR 前的本地验证快照。PR 的 CI 和三平台原生验证结果随后
附在 PR 验证评论中；仅据本表不能声称完整候选已验收。

| 验收项 | 状态 | 证据或缺项 |
| --- | --- | --- |
| 根 Rust fmt/clippy/全特性测试 | 通过 | 376 项测试；日志 `apps/gpui/target/tmp/r1-root-{clippy,test}.log`（ignored） |
| GPUI fmt/clippy/锁定测试 | 通过 | 44 项测试，`--locked -j 2`；日志 `apps/gpui/target/tmp/r1-gpui-{clippy,test}.log`（ignored） |
| 前端 check/测试、文档、成本与架构护栏 | 通过 | 153 项前端测试；Svelte 0 errors/warnings；工作流 Prettier 通过 |
| Tauri 单测及 desktop E2E | 未执行 | Linux 直接载入生产 startup 模块的独立 harness 4 项通过；绕过占用检查的负向验证变红、恢复后通过。完整壳与 E2E 由本片 CI 原生作业验证 |
| fuzz 回放 | 未执行 | 由本片 CI 验证 |
| 许可证扫描 | 未执行 | 由本片 CI 验证；本片不新增依赖 |
| macOS 原生启动模块测试 | 通过 | macOS 13.6 arm64 独立 worktree，完整 Tauri 编译与 4 项 startup 测试通过；精简原生 harness 6 项通过；不触碰虚拟机主检出 |
| Windows 原生启动模块测试 | 未执行 | 手动 Windows Smoke 验证 |
| Linux amd64/arm64 安装、升级、GUI、卸载与图像 QA | 未执行 | 需同一正式候选的 DEB/RPM/AppImage；不触发发布工作流 |
| macOS x64/arm64 安装、升级、GUI、卸载与图像 QA | 未执行 | 需同一候选的签名、公证、staple DMG 与实机 |
| Windows x64/arm64 安装、升级、GUI、卸载与图像 QA | 未执行 | 需同一候选的未签名 MSI/NSIS 与原生系统 |
| 两安装件互斥/崩溃恢复（R2） | 未执行 | 需 Tauri 与 GPUI 内部安装件，含原生提示框确认退出 |
| 三平台六架构产物与合并 SHA256SUMS | 未执行 | 尚未准备下一补丁的 Release 草稿 |
| Chrome/Edge 扩展 ZIP | 未执行 | 最新 main 未包含扩展打包线；原开发检出有未提交实现，不借用未审查代码发布 |
| 0.3.x 补丁发布 | 未执行 | 等待用户批准合并、确定版本及授权发布 |

完整 QA 按 `docs/RELEASE_QA.md` 执行，逐项记录候选 commit、包哈希、
系统/架构、安装/升级/卸载、图片/权限/GUI 结果与工作流 URL。
不能用已合并 B1b 的三平台原子输出测试代替本候选安装 QA。

## 放行条件

G1 保持未关闭。先完成本片代码与 CI 评审，再由用户决定合并；
稳定 tag 和 release 工作流需要单独授权。全部正式直发包、macOS 签名/公证/staple、
安装/运行 smoke、来源证据、浏览器扩展 ZIP 和合并校验和齐全前保持 draft。
已知阻塞：main 未包含浏览器扩展发布线及扩展 finalizer。其他渠道的
证书、账号、runner、finalizer 可用性尚未验证，不声称缺失或已具备。
商店包是独立渠道，不能替代直发包。

## 只读评审处置

Codex 评审未发现本片 P1/P2 缺陷，1 项 P3 已修：把“无 IPC”收窄为
“无业务 IPC handlers”，因为 Tauri 及 dialog 仍会注册核心命令。
评审另发现既有 Windows platform 测试在持锁时读 marker，已调整为释放后
读盘，并在 Windows Smoke 显式运行。评审原文保存在
`artifacts/reviews/codex-r1-review-2026-10-18.md`（ignored）。
模块测试不验证 Tauri builder 的启动时序和 managed state 生命周期；
这两项经过锁定版本 Tauri 2.11.5 / dialog 2.7.1 源码核查，原生 GUI/R2 仍待验收。

原生验证补充：macOS 13.6 arm64 上的精简 harness 直接载入本片
platform/startup 生产模块，6 项测试通过。完整 Tauri 编译另发现两个
`generate_context!()` 展开产生重复 `_EMBED_INFO_PLIST` 符号，已收敛为
单个上下文构造函数；修复后完整编译结果见 PR 验证评论。首次编译还遇到
Apple clang 14 的 libaom SVE 探针挂起，中止该探针后按 libaom 原有能力检测
失败路径继续；此虚拟机构建不作为发布产物或性能基线。
