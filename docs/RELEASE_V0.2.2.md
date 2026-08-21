<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.2 Mac App Store 修复发布清单

`v0.2.2` 是 `v0.2.1` 的不可变后续版本，用于修复 App Store Connect 首次验证发现的
arm64 最低系统版本与 512pt@2x 图标要求。禁止移动或复用 `v0.2.1` 标签。

## 修复与验证

1. MAS arm64 包的 `minimumSystemVersion` 固定为 macOS 12.0；GitHub 直发 DMG 的系统
   要求不随之改变。
2. `icon.icns` 必须包含 `ic10` 块，即 1024×1024 的 512pt@2x 图标资源。
3. `release:macos:store:check` 在构建前验证上述两项要求，避免将相同错误推迟到 Apple
   上传验证阶段。
4. 五处发布版本字段必须统一为 `0.2.2`，且 `v0.2.2` 标签必须指向 `main` 上的同一
   已审核提交。

## 发布顺序

1. 完成本地质量门禁、测试与代码审核。
2. 提交并推送 `main`，创建并推送注释标签 `v0.2.2`；监控标签触发的 Linux Release
   构建。该工作流只保存 artifact，不自动公开 GitHub Release。
3. 运行 `macOS MAS Release`，指定 `tag=v0.2.2` 与 `upload_build=true`；工作流先验证
   `.pkg`，通过后再上传 App Store Connect。
4. App Store Connect 处理完成后，在 macOS App 版本 `0.2.2` 中选择该构建，再提交
   App Review。

GitHub 的公开稳定版本在 DMG、Windows 和 Linux 资产齐全前仍保持为 `v0.2.1`，不得
提前把 README 改成 `v0.2.2`。
