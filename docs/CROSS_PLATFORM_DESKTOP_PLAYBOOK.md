<!-- SPDX-License-Identifier: Apache-2.0 -->

# 跨平台桌面软件构建与发布心得：ImgConvert 实战手册

核对日期：2026-09-05。适用背景：ImgConvert 的 Tauri 2、Svelte、Rust 与原生图片编解码依赖。经验也可用于其他桌面框架，但仓库命令、渠道策略和具体版本不能直接照搬。

这份文档基于当前工作区中的配置、脚本、开发记录和官方资料，**不是某个版本已经通过审核或完成发布的证明**。工作区存在尚未提交的发布改动；执行发布时必须重新核对目标 tag 中实际包含的流程。配套 [Skill](../.agents/skills/desktop-release-playbook/SKILL.md) 用于以后执行构建、排障和发布检查；[审查报告](CROSS_PLATFORM_DESKTOP_REVIEW.md) 记录本次发现和验证边界。

文中区分三种依据：**平台规则**来自官方要求；**项目约定**来自本仓库；**工程建议**是根据实践归纳的方法。历史记录发生变化时，以当前授权、根目录 [AGENTS.md](../AGENTS.md) 和待发布源码为准。

## 1. 最大的心得：把“渠道”当作构建维度

跨平台桌面开发的交付单位不是一个可执行文件，而是“源码版本 × 操作系统 × 架构 × 分发渠道 × 权限配置”的组合。开发模式能运行，只验证了其中很小的一部分。

| 渠道                 | ImgConvert 产物与架构                              | 信任与权限边界                                                                   | 更新路径                                                            |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| GitHub / Linux       | amd64、arm64，各自 DEB、RPM、AppImage              | 检查包结构、动态库、安装和运行；合并校验和                                       | 包管理器/手动安装；已实现的 AppImage updater 独立验收               |
| GitHub / macOS       | x64、arm64，各自 DMG                               | Developer ID 签名、公证、staple、Gatekeeper 验证                                 | 以当前 [UPDATER.md](UPDATER.md) 为准，不能因 Tauri 支持就宣称已启用 |
| GitHub / Windows     | x64、arm64，各自 MSI 和 NSIS EXE；MSI 配置含中英文 | **项目选择不做 Authenticode 签名**；安装 smoke、SHA256SUMS、SmartScreen 提示必需 | 当前直发渠道实现，不借用 Store 的更新机制                           |
| Microsoft Store      | x64、arm64 MSIX                                    | Partner Center 身份、受限能力说明；Store 对接受的 MSIX 签名                      | Microsoft Store                                                     |
| Mac App Store（MAS） | universal arm64 + x86_64 `.app`，封装签名 `.pkg`   | MAS 分发证书、profile、App Sandbox、隐私与审核                                   | Mac App Store                                                       |
| Snap Store           | amd64、arm64 `.snap`                               | 当前使用 core24、strict、GNOME extension、明确 interfaces                        | snapd / Snap Store                                                  |

这里的双架构和完整 GitHub 产物矩阵是项目约定，不是每家商店都要求所有软件支持这些架构。Snapcraft 是构建和发布工具，Snap Store 是分发渠道，snapd 是用户机器上的运行与更新服务。

**项目约定：**MAS、MSIX、Snap 构建关闭自带 updater 和宿主机外部 codec/helper 发现。实现入口包括 [build.rs](../src-tauri/build.rs)、[macOS 打包流程](../packaging/macos/README.md)、[Windows 打包流程](../packaging/windows/README.md)、[snapcraft.yaml](../snap/snapcraft.yaml)。禁用必须影响实际编译、注册和调用路径，仅隐藏设置按钮不够。

Microsoft Store 还支持 MSI/EXE 上架，但那条路线的签名和更新要求不同；不能把“Store 会签 MSIX”推广成“Store 会替所有安装器签名”。[Microsoft 分发路线说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path)

## 2. 开发阶段就要解决的事情

### 2.1 核心逻辑、操作系统适配、UI 分开

我们把图片转换核心放在 `crates/imgconvert-core`，文件授权、系统 HEIC、对话框等放在 `src-tauri` 适配层，UI 通过能力结果决定能展示什么。这样同一套转换测试可以复用，平台权限又有明确边界。

