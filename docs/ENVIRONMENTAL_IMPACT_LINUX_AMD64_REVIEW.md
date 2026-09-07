# 环保功能 Linux amd64 候选复核

日期：2026-09-07。范围：HEAD `03b692f` 加未提交工作区，桌面 0.3.1，release profile、默认 features，无 `desktop-e2e`。ARM64 Debian 13 宿主通过已注册的 x86_64 翻译器运行 amd64 Ubuntu 22.04 容器。本记录不代表原生 amd64 硬件验收，也不代表发布。

## Review 与修复

**P2：构建 target 与 Docker 运行平台未关联。** `scripts/smoke-linux-package-install.mjs` 原先仅根据 `--target` 选择包目录，Docker 仍默认宿主架构；在 ARM64 宿主验证 amd64 包时可能进入错误的用户空间。

现从 x86_64/amd64、aarch64/arm64 target 推导 Docker `--platform`，支持显式 `--platform=linux/amd64` 或 `linux/arm64`，拒绝没有 `--image` 的平台参数、未知平台和 target 冲突。没有 target 时保留 Docker 默认平台。

回归测试执行生产参数解析，覆盖两种 target 的自动推导及未指定 target；执行 CLI 拒绝无效组合；捕获生产 Docker 调用，验证平台作为独立参数传递、包仍以只读方式挂载。没有模拟成功包结果。

新增 [Ubuntu 22.04 构建定义及操作说明](../packaging/linux/README.md)，锁定 Node、pnpm、Rust 版本，校验 Node 下载摘要。仅 amd64 镜像在本轮实测；ARM64 参数分支尚未实测。基础镜像标签、APT 软件仓库和 Rust 安装脚本并未内容固定，不宣称逐字节可复现。

## 来源

本地产物目录：`artifacts/linux-amd64-2026-09-07/`。

- `source/` 是独立候选源码副本，含生产 `dist/`；不复用宿主 ARM64 Node 原生依赖。
- `SOURCE_SHA256SUMS` 记录复制时源码、锁文件和预构建前端。之后增加的验证测试及文档不属于该构建快照。
- `baseline.json` 记录 HEAD、未提交状态、架构、默认 features 和前端来源。
- `toolchain.txt`：Node 24.18.0、pnpm 10.34.4、Rust/Cargo 1.96.0、x86_64、glibc 2.35。
- `builder-image.txt` 记录本地构建镜像身份。编译卷为 `imgconvert-target-jammy-amd64`，固定挂载 `/build`；仅复用既有 Cargo registry/git 源码缓存。
- 构建使用预构建前端，设置 `beforeBuildCommand` 为空；不改变 Rust 默认 features。包内环境统计实现与来源快照对应。

## 验证结果

本地候选：`ImgConvert_0.3.1_amd64.deb`，18,135,038 字节。

SHA-256：`efee3200d7acdda9ca37d04ef8aad3225e45da86400eb23ec8f6492b3d500014`。

| 检查 | 结果 | 证据及范围 |
| --- | --- | --- |
| Ubuntu 22.04 amd64 release 构建 | 通过 | `build.log`；编译约 7 分钟 |
| 包内版本、架构、依赖、GLIBC ≤2.35 | 通过 | `package-check.log`；在匹配架构的构建容器执行 |
| 干净安装及 GUI 启动探测 | 通过 | `install-smoke.log`；amd64 Ubuntu 容器、虚拟显示，仅启动层 |
| JPEG/WebP/PNG/AVIF 真实转换 | 通过 | 同一安装日志含完整四格式成功记录，整个命令退出 0 |
| 源码摘要复核 | 通过 | `source-verify.log`，构建后仍与原清单一致 |
| 单元测试 | 通过 | 33 文件、219 项，包含 3 项平台选择回归 |
| 类型、Lint、文档及代码格式检查 | 通过 | 本轮本地检查，无新增告警 |
| 原生 amd64 硬件验收 | 未执行 | 本机为 ARM64，amd64 执行使用翻译器 |

候选位于上述 artifact 目录，`SHA256SUMS` 记录包摘要；测试前后字节一致。构建镜像身份为 `sha256:7cfa543f65878ddd0f6cf0cd1d13bfc9d2684ba01678b54fcc3d43b2039575b2`。运行镜像身份另见 `runtime-image.txt`。验证脚本与测试的最终摘要另存 `VALIDATION_TOOLS_SHA256SUMS`。

第一次结构检查因只读源码目录缺少嵌套挂载点而未启动，日志保留为 `package-check-mount-failure.log`。在源码副本预建空的 `src-tauri/target` 目录后，使用相同包和相同门禁通过检查；没有改变候选或放宽检查。操作说明已补充该前提。

## 发布边界

