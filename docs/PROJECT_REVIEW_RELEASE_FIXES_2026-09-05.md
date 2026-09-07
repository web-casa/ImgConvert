<!-- SPDX-License-Identifier: Apache-2.0 -->

# 发布链补充审查：修复与验证记录

基线：HEAD `03b692f` 加本轮开始时的工作区。对应用户提供的独立审查和逐项评估，范围为 F1–F5 与四项 P3。本轮没有提交、推送、触发 Actions 或公开 Release。

上一轮 R1 只修正了 Windows 下游 finalizer，遗漏上游未签名检查的数量冲突；AppImage 双名称也未被测试样例覆盖。因此 [上一轮修复记录](PROJECT_REVIEW_FIXES_2026-09-05.md) 的“未发现新增阻塞项”不能作为发布链已验证的依据。

## 复核结论

F1–F5 的修复和其余三项 P3 处理已完成，并补上实际附件集合与故障注入回归。P3-2 保留为明确的平台限制，未将同扩展页面信任夸大为独立窗口认证。复核时也保留了标签页移动后的真实窗口检查，权限请求前仅做同步身份核对，避免丢失用户手势。

当前结论为“源码修复及本地门禁通过”，并非“已形成可公开 Release”。这些工作区改动需要进入新 tag，在对应原生 runner 完成构建、安装、公证及独立证据产出后，才可走最终发布入口。

## 修复结果

| 项目 | 改动 | 验收重点 |
| --- | --- | --- |
| F1 · P1 | `windows-release-assets.mjs` 从实际 WiX 配置读取语言列表；上游未签名检查与下游共用名称/架构校验，移除冲突的 2/3 常量 | 每架构两份本地化 MSI 和一份 NSIS；缺语言、错语言即使数量相同也失败；PowerShell 明确传播 CLI 失败 |
| F2 · P1 | `github-release-assets.mjs` 统一最终附件集合；AppImageHub 为明确的 updater 别名，原文件和别名及签名必须具有相同摘要 | 测试包含实际上传的两个 AppImage 名称及两份签名；不同摘要拒绝 |
| F3 · P2 | 四个追加 finalizer 共用 `append-github-release-assets.mjs` | 上传前验证旧 SHA256SUMS；回下载后验证旧文件、新文件及旧清单均未变化，才更新清单；旧附件永不 clobber |
| F4 · P2 | 六组最终字节证据分别保存在 Release 和独立 Actions artifact；publisher 重新验证工作流身份、成功状态、来源、artifact 与最终字节 | 替换 DMG 后重算 sums、伪造 Release receipt、失败/分支不符/过期/重复 artifact 均拒绝 |
| F5 · P2 | 更新公开版本记录为 v0.3.1，扩展 ZIP/源码 URL 保持空值；中英文 README 与官网显示尚未发布 | 两处官网 ZIP/源码入口都受记录控制；不回退到无 ZIP 的 latest 页面；支持只读远端核对 |
| P3 · 遗留代码 | 删除未接线的 `openOrFocusConverter` 及对应测试；保留旧 storage key 的清理函数 | 更新清理行为保持；没有新增 tabs 权限 |
| P3 · 窗口边界 | 保留同扩展、精确页面 URL、活跃租约校验；浏览器提供 `documentId` 时进一步绑定权限请求/释放 | **平台限制仍在**：原生侧边栏消息没有 `tab` 或 `documentId`，不能声称后台独立认证窗口；已增加真实双窗口回归 |
| P3 · 历史文档 | 调研与开发计划顶部说明 Chrome ≥116、仅 HTTPS 是当前基线 | 保留旧阶段记录，明确 Chrome 102、HTTP、独立标签页为已被取代的历史方案 |
| P3 · 额外附件 | 最终附件允许清单覆盖产品、AppImageHub 别名、updater 元数据/签名与六份证据 | 即使有正确 SHA256SUMS，未知 DEB/ZIP/DMG 也不能公开 |

