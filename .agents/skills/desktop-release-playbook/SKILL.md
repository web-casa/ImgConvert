---
name: desktop-release-playbook
description: Build, troubleshoot, and review cross-platform desktop release candidates for GitHub direct downloads, Microsoft Store MSIX, Mac App Store, and Snap Store. Use for packaging, signing, sandbox permissions, installer validation, store submission readiness, and release evidence; not for unrelated web or mobile releases.
---

# Desktop release playbook

把交付单位定义为源码 × 系统 × 架构 × 渠道；用最终安装件的证据判断完成程度。此 Skill 适用于桌面软件；ImgConvert 专有策略只在确认该仓库后启用。

## 先确定当前任务

读取适用的 `AGENTS.md`、工作区状态、已有 packaging/CI 配置和脚本。识别用户要的是经验文档、排障、review、本地候选、上传还是公开发布，延续已有授权。若只要求文档或 review，不要触发发布。

从现有信息推导产品、渠道、架构和版本；只有关键事实缺失且无法查询时才提问，并继续不依赖答案的工作。检查目标 tag 本身的工具定义，不把当前工作区或 main 的能力当成旧 tag 已具备。

按任务读取，不要一次加载所有资料：

- Microsoft Store/MSIX：读 [references/windows.md](references/windows.md)。
- macOS 直发/MAS：读 [references/macos.md](references/macos.md)。
- Snapcraft/Snap Store：读 [references/snap.md](references/snap.md)。
- 确认是 ImgConvert：另读 [references/imgconvert.md](references/imgconvert.md)，复用仓库脚本。

平台规则和 SDK 会变化。涉及提交条件、证书、权限、版本规则或陌生 CLI，查询当前官方资料与本机 `--help`；记录核对日期。若无法访问官方资料，明确哪些要求尚未核实，不补造接口或宣称满足最新要求。

## 执行与验收

1. 建立本任务所需的产物矩阵，包含语言变体和包内部身份；不擅自增加用户未要求的渠道。
2. 记录 app commit、工具 commit、工具链、锁文件、feature 和渠道配置。保护用户未提交改动；必要时使用独立 worktree/输出目录，不清理无关文件。
3. 复用现有命令。先读实现再执行，尤其是名含 `prepare`、`validate`、`release` 的脚本；名称不能证明无副作用。语法不明确时先查 help，不猜 flags。
4. 构建后检查最终包内部版本、架构、依赖、能力声明、签名和资源。native codec 也要检查，不只检查主程序。原生 runner 的结果与交叉编译预检分开记录。
5. 对确切候选进行干净安装、实际业务结果校验、GUI/权限、重启授权、旧版升级和卸载验证。按改动范围复用已有测试；文档变更只做相应验证，不默认重建全部平台。
6. 转换等有限任务必须有明确成功退出及结果证据。超时不当作成功；长期 GUI 启动探测即使按时间结束，也只能报告启动层覆盖。
7. 签名、staple、压缩、重打包等最终处理后重新计算哈希。验证候选未变；测试签名只操作临时副本。原包变化后使相关旧证据失效。
8. 上传、商店处理、审核与公开分发分别记录。发布前核对全部所需证据与授权；缺项时完成其余可做工作，保留草稿并报告具体阻塞。

任一实际失败必须可观察。基础设施问题使用有上限的重试；公证/商店 pending 记录任务 ID 和原始哈希后等待后续查询，不反复上传或移动 tag。已存在同名远端产物时，先核对来源、字节与现有状态；不能自动覆盖解决冲突。

## 信任、权限与更新边界

- SHA-256 验证字节一致性，不提供发布者身份保证；来源、数字签名和安装测试各自有作用。
- 系统签名、公证、Store 签名、updater 签名和测试自签证书不是可互换的东西。
- 保存路径不等于保留 OS 授权；输入文件授权不等于输出目录授权。测试允许、拒绝、取消和重启。
- 商店功能开关要在后端/编译和能力注册中生效，不能只隐藏 UI。MSIX/MAS/Snap 的更新路线按渠道分别确认。
- 权限、隐私表单、真实截图和商店描述对应实际二进制；不复用无关能力说明或 required-reason code。
- 凭据只经既有秘密管理机制使用，不输出私钥、不把凭据写入报告/仓库，不用真实用户文件作公开测试资产。

## Review 方式

从已完成产物反向核对声明：文档命令是否真实存在，门禁是否检查最终字节，测试是否运行到所声称的层级，官方规则是否被误写成项目选择，历史经验是否被当作当前上架状态。

重点检查：多语言/多架构数量、版本映射、原件污染、超时被吞、未测被写成 passed、旧 tag 配新代码、不同渠道 updater 混入，以及缺少实机权限证据。对能局部复现的问题在临时目录重现，不执行真实发布作为测试。

报告按严重性给出文件位置、触发条件、影响、证据、建议和是否已修复。用户仅要求 review 时报告实现缺口；用户授权修复时完成相关修复及测试，不顺带重构无关业务。没有复现的结论标为静态分析或待验证。

## 交付记录

按任务需要提供文档/候选产物链接，附一张证据表：渠道、架构、源码、文件/哈希、检查项、结果、报告位置、外部状态、缺项。结果仅用通过、失败、未执行、不适用；为后两者说明原因。

用户已有发布授权时不要重复索取；没有授权时先准备具体可审阅候选，再确认剩余外部动作。不能把“文档已完成”“结构预检通过”“包已上传”描述成软件已发布或商店已批准。
