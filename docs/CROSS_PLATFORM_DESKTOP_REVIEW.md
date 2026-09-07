<!-- SPDX-License-Identifier: Apache-2.0 -->

# 跨平台经验文档与 Skill 审查记录

**后续修复状态：**本报告中的问题已在同日后续任务中修复，详见 [修复与复审记录](PROJECT_REVIEW_FIXES_2026-09-05.md)。以下保留修复前的发现、复现和当时验证结果。

日期：2026-09-05。审查对象：[经验手册](CROSS_PLATFORM_DESKTOP_PLAYBOOK.md)、[desktop-release-playbook Skill](../.agents/skills/desktop-release-playbook/SKILL.md)，以及它们引用的关键发布流程。

本次交付是文档与可复用 Skill。文档已明确平台要求、项目策略、历史经验与未验收事项的边界；核对发布代码时另外确认 **2 项 P1、1 项 P2**。这些是现有流程待修项，没有在本次文档任务中改写工作流。它们不阻止阅读和使用手册，但相关发布前应修复并补验证。

工作区审查基线的 HEAD 为 `03b692f`，且已有大量未提交修改；部分 finalizer/publisher 文件尚未跟踪。以下结论针对审查时的工作区，不声称已部署到 GitHub 的工作流或某个历史 tag 具有完全相同代码。

## P1：Snap 转换超时会被判为成功

位置：[snap-store-release.yml](../.github/workflows/snap-store-release.yml)，`Install and smoke built snap` 步骤，审查时第 73–80 行。

触发条件：设置 `IMGCONVERT_PACKAGE_CONVERT_SMOKE=1` 后，进程在 20 秒内未完成。`timeout` 返回 124，但工作流接受 `code=0` 或 `code=124`。

依据：[main.rs](../src-tauri/src/main.rs) 的 package conversion smoke 是有限任务，成功后直接返回，失败退出 70；它不是需要一直运行的 GUI 启动探测。将 124 接受为成功，会使启动挂起、转换卡住和没有按期完成的候选仍通过该门禁；`publish_snap=true` 时后续 publish job 可继续。

本地复现：用实际 `timeout` 终止临时 Python 睡眠进程，确认返回 124；提取工作流原条件交给 Bash 执行，返回 0。

```text
CONFIRMED: actual timeout exit 124 satisfies current Snap smoke success condition.
```

建议：转换测试要求成功退出并保留输出检查；GUI 存活检查如需按时间结束，拆成独立步骤且只报告启动覆盖。第 71 行 `snap connect ... || true` 也不能当作 removable-media 通过的证据，应记录连接状态并单独验证相应文件路径。

修复后的验收：成功转换可继续；转换失败、超时、缺少明确结果均阻止发布；未连接接口的可选用例明确显示未覆盖。

## P1：Windows 本地化 MSI 数量与两层发布门禁冲突

位置：

- [tauri.windows.conf.json](../src-tauri/tauri.windows.conf.json)，`bundle.windows.wix.language`，审查时第 14 行。
- [windows-release-assets-finalize.yml](../.github/workflows/windows-release-assets-finalize.yml)，每架构安装器收集与计数，审查时第 111–115 行。
- [verify-complete-github-release.mjs](../scripts/verify-complete-github-release.mjs)，MSI requirement 与 `matches.length !== 1`，审查时第 94–100、114–117 行。

触发条件：按现有配置为某一架构生成 en-US 与 zh-CN 两份 MSI，以及一个 NSIS EXE。Windows build workflow 上传 `*.msi` 与 `*.exe`，没有筛掉某种语言。finalizer 却要求总共两份安装器且只有一份 MSI，完整性验证器也只允许每架构匹配一份 MSI。

影响：符合现有语言配置的候选不能走通 finalizer；即使手工附加两个语言版本，publisher 的完整性检查仍会拒绝。仅改其中一层不足以修复。

本地复现：在临时目录构造一套满足当前命名规则的非空测试文件、说明和 SHA256SUMS，调用真实 `verifyCompleteGithubRelease`；基线通过，增加 x64 zh-CN MSI 后出现：

```text
Windows x64 MSI requires exactly one matching asset, found 2
```

这是完整性检查函数的行为复现，不是本次重新在 Windows 上生成了安装器；两语言产物来源还由当前配置和 [Windows 打包说明](../packaging/windows/README.md) 支持。

建议：按配置明确建模“架构 × 安装器 × MSI 语言”，finalizer、完整性验证器、测试和发布说明同步接受并要求对应集合；拒绝缺语言、重复与额外错误版本。不要为通过门禁擅自删掉中文 MSI。

修复后的验收：两架构各两份语言 MSI 加各自 NSIS 可通过；任一语言缺失、重复、架构或版本错误时拒绝，合并校验和逐文件覆盖。

## P2：最终完整性检查未绑定发布 tag 中的扩展版本