amd64 DEB/RPM/AppImage 均已完成构建和对应容器验证，详见下方后续记录。amd64 DEB/RPM 升级卸载已由后续 [生命周期记录](LINUX_PACKAGE_LIFECYCLE_REVIEW.md) 补齐；原生硬件、真实显示器、安装件环保面板交互仍待验证。macOS/Windows 及全部渠道签名、公证、安装和来源证据仍需补齐。依照 AGENTS.md，不能公开不完整 GitHub Release；本轮没有上传、提交商店或公开发布。

## RPM / AppImage 后续开发与复核

沿用上述源码快照、生产前端和独立 amd64 编译卷构建两种包；原 DEB 保持不变。AppImage 打包工具使用独立 amd64 缓存，下载后的工具摘要保存在 `APPIMAGE_TOOLS_SHA256SUMS`，未宣称这些上游可变下载地址可逐字节复现。

### P2：跨架构 ldd 失败被当作静态程序放行（已修复）

`check-linux-bundle-artifacts.mjs` 原先把 `not a dynamic executable` 或 `statically linked` 直接视为无动态依赖。使用本轮真实 amd64 DEB 中的二进制，在 ARM64 宿主执行 ldd，退出 1 并输出前一种文本；旧门禁返回空问题列表。`ldd-review-reproduction.log` 保存修复前后实测。

现在使用 `readelf -d` 再核对 ELF 依赖表，存在 NEEDED 或无法读取时拒绝放行，要求匹配架构的运行环境；没有依赖的真实静态程序仍可通过。新增测试使用 C 编译的动态程序和静态程序，覆盖误导性 ldd 输出、依赖表读取失败及静态程序正常通过。原 AppImage 私有库解析和缺库回归继续通过。

该修复只影响检查工具。最终三包复核将当前脚本单独只读挂载进 amd64 构建容器，不改写构建来源快照；最终工具摘要记录在 `VALIDATION_TOOLS_SHA256SUMS`，旧 DEB 验证工具摘要保留为 `DEB_VALIDATION_TOOLS_SHA256SUMS`。

### 候选摘要

| 包 | 字节数 | SHA-256 |
| --- | --- | --- |
| ImgConvert-0.3.1-1.x86_64.rpm | 18,134,618 | `f86cb8ebc5c1133c5631369cb98ab24e738fb82c3fa1234d1c835b04141a3269` |
| ImgConvert_0.3.1_amd64.AppImage | 93,616,632 | `d870715e67e05362cf4f1fc39a8f2381b80f7be57f90128d20d2cb9433286353` |

AppImage 先移除 libgcrypt.so.20、注入 AppStream、规范启动权限并重打包，再计算上述摘要。RPM 包内身份为 `img-convert 0.3.1 x86_64`。源码在本轮构建后再次通过原始清单校验。日志及三包 `SHA256SUMS` 保存在同一 artifact 目录。

### 最终验收

| 检查 | 结果 | 证据和边界 |
| --- | --- | --- |
| 三包结构、架构、依赖和 GLIBC ≤2.35 | 通过 | `three-package-check.log`，使用修复后的门禁 |
| RPM 安装、启动及四格式转换 | 通过 | `rpm-smoke.log`，Fedora 42 amd64，退出 0 |
| AppImage 启动及四格式转换 | 通过 | `appimage-smoke.log`，Ubuntu 22.04 amd64，extract-and-run，退出 0 |
| 源码摘要及三包最终摘要 | 通过 | `source-verify-rpm-appimage.log`、`SHA256SUMS`；原 DEB 未变 |
| 全量单元、类型、Lint | 通过 | 34 文件、220 项；类型检查零错误零警告，Lint 通过 |
| FUSE、原生 amd64 硬件、GPU 与真实显示器 | 未执行 | 仿真容器及虚拟显示不覆盖这些路径 |
| amd64 DEB/RPM 升级卸载 | 通过（后续补齐） | 0.2.8 → 0.3.1 → remove，见 [生命周期记录](LINUX_PACKAGE_LIFECYCLE_REVIEW.md) |

RPM 日志中的 DRI3 警告来自虚拟显示环境，本轮不声明硬件加速验证通过。两份转换日志均包含 `imgconvert package conversion smoke passed: jpeg,webp,png,avif`；转换超时不会放行。AppImage 运行前后原文件摘要不变。

Linux 两种架构的三种包已有本地候选；ARM64 的升级卸载记录单独保留。本轮未增加桌面功能、未改版本、未上传或公开发布。完整 GitHub Release、macOS/Windows 与商店验收仍未完成。

后续 [AppImage 替换验收](LINUX_APPIMAGE_REPLACEMENT_REVIEW.md) 已补齐 amd64 0.2.8 → 0.3.1 手动替换、转换及删除运行副本后的数据保留；FUSE、自动更新签名与真实界面交互仍未覆盖。
