# Windows / Microsoft Store MSIX

官方资料核对：2026-09-05；执行真实提交前重新确认。以下以 MSIX 为主，不能直接套到 Store MSI/EXE 路线。

## 需要先查询的事实

- Partner Center 包 Identity Name、Publisher、显示名，已有包版本和目标架构。
- Win32 manifest 的实际 schema/namespace、入口点、受限 capabilities；`runFullTrust` 不等于管理员提权。
- WebView2 或其他原生 Runtime 的来源；MSIX 不自动继承 MSI/NSIS 的安装器逻辑。
- 项目是否有 MSIX 生成、解包、侧载和 WACK 流程；缺失项写明，不假装框架已提供。

四段 Store 包版本不能直接由 app semver 推测。针对当前 Windows Store 包规则检查首段非零、末段为零、范围和目标设备的升级顺序；身份和已有上传记录取自控制台，不编造下一版本。

## 构建与信任

使用 Windows SDK 的实际工具与文档支持的参数。MakeAppx 有 `pack`/`unpack` 等命令，打包包含语义校验，不存在可想当然调用的 `makeappx validate`。解包后校验身份、版本、PE 架构和 Store 图像资源；提交前保留适用的 WACK 结果。

Store 对认证通过的 MSIX/AppX 重新签名，因此这一路线不要求采购 CA 证书。侧载需要对应的测试信任链；对临时副本签名并核对正式原件哈希未变，记录安装/卸载和临时信任清理。不上传私钥或把测试副本冒充正式候选。

GitHub/官网 MSI、EXE 是否签名取决于该项目政策。Microsoft Store 的 MSI/EXE 路线不享有 MSIX 重新签名待遇，必须单独确认签名与更新要求。

MSI 语言变体和 NSIS 安装器数量分别统计。包内架构与 manifest 保持一致；ARM 设备运行 x64 模拟程序不能代替原生 arm64 验收。

## 用户路径和账户验收

- 清洁环境安装、菜单启动、实际转换/业务输出、设置持久化、同身份升级和卸载。
- WebView2 缺失/存在、网络不可达与安装失败；bootstrapper 不等于离线 Runtime。
- `runFullTrust` 用实际本地桌面功能解释，并核对 Partner Center 的 restricted capability 提交项。
- 真实截图、隐私 URL、年龄分级、地区和支持信息符合当前提交表单与功能。
- 区分本地打包、侧载成功、WACK 结果、submission 已创建、certification 和 Store 用户实际安装。

## 官方入口

- [MSIX 包要求、版本与签名](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [包身份](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/package-identity-overview)
- [MakeAppx](https://learn.microsoft.com/en-us/windows/win32/appxpkg/make-appx-package--makeappx-exe-)
- [Capabilities](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations)
- [Windows 分发路线](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path)
- [WebView2 分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
