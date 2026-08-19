<!-- SPDX-License-Identifier: Apache-2.0 -->

# Phase 4a — Microsoft Store listing 与隐私政策准备包

> 状态：**公开隐私页已部署，文案与隐私事实已确认，未提交 Partner Center**。本文件收集
> 已核实的工程事实、已确认的 Store 输入文案与仍由账户负责人完成的提交动作；它不是
> Partner Center 导出的 CSV，也不代表已经提交或认证。

## 1. 范围与不变量

- 目标渠道是 Microsoft Store 的 Windows MSIX 提交，不改变第一期 GitHub Release
  的发布范围。
- Store 构建继续强制 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` 和
  `IMGCONVERT_DISABLE_UPDATER=1`；更新由 Microsoft Store 交付。
- 不修改 Flatpak app-id `io.github.yeagoo.imgconvert`，不为本阶段新增付费或私有
  GitHub Actions runner。
- MSIX manifest 当前仅声明 `en-US` 资源；本阶段通过 Partner Center 提供 `en-US`
  和 `zh-CN` listing，**不**引入 MSIX MRT 包内本地化。
- 不提交外部 HEIC helper：Store 版仅在系统提供 WIC/HEIF/HEVC 能力时读取 HEIC，
  不输出 HEIC，也不得宣传为“开箱即用 HEIC”。

## 2. 已核实的素材与事实

| 项目 | 已核实来源 | 4a 使用边界 |
| --- | --- | --- |
| 产品名 | `AppxManifest.xml.template`、`package.json` | `ImgConvert`；是否存在其他保留名称由 Partner Center 确认。 |
| 应用语言 | `src/lib/i18n/` | UI 支持 `zh-CN` / `en-US`；Store listing 准备两种语言。 |
| Store 包资源 | `packaging/windows/msix/AppxManifest.xml.template` | 仅 `en-US`，保持不变。 |
| 核心格式 | `README.md`、capabilities 实现 | JPEG、PNG、WebP、AVIF 的本机批量转换；不要承诺 TIFF/JXL 或 HEIC 输出。 |
| HEIC 边界 | `PRIVACY.md`、`docs/LEGAL.md`、Windows packaging 文档 | Windows 系统 WIC 的可选、仅解码能力；依赖 HEIF/HEVC 扩展可用性。 |
| 本地处理/无遥测声明 | `PRIVACY.md`、发布负责人确认 | 图片和路径可为用户主动操作而在本机读取，但不会上传、收集或向第三方传输；用户选择的输出目录和 HEIC helper 路径可保存在本机设置中；无遥测或第三方网络服务。 |
| 许可证 | `LICENSE`、`src-tauri/tauri.conf.json` | Apache-2.0；适用许可条款的最终呈现由发布责任人确认。 |
| 公开隐私页 | [Publish Privacy Policy run 32222596177](https://github.com/web-casa/ImgConvert/actions/runs/32222596177) | GitHub Pages 已于 2026-08-19 以 GitHub Actions source 部署；`https://web-casa.github.io/ImgConvert/privacy/` 已验证 HTTPS 200、`#en` / `#zh-CN` 双语锚点及 Issues 链接。 |
| 当前截图 | `packaging/flatpak/screenshots/main.png` | 1440×1000 的中文网页预览，仅作构图参考；不是 Windows Store/MSIX 实机截图，不能直接当作已验收资产。 |
| 当前图标 | `src-tauri/icons/` | 有 MSIX 所需图标；Partner Center 的 listing logo 仍需以当前导出的模板和校验结果为准。 |

## 3. Partner Center 输入包

Microsoft 当前要求每个 Store listing 至少有一段 description 和一张 screenshot，
并建议为每种支持的语言提供 listing；提交的 metadata 和截图必须准确反映功能及
限制。详见 Microsoft Learn 的
[MSIX listing 指南](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info)、
[提交指南](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission)
和 [Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)。

