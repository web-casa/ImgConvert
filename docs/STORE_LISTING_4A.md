<!-- SPDX-License-Identifier: Apache-2.0 -->

# Phase 4a — Microsoft Store listing 与隐私政策准备包

> 状态：**准备中，未提交 Partner Center**。本文件只收集已核实的工程事实、
> 当前 Microsoft Store 输入项和需要发布责任人确认的内容；它不是已批准的营销
> 文案、隐私政策翻译或提交文件。

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
| 本地处理/无遥测声明 | `PRIVACY.md` | 作为英文隐私政策翻译的源材料，仍须由发布责任人/法务逐条确认。 |
| 许可证 | `LICENSE`、`src-tauri/tauri.conf.json` | Apache-2.0；适用许可条款的最终呈现由发布责任人确认。 |
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

| 字段 | `en-US` | `zh-CN` | 状态/负责人 |
| --- | --- | --- | --- |
| Product name | `ImgConvert` | `ImgConvert` | 确认使用已保留名称。 |
| Short description | `[待发布负责人批准]` | `[待发布负责人批准]` | 不从 README 自动截取，避免与长描述重复。 |
| Description | `[基于第 4 节事实表起草后批准]` | `[基于第 4 节事实表起草后批准]` | 必填。 |
| Product features | `[从第 4 节选择 ≤20 条]` | `[从第 4 节选择 ≤20 条]` | 可选；每条短句，不夸大能力。 |
| What's new | 首次提交留空 | 首次提交留空 | 仅后续更新填写。 |
| Search terms | `[待确认，最多 7 个]` | `[待确认，最多 7 个]` | 不包含竞品、价格或误导性词汇。 |
| Applicable license terms | `[确认 Apache-2.0 呈现方式/URL]` | `[确认 Apache-2.0 呈现方式/URL]` | 需与仓库 `LICENSE` 一致。 |
| Privacy policy URL | `[待部署的稳定 HTTPS URL]` | 同一 URL 或本地化 URL | Win32/MSIX 类产品必须提供，不能填临时预览地址。 |
| Support/contact URL | `[待确认]` | `[待确认]` | 可使用 issue tracker，但响应责任人需确认。 |
| Pricing, markets, visibility, category | `[待发布负责人确认]` | 同一产品决策 | 不从开源仓库推断“免费”或全球可用。 |
| IARC age-rating 问卷 | `[待 Partner Center 账户负责人作答]` | 同一提交 | 不代填。 |

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

## 5. 英文隐私政策准备

现有 `PRIVACY.md` 是中文源文本。最终英文版应与其逐段语义一致，并在发布前由
发布责任人确认以下问题：

1. 产品是否在任何版本启用了遥测、崩溃报告、远程配置、账户、支付或第三方网络
   服务；若答案变化，不能沿用“不会收集”的陈述。
2. 临时文件、缩略图缓存和设置文件的实际位置、保留时间以及用户可删除方式。
3. 对外可访问、长期稳定的 HTTPS 隐私政策 URL，以及维护/变更日期的责任人。
4. 联系方式、适用法律、儿童隐私及地区性告知是否需要额外法律文本。
5. Windows 系统 HEIF/HEVC 扩展的说明是否符合目标市场的产品/法律要求。

Microsoft 要求隐私政策说明产品访问、收集或传输的个人信息及其使用、存储、共享与
用户控制方式；政策应随功能变化更新。详见
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

1. 发布责任人批准双语 description/feature、价格/市场/分类、关键词、年龄评级答案、
   许可条款、支持联系方式和隐私政策 URL。
2. 法务或发布责任人批准英文隐私政策，确认它与真实数据实践一致。
3. 在 Windows runner/机器构建 Store MSIX，并保持：

   ```powershell
   $env:IMGCONVERT_DISABLE_EXTERNAL_CODECS = "1"
   $env:IMGCONVERT_DISABLE_UPDATER = "1"
   $env:WINDOWS_STORE_VERSION = "1.0.0.0"
   pnpm run release:windows:store:check
   pnpm run release:windows:msix
   pnpm run release:windows:msix:smoke
   ```

4. 将确认过的文字和实机资产填入**刚导出的** Partner Center CSV，按 UTF-8 导入或在
   Partner Center 逐语言录入；再由账户负责人发起认证。

本阶段不授权自动创建 Partner Center submission、上传包、设置市场/价格或点击发布。
