<!-- SPDX-License-Identifier: Apache-2.0 -->

# ImgConvert 全项目审查

**后续修复状态：**本报告中的问题已在同日后续任务中修复，详见 [修复与复审记录](PROJECT_REVIEW_FIXES_2026-09-05.md)。以下保留修复前的发现、复现和当时验证结果。

日期：2026-09-05。基线：HEAD `03b692f` 加审查时的整个工作区，包括已有未提交修改和未跟踪的新模块。结论不等同于该 commit、线上服务或已发布安装包的状态。

本次按模块审查桌面 Rust/Tauri、桌面 Svelte、Web 转换器、共享转换运行时、浏览器扩展、官网、文档站和发布工作流的关键路径，并运行本地验证。**确认 2 项 P1、4 项 P2、1 项 P3。** 当前主要发布阻塞是 Windows 安装器数量约定冲突，以及 Snap 将转换超时视为成功。现有测试均通过，仍未覆盖下列异常组合。

这是审查交付；本次新增本报告，没有修复产品代码、改写发布工作流、提交 Git 或执行外部发布。前次文档审查发现的三项发布问题在本次重新核对和复现，以下分别为 R1、R2、R5。

## 发现列表

| 编号 | 优先级 | 问题                                                     | 证据                                            |
| ---- | ------ | -------------------------------------------------------- | ----------------------------------------------- |
| R1   | P1     | Windows 两种语言的 MSI 被 finalizer 和最终完整性检查拒绝 | 配置、上传路径、真实验证函数复现                |
| R2   | P1     | Snap 转换任务超时仍通过发布前 smoke                      | 实际 timeout 加工作流原条件复现                 |
| R3   | P2     | 已完成 PDF 的无效设置阻止新图片转换                      | Chromium 实际页面复现与对照                     |
| R4   | P2     | PDF 逐页结果全部留存，缺少累计输出字节预算               | 数据流审查、100 页小型适配器实验；未做 OOM 压测 |
| R5   | P2     | GitHub 最终检查接受与 tag 无关且彼此不同版本的扩展 ZIP   | 真实验证函数复现                                |
| R6   | P2     | 默认 PR CI 未运行扩展的类型、测试与构建检查              | 工作流、脚本调用链和测试发现范围                |
| R7   | P3     | 无效入队或立即取消排队任务会丢失 Worker 空闲回收         | 真实调度器加可观测 Worker 适配器复现            |

P1 表示应在相关渠道下一次发布前处理；P2 表示影响合法使用场景或验证可靠性，需要安排修复；P3 表示触发范围较窄的资源生命周期缺陷。

## R1 · P1：让发布矩阵接受配置要求的两种语言 MSI

位置：[Windows finalizer](../.github/workflows/windows-release-assets-finalize.yml)，第 111–115 行；[完整性验证器](../scripts/verify-complete-github-release.mjs)，第 94–100、114–117 行。产物来源：[Windows 配置](../src-tauri/tauri.windows.conf.json)，第 14 行；[Windows build/upload](../.github/workflows/windows-smoke.yml)，第 360–368 行。

WiX 配置了 `en-US`、`zh-CN` 两种语言，[打包说明](../packaging/windows/README.md) 也明确会生成两份 MSI；每架构另有一份双语言 NSIS EXE，上传步骤收集所有 MSI/EXE。但 finalizer 要求总共两份安装器且只有一份 MSI，最终完整性验证器同样要求每架构恰好匹配一份 MSI。

因此，按当前配置成功生成的三份安装器会在 finalizer 被拒绝；即使绕过 finalizer 把两份 MSI 放入 draft，最终 publisher 仍拒绝它们。只改其中一处不足以恢复发布路径。

**复现：** 在临时目录使用现有测试的完整发布夹具。单语言基线通过，增加 `ImgConvert_1.2.3_x64_zh-CN.msi` 并更新 SHA256SUMS 后，调用真实 `verifyCompleteGithubRelease` 得到：

```text
Windows x64 MSI requires exactly one matching asset, found 2
```

这个实验验证的是门禁行为，没有在本次 Linux 环境重新生成 Windows MSI。

**建议与验收：** 明确建模“架构 × 安装器 × MSI 语言”，同步修改 finalizer、完整性验证器和测试。两架构各 `en-US`/`zh-CN` MSI 加各自 NSIS 应通过；缺语言、重复、错版本、错架构应拒绝。保留项目既定的未签名直发策略与 SmartScreen 说明。

## R2 · P1：将 Snap 转换超时判为失败