先在 Partner Center 为此 MSIX 创建/打开草稿，添加 `en-US` 与 `zh-CN`，然后**导出
当日的 listing CSV 模板**。不要在仓库中自造或复用旧 CSV：字段、locale 和导入规则
应以 Partner Center 导出的模板为准。多语言 CSV 的导出/导入流程见
[Microsoft 的 MSIX CSV 指南](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/import-and-export-store-listings)。

### 3.1 已确认的发布参数

| 字段 | 已确认值 | 录入边界 |
| --- | --- | --- |
| Distribution / visibility | Public | 由 Partner Center 账户负责人执行最终提交。 |
| Pricing | Free | 不添加试用、广告或应用内购买。 |
| Markets | 账户可用的全部市场 | 如 Partner Center 对个别市场提出额外税务或合规要求，以其要求为准。 |
| Category | Photo & video | 与本地图片转换工具的实际用途一致。 |
| Support/contact URL | `https://github.com/web-casa/ImgConvert/issues` | 作为公开支持入口。 |
| Privacy policy URL | `https://web-casa.github.io/ImgConvert/privacy/` | 已部署并完成线上验证；可填入 Partner Center 草稿，仍不得代替最终人工核验。 |
| License | Apache License 2.0 | 链接至 `https://www.apache.org/licenses/LICENSE-2.0`。 |

| 字段 | `en-US` | `zh-CN` | 状态/负责人 |
| --- | --- | --- | --- |
| Product name | `ImgConvert` | `ImgConvert` | 需在 Partner Center 以已保留名称为准。 |
| Short description | `Batch-convert and compress images locally — no account or upload required.` | `在本机批量转换和压缩图片，无需账号或上传。` | 可直接填入当日导出的模板。 |
| Description | 见下方英文长描述 | 见下方中文长描述 | 必填；不得删除 HEIC 边界。 |
| Product features | 见下方英文 features | 见下方中文 features | 逐条填入当日模板支持的 feature 字段。 |
| What's new | 首次提交留空 | 首次提交留空 | 仅后续更新填写。 |
| Search terms | `image converter`; `batch image converter`; `image compressor`; `JPEG converter`; `PNG converter`; `WebP converter`; `AVIF converter` | `图片转换`; `批量图片转换`; `图片压缩`; `JPEG转换`; `PNG转换`; `WebP转换`; `AVIF转换` | 不包含竞品、价格或误导性词汇。 |
| Applicable license terms | `Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0` | `Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0` | 与仓库 `LICENSE` 一致。 |
| Privacy policy URL | `https://web-casa.github.io/ImgConvert/privacy/#en` | `https://web-casa.github.io/ImgConvert/privacy/#zh-CN` | 已部署；录入前由账户负责人再打开确认。 |
| Support/contact URL | `https://github.com/web-casa/ImgConvert/issues` | `https://github.com/web-casa/ImgConvert/issues` | 已确认。 |
| Pricing, markets, visibility, category | Free; all account-eligible markets; Public; Photo & video | 免费；账户可用的全部市场；公开；照片和视频 | 已确认。 |
| IARC age-rating 问卷 | 见第 3.3 节 | 见第 3.3 节 | 账户负责人必须据实作答并提交。 |

### 3.2 待录入的双语长描述与 features

**`en-US` description**

> ImgConvert is a local-first desktop tool for batch image conversion and compression on Windows. Add files or folders, choose JPEG, PNG, WebP, or AVIF, adjust quality and metadata settings, and process the queue on your device.
>
> Your images, file paths, clipboard content, and conversion results stay on your device. ImgConvert has no accounts, ads, analytics, cloud conversion, or third-party network services.
>
> The Microsoft Store edition does not include an external HEIC helper and does not create HEIC output. When Windows system HEIF/HEVC extensions are available, Windows WIC may provide optional HEIC input decoding.

**`en-US` product features**

- Convert JPEG, PNG, WebP, and AVIF images in batches.
- Import files or folders and follow conversion progress in a queue.
- Choose output quality, lossless settings, metadata preservation, and color-management options.
- Handle existing-output conflicts and cancel an active batch when needed.
- Keep image processing on your device without an account or upload.

