# 模型交接文档

> 本文件记录当前可验证状态和下一位开发者真正需要知道的边界。完整历史见
> [`DEVLOG.md`](./DEVLOG.md)，阶段计划见 [`ROADMAP.md`](./ROADMAP.md)，发布验收见
> [`RELEASE_QA.md`](./RELEASE_QA.md)。

## 1. 仓库与公开发布状态

- 仓库：`https://github.com/web-casa/ImgConvert`
- 分支：`main`
- 当前公开版本：`v0.2.22`
- Release：`https://github.com/web-casa/ImgConvert/releases/tag/v0.2.22`
- `docs/public-release.json` 是 README/ROADMAP 状态闸门的必需输入；它必须与双语 README、
  `package.json`、Tauri config/Cargo manifest 以及对应 `docs/RELEASE_V*.md` 保持一致。
- v0.2.22 已于 2026-08-28 公开，GitHub Release 包含 Linux/macOS/Windows 的
  x64/arm64 正式直发资产及合并后的 `SHA256SUMS`。
- 公开 Release 必须继续遵守根目录 `AGENTS.md`：三平台双架构资产、macOS 签名/公证/staple、
  Windows 未签名安装 smoke 与 SmartScreen 提示全部完成前保持 draft。

## 2. 当前工作树状态（2026-09-01）

当前存在一组尚未提交的大型功能与安全加固改动。不要使用 `git add -A` 或把它们塞进一个
release preparation 提交；先按依赖关系拆分，并让每个中间提交通过对应测试。

建议提交顺序：

1. 发布状态闸门与架构/许可证 guardrail；
2. core 解码、metadata、缩略图和 panic 边界加固；
3. 统一 workflow 基础层；
4. 结果缓存；
5. PDF 输入完整纵切；
6. 前后对比预览；
7. 批量尺寸、场景预设、目标体积和隐私 metadata UI；
8. UI 重设计、资源与桌面 E2E；
9. fuzz/CI/文档；
10. 由最终依赖图生成的 `THIRD_PARTY_LICENSES.md` 两份副本。

`Cargo.lock`/`pnpm-lock.yaml` 应跟随引入对应依赖的功能提交，不能集中到许可证提交，否则中间
提交无法使用 `--locked`/`--frozen-lockfile` 独立构建。

## 3. 当前产品与架构能力

- 输出：JPEG、PNG、WebP、AVIF；读取还支持 SVG、静态 GIF、BMP、HEIC/HEIF（受信任平台
  codec/helper）以及单向 PDF 栅格化输入。
- 批量转换由 Rust 调度，通过 Tauri Channel 报告进度并支持取消。
- core `workflow` 统一尺寸规则、metadata 三态、目标文件体积、色彩策略和编码候选；批量转换与
  前后对比预览复用同一语义。
- PDF 是 Tauri 文档适配器，不是 `imgconvert-core::Format`。正式读取上限 256 MiB，逐页像素继续
  受 core 64 MP 预算；导入期 metadata 探测限制为每文件 16 MiB、每次扫描累计 64 MiB，超预算
  文件仍加入队列并延迟解析。
- 结果缓存只存 hash/size/尺寸/质量/warning 等 metadata，不保存图片像素；预览不写缓存。
- AVIF `irot`/`imir`、EXIF/XMP orientation 在像素归一化后统一清理，避免重复旋转。
- Tauri capability 使用显式 `allow-*`；`confirm()` 需要的 `dialog:allow-message` 不得删除。
- 前端为 `zh-CN`/`en-US` 双语，用户可见错误使用结构化 `CommandError` 和 ICU 参数。

## 4. Fuzz、测试与 CI

- core fuzz targets：`decode_pipeline`、`convert_pipeline`、`metadata_semantics`。
- Tauri fuzz targets：`external_codec_manifest`、`import_scanner`、`pdf_document`。
- `pnpm run fuzz:prepare` 为两个 fuzz crate 生成 ignored deterministic corpus；
  `pnpm run fuzz:replay` 通过普通 Rust example 回放全部六个 target，不要求安装 `cargo-fuzz`，报告写入
  `target/fuzz-corpus/replay-report.json`。
- CI 的 fuzz job 与 `Tauri Backend And Desktop E2E` job 使用 commit-pinned `rust-cache`，包括
  Cargo registry、依赖 target 和 `~/.cargo/bin`；桌面 job 仍保留 40 分钟预算，只有真实冷缓存数据
  证明不足时再调整。
- `docs/public-release.json` 缺失、JSON 损坏或不是 object 时，README guardrail 应输出聚合错误，
  不得泄漏原生 ENOENT/SyntaxError 堆栈。

## 5. 发布与商店边界

- GitHub Windows 直发 MSI/NSIS 不做 Authenticode 签名；完整性依赖 `SHA256SUMS`，发布说明必须提示
  SmartScreen。受信任 Windows 签名分发只依靠 Microsoft Store 接受后的 MSIX。
- MAS/MSIX 构建必须设置：
  - `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`
  - `IMGCONVERT_DISABLE_UPDATER=1`
- macOS GitHub DMG 必须使用 Developer ID 签名、Apple notarization、staple 和 Gatekeeper 验收。
- Store submission、市场/价格、IARC 或发布按钮都属于账户负责人外部动作，不能由仓库测试结果代替。
- Flatpak app-id 仍是 `io.github.yeagoo.imgconvert`。

## 6. 常用验证命令

```bash
pnpm test
pnpm run quality:frontend
pnpm run quality:security
pnpm run fuzz:smoke
cargo +1.96.0 test -p imgconvert-core
cargo +1.96.0 clippy -p imgconvert-core --all-targets -- -D warnings
cargo +1.96.0 test --manifest-path src-tauri/Cargo.toml
cargo +1.96.0 clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm exec playwright test
pnpm run e2e:desktop
node scripts/check-platform-release-guardrails.mjs --platform=all --channel=all
```

发布前还需运行 `pnpm run release:readiness`，并按目标渠道使用严格 readiness 命令。绿色 CI 不能
替代三平台正式安装包的签名、公证、安装/运行 smoke 和来源校验。

## 7. 提交纪律

- 先用 `git status --short` 和目标文件的 `git diff` 明确范围，只暂存当前提交需要的路径或 hunk。
- 不要盲目暂存根目录的 AI 工作笔记、`tmp/`、本地 corpus、fuzz artifacts、构建目录或真实照片。
- feature、fix、test、policy 与 release version bump 应保持可独立 review/revert；release preparation
  不得夹带功能代码。
- 不改写、清理或回退无法确认归属的现有 dirty worktree 内容。

## 8. 当前外部阻塞项

- Partner Center 的 IARC/CSV、listing 资料和 Store submission 需要账户负责人执行。
- 后续 macOS 直发需要可用的 Developer ID/notarization 凭据与双架构 runner 结果。
- 新公开版本在全部平台资产与 smoke 集齐前只能保留为 draft；当前没有准备或发布新版本的授权。