不要以扩展名列表代替运行时能力。macOS 的 ImageIO 和 Windows 的 WIC/系统扩展可用性不同；某台开发机能读 HEIC，不能推出所有 Windows 用户都能读。读取、写出、动画、多页、真无损和元数据支持也必须分别声明。

质量 100 不自动等于像素可逆无损；转换成功也不等于 ICC、透明度、EXIF 方向和文件时间都正确。用输出解码、像素或元数据断言验证承诺，不能只检查文件存在。相关依据：[ENGINE.md](ENGINE.md)、[RELEASE_QA.md](RELEASE_QA.md)。

### 2.2 文件路径不等于文件授权

界面保存了 `/Users/alice/Pictures`，只说明记住了一个字符串。还要分别考虑操作系统权限、沙箱授权、Tauri capability、授权生命周期、符号链接和目标文件状态。

工程建议：在后端收口授权与路径解析；导入、缩略图、预览、转换、结果打开都复用这个边界。写文件时防止输入被覆盖、目录逃逸和 symlink 跟随；取消或失败后不留下被当作成功结果的半文件。输出目录授权需要单独验证，不能由“输入可读”推断“同目录可写”。

### 2.3 同一个界面需要三种 WebView 的验收

Tauri 使用系统 WebView。浏览器中的 Playwright 测试不能替代 Windows WebView2、macOS WKWebView 和 Linux WebKitGTK 的桌面测试。[Tauri WebView 说明](https://v2.tauri.app/reference/webview-versions/)

至少覆盖文件选择和拖拽、剪贴板、键盘焦点、中英文首次启动、中文输入法、长路径和非 ASCII 文件名、缩放/高 DPI、深浅主题、减少动效、原生菜单与关闭窗口。设置写入失败需要有可见反馈；异步初始化和退出时保存不能靠开发机速度掩盖。

### 2.4 并行度受内存预算约束

一张 8,000 × 8,000 的 RGBA 图像，单份像素约 244 MiB。解码缓冲、颜色转换、缩放、预览和编码可能同时持有多份。CPU 有 16 核不代表适合同时处理 16 张大图。

在解码前限制字节数、像素和页数；把输入缓冲与中间图像计入预算。预览与批量转换在后端协调资源；“已发取消信号”不等于不可中断的原生编码器已经释放内存。性能报告必须包含架构、release/debug、输入、质量、线程数与内存，不能用 Linux 或 Rosetta 的结果代替原生 Apple Silicon/Windows arm64 结论。[项目资源验收](RELEASE_QA.md)

## 3. 构建与 CI：真正可复现的是过程和证据

### 3.1 固定来源，也记录工具来源

记录源码 tag 和 commit、Node/pnpm/Rust、SDK、runner 镜像、依赖锁文件、构建配置和 feature。锁文件只能锁定部分输入；系统包、SDK 和 runner 会变化。除非做过字节一致性验证，不要声称二进制可逐字节重现。

本项目的 tag 校验入口是 [verify-release-tag.mjs](../scripts/verify-release-tag.mjs)。不要为重试商店上传而随意新增稳定 tag；商店版本号与构建号有自己的推进规则。已公开 tag 不移动。若旧 tag 需要兼容性打包工具修复，像现有 MSIX 路线一样记录“应用 commit + 工具 commit”、限定允许变化的文件；不能把 main 上的新业务代码混进旧版本。

### 3.2 原生依赖决定跨编译的成本

Rust target 安装成功，不表示 C/C++/Objective-C 依赖、Windows SDK、Meson、NASM 和链接器都已齐备。优先用各平台的原生 runner 构建并运行；交叉编译只能证明它实际检查到的部分。

macOS universal 要检查主程序和打包依赖的架构。本项目曾为 `libdav1d-sys` 的 Meson 构建增加限定的 vendor overlay；相关入口是 [run-macos-universal-vendor-build.mjs](../scripts/run-macos-universal-vendor-build.mjs)。依赖升级后应重新验证补丁适用性，不能宽松替换任意源码，也不能让两份不同架构输出共用污染后的构建缓存。

### 3.3 Linux 兼容性要在打包后检查

本项目直发采用 Ubuntu 22.04 / GLIBC 2.35 基线；Snap 的 core24 是另一个封装环境，二者不矛盾。这是当前支持策略，不是所有 Linux 软件的通用基线。

检查每个打包 ELF 的架构、符号版本和动态库，而非只检查主程序。AppImage 也不是完全静态程序：我们曾因捆入 `libgcrypt.so.20` 与目标系统的 `libgpg-error` 组合产生符号冲突。修复应针对实际依赖证据，不能一股脑塞入系统库或一股脑删除库。

AppImage 重打包还曾把相对 symlink 变为构建机绝对路径。需要验证链接目标、desktop entry、图标、运行依赖和启动方式。容器缺 FUSE 时可使用已支持的解包运行方式，但仍要补用户实际桌面环境验收。[开发记录](DEVLOG.md)、[Linux 包检查器](../scripts/check-linux-bundle-artifacts.mjs)

### 3.4 缓存、异步任务和失败分类

缓存键区分 OS、架构、toolchain、锁文件及会影响输出的渠道配置；定期冷构建验证完整依赖。超时按基础设施、构建、测试分别记录。APT 故障可以有上限地重试；不能吞掉测试失败后继续发布。

公证属于异步服务任务。提交后保存 submission ID、文件 SHA-256、架构、源码/run ID 和凭据引用，释放 runner；完成器再取同一个候选包查询、staple、验收。不能把 `In Progress` 写为通过，也不能在产物已过期后随便重建一个文件复用旧回执。[CI_COSTS.md](CI_COSTS.md)、[公证脚本](../scripts/notarize-macos-dmg.mjs)

## 4. Microsoft Store：先确定 MSIX 这条路线

### 4.1 身份、版本、架构分开管理

从 Partner Center 获取包的 Identity Name、Publisher 和显示名，逐字匹配 manifest；产品显示名不是包身份。保留同一身份才能维护既有用户的升级关系。[Microsoft 包身份说明](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/package-identity-overview)

本项目 MSIX 使用四段数字版本，首段非零、末段为零；升级需对照该身份与目标设备已有的包。不要把 `0.3.1` 生搬成 Store 版本，也不要把示例 `1.0.0.0` 当作下一次必然可用值。[MSIX 包要求](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)

`ProcessorArchitecture` 必须与包内 PE 一致。x64 在 ARM Windows 上通过模拟运行，不足以证明 arm64 包正确。检查包内 EXE 和 DLL，保留两种架构各自的安装证据。

### 4.2 签名有三个完全不同的场景

| 场景               | 正确处理                                                      |
| ------------------ | ------------------------------------------------------------- |
| 上传 Store 的 MSIX | 无需采购公共 CA 代码签名证书；Store 对通过认证的包重新签名    |
| 本地侧载测试       | 使用符合侧载信任要求的测试签名；本项目只对临时副本签名并安装  |
| GitHub MSI/NSIS    | 本项目明确保持未签名，保留校验和、安装验收与 SmartScreen 提示 |

Store MSIX 的签名待遇不适用于 Store MSI/EXE 路线。[官方签名边界](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)

测试副本与正式上传件必须分开，测试前后核对正式文件哈希；临时证书信任、安装和清理也要受控。不能为了测试方便，把自签过的候选包或包含私钥的 PFX 当成正式交付物。[现有 MSIX smoke](../scripts/smoke-windows-msix.mjs)

### 4.3 不要发明打包工具命令

我们遇到过 `makeappx validate` 的误用。官方列出的子命令包含 `pack`、`unpack` 等；打包时会做语义校验，不能假设存在独立 `validate` 命令。项目目前采用 `pack → unpack → 复查 manifest / PE / 图片资产`；提交前还应补 Windows App Certification Kit（WACK）检查。[MakeAppx 官方命令](https://learn.microsoft.com/en-us/windows/win32/appxpkg/make-appx-package--makeappx-exe-)

解包检查和侧载 smoke 各有作用，都不等于 Store certification。WACK 与账户审核的实际结果需单独留存；当前仓库工作流不会自动创建 Partner Center submission。[Windows 流程](../packaging/windows/README.md)

### 4.4 `runFullTrust` 需要事实说明

本项目使用 full-trust desktop app 的 MSIX manifest。`runFullTrust` 是受限 capability，提交时需要说明用途；它不是请求管理员权限，也不是随意访问用户数据的理由。[Microsoft capability 文档](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations)

说明应对应真实功能：Rust 原生转换、用户选择的文件读写、桌面窗口；不要复制无关的后台服务或系统管理理由。权限字段、隐私页面、实际行为和审核说明要一致。[项目 Store 资料表](STORE_LISTING_4A.md)

### 4.5 “本地转换”不等于“从未联网”

当前 Windows 直发安装器使用 WebView2 `embedBootstrapper`。内嵌的是引导程序，缺少 Runtime 时仍需要从微软下载，不能据此承诺首次离线安装一定成功。应验证 Runtime 已安装、未安装、下载失败与受限网络等情况；若产品承诺离线安装，再选择相应离线分发策略。[WebView2 分发说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

MSIX 流程绕过 MSI/NSIS，不会自动继承安装器的 Runtime 安装逻辑，也需要自己的干净机器验证。转换不上传图片、应用更新联网、安装依赖下载和网站访问是不同事实，隐私与产品文案要写清楚。

## 5. Mac App Store：签名正确只是开始

### 5.1 直发与 MAS 的证书和检查路线不能混用

| 路线                | 本项目使用的证书/材料                                                       | 验收终点                                                          |
| ------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 直发 DMG            | Developer ID Application、notarytool 凭据                                   | 已签名、Accepted、公证票据 staple/validate、Gatekeeper 和实际启动 |
| MAS `.app` / `.pkg` | Apple Distribution、Mac Installer Distribution、匹配的 provisioning profile | 包验证、上传处理、指定构建、审核与商店安装                        |

MAS 本身有等效的安全检查，不需要再走直发软件的 notarization 流程；`notarytool` 用于公证，不用于提交 App Review。[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)、[Mac 软件封装说明](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)

检查最终包的证书 authority、Team ID、bundle ID、profile 有效期和 entitlements；不能只验证构建参数。签名后再修改 `.app` 内容需要重新签名；staple 后最终分发文件的 SHA-256 要重新计算。

### 5.2 沙箱授权是最容易在审核设备上暴露的问题

平台规则：MAS 应用要适当沙箱化，通过 MAS 更新，不得要求 root 提权或下载额外代码显著改变被审核的功能。[App Review Guidelines 2.4.5](https://developer.apple.com/app-store/review/guidelines/#hardware-compatibility)

本项目目前只保留 App Sandbox、用户选择文件读写和经过项目验证的 network client entitlement。后者用于 Tauri/WKWebView 的本地 IPC；不能因为这个案例就给所有离线 macOS 应用加网络权限。

曾踩过的坑是把 `tauri-plugin-persisted-scope` 保存的路径范围当成跨启动的系统授权。它不是 macOS security-scoped bookmark。当前产品采取每次启动重新选择输出目录的方案；若要长期记住访问权，需要完整实现 bookmark 创建、保存、解析、失效更新及 start/stop 生命周期，新增 entitlement 本身不会实现这些逻辑。[Apple 沙箱文件访问](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)

另一个历史坑是依赖 desktop dialog 实际未生效的 `fileAccessMode` 参数。因此涉及框架权限行为时，要查所用版本的实现和真实包行为。[项目 MAS 复测记录](MAS_APP_REVIEW_SUBMISSION.md)、[macOS 授权适配](../src-tauri/src/macos_security.rs)

### 5.3 三份“隐私材料”回答的是三个问题

| 材料                                     | 回答的问题                             | 常见错误                                         |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------ |
| Info.plist usage description             | 为什么此刻请求某项系统权限？           | 复制“需要访问您的文件”而不解释操作与范围         |
| `PrivacyInfo.xcprivacy`                  | 使用了哪些相关 API、数据和跟踪行为？   | 写在源码中却未进入最终包；复制别人的 reason code |
| App Store Connect App Privacy / 隐私政策 | 产品及第三方服务收集、使用了哪些数据？ | “无账号”直接推导“无数据收集”                     |

本项目把 `PrivacyInfo.xcprivacy` 放入最终 `.app/Contents/Resources/`，记录 File Timestamp 的 `3B52.1`，并由 artifact checker 检查。该理由必须随实际调用范围复审，尤其是缓存、设置文件和第三方依赖；这里是在记录项目做法，不是在把它定义为所有桌面应用的通用答案。

Apple 当前 required-reason API 文档的适用表述列出 iOS、iPadOS、tvOS、visionOS、watchOS；不能直接把该页面的强制提交措辞推广为全部 macOS 包的同一要求。MAS 仍需按自身审核反馈、数据行为及当前官方要求核对隐私资料。[Apple required-reason API 文档](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)

### 5.4 用干净账号验收真实交互

用确切签名候选包或对应 TestFlight build 验证首次启动、选择文件、拒绝授权、选择输出目录、转换、打开结果、退出和重启。拒绝某项权限后，普通本地转换应继续可用。相关媒体目录的权限提示是否出现、文案是什么，都记录 OS 版本和实际选择位置，不能凭名称推断。

隐藏的后端转换 smoke 验证不了原生选择器、TCC 提示和重启后授权。本项目的 [MAS_APP_REVIEW_SUBMISSION.md](MAS_APP_REVIEW_SUBMISSION.md) 提供了有范围的 TCC 复测步骤；不要清空整台机器所有应用的隐私授权。

### 5.5 上传、处理、审核、上架是不同状态

`.pkg` 验证通过后才上传；上传成功后等待处理，再选择构建、完成年龄分级、截图、隐私、出口合规、价格/区域和 Review Notes，提交审核并跟踪结果。记录 marketing version 与 `CFBundleVersion`，重传前查已处理记录。[Apple 上传构建](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)、[选择提交构建](https://developer.apple.com/help/app-store-connect/manage-builds/choose-a-build-to-submit)

截图使用实际 macOS 应用，不能用网页原型冒充。Notes 给审核员一条最短可重复测试路径，明确当前 HEIC 只读、无外部 helper、自带 updater 已禁用及重启后需重选输出目录。费用、协议、可用 SDK 和商店表单会变，正式提交当天重新核对，避免在脚本里长期写死。

## 6. Snapcraft / Snap Store：在 strict 环境里证明能用

### 6.1 base、grade、confinement、channel、revision 各有含义

| 字段                                               | 含义与边界                                                |
| -------------------------------------------------- | --------------------------------------------------------- |
| `base: core24`                                     | 当前构建/运行依赖基线；不等于只能在 Ubuntu 24.04 宿主运行 |
| `confinement: strict`                              | 使用受限 interfaces 的隔离模式                            |
| `grade: stable`                                    | 允许稳定发布的构建等级，不代表已经发到 stable             |
| `latest/edge`、`latest/candidate`、`latest/stable` | 渠道位置，指向某个可分发 revision                         |
| `version`                                          | 人类可读产品版本                                          |
| revision                                           | Store 分配的具体上传修订标识；不同架构应分别记录          |

修改 base 或 extension 前检查支持组合，不能只替换字符串。[Snapcraft 项目字段](https://documentation.ubuntu.com/snapcraft/latest/reference/project-file/snapcraft-yaml/)、[base 说明](https://documentation.ubuntu.com/snapcraft/latest/reference/bases/)

项目保持 strict，不用 `devmode` 或 classic 掩盖权限问题。classic、额外接口与自动连接有独立要求，应先评估实际功能和现有 portal 路径。[Snap confinement](https://documentation.ubuntu.com/security/security-features/privilege-restriction/snap-confinement/)

### 6.2 GNOME extension 解决运行时，也可能影响构建环境

本项目用 GNOME extension 提供 GTK/WebKit 运行环境和 portal 支持，但遇到其 `LD_LIBRARY_PATH` 污染 host-linked Rustup/Node 构建工具的问题。现有 custom lifecycle 在运行这些工具前清除该变量，固定 Rust/pnpm，并显式开启 `tauri/custom-protocol`；漏掉后者可能让生产应用仍寻找开发服务器。

清理作用在已证实有冲突的构建阶段，不应照搬为删除所有运行时库路径。extension 的实际展开结果和依赖组合需要跟随升级复核。[本项目 Snap 配置](../snap/snapcraft.yaml)

### 6.3 portal 的授权粒度决定交互设计

`home` 主要提供用户 home 内非隐藏文件的访问；`removable-media` 默认不自动连接。portal 可以授权用户明确选择的隐藏文件或外接盘文件，但对一个输入文件的访问，不自动授予创建兄弟输出文件的能力。[home interface](https://snapcraft.io/docs/reference/interfaces/home-interface/)、[removable-media](https://snapcraft.io/docs/reference/interfaces/removable-media-interface/)、[XDG Desktop Portals](https://snapcraft.io/docs/explanation/snap-development/xdg-desktop-portals/)

所以产品要提供明确的输出目录选择。分别测试未连接/已连接 removable-media、普通目录/隐藏目录/外接盘、取消选择和只读目录。通过 portal 得到的路径可能与用户看到的原始路径不同；不要自行还原路径后绕开授权。

### 6.4 `--dangerous` 与 `--devmode` 不是一回事

本地安装未由 Store assertion 验证的包会使用 `snap install --dangerous`；它不等于关闭 strict confinement。不能把 devmode 下可用写成 strict 验收通过。还应从 Store 测试渠道安装一次，覆盖实际分发与 refresh 链路。[Snap 安装模式](https://snapcraft.io/docs/explanation/snap-development/install-modes/)

本仓库构建和检查入口：

```bash
# 构建：需要合适的 Snapcraft 构建环境，不会上传商店。
snapcraft pack
# 只检查源码打包规则：不会构建或上传。
pnpm run release:snap:verify
```

产物检查需给 `release:snap:verify` 传入真实的 `--artifact=<路径>`，否则只完成源码规则检查。安装与 GUI 测试应在可恢复测试环境中进行。[Snap 操作说明](../snap/README.md)

### 6.5 先验证 revision，再提升渠道

工程建议：先 build-only，严格验收后上传 edge，安装验证，再把已测试的各架构 revision 提升到 candidate/stable。提升时不要无故重新构建；新构建有新哈希，需要重新验收。必要时使用渐进式发布，先核对 track、revision、架构和当前渠道位置。[Snap revision 与渠道管理](https://documentation.ubuntu.com/snapcraft/latest/how-to/publishing/manage-revisions-and-releases/)

本项目 workflow 的 `publish_snap=true` 会执行上传并发布到所选渠道，不是单纯保存候选包。凭据限制到指定 snap、必要 ACL 和渠道；不要把 export-login 文件提交入库。元数据单独更新也会改变公开商店页面。

**当前门禁：**[Snap workflow](../.github/workflows/snap-store-release.yml) 要求有限转换任务正常退出、成功记录与四种格式的非空输出，并保留 smoke 证据；超时和接口连接失败会阻止发布。接口连接成功仍不能替代可移动盘实际访问测试。历史问题与修复见 [修复复审](PROJECT_REVIEW_FIXES_2026-09-05.md)。

## 7. 已遇到的坑，如何变成防回归规则

以下历史问题来自 [DEVLOG.md](DEVLOG.md) 及当前实现，不表示本次重新跑过对应平台。

| 坑                                  | 根因                             | 可复用的预防措施                                                |
| ----------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| MSIX 用不存在的 `makeappx validate` | 凭名称推测 CLI                   | 读 SDK help 和官方命令；pack 后 unpack 检查，另跑安装与认证工具 |
| 侧载 smoke 改写正式 MSIX            | 签名步骤直接操作提交件           | 只签临时副本，原件前后哈希一致                                  |
| MAS 重启后输出目录失效              | 把持久化路径当系统授权           | 明确每次选择或完整实现 bookmark；测重启路径                     |
| 增加 entitlement 仍不修复权限       | 声明与运行时实现不匹配           | 对照具体调用与授权生命周期，检查最终签名权限                    |
| Snap 构建工具 libc 冲突             | extension 环境污染工具进程       | 限定阶段清理已确认的变量，固定并记录工具链                      |
| Snap 生产白屏/连接开发 URL          | 直接 Cargo 构建遗漏生产 protocol | 最终包启动验证，不只验证前端 dist 存在                          |
| AppImage 在目标系统符号错误         | 不兼容系统库组合被捆绑           | 多发行版包内运行，按依赖证据修正打包清单                        |
| AppImage 图标/入口指向构建机        | 重打包时 symlink 被改写          | 检查归档中的相对链接与 desktop entry                            |
| “通用架构”只检查主程序              | native codec 架构未覆盖          | 对每个 Mach-O/PE/ELF 做检查并原生运行                           |
| 公证完成时 artifact 已过期          | 处理时间与 CI 留存不匹配         | 保留确切文件与回执，失败可恢复，不盲目重提交                    |
| 首次中文启动失败                    | i18n 异步初始化竞争              | 新配置目录、明确 locale 的首次启动测试                          |
| 包测试绿了但版本不能发布            | 某些检查只验证结构或当前机器     | 证据写明检查层级、来源和缺项                                    |

本次另发现 Windows 两份本地化 MSI 与 finalizer 的“一份 MSI”假设冲突。维护产物矩阵时应把**语言变体**也纳入；不要靠删除中文包绕过。[审查详情](CROSS_PLATFORM_DESKTOP_REVIEW.md)

## 8. 更新、隐私、依赖与长期维护

安装、升级、卸载是三个独立功能。用旧版已安装状态验证新包升级、设置迁移、重启、卸载后程序移除和用户输出保留；测试失败重试和磁盘不足。直发切商店或商店切直发还要检查不同数据目录、重复安装和身份，不假设偏好自动共享。

Updater 的文件要在所有后处理完成后签名，manifest 的 URL、平台键、版本、签名必须对应最终字节。不能在签名后再 scrub AppImage。升级测试包含下载、验签、替换、重启及版本检查；只有静态 manifest 检查或下载成功不能证明整条更新链可用。[UPDATER.md](UPDATER.md)

回滚分为“停止继续分发”“重新指向旧 revision”“已升级用户的数据恢复”。旧二进制未必能读取迁移后的设置；商店也不一定允许用低版本替换用户的高版本。提前准备修复构建、分阶段 rollout 和可恢复迁移，不轻率承诺一键回滚。

审核第三方依赖要看最终 feature、动态/静态链接和包内实际内容。项目的 Apache-2.0 不能替代所有 codec、字体、图标和原生库的许可证；SPDX 的 `OR` 是选择，不能见到 GPL 字样就一律判定。记录许可文本和源码提供义务的实际适用情况，不能把开源许可证核验当作专利授权证明。ImgConvert 将外部 HEIC helper 与主商店包分离是项目策略，更多背景见 [LEGAL.md](LEGAL.md) 与 [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md)。

隐私声明要涵盖实际缓存、日志、文件路径、诊断、更新请求和第三方服务。截图和问题报告使用可公开样本，日志避免包含用户图片内容、完整敏感路径和凭据。账户、协议、签名证书有效期、Store 拒审原因及用户反馈也应进入发布记录，而不是只保留 CI 链接。

## 9. 建议的发布顺序与证据模板

1. **冻结产品与渠道范围。**确认版本、功能、支持架构、权限、更新路线和商店文案；修复与版本准备分开提交。
2. **做不产生发布副作用的预检。**核对脚本参数、工具链和已有质量检查，列出各渠道缺失证据。
3. **从明确源码构建候选。**按渠道使用独立配置和输出位置，检查包内版本、架构、依赖、签名与能力。
4. **验证实际安装件。**干净安装、真实转换、GUI 权限、旧版升级、卸载、异常和资源边界。
5. **收集外部处理结果。**公证必须 Accepted；Store 包记录上传、处理、审核、渠道可见状态，不把它们合并成“完成”。
6. **冻结最终产物并汇总校验和。**记录来源、最终哈希、测试报告及失败项；任何改变字节的操作都要使相关证据失效并重验。
7. **在已有授权范围内发布。**用户只要求文档、审查或 build-only 时止于对应成果；缺少实际发布授权时，先准备完整候选和缺项清单，再请求具体动作的确认。
8. **验证用户实际取得的版本。**检查下载字节、商店安装/更新、公开文案和链接，留存可恢复信息。

### 本项目的 GitHub 完整性门禁

根目录 [AGENTS.md](../AGENTS.md) 要求同一 Release 草稿包含 Linux 双架构三种包、macOS 双架构已签名/公证/staple 的 DMG、Windows 双架构未签名且安装验收通过的 MSI/NSIS，以及 **Chrome 和 Edge 两份扩展 ZIP**。扩展版本取发布 tag 中的 `browser-extension/package.json`，不从桌面 semver 推测。

缺少必需产物、凭据、原生 runner、finalizer 或 smoke 证据时保持 draft；商店 PKG/MSIX 不能替代直发包。只有用户明确批准该次发布的平台例外才可缩小范围。先前只发 Linux 的历史策略不再适用。

各 finalizer 按源码/run provenance 取件，并在共享的 per-tag 并发锁内附加与刷新校验和；最终 publisher 负责完整性检查后公开。手工上传不受这个锁天然保护，不能在发布校验期间并行修改草稿。

**现有检查的边界：**`verify-complete-github-release.mjs` 检查命名、数量、非空普通文件、校验和条目覆盖和说明文案，要求 Windows 各架构的 en-US/zh-CN MSI 与 NSIS，并核对扩展 ZIP 文件名及包内 manifest。调用时必须传入 `--extension-version=<目标 tag 中的扩展版本>`；publisher 从该 tag 的扩展 package 读取，不使用桌面版本代替。真正的字节哈希复算由 `refresh-github-release-checksums.mjs --verify` 完成。两者都不能替代原生安装、签名、公证和 GUI 验收，修复记录见 [复审](PROJECT_REVIEW_FIXES_2026-09-05.md)。

### 候选证据记录

2026-09-05 补充修复把“文件齐备”与“曾通过验证的确切字节”连接起来：

- Windows 上游与下游共用 WiX 语言/架构/安装包名称定义。AppImageHub 的 AppImage 和签名是明确列出的等摘要别名，不占用第二个架构位置；未知附件不能仅凭进入 SHA256SUMS 获得发布资格。
- finalizer 先验证旧清单，再追加新附件；回下载时旧字节、新字节和旧清单必须一致，才更新 SHA256SUMS。不能用先重算再验证来证明旧文件未变。
- 最终 publisher 使用 `verify-github-release-publication.mjs`，在全量哈希和附件清单校验之后，下载并复核六组独立 Actions evidence。证据来自对应验证工作流成功运行中的 artifact，Release 内的 receipt 只是定位入口。
- macOS 证据对应 staple 后的最终 DMG，并补充从该 DMG 安装副本的转换 smoke。公开前重新检查 Release 附件快照和远端 tag；任何缺证据、过期、失败或字节变化均保持 draft。
- 官网“可下载”必须有对应公开附件；源码合入与 ZIP 发布是两个状态。`docs/public-release.json` 驱动入口，发布前可执行 `node scripts/check-extension-availability.mjs --remote` 只读核对。

详见 [发布链补充修复与边界](PROJECT_REVIEW_RELEASE_FIXES_2026-09-05.md)。Actions artifact 的 90 天保留期与默认分支工作流的信任边界需一并记录；本地测试不能替代目标 tag 的原生构建和安装。

| 项目 | 必须记录的内容                                                          |
| ---- | ----------------------------------------------------------------------- |
| 来源 | tag、app commit、tooling commit（若不同）、工作区是否干净               |
| 构建 | OS、CPU、SDK/toolchain、渠道配置、workflow/run/attempt                  |
| 产物 | 文件名、实际包身份、内部版本、架构、最终 SHA-256                        |
| 信任 | 签名 authority、profile/public key 标识、公证 ID 与最终状态；不记录私钥 |
| 验收 | 安装/转换/GUI/权限/升级/卸载各自结果和报告位置                          |
| 商店 | 产品 ID、包版本/build/revision、提交 ID、目标渠道/地区、实际状态        |
| 缺项 | 未执行原因、负责人、下一步；不能记成 passed                             |
| 决策 | 允许进入哪一步、是否保持 draft、发布授权或该次例外依据                  |

状态建议使用“通过 / 失败 / 未执行 / 不适用”，并为“不适用”写出渠道理由。

## 10. 仓库检查入口与使用方式

以下是当前 `package.json` 已存在的预检入口，不会提交商店或公开 Release；执行前仍应核对目标 checkout 的脚本定义：

```bash
pnpm run release:readiness
pnpm run release:macos:check
pnpm run release:windows:check
pnpm run release:snap:verify
pnpm run ci:cost:check
```

这些预检通过，只能说明各自检查的规则通过。构建、平台安装、真实商店处理和发布完整性需要对应证据。后续操作入口：

| 任务                 | 阅读入口                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| 逐平台构建与账户准备 | [macOS](../packaging/macos/README.md)、[Windows](../packaging/windows/README.md)、[Snap](../snap/README.md) |
| 跨平台验收           | [RELEASE_QA.md](RELEASE_QA.md)                                                                              |
| MAS 权限与重审       | [MAS_APP_REVIEW_SUBMISSION.md](MAS_APP_REVIEW_SUBMISSION.md)                                                |
| 商店元数据事实       | [STORE_LISTING_4A.md](STORE_LISTING_4A.md)                                                                  |
| 自动更新             | [UPDATER.md](UPDATER.md)                                                                                    |
| CI 成本与留存        | [CI_COSTS.md](CI_COSTS.md)                                                                                  |
| 让代理按本手册工作   | [desktop-release-playbook Skill](../.agents/skills/desktop-release-playbook/SKILL.md)                       |

可用提示词：`使用 $desktop-release-playbook，检查当前 ImgConvert 的 MAS 候选发布准备情况，只做本地预检并列出实机和账户侧缺项。` 也可以指定 MSIX、Snap 或完整 GitHub Release。Skill 会按任务加载对应渠道参考，而不是默认触发所有发布流程。
