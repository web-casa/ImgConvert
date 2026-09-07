# ImgConvert 专用适配

仅在确认是 ImgConvert 仓库时采用。所有下列路径均相对仓库根目录；不要把本文件中的版本策略硬编码到其他项目。

## 权威与范围

先读根目录 `AGENTS.md`，再读 `docs/CROSS_PLATFORM_DESKTOP_PLAYBOOK.md` 和本次相关的 `docs/CROSS_PLATFORM_DESKTOP_REVIEW.md`。旧 DEVLOG 的 Linux-only 发布策略、旧签名待办和旧 bookmark 描述不能覆盖当前约定。当前工作区可能含未提交流程，目标 tag 的内容需独立核对。

GitHub 正式发布必须同一草稿集齐：

- Linux amd64/arm64：各自 DEB、RPM、AppImage。
- macOS x64/arm64：各自 Developer ID 签名、公证 Accepted、staple 验证 DMG。
- Windows x64/arm64：MSI/NSIS EXE，按项目政策保持未签名；安装和转换 smoke、合并 SHA256SUMS、SmartScreen 提示。
- Chrome/Edge 两份扩展 ZIP，版本来自同 tag 的 `browser-extension/package.json`；`browser-extension-release-assets-finalize.yml` 构建并检查。

MSIX、MAS PKG 不能替代 GitHub 直发包。缺必需凭据、runner、finalizer、产物或证据时保持 draft；只采用用户对该次发布明确批准的平台例外。不要替项目采购/配置 Windows 直发 Authenticode。

## 复用入口

先核对 `package.json` 与脚本实现，再执行：

| 任务              | 入口                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| 当前本地准备状态  | `pnpm run release:readiness`；本地报告不等于远端发布状态                            |
| 平台配置预检      | `release:macos:check`、`release:windows:check`                                      |
| Snap 源码检查     | `release:snap:verify`；最终包需额外传 `--artifact=<实际路径>`                       |
| 完整质量/架构约束 | `docs/RELEASE_QA.md`、`release:platform:check`、`ci:cost:check`                     |
| Windows           | `packaging/windows/README.md` 与 `scripts/*windows*msix*.mjs`                       |
| macOS             | `packaging/macos/README.md`、`docs/MAS_APP_REVIEW_SUBMISSION.md`                    |
| Snap              | `snap/README.md`、`snap/snapcraft.yaml`、`.github/workflows/snap-store-release.yml` |
| 更新              | `docs/UPDATER.md` 与 `release:updater:*` 对应实际定义                               |

表中未带 `pnpm run` 的名称均为 package scripts，不是 shell 内建命令。不要给 release 类脚本统一附加臆测的 `--dry-run`。

## 容易误判的实现细节

MAS/MSIX/Snap 要以 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`、`IMGCONVERT_DISABLE_UPDATER=1` 的渠道配置构建；MAS 还通过现有 no-default-features 路线去除 updater 依赖和对应 capability 扫描。复用既有构建入口，不在任意已构建包上补环境变量假装禁用成功。

MAS 是 universal 包；GitHub 是各架构 DMG。MAS 当前没有持久 bookmark 实现，每次启动需重新选择输出目录。network client entitlement 来自本项目已验证的 Tauri/WKWebView IPC 需求，不能自动推广。

Snap 保持 core24/strict/GNOME extension 和现有构建环境修正。源码 checker 通过不等于 native 安装或 portal 实测通过。

`verify-complete-github-release.mjs` 校验命名/数量/覆盖与扩展 manifest，调用必须传 `--extension-version=<目标 tag 中的扩展 package 版本>`；Windows 每架构要求 en-US、zh-CN MSI 各一份与 NSIS 一份。哈希字节复算由 `refresh-github-release-checksums.mjs --verify` 完成；原生签名、安装等证据来自上游运行，不能只调用一个检查器就公开。

2026-09-05 修复：Snap 转换超时不再放行，并检查成功记录和输出；Windows finalizer 与完整性验证共用双语言矩阵；publisher 从目标 tag 读取扩展版本并验证 ZIP 内 manifest。历史问题见 `docs/CROSS_PLATFORM_DESKTOP_REVIEW.md`，修复与验证边界见 `docs/PROJECT_REVIEW_FIXES_2026-09-05.md`。发布前仍须确认目标 tag 已包含相应修复。

各附件工作流和 publisher 使用 per-tag 锁；人工并行改草稿不受它保护。只有 `github-release-publish.yml` 是项目约定的公开入口，但执行仍以当前授权和完整证据为前提。

后续审查补充：Windows 上游现在也调用共用安装器清单；`github-release-assets.mjs` 定义全部允许附件，包括等摘要 AppImageHub 别名及六组 evidence。四个追加 finalizer 共用 `append-github-release-assets.mjs`，必须先验证旧清单和字节，再上传、回下载比对并更新清单；updater 仅创建初始草稿，不覆盖已有 Release。

最终发布使用 `verify-github-release-publication.mjs`：除原有清单/哈希/扩展 manifest 外，还从可信、成功的 Actions run 下载独立 evidence artifact，与最终附件摘要核对；公开前复查附件快照和远端 tag 的源码 SHA。artifact 过期、run 未成功、来源不匹配或手工补写 receipt 都不能放行。macOS 证据生成于 staple 后和安装副本转换 smoke 之后。详见 `docs/PROJECT_REVIEW_RELEASE_FIXES_2026-09-05.md`。

公开下载声明来自 `docs/public-release.json`。源码目录存在于工作区不代表 main 已有源码，构建出 ZIP 不代表 Release 已有 ZIP。更新官网入口前用 `node scripts/check-extension-availability.mjs --remote` 核对对应渠道；当前记录中的空 URL 应保持禁用。

浏览器扩展 smoke 要区分普通标签页模拟布局和真实原生侧边栏；后者用 `pnpm --dir browser-extension smoke:native:chrome`（无显示器的 Linux 使用 xvfb-run）。Chromium 原生面板消息可能同时缺 tab/documentId，getContexts 的 windowId 也可能为 -1；不得臆造基于这些字段的窗口证明。
