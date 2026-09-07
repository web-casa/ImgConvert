<!-- SPDX-License-Identifier: Apache-2.0 -->

# 全项目审查问题修复与复审

日期：2026-09-05。对应 [原审查报告](PROJECT_REVIEW_2026-09-05.md) 的 R1–R7。

> 后续更正：独立审查确认 Windows 上游数量检查仍冲突，AppImage 双名称也会阻断完整发布。
> 本文保留上一轮修复与测试的历史记录，其中“未发现新增阻塞项”不再代表当前结论。
> 后续修复、最终字节证据和验证边界见 [发布链补充修复记录](PROJECT_REVIEW_RELEASE_FIXES_2026-09-05.md)。

**7 项问题均已在当前工作区修复，并完成相关本地验证；最终复审未发现新增阻塞项。** 修改基于 HEAD `03b692f` 加用户已有工作区内容，没有覆盖已有改动，没有创建提交、推送或执行发布。本记录描述源码和本地检查状态，不表示 GitHub 上的工作流已更新或商店已验收。

## 修复结果

| 编号    | 修复                                                                                                                                                                                        | 验证                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| R1 · P1 | [共用 Windows 矩阵](../scripts/windows-release-assets.mjs)要求每架构 en-US/zh-CN MSI 各一份和 NSIS 一份；finalizer 先收齐六份，最终完整性检查使用同一名单                                   | 双语言完整矩阵通过；缺中文 MSI、错版本、额外语言、重复变体和架构混淆被拒绝；实际运行 finalizer 所用 CLI                             |
| R2 · P1 | [Snap smoke](../.github/workflows/snap-store-release.yml)使用 `set -euo pipefail`，要求正常退出、明确成功记录及四种非空输出；接口连接失败不再忽略，保留日志与输出附件                       | 执行工作流原 shell，替换安装命令为本地适配器；成功通过，真实 timeout、失败退出、缺记录、缺文件均拒绝                                |
| R3 · P2 | 将 [下一批 PDF 判断](../packages/web-conversion-runtime/src/pdf-settings.ts)共享给两端；Web 只按下一批实际转换项校验 PDF 字段                                                               | 三浏览器实际页面通过：保留 done PDF、输入无效页码、加入 PNG 后仍可转换；只有 done 项时再次转换继续验证 PDF                          |
| R4 · P2 | 增加单份 PDF 128 MiB、整个队列 256 MiB 的累计输出预算，贯穿 UI、不可变请求、调度器、raster/SVG/PDF Worker 和返回消息验证                                                                    | 小预算覆盖单页合法但累计超限、精确边界、零额度、超额 Worker 消息与清空恢复；三浏览器真实 PDF.js/codecs 验证部分成功可下载及错误文案 |
| R5 · P2 | [publisher](../.github/workflows/github-release-publish.yml)从目标 tag 读取扩展版本；[完整性验证器](../scripts/verify-complete-github-release.mjs)核对 ZIP 文件名及包内 manifest 版本       | 两包版本不同、偏离 tag、manifest 不符、重复 manifest、损坏/超大 manifest 均拒绝；真实 Chrome/Edge WXT ZIP 验证通过                  |
| R6 · P2 | `quality:frontend` 纳入 `extension:check`，复用常规 PR 的 Linux job；[CI guardrail](../scripts/check-ci-cost-guardrails.mjs)防止该调用被漏删                                                | 完整 `quality:frontend` 实际执行扩展类型、测试、lint、双浏览器构建和 guardrails；工作流测试核对 PR 入口及调用链                     |
| R7 · P3 | [普通调度器](../packages/web-image-engine/src/scheduler.ts)及 [PDF 调度器](../packages/web-image-engine/src/pdf-scheduler.ts)在验证和取得请求所有权后才取消空闲计时；排队取消后重新安排回收 | 普通调度器的无效入队、立即取消、到期回收及后续新 Worker 转换通过；PDF 无效请求后仍按期回收                                          |

## 内存保护的行为和边界

[ResourceLimits](../packages/conversion-contract/src/limits.ts) 新增 `maxPdfOutputBytes` 和 `maxTotalOutputBytes`。两个请求类型可带 `outputByteLimit`，只能减少当前队列的额度；零额度直接产生可恢复的 `output-budget-exceeded`。调度器将有效额度复制到不可变请求，SVG 路由到 raster 时保留该字段。

两端从当前队列内每个结果 Blob 的真实大小计算剩余额度；包含 PDF 的所有额外页面，按串行转换顺序交给下一任务。移除结果、清空队列或重置已完成项后重新计算，避免累加计数器漂移。下载本身不清理结果，也不会虚增可用额度。