位置：[verify-complete-github-release.mjs](../scripts/verify-complete-github-release.mjs)，Chrome/Edge ZIP 正则，审查时第 110–111 行；调用方 [github-release-publish.yml](../.github/workflows/github-release-publish.yml) 未传入 tag 中的扩展期望版本。

触发条件：草稿中有各一个语义版本格式的 Chrome/Edge ZIP，但来自旧构建或不同版本，且校验和正确。当前检查只约束两个 ZIP 的文件名形状，没有要求二者版本相同，也没有读取 tag 中 `browser-extension/package.json`。

本地复现：临时候选以桌面 `v0.3.1` 为参数，Chrome ZIP 用 `9.9.9`、Edge ZIP 用 `8.8.8`，调用真实完整性检查函数仍通过。

```text
CONFIRMED: matrix accepts Chrome 9.9.9 / Edge 8.8.8 without consulting tagged extension version.
```

影响边界：正常的扩展 finalizer 会从 tag 构建并做结构校验，已降低常规路径风险；这里暴露的是最终发布门禁面对手工附加、陈旧资产或异常组合时的漏检，不是说 finalizer 必然构建了错误版本。

建议：publisher 从目标 tag 获取期望扩展版本并交给验证器；分别验证两个 ZIP 的文件名与包内 manifest 版本，保留构建来源。不能拿桌面版本代替扩展版本——当前工作区的两者本来就分别是 `0.3.1` 和 `0.3.2`。

修复后的验收：正确且同源的两个包通过；版本不同、与 tag 不符、包内 manifest 不符或重复资产均失败。

## 文档与 Skill 的内容审查

| 检查点                                                | 处理结果                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| 把 Windows 直发签名写成前置必需                       | 已按 AGENTS 说明未签名是项目选择，并保留 SmartScreen / SHA256SUMS / 安装测试条件 |
| 把 Store 签名推广到 MSI/EXE                           | 已明确只有相应 MSIX/AppX 路线由 Store 重新签名                                   |
| 把 MAS 与直发公证混为一谈                             | 已区分证书、打包、notarization 与 App Review                                     |
| 把路径持久化等同系统授权                              | 已说明 bookmark 与当前每次选择目录方案                                           |
| 把 required-reason API 的移动平台措辞推广到所有 macOS | 已注明官方页面列出的范围，并将现有 privacy manifest 写为项目事实                 |
| 把 WACK 当作当前 workflow 已完成的检查                | 已改为提交前应补的证据，没有声称已运行                                           |
| 把 build/上传/processing 当作上架                     | 已分别列出状态和所需证据                                                         |
| 把 SHA256SUMS 条目覆盖等同字节校验                    | 已解释两个脚本的不同职责，并保留原生验收边界                                     |
| 忽略扩展 ZIP 发布要求                                 | 主文档与 ImgConvert Skill 适配均已纳入，版本来自扩展 package                     |
| 对其他项目强加 ImgConvert 策略                        | 通用 Skill 与专用参考分开，平台资料按需读取                                      |
| 文档请求意外触发实际发布                              | Skill 区分文档、review、build-only、上传与发布，并延续已有授权                   |
| Skill 依赖本机绝对路径                                | Skill 内使用相对参考；项目适配使用仓库根相对路径，可随目录复制                   |

## 已执行验证

- 官方资料：核对 Microsoft Learn、Apple Developer、Canonical/Snap 官方页面；引用在手册相应论述旁，渠道参考保留查询入口与日期。
- Skill 结构：系统 `skill-creator/scripts/quick_validate.py` 验证通过。
- 格式：对新增手册、审查报告、Skill 与参考文件执行 Prettier 校验。
- 引用：检查新增 Markdown 的本地文件链接、Skill 参考链接及 `pnpm run` 命令是否存在。
- 行为复现：临时目录调用真实完整性检查函数，复现 MSI 数量冲突与扩展版本漏检；真实 timeout + 工作流条件复现 Snap 假成功。临时文件完成后已清理。
- Skill 场景走查：以“仅文档”“MAS 本地预检缺签名材料”“MSIX 版本未知”“Snap timeout”“缺平台包的 GitHub 发布”“非 ImgConvert 项目”检查分流、权限边界和证据要求。此项是同一代理的手工走查，不宣称独立代理评测通过。

文档变更没有修改产品代码，无需为文字改动重跑全平台构建。上述验证不覆盖真实 DMG/MSIX/Snap 安装、当前 Apple/Microsoft/Canonical 账户状态、商店认证、当前 tag 的 CI 结果或公证；本次没有触发这些外部操作。

## 后续维护

发布流程修复后重跑对应失败场景，把本报告的待修项更新为包含 commit/run/候选哈希的记录。平台规则变更时更新渠道参考与主文档中的相关段落；不要只更新核对日期。新踩坑应记录“触发条件、根因、修复、验证和适用范围”，避免把一次 workaround 变成所有项目的永久规定。
