<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.0 双渠道发布契约

> 已由 [`RELEASE_V0.2.1.md`](./RELEASE_V0.2.1.md) 取代。远端 `v0.2.0` 标签早于最终
> macOS MAS/provisioning 与异步公证修复，因此保留标签但不发布、不移动；以下内容仅作为
> 原始发布设计记录。

> 状态：发布方案及仓库内自动化已完成；这不是“已发布”声明。当前公开
> Release 仍为 Linux-only 的 `v0.1.2`。只有 tag、签名/公证、资产验收和账户负责人
> 的外部步骤全部完成后，才能将本文件描述的 `v0.2.0` 标为已发布。

## 1. 目标与边界

`v0.2.0` 从同一个不可变 Git tag 构建，但保留两个互不混用的交付渠道：

| 渠道 | 面向用户的交付物 | 版本/身份来源 | 更新责任 | 不做什么 |
| --- | --- | --- | --- | --- |
| GitHub 直发 macOS | 已 Developer ID 签名、Apple notarization 公证并 staple 的 arm64 `.dmg` | `v0.2.0` tag 与应用 `0.2.0` | 用户从 GitHub Release 手动下载；v0.2.0 不启用 macOS Tauri updater | 不上传 unsigned DMG，不从 `main` 构建，不提供 GitHub 直发 MSIX |
| Microsoft Store Windows | x64 Store submission `.msix` | 同一 `v0.2.0` tag；Partner Center 分配的四段 Store package version 与已提交 identity | Microsoft Store | 不把 MSIX 附到 GitHub Release，不启用 Tauri updater，不打包外部 codec/helper |

首个 macOS 直发目标为 Apple Silicon（`arm64`）。工作流固定使用免费的 public
`macos-15` GitHub-hosted runner；Intel/universal DMG 不是本次 v0.2.0 的承诺，必须在
另行验证工具链、签名和真实设备后再扩展。

同一 tag 只保证源代码快照相同，不表示包可互换：macOS DMG 使用 Apple Developer ID
信任链，Store MSIX 使用 Partner Center identity 并由 Microsoft Store 交付/签名。Store
包绝不能作为 GitHub 直发包复用。

## 2. 不可变快照与版本规则

发布负责人必须先把以下应用版本字段统一为 `0.2.0`，再创建带注释 tag `v0.2.0`：

- 根 `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml` 与由 Cargo 刷新的 lockfile
- docs-site package metadata 与生成的第三方许可清单

工作流在 checkout 后必须验证：

1. 输入只接受 `v<major>.<minor>.<patch>` 形式的 tag；
2. 输入 tag 恰好等于上述列出的版本字段（含 Cargo lockfile）的 `v${version}`；
3. 本地 `HEAD` 正是该 Git tag 指向的 commit。

这样可以阻止从分支、移动 ref 或版本字段不一致的快照构建。文档站当前展示的
`v0.1.2` 安装链接是已发布历史，只有 v0.2.0 GitHub Release 真正公开后才更新为新的
公开下载链接，避免 Pages 在资产不存在时提前给出失效链接。

Microsoft Store 的四段 package version 不是应用 semver 的镜像。账户负责人必须在
Partner Center 中确认它高于该 identity 已有的任何版本；当前 `1.0.0.0` 仅可作为尚无
历史提交时的候选值，第四段必须为 `0`。

## 3. GitHub 直发 macOS DMG

新增的手动 `macOS DMG Release` 工作流必须满足下列顺序：

1. checkout 指定 `tag`，执行版本/tag 校验；
2. 在 `macos-15` arm64 runner 上完成现有类型、Rust、平台 guardrail 和 DMG 构建检查；
3. 导入 Developer ID Application 证书，构建签名 DMG；
4. 用 `notarytool submit` 上传后轮询到 `Accepted`，staple DMG，并用 Gatekeeper 与
   `check-macos-bundle-artifacts --require-signed --require-notarized` 验收；
5. 将已验收 DMG 保留为 Actions artifact；仅在显式 `publish_release=true` 时，才把它
   附加到**已经存在**的同 tag GitHub Release。

工作流不创建 Release，也不改变现有 Release 的 draft/published 状态。发布负责人先用
已有的 Linux updater 发布入口创建/补全 draft Release，再以 `publish_release=true` 运行
macOS 工作流。上传步骤必须先查询目标 Release 是否存在，并使用不带 `--clobber` 的
`gh release upload`，不允许静默覆盖同名资产。
这避免 macOS 任务单独发布半成品或改写已审阅资产。