**`zh-CN` description**

> ImgConvert 是一款面向 Windows 的本地优先桌面图片批量转换与压缩工具。导入文件或文件夹，选择 JPEG、PNG、WebP 或 AVIF，调整质量和元数据设置，然后在本机完成队列处理。
>
> 图片、文件路径、剪贴板内容和转换结果均保留在设备上。ImgConvert 不提供账号、广告、分析、云端转换或第三方网络服务。
>
> Microsoft Store 版本不包含外部 HEIC helper，也不输出 HEIC。系统安装并提供 HEIF/HEVC 扩展时，Windows WIC 可能提供可选的 HEIC 输入解码能力。

**`zh-CN` product features**

- 批量转换 JPEG、PNG、WebP 和 AVIF 图片。
- 导入文件或文件夹，在队列中查看转换进度。
- 设置输出质量、无损模式、元数据保留和色彩管理选项。
- 处理同名输出冲突，并可按需取消正在运行的批次。
- 无需账号或上传，图片处理始终在本机完成。

### 3.3 IARC 作答事实表（账户负责人提交）

按已确认的产品事实，如问卷出现对应问题，应如实说明：没有广告、应用内购买、账号、社交/聊天、公开用户生成内容、赌博内容、第三方遥测或个人数据收集。图片与剪贴板内容仅由用户主动选择并在本机处理，不会上传或分享。预计结果应为一般受众级别，但最终评级由 IARC/Partner Center 依据实际问卷生成，不能在仓库中预先声明为保证结果。

### 3.4 Submission options：`runFullTrust` 用途说明（账户负责人提交）

MSIX manifest 声明了 `runFullTrust`，它是提交时需要说明用途的 restricted capability。不能把
sideload 成功当作 Store 审核已同意；账户负责人必须在 Partner Center 的 **Submission options**
中据实填写。Microsoft 要求对每个 restricted capability 说明为何需要及如何使用，详见
[App capability declarations](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations)
和 [Submission options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options)。

可作为事实准确的英文初稿（仍由账户负责人在提交当日核对后录入）：

> ImgConvert is a packaged Win32/Tauri desktop application. `runFullTrust` is required to launch its full-trust desktop process. The app converts image files only after the user explicitly selects files or folders and chooses an output directory. It does not declare `broadFileSystemAccess`, elevation, device, network, or background-task capabilities. To test, launch the app, import a JPEG/PNG/WebP/AVIF sample with the file picker, select one of those output formats, choose an output directory, and start the conversion. No account, network service, external codec helper, or in-app updater is required for the Microsoft Store build.

不得声称 Store 已批准此 capability；最终审批和任何补充问题均由 Microsoft/Partner Center
决定。

## 4. 可安全复用的事实库（非最终广告文案）

以下句子只可在逐条确认后进入 description、feature 或截图 caption：

- 图片转换、压缩和缩略图处理在本机完成；应用不提供账号、广告 SDK、行为统计或
  第三方遥测服务。
- 可批量导入文件或文件夹，支持队列、进度、取消和输出冲突策略。
- 可在 JPEG、PNG、WebP 和 AVIF 之间转换，并提供质量、无损、元数据保留和色彩
  管理相关设置。
- Store 版不包含外部 HEIC helper，也不提供 HEIC 输出；系统 HEIF/HEVC 扩展可用时，
  Windows WIC 可以提供 HEIC 的读取能力。
- Microsoft Store 版本不启用 Tauri 应用内 updater。

禁止写入 listing 的表述：

- “支持所有图片格式”或“支持 HEIC 输出”。
- “HEIC 开箱即用”或暗示已捆绑 HEVC 编解码器。
- “零专利风险”“完全无损适用于任何格式”等不可证实承诺。
- 未经确认的价格、市场、客服 SLA、隐私/合规认证或性能数据。

## 5. 英文隐私政策与公开页

