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

### 未完成

- Rust 后端错误仍是 `Result<T, String>`，中文错误会直通前端
- Store listing 英文未准备
- 隐私政策英文未准备
- docs-site 英文站未做
- MSIX 包内 MRT 本地化未做（暂时明确不做）

## 4. 下一步建议：Phase 3

目标：Rust 后端结构化错误码迁移。

设计已写入 `docs/I18N_PLAN.md`：

```rust
pub struct CommandError {
    pub code: ErrorCode,
    pub params: Option<serde_json::Value>,
    pub detail: Option<String>,
}
```

重点：

- 迁移所有 `#[tauri::command]` 边界
- 内部 `Result<T, String>` 可保留
- 前端用 ICU 插值渲染 `params`
- 底层错误原文放 `detail` 或日志
- 需要同步更新测试与前端错误处理

## 5. 关键约定与坑

- Store 构建必须设置：
  - `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`
  - `IMGCONVERT_DISABLE_UPDATER=1`
- MAS/MSIX 不启用 Tauri updater
- Windows Store 身份默认值在 `scripts/prepare-windows-msix-release.mjs`
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

- Phase 3：无外部阻塞，可直接开发
- macOS 签名/MAS：需要 Apple secrets
- Windows 直发签名：需要代码签名证书
- Store 提交：需要 Partner Center 账号与 listing 资料