PDF 在加入成功页面前受剩余额度约束，耗尽后停止渲染后续页面。已成功的页面继续可下载，其余页面附带明确失败原因，并进入现有部分失败导出记录。普通图片输出超过剩余额度时也拒绝保留。调度器会再次核对 Worker 返回的单项/累计字节，拒绝不遵守额度的消息。

这些限制约束**留存的编码结果**，独立于 ZIP 限制，不是进程 RSS 上限。当前渲染页、解码/编码器、画布、源文件以及 Blob 创建和 ZIP 导出仍有暂时内存成本。测试使用小额度和真实小图，没有故意制造 OOM，也没有引入宣称固定总内存的文案。

## 发布门禁的复审

Windows 名单是配置当前要求的六份正式直发安装器；不删除中文 MSI，不引入 Authenticode 签名，不用 MSIX 替代直发包。最终精确名单检查会拒绝前面文件名初筛未捕获的错版本或额外变体。来源 run/tag、draft 限制、既有资产防覆盖、共享发布锁及 SHA256SUMS 流程保留。

扩展验证新增必需参数 `--extension-version`，自动 publisher 从 `git show "$RELEASE_TAG:browser-extension/package.json"` 获取。检查器使用 Node 内置能力读取最多 8 MiB 的 ZIP，对 manifest 解压设置 64 KiB 上限，校验目录边界、唯一条目、本地头、长度和 CRC，接受 stored/DEFLATE，不解压文件路径到磁盘。这个检查聚焦 manifest 身份；完整 ZIP 与厂商构建的结构一致性仍由既有扩展 finalizer/`zip:check` 验证，实际字节哈希仍由原 checksum verifier 复算。

Snap 证据附件即使 smoke 失败也尽量保留，但正式产物上传和 publish job 仍依赖成功检查。接口连接状态与文件转换结果分别记录；连接成功不冒充可移动盘或 portal 实测。

## 本次验证

| 检查                                                                       | 结果                                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm run quality:frontend`                                                | 通过，覆盖根/共享包/Web/扩展/官网/文档站的既有类型、测试、lint、格式、Knip、生产构建和相关检查                           |
| 上述不同 JS/TS 测试去重计数                                                | **420 项通过**：根 159、impact 11、contract 17、engine 74、runtime 23、Web 31、扩展 100 + 发布证据 5；比原审查增加 30 项 |
| Web 全量 E2E 与新增用例复跑                                                | **82 项已验证通过，2 项按原条件跳过**；新增 2 个场景各覆盖 Chromium/Firefox/WebKit，共 6 项                              |
| `pnpm --dir browser-extension zip`                                         | Chrome/Edge 实际 ZIP 构建和原结构检查通过，各约 3.78 MB；新的 manifest 读取器也通过                                      |
| `architecture:check`、`ci:cost:check`、`release:snap:verify`、`docs:check` | 通过                                                                                                                     |
| 最后改动后的 lint、Web typecheck、定向工作流测试                           | 通过                                                                                                                     |
| 修改文档与 Skill 参考                                                      | 格式与本地链接验证；原缺陷报告保留历史证据，增加本修复记录入口                                                           |

E2E 执行过程说明：首轮原有 76 项通过、2 项跳过，新增 6 项因测试夹具自动清空队列、预算注入修改被冻结请求及文案大小写而失败。修正测试夹具后定向重跑这 6 项，全部通过。生产代码在两次 E2E 之间没有再修改；不把第一次全量执行表述为一次全部通过。

没有改动 Rust/Tauri 业务代码，因此本次不重复前轮已通过的 Rust/native 测试。新发布脚本以临时产物夹具及真实扩展 ZIP 验证；没有重新构建/安装 Windows MSI、macOS DMG、MAS/MSIX 或 strict Snap，没有访问商店账户或触发 GitHub Actions。正式发布仍须由对应平台 runner 对目标 tag 和最终安装件验收，依照 AGENTS 保持未齐备的 Release 为 draft。

## 复审方法与证据位置

对照任务开始时的工作区快照逐项检查自身修改，重点核对预算跨边界传递、不可变所有权、部分成功与失败清理、是否误删语言产物、ZIP 读取边界，以及检查失败后是否仍有上传路径。复审由本次执行者完成，没有宣称独立代理审核。

本机日志：`/tmp/imgconvert-fixes-quality-frontend.log`、`/tmp/imgconvert-fixes-release-tests.log`、`/tmp/imgconvert-fixes-engine-tests.log`、`/tmp/imgconvert-fixes-guardrails.log`、`/tmp/imgconvert-fixes-web-e2e.log`、`/tmp/imgconvert-fixes-web-regressions.log`、`/tmp/imgconvert-fixes-extension-zips.log`。这些日志不替代正式候选的签名、安装和来源证据。
