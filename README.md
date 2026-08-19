# ImgConvert

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri)](https://tauri.app)
[![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)

**本地优先**的跨平台图片批量转换与压缩工具。**Linux 优先**(Debian/Ubuntu/Fedora),后续扩展 macOS / Windows(arm64 + amd64)。
面向开发者、设计师、站长与内容创作者:拖拽即转,优先支持 AVIF/WebP/JPEG/PNG 与有损/无损压缩,**所有处理默认在本机完成,不上传图片**。

> **第一期发布范围**:只在 **GitHub Releases** 发布 Linux 直发包(`.deb` / `.rpm` / AppImage)与 Tauri updater 资产;暂不提交 Flathub、Mac App Store 或 Microsoft Store。商店/Flathub 相关脚本和护栏保留为后续阶段使用。

## ✨ 功能

> 状态图例:✅ 已实现 · 🚧 需要真实平台/账号/证书继续验收(详见 [docs/ROADMAP.md](docs/ROADMAP.md))

- ✅ 拖拽、选择文件/目录、递归导入、剪贴板图片导入,带尺寸/DPI ping 与异步缩略图。
- ✅ 格式转换:AVIF / WebP / JPEG / PNG(由进程内 Rust core 提供)。
- ✅ Rust 端批量转换:并发控制、内存预算降并发、Channel 进度、取消、成功/跳过/失败汇总。
- ✅ 压缩策略:skip-if-larger、多候选取最小、JPEG/WebP 自动质量、代际损失防护、结果缓存。
- ✅ 保真能力:EXIF orientation 真旋正、ICC/EXIF/XMP/IPTC 保留或剥离、Display P3 ICC 测试、显式转 sRGB。
- ✅ 可选 HEIC 导入:Linux 外部 helper/Flatpak extension、macOS ImageIO、Windows WIC 探测;主程序不内置 HEIC codec,不输出 HEIC。
- ✅ 发布工程:Linux `.deb/.rpm/AppImage`、GitHub Releases updater、Flatpak manifest、macOS/Windows repo 侧打包与签名入口、质量/许可/fuzz/benchmark guardrails。
- 🚧 真实发布验收:第一期只需 GitHub Release 发布链路;Apple Developer 签名/公证/MAS、Windows 代码签名/MSIX/Store、Flathub 审核、真实图片 corpus 长跑 fuzz、macOS/Windows benchmark 数据均后移。

> ✅ **架构已切换(2026-06-30)**:引擎从 libvips CLI 改为**进程内宽松许可 Rust 编解码 crate + 后续平台系统 HEIC**(混合架构),许可证为 **Apache-2.0**,目标上架三大商店。详见 [docs/ROADMAP.md](docs/ROADMAP.md) / [docs/ENGINE.md](docs/ENGINE.md)。

## 当前状态

- ✅ **P0/P0.5**:组件化 Svelte 5 UI、shadcn 控件、格式选择器、core 能力矩阵、许可/架构护栏已落地。
- ✅ **P1/P1.5**:文件导入、并发批量、进度/取消、缩略图、剪贴板导入、文件可靠性、可选 HEIC helper/plugin 已落地。
- ✅ **P2**:高级压缩、metadata 保真、色彩管线 v2、AVIF 真无损、语义 metadata、图像质量测试、fuzz/corpus/replay/minimize 已落地。
- ✅ **P3 repo 侧**:Linux 发布闭环、Flatpak/HEIC extension、Tauri updater、macOS/Windows 打包与签名脚本、GitHub Actions 成本护栏已落地。
- 🚧 **外部验收**:第一期 GitHub Releases/updater 发布链路优先;真实 Apple/Windows 签名与商店提交、Flathub 审核、真实样张 corpus 与 macOS/Windows benchmark 后移。

## 🛠️ 技术栈

- **前端**:Tauri 2 + Svelte 5(runes)+ shadcn-svelte / Tailwind v4 + phosphor-svelte(duotone 图标);包管理用 **pnpm**,运行时用 Node LTS
- **引擎(混合架构)**:进程内宽松许可 Rust 编解码 crate(`mozjpeg`/`oxipng`/`webp`/`libavif-sys`/`image`),构建期静态链接为单一二进制
- **HEIC**:主程序不内置 HEIC codec、不随包分发 x265;直发/插件场景可用外部 helper 或 Flatpak extension,macOS/Windows 走系统 ImageIO/WIC read-only provider(详见 [docs/LEGAL.md](docs/LEGAL.md))

> 具体版本以仓库锁定文件为准(`package.json#packageManager`、`pnpm-lock.yaml`、`src-tauri/rust-toolchain.toml`、`Cargo.lock`);完整版本表与决策见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 🚀 快速开始

> Tauri GUI 运行/打包需要平台 WebView 与系统开发包。前端 `pnpm run check` / `pnpm run build` 可在任意平台跑;若 Linux 上 `cargo check` 报 `dbus-1.pc` 缺失,先安装 `libdbus-1-dev`/`dbus-devel` 与 `pkg-config`。

前置依赖:[Rust](https://rustup.rs/)(版本由 `rust-toolchain.toml` 钉定)、Node LTS + [pnpm](https://pnpm.io/)、Xcode Command Line Tools、**NASM**(rav1e/mozjpeg 汇编;macOS 建议钉 2.15.05)+ cmake + meson/ninja(详见 [docs/ENGINE.md](docs/ENGINE.md) §4)。

```bash
pnpm install           # 前端依赖
pnpm run tauri dev     # 开发
pnpm run tauri build   # 打 .app / .dmg
pnpm run docs:web:dev  # Fumadocs 文档站预览
pnpm run check         # 前端类型检查 + lint
pnpm run release:readiness # GitHub-only 第一期只读发布状态报告,不构建/不联网/不触发 Actions
pnpm run release:readiness:github:ready # GitHub Release 发布前硬校验,缺 artifact/签名会失败
pnpm run release:readiness:all # 查看商店/Flathub/跨平台长期发布项
pnpm run release:platform:check # 架构/发布/文档静态护栏
```

加 shadcn-svelte 组件:`pnpm dlx shadcn-svelte@latest add <component>`(配置见 `components.json`)。

## 📚 文档

- [docs/ROADMAP.md](docs/ROADMAP.md) —— 路线图、技术栈版本、开发优先级
- [docs/ENGINE.md](docs/ENGINE.md) —— 混合架构引擎:core/crate 参数、系统 HEIC、C 工具链、打包/签名
- [docs/LEGAL.md](docs/LEGAL.md) —— Apache-2.0、依赖许可红线、HEVC 专利、第三方组件合规
- [docs/REFERENCES.md](docs/REFERENCES.md) —— 参考开源项目调研与可复用点
- [PRIVACY.md](PRIVACY.md) / [PRIVACY.en.md](PRIVACY.en.md) —— 中英文隐私政策源文件；GitHub Pages 启用后公开于隐私页

## 📜 许可证

以 **[Apache-2.0](LICENSE)** 发布(宽松许可,可商用、可上架商店;不要求 CLA,贡献走 DCO,见 [CONTRIBUTING.md](CONTRIBUTING.md))。

依赖许可红线(禁 GPL/AGPL/LGPL)、HEVC 专利规避、第三方组件合规的完整说明见 [docs/LEGAL.md](docs/LEGAL.md)。