位置：[Snap workflow](../.github/workflows/snap-store-release.yml)，第 73–80 行；[smoke 程序入口](../src-tauri/src/main.rs)，第 15–20 行。

工作流用 `IMGCONVERT_PACKAGE_CONVERT_SMOKE=1` 运行有限转换任务，并设置 20 秒超时。该程序成功后直接返回，转换失败退出 70；工作流却同时接受退出码 0 和 124。只要启动或转换未在时限内结束，`timeout` 的 124 就会被视为通过，`publish_snap=true` 时后续发布 job 可以继续。

**复现：** 实际运行 `timeout 0.05s python3 -c 'import time; time.sleep(1)'`，确认返回 124；将该值交给从当前工作流读取的 `test "$code" = 0 || test "$code" = 124`，条件返回 0。

**建议与验收：** 转换 smoke 只接受正常成功退出，并保留成功输出与产物检查。正常转换通过；进程挂起、超时、非零退出均阻止发布。若另需 GUI 存活探测，使用独立步骤并明确其覆盖范围。第 71 行忽略 `snap connect` 失败，也不能作为 removable-media 权限已经验证的证据。

## R3 · P2：只按下一批待转换项校验 PDF 设置

位置：[Web App](../web-app/src/App.svelte)，第 201–217 行；同文件 `startConversion` 第 772–790 行及转换按钮的错误状态传递。

`hasPdfEntries` 包含已经 `done` 的 PDF，`pdfSettingsError` 据此影响整个转换按钮。但存在 `ready` 文件时，`startConversion` 只转换这些新文件，不重新处理已完成 PDF。因此，一份与下一批任务无关的 PDF 可以因页码或 DPI 无效，阻止新 PNG/JPEG 转换。

**实际页面复现：**

1. 在 Chromium 打开生产构建，导入一页 PDF 并成功转换为 PNG。
2. 保留已完成项，将 Pages 改为 `invalid`。
3. 再导入 `new-image.png`；它显示 `Ready to configure`，转换按钮却被禁用。
4. 将已完成 PDF 的 Pages 改回 `1`，按钮恢复，新 PNG 转换成功。

这不是 PDF 转换本身应该忽略无效参数，而是设置验证作用到了不参与当前批次的文件。扩展已有 [nextConversionIncludesPdf](../browser-extension/src/workbench/pdf-settings.ts) 处理“有 ready 则只考虑 ready，否则考虑可重转 done”的逻辑，可抽入共享运行时供两端复用。

**验收：** 新图片与已完成或已取消 PDF 共存时，不受无关 PDF 字段阻塞；若下一批确实包含 PDF，无效页码/DPI 仍必须阻止开始；只有已完成项时的再次转换继续正确验证 PDF。

## R4 · P2：限制 PDF 累计输出，而不只限制单页

位置：[PDF 转换循环](../packages/web-image-engine/src/pdf.ts)，第 265–297 行；[PDF Worker](../packages/web-conversion-runtime/src/workers/pdf.ts)，最终 `transfers`/`postMessage`；[资源限制](../packages/conversion-contract/src/limits.ts)；[单页输出限制](../packages/web-image-engine/src/bounds.ts)。

`convertPdfRequest` 把每一页的完整编码结果放入 `pages`，直到所有页面转换结束才整体返回。Worker 随后一次性传出所有 ArrayBuffer。Web 和扩展又为每页生成 Blob 并保留下载结果。逐页串行控制了同时渲染的页面数，但没有控制此前已生成结果占用的累计内存。

当前允许一次选择 100 页，每页编码结果上限 64 MiB；二者组合允许的编码结果总量达到 6.25 GiB，另有解码、编码器与画布内存。这是代码边界的算术上限，不是实测峰值。高细节多页 PDF，或多页重复引用同一张大图的 PDF，可能在源文件限制以内生成远大于源文件的结果集合，导致 Worker/标签页内存耗尽并丢失本批结果。

[批量导出](../packages/web-conversion-runtime/src/batch-export.ts) 第 157–164 行的 256 MiB 检查决定是否允许 ZIP；它是在结果已生成后进行的，不能约束前面的转换留存。本报告没有把 ZIP 大小限制误当成现有转换内存限制。

**验证边界：** 使用仓库原有 PDF/codec 测试适配器调用真实转换流程，100 页产生并同时保留 100 个不同的输出 ArrayBuffer，共 7,000 字节。这个小型实验验证整体留存机制；内存耗尽风险来自该机制与现有资源上限的组合分析，没有故意制造浏览器 OOM。