发布责任人已确认：Microsoft Store 版没有遥测、崩溃报告、远程配置、账户、支付、
广告 SDK 或第三方网络服务；现有中文政策准确描述 Store build。英文对应文本保存在
[`PRIVACY.en.md`](../PRIVACY.en.md)，双语公开版已部署到
`https://web-casa.github.io/ImgConvert/privacy/`。两种语言均以本机处理、用户明确文件
授权、临时文件/缓存、Windows HEIC 边界、元数据选项、儿童隐私、第三方服务、政策更新
和 GitHub Issues 联系方式为相同章节顺序。

若日后加入任何网络服务或改变数据实践，必须先同步更新两种政策、公开页与 Store
listing，再发布该版本。Microsoft 要求隐私政策说明产品访问、收集或传输的个人信息及其
使用、存储、共享与用户控制方式；政策应随功能变化更新。详见
[Store Policies §10.5](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)。

## 6. 截图与 logo 工作表

提交前从实际 Windows Store 候选 MSIX（而非网页预览）取图；只使用合成/授权的样张，
不得包含真实姓名、完整私人路径、剪贴板内容、账号或未获授权的品牌素材。每种 listing
语言至少准备下列四张，以符合 Microsoft “至少一张、建议四张”的指导：

| 编号 | 画面 | `en-US` / `zh-CN` 要求 | 备注 |
| --- | --- | --- | --- |
| 1 | 空队列与导入入口 | 对应语言 UI | 展示本地批量导入，不显示真实路径。 |
| 2 | 格式与压缩设置 | 对应语言 UI | 只展示已实现的 JPEG/PNG/WebP/AVIF。 |
| 3 | 转换队列与完成结果 | 对应语言 UI | 使用可公开的样张和通用文件名。 |
| 4 | 可选能力/隐私或更新边界 | 对应语言 UI | 若展示 HEIC，明确系统扩展和 decode-only 限制；不必强行展示。 |

在 Partner Center 导出的模板中验证最终截图数量、尺寸、格式和 listing logo。MSIX 包内
`StoreLogo.png`（50×50）是包资源，不自动等同于最终的 Store listing 1:1 box art。

## 7. 进入实际提交前的门槛

1. [x] 仓库管理员已将 GitHub **Settings → Pages → Build and deployment → Source** 设为
   **GitHub Actions**。首次 [Publish Privacy Policy workflow](https://github.com/web-casa/ImgConvert/actions/runs/32222596177)
   成功后，已验证 `https://web-casa.github.io/ImgConvert/privacy/` 的 HTTPS 200、中英文锚点和
   Issues 链接；可以将 URL 填入 Partner Center 草稿。
2. 在 Windows runner/机器构建 Store MSIX，并保持：

   ```powershell
   $env:IMGCONVERT_DISABLE_EXTERNAL_CODECS = "1"
   $env:IMGCONVERT_DISABLE_UPDATER = "1"
   $env:WINDOWS_STORE_VERSION = "1.0.0.0"
   pnpm run release:windows:store:check
   pnpm run release:windows:msix
   pnpm run release:windows:msix:smoke
   ```

   `release:windows:msix:smoke` 必须只对放在临时目录的副本签名、安装和删除；由
   `release:windows:msix` 产出的原始 `*.msix` 不得被 smoke 改写，才可作为待上传的
   submission artifact。手动 `Windows Store MSIX` workflow 必须遵循“build → 临时副本
   smoke → upload 原始 artifact”的顺序。

3. 使用实际 Windows Store 候选 MSIX 获取第 6 节所列的中英文实机截图；不得将网页预览
   当作 Store 截图。
4. 将本文件确认过的文字和实机资产填入**刚导出的** Partner Center CSV，按 UTF-8 导入或在
   Partner Center 逐语言录入，并填写第 3.4 节的 `runFullTrust` 用途说明；再由账户负责人发起认证。

本阶段不授权自动创建 Partner Center submission、上传包、设置市场/价格或点击发布。
