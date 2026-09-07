# macOS 直发 / Mac App Store

官方资料核对：2026-09-05；执行时复核证书、上传工具和 App Store Connect 当前要求。

## 两条路线

直发使用 Developer ID 签名，按产品分发方式封装后提交公证；Accepted 后对确切候选 staple、validate 并做 Gatekeeper/启动验收。不要用 MAS 证书替代 Developer ID。

MAS 使用匹配的分发证书、installer 证书、bundle/team identity 和 provisioning profile，构建 sandboxed app 与可提交的包。MAS 不需要额外走直发 notarization；公证通过也不是 App Review 通过。

保留最终包的签名 authority、Team ID、profile 有效期和 entitlements 检查。universal 不只检查主 EXE，也检查 native 依赖；两种架构分别保留实际运行结果。

## 沙箱与隐私

MAS 使用适当沙箱，通过 App Store 更新；核对额外代码、提权、后台运行等真实功能与审核规则。不要为排障无差别增加 network、全盘或 temporary exception 权限。

文件选择、书签、Tauri capability 和 OS 授权不是同一件事。需持续访问时实现 security-scoped bookmark 创建/解析/过期更新及 start/stop 生命周期；仅保存路径或声明 entitlement 都不够。项目采用每次重新选择目录也可以，但 UI、文档与测试应一致。

Info.plist purpose string、`PrivacyInfo.xcprivacy`、App Privacy 标签分别核对实际行为和最终封装位置。reason code 根据真实 API 调用选择，不能复制其他应用。Apple required-reason API 页面目前列出的平台范围没有直接包含 macOS，不把移动平台的提交措辞扩大为全部 MAS 的统一要求。

干净账户测试允许、拒绝、取消、输出目录、退出重启和普通功能继续可用。TCC 测试按特定服务和 bundle ID 重置；后端隐藏 smoke 不证明 GUI 权限流程可用。

## 公证与商店状态

公证提交保存 ID、候选文件哈希、架构、app/tooling commit 和 run ID。pending 不当成功；runner 结束后使用同一文件完成验证。产物过期、哈希变化或 source 不符时不能沿用旧证据。

MAS 记录 marketing version 与 `CFBundleVersion`，重传前查已处理构建。包验证、上传、processing、选择 build、年龄分级/隐私/出口合规、Review Notes、App Review 与商店分发分别确认。Review Notes 提供真实可重复步骤，截图必须展示实际应用。

## 官方入口

- [App Review Guidelines 2.4.5](https://developer.apple.com/app-store/review/guidelines/#hardware-compatibility)
- [公证](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Mac 分发封装](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [App Sandbox 文件访问](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
- [Required-reason API 范围与声明](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
- [上传构建](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
- [选择提交构建](https://developer.apple.com/help/app-store-connect/manage-builds/choose-a-build-to-submit)