所需 GitHub Secrets：

- `APPLE_DIRECT_CERTIFICATE`、`APPLE_DIRECT_CERTIFICATE_PASSWORD`、`KEYCHAIN_PASSWORD`
- 二选一的 notarization 凭据：
  - `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`；或
  - `APPLE_API_KEY`、`APPLE_API_ISSUER`、`APPLE_API_KEY_BASE64`
- 可选的 `IMGCONVERT_DIRECT_SIGNING_IDENTITY` 与 `APPLE_PROVIDER_SHORT_NAME`

缺任何必需凭据都必须明确失败，不能退化为 unsigned 发布。签名、notarization、staple
和 Gatekeeper 通过不替代后续人工 GUI 验收；用户选择文件/输出目录的 security-scoped
access 与真实 HEIC 输入仍需要在目标机器上确认。

## 4. Microsoft Store MSIX

`Windows Store MSIX` 仍是手动工作流，但增加必填 `release_tag`，以指定 tag checkout
并执行同一版本/tag 校验。它只会：

1. 在免费的 public `windows-latest` x64 runner 构建该 tag；
2. 在编译和打包全过程设置：

   ```text
   IMGCONVERT_DISABLE_EXTERNAL_CODECS=1
   IMGCONVERT_DISABLE_UPDATER=1
   ```

3. 以已提交的 Partner Center identity 生成原始 submission MSIX；
4. 对临时副本做自签名 sideload install/conversion smoke，并验证原始 submission
   artifact 的 SHA-256 未被改写；
5. 将原始 MSIX 作为 14 天 Actions artifact 上传。

该工作流不得创建 Partner Center submission、上传包、设置市场/价格、填写 IARC 或点击
发布。账户负责人须下载 artifact，在 Partner Center 使用当日导出的 CSV、实际中英文截图、
隐私政策 URL 和 `runFullTrust` 事实说明完成提交。详见
[`STORE_LISTING_4A.md`](./STORE_LISTING_4A.md)。

Store build 永远禁用 Tauri updater 和外部 codec/helper；这个约束适用于 release、smoke
和未来对工作流的任何修改。不要更改 Flatpak app-id
`io.github.yeagoo.imgconvert`。

## 5. v0.2.0 操作顺序

1. 在 `main` 上完成质量门禁、建立统一的 `0.2.0` 版本提交并推送；不修改现有
   `v0.1.2` tag。
2. 创建并推送注释 tag `v0.2.0`。tag push 触发现有 Linux release build；每个 tag job
   先校验 tag/version 再构建。先检查它的 Actions artifacts 与包 smoke。
3. 运行 `Updater Release`：指定 `v0.2.0`，在签名资产验证后以
   `publish_release=true`、`draft_release=true` 创建/补全 GitHub draft Release。
4. 运行 `macOS DMG Release`：指定 `v0.2.0`，仅在第 3 步的 draft 已存在时启用
   `publish_release=true`。复核 Release 中的 DMG、Linux 资产、checksums、签名和
   notarization logs，再由发布负责人从 GitHub 发布 draft。
5. 运行 `Windows Store MSIX`：指定 `release_tag=v0.2.0` 与经 Partner Center 确认的
   `store_version`，下载未改写的 MSIX artifact；由账户负责人完成 Store 外部提交。
6. 最后更新 docs-site 的“当前版本”与安装下载链接，并验证公开 Release/Store 页面。

任何一步失败都不移动 tag、不替换已发布资产，也不把未签名或未公证的文件当作可下载
发布物。重新构建前先定位失败原因并创建新的补丁版本；已发布 tag 不是可重建的可变输入。

## 6. 自动化外的必需确认

- Apple Developer Program / Developer ID 与 notarization 账户可用，且证书及 app-specific
  password 或 API key 已由授权负责人安全配置为 GitHub Secrets。
- Partner Center 账户可以访问既有 identity；package version、CSV、市场、价格、IARC、
  `runFullTrust` 说明和中英文截图均由账户负责人在提交日复核。
- GitHub Release draft 中的资产名称、checksum、签名、公证记录和最终 release notes 经人工
  复核后才公开。

这些是账户/平台决策，不由仓库自动化代替或绕过。
