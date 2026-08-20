<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.1 macOS 双渠道发布清单

`v0.2.1` 替代已经提前创建、但缺少后续 macOS 发布修复的 `v0.2.0` 标签。
禁止移动或复用旧标签；GitHub 直发和 Mac App Store 包必须从同一个不可变
`v0.2.1` 提交构建。

## 发布顺序

1. 统一 `package.json`、docs-site、Tauri 和 Cargo 版本为 `0.2.1`，完成全部质量门禁。
2. 在 `main` 创建并推送注释标签 `v0.2.1`；检查标签触发的 Linux Release。
3. 运行 `Updater Release`，以 `publish_release=true`、`draft_release=true` 创建
   GitHub Draft Release，并上传 Linux updater 资产。
4. 运行 `macOS DMG Release`，指定 `v0.2.1` 和 `publish_release=true`。等待 Apple
   公证完成后，由 `macOS Notarization Finalize` staple、Gatekeeper 验证并把 DMG
   附加到同一 Draft Release。
5. 运行 `macOS MAS Release`，先保持 `upload_build=false`。该流程从标签构建
   sandboxed `.app`、Installer-signed `.pkg`，保存 14 天 artifact，并调用 App Store
   Connect 验证。
6. 只有第 5 步验证通过且 App Store Connect 的 `com.ivmm.imgconvert` app 记录已就绪，
   才以 `upload_build=true` 上传同一标签的新构建。
7. 人工检查 GitHub Draft 的资产和说明后公开 Release；在 App Store Connect 等待构建
   处理，选择构建并填写截图、隐私、年龄分级、价格/区域和审核信息，再提交 App Review。

## 安全边界

- GitHub DMG 只接受 Developer ID 签名、Apple `Accepted`、staple 和 Gatekeeper 验证后的
  artifact；Smoke 产物不能作为正式标签资产。
- MAS 包强制 App Sandbox、用户选择文件读写、app-scoped bookmark、禁用外部 codec/helper
  和 Tauri updater。
- `upload_build` 默认关闭，因为 App Store Connect 的构建号上传后不能覆盖；验证失败时不得
  通过修改或移动标签重试，应修复后发布新的补丁版本。
- GitHub Release 在所有承诺资产复核前保持 Draft；工作流不得替用户点击 App Review 提交。