**建议与验收：** 为单份 PDF 和整个队列增加累计输出预算，在保留下一页前检查。超限要产生明确、可恢复的错误或有说明的部分成功结果。若实现按页传送或写入持久存储，也要避免主线程继续无限留存。用可调小预算验证“每页均合法、总量超限”可提前终止，并验证取消、失败及清空后的资源释放。

## R5 · P2：将扩展 ZIP 的版本绑定到发布 tag

位置：[完整性验证器](../scripts/verify-complete-github-release.mjs)，第 110–111 行；调用方 [GitHub publisher](../.github/workflows/github-release-publish.yml)。

最终检查只要求 Chrome/Edge 各有一个语义版本格式的 ZIP 文件名，没有要求两个版本一致，也没有读取发布 tag 中的 `browser-extension/package.json`。因此，草稿若手工混入旧包或错版本包，即使其字节校验和正确，最终门禁仍可放行。

**复现：** 使用现有完整矩阵夹具，把扩展换为 Chrome `9.9.9`、Edge `8.8.8`，各自生成正确 SHA256SUMS，调用真实验证器仍通过。

正常扩展 finalizer 会从 tag 构建并检查 ZIP，已降低常规路径的风险。这里的缺陷是最终发布验证无法独立拒绝异常资产组合，不是说正常构建一定混用了版本。校验和工具另有实际字节验证，本项也不是“没有 SHA256 校验”。

**建议与验收：** publisher 从目标 tag 取得扩展期望版本，验证文件名和包内 manifest，并保留构建来源校验。正确版本通过；两包互异、与 tag 不符、manifest 不符、重复包都失败。不能要求扩展版本等于桌面版本：当前两者分别为 `0.3.2` 和 `0.3.1`。

## R6 · P2：把扩展检查纳入常规 PR CI

位置：[CI frontend job](../.github/workflows/ci.yml)，第 60 行；[根 package.json](../package.json)，`quality:frontend` 第 159 行；[根测试配置](../vitest.config.ts)，第 15 行。

默认 push/PR frontend job 只执行 `quality:frontend`。其调用链未包含扩展的 `typecheck`、`test`、Chrome/Edge build 和 `guardrails`；根 Vitest 只发现 `tests/**/*.test.ts`，不会自动运行扩展的 `src/**/*.test.ts`。即使部分通用 lint/格式规则覆盖这些文件，也替代不了类型、行为和构建验证。

当前只有手动的 [扩展发布 finalizer](../.github/workflows/browser-extension-release-assets-finalize.yml) 调用 `extension:check`。这会把扩展特有回归的发现推迟到发布阶段；例如可选权限租约、MV3 manifest/CSP 或扩展 Worker 入口损坏时，默认 CI 仍可能通过。

**证据与范围校正：** 本地额外运行扩展测试，100 项 Vitest 加 5 项发布证据测试均通过，但不在默认 PR 门禁内。当前 `web:app:check → web:runtime:check` 已覆盖共享运行时检查，因此本项仅针对扩展，不将共享运行时继续列为缺失。

**建议与验收：** 在常规 CI 增加扩展检查，复用 `extension:check`，或拆分以复用已构建的运行时。若使用路径过滤，必须覆盖扩展、共享包、锁文件与构建配置的变更。用故意失败的扩展用例确认 PR 检查会失败；正常 Chrome/Edge 构建与 manifest guardrails 通过。

## R7 · P3：异常入队与排队取消后恢复 Worker 空闲计时

位置：[SerialConversionScheduler](../packages/web-image-engine/src/scheduler.ts)，第 188–196、214–221 行，以及空队列直接返回的 `#pump`。

`enqueue` 在请求校验及所有权转移前清除空闲计时器。如果请求被拒绝，既没有新任务，也没有恢复计时器。另一条路径是已有空闲 Worker 时入队后立即取消，`cancel` 移除排队项，随后的 `#pump` 看到空队列直接返回，同样不恢复回收计时。

这不会让转换结果出错，但已加载的 WASM/Worker 会超过默认 60 秒空闲期限继续存在，直到后续任务重新建立计时、Worker 故障回收或页面 dispose。触发主要位于调度器 API 边界，故优先级低于实际页面阻塞。

**复现：** 用真实调度器、仓库已有 FakeWorker 和合法成功结果。设置 `idleTimeoutMs=20`，等待 65 ms：

| 成功完成首任务后的动作                  | Worker 是否回收 |
| --------------------------------------- | --------------- |
| 不再入队，对照组                        | 是              |
| 提交 `schemaVersion=0` 的请求并捕获拒绝 | 否              |
| 合法入队后在同一任务中立即取消          | 否              |

