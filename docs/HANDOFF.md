# 模型交接文档

> 本文件是给下一个开发模型/开发者的当前状态交接。完整历史见 `docs/DEVLOG.md`，阶段计划见 `docs/ROADMAP.md`，i18n 计划见 `docs/I18N_PLAN.md`。

## 1. 仓库与发布状态

- 仓库：`https://github.com/web-casa/ImgConvert`
- remote：`origin` 已指向该仓库
- 分支：`main`
- 当前 tag：`v0.1.2`
- Release：`https://github.com/web-casa/ImgConvert/releases/tag/v0.1.2`
- 已配置 Secrets：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_UPDATER_PUBKEY`
- 未配置 Secrets：Apple/Windows 签名、MAS provisioning、Store 提交账号
- CI：public 仓库标准 runner 免费；`main` push 自动跑 CI；`v*` tag 自动跑 Linux Release

## 2. 已完成的主要工作

- 从 `yeagoo/imgconvert` 迁移到 `web-casa/ImgConvert`
- GitHub Actions 切到免费 public runner 策略
- Linux amd64/arm64 发布 `.deb` / `.rpm` / AppImage
- Tauri updater：x86_64 + aarch64 签名 AppImage、`.sig`、`latest.json`
- Windows Store 生产 MSIX workflow 与真实 runner smoke
- macOS 真实 runner unsigned DMG + HEIC ImageIO smoke
- Microsoft Store / MAS 构建禁用 Tauri updater
- 隐私政策：`PRIVACY.md`
- Logo 已全部替换并压缩
- 前端 i18n Phase 1/2 完成：`zh-CN` + `en-US`
- i18n Phase 3 完成：Tauri command 错误使用结构化 `CommandError`，前端按 ICU message 本地化
- Phase 4a 文案与隐私来源已完成：双语 Store metadata、`PRIVACY.en.md`、无外部资源的 Pages 隐私页与公开 runner 部署工作流

## 3. 多语言现状

### 已完成

- `svelte-i18n` v4 + `@tauri-apps/plugin-os`
- `src/lib/i18n/index.ts`
- `src/lib/i18n/messages/zh-CN.ts`
- `src/lib/i18n/messages/en-US.ts`
- 语言检测、Topbar 切换、`settings.locale` 持久化
- 全部前端组件和 `state.svelte.ts` 用户可见文案已迁移
- `scripts/check-ui-hardcoded-strings.mjs` 接入 `quality:frontend`
- `tests/i18n.test.ts` key parity 测试
- `svelte-i18n>esbuild` override 修复 audit
- `src-tauri/src/command_error.rs` 定义 `CommandError { code, params, detail }` 与稳定错误码
- 所有可失败 Tauri command、批量 progress、导入逐项错误和转换规划错误均使用该 envelope
- `src/lib/command-error.ts` 只按 `errors.<code>` 本地化；`detail` 仅供开发调试，畸形/旧 payload 回退通用错误
- ICU 插值统一使用 `svelte-i18n` v4 的 `{ values: params }` 接口

### 未完成

- GitHub Pages 尚未由仓库管理员启用，公开隐私页尚未实际部署
- Windows Store 候选 MSIX 的中英文实机截图未生成
- Partner Center CSV、IARC 问卷与实际 submission 未完成
- docs-site 英文站未做
- MSIX 包内 MRT 本地化未做（暂时明确不做）

## 4. 下一步建议：Phase 4a

Phase 3 已完成并复核。Phase 4a 的双语 Store metadata、英文隐私政策、截图工作表及外部
门槛见 [`docs/STORE_LISTING_4A.md`](./STORE_LISTING_4A.md)。发布负责人已确认公开免费、
账户可用全部市场、本地优先定位、GitHub Pages、GitHub Issues 和无遥测事实。

接下来由仓库管理员在 **Settings → Pages** 将 Source 设为 **GitHub Actions**；首次
`pages.yml` 成功后再验证 `https://web-casa.github.io/ImgConvert/privacy/`。之后仍需实际
Windows Store MSIX 截图、当日 Partner Center CSV、IARC 和账户负责人提交；不自动创建
submission、设置市场/价格或点击发布。

Phase 3 的已落地契约见 `docs/I18N_PLAN.md`：

```rust
pub struct CommandError {
    pub code: ErrorCode,
    pub params: Option<serde_json::Value>,
    pub detail: Option<String>,
}
```

已完成的边界：

- 内部 `Result<T, String>` 保留在底层；只在 Tauri command 边界转换为 `Result<T, CommandError>`
- 前端用 ICU 插值渲染 `params`，不显示 `detail`
- 批量事件、导入扫描明细与转换规划遵循同一结构，避免字符串旁路
- `codec_diagnostics()` 仍是成功返回的技术快照；HEIC helper 配置失败则走结构化错误

## 5. 关键约定与坑

- Store 构建必须设置：
  - `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`
  - `IMGCONVERT_DISABLE_UPDATER=1`
- MAS/MSIX 不启用 Tauri updater
- Windows Store 身份默认值在 `scripts/prepare-windows-msix-release.mjs`
- `pages/` 是独立、无依赖的双语隐私页；`pages.yml` 只使用 `ubuntu-24.04`，Pages 未启用时自动跳过 push 部署
- Flatpak app-id 仍是 `io.github.yeagoo.imgconvert`
- 不要删除 `docs/DEVLOG.md` 的历史条目
- Rust 中文日志/注释保留中文，不要求迁移
- CI 硬编码检查只扫 `src/`，不扫 `src-tauri/`

## 6. 常用命令

```bash
pnpm run quality:frontend
pnpm run quality:security
pnpm run release:flatpak:verify
pnpm run release:readiness:check
pnpm run ci:cost:check
node scripts/check-platform-release-guardrails.mjs --platform=all --channel=all
pnpm exec playwright test
pnpm run release:linux:debug
```

## 7. 提交与推送

```bash
git add -A
git commit -m "<scope>: <summary>"
git push origin main
```

如果 GitHub API 偶发无响应，重试即可。

## 8. 当前阻塞项

- Phase 4a：需要仓库管理员启用 GitHub Pages，并由 Partner Center 账户负责人执行 IARC/CSV/提交
- macOS 签名/MAS：需要 Apple secrets
- Windows 直发签名：需要代码签名证书
- Store 提交：需要 Partner Center 账号与 listing 资料
