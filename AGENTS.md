# ImgConvert agent instructions

## GitHub Release 发布完整性

- 以后准备公开 GitHub Release 时，必须在同一个 Release 草稿中集齐三个桌面系统的正式直发包，不得默认只发布 Linux。
- 必需平台与架构：Linux `amd64`/`arm64`、macOS `x64`/`arm64`、Windows `x64`/`arm64`。
- Linux 必须包含经过验证的 `.deb`、`.rpm`、AppImage；macOS 必须包含已签名、Apple 公证并 staple 验证的 DMG；Windows 必须包含未签名但经过安装 smoke 验证并纳入 `SHA256SUMS` 的 MSI/NSIS EXE，同时在发布说明中明确提示 SmartScreen 风险。
- Windows GitHub 直发包不做 Authenticode 签名；Windows 的受信任签名分发仅依靠 Microsoft Store 对已接受 MSIX 的签名能力。商店包（Mac App Store PKG、Microsoft Store MSIX）属于独立渠道，不能代替 GitHub Release 的直发包。
- 在全部平台产物、各渠道所需签名/公证、安装/运行 smoke、来源校验和合并后的 `SHA256SUMS` 完成前，Release 必须保持 draft，不能公开发布。
- 如果缺少 macOS/Updater 所需证书或密钥、账号权限、runner 或发布 finalizer，必须把 Release 保持为 draft 并明确报告阻塞项；Windows 直发包不需要签名证书。除非用户明确批准某个平台例外，否则不得发布不完整 Release。