## 证据的来源和信任边界

`release-evidence-<group>.json` 记录最终文件名、大小、SHA-256、release tag、源码 SHA、仓库、工作流 SHA、run ID 和 attempt。组包括 `linux`、`windows`、`macos-x64`、`macos-arm64`、`extensions`、`updater`。

证据创建步骤位于对应验证步骤之后，artifact 名为 `imgconvert-release-evidence-<group>-<attempt>`。只有该工作流完整成功，publisher 才接受它；在 Release 中同名写一份 JSON 并不能形成可信证据。publisher 从 GitHub Actions API 确认同仓库、默认分支、允许的 workflow path、成功状态和 attempt，检查工作流 SHA 属于默认分支历史，再下载唯一且未过期的 artifact，与 Release receipt 逐字节比较，最后检查安装包的实际摘要。

这沿用项目既有 GitHub Actions 来源验证机制。信任根为 GitHub 提供的运行记录与受审查的默认分支工作流；它不声称能抵御可任意修改默认分支和工作流的管理员。API 字段与下载接口依据 [GitHub Actions artifacts 文档](https://docs.github.com/en/rest/actions/artifacts) 和本机 `gh run download --help` 核对。

证据 artifact 保留 90 天。草稿超过保留期、artifact 被删除、对应 run 正在重跑或新 attempt 未成功，都会阻止公开；需要重新完成可信验证，不能手工补写 passed。该机制用于公开前验收，不是永久可离线验证的签名证明。

macOS 在 staple、Gatekeeper 和架构/签名验证后，从 DMG 复制应用到带空格和中文的临时安装目录，验证安装副本签名，并运行 JPEG/WebP/PNG/AVIF 有限转换 smoke。正常退出、成功记录和四份非空输出必须同时成立。DMG 本身保持只读，证据取自最终 DMG。x64 和 arm64 使用各自原生 runner。finalizer 校验目标 tag 的版本，不要求后续 main 的 package 版本仍等于旧候选版本。

## 原生侧边栏的验证边界

Chromium 149.0.7827.102 实测：原生 `SIDE_PANEL` 的 `runtime.getContexts()` 记录含文档标识，但 `windowId` 为 `-1`；其发送到后台的 MessageSender 只有扩展 ID、URL、origin，没有 `tab`、`documentId`。不能把此消息可靠映射到某个原生面板文档。在普通标签页加载同一个侧边栏 URL 的测试，会提供这些字段，因而掩盖差异。

本轮曾尝试通过 getContexts 绑定窗口，真实原生 smoke 揭示该方案不成立，最终实现已撤掉这个依赖。当前原生窗口号来自受信任的精确扩展页面调用 `windows.getCurrent()`；后台维持扩展 ID、精确页面 URL 和活跃随机 nonce 租约边界。有浏览器文档标识时，权限请求/释放额外匹配该标识。不会把“同主体一致性检查”写成独立的窗口授权保证，也不新增权限或提高最低浏览器版本。

因此原报告 P3-2 的观察成立，不能列作完全修复；它不构成网页攻击面。若后续必须防御已被控制的同扩展页面，需要重新设计浏览器可证明的会话通道。Chrome 的 [runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime) 将这些 sender 字段定义为可选；[sidePanel.onOpened](https://developer.chrome.com/docs/extensions/reference/api/sidePanel#event-onOpened) 从 Chrome 141 才可用，不能直接替代当前 Chrome ≥116 基线。

新增 `pnpm --dir browser-extension smoke:native:chrome` 使用真实 `sidePanel.open()` 在两个浏览器窗口打开原生面板，检查各自任务领取、权限租约登记和关闭清理，不再用同 URL 的普通标签页冒充原生身份测试。该命令在 Linux 上使用 `xvfb-run -a`。

## 更新清单与公开顺序

1. `release-updater.yml` 从 tag 构建、验证签名与运行 smoke，创建初始 draft。`gh release create --draft --verify-tag` 遇到已有 Release 就失败，不覆盖已有草稿或公开版。上传中断时保留草稿，并核查部分上传状态。
2. Linux、Windows、macOS 两个架构、扩展分别完成来源和产物验证，创建独立证据，然后通过共用追加脚本合并附件。
3. 追加脚本先检查旧清单和文件；只追加新名称；回下载并验证合并前后字节和附件身份连续性；最后更新 SHA256SUMS。
4. publisher 下载完整候选，校验全量哈希、明确的附件集合、扩展 manifest/tag 版本和 SmartScreen 提示，再复核全部 Actions 证据。
5. 公开前再次检查 Release ID、附件 ID/大小/时间/摘要、说明和远端 tag 对应的源码 SHA；远端状态变化则拒绝。

GitHub 多次 API 调用不是原子事务。per-tag 并发锁约束项目工作流，不能锁住管理员手工编辑；验证和公开期间不得并行手工改动草稿。失败必须保持 draft，不把检查失败当作重算旧文件摘要的理由。

## 可得性记录

`docs/public-release.json` 是 README 与官网的发布状态记录，扩展源码 URL 和两份 ZIP URL 独立于本地构建是否成功。当前公开版本为 [v0.3.1](https://github.com/web-casa/ImgConvert/releases/tag/v0.3.1)，没有扩展 ZIP；main 的扩展目录在 2026-09-05 核对时尚不存在。

`pnpm run docs:check` 检查本地声明一致性；`node scripts/check-extension-availability.mjs --remote` 只读核对最新公开版本、精确 ZIP 附件及不可变源码 URL。修改公开状态前执行后者。在线官网返回 403，本轮没有把本地网页构建当作线上部署成功。

## 本轮验证

| 验证 | 本轮结果 |
| --- | --- |
| 根目录测试 | 207 项通过，含真实临时文件/故障注入的完整 publisher、追加合并、证据篡改、AppImage 别名、Windows 实际 CLI 与 macOS smoke 适配器测试 |
| 共享包与 Web | contract 17、engine 74、runtime 23、Web 31、环境影响模型 11 项通过；官网检查和发布站点组装通过（22 文件、19 路由、125 个发布文件） |
| 扩展 | 最终 96 项单元测试及 5 项 Node 发布证据测试通过；Chrome/Edge 生产构建与 manifest/CSP/权限/体积门禁通过；两份 0.3.2 ZIP 均通过结构校验（各 26 文件） |
| 静态检查 | typecheck、lint、format、knip、UI i18n 通过；根前端生产构建通过 |
| 发布门禁 | release:platform:check、ci:cost:check、七个修改的工作流 actionlint、git diff --check 通过 |
| 公开状态 | `check-extension-availability.mjs --remote` 通过：v0.3.1，没有扩展 ZIP |
| 真实 Chromium 149 | 新鲜配置离线 8×4 转换矩阵通过、零远程请求；原生双窗口面板任务/租约/关闭清理通过；真实权限弹窗 Allow 后仅一次无凭据请求并回收权限，Deny 后零请求/无残留权限 |
| 文档站 | 类型、构建、i18n 通过；Fumadocs 的 webpack 动态 import 缓存分析有第三方警告，未导致构建失败 |

上述 Chromium 结果不是 Google Chrome/Edge 品牌浏览器或最低 Chrome 116 的验收证明。原生窗口 API 的缺口仍按上一节报告，不以全绿单元测试覆盖它。前端全链按阶段执行：中途发现类型/格式/fixture 接线问题后，修正并从受影响门禁继续；未把失败的早期运行标记为全绿。

本轮不修改 Rust 转换实现，也不把前轮 Rust 测试作为本轮新执行。Windows/macOS 安装、Apple 服务、公证/staple 和实际 Actions 上传/下载需在对应原生 runner 对包含这些改动的新 tag 执行。本地故障注入使用临时文件和命令/API 适配器，没有上传模拟产物。