三组最终均无 active/queued job。实验结束显式 dispose，未留下测试 Worker。

**建议与验收：** 在验证和取得请求所有权成功后再取消原计时；空队列取消或 pump 返回时确保重新安排空闲回收。为上述两条路径补行为测试，确认后续新任务仍可正常重新创建或复用 Worker；同时检查 PDF 调度器的相同生命周期约定。

## 验证结果

以下是本次本机执行结果，合计 **686 项单元/集成测试通过，87 项端到端测试通过，2 项按测试条件跳过**。定向缺陷复现不计入这些通过数量。

| 范围                 | 执行内容                                                                                        | 结果                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 根 JS/TS 测试        | `pnpm test --reporter=dot`                                                                      | 21 文件、141 项通过                                                                               |
| 各工作区测试         | `pnpm -r --workspace-concurrency=2 --if-present test`                                           | 249 项通过：impact 11、contract 16、engine 64、runtime 22、Web 31、扩展 100 + 5                   |
| Rust core            | `cargo test -p imgconvert-core`                                                                 | 92 单元 + 8 集成通过                                                                              |
| Rust Tauri           | `cargo test --manifest-path src-tauri/Cargo.toml`                                               | 190 库测试 + 4 程序测试通过                                                                       |
| Updater 签名验证工具 | `cargo test --manifest-path tools/updater-signature-verifier/Cargo.toml`                        | 2 项通过                                                                                          |
| Web E2E              | `pnpm --dir web-app test:e2e --workers=2`                                                       | Chromium/Firefox/WebKit 共 76 通过、2 跳过；跳过项为只在 Chromium 执行的目录选择器用例            |
| 桌面前端预览 E2E     | `pnpm run e2e --workers=2`                                                                      | 10 项通过；属于浏览器内的桌面 UI 预览                                                             |
| Linux 原生桌面 E2E   | `pnpm run e2e:desktop`                                                                          | 构建 debug E2E 应用，1 项通过，实际调用后端完成 PNG/PDF 预览与转换                                |
| 静态检查             | 根类型、lint、格式、Knip、架构、CI 成本、文档、UI i18n；Rust core/Tauri fmt、clippy all-targets | 通过                                                                                              |
| Web/官网构建         | `web:release:build`，Web typecheck                                                              | 通过，包括共享包构建和发布目录装配检查                                                            |
| 扩展构建             | typecheck、lint、format、Chrome/Edge build、guardrails                                          | 通过；两个生产 bundle 各约 11.31 MB                                                               |
| 文档站               | `pnpm --dir docs-site check`                                                                    | 通过，Next 生产构建成功                                                                           |
| npm 生产依赖         | `pnpm audit --prod --json`                                                                      | 审计输出 0 个漏洞                                                                                 |
| Rust 依赖            | `pnpm run audit:rust`                                                                           | 按仓库忽略列表退出 0；仍输出 glib 0.18.5 的 `RUSTSEC-2024-0429` unsound warning，不能表述为零告警 |

审查日志保留在本机 `/tmp/imgconvert-project-review-*.log`，定向复现分别为 `release-repros.log`、`pdf-settings.log`、`pdf-retention.log` 和 `scheduler.log`。这些是临时审查记录，不是上传到商店或 Release 的认证证据。

## 覆盖边界与后续顺序

代码审查重点包括输入探测与像素预算、路径/覆盖策略、外部 codec 子进程、Tauri IPC、结果缓存、转换状态与取消、PDF/SVG Worker、队列导出、扩展可选权限与远程图片请求，以及渠道配置、产物收集和最终发布门禁。这是按风险覆盖模块的审查，没有宣称逐行证明整个仓库正确或排除所有安全问题。

macOS/Windows 原生安装、MAS 沙盒和商店审核、MSIX/WACK、Snap strict 真机安装、扩展在厂商 Chrome/Edge 中的权限弹窗与更新流程、线上部署和长时内存压力没有在本次本机验证。Linux debug 原生 E2E 也不能替代正式 DEB/RPM/AppImage 的安装验证。没有执行新的长时间 fuzz campaign。

先处理 R1/R2 并补发布门禁失败用例；接着处理 R3/R4 的队列与内存行为，同时补 R6 的日常扩展验证；再修复 R5 的最终版本校验和 R7 的空闲生命周期。依照项目 AGENTS，相关正式包及证据未齐备前，公开 GitHub Release 仍须保持 draft。
