<!-- SPDX-License-Identifier: Apache-2.0 -->
# DEVLOG — 开发记录

> 倒序记录关键进展与决策。详细阶段计划见 [ROADMAP.md](./ROADMAP.md);引擎设计见 [ENGINE.md](./ENGINE.md);许可见 [LEGAL.md](./LEGAL.md)。

---

## 2026-08-19 — Phase 4a 外部动作：GitHub Pages 隐私页上线

- **Pages 启用与部署**：仓库 Pages 已切换为 GitHub Actions source；[Publish Privacy Policy run
  32222596177](https://github.com/web-casa/ImgConvert/actions/runs/32222596177) 在标准
  `ubuntu-24.04` runner 上成功上传并部署静态隐私页。
- **线上验证**：`https://web-casa.github.io/ImgConvert/privacy/` 返回 HTTPS 200，包含 `#en` /
  `#zh-CN` 双语锚点及 GitHub Issues 支持链接；Store listing 可使用已验证的双语 privacy URL。
- **边界**：未下载或上传 MSIX、未生成 Windows 实机截图、未创建 Partner Center CSV/IARC/
  submission；Store external codec/updater 禁用、免费标准 runner 策略与 Flatpak app-id 均未改变。

---

## 2026-08-19 — Phase 5：i18n QA、Windows MSIX 真 runner 与 review 修复

- **review 修复**：新的固定 `zh-CN` Playwright 首屏 smoke 复现了真实的 i18n 初始化竞态：静态
  message 被包装成异步 `svelte-i18n register()` loader，`state.svelte.ts` 模块级 engine 文案会在
  locale 设置前格式化。改为 `addMessages()` 同步注册两份静态字典，再 `init()`，修复中文首次启动。
- **浏览器 QA**：Playwright 新增确定性中文 context，验证中文首屏、Topbar 中→英后的 title / 主操作
  文案、以及切回中文；现有 key parity、Vitest 和 `check:ui-i18n` 继续由 `quality:frontend` 执行。
- **Windows 回归护栏**：platform guardrail 现在锁定手动 `store_msix` 路径的标准
  `windows-latest` runner、临时 `ImgConvert.DevSmoke` identity、外部 codec/updater 禁用、MSIX build
  与 sideload install smoke；Windows packaging README 同步记录非发布运行方式。
- **真实 runner**：[Windows Smoke run 32218246687](https://github.com/web-casa/ImgConvert/actions/runs/32218246687)
  成功执行 Store-configured MSIX build、临时签名/sideload 和安装后 JPEG/WebP/PNG/AVIF 转换 smoke；
  [Windows Store MSIX run 32218253749](https://github.com/web-casa/ImgConvert/actions/runs/32218253749)
  成功重建并上传 `imgconvert-windows-x64-msix-submission` artifact。main 自动 CI 同时通过。
- **本地验证**：`quality:frontend`、`quality:security`、`release:platform:check`、Playwright 3/3、
  Linux Tauri debug `.deb` build 与已安装包 conversion smoke 均通过。
- **边界**：未启用 Pages、未下载/提交 Partner Center artifact、未创建 submission；Store 继续禁用
  external codec/updater，Flatpak app-id 与免费标准 runner 策略未变。

---

## 2026-08-19 — Phase 4b：docs-site 英文站与 Phase 4a 复核修复

- **4a 隐私复核**：审计 Rust 结果缓存后，双语政策和静态公开页明确说明：持久记录仅含哈希和文件大小，不含图片字节或路径；设置页只能关闭结果复用，删除已有设置/缓存记录需删除相应本机应用数据或缓存目录。`check-pages-privacy.mjs` 同步守护双语生效日期、缓存说明、无远程资源、CSP 与 `no-referrer`。
- **4b 路由与内容**：docs-site 接入 Fumadocs i18n。中文继续使用既有 `/` / `/docs/...` URL，英文使用 `/en-US/...` / `/en-US/docs/...`；loader 禁用未翻译页面回退。首批英文覆盖首页、安装、使用、隐私和排障；英文导航不暴露未翻译文档，中文页切到英文时会安全回到英文文档首页。
- **规范政策与 review 修复**：文档隐私页只 `<include>` 根目录两份政策正文，避免第三份漂移副本。复核修复了英文文档深链和根级未知路径的 locale-aware 404、隐藏中文 locale 的 Fumadocs SSR/client pathname hydration mismatch，以及规范政策自身 H1 与 Fumadocs 页面标题重复的问题。
- **验证**：`quality:frontend`（现已覆盖 docs-site 编译）、`quality:security`、`release:platform:check`、既有 Playwright 2/2、生产 docs Playwright 路由/搜索/404/语言切换 smoke、静态隐私页 CSP smoke、Linux Tauri debug `.deb` build 与包内转换 smoke 全部通过。
- **边界**：未启用 GitHub Pages、未创建 Partner Center submission，未改变 Store 的外部 codec/updater 禁用、免费标准 runner 策略或 Flatpak app-id。

---

## 2026-08-19 — Phase 4a：已确认 Store 文案与 GitHub Pages 隐私页

- **确认范围**：发布负责人选择公开、免费、账户可用全部市场、`Photo & video` 分类、本地优先定位、GitHub Pages 隐私 URL、GitHub Issues 支持入口，并确认 Store build 无遥测、广告、账号、崩溃报告、远程配置或第三方网络服务。
- **Store metadata**：[`STORE_LISTING_4A.md`](./STORE_LISTING_4A.md) 现在包含可录入的 `en-US` / `zh-CN` short description、长描述、features、关键词、许可、IARC 事实表与截图工作表；仍坚持从 Partner Center 导出当日 CSV，且不自动提交。
- **隐私公开页**：新增 `PRIVACY.en.md`、`pages/privacy/` 双语静态页和 `pages.yml`。页面没有远程字体、脚本或图片资源；不改现有 Next/Fumadocs 架构。仓库当前未启用 Pages，管理员选择 GitHub Actions source 后才会实际部署。
- **准确性修复**：审计 `settings.json` 后，政策明确披露用户主动选择的输出目录与 HEIC helper 路径会保存在本机设置；图片和路径不会上传、收集或向第三方传输。新增 `check-pages-privacy.mjs`，并接入 `docs:check`。
- **约束与验证**：Pages workflow 仅用 `ubuntu-24.04`，纳入 CI 成本护栏；未改 Store 外部 codec/updater 禁用策略或 Flatpak app-id。`quality:frontend`、`quality:security`、`quality:rust`、全平台 guardrail、Playwright、Linux Tauri debug `.deb` smoke 通过。

---

## 2026-08-19 — Phase 3 复核与 Phase 4a 准备

- **复核修复**：审查 Tauri IPC envelope、前端解析/ICU 映射和后台 invoke 路径后，统一缩略图、临时文件清理、HEIC helper 同步等后台 command 失败日志。生产环境仅记录本地化 message，不再将 backend `detail` 原样写到控制台；开发环境保留受控的技术诊断。
- **回归保护**：新增 `logCommandError()` 单测，验证后台路径通过 `code`/`params` 生成本地化消息，保留 `zh-CN`/`en-US` key parity 现有检查。
- **4a 准备**：新增 [`STORE_LISTING_4A.md`](./STORE_LISTING_4A.md)，记录已核实的产品/渠道边界、Partner Center 资料工作表、隐私政策待确认问题和实机截图要求。未制作未获批准的广告/法务文案、CSV 或实际提交。

---

## 2026-08-19 — i18n Phase 3：结构化 Tauri command 错误

- **IPC 契约**：新增 `CommandError { code, params, detail }` / `ErrorCode`。所有可失败的 Tauri command 在边界处返回结构化错误；底层 `Result<T, String>` 继续留在内部实现。
- **无字符串旁路**：批量 `fileError` / `fileSkipped` progress event、导入扫描逐项错误及转换规划错误也改为同一 envelope。`codec_diagnostics()` 保持成功返回的技术快照，HEIC helper 配置失败走 `codecConfigurationFailed`。
- **前端本地化**：新增 `errors.*` 双语 key 和 `command-error` 解析/映射层；只按 `code` 与 `params` 渲染 ICU message，`detail` 仅在开发控制台记录，旧版或畸形 payload 统一回退通用错误。同步修复 `svelte-i18n` v4 需要 `{ values: params }` 的 ICU 插值调用。
- **验证**：`quality:frontend`、`quality:rust`、`quality:security`、全平台 release guardrail、Playwright，以及 Linux Tauri debug `.deb` build/artifact smoke 均通过。
- **发布约束**：未改变 Store 的 updater/外部 codec 禁用策略，未修改 Flatpak app-id。

---

## 2026-08-18 — i18n Phase 1/2：zh-CN + en-US 前端双语

- **Phase 1**：接入 `svelte-i18n` 与 `@tauri-apps/plugin-os`，新增 `src/lib/i18n/`、`settings.locale`、Topbar 语言切换、启动 loading gate 与 OS locale 检测。
- **Phase 2**：完成全部前端组件与 `state.svelte.ts` 用户可见文案迁移；FORMAT 数据改为 labelKey/descriptionKey；新增 `scripts/check-ui-hardcoded-strings.mjs` 并接入 `quality:frontend`；新增 i18n key parity 测试。
- **Review 修复**：svelte-i18n 初始 locale 同步设置；e2e 断言兼容中英；engine 文案随 locale 刷新；`svelte-i18n>esbuild` override 修复 npm audit。
- **状态**：前端 UI 双语完成；Rust 后端错误码迁移仍是 Phase 3。

---

## 2026-08-18 — Microsoft Store 生产 MSIX 与真实 runner 验收

- 新增 `windows-store-release.yml`，使用 committed Partner Center identity 构建 production `.msix`，禁用外部 codec 与 Tauri updater。
- 真实 runner：macOS unsigned DMG + ImageIO HEIC smoke 通过；Windows MSIX pack + sideload install smoke 通过。
- Store updater 策略：MAS/MSIX 不启用 Tauri updater，更新交给 Apple/Microsoft。

---

## 2026-08-18 — Logo 全量替换

- 使用 `~/jietu/005.png`（1000x1000）生成并压缩全部 Tauri/Store/Web 图标，保留 RGBA；提交 `f2314c3`。

---

## 2026-08-18 — v0.1.2 新仓库首个 GitHub Release

- **版本升级**:`package.json`、docs-site、Tauri config/Cargo manifest/lock 统一升到 `0.1.2`;THIRD_PARTY licenses 重新生成。
- **Linux Release**:推送 `v0.1.2` 触发 GitHub Actions,amd64+arm64 各构建 `.deb`、`.rpm`、AppImage,工作流内 Docker smoke 通过。
- **GitHub Release**:发布 6 个 Linux 安装资产 + 合并 `SHA256SUMS`。
- **Tauri updater**:`Updater Release` 构建并发布 x86_64 签名 AppImage/`.sig`/`latest.json`;本机 arm64 补构建签名 aarch64 AppImage 并合并双平台 `latest.json`,两个平台的远端 updater smoke 均通过。
- **真实 runner**:macOS arm64 unsigned DMG + HEIC ImageIO smoke 通过;Windows x64 MSIX pack + sideload install smoke 通过。
- **修复**:Linux bundle 补 `xdg-utils`;MSIX full-trust 扩展改用 `desktop:` 命名空间;Windows PowerShell smoke 恢复 PSModulePath;macOS/Windows 真实 runner 暴露的 guardrail/clippy 问题修复。

---

## 2026-08-18 — 迁移到 public 仓库并启用免费 GitHub Actions

- **仓库迁移**:origin 从 `yeagoo/imgconvert` 切到 `web-casa/ImgConvert`;Tauri homepage、updater 默认 repo、docs-site 链接和 Flatpak metadata URL 同步更新。Flatpak app-id 暂保持 `io.github.yeagoo.imgconvert`,Flathub 若正式提交前再单独评估 app-id 迁移。
- **public 仓库 Actions 策略**:public 仓库的 GitHub-hosted 标准 runner 免费,因此 CI 恢复 `main` push / PR 自动触发;`v*` tag 自动触发 Linux amd64+arm64 release;macOS/Windows/updater workflow 仍手动触发,但移除 `confirm_paid_runner` / `confirm_runner` 付费确认门槛。
- **护栏更新**:`check-ci-cost-guardrails.mjs` 改为校验“只允许免费标准 runner、禁止 paid/larger runner 与 schedule”,并校验 CI/release 的自动触发形态;`docs/CI_COSTS.md`、ROADMAP/ENGINE 同步新策略。
- **验证**:`actionlint`、`pnpm run ci:cost:check`、`release:platform:check`、`release:flatpak:verify`、`docs:check` 均通过。

---

## 2026-07-06 — 第一期发布范围收敛:GitHub Releases only

用户确认第一期不提交任何商店,只在 GitHub Releases 发布。Codex 同步 repo 侧口径:

- **发布范围**:第一期只发布 Linux `.deb/.rpm/AppImage`、AppImage updater signature、`latest.json` 与 `SHA256SUMS`;Flathub、Mac App Store、Microsoft Store、MSIX、MAS notarization/submission 全部后移。
- **readiness scope**:`pnpm run release:readiness` 默认改为 GitHub-only 范围;`pnpm run release:readiness:all` / `--scope=all` 才显示 Flathub、macOS、Windows、商店和长期 benchmark/corpus 项。
- **发布硬闸门**:新增 `pnpm run release:readiness:github:ready`,使用 `--require-publishable` 要求第一期 in-scope 项全部 ready;普通 `release:readiness` 仍保持只读观察,不会替代发布前硬校验。
- **文档同步**:README、ROADMAP、ENGINE、UPDATER 均明确“GitHub Releases first”,商店/Flathub 脚本仍保留为后续阶段和架构护栏,但不作为第一期发布阻塞项。

边界:

- 不移除 Flathub/MAS/MSIX/Windows signing 代码和 guardrail;它们继续作为后续发布留门。
- GitHub-only 不等于无签名:AppImage updater artifact 仍需 Tauri updater key 签名,并上传 `.sig` 与 `latest.json`。

---

## 2026-07-06 — Linux 0.1.1 包重建与 in-app updater 升级 smoke

Codex 收尾 `v0.1.1` Linux 发布残留和真实 updater 升级验证入口:

- **Linux 0.1.1 bundle 重建**:重新运行 `pnpm run release:linux`,清理旧 `.deb/.rpm/AppImage` 后生成 `ImgConvert_0.1.1_arm64.deb`、`ImgConvert-0.1.1-1.aarch64.rpm`、`ImgConvert_0.1.1_aarch64.AppImage` 和 `SHA256SUMS`;artifact verifier 确认三类包均为 `0.1.1`,AppImage scrub 后不捆入 deny-list `libgcrypt.so.20`。
- **升级资格 smoke**:新增 `scripts/smoke-tauri-in-app-updater.mjs` 与 `release:updater:upgrade-smoke:eligibility`,会下载旧 release manifest/artifact、公开 `releases/latest/download/latest.json`、新 artifact 与 `.sig`,确认 `v0.1.0 -> v0.1.1` 版本递增且签名一致。
- **真实 in-app GUI smoke**:新增 `release:updater:upgrade-smoke` 和手动 GitHub Actions workflow `Updater Upgrade Smoke`。在 Linux x86_64 + Xvfb/xdotool 环境中,脚本启动旧 AppImage,点击“应用更新”与“安装并重启”,等待旧 AppImage 被最新 artifact 替换,再运行隐藏包内转换 smoke。
- **GitHub x86_64 实跑**:`Updater Upgrade Smoke` run `28764690606` 已通过,日志确认 `Tauri in-app updater smoke passed: 0.1.0 -> 0.1.1`。
- **成本护栏**:`updater-upgrade-smoke.yml` 只允许 `workflow_dispatch`,且 job 需要 `confirm_runner=true`;`ci:cost:check` 会防止该 workflow 被改成自动触发。

边界:

- 已发布的 `v0.1.0` 旧包无法再加入测试 hook,所以本次真实升级 smoke 必须通过 x86_64 GUI 自动点击或人工点击验证。
- arm64 本机只能跑升级资格检查和本机 arm64 AppImage 包内 smoke,不能执行 GitHub 发布的 x86_64 AppImage。

---

## 2026-07-05 — Tauri updater 真发布闭环:本地 key 注入与 latest.json 生成

Codex review updater 真发布路径后修复一个实际构建缺口:`tauri build` 在开启 updater artifacts 时只读取 `TAURI_SIGNING_PRIVATE_KEY` 私钥内容,不能只给 `TAURI_SIGNING_PRIVATE_KEY_PATH`。

- **本地 release 编排**:新增 `scripts/release-linux-updater.mjs` 与 `release:updater:local`,本机默认读取 `~/.tauri/imgconvert-updater.key*`,只把私钥内容注入子进程环境,不写入仓库;CI 仍可继续用 GitHub Secrets 的 `TAURI_SIGNING_PRIVATE_KEY` 内容。
- **完整 artifact 流程**:`release:linux:updater` 现在由 Node 编排 toolchain check、updater config、AppImage build、scrub、最终 artifact 重签、bundle 校验与 SHA256SUMS。
- **manifest 默认值**:`release:updater:manifest` / `release:updater:verify` 在未设置 `TAURI_UPDATER_ARTIFACT_BASE_URL` 时默认使用 `https://github.com/<repo>/releases/download/v<package version>`,仍可用环境变量覆盖。
- **review 修复**:补 `release:updater:local` 和 guardrail,用于一次性生成并校验 `target/updater/latest.json`。

边界:

- 本批生成的是可上传到 GitHub Release 的本地 artifact/manifest;真正 in-app 升级仍需要先发布一个旧版本安装包,再发布新版本 Release 后做双版本升级 smoke。
- GitHub Actions 真发布仍需要仓库 secrets 中有 `TAURI_UPDATER_PUBKEY` 与 `TAURI_SIGNING_PRIVATE_KEY`。

---

## 2026-07-05 — Flathub 发布闭环:PR 工作目录、metadata lint 与 HEIC 真实沙盒 smoke

Codex 推进 Flathub 最后一公里,把主包与 HEIC addon 的提交前检查拆成可重复执行的 repo 侧入口:

- **主包 Flathub PR**:新增 `release:flathub:main-pr` / `release:flathub:pr` 与 `scripts/prepare-flathub-pr.mjs`,按 release source URL 生成 `target/flathub/main/io.github.yeagoo.imgconvert.yml` 和提交说明,用于基于 `flathub/flathub:new-pr` 的 PR。
- **渠道 metadata 验收**:新增 `release:flathub:metadata` / `release:flathub:metadata:lint`,补主包与 addon 的 `developer`、homepage/vcs/bugtracker、主包 screenshot/release notes,并用 `appstreamcli` 与可选 `flatpak-builder-lint` 做本地检查。
- **HEIC extension 单独审核**:`release:flathub:heic-pr` 生成 `target/flathub/heic-extension/`,保持 LGPL decode-only addon 与 Apache-2.0 主包分开;本地文件 source 会带 sha256,并可按 `--release-ref` 切到 tag/commit raw URL。
- **真实 HEIC 沙盒 smoke**:新增 `release:flatpak:heic:real-smoke`,先把主包和 HEIC extension 构建到同一个临时 OSTree repo,再通过 `flatpak run --command=imgconvert` 读取真实 `.heic` 样张并转 PNG。可用 `IMGCONVERT_FLATPAK_HEIC_SMOKE_INPUT` / `--sample=` 传样张,未传时尝试用 host `heif-enc` 生成小样张。
- **review 修复**:补 `packaging/flatpak/screenshots/main.png` 作为 Flathub screenshot 实物资产;metadata checker 会把 raw GitHub screenshot URL 映射回本地文件,缺图即失败。HEIC real smoke 会清理 origin 为 `imgconvert-heic-smoke-*` 的测试安装和临时 remote,避免失败重跑后留下脏 Flatpak 状态。
- **Flathub app-id 迁移**:review 发现官方 `flatpak-builder-lint manifest` 会按 `com.ivmm.imgconvert` 检查 `ivmm.com` 可达性且当前 TLS 不通过;Flatpak 发布层迁到 `io.github.yeagoo.imgconvert` / `io.github.yeagoo.imgconvert.Codecs.Heic`,Tauri/macOS bundle identifier 仍保持 `com.ivmm.imgconvert`。主包 manifest 与 HEIC addon manifest 官方 lint 已通过。
- **guardrail/docs**:`release:flatpak:verify` 纳入 Flathub metadata 检查;`release:platform:check` 校验 Flathub PR、metadata lint、真实 HEIC smoke 与 Flatpak README 文档入口。

边界:

- 本批不代替 Flathub 官方人工审核,也不声称 HEIC addon 已被 Flathub 接受;专利/频道策略和 addon review 仍是外部发布项。
- 主包仍不捆绑 `libheif`/`x265`/helper,只允许 Flatpak extension mount point 下的 decode-only provider。
- 官方 AppStream 网络 lint 仍要求 screenshot URL 在远端 tag/commit 真实可访问;本地已提供 `packaging/flatpak/screenshots/main.png`,提交并发布对应 ref 后再跑 `release:flathub:metadata:lint` 可闭环该远端检查。

---

## 2026-07-05 — Tauri updater 真发布 smoke 补强

Codex 开始推进 Tauri updater 真发布闭环,把发布前后 smoke 也纳入仓库:

- **updater key**:本机生成 Tauri updater signing keypair 到 `~/.tauri/imgconvert-updater.key*`,私钥文件权限收紧为 `0600`;GitHub Secrets 已配置 `TAURI_UPDATER_PUBKEY` 与 `TAURI_SIGNING_PRIVATE_KEY`,未设置无密码 key 不需要的 password secret。
- **远端 artifact smoke**:`Updater Release` workflow 在上传 Release assets 前会执行签名后的 AppImage,通过 `IMGCONVERT_PACKAGE_CONVERT_SMOKE=1` 跑真实 core 转换 smoke。
- **发布后 smoke**:新增 `release:updater:smoke` / `scripts/smoke-tauri-updater-release.mjs`,从 GitHub Release 下载 `latest.json`、目标平台 artifact 和 `.sig`,校验 manifest 签名与远端 `.sig` 一致;同架构 Linux AppImage 会继续执行隐藏转换 smoke。
- **guardrail/docs**:`release:platform:check` 现在检查 updater smoke 脚本、workflow smoke step 和 [UPDATER.md](UPDATER.md) 使用说明。

边界:

- 真正的 in-app 增量升级仍需要“旧版本已安装/运行 + 新版本 Release 已发布”的双版本场景。当前仓库 smoke 覆盖的是发布 manifest、签名、可下载 artifact 和 updater AppImage runtime。

---

## 2026-07-05 — README 状态同步 + 发布剩余项 readiness 收口

Codex 修复 README 仍停留在早期 P0/P1 状态的问题,并把“剩余开发/验收项”拆成 repo 内可检查项与外部前置项:

- **README 同步**:功能与当前状态改为反映 P0/P1/P2/P3 repo 侧已完成,剩余主要是 Apple/Windows 签名与商店、Flathub 审核、真实 updater 发布、真实 corpus 和跨平台 benchmark。
- **新增 `docs:check`**:`scripts/check-readme-status.mjs` 拦截 README 中“前端串行”“Release MVP 尚未开始”等过期表述,并要求 README 保留 release readiness 和平台检查入口。
- **readiness check 模式**:`release:readiness` 新增 `--check`,只校验报告能生成和本地脚本接线,不要求已有 `.dmg/.msi` 或签名证书,适合放入 `release:platform:check`。
- **外部项表达更准确**:`release:readiness` 现在单独列出 Flathub 主包提交、真实图片 corpus fuzz/replay、Windows benchmark 等外部前置;macOS direct 也区分签名 identity 与 notarization 凭据。
- **CI/guardrail 接线**:`docs:check` 接入 `quality:security`、CI security job 和 `release:platform:check`,后续修改发布/路线图时会同步检查 README 状态是否漂移。

边界:

- 本批不声称完成真实 Apple Developer 公证、Windows 代码签名、Partner Center、Flathub 审核或真实图片 corpus 长跑;这些仍需要对应账号、证书、设备或样张。

---

## 2026-07-05 — 发布 readiness 报告入口

Codex 继续做不依赖外部账号/硬件的收口,把“哪些能本机验证、哪些必须等真实平台/证书”的状态做成可重复运行的报告:

- **新增 `release:readiness`**:`scripts/report-release-readiness.mjs` 只读仓库和环境变量,列出本机静态检查入口、已有 release artifact、updater/Flatpak/HEIC/macOS/Windows 的外部前置条件。
- **不触发付费资源**:脚本不构建、不联网、不触发 GitHub Actions,也不打印密钥值;只显示相关 env 是否已设置。
- **输出形态**:默认打印人类可读报告,`--json` 可给后续 CI/发布脚本消费,`--require-ready` 可在本地 repo 脚本缺失时返回非零。
- **guardrail**:`release:platform:check` 静态校验该入口、关键 env marker 与文档接线,防止后续发布状态说明再次散落。

验证:

- `pnpm run release:readiness`:通过。
- `node scripts/report-release-readiness.mjs --json`:通过;`pnpm --silent run release:readiness -- --json` 同样可用于机器消费。
- `pnpm run release:platform:check`:通过。

边界:

- readiness 报告不替代真实 `.deb/.rpm/AppImage/.dmg/.msi/.exe` 构建,也不替代 Apple/Windows/Flathub/GitHub Releases 的实际提交验收。

---

## 2026-07-05 — 架构前提静态护栏

Codex 把“全程保持”的主架构红线从文档要求收口为本机可跑的静态检查:

- **新增 `architecture:check`**:`scripts/check-architecture-guardrails.mjs` 校验主包 Apache-2.0、pnpm 锁文件策略、`image/default-features=false`、`libavif-sys/default-features=false`、`ssimulacra2/default-features=false`、`lcms2/static`、`cargo-deny` 不放行 GPL/AGPL/LGPL。
- **HEIC 边界**:检查 core `READABLE/WRITABLE_FORMATS` 仍只有 JPEG/PNG/WebP/AVIF,Tauri 输出解析继续拒绝 HEIC/HEIF,macOS ImageIO 与 Windows WIC provider 继续 read-only,外部 HEIC manifest 继续拒绝 writable。
- **Store/Flatpak 边界**:检查 `IMGCONVERT_DISABLE_EXTERNAL_CODECS` 的 build-time/runtime gate、MAS/Windows store preflight、Flatpak 主包禁宿主 helper 且不包含 `libheif`/`x265`/helper。
- **文件访问边界**:检查导入/输出/转换读写仍经过 `access.rs` 的用户显式授权与 scoped access hook。
- **wiring**:`release:platform:check` 与 `quality:security` 现在都会先跑 `architecture:check`;平台 guardrail 反向检查该 wiring,防止后续误删。

验证:

- `pnpm run architecture:check`:通过。
- `pnpm run release:platform:check`:通过。

边界:

- 这是 repo 静态护栏,不能替代 `cargo deny` 的完整依赖许可解析,也不能替代真实 MAS/MS Store/Flathub 提交验收。

---

## 2026-07-05 — 质量 heuristics 第三批:JPEG 色度网格指纹

Codex 继续推进“更多压缩噪声指纹”里不依赖真实图片 corpus 的部分:

- **JPEG chroma grid hint**:`detect_lossy_artifacts()` 在 PNG 输入上新增 JPEG 8×8 色度网格评分,覆盖“亮度边界不明显但 Cb/Cr 在块边界跳变”的有损来源痕迹。
- **保守触发**:新评分仍要求 8×8 边界平均差值达到绝对阈值,且相对块内变化超过阈值;原有 JPEG 亮度网格与 WebP-like 4×4 评分不降阈值。
- **代际防护联动**:Tauri 层继续只看 core 是否返回 `LossyArtifactHint`,因此用户启用 generation loss protection 时,这类 PNG 会按疑似有损来源套用收益门槛。
- **测试/guardrail**:core 单测与 `test:image-quality` integration fixture 覆盖 chroma-grid case;`release:platform:check` 增加 marker 防回退。

边界:

- 这仍是 conservative hint,不是“来源格式证明”。真实相机/社交平台 PNG corpus 的误报率还需要后续 corpus replay 继续积累。

---

## 2026-07-05 — AVIF metadata extractor 收口

Codex 继续收口 metadata 管线里一个维护缺口:

- **通用 AVIF metadata 提取**:`metadata_from_image_format()` 不再把 `Format::Avif` 当作空 metadata,新增 `extract_avif_metadata()` 复用 libavif parse 阶段的 `avifImage.icc/exif/xmp`。
- **解码路径去重**:`AvifCodec.decode()` 改为共用 `avif_metadata_from_image()`,避免 AVIF decode 与通用 metadata extractor 各自复制 raw blob 逻辑。
- **测试/guardrail**:`avif_preserves_icc` 增加 `extract_avif_metadata()` 和 `metadata_from_image_format(&av, Format::Avif)` 断言;`release:platform:check` 增加 AVIF metadata extractor marker。

验证:

- `cargo +1.96.0 test -p imgconvert-core avif_preserves_icc -- --nocapture`:通过。

边界:

- AVIF 仍只声明 ICC/EXIF/XMP raw metadata;IPTC IIM 仍只在 JPEG APP13 中原生写回。

---

## 2026-07-05 — 导入 DPI ping:AVIF EXIF Resolution

Codex 继续补齐导入 metadata ping,把 EXIF Resolution DPI 解析扩到 AVIF:

- **AVIF EXIF DPI**:`probe()` 的 AVIF 路径在 `avifDecoderParse` 后读取 libavif 暴露的 `image.exif`,复用现有 TIFF/EXIF Resolution parser,返回 `ImageProbe.dpi`。该路径不调用 `avifDecoderNextImage`,不做像素解码。
- **测试覆盖**:新增 AVIF preserve-metadata fixture,用 core 自身写入 EXIF Resolution 后再 `probe()` 验证 144×72 DPI 与尺寸。
- **guardrail/docs**:`release:platform:check` 增加 AVIF EXIF DPI marker,ENGINE/ROADMAP 同步声明 PNG/JPEG/WebP/AVIF 均已覆盖导入 DPI ping。

验证:

- `cargo +1.96.0 test -p imgconvert-core probe_avif_reads_exif_resolution_dpi -- --nocapture`:通过。

边界:

- 这只读取 AVIF EXIF Resolution metadata,不声明 AVIF 容器级 nclx/clean aperture/DPI 语义,也不改变 AVIF 输出 metadata 策略。

---

## 2026-07-05 — Tauri updater GitHub Releases 启用 + Flatpak HEIC extension 真包

Codex 把两个此前“留门”的发布项推进到可执行闭环,但仍不把私钥或 LGPL codec 放进主包:

- **Tauri updater 发布通道**:新增 `docs/UPDATER.md`、`release:linux:updater`、`release:updater:sign` 和手动 `Updater Release` GitHub Actions workflow。默认 endpoint 采用 GitHub Releases 静态 `latest.json`:`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`。
- **updater artifact 签名修正**:`generate-tauri-updater-manifest` 同时支持 Tauri v2 的 `.AppImage/.msi/.exe + .sig` 和旧兼容 `.tar.gz/.zip + .sig`;Linux AppImage 会先 scrub 再用 `tauri signer sign` 重签最终 artifact,避免发布 pre-scrub 签名。
- **应用内更新入口**:前端新增“应用更新”弹层,通过 `@tauri-apps/plugin-updater` 检查、下载并调用 `@tauri-apps/plugin-process` 重启;capability 只开放 `updater:default` 与 `process:allow-restart`。
- **Flatpak HEIC extension 真包**:新增 `packaging/flatpak/extensions/heic/io.github.yeagoo.imgconvert.Codecs.Heic.yml`,固定 `libde265 v1.1.1` 与 `libheif v1.23.1` 源码 sha256,构建 decode-only `heif-dec` wrapper,安装 codec manifest/metainfo/LGPL notice。
- **许可边界**:extension manifest 显式关闭 HEIC encoding、`x265` 和 GPL-only codec 路径;主 Flatpak 仍设置 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`,只允许 `/app/extensions/codecs` 下的 addon manifest。
- **guardrail**:`release:flatpak:verify` 纳入 `release:flatpak:heic:verify`;新增 `release:flatpak:heic:download-check` 用 `flatpak-builder --download-only` 校验 pinned upstream source URL/sha256,不要求主 app runtime 已安装;新增 `release:updater:verify` 校验 `latest.json` 的 URL、平台 key 与本地产物签名一致;`release:platform:check` 校验 updater UI/签名脚本/workflow/文档和 HEIC extension decode-only manifest。

边界:

- GitHub updater 真发布仍需要你在仓库 secrets 中配置 `TAURI_UPDATER_PUBKEY`、`TAURI_SIGNING_PRIVATE_KEY` 和可选密码。
- Flatpak HEIC extension 已有可构建 manifest,但真实 Flathub addon 提交、专利/频道审核和带真实 HEIC 样张的沙盒运行 smoke 仍需发布阶段执行。

## 2026-07-04 — Flatpak HEIC extension 留门 + Tauri updater 生成式闭环

Codex 补齐两个发布后续项的 repo 侧闭环,但不把外部 codec 或 updater secrets 写进默认主包:

- **Flatpak HEIC extension point**:主 Flatpak manifest 继续设置 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`,禁用宿主 PATH/XDG helper;同时新增 `IMGCONVERT_ALLOW_FLATPAK_CODEC_EXTENSIONS=1` 与 `io.github.yeagoo.imgconvert.Codecs` extension point,只允许 `/app/extensions/codecs` 下的 Flatpak 扩展 manifest 生效。
- **HEIC extension 模板**:新增 `packaging/flatpak/extensions/heic/` 模板,定义 `io.github.yeagoo.imgconvert.Codecs.Heic`、decode-only `imgconvert-codec-heic.json` 和 AppStream addon。模板不包含 LGPL helper 源码/二进制,不让主包声明内置 HEIC。
- **后端发现边界**:`external_codecs` 在全局禁外部 codec 时只扫描 Flatpak extension 挂载目录,不会扫描手动 helper、XDG、PATH 或宿主系统 helper;诊断 UI 仍能看到 extension manifest 的 accepted/rejected 状态。
- **Tauri updater 留门**:新增 `release:updater:prepare`,只有提供 `TAURI_UPDATER_PUBKEY` 与 `TAURI_UPDATER_ENDPOINTS` 时才生成 `tauri.updater.generated.conf.json`,开启 `createUpdaterArtifacts` 与 updater endpoint。默认 `tauri.conf.json` 不硬编码公钥/endpoint。
- **updater manifest**:新增 `release:updater:manifest`,从 Tauri updater artifacts(`*.AppImage.tar.gz`/`*.app.tar.gz`/Windows zip)及同名 `.sig` 生成静态 `latest.json`;Flatpak 更新仍交给 Flathub。
- **guardrail**:`release:flatpak:verify` 校验 extension point/模板;`release:platform:check` 校验 updater 插件、生成脚本和默认配置无 secrets。

验证:

- `pnpm run release:flatpak:verify`:通过。
- `pnpm run release:platform:check`:通过。

边界:

- 本批没有提供真实 HEIC helper、LGPL 源码包、Flathub extension 提交,也没有生成真实 updater 签名。正式启用 updater 还需要 Tauri signing key、HTTPS endpoint 和 release artifact 上传策略。

---

## 2026-07-04 — 导入 DPI ping:WebP EXIF Resolution

Codex 继续补齐 P1 导入 metadata ping,把 EXIF Resolution DPI 解析扩到 WebP 容器:

- **WebP EXIF DPI**:`probe()` 仍使用 `webp::BitstreamFeatures` 获取尺寸并拒绝动画,额外 best-effort 扫描 RIFF `EXIF` chunk,解析 TIFF IFD0 的 `XResolution` / `YResolution` / `ResolutionUnit`。
- **边界安全**:复用已有 WebP chunk parser 的长度、padding 与截断检查;EXIF chunk 缺失或损坏时只返回 `dpi:None`,不影响 WebP 尺寸 ping。DPI parser 同时接受裸 TIFF payload 与带 `Exif\0\0` 前缀的 EXIF payload。
- **测试覆盖**:新增 WebP preserve-metadata fixture,覆盖 EXIF Resolution centimeter → DPI 换算;另补 `Exif\0\0` 前缀兼容测试。
- **guardrail/docs**:`release:platform:check` 增加 WebP EXIF DPI marker,ENGINE/ROADMAP 同步声明 PNG/JPEG/WebP 已有导入 DPI ping,AVIF 仍为空。

验证:

- `cargo +1.96.0 test -p imgconvert-core probe_webp -- --nocapture`:通过。

边界:

- AVIF 容器级 DPI 仍未声明;本批不改变转换输出与 WebP metadata preserve/strip 策略。

---

## 2026-07-04 — 导入 DPI ping:JPEG EXIF Resolution

Codex 补齐 P1 导入 metadata ping 里遗留的 EXIF Resolution DPI 支持:

- **JPEG EXIF DPI**:`probe()` 在 JPEG APP1 EXIF 中解析 TIFF IFD0 的 `XResolution` / `YResolution` / `ResolutionUnit`,支持 inch 与 centimeter 单位,并换算成现有 `ImageProbe.dpi`。若 JPEG 同时有 JFIF 与 EXIF DPI,优先使用 EXIF,JFIF 作为回退。
- **复用 TIFF 解析边界**:实现复用已有 EXIF/TIFF header 与 IFD entry 解析,新增 RATIONAL 读取函数;遇到非法单位、0 分母、缺失 tag 时保守返回 `None`,不影响尺寸探测。
- **测试覆盖**:新增生成式 JPEG fixture,覆盖 inch 与 centimeter 两种 EXIF Resolution 单位,并保留现有 EXIF orientation 尺寸旋正测试。
- **guardrail**:`release:platform:check` 增加 probe metadata marker,防止后续把 EXIF DPI 解析或测试误删。

验证:

- `cargo +1.96.0 test -p imgconvert-core probe_jpeg -- --nocapture`:通过。

边界:

- WebP/AVIF 容器级 DPI 仍未声明;当前只补 JPEG EXIF Resolution。

---

## 2026-07-04 — Fuzz crash artifact 最小化入口

Codex 在 fuzz/corpus replay 之上补齐 crash artifact triage 的工程入口:

- **dry-run 最小化计划**:新增 `scripts/minimize-fuzz-artifacts.mjs` 与 `pnpm run fuzz:minimize`,默认不调用 `cargo-fuzz`,只扫描 `fuzz/artifacts/<target>/`、校验 target、生成 `target/fuzz-corpus/minimize-report.json`。没有 artifact 时也能稳定通过,适合本机/CI guardrail。
- **显式 tmin 执行**:新增 `pnpm run fuzz:minimize:run`,需要本机已安装 `cargo-fuzz`,并逐个执行 `cargo fuzz tmin <target> <artifact>`。执行后会用现有 `fuzz:replay -- --skip-prepare --include-artifacts` 复跑 minimized artifacts,让 crash 输入进入普通回归。
- **隐私边界**:报告继续只写仓库相对路径或外部 basename,不记录外部真实图片绝对路径;脚本调用 cargo 使用 argv,不拼 shell。
- **guardrail/docs**:`release:platform:check` 校验最小化脚本、package 入口和 report/tmin marker;[FUZZING.md](FUZZING.md) 增加 triage/minimize 使用方式。

验证:

- `pnpm run fuzz:minimize`:通过。

边界:

- 本批不默认运行长时间 fuzz,也不提交真实 crash 样本。真正变异运行仍需开发者显式执行 `cargo fuzz run <target>`。

---

## 2026-07-04 — 质量 heuristics 第二批:PNG WebP-like block hint

Codex 继续补图像质量 heuristics,把“PNG 里包着二次有损来源”的检测从 JPEG 网格扩到 WebP-like 块边界:

- **WebP-like 4x4 块边界 hint**:`detect_lossy_artifacts()` 现在同时返回 `jpeg_grid_score` 与 `webp_block_score`。PNG 中明显 4x4 块边界会触发 hint;Tauri 代际损失防护仍只依赖 `is_some()`,无需前端或命令契约变化。
- **误报收紧**:4x4 检测加入绝对边界差门槛,保守过滤平滑渐变 PNG。单测覆盖 smooth PNG 不误报、JPEG 8x8 fixture 命中、WebP-like 4x4 fixture 命中。
- **质量测试/guardrail**:`test:image-quality` 的 artifact fixture 扩展到 JPEG-grid 与 WebP-like block;`release:platform:check` 静态检查 `webp_block_score`、4x4 scorer 和 integration test,防止后续只保留文案却回退实现。

验证:

- `cargo +1.96.0 test -p imgconvert-core lossy_artifact_hint_detects -- --nocapture`:通过。
- `cargo +1.96.0 test -p imgconvert-core --test image_quality quality_artifact_hint_detects_block_artifact_corpus_fixtures -- --nocapture`:通过。

边界:

- 这是保守启发式,不是来源格式鉴定器;只用于用户开启 `generationLossProtection` 时减少假无损 PNG 的二次有损重压。

---

## 2026-07-04 — GitHub Actions 成本护栏第一批

Codex 按“降低 Actions 账单风险”的方向补齐 repo 侧默认策略:

- **manual-only guardrail**:新增 `scripts/check-ci-cost-guardrails.mjs` 与 `pnpm run ci:cost:check`,静态检查 CI/Linux Release/macOS Smoke/Windows Smoke 都保持 `workflow_dispatch` 手动触发,拒绝 `push` / `pull_request` / `schedule` 自动触发。
- **Linux release 默认降成本**:`release-linux.yml` 的 Docker runtime smoke 默认改为关闭,新增 `build_arm64=false` 默认值;release matrix 默认只跑 amd64,只有显式勾选 `build_arm64` 才加入 `ubuntu-24.04-arm`。
- **CI 可选项细分**:`ci.yml` 新增 `fuzz_corpus=false` 和 `package_smoke_arm64=false`;fuzz corpus replay 作为可选 Ubuntu job,运行 `pnpm run fuzz:ci` 并上传 `target/fuzz-corpus/*.json`。package smoke 默认不再包含 arm64 runner。
- **付费平台确认**:`macos-smoke.yml` 和 `windows-smoke.yml` 新增 `confirm_paid_runner=false`;未显式确认时 job 在调度前跳过,避免误点 workflow 就分配 hosted macOS/Windows runner。
- **文档**:新增 [CI_COSTS.md](CI_COSTS.md),列出默认关闭项与何时开启。

验证:

- `pnpm run ci:cost:check`:通过。

边界:

- 这批不触发远端 GitHub Actions,只修改 repo 侧 workflow 和静态检查。真正远端实跑仍需要你在 GitHub UI 手动选择对应开关。

---

## 2026-07-04 — Fuzz corpus replay 回归入口

Codex 在第一批 fuzz/corpus 入口之上补了一个不依赖 `cargo-fuzz` 的低成本回归闭环:

- **Rust replay example**:新增 `crates/imgconvert-core/examples/replay_fuzz_corpus.rs`,递归读取 `fuzz/corpus/<target>/` 和可选 `fuzz/artifacts/<target>/`,对 decode/probe/thumbnail、bounded convert、metadata semantics 三条路径做普通进程内 replay。每个输入用 `catch_unwind` 捕获 Rust panic,并把输出 magic mismatch 等 invariant 作为失败报告。
- **脚本入口**:新增 `scripts/replay-fuzz-corpus.mjs` 与 `pnpm run fuzz:replay`,默认先准备 generated/real corpus,再运行 Rust replay,并写 `target/fuzz-corpus/replay-report.json`。`pnpm run fuzz:smoke` 现在串起 prepare + fuzz target compile + corpus replay。
- **边界收紧**:`decode_pipeline` 的 thumbnail 调用移到 probe + 像素预算之后,避免真实 corpus 大图在 fuzz/replay smoke 中绕过预算直接触发重解码。
- **guardrail/docs**:`release:platform:check` 会检查 replay 脚本、Rust example、`fuzz:replay`/`fuzz:ci` 入口和 `fuzz:smoke` 包含 replay;[FUZZING.md](FUZZING.md) 已补 corpus replay 使用方式。

边界:

- 长时间变异 fuzz 仍需要手动安装 `cargo-fuzz` 后运行 `cargo fuzz run <target>`。本批目标是让 generated seeds、真实本地 corpus 和后续 minimized crash artifacts 能进入普通 CI/本机回归,不引入额外 GitHub Actions 费用。

---

## 2026-07-04 — Fuzz + 真实图片 corpus 第一批

Codex 为图像管线补上 fuzz 和真实 corpus 的工程入口,同时避免把版权不明/隐私图片放进 Apache-2.0 仓库:

- **cargo-fuzz crate**:新增独立 `fuzz/` crate,并在 workspace 中显式 exclude,避免普通 `cargo test`/`clippy` 被 fuzz 依赖拖慢。三个 target 分别覆盖:
  - `decode_pipeline`:magic、probe、thumbnail、lossy artifact hint 和有界 decode。
  - `convert_pipeline`:通过 probe 和像素预算过滤后,以快速保守参数转 PNG/JPEG/WebP/AVIF,并用 timed API 控制候选边界。
  - `metadata_semantics`:EXIF/XMP/IPTC 任意字节输入的语义检查和规范化。
- **deterministic seeds**:新增 `crates/imgconvert-core/examples/generate_fuzz_corpus.rs`,用 core 自身生成小尺寸 PNG/JPEG/WebP/AVIF 种子、截断容器样本和 metadata 语义样本,不提交二进制图片。
- **真实图片 corpus 导入**:新增 `scripts/prepare-fuzz-corpus.mjs` 与 `pnpm run fuzz:prepare`。脚本从 ignored `corpus/real/` 和 `IMGCONVERT_REAL_CORPUS_DIRS` 导入 magic 识别的 JPEG/PNG/WebP/AVIF,复制到 ignored `fuzz/corpus/*`,并写本地 `target/fuzz-corpus/real-corpus-manifest.json`。`pnpm run fuzz:prepare:require-real` 可在需要真实样张时强制至少导入一张。
- **本地检查入口**:`pnpm run fuzz:check` 编译 fuzz targets;`pnpm run fuzz:smoke` 生成 corpus 后执行编译检查。长时间运行仍用手动 `cargo fuzz run <target>`,避免默认 CI 费用失控。
- **文档/guardrail**:新增 [FUZZING.md](FUZZING.md),并让 `release:platform:check` 校验 fuzz target、真实 corpus 导入脚本和 ignored corpus 目录存在。

边界:

- 本批没有提交第三方真实图片,也没有默认在 CI 跑长时间 fuzz。真实相机样张由本机目录导入;崩溃样本若含私有图片,需要本地最小化或用生成 fixture 复现后再分享。

---

## 2026-07-04 — 平台质量 benchmark 数据闭环第一批

Codex 将之前只有隐藏入口的 platform benchmark 收口成可归档、可复核、可反馈到运行时策略的闭环:

- **benchmark 默认改为 release profile**:`pnpm run bench:platform` 现在默认用 `cargo run --release`,避免 dev profile 数据误导默认参数;`--profile=debug` 仅用于脚本烟测。脚本兼容 pnpm 传入的 `--`,并支持 `--output=` / `--no-output`。
- **报告产物**:脚本仍输出原始 JSON lines,同时生成 `target/benchmarks/*.json`,包含 host、命令参数、samples、median 汇总和默认参数建议。`bench:avif:macos` 复用同一报告层,Apple Silicon 实测也会留下同格式报告。
- **本机 Linux arm64 release 数据**:`1024x768`,quality 82,3 轮。AVIF speed 8:median **432.170 ms**,**34,477 B**,1.820 MP/s;AVIF speed 10:median **175.945 ms**,**67,290 B**,4.470 MP/s。WebP method 4:median **28.280 ms**,**17,220 B**,27.809 MP/s;WebP method 6:median **31.570 ms**,**17,270 B**,24.911 MP/s。
- **默认参数复核**:当前数据下继续保留 **AVIF speed=8**(相对 speed 10 约省 48.8% 体积,虽然慢约 2.46x)和 **WebP method=4**(method 6 同时更慢且更大)。AVIF speed 10 仍可作为用户手动“更快”选择,不改默认。
- **wall-clock 软超时**:core 新增 `convert_best_of_with_color_policy_timeout()` / `convert_auto_quality_with_color_policy_timeout()`。Tauri 转换路径默认每文件 **180s** 软超时,可用 `IMGCONVERT_CONVERT_TIMEOUT_SECONDS` 覆盖,`0/off/disabled/none` 可关闭。由于编码器在进程内运行,单个 C/Rust codec 调用不做强杀;超时会在解码后、候选编码/评分边界停止,并防止超时结果写盘。
- **guardrail**:`release:platform:check` 增加静态检查,防止 benchmark 回退到 debug profile、报告/推荐丢失或 Tauri 绕过软超时。

验证:

- `pnpm run bench:platform -- --output=target/benchmarks/platform-linux-arm64-release-default.json`:通过。
- `cargo +1.96.0 test -p imgconvert-core timed_convert_reports_wall_clock_timeout`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml convert_wall_clock_timeout_parser_handles_defaults_disable_and_clamp`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml runtime_diagnostics_expose_concurrency_and_avif_thread_limits`:通过。

边界:

- 本次为 repo 侧闭环 + Linux arm64 实测。macOS M 系列、Windows x64/arm64 的真实 runner 数据仍建议在对应发布验收时用同一 `bench:platform` 报告格式补齐;为控制 GitHub Actions 费用,本次没有自动触发远端 macOS/Windows benchmark。

---

## 2026-07-04 — 图像质量测试体系第一批

Codex 新增一套可本机和 CI 重复运行的 image quality integration tests,不依赖外部版权图片或大 corpus:

- **固定入口**:`pnpm run test:image-quality` 调用 `scripts/check-image-quality.mjs`,实际运行 `cargo +1.96.0 test -p imgconvert-core --test image_quality`。普通 `cargo test -p imgconvert-core` 也会自动包含这组 integration tests。
- **Golden image**:测试内生成 deterministic RGBA fixtures。PNG/WebP/AVIF lossless 路径必须像素逐字节一致;JPEG/WebP/AVIF 高质量有损路径必须达到 PSNR/MAE 下限,防止编码参数或色彩路径回归成明显劣化。
- **Corrupted input**:覆盖空输入、随机字节、截断 PNG/JPEG/WebP/AVIF、超大 PNG header,要求 probe/thumbnail/convert 均干净失败,不产出伪成功结果。
- **Determinism**:PNG、baseline JPEG、WebP lossless、AVIF lossless 同输入同参数必须字节稳定,用于发现隐藏时间戳、随机 seed 或并发非确定性。
- **Artifact corpus fixture**:内置 JPEG 8×8 网格 synthetic fixture,验证 `detect_lossy_artifacts()` 不漏报,同时 smooth PNG 不误报。

验证:

- `pnpm run test:image-quality`:通过。
- `cargo +1.96.0 test -p imgconvert-core`:通过(61 tests)。

边界:

- 这批是小型 deterministic suite,不是 fuzz/corpus 的替代品。真实相机样张、恶意文件 corpus、跨平台性能/质量数据仍需后续补充。

---

## 2026-07-04 — 语义级 metadata 模块完整实现

Codex 在前两批 raw passthrough / XMP orientation 清理之上,补齐可自动测试、无新增许可风险的语义 metadata 模块:

- **IPTC IIM/JPEG APP13**:`RawMetadata` / `ImageData` 新增 `iptc` blob。JPEG 读取 Photoshop APP13 IRB 中的 IPTC-NAA resource(`0x0404`),开启 `preserveMetadata` 写回最小合法 APP13 resource;默认仍剥离。Tauri 结果缓存 key 在 metadata override 存在时纳入 IPTC,避免同像素不同 metadata 误命中。
- **HEIC sidecar 扩展**:metadata sidecar JSON 向后兼容地新增可选 `iptc` 字段;旧 helper 不受影响。
- **语义检查 API**:新增 `inspect_metadata_semantics()` / `MetadataSemanticReport`,可报告 EXIF orientation、EXIF MakerNote 的 offset/byte_len、IPTC dataset 列表与常见字段名、XMP orientation/history 语义是否存在。MakerNote 与厂商私有字段只识别边界,不做猜测性解析或改写。
- **多命名空间 XMP 清理**:XMP 清理从固定 `tiff:` / `exif:` / `xmpMM:` 前缀扩展为 namespace-aware。若 XMP 用自定义前缀绑定 `http://ns.adobe.com/tiff/1.0/`、`http://ns.adobe.com/exif/1.0/` 或 `http://ns.adobe.com/xap/1.0/mm/`,仍会移除 orientation 与 edit history 语义,保留普通业务字段。
- **回归测试**:新增 JPEG IPTC 默认剥离/显式保留、MakerNote 不改写、IPTC dataset 解析、XMP namespace alias 清理测试。该批不新增依赖,不引入 GPL/AGPL/LGPL。

验证:

- `cargo +1.96.0 test -p imgconvert-core`:通过(56 tests)。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(96 lib tests + 4 bin tests)。

边界:

- 当前仍不猜测 Nikon/Canon/Sony 等 MakerNote 私有字段语义;后续若要做厂商级修正,必须引入真实 corpus 和逐厂商 fixture。
- PNG/WebP/AVIF 仍以 ICC/EXIF/XMP 为原生 metadata 写回范围;IPTC IIM 当前只在 JPEG APP13 中原生写回。

---

## 2026-07-04 — AVIF 真无损对外启用

Codex 将前一批 AVIF lossless spike 收口为对外能力:

- **core 能力打开**:`AVIF_LOSSLESS_SUPPORTED=true`,`LOSSLESS_FORMATS` 加入 `Format::Avif`,`Format::supports_lossless()` 同步返回 true。`lossless=true` 的 AVIF 编码强制 AOM 后端 + identity matrix + full range + quantizer 0 + YUV444,不会把 `quality=100` 冒充成无损。rav1e spike 在本机仍有 1 channel delta,且 libavif 上游明确 rav1e 不支持 lossless,所以有损 AVIF 继续用 rav1e,无损 AVIF 切 AOM。
- **像素级 guardrail**:新增 AVIF lossless RGBA round-trip 回归测试,覆盖透明 alpha,并故意传入 YUV420 请求验证无损路径会强制 YUV444。`probe_avif_lossless_candidate()` 现在以 YUV444 case 是否逐字节一致作为能力支持条件。
- **Tauri/前端同步**:`capabilities().lossless` 通过 core 自动包含 `avif`;前端 web fallback 同步加入 `avif`。Tauri `encode_options_for()` 允许 AVIF lossless 穿透到 core,且代际损失防护不再把 AVIF lossless 目标当作有损目标跳过。
- **边界保持**:AVIF 自动质量仍关闭,AVIF 多候选仍不展开,16-bit/HDR/nclx 落盘保真仍是后续项目。

---

## 2026-07-04 — Review 修复 + 平台 benchmark / AVIF lossless / metadata 语义第二批

Codex 先 review 前几批图像管线改动,修复资源上限问题,再推进三个深水项的可执行闭环:

- **review 修复:metadata 资源上限**:core 新增 `MAX_METADATA_BLOB_BYTES=16 MiB`,与 HEIC helper sidecar 上限一致。JPEG Extended XMP 声明总长、PNG `iCCP`/压缩 `iTXt` 解压结果、WebP/AVIF metadata copy 和各格式写回路径都受该上限约束,避免恶意 metadata 绕过像素上限造成大内存分配。新增 oversized Extended XMP、zlib 膨胀和写入拒绝回归测试。
- **平台质量 benchmark harness**:新增通用 `pnpm run bench:platform` / `scripts/benchmark-platform.mjs`,隐藏入口 `IMGCONVERT_PLATFORM_BENCHMARK=1` 可在 Linux/macOS/Windows/arm64 上输出 AVIF/WebP JSON lines。默认覆盖 AVIF speed 8/10 与 WebP method 4/6,支持宽高、轮数、quality、格式和参数环境变量覆写;旧 `bench:avif:macos` 仍兼容。
- **AVIF 真无损启用尖刺**:`lossless=true` 的 AVIF 内部候选现在尝试 identity matrix + full range + quantizer 0 + YUV444。`probe_avif_lossless_candidate()` 扩为多 case 报告(透明/不透明、YUV444/YUV420 请求、最大通道差和字节数)。`AVIF_LOSSLESS_SUPPORTED` 仍保持 `false`,能力矩阵不声明 AVIF lossless,直到多平台/后端实测完全可逆。
- **metadata 语义第二批**:XMP 语义清理从精确字符串替换升级为轻量 XML token 级处理,覆盖 `tiff:Orientation` / `exif:Orientation` 的属性、普通节点、自闭合节点,并移除 `xmpMM:History` 编辑历史节点。仍不猜测厂商 MakerNote 或 IPTC 私有字段。

验证:

- `cargo +1.96.0 test -p imgconvert-core`:通过(53 tests)。
- `IMGCONVERT_PLATFORM_BENCHMARK_WIDTH=32 IMGCONVERT_PLATFORM_BENCHMARK_HEIGHT=32 IMGCONVERT_PLATFORM_BENCHMARK_ITERATIONS=1 IMGCONVERT_PLATFORM_BENCHMARK_FORMATS=avif,webp IMGCONVERT_PLATFORM_BENCHMARK_AVIF_SPEEDS=10 IMGCONVERT_PLATFORM_BENCHMARK_WEBP_METHODS=0 pnpm run bench:platform`:通过,输出 JSON lines。

剩余边界:

- 平台 benchmark harness 已落地,但 Linux/macOS/Windows/arm64 的真实数据采集和默认参数复核仍需在目标 runner/真机执行。
- AVIF lossless 仍是尖刺路径,未进入 `LOSSLESS_FORMATS` / 前端能力矩阵。
- IPTC、EXIF MakerNote 深层语义解析和相机厂商私有字段修正仍需要 corpus 驱动,当前不做破坏性改写。

---

## 2026-07-04 — 图像管线深水项收尾:容器 XMP 可靠性补齐

在色彩管线 v2 之后,继续补齐 metadata fidelity 里与容器手术相关、可自动测试的深水项:

- **AVIF XMP 接入**:libavif decode 现在读取 `image.xmp`,开启 `preserveMetadata` 编码时调用 `avifImageSetMetadataXMP()` 写回。AVIF 现在与 JPEG/PNG/WebP 一样支持 XMP raw packet 的默认剥离/显式保留。
- **JPEG Extended XMP**:长 XMP 不再因超过单个 APP1 上限而失败。core 会写入标准 XMP marker packet + Extended XMP APP1 分片,读取时按 GUID/总长/offset 重组并覆盖 marker packet。该实现仍是 raw passthrough,不解析 XMP 语义。
- **PNG 压缩 iTXt XMP**:读取端支持 `XML:com.adobe.xmp` 的 zlib 压缩 `iTXt`;写入端继续输出未压缩 iTXt,保持实现简单且可读。
- **跨容器测试扩大**:XMP preserve 测试已覆盖 JPEG/PNG/WebP/AVIF;新增长 JPEG XMP 与压缩 PNG iTXt 回归测试。

验证:

- `cargo +1.96.0 test -p imgconvert-core`:通过(49 tests)。
- `cargo +1.96.0 clippy -p imgconvert-core -- -D warnings`:通过。

边界:

- XMP 仍按 raw packet 透传,只保守清理 orientation;IPTC、MakerNote、XMP editing history 的语义解析仍未做。
- HDR/PQ/HLG/nclx、16-bit/float 容器落盘和 AVIF 真无损启用仍是后续独立项目。

---

## 2026-07-04 — 色彩管线 v2 完整实现:ICC transform、PNG16 与主图线性 resize

在第一批 `PixelBuffer` 边界之上补齐 core 侧可测试闭环:

- **像素级 ICC transform**:新增 permissive `lcms2` 静态依赖(MIT),`ColorManagementPolicy::ConvertToSrgb` 已能把嵌入 ICC 的 `RGBA8/RGBA16/RGBAF32` 像素转换到 sRGB。转换后会清空源 ICC,避免 `preserveMetadata=true` 时把已经转成 sRGB 的像素再写回旧 profile。默认 `convert()` 仍保持原语义,不会强制转 sRGB;需要转色时走 `convert_with_color_policy` / `convert_best_of_with_color_policy` / `convert_auto_quality_with_color_policy`。
- **Tauri/UI 接入**:前端新增「转为 sRGB」开关,`ConvertOptions.colorManagementPolicy` 传入 Tauri,普通/多候选/自动质量三条路径都会调用 core color policy 入口。结果缓存 key 升级为 v4 并纳入 color policy;当策略为 `ConvertToSrgb` 时,HEIC sidecar metadata 即使不保留也会参与缓存 key,因为 ICC 会影响像素结果。
- **16-bit PNG 保真**:`decode_via_image()` 对 16-bit PNG 保留为 `PixelBuffer::Rgba16`;PNG 默认无损编码会写 `ExtendedColorType::Rgba16`,并在 oxipng 阶段关闭 bit-depth reduction。开启实验性 PNG 有损限色时仍显式降到 RGBA8。
- **主图线性 resize API**:新增 `resize_linear(&ImageData, width, height)`,对 `RGBA8/RGBA16/RGBAF32` 保留输入编码,内部做 sRGB transfer → linear、预乘 alpha、bilinear 采样。带非空 ICC 的输入会明确返回 Unsupported,调用方需先 `ConvertToSrgb`,避免按 sRGB 曲线 resize 后又写回旧 ICC。
- **内存修正**:`RGBA16/RGBAF32` 的 LCMS transform 改为固定像素块转换,避免一次性构造整图 typed pixel 副本和输出副本。
- **能力矩阵**:`color_pipeline_capabilities().icc_transform` 与前端 fallback `colorPipeline.iccTransform` 已改为 `true`。

验证:

- `cargo +1.96.0 test -p imgconvert-core`:通过(46 tests,后续容器 XMP 收尾后为 49 tests)。

边界:

- JPEG/WebP/AVIF 编码入口仍会显式落到 RGBA8,不会声明 16-bit/HDR 落盘保真。
- F32 目前作为 0..1 display-referred 内部缓冲参与 ICC/resize;HDR 容器信令、PQ/HLG/nclx 端到端仍是后续项。
- 默认批量转换仍是 metadata 保真策略;用户可显式开启「转为 sRGB」。

---

## 2026-07-04 — 图像管线后续增强:色彩管线 v2 第一批、AVIF lossless probe、metadata 语义与 HEIC sidecar

Codex 启动 ROADMAP「图像管线后续增强路线」里剩余的四个项目,先落地不引入新 copyleft 依赖、可测试的第一批:

- **色彩管线 v2 第一批**:`imgconvert-core::ImageData` 从裸 `rgba: Vec<u8>` 升级为 `PixelBuffer::{Rgba8,Rgba16,RgbaF32}`。现有 JPEG/PNG/WebP/AVIF 编码器仍显式转换到 RGBA8 输出,但管线边界已经能表达 U8/U16/F32,并通过 `color_pipeline_capabilities()` / `capabilities().colorPipeline` 暴露 `linearResize=true`、`iccTransform=false`。ICC 像素级转换不会静默 no-op,请求 `ConvertToSrgb` 会返回 Unsupported。
- **线性空间缩略图 resize**:core `thumbnail()` 从 image crate 普通 resize 改成 sRGB↔linear、预乘 alpha 的 bilinear 缩放,输出仍为 PNG。该范围仅覆盖缩略图路径,不代表主转换 pipeline 已做 ICC transform 或 16-bit/HDR 编码。
- **AVIF 真无损尖刺 guardrail**:新增 `probe_avif_lossless_candidate()` 实测当前 rav1e/libavif 路径是否像素完全一致,但 `AVIF_LOSSLESS_SUPPORTED` 仍为 `false`,AVIF 继续不进入 `LOSSLESS_FORMATS`/前端 lossless 能力矩阵。后续只有验证 identity matrix、quantizer、subsample 与 alpha 组合后才可启用。
- **metadata 语义第一批**:新增公开 `RawMetadata` 与 metadata override 转换入口(`convert_with_metadata` / `convert_best_of_with_metadata` / `convert_auto_quality_with_metadata`)。EXIF orientation 继续规范化为 1;XMP 现在保守移除 `tiff:Orientation` attribute/element,避免像素已旋正后留下二次旋转语义。仍不解析 IPTC/MakerNote/编辑历史。
- **HEIC/helper metadata sidecar**:外部 HEIC manifest args 向后兼容地允许可选 `{metadata}` 独立 argv。helper 可写 `metadata.json` sidecar,引用同一受控临时目录内的 ICC/EXIF/XMP blob;主程序按 JSON/blob 大小上限读取、禁止路径逃逸、规范化 orientation,再把 metadata override 传入 core。老 `{input} {output}` helper 不受影响。
- **缓存修正**:Tauri 结果缓存 key 升级到 v3,当 `preserveMetadata=true` 时会纳入 HEIC sidecar metadata hash,避免相同像素但不同 ICC/EXIF/XMP 的输入误命中缓存。

验证:

- `cargo +1.96.0 test -p imgconvert-core`:通过(41 tests)。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(93 lib tests + 3 bin tests)。

剩余边界:

- 主转换 pipeline 仍未做像素级 ICC transform、16-bit/HDR 编解码或线性空间主图 resize。
- AVIF 真无损仍未启用。
- metadata 语义模块仍未解析 IPTC/MakerNote/XMP editing history;AVIF XMP、JPEG Extended XMP 与 PNG 压缩 iTXt XMP 已在后续容器 XMP 收尾批次接入。

---

## 2026-07-04 — Windows 发布闭环:WIC HEIC、签名、安装 smoke 与 MSIX 留门

Codex 按 Windows 发布第一优先级补齐 repo 侧闭环,并定位了当前远端 Windows runner 失败:

- **runner failure 修复**:最近一次 `Windows Smoke` 失败不是 MSVC/runner 工具链问题,而是 `access::tests::selected_paths_accept_file_urls_for_macos_scoped_dialogs` 在 Windows 下用 Unix `file:///tmp/...` URL 导致解析为 0 个路径。测试已改为平台正确 file URL,本地定向测试通过。
- **Windows WIC HEIC 系统路线**:新增 `src-tauri/src/windows_system_codecs.rs`,Windows 下通过 WIC 探测 HEIF decoder,以 read-only `system-wic` provider 合入 `capabilities()`/`codec_diagnostics()`;HEIC/HEIF/HIF 输入经 WIC 解码并临时写 PNG 后进入现有 core 管线。主程序仍不链接 libheif/x265,不启用 HEIC 输出。
- **HEIC 缺失引导**:插件诊断 UI 新增系统 codec 区块。Windows 缺 HEIF/HEVC 扩展时显示安装 Microsoft HEIF Image Extensions / HEVC Video Extensions 的明确提示;有 WIC decoder 时显示 active provider。
- **直发签名/timestamp**:新增 `scripts/sign-windows-installers.mjs` 与 `pnpm run release:windows:sign` / `release:windows:signed`,支持 `WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PATH` 或 `WINDOWS_CERTIFICATE_SHA1`,固定 SHA-256 digest + RFC3161 timestamp,签后用 `signtool verify /pa /all` 复核。
- **安装后启动 smoke**:新增 `scripts/smoke-windows-installers.mjs` 与 `pnpm run release:windows:install-smoke`,对生成的 `.msi` 和 NSIS `.exe` 做静默安装,再运行安装后的 `ImgConvert.exe` 隐藏真实转换 smoke。
- **Windows Smoke workflow 加强**:`workflow_dispatch` 新增 `sign_direct` 与 `install_smoke` 开关;默认仍只跑低成本 guardrail/Rust/runtime smoke,需要打包、签名、安装 smoke 时显式手动开启并配置 secrets。
- **MSIX / Store 留门**:新增 `packaging/windows/msix/AppxManifest.xml.template` 与 `pnpm run release:windows:msix:prepare`,模板包含 `runFullTrust`、`Windows.FullTrustApplication` 与 desktop extension;Store preflight 继续强制 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`。
- **guardrail 加固**:`release:windows:check` 现在要求签名脚本、安装 smoke、MSIX prepare、Windows WIC 诊断文案和 workflow signing/install-smoke 输入存在。

验证:

- `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`:通过。
- `pnpm run release:windows:check`:通过。
- `pnpm run release:windows:smoke -- --allow-non-windows --skip-convert-smoke`:通过。
- `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 node scripts/prepare-windows-msix-release.mjs --allow-non-windows --allow-missing-store-env`:通过。
- `cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`:通过。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过。
- `cargo +1.96.0 test -p imgconvert-core`、`cargo +1.96.0 clippy -p imgconvert-core -- -D warnings`:通过。
- `cd src-tauri && cargo deny check licenses`:通过。

剩余外部条件:

- Windows WIC 代码需要 GitHub Windows runner 或真实 Windows 机器编译实跑。
- signed installer 需要用户提供 Windows 代码签名证书/密码或证书 thumbprint。
- MS Store 仍需要 Partner Center identity、Windows SDK packaging/signing、Store assets、隐私/年龄分级元数据与提交验收。

---

## 2026-07-03 — GitHub Actions 降本:重型平台 workflow 改手动触发

Codex 发现当前 GitHub 仓库仍是 private,跨平台 GitHub-hosted runner 会消耗私有仓库 Actions 额度;历史 debug Linux artifacts 也接近/超过 Free private 的 storage 包含量。为避免日常 push 继续触发高成本平台构建,先收口仓库侧能控制的默认触发面:

- **macOS/Windows smoke 改手动**:`.github/workflows/macos-smoke.yml` 与 `.github/workflows/windows-smoke.yml` 不再监听 `push main`,只保留 `workflow_dispatch`。macOS HEIC/ImageIO smoke、unsigned DMG、signed/notarized DMG、MAS candidate、Windows runtime smoke 和 unsigned `.msi`/NSIS artifact 都必须显式手动触发。
- **CI 改手动**:`.github/workflows/ci.yml` 不再监听 push/pull_request,只保留 `workflow_dispatch`。默认手动 CI 会跑 Linux 前端质量、Rust core、Tauri backend、security/license 与 Web Preview E2E;Windows HEIC 定向测试需勾选 `platform_checks=true`;Linux package build/install smoke 需勾选 `package_smoke=true`。
- **Linux release 改手动**:`.github/workflows/release-linux.yml` 不再监听 `v*` tag push,避免误打 tag 触发 amd64/arm64 全量包构建;发布时显式手动触发。
- **artifact retention 下调**:debug/package/smoke artifact 保留期从 14/30 天下调到 3/14 天,减少 Actions storage 持续占用。
- **云端 artifact 清理**:已删除历史 `imgconvert-linux-amd64-debug` / `imgconvert-linux-arm64-debug` artifacts,当前云端只保留最新 `imgconvert-macos-arm64-dmg` 小产物,artifact storage 从约 508 MiB 降到约 5.7 MiB。

仍需账号/仓库设置层面处理:

- 若继续全部开源,把 GitHub 仓库从 private 改成 public;public repo 使用标准 GitHub-hosted runners 的 Actions 分钟通常免费,这是最大降本项。
- 在 GitHub Billing 里给 Actions 设置预算/告警,防止失败 workflow 或误触发继续烧钱。当前 GitHub 远端已因支付/支出限制拒绝启动新的 GitHub-hosted runner;在账号侧处理前不要手动触发重型 workflow。
- 后续若要高频跑 Windows/macOS,优先接自托管 runner 或只在 release/tag 阶段手动触发。

---

## 2026-07-03 — macOS 发布闭环:DMG/MAS 脚本、scoped persistence 与 GitHub-hosted smoke

Codex 在 macOS 第一批能力之后补齐发布链路的 repo 侧闭环:

- **macOS scoped dialog 持久化**:前端 Tauri dialog 在 macOS 设置 `fileAccessMode: "scoped"`;后端注册 `tauri-plugin-fs` 和 `tauri-plugin-persisted-scope`,capability 仅加入 `fs:scope`,用于保存 dialog 授权范围。导入/转换路径继续通过 `macos_security.rs` 的 RAII start/stop 进入 security-scoped resource 生命周期。
- **直发 DMG 入口**:新增 `pnpm run release:macos` / `release:macos:verify`,构建前清理旧 `.dmg`,构建后用 `scripts/check-macos-bundle-artifacts.mjs` 校验命名、版本、非空 artifact;verifier 会读取 `.app` 的 `CFBundleExecutable`,不再硬编码可执行名。
- **显式公证闭环**:新增 `pnpm run release:macos:notarize` 与 `scripts/notarize-macos-dmg.mjs`,支持 notarytool keychain profile、App Store Connect API key 或 Apple ID/app-specific password 三种凭据,并串起 `notarytool submit --wait`、`stapler staple`、`spctl` 和 signed/notarized artifact verifier。
- **MAS candidate 入口**:新增 `scripts/prepare-macos-mas-release.mjs`,从 `APPLE_TEAM_ID` 与 provisioning profile 生成 team/application identifier entitlement、MAS config 和 `embedded.provisionprofile` 映射;新增 `pnpm run release:macos:mas` 构建 signed `.app` candidate,`pnpm run release:macos:mas:pkg` 用 `productbuild` 生成可上传 `.pkg`。
- **GitHub-hosted macOS smoke 升级**:`.github/workflows/macos-smoke.yml` 默认在 `macos-15` arm64 上生成 HEIC fixture 并跑 ImageIO 路径转换 smoke;手动触发可构建 unsigned `.dmg`,或导入 Apple `.p12` secrets 后构建 signed/notarized `.dmg`;也可生成 MAS signed `.app` candidate 和可选 `.pkg` artifact。
- **guardrail 加固**:`release:macos:check` 现在要求 macOS release/MAS/notarize/pkg 脚本存在,检查 fs/persisted-scope 依赖与注册、`fs:scope` capability、MAS `Info.macos.mas.plist` 加密声明、generated entitlement 关键字段和 macOS README 发布步骤。

限制:

- 本仓库已具备自动化入口和 CI wiring,但真实 Developer ID 签名、公证、MAS provisioning、App Store Connect 上传/TestFlight/审核仍依赖 Apple Developer 账号和仓库 secrets。
- MAS sandbox 的 GUI 文件选择授权 prompt、重启后授权恢复和输出目录交互仍需用签名 MAS candidate 在真实 macOS 桌面上人工验收。

验证:

- 本机后续检查见本次 Codex 输出;macOS `.dmg`/MAS artifact 构建、公证和 Gatekeeper 只能在 GitHub-hosted macOS 或真实 macOS 机器上实跑。

---

## 2026-07-03 — Windows 阶段第一批:runner smoke 与直发安装包闭环

Codex 在 macOS HEIC GitHub-hosted smoke 通过后,启动 Windows 阶段第一批,先落地不需要签名证书/Partner Center 的真实 runner 闭环:

- **Windows runtime smoke 聚合**:新增 `scripts/smoke-windows-runtime.mjs` 与 `pnpm run release:windows:smoke`。Windows runner 会跑 direct/store guardrail,再通过隐藏 `IMGCONVERT_PACKAGE_CONVERT_SMOKE=1` 二进制入口做 JPEG/WebP/PNG/AVIF 真实转换 smoke,不启动 GUI。
- **Windows 直发安装包入口**:新增 `pnpm run release:windows`,先清理旧 `.msi`/NSIS bundle,再执行 `pnpm tauri build --ci --bundles msi,nsis`,最后用 `scripts/check-windows-bundle-artifacts.mjs` 校验 artifact 非空、版本号和命名。`pnpm run release:windows:verify` 可单独复核已生成产物。
- **Windows Smoke workflow**:新增 `.github/workflows/windows-smoke.yml`。当前为手动触发,默认跑 Windows typecheck、release guardrail、Tauri backend fmt/clippy/test 和 runtime conversion smoke;可打开 `build_direct` 构建 unsigned `.msi`/NSIS `.exe` 并上传 artifact。
- **guardrail 加固**:`release:windows:check` 现在要求 Windows runtime/build smoke 脚本存在,并要求 `package.json` 暴露 `release:windows:smoke` 与带 artifact verifier 的 `release:windows`。

限制:

- 本批次当时不包含代码签名、timestamp、SmartScreen 声誉、MSIX、`runFullTrust`、Partner Center 或真实安装后启动 smoke。直发 artifact 是 unsigned candidate,用于验证 Windows 编译/打包链路;这些项已在后续 Windows 发布闭环章节补齐 repo 侧入口。
- Windows WIC HEIC 系统路线当时未实现;后续已补为 `system-wic` read-only provider。

## 2026-07-03 — macOS 阶段第一批:ImageIO HEIC 导入、security scope 钩子与 AVIF benchmark

Codex 启动 macOS 阶段开发,先落地可在当前仓库合入且不会污染主依赖树的第一批:

- **macOS ImageIO HEIC read-only provider**:新增 `src-tauri/src/macos_system_codecs.rs`,macOS 下通过系统 `ImageIO.framework` 把 HEIC/HEIF 转码为 PNG 字节再进入现有 core 管线。该 provider 以 `system-imageio` 暴露到 `capabilities().codecProviders`,只加入 readable,不加入 writable;不链接 libheif、不捆绑 x265、不启用 HEIC 输出。
- **诊断/前端同步**:插件诊断 UI 与引擎文案识别 `system-imageio`,macOS 显示为系统 ImageIO,不再误归类为外部 helper。`IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` 仍只禁外部 helper/manifest,不禁系统 ImageIO。
- **security-scoped resource RAII 钩子**:新增 `src-tauri/src/macos_security.rs`,通过 `CFURLStartAccessingSecurityScopedResource` / `CFURLStopAccessingSecurityScopedResource` 包住用户授权路径生命周期。导入扫描和单次转换读写路径已接入 `access::scoped_path_access()`;Linux/Windows 为 no-op。
- **Apple Silicon AVIF benchmark 入口**:新增隐藏二进制入口 `IMGCONVERT_AVIF_BENCHMARK=1` 与 `pnpm run bench:avif:macos`,用于在 M 系列上实测 rav1e speed 8/10。该结果后续用于复核 macOS 默认 AVIF speed。
- **review 修复**:ImageIO HEIC decode 从整文件 `CFData` 输入改为 `CGImageSourceCreateWithURL`,只读取前 64 bytes 做 HEIF magic 校验,降低大 HEIC 文件的输入内存峰值;benchmark 增加像素/迭代预算,避免环境变量误设触发超大 RGBA 分配;导入扫描恢复旧的根路径入栈顺序,同时保留 security scope 生命周期。
- **macOS runtime smoke 聚合**:新增隐藏 `IMGCONVERT_PATH_CONVERT_SMOKE=1` 路径转换 smoke 和 `pnpm run release:macos:smoke`。macOS 真机可通过 `IMGCONVERT_MACOS_HEIC_SMOKE_INPUT=/path/to/sample.heic pnpm run release:macos:smoke` 验证 ImageIO HEIC 样张走完整 `convert()` 管线,也可加 `--build-direct` 或 `--notarize-dmg` 覆盖打包/公证路径。
- **macOS release guardrail 加固**:`release:macos:check` 现在校验 ImageIO bridge、read-only HEIC provider、security scope start/stop shim、benchmark 脚本和 macOS README 关键发布步骤。

限制:

- 当前 Linux 开发机无法执行真实 ImageIO/MAS sandbox/notarytool smoke;`cargo +1.96.0 check --target aarch64-apple-darwin` 已尝试,但停在 Linux 本机 `cc` 不支持 `objc2-exception-helper` 需要的 `-arch arm64` / `-mmacosx-version-min=11.0`,仍需 macOS runner 或完整 osxcross 工具链。`release:macos:smoke --allow-non-macos --skip-benchmark --skip-heic` 只代表脚本/guardrail 预检。macOS 实机仍需跑 HEIC 导入、MAS bookmark、AVIF benchmark、`.dmg` 签名/公证。
- security scope 当前是路径级 start/stop 钩子;持久化 MAS 访问仍需要文件选择层拿到真实 security-scoped bookmark data 后接入。

验证:

- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(90 lib tests + 3 bin tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`:通过。
- `pnpm run typecheck`:通过。
- `pnpm run format:check`:通过。
- `pnpm run release:macos:check`:通过。

---

## 2026-07-02 — CI 远端实跑修复:RustSec 上游 advisory 例外边界

Codex 推送 GitHub Actions 后实跑主 CI,修复 Linux/Windows/许可证几轮环境差异,并把最后的 RustSec 阻断收口为显式边界:

- **远端 CI 已实跑到主链路**:Frontend、Rust Core、Tauri Backend、Windows HEIC 外部 codec 协议测试、Web Preview E2E 均通过。Security job 最后卡在 RustSec advisory,不是 GPL/AGPL/LGPL 许可红线。
- **Tauri patch 更新**:`src-tauri/Cargo.lock` 更新 `tauri 2.11.3 -> 2.11.5`、`tauri-runtime-wry 2.11.3 -> 2.11.4`。该更新未改变 `tauri-utils 2.9.3 / plist 1.9.0 / quick-xml 0.39.4` 约束。
- **显式 RustSec 例外**:`src-tauri/deny.toml` 和 `scripts/audit-rust-advisories.mjs` 记录当前上游例外 ID。范围包括 Tauri Linux GTK3/WebKitGTK 栈的 gtk-rs GTK3 unmaintained advisory、Tauri `plist -> quick-xml` 配置解析链的 `quick-xml` 0.39.x advisory、以及 Tauri/rav1e 构建链的 unmaintained-only advisory。
- **风险边界**:`quick-xml` 不是 ImgConvert 图片输入解码路径,来自 Tauri 配置/plist 处理链;普通 `cargo update -p quick-xml` 被 `plist 1.9.0` semver 约束挡住,当前上游需等 `plist/tauri-utils` 切到 `quick-xml >=0.41.0` 后删除例外。
- **CI 调整**:GitHub Security job 继续跑 `license:check`、`cargo deny check bans sources advisories`、Rust audit 和 `pnpm audit --prod`;Rust audit 改由 `pnpm run audit:rust` 注入同一组显式 ignore,避免 deny/audit 两套例外漂移。

---

## 2026-07-02 — 图像管线后续增强:质量 heuristics 第一批 + AVIF lossless guardrail

Codex 继续推进 P2/P3 后的图像管线增强,本批先落地可自动测试、无新增许可风险的守门项:

- **AVIF 真无损负向 guardrail**:`imgconvert-core` 新增 `AVIF_LOSSLESS_SUPPORTED=false` 常量和单测,继续保证 AVIF 不进入 `LOSSLESS_FORMATS` / capabilities lossless。当前 rav1e 后端没有完成像素级可逆验证,因此不会用 `quality=100` 冒充真无损。
- **自动质量耗时上限**:core 新增 `AUTO_QUALITY_MAX_SCORING_EVALUATIONS=7`,并给二分搜索评分次数加测试。JPEG 最坏 6 次 SSIMULACRA2 评分;WebP 额外比较一次 lossless 候选。搜索失败回退最高质量时复用已评估的 max 候选,避免重复编码/评分。
- **假无损 PNG hint**:core 新增 `detect_lossy_artifacts()` 第一版,检测 PNG 中明显 JPEG 8x8 网格痕迹。Tauri 代际损失防护在 `generationLossProtection=true` 时把这类 PNG 当作有损来源处理;该结果只是保守 hint,不改变默认可读/可写格式矩阵。
- **诊断暴露**:`runtime_diagnostics()` 增加自动质量最大评分次数,便于后续 UI/日志展示。

仍未完成:

- 色彩管线 v2(`PixelBuffer { U8, U16, F32 }`、ICC transform、线性 resize、16-bit/HDR)仍未开始。
- 语义级 metadata 模块、HEIC/helper metadata sidecar、AVIF/WebP 平台 benchmark 仍在后续项。

---

## 2026-07-02 — 图像管线后续增强规划 + XMP 透传第一批

Codex 梳理 P2/P3 后的图像管线剩余增强项后,先落地一批低风险、Linux 可验证、无新增许可风险的 metadata fidelity 增强:

- **后续方案拆分**:ROADMAP 新增“图像管线后续增强路线”,把 AVIF 真无损、`8/16/float` 像素表示 + ICC transform/线性 resize、语义级 metadata、HEIC/helper metadata passthrough 和质量 heuristics 拆成独立后续项。当前不把 RGBA8 管线伪装成像素级色彩管理。
- **XMP raw packet 透传**:`imgconvert-core` 的 `ImageData` / `Metadata` 增加 `xmp` 字段。JPEG 支持 APP1 Adobe XMP namespace,PNG 支持未压缩 `iTXt XML:com.adobe.xmp`,WebP 支持 `XMP ` chunk 与 VP8X XMP flag。默认仍剥离;只有 `preserveMetadata=true` 才写回。
- **容器替换语义**:PNG/WebP 写回时会替换旧 XMP chunk,避免重复堆叠;WebP 重建 VP8X 时按当前输出 alpha 与 metadata 重新置位 ICC/EXIF/XMP flags。
- **当时边界保持清晰**:AVIF 仍只保留 ICC/EXIF,XMP 暂不接入;XMP 只做 raw packet 透传,不解析 XML,不改写 XMP 内可能存在的 orientation/IPTC/编辑历史字段;JPEG extended XMP 分片与 PNG 压缩 `iTXt` XMP 暂不保留。2026-07-04 的容器 XMP 收尾批次已补齐这些容器级 raw passthrough 项。
- **测试覆盖**:core 单测扩展 JPEG/PNG/WebP metadata 默认剥离/开启保留断言,并新增 PNG 源跨 JPEG/PNG/WebP 的 XMP 保留测试。

验证:

- `cargo +1.96.0 fmt --all -- --check`:通过。
- `cargo +1.96.0 test -p imgconvert-core`:通过。
- `cargo +1.96.0 clippy -p imgconvert-core -- -D warnings`:通过。
- `pnpm run format:check`:通过。
- `pnpm run check`:通过。

---

## 2026-07-02 — P3 review 修复:Flatpak 真实运行闭环 + Display P3 ICC 端到端测试

Codex review Flatpak 与色彩保真剩余缺口后补齐两项可复跑护栏:

- **Flatpak 真实运行 smoke**:新增 `scripts/smoke-flatpak-runtime.mjs` 与 `pnpm run release:flatpak:smoke`。脚本会准备 source archive、添加缺失的 Flathub user remote、用 `flatpak-builder --user --install-deps-from=flathub --install` 构建/安装,再分别通过 `flatpak-builder --run` 和安装后的 `flatpak run --user --command=imgconvert` 运行隐藏转换 smoke。Flatpak 主包仍设置 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`,不启用 HEIC/helper。
- **review 修复:Flatpak runtime EOL**:本机 smoke 首跑时 Flathub 提示 `org.gnome.Sdk 48` 已于 2026-03-24 EOL;manifest 升到当前可解析的 GNOME `50` runtime,避免发布包建立在过期 runtime 上。
- **review 修复:AppStream metadata license**:真实 Flatpak build 的 `appstreamcli compose` 拒绝 `<metadata_license>Apache-2.0</metadata_license>`;metainfo 改为 AppStream 常用的 `CC0-1.0` 元数据许可,`project_license` 继续保持 `Apache-2.0`。
- **Display P3 / ICC 端到端测试**:`imgconvert-core` 新增自生成 Display P3 ICC fixture,覆盖 P3 PNG 输入在 `preserveMetadata=true` 下转换到 JPEG/PNG/WebP/AVIF 后 ICC 逐字节保留。PNG/WebP lossless 路径同时验证像素不变;JPEG/AVIF 验证尺寸和 ICC 元数据保真。
- **文档清理**:更新 Flatpak README 与 ENGINE,删除“发行版 runtime smoke 仍未覆盖 Debian/Ubuntu/Fedora”的过期表述,明确当前 Display P3 范围是 ICC 元数据保真而非像素级色彩管理。

---

## 2026-07-02 — P3 Linux 发布最后一公里:Flathub source bundle + 包内转换 smoke

Codex review Linux/Flathub 发布链路后补齐两个发布前缺口:

- **Flathub source bundle**:`packaging/flatpak/io.github.yeagoo.imgconvert.yml` 不再使用仓库根 `type: dir` source,改为 `type: archive` release source。新增 `pnpm run release:flatpak:prepare`,会生成 `target/flatpak/sources/imgconvert-<version>-source.tar.gz`,把 pnpm 自身通过 Corepack vendor 到 `.flatpak-vendor/corepack.tgz`,把 Cargo 依赖 vendor 到 `.flatpak-vendor/cargo`,把 pnpm 包 fetch 到 `.flatpak-vendor/pnpm-store`,并回写 manifest 的 archive `sha256`。本地/CI 默认写 `path:` source;Flathub PR 可在发布该 archive 后用 `--source-url=https://.../imgconvert-<version>-source.tar.gz` 切换为可下载 `url:` source。
- **Flatpak guardrail 升级**:`release:flatpak:verify` 现在拒绝 `type: dir`、host/home filesystem、HEIC helper/libheif/x265 和在线 `corepack prepare pnpm@...`,并要求 node/rust SDK extension、offline Corepack cache、offline pnpm install、offline Cargo build、合法 archive `path:`/`url:` source 和 store 外部 codec 禁用环境。
- **包内真实转换 smoke**:安装后的 `imgconvert` 二进制新增隐藏入口 `IMGCONVERT_PACKAGE_CONVERT_SMOKE=1`。该入口不启动 GUI,会用真实 `imgconvert-core` 链路把内置 16×16 PNG 转成 JPEG/WebP/PNG/AVIF,验证 magic 与尺寸后退出。
- **Linux package smoke 升级**:`scripts/smoke-linux-package-install.mjs` 增加 `--convert-smoke`;Docker matrix 默认在 GUI 启动 smoke 后继续跑包内真实转换 smoke。AppImage 路径同样使用 `APPIMAGE_EXTRACT_AND_RUN=1`。

限制:

- 当前容器缺 `flatpak-builder`/`flatpak`,因此本批次完成 manifest/source bundle/guardrail 和二进制转换 smoke 的本机验证;真实 Flatpak build/install/portal runtime smoke 仍需在安装 Flatpak 工具的 Linux runner 上跑。

---

## 2026-07-02 — P3 后续平台:Windows 打包与 Store 护栏第一批

Codex review 后补上 Windows 平台发布留门里的实际配置检查,避免 `release:windows:check` 只验证图标和 store 环境开关:

- **Windows 直发配置**:新增 `src-tauri/tauri.windows.conf.json`,面向 `.msi`/NSIS 直发路线。配置锁定 `allowDowngrades=false`、`digestAlgorithm=sha256`、silent `embedBootstrapper` WebView2 安装、最低 WebView2 版本、稳定 WiX `upgradeCode` 和 NSIS current-user 默认安装。
- **guardrail 升级**:`scripts/check-platform-release-guardrails.mjs` 的 Windows direct 分支现在会读取 `tauri.windows.conf.json` 并验证上述安装/升级边界;新增 `release:windows:direct:check` 便于 CI 分批定位。
- **MS Store 留门**:新增 `packaging/windows/README.md`,明确 Store 仍需 Windows runner、MSIX、`runFullTrust`、Partner Center 和真实安装 smoke;`release:windows:store:check` 继续要求 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`,防止外部 HEIC helper 自动发现进入商店构建。

验证:

- `pnpm run release:windows:direct:check`:通过。
- `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 pnpm run release:windows:store:check`:通过。
- 未设置 `IMGCONVERT_DISABLE_EXTERNAL_CODECS` 时 `pnpm run release:windows:store:check` 按预期失败。
- `pnpm run release:windows:check`、`pnpm run release:platform:check`、`IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 pnpm run release:store-env:check`:通过。
- `pnpm tauri build --ci --debug --no-bundle --config src-tauri/tauri.windows.conf.json`:通过,确认新增 Windows 配置可被 Tauri CLI 合并/解析。

限制:

- 本批次不等同于完成 Windows 发布;真实 `.msi`/NSIS 构建、代码签名、MSIX 打包、MS Store 提交、WIC HEIC 运行时探测和 Windows 真机 smoke 仍需在 Windows runner/真机上完成。

---

## 2026-07-02 — P3 后续平台:macOS 打包与沙盒护栏第一批

Codex 在 Linux v1 RC 后继续推进后续平台发布留门,先完成 macOS 可静态验证的打包与沙盒配置骨架:

- **macOS 直发配置**:新增 `src-tauri/tauri.macos.conf.json`,Tauri 在 macOS 构建时会自动合并该平台配置;默认使用 hardened runtime 与 `entitlements.macos.direct.plist`,不启用 App Sandbox,面向 `.dmg` / Developer ID / notarization 直发路线。
- **MAS 配置骨架**:新增 `src-tauri/tauri.macos.mas.conf.json` 与 `entitlements.macos.mas.plist`;MAS entitlements 只声明 App Sandbox、用户选择文件读写和 app-scoped bookmarks,不加 broad filesystem、network server 或 temporary exception entitlement。
- **guardrail 升级**:`scripts/check-platform-release-guardrails.mjs` 现在会读取 macOS 平台配置和 entitlements plist,验证直发/MAS 两套权限边界;新增 `release:macos:direct:check`、`release:macos:store:check`、`release:windows:store:check`。
- **文档**:新增 `packaging/macos/README.md`,记录直发 `.dmg` 和 MAS candidate 的本地 preflight/构建命令。MAS build 必须设置 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`,保证外部 HEIC helper 自动发现被编译期关闭。

验证:

- `pnpm run release:macos:check`:通过。
- `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 pnpm run release:macos:store:check`:通过。
- 未设置 `IMGCONVERT_DISABLE_EXTERNAL_CODECS` 时 `pnpm run release:macos:store:check` 按预期失败。

限制:

- 本批次不等同于完成 macOS 发布;真实 `.dmg` 构建、Developer ID 签名、公证、MAS provisioning、security-scoped bookmark runtime shim 和 HEIC ImageIO 沙盒实测仍需在 macOS runner/真机上完成。

---

## 2026-07-02 — P3 review 修复 + Linux 发布收尾

Codex review P3 第一批发布链路后继续推进 Linux 发布闭环:

- **review 修复:stale artifact**:新增 `scripts/clean-linux-bundles.mjs`,release/debug release 脚本会先清理对应 bundle 目录,避免 artifact verifier 吃到旧包误判通过。
- **review 修复:Linux desktop metadata**:`tauri.conf.json` 补 `publisher`/`homepage`/`licenseFile`/`category`/长短描述/Linux deb section,重新生成的 `.desktop` 已有 `Categories=Graphics;Photography;`,`.deb` 已有 `Homepage`、`Section: graphics` 和长描述。
- **artifact verifier 升级**:`scripts/check-linux-bundle-artifacts.mjs` 不再只校验非空文件;现在会校验版本号、`.deb` 依赖字段、包内 `/usr/bin/imgconvert`、`ImgConvert.desktop`、desktop entry 的 `Name/Type/Exec/Categories`,并对 rpm/AppImage 做基础结构检查。`.deb`/`.rpm` 被选中时必须有 `dpkg-deb`/`rpm` 检查工具,避免“没检查也通过”。
- **release workflow**:新增 `.github/workflows/release-linux.yml`,支持 tag `v*` 和手动触发,在 Linux amd64/arm64 runner 上构建 release `.deb/.rpm/AppImage` 并上传 artifact。
- **安装启动 smoke**:新增 `scripts/smoke-linux-package-install.mjs`。CI/debug `.deb` 构建后会安装 package 并启动一次;脚本支持 Docker 模式,且启动层同时支持 `xvfb-run` 和裸 `Xvfb`,Fedora 容器不再依赖 Debian 专属 wrapper。AppImage smoke 设置 `APPIMAGE_EXTRACT_AND_RUN=1`,避免 Docker/FUSE 缺失导致误报。
- **发行版 runtime matrix**:新增 `scripts/smoke-linux-package-matrix.mjs` 与 `pnpm run release:linux:smoke:docker`,正式 Linux release workflow 会在 amd64/arm64 上跑 Ubuntu `.deb`、Debian `.deb`、Fedora `.rpm`、Ubuntu AppImage smoke。
- **release checksums**:新增 `scripts/generate-linux-release-checksums.mjs`;`pnpm run release:linux` 会生成 `src-tauri/target/release/bundle/SHA256SUMS`,workflow 会随 artifact 上传。
- **Flatpak 第一版**:新增 `packaging/flatpak/io.github.yeagoo.imgconvert.yml`、desktop/metainfo 与 `pnpm run release:flatpak:verify`。manifest 不申请 host/home filesystem,主包设置 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`,不捆绑 HEIC/helper;Flathub 正式提交仍需把本地 `dir` source 换成 release tarball + vendored Cargo/npm inputs。
- **review 修复:AppImage 系统库冲突**:发现 Tauri AppImage 会捆入 `libgcrypt.so.20`,在 Ubuntu 24.04 容器中与系统 `libgpg-error` 组合触发符号不匹配。新增 `scripts/scrub-linux-appimage.mjs`,release/debug all 打包后会删除 deny-list 系统库并用 Tauri 缓存的 `linuxdeploy-plugin-appimage.AppImage` 重新打包。
- **review 修复:AppImage symlink 防回归**:repack 复制 AppDir 时使用 `verbatimSymlinks`,避免 `.DirIcon`/`ImgConvert.desktop`/`imgconvert.png` 被改写成宿主机绝对 symlink。artifact verifier 现在会解包 AppImage,拒绝 host-absolute root symlink,拒绝捆绑 `libgcrypt.so.20`,并复用通用 Linux bundle 检查覆盖 `usr/bin/imgconvert`、GLIBC 基线和 `.desktop` 元数据。
- **review 修复:Docker runtime smoke**:AppImage Docker smoke 先复制只读挂载文件再 `chmod`,补装 `libasound2t64`/`libasound2`,并支持 `IMGCONVERT_DOCKER_APT_MIRROR` 覆盖 Ubuntu apt 源以降低本机实测波动。Docker 不可直接访问时脚本会自动尝试 `sudo -n docker`。
- **下一阶段平台发布护栏**:新增 `scripts/check-platform-release-guardrails.mjs` 与 `release:platform:check` / `release:macos:check` / `release:windows:check` / `release:store-env:check`。该脚本静态校验 macOS/Windows 发布元数据、平台图标、Apache-2.0 许可证和“商店构建禁外部 codec/helper”的 build-time 机制;`--require-store-env` 可在实际 store build 前强制要求 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`。

验证:

- `pnpm run release:linux:debug`:通过,重新生成 debug `.deb` 并通过增强 artifact verifier。
- `pnpm run release:flatpak:verify`:通过。
- `node scripts/generate-linux-release-checksums.mjs --profile=debug --bundles=deb`:通过。
- `pnpm run release:linux`:通过,生成 release `.deb`/`.rpm`/AppImage 与 `SHA256SUMS`;AppImage scrub 日志确认移除 `libgcrypt.so.20`。
- `pnpm run release:linux:verify`:通过,增强 verifier 校验三类 release artifact。
- `IMGCONVERT_DOCKER_APT_MIRROR=http://mirrors.aliyun.com/ubuntu-ports pnpm run release:linux:smoke:docker -- --timeout=8`:通过,完整覆盖 Ubuntu `.deb`、Debian 13 `.deb`、Fedora `.rpm`、Ubuntu AppImage。
- `pnpm run release:platform:check`:通过。
- `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 pnpm run release:store-env:check`:通过;未设置该环境变量时按预期失败。
- `dpkg-deb -f`:确认 `Version: 0.1.0`、`Section: graphics`、`Homepage: https://github.com/yeagoo/imgconvert`、运行时依赖 `libwebkit2gtk-4.1-0, libgtk-3-0`。
- `dpkg-deb -x`:确认 `.desktop` 中 `Categories=Graphics;Photography;`。

## 2026-07-01 — P2 review 修复 + P3 Linux 发布第一批

Codex 对 P2 高级压缩收尾做了一轮后端 review,并启动 P3 Linux release 闭环:

- **P2 缓存策略修复**:`result_cache_key()` 升级到 v2,自动质量启用时把 `qualityFloor` 对应的搜索下限纳入 key,避免同一质量上限但不同 floor 复用错误输出。
- **P2 策略一致性修复**:结果缓存命中后也会复用 `skip-if-larger` 与代际损失防护检查,不再绕过当前用户策略。
- **测试覆盖**:Tauri 后端新增缓存 key/floor 差异测试与缓存候选策略检查测试。
- **P3 发布入口**:新增 `pnpm run release:linux` / `release:linux:debug` / `release:linux:debug:all` / `release:linux:verify`;正式 release 入口显式构建并校验 `deb,rpm,appimage` 三类 Linux bundle artifact,debug smoke 默认只打 `.deb` 以避免 debug rpm/AppImage 后处理过慢。
- **P3 CI 第一批**:GitHub Actions 的 Tauri build smoke 改为 Linux `amd64 + arm64` 矩阵,使用原生 runner 构建 debug `.deb` 并上传 artifact。

## 2026-07-01 — P2 收尾:自动质量、代际防护、缓存与高级参数

Codex 完成 P2 剩余高级压缩功能项:

- **自动质量**:core 新增 `convert_auto_quality()`。仅 JPEG/WebP 启用,用 `ssimulacra2`(BSD-2-Clause,`default-features=false`)按 step≈4 二分搜索达到目标分的最低质量;自动质量不低于格式质量下限,小于 8×8 的图片回退固定质量。WebP 会把 lossless 候选纳入比较,若更小则选 lossless。
- **代际损失防护**:Tauri 对 JPEG/AVIF/lossy WebP 源再次输出有损格式时,按 source bpp 分级要求最低体积收益(默认 2%/3%/5%/8%);收益不足计 skipped,避免有损源无意义重压。VP8L lossless WebP 不触发该保护。
- **结果缓存**:新增 `blake3` 设置哈希 + 源文件哈希缓存。缓存默认开启,只记录已有输出的 hash/size,命中时直接返回结果;不把图片内容写入缓存目录。
- **PNG 实验性限色**:新增 `color_quant`(MIT)限色路径,默认关闭;开启后先 NeuQuant 映射 RGBA,再输出普通 PNG 并继续走 oxipng。继续禁止 `imagequant`/GPL。
- **高级参数面板**:core/Tauri/前端贯通 AVIF subsample(4:4:4/4:2:0)、WebP near-lossless/sharp YUV、MozJPEG trellis scans,设置持久化并纳入多候选去重与缓存 key。
- **CI 进阶**:GitHub Actions 增加 Tauri Linux debug build smoke;既有 npm license/audit、cargo-deny、cargo-about 生成校验继续作为 P2/P3 guardrail。

验证:

- `cargo test -p imgconvert-core`:通过(32 tests)。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(78 tests)。
- `pnpm run check`:通过。
- `pnpm run test`:通过(4 tests)。

---

## 2026-07-01 — P1.5 HEIC 平台收尾 review 修复

Codex 修复 P1.5 HEIC 平台 review 提出的边界问题:

- **平台开关收窄**:外部 HEIC helper 自动发现从 `Unix + Windows` 收敛为 `Linux + Windows`;macOS 不再进入 XDG/Library helper 探测,继续留给 P3 的 ImageIO / App Sandbox 验证。
- **Windows 临时目录**:HEIC helper 解码 PNG 的工作目录改到 `%LOCALAPPDATA%\ImgConvert\Temp\heic\imgconvert-heic-*`,不再使用全局 temp 根目录;Unix 仍使用 0700 私有临时目录。
- **Windows 覆盖**:新增 Windows-only 单测覆盖 `.exe` helper 要求、LocalAppData codecs PATH 探测、大小写不敏感且分段安全的路径前缀判断、工作目录落点;CI 新增 `windows-latest` 的 `external_codecs` 定向测试。

---

## 2026-07-01 — P1.5 HEIC 平台收尾:Windows 外部 helper

Codex 补齐 P1.5 HEIC 平台剩余的外部 helper 路径:

- **Windows helper 启用**:外部 codec/helper 发现从 Unix 扩展到 Windows;Windows 可通过用户手动选择 `imgconvert-heic-helper.exe`、manifest provider 或受信任 PATH 目录激活 decode-only HEIC 导入。
- **Windows 信任边界**:manifest 自动发现加入 `%LOCALAPPDATA%\ImgConvert\codecs` 与 `%PROGRAMDATA%\ImgConvert\codecs`;自动发现只接受 canonical 后位于 Program Files、ProgramData/ImgConvert/codecs 或 LocalAppData/ImgConvert/codecs 下的目录。用户显式选择的 helper 可在其它位置,但仍必须是普通 `.exe` 文件,且调用不经过 shell。
- **helper 名称**:系统/插件 PATH 探测新增 `imgconvert-heic-helper`,同时保留 Linux `heif-convert` / `heif-dec`。主程序仍不链接 libheif/libde265/x265,不把 LGPL/GPL 组件放入主依赖树。
- **诊断 UI**:插件诊断文案增加 Windows 免费 helper 路线,强调 helper/provider 是 decode-only、单独分发、可被商店/Flatpak 构建禁用。
- **阶段边界**:Windows WIC + HEIF/HEVC 扩展探测仍属于 P3 平台发布项;本批次只完成免费外部 helper 协议与信任模型,不承诺 HEIC 开箱即用。

---

## 2026-07-01 — P2 第五批:ICC/EXIF 元数据保真

Codex 完成 P2 元数据保真的第一版容器闭环:

- **默认隐私语义不变**:`preserveMetadata=false` 时 JPEG/PNG/WebP/AVIF 重新编码后仍显式剥离 ICC/EXIF;只有用户开启“保留元数据”才写回。
- **core 容器手术**:JPEG 提取/写入 APP1 EXIF 与 APP2 ICC(含 1-based 分块重组);PNG 在 oxipng 之后 splice `iCCP`/`eXIf`;WebP 重写 RIFF chunk,必要时插入/更新 `VP8X` 并写 `ICCP`/`EXIF`;AVIF 走 libavif 的 ICC/EXIF metadata API。
- **EXIF orientation 防双旋**:JPEG/PNG 解码经 image crate 真旋正像素后,保留的 EXIF orientation 改写为 1;WebP/AVIF 当前未做几何 transform,因此只保留原始 EXIF payload。
- **Tauri/前端接通**:`ConvertOptions.preserveMetadata` 不再报“未实现”,经 `EncodeOptions.preserve_metadata` 传入 core;设置栏“保留元数据”开关启用并持久化。
- **测试覆盖**:core 新增 JPEG/PNG/WebP/AVIF 元数据默认剥离、开启后逐字节保留、JPEG ICC 分块与管线跨格式保留测试;Tauri 映射测试覆盖 preserve flag。

验证:

- `cargo test -p imgconvert-core`:通过(28 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(72 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `pnpm run check`:通过。
- `pnpm run deadcode`:通过。
- `pnpm run test`:通过(4 tests)。
- `pnpm run build`:通过。
- `pnpm run e2e`:通过(Chromium Web 预览 smoke 1 test)。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL,第三方许可证清单未过期。
- `cargo deny check bans sources`:通过;Tauri 依赖树重复版本仍只输出 warning。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`pnpm run format:check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:启动链路到达 `Running target/debug/imgconvert` 后按预期由 timeout 结束。

---

## 2026-07-01 — P0.5 技术风险闭环:工具链/授权路径/并发诊断

Codex 收口 P0.5 剩余技术风险的最小可验证闭环:

- **原生工具链预检**:新增 `scripts/check-native-toolchain.mjs` 与 `pnpm run toolchain:check`,检查 cmake / meson / ninja,并仅在 x86/x86_64 检查 NASM;脚本接入 `quality:rust`,缺依赖时给明确安装提示。
- **授权路径边界**:新增 `src-tauri/src/access.rs`,把用户选择路径、输出目录和剪贴板临时文件统一收口为授权路径 grant。该层不强制 canonicalize,为 Flatpak portal 映射路径和 macOS security-scoped bookmark 生命周期留接口。
- **并发诊断**:`imgconvert-core` 新增 `AVIF_ENCODER_MAX_THREADS=1` 常量并用于 libavif encoder;Tauri 新增 `runtime_diagnostics()` 命令暴露默认并发、内存预算、RGBA 工作集倍率和 AVIF 内部线程上限。
- **测试稳定性**:HEIC selected-helper 相关测试增加串行锁,避免并发测试共享全局 helper 白名单导致偶发 provider 判定漂移。
- **阶段边界**:P0.5 已完成本机可验证 guardrail;Debian/Ubuntu/Fedora × amd64/arm64、Flatpak portal runtime smoke、macOS bookmark shim 和 Apple Silicon AVIF speed 仍属于 P3/平台阶段实测。

验证:

- `pnpm run toolchain:check`:通过(linux/arm64;cmake 3.31.6,meson 1.7.0,ninja 1.12.1;NASM 按 arm64 跳过)。
- `pnpm run quality:frontend`:通过。
- `pnpm run quality:rust`:通过(core 23 tests;src-tauri 71 tests)。
- `cargo test -p imgconvert-core`:通过(23 tests)。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(71 tests)。
- `pnpm run e2e`:通过(Chromium Web 预览 smoke 1 test)。
- `pnpm run quality:security`:通过;`cargo deny check bans sources` 仍有 Tauri 依赖树重复版本 warning,但不阻断。
- `pnpm run format:check`:通过。
- `git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:启动链路到达 `Running target/debug/imgconvert` 后按预期由 timeout 结束。

---

## 2026-07-01 — P2 第四批:质量下限阈值

Codex 完成全局有损/无损开关与每格式质量下限的最小闭环:

- **前端设置**:保留现有全局“无损压缩”开关,继续仅对 PNG/WebP 生效;JPEG/WebP/AVIF 在格式参数区新增“最低质量”滑块。
- **阈值语义**:质量下限按 `30..=100` 生效,低于 30 视为关闭;默认下限为 30,避免极低质量误操作,但后端旧 IPC 缺字段时按关闭处理。
- **Tauri 映射**:`ConvertOptions` 新增 `quality_floor`(camelCase:`qualityFloor`);进入 core 前对 JPEG/WebP/AVIF 的有损质量做 `max(quality, floor)` clamp。PNG 和 WebP 无损模式不应用有损质量下限。
- **自动质量留门**:后续 `ssimulacra2` 二分搜索必须以该下限作为最低质量边界。

验证:

- `pnpm run check`:通过。
- `pnpm run test`:通过(4 tests)。
- `pnpm run quality:frontend`:通过。
- `pnpm run quality:rust`:通过(core 23 tests;src-tauri 68 tests)。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(68 tests)。
- `cargo test -p imgconvert-core`:通过(23 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `pnpm run e2e`:通过(Chromium Web 预览 smoke 1 test)。
- `pnpm run format:check`:通过。
- `git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:启动链路到达 `Running target/debug/imgconvert` 后按预期由 timeout 结束。

---

## 2026-07-01 — P2 第三批:多候选取最小

Codex 完成多候选取最小的第一版:

- **core 能力**:新增 `convert_best_of(input, target, options)`。输入只解码一次,再用多个 `EncodeOptions` 编码候选竞争,返回体积最小的候选;原 `convert()` 保持单候选兼容。
- **Tauri 候选生成**:`multi_candidate`(camelCase:`multiCandidate`)默认开启。JPEG 在 baseline/progressive 间竞争;PNG 在用户级别、相邻级别、默认 4、最高 6 间去重竞争;WebP 在用户 method、4、6 间竞争;AVIF 暂不加候选,避免慢编码成倍放大。
- **语义边界**:候选不会偷偷改变 quality、lossless、目标格式或 AVIF speed;需要精确按单一参数输出时可在 UI 关闭“多候选取最小”。
- **测试修复**:HEIC manifest helper 执行增加短暂重试,规避测试 helper 刚写入后 Linux 偶发 `Text file busy`。

验证:

- `cargo test -p imgconvert-core`:通过(23 tests)。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(67 tests)。
- `pnpm run quality:frontend`:通过。
- `pnpm run quality:rust`:通过(core 23 tests;src-tauri 67 tests)。
- `pnpm run quality:security`:通过;`cargo deny check bans sources` 仍有 Tauri 依赖树重复版本 warning,但不阻断。
- `pnpm run e2e`:通过(Chromium Web 预览 smoke 1 test)。
- `timeout 25s xvfb-run -a pnpm tauri dev`:启动链路到达 `Running target/debug/imgconvert` 后按预期由 timeout 结束。

---

## 2026-07-01 — P2 第二批:skip-if-larger / 永不变差

Codex 完成 P2 的输出防变大闭环:

- **Tauri 策略**:`ConvertOptions` 新增 `skip_if_larger`(camelCase:`skipIfLarger`),默认开启;core 编码完成后、写文件前比较候选输出大小与源文件大小,若候选不小于源文件则直接跳过写入。
- **覆盖保护**:即使用户选择 overwrite,变大候选也不会替换已有输出文件;原地优化同样受保护。
- **批量协议**:skip-if-larger 命中时通过既有 `FileSkipped` 事件计入 skipped,不会记为 failed;前端队列显示跳过原因和源/候选字节数。
- **前端设置**:`SettingsBar` 新增默认开启的“跳过变大输出” switch;需要强制格式迁移时用户可以关闭。
- **边界说明**:本批次只做单候选大小防护,不做多候选竞争;自动质量阶段的“省不到 2% 也跳过”阈值后续再接。

验证:

- `pnpm run quality:frontend`:通过。
- `pnpm run quality:rust`:通过(core 21 tests;src-tauri 66 tests)。
- `pnpm run quality:security`:通过;`cargo deny check bans sources` 仍有 Tauri 依赖树重复版本 warning,但不阻断。
- `pnpm run e2e`:通过(Chromium Web 预览 smoke 1 test)。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

---

## 2026-07-01 — P2 第一批:格式级编码参数

Codex 启动 P2 保真/压缩阶段,先完成可见且低风险的 per-format 参数闭环:

- **core 参数扩展**:`EncodeOptions` 新增 `jpeg_progressive`、`png_oxipng_level`、`webp_method`、`avif_speed`,默认值锁为 JPEG progressive=true、oxipng=4、WebP method=4、AVIF speed=8。
- **编码器落地**:JPEG 可切 baseline/progressive;PNG 从固定 oxipng preset 改为用户级别 0..6;WebP 改用 `webp::WebPConfig` + `encode_advanced()` 传入 method/lossless/quality;AVIF `libavif-sys` encoder speed 改为来自参数,继续保持 `maxThreads=1`。
- **Tauri 协议**:`ConvertOptions` 增加对应 camelCase IPC 字段并保留 serde default,旧前端/旧配置缺字段时仍按 P2 默认值运行;`convert_image` / `convert_batch` 统一经 `encode_options_for()` 传入 core。
- **前端设置**:`SettingsBar` 新增“格式参数”区,JPEG 显示 progressive switch,PNG/WebP/AVIF 显示 shadcn slider;设置持久化和归一化会 clamp 到合法范围。
- **测试覆盖**:core 新增默认值、JPEG SOF marker 和参数 clamp 测试;Tauri 新增 `ConvertOptions -> EncodeOptions` 映射测试。

验证:

- `cargo test -p imgconvert-core`:通过(21 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(64 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run format:check`:通过。
- `pnpm run test`:通过。
- `pnpm run build`:通过。
- `pnpm run e2e`:通过(Chromium Web 预览 smoke 1 test)。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

---

## 2026-07-01 — 质量体系 v1

Codex 按当前 Tauri 2 + Svelte 5 + Rust core 架构补齐第一版可执行质量门:

- **前端质量门**:新增 `typecheck`(`tsc --noEmit` + `svelte-check`)、`lint`(ESLint flat config + Svelte/TS rules)、`format:check`(Prettier + Svelte plugin)、`deadcode`(Knip 文件/依赖扫描)、`test`(Vitest) 与 `e2e`(Playwright Web 预览 smoke)。
- **测试基线**:新增 `tests/state.test.ts`,覆盖格式能力映射、队列去重/跳过与大小格式化;新增 `e2e/app.spec.ts`,验证 Web 预览 shell 能加载。
- **工程入口**:新增 `quality:frontend` / `quality:rust` / `quality:security` 聚合脚本与 `Makefile`;默认 security gate 保持本机可重复,只跑 license、deny bans、deny sources,在线 RustSec 检查保留在 `audit:rust` 与 CI。
- **CI**:新增 `.github/workflows/ci.yml`,分层跑 frontend、Rust core、Tauri backend、security/license 与 Playwright Web preview E2E。
- **格式基线**:补 `.prettierrc.json` / `.prettierignore`,并把 shadcn button 的 module exports 拆到 `button.ts`,让裸 `tsc --noEmit` 能稳定检查。

验证:

- `pnpm run quality:frontend`:通过。
- `pnpm run quality:rust`:通过(core 18 tests;src-tauri 63 tests)。
- `pnpm run quality:security`:通过;`cargo deny check bans sources` 仍会输出 Tauri 依赖树重复版本 warning,但不阻断。
- `pnpm run e2e`:通过(Chromium Web 预览 smoke 1 test)。
- `pnpm run audit:npm`:通过,无 prod npm 漏洞。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。
- `git diff --check`:通过。

---

## 2026-07-01 — P1.5 收尾:许可边界与手动 helper 白名单

Codex 在 review 后继续推进 P1.5 收尾:

- **review 修复**:剪贴板临时文件清理改为后端状态登记,`cleanup_imported_temp_file()` 只会删除本次运行中由 `import_clipboard_image()` 创建并登记的文件,不再仅凭 `/tmp/imgconvert-clipboard-*` 路径前缀判断;paste 导入同时读取 `DataTransfer.items`,覆盖部分 WebView/桌面环境截图不出现在 `DataTransfer.files` 的情况。
- **渠道禁用开关**:新增 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1|true|yes|on`,支持运行时或构建时禁用外部 codec/helper 自动发现。禁用后 HEIC manifest 与系统 helper 都不会激活,诊断 UI 会显示禁用原因。
- **诊断字段**:`codec_diagnostics().heic` 新增 `externalCodecsEnabled` 与 `disabledReason`,用于区分“未安装 helper”和“渠道/构建主动禁用”。
- **用户显式 helper 白名单**:新增 `set_selected_heic_helper(path|null)` 命令,前端在插件诊断弹层中选择/清除本机 HEIC helper,设置路径随用户配置持久化;能力检测时先同步该白名单。
- **provider 优先级**:HEIC provider 激活顺序调整为手动 helper → manifest provider → 系统 PATH helper。手动 helper 有效时保存 canonical 可执行文件路径;失效路径只进入诊断状态,显示为不可用但不会执行。
- **许可/专利文案**:插件诊断 UI 增加“许可与渠道边界”,明确主程序不内置 HEIC codec、不链接 libheif、不分发 x265;HEIC 仅通过用户环境里的可选 decode-only provider 导入,插件许可/NOTICE/专利风险需单独处理。
- **前端文案**:引擎状态与诊断标题统一使用“HEIC 可选导入”,避免写成开箱即用的 HEIC 支持。
- **review 修复 2**:外部 helper/manifest 发现改为 canonical 路径后再校验目录信任、文件写权限和执行权限;manifest 读取限制为 64 KiB 并新增超限错误码;剪贴板导入区分 scan/clipboard 模式,取消按钮可中断剪贴板循环并清理未入队临时文件;临时文件清理改为用已登记 canonical 路径验证和删除,避免 alias 路径导致登记丢失。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(63 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo test -p imgconvert-core`:通过(18 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

---

## 2026-07-01 — P1 剪贴板导入最小闭环

Codex 完成 P1 最后一个导入小项:

- **粘贴入口**:Dropzone 新增「粘贴导入」按钮,主窗口监听 `Ctrl+V`/系统 paste;图片 Blob 直接导入,不影响文件名模板等输入框里的普通文本粘贴。
- **路径兼容**:剪贴板文本支持 `file://`、`text/uri-list`、GNOME `x-special/gnome-copied-files` 与绝对路径,统一复用既有 `scan_import_paths` 扫描/过滤/去重。
- **图片 Blob 落盘**:新增 `import_clipboard_image()` Tauri 命令,把 PNG/JPEG/WebP/AVIF 剪贴板图片写入私有临时目录,返回现有 `ImportScanFile` 元数据,后续缩略图、批量转换、取消协议不另开分支。
- **清理边界**:剪贴板临时图片标记为 `temporary`,队列移除/清空时调用 `cleanup_imported_temp_file()`;后端只清理本应用创建的 `imgconvert-clipboard-*` 私有临时目录下文件。
- **安全与限制**:单张剪贴板图片上限 128 MiB;Linux 文件管理器复制文件时依赖剪贴板是否暴露 `file://`/路径文本,不尝试从 WebView 猜测不可见本机路径。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(54 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo test -p imgconvert-core`:通过(18 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

---

## 2026-07-01 — P1.5 插件诊断 UI

Codex 完成插件诊断 UI 的第一版:

- **后端诊断命令**:新增 `codec_diagnostics()` Tauri 命令,返回 HEIC 是否启用、active provider、manifest 搜索目录、每个 manifest 的 accepted/rejected 状态与系统 helper 探测结果。
- **诊断信息粒度**:manifest 目录会区分 missing / empty / ready / rejected / untrusted / unreadable;manifest 文件返回具体拒绝原因,包括许可、协议、可写 HEIC、路径逃逸、helper 不可执行等错误码前缀。
- **前端入口**:顶栏新增「插件诊断」按钮;弹层展示 HEIC 状态、active provider 执行文件与 argv、探测摘要、系统 helper 列表和 manifest 搜索明细。
- **运行边界**:网页预览返回空诊断;Tauri 桌面端执行本机只读探测,不启动 helper、不解码文件。
- **review 修复**:helper stdout 直接丢弃,stderr 走管道并限制为 64 KiB;helper 生成的临时 PNG 读取限制为 512 MiB,避免异常 helper 填满磁盘或内存。非 Unix 平台在尚未实现平台信任模型前不启用外部 HEIC helper/manifest 自动发现;诊断弹层每次打开都会刷新,顶栏引擎文案在窄屏截断。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(51 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo test -p imgconvert-core`:通过(18 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

---

## 2026-07-01 — P1.5 HEIC manifest 插件协议最小闭环

Codex 完成 HEIC 插件 manifest v1 的第一版可运行闭环:

- **manifest 发现**:新增 `IMGCONVERT_CODEC_PLUGIN_DIRS`、XDG user data、XDG system data 三层搜索;优先读取 `imgconvert-codec-heic.json`,再读取同目录其它 `imgconvert-codec-*.json`。
- **协议校验**:v1 manifest 要求 `protocol:1`、`mode:"external-process"`、`decode.kind:"heic-to-png-file"`、`output:"png"`;`readable` 只能声明 `heic/heif/hif` 且必须含 `heic`;`writable` 必须为空;拒绝 GPL/AGPL 许可。
- **安全边界**:manifest helper 可用 manifest 目录内相对路径或受信任目录绝对路径;相对路径禁止 `..`,解析后不能逃出 manifest 目录;`args` 只做 argv 模板替换,`{input}` / `{output}` 必须是独立 argv entry,不执行 shell。
- **能力矩阵**:`capabilities()` 新增 `codecProviders`,HEIC manifest provider 会以 `{ kind:"manifest", license, readable, writable }` 形式返回;系统 `heif-convert` fallback 以 `kind:"system-helper"` 返回;前端引擎文案区分「插件」与「系统 helper」。
- **兼容路径**:manifest provider 优先于系统 PATH helper;未安装 manifest 时仍保持 `heif-convert` / `heif-dec` 系统 helper fallback。

验证:

- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(47 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo test -p imgconvert-core`:通过(18 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

---

## 2026-06-30 — P1.5 HEIC 系统 helper 导入最小闭环

Codex 完成 HEIC decode-only 的第一批实现,主程序依赖树仍保持 Apache-2.0 / 禁 GPL-AGPL-LGPL:

- **外部进程边界**:新增 `src-tauri/src/external_codecs.rs`,运行时探测系统 `heif-convert` / `heif-dec`,通过 argv + 临时 PNG 文件调用,不使用 shell 拼接,不链接 `libheif`。
- **能力矩阵合并**:`capabilities()` 在检测到 helper 时把 `heic` 加入 `readable`,但不加入 `writable`;前端只把 HEIC 作为源格式/导入能力展示,目标格式下拉仍只来自 `capabilities.writable`。
- **导入与转换路径**:`scan_import_paths` 仅在 helper 可用时接受 `heic/heif/hif`;`convert_image` / `convert_batch` 对 HEIC 输入先经 helper 解码为 PNG 字节,再进入现有 `imgconvert-core::convert()` 管线;异步缩略图同样复用该 decode 路径。
- **安全与错误边界**:调用 helper 前验证 HEIF/HEIC `ftyp` 文件头;HEIC 临时目录在 Unix 下以 `0700` 创建并在 Drop 中清理;helper PATH 目录及其祖先不能 world-writable;helper 缺失、超时、输出缺失、stderr 诊断都会返回到前端错误信息。
- **该批次限制**:当时尚未实现 manifest 插件协议、用户显式选择 helper、Windows WIC/helper 路线;真实 HEIC 样张 smoke 已在安装 `libheif-examples` 后补跑通过。

验证:

- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(43 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo test -p imgconvert-core`:通过(18 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。
- `libheif-examples` 1.19.8 真实 helper smoke:用 `heif-enc` 生成临时 `.heic`,再调用当前 `external_codecs::decode_heic_to_png()` 成功读回 PNG 字节。

---

## 2026-06-30 — HEIC 插件策略文档化

Codex 记录 HEIC 可选插件路线,并按许可/平台依赖做了一轮方案 review:

- **主程序边界**:ImgConvert 主程序继续 Apache-2.0,依赖树继续禁止 GPL/AGPL/LGPL;HEIC 不作为主包内置 codec。
- **插件形态**:HEIC 作为独立进程 helper/plugin,单独 LGPL 分发,用户显式安装后激活;主程序只做 manifest 发现、能力合并和受控进程调用。
- **Linux 差异**:Debian/Ubuntu 可提示 `libheif-examples` 等系统工具;Fedora 的 HEVC-encoded HEIC 可能需要 RPM Fusion `libheif-freeworld`;`heif-gdk-pixbuf`/`heif-thumbnailer` 只影响 GTK/文件管理器,不能等同于 core 能力。
- **Windows 免费路线**:系统路线仍是 WIC + HEIF/HEVC 扩展;若要避免要求用户购买 Microsoft Store HEVC 扩展,可另做 decode-only `imgconvert-heic-helper.exe`。注意不能直接整包带现成 MSYS2 `libheif` 发行物,因为依赖组合可能包含 `x265`/GPL;需要自建 decode-only 动态包并单独审计。
- **功能范围**:插件第一版只声明 HEIC/HEIF 输入,不提供 HEIC 输出,不承诺 HEIC 开箱即用。
- **渠道边界**:外部 helper 只作为主包外直发/用户安装增强;商店/Flathub 构建默认禁用,避免破坏现有上架前提。

Review 结论:

- 方案不破坏当前主程序 Apache-2.0/禁 LGPL 规则,前提是保持**独立进程 + 独立分发 + decode-only + 不打包 x265**。
- 最大剩余风险是 HEVC 专利与各发行版 codec 组件可用性,因此需要运行时探测和平台化错误提示,不能写营销式“支持 HEIC”。

## 2026-06-30 — P1 文件可靠性:EXIF 旋正、内存预算与失败提示

Codex 完成 P1 剩余文件可靠性三项的第一版可运行闭环:

- **EXIF orientation 真旋正**:`imgconvert-core` 的 image-crate 解码路径读取 `ImageDecoder::orientation()` 并在 RGBA 中间图上执行 `apply_orientation()`;JPEG→任意目标和异步缩略图共享同一旋正行为。当前 re-encode 不透传 EXIF blob,因此不会把旧 orientation tag 再写出去造成二次旋转。
- **导入尺寸驱动批量降并发**:前端把导入阶段探测到的 `sourceWidth/sourceHeight` 随转换参数传给 Tauri;后端按 `width*height*4*3` 估算单任务工作集,在 768 MiB 保守预算下把实际 worker 数压低。无尺寸提示的任务按 128 MiB 估算,core 仍保留真实尺寸上限校验。
- **失败路径与半成品提示细化**:输入读取、输出目录创建、临时文件创建、输出写入/替换等错误现在包含具体路径;写入失败会尝试清理临时文件或失败输出,并把「已清理半成品 / 清理失败」写进错误消息。
- **JPEG probe 显示尺寸同步**:`probe()` 解析 JPEG APP1 EXIF orientation 后返回旋正后的显示宽高,导入元数据与内存预算使用同一显示尺寸语义。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL,第三方许可生成物保持最新。
- `cargo test -p imgconvert-core`:通过(18 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(33 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

限制:

- 批量内存预算是保守启发式,不是 OS 级内存 cgroup;极端编码器内部峰值仍可能高于估算。
- ICC/EXIF 完整透传仍留在 P2「高级压缩与保真」;当前行为是像素旋正后重新编码,不保留原始元数据 blob。

## 2026-06-30 — P1 文件可靠性:目录结构与时间戳

Codex 完成 P1「保留目录结构 + 保留源文件修改时间」的第一版可运行闭环:

- **导入相对目录**:`scan_import_paths` 对目录递归导入的文件返回 `relativeDir`,表示从用户选择的目录根到文件父目录的相对路径;直接导入单文件时为空。
- **输出目录结构**:前端把队列项 `relativeDir` 传入转换参数;后端仅在设置了 `outDir` 时把安全相对目录拼到输出目录下,从而把目录导入结果输出为同样的子目录结构。
- **路径穿越防护**:后端拒绝绝对路径、`..` 等非法相对目录片段,并对目录片段做文件名级清理,避免前端参数被篡改后写出授权输出目录外。
- **保留修改时间**:转换开始前读取源文件 modified time,写出成功后 best-effort 设置到输出文件;覆盖写也先捕获源时间,避免同路径覆盖时丢失原始 mtime。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL,第三方许可生成物保持最新。
- `cargo test -p imgconvert-core`:通过(16 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(28 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

限制:

- 当前保留的是修改时间(mtime),不是访问时间/创建时间。
- 若目标文件系统不支持设置时间戳,转换不会因为时间戳设置失败而失败;后续如需要严格模式可把失败作为 warning 暴露给前端。

## 2026-06-30 — P1 ask 覆盖统一协议最小闭环

Codex 完成 P1「ask 覆盖策略纳入批量协议」的第一版可运行闭环:

- **转换规划命令**:新增 `plan_conversions(options)`。后端复用既有输出路径规则,按 batch 下标返回 `{ index, input, output, exists, error }`,供前端在转换开始前判断哪些文件需要覆盖确认。
- **ask 决策前置**:`settings.overwrite === "ask"` 不再走前端逐文件 `convert_image` 串行分支;前端先根据规划结果逐项确认,确认覆盖的 job 改成 `overwrite`,取消覆盖的 job 改成 `skip`。
- **转换统一走 batch**:ask 模式收集完决策后同样调用 `convert_batch` + Tauri Channel,因此进度、取消、并发、单文件跳过/错误汇总与 skip/overwrite 模式保持一致。
- **竞态语义**:规划时不存在、转换前新出现的输出文件按 `skip` 处理,走 no-clobber 写入路径,避免 ask 模式在竞态下意外覆盖。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL,第三方许可生成物保持最新。
- `cargo test -p imgconvert-core`:通过(16 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(24 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

限制:

- 覆盖确认仍是逐项系统 dialog,尚未做批量冲突列表弹窗。
- 后端 Channel 仍是单向进度通道;用户交互决策保持在前端开始批量转换前完成。

## 2026-06-30 — P1 异步缩略图最小闭环

Codex 完成 P1「异步生成缩略图」的第一版可运行闭环:

- **core 缩略图接口**:`imgconvert-core::thumbnail(bytes, max_edge)` 复用现有 JPEG/PNG/WebP/AVIF 解码器,按最长边缩放并输出小 PNG;全透明图片返回 `None`,前端保留格式占位。
- **Tauri 缩略图命令**:新增 `generate_thumbnail(options)`。前端只传已导入的本机路径,后端在 blocking 线程读取文件并返回 `{ mime, width, height, bytes }`;缩略图最大边限制在 `32..512`。
- **前端异步懒加载**:队列卡片进入视口附近才请求缩略图,全局并发固定为 2;返回字节转 Blob URL 展示,移除/清空队列时释放 URL。
- **卡片展示**:原先格式占位升级为稳定尺寸的预览区;缩略图加载中显示小 spinner,失败或全透明时继续显示格式图标,不影响转换状态。
- **review 修复**:缩略图命令生成前先检查文件元数据,超过 256 MiB 的源文件直接跳过预览,避免后台预览读取巨大伪图片;清空/移除队列时同步清理未执行的缩略图等待队列。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL,第三方许可生成物保持最新。
- `cargo test -p imgconvert-core`:通过(16 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(22 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

限制:

- 当前缩略图不做磁盘缓存;重新导入同一文件会重新生成。
- 缩略图仍需完整解码源图,只是通过懒加载和并发 2 控制 CPU/内存峰值;后续大目录可再接虚拟列表或持久缓存。

## 2026-06-30 — P1 导入元数据 ping 最小闭环

Codex 完成 P1「导入阶段尺寸/DPI ping」的第一版可运行闭环:

- **core 头部探测接口**:`imgconvert-core::probe(bytes)` 返回 `ImageProbe { format, width, height, dpi }`,覆盖 PNG/JPEG/WebP/AVIF。PNG 解析 `pHYs` DPI,JPEG 解析常见 JFIF density;WebP/AVIF 当前返回尺寸,DPI 为空。
- **导入扫描携带元数据**:`scan_import_paths` 对每个候选文件限量读取前 512 KiB 做头部 ping;探测失败不阻断导入,只让 `metadata` 为空。返回 `ImportScanFile { path, key, metadata }`。
- **前端队列展示**:队列项保存导入元数据,卡片在文件路径下显示 `宽×高` 与 DPI;源格式优先使用后端 magic 探测结果,扩展名只作回退。
- **review 修复**:并发批量启动前新增输出路径预检,同一 batch 中重复目标路径会在 worker 启动前报错,避免 overwrite/skip/no-clobber 在文件级并发下出现抢写竞态。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `cargo test -p imgconvert-core`:通过(14 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(20 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo fmt --check`:通过。

限制:

- 当前只做导入元数据 ping,尚未生成缩略图。
- DPI 当前覆盖 PNG `pHYs`、JPEG JFIF density 与 JPEG EXIF Resolution;WebP/AVIF 容器级 DPI 后续随元数据保留一起扩展。
- Tauri 扫描阶段最多读取每个文件前 512 KiB;极端 JPEG/AVIF 若尺寸信息晚于该范围,会保守返回空 metadata,不影响导入。

## 2026-06-30 — P1 并发批量最小闭环

Codex 完成 P1「Rust 端文件级并发批量」的第一版可运行闭环:

- **受控文件级并发**:`convert_batch` 从串行循环改为全局工作队列 + 固定 worker 上限。默认并发为 `available_parallelism - 1` 后 clamp 到 `1..8`;前端新增「并发」滑块,`0` 表示自动,`1..8` 表示手动上限。
- **Channel 汇聚**:worker 不直接操作 Tauri Channel,而是把单文件事件发送给 Rust coordinator;coordinator 统一按接收顺序发 `fileStarted` / `fileProgress` / `fileFinished` / `fileSkipped` / `fileError` / `finished`,前端既有队列进度处理保持不变。
- **取消语义**:取消仍使用 `CancellationToken`,worker 在文件边界停止领取新任务;正在编码的单文件结束后再汇报。`ask` 覆盖策略仍走前端逐文件确认路径,并发批量覆盖 skip/overwrite 路径。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL,第三方许可生成物保持最新。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(18 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo test -p imgconvert-core`:通过(12 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

限制:

- 尚未实现按图片尺寸/内存预算动态降并发。
- `ask` 覆盖确认尚未纳入后端统一批量协议。

---

## 2026-06-30 — P1 文件导入层最小闭环

Codex 完成 P1「拖拽/文件夹导入」的第一版可运行闭环:

- **Rust 导入扫描命令**:新增 `scan_import_paths(options)`。前端传入用户显式选择/拖拽的文件或目录,后端用 `std::fs` 显式栈扫描目录,由 core 可读格式自行派生扩展名过滤,并以规范化路径去重。扫描结果返回 `ImportScanResult { files: [{ path, key }], skipped, errors, truncated, cancelled, limitReason }`,权限/缺失路径等错误按条目记录,不让单个坏路径中断整批导入。
- **扫描防护与取消**:扫描默认限制为 20k 文件、100k 路径条目、64 层深度(后端硬上限继续兜底);超过限制会返回截断原因。新增 `cancel_import_scan()` + `ImportScanState`,前端导入中可取消扫描,取消结果不把半批文件塞入队列。
- **符号链接边界**:普通符号链接文件可作为文件导入;符号链接目录不递归,避免目录循环和越过用户明确授权边界。
- **前端统一入口**:`Dropzone` 增加「选择文件夹」,文件选择、文件夹选择、Tauri 原生拖拽都统一调用 `importPaths()`,并显示已添加/重复/跳过/错误数量。队列使用后端返回的 canonical `key` 跨批次去重;导入错误可展开查看前几条明细。导入扫描期间禁止清空、移除、转换和设置改动,避免队列竞态。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `pnpm run license:check`:通过,未发现 GPL/AGPL/LGPL,第三方许可生成物保持最新。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(16 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。
- `cargo test -p imgconvert-core`:通过(12 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `cargo fmt --check`、`cargo +1.96.0 fmt --manifest-path src-tauri/Cargo.toml --check`、`git diff --check`:通过。
- `timeout 25s xvfb-run -a pnpm tauri dev`:按预期由 timeout 结束;启动链路到达 `Running target/debug/imgconvert`。

限制:

- Flatpak portal 与 macOS security-scoped bookmark 尚未接入;当前只是把输入导入路径收口到可替换的 Rust 边界。
- 剪贴板粘贴、导入尺寸/DPI ping、异步缩略图仍在 P1 待办。

---

## 2026-06-30 — P0.5 许可合规最小闭环

Codex 完成 P0.5「许可清单尖刺」的第一版可运行闭环:

- **Rust 许可闸门**:`src-tauri/deny.toml` 现在可由 `pnpm run license:rust` 调用 `cargo deny check licenses`,继续禁止 GPL/AGPL/LGPL,并显式放行当前依赖树里确认过的宽松 SPDX(IJG / NCSA / Apache-2.0 WITH LLVM-exception)。
- **第三方许可产物**:新增 `src-tauri/about.toml` / `about.hbs` 与 `scripts/generate-third-party-licenses.mjs`;`pnpm run license:third-party` 会用 `cargo-about` 生成 Rust 许可全文,并从已安装 npm 包读取 `LICENSE` / `NOTICE` / `COPYING` 等文件全文,写入根目录和 `public/THIRD_PARTY_LICENSES.md`。
- **npm 许可扫描**:新增 `scripts/check-npm-licenses.mjs`;`pnpm run license:npm` 基于 pnpm 自带 JSON 输出拦截 GPL/AGPL/LGPL,不额外引入 npm 审计依赖。
- **生成物校验**:`pnpm run license:check` 会继续跑 Rust/npm 禁止许可扫描,并通过 `pnpm run license:verify` 检查 `THIRD_PARTY_LICENSES.md` 与 `public/THIRD_PARTY_LICENSES.md` 是否已按当前依赖树更新。
- **应用内许可页**:顶栏新增「开源许可」入口,弹层按需加载 `public/THIRD_PARTY_LICENSES.md` 文本,避免把 1.1 万行许可文本塞进首屏 JS,同时满足二进制用户可见的基础归属要求。

验证:

- `pnpm run license:npm`:通过,未发现 GPL/AGPL/LGPL。
- `pnpm run license:rust`:通过,`cargo deny` licenses ok。
- `pnpm run license:third-party`:通过,生成 `THIRD_PARTY_LICENSES.md`。
- `pnpm run license:verify`:通过,生成物与当前依赖树一致。
- `pnpm run check`:通过(0 errors / 0 warnings)。

限制:

- 仍有少量 npm 包未在安装目录提供 LICENSE/NOTICE 文件;脚本会在生成物中标记这些包,发布前需人工复核。
- `cargo-about` 已覆盖 Rust crate 许可全文,但 C 库 NOTICE/IJG 段仍需在发布候选阶段人工抽查一遍。

---

## 2026-06-30 — P0.5 批量任务协议最小闭环

Codex 完成 P0.5「进度/取消协议」的第一版可运行闭环:

- **Tauri 批量命令**:新增 `convert_batch(options, progress)` 与 `cancel_batch()`。批量任务状态由 `BatchState` 管理,同一时间只允许一个活动 batch;取消使用 `tokio_util::sync::CancellationToken`,当前阶段在文件边界生效。
- **Channel 进度事件**:`BatchProgressEvent` 覆盖 started / fileStarted / fileProgress / fileFinished / fileSkipped / fileError / cancelled / finished。返回 `BatchSummary { total, completed, skipped, failed, cancelled }`。
- **前端接入**:`convertAll()` 在 skip/overwrite 模式走 Rust batch + Channel 更新每个队列项进度;`ask` 覆盖策略保留逐文件确认路径,避免后端单向 Channel 里做交互阻塞。新增「取消 / 取消中」按钮,取消后未开始或运行中的条目回到 pending 并显示「已取消」。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `cargo test -p imgconvert-core`:通过(12 tests)。
- `cargo clippy -p imgconvert-core -- -D warnings`:通过。
- `cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml`:通过(4 tests)。
- `cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`:通过。

限制:

- 当前 batch 仍是串行执行,只是协议从“前端循环调用单张命令”前移到 Rust;P1 的文件级并发、信号量、内存预算仍待做。
- 单张 core encode/decode 内部还不可中断;取消会在当前文件结束后生效。

---

## 2026-06-30 — P0 前端整顿落地

Codex 完成 P0「目标契约」三项:

- **组件化 App 接通**:`src/App.svelte` 现在只负责组装 `Topbar` / `Dropzone` / `SettingsBar` / `QueueItem`,队列、设置、引擎状态统一走 `src/lib/state.svelte.ts`;旧 App 内联拖拽/队列/转换逻辑已移除。
- **Tauri 引擎契约换 core**:`src-tauri` 通过 path 依赖接入 `crates/imgconvert-core`;`capabilities()` 返回 JPEG/PNG/WebP/AVIF 可读/可写矩阵、PNG/WebP 真无损矩阵与 `heic:false`;`convert_image` 读文件字节后调用 `imgconvert_core::convert(bytes, Format, EncodeOptions)` 并保留输出目录、覆盖策略、文件名模板等 P0 行为。
- **shadcn 控件 + 格式选择器**:目标格式选择器自行实现搜索、分类、源格式/已选高亮、回车选择第一个匹配项,窄屏以底部抽屉样式展示;质量、无损、覆盖策略切到 `ui/slider` / `ui/switch` / `ui/select`,格式列表由 `capabilities().writable` 驱动。

验证:

- `pnpm run check`:通过(0 errors / 0 warnings)。
- `pnpm run build`:通过。
- `cargo test -p imgconvert-core`:通过(10 tests)。
- `cargo fmt --check` 与 `cargo fmt --manifest-path src-tauri/Cargo.toml --check`:通过。
- 本地网页预览 `http://127.0.0.1:1420/`:已用 headless Chromium 截图确认能显示演示队列卡片。
- `cargo check --manifest-path src-tauri/Cargo.toml`:当前环境缺少系统 `dbus-1.pc`(`libdbus-1-dev`/`dbus-devel` + `pkg-config`),在 `libdbus-sys` 构建脚本处阻断;需在完整 Tauri Linux 开发环境重跑。

Review 修复:

- `Ask` 覆盖策略改为前端确认后以 `overwrite` 重试;取消则按跳过处理。
- `preserveMetadata` 在 P2 实现前强制保持关闭,后端收到 `true` 会返回明确错误,避免静默丢元数据。
- 后端写文件改为唯一临时文件;非覆盖路径用 no-clobber 链接落盘,降低 skip/ask 与后续并发下的竞态覆盖风险。
- `convertAll()` 改为按每个队列项的实际目标格式校验,不再用全局格式一票否决单文件转换。

---

## 2026-06-30 — 前端审计:发现「没接完的重构 + 旧引擎契约」

对 `src/` 做了一次盘点,发现三件需要在 P0 优先理顺的事:

1. **真正在跑的是 `App.svelte`(266 行,自包含)**。`main.ts` 挂载它;它只用了 `Button`,把拖拽 / 控制条 / 队列全写在一个文件里,控件是原生 `<select>` / `<input range>` / `<checkbox>`(没用已就位的 shadcn Select/Slider/Switch)。

2. **存在一套更完整但「孤儿」的重构,没被任何入口引用**:
   - `src/lib/state.svelte.ts`(集中 runes 状态 + 主题浅/深/跟随 + 减弱动效 + skip 跳过 + Tauri Store 持久化)
   - 组件 `Topbar` / `Dropzone` / `QueueItem` / `SettingsBar`(均 `import` 自 `$lib/state.svelte`)
   - **缺一个把它们组装起来的 `App.svelte`**,所以这套更好的代码当前是死代码。两套逻辑并存会漂移。

3. **前端 + 后端仍说旧的 libvips 黑话**,与已锁定的进程内混合架构不符:
   - `src-tauri/src/convert.rs` 顶部已自标**「已弃用(2026-06-29)」**,实质是 `vips` CLI 子进程引擎。
   - `engine_info` 返回 `vipsAvailable / vipsVersion / heicEncode`;前端提示「未检测到 libvips,请 brew install vips」。
   - `imgconvert-core` 尚未接入 `src-tauri`(原计划 P1)。今天启动只会显示红色「未检测到 libvips」,点转换会去 shell 调 `vips`。

**决策**:P0 第一件事 = 前端整顿,三项一起做(下方「目标契约」给出落地标准)。交由 Codex 接手(本机有 webkit/桌面环境,可 `pnpm run tauri dev` / 编译 `src-tauri`;本仓库容器无法 `cargo check` src-tauri)。

### 目标契约(Codex 落地标准)

**Tauri 命令(`src-tauri/src/lib.rs` + 新 `convert.rs`,改为调用 `imgconvert-core`,删除所有 `vips` 子进程逻辑):**

- `capabilities() -> Capabilities`(**取代** `engine_info`):由 core 能力推导,形如
  `{ readable: ["jpeg","png","webp","avif"], writable: ["jpeg","png","webp","avif"], lossless: ["png","webp"], heic: false }`(Linux v1 无 HEIC;AVIF 暂不声明真无损)。前端「引擎状态」文案据此改写,不再提 libvips。
- `convert_image(options) -> ConvertResult`:读输入文件字节 → `imgconvert_core::convert(bytes, Format, EncodeOptions{quality,lossless})` → 写输出(沿用 `outDir` / 覆盖·skip / 文件名规则)。`ConvertResult { input, output, inSize, outSize }` 保持不变,前端压缩比展示无需改。
  - 接 core:`src-tauri/Cargo.toml` 加 `imgconvert-core = { path = "../crates/imgconvert-core" }`;注意 src-tauri 仍排除在 workspace 外(见根 `Cargo.toml`),用 path 依赖即可。
- 格式映射:字符串 ↔ `imgconvert_core::Format`(`jpeg`/`png`/`webp`/`avif`)。`heic`/`tiff` 暂标不可写(Linux v1)。

**前端架构(以 `state.svelte.ts` + 4 组件为基准):**

- 写一个真正的 `App.svelte`,组装 `Topbar` + `Dropzone` + `SettingsBar` + 队列(`QueueItem`),状态全部走 `$lib/state.svelte`,**删掉老 App.svelte 里重复的内联逻辑**。
- `state.svelte` 里 `checkEngine()` 改为调 `capabilities()`,`EngineInfo` 类型替换为 `Capabilities`。
- 原生控件换 shadcn:目标格式用 **格式选择器**(复刻 vert FormatDropdown 的交互:搜索 + 分类 + 源格式/已选高亮 + 回车选第一个;**不抄 AGPL 源码**,用 `src/lib/components/ui/select` 自行实现),质量用 `ui/slider`,无损/覆盖用 `ui/switch`。
- 格式列表由 `capabilities().writable` 驱动,别硬编码。

---

## 2026-06(P0.5 技术尖刺)— 进程内编解码核心打通

详见 ROADMAP P0.5(已勾)。要点:

- **core crate**:`crates/imgconvert-core`,`Codec` trait + `ImageData`(RGBA8 / 8-bit SDR / 不变量校验)+ `convert` 管线。接 `mozjpeg`(JPEG)/`oxipng`(PNG 无损)/`webp`(libwebp)/`image`(解码,`default-features=false`)。JPEG 编码 `catch_unwind` 截 Rust panic、alpha 合成白底;WebP 解码 `BitstreamFeatures` 预检拒动图/超尺寸。aarch64 Linux:编译 + clippy(`-D warnings`)+ fmt + 测试全过。
- **AVIF 后端**:`libavif-sys 0.17`(`codec-rav1e` 编码 + `codec-dav1d` 解码,`default-features=false`)。`AvifCodec` 编解码 + magic 检测(`ftyp`/avif·avis)。**arm64 全链编译通过**(rav1e 纯 Rust、dav1d 走 meson/ninja,无需 nasm)。验证 **alpha 往返** + **ICC 逐字节往返**(`avif_preserves_icc`,坐实弃用裸 ravif 的主因)+ convert 管线 PNG↔AVIF。FFI 用 RAII guard 释放 C 资源。可插拔后端点:`avifEncoder.codecChoice`。
- **未决**:N3(`maxThreads=1` 是否压住 rav1e rayon 池,需多核实测)、AVIF 真·无损(需 identity matrix,P2)、speed 默认值 arm64 实测、N5(`webp 0.3` 不暴露 method/near_lossless/sharp_yuv,P2 降到 `libwebp-sys`)。
