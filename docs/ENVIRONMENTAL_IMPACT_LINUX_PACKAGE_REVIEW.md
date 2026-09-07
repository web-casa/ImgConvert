# 环保功能 Linux 安装件复核

日期：2026-09-07。范围：当前未提交工作区的 Linux ARM64 DEB、RPM 和 AppImage，release profile、默认 features，无 desktop-e2e。包内版本仍为 0.3.1，仅为本地验收候选；没有上传或公开发布。

## Review 与修复

### P1：Docker 启动检查提前结束，转换未执行

`scripts/smoke-linux-package-install.mjs` 将启动与转换脚本顺序拼接，但启动脚本会执行 `exit 0`，导致 Docker shell 在启动成功后立即退出，跳过 `--convert-smoke`。因此旧测试成功不能证明包内编码器执行过。

修复：将启动脚本放入子 shell，成功后继续转换；启动失败仍通过父 shell 的 `set -e` 阻断后续步骤。

### P2：有限转换任务缺少超时和成功证据要求

转换原先直接运行，无时间限制，也没有复核成功记录。现使用 `timeout --kill-after=5s`，期限取现有 `--timeout`（默认 15 秒）。要求退出码 0 且完整出现 `imgconvert package conversion smoke passed: jpeg,webp,png,avif`。超时 124、失败及缺少证据均不通过。GUI 超时仍只表示启动探测存活，不作为转换成功。

新增真实 shell 回归，执行生产脚本生成器，覆盖启动后确实执行转换、转换失败 7、无成功记录 1、实际超时 124。仅模拟包管理器与测试应用，不修改宿主系统。

## 两次构建与结果边界

| 候选 | 基线门禁 | 安装/运行范围 |
| --- | --- | --- |
| Debian 13 本机 ARM64 DEB | 失败：要求 GLIBC 2.39，高于项目 2.35 | Debian 13 容器安装、GUI 启动探测和四格式转换通过；不能发布 |
| Ubuntu 22.04 ARM64 DEB | 通过：结构及 GLIBC 基线 | Ubuntu 22.04 容器安装、GUI 启动探测和四格式转换通过 |

旧 0.2.23 包完整移至 `artifacts/linux-environment-2026-09-07/previous-bundle-*`；不满足基线的本机包保存在 `debian13-only/`。Ubuntu 22.04 构建使用隔离源码副本和既有容器缓存。初次缓存挂载路径不一致导致 Tauri permission 文件引用失败，恢复其原挂载路径 `/build` 后重建成功，没有放宽门禁。

本地候选：`artifacts/linux-environment-2026-09-07/ImgConvert_0.3.1_arm64.deb`，17,101,548 字节。

SHA-256：`d7aa798af8e17a4c691f86b8e075dc5b5019e6ca188cf96c0518e5e727f011c5`。

## 来源与验证记录

- HEAD：`03b692f`，加当前未提交工作区；不是已发布 tag 的构建。
- Node 24.18.0、pnpm 10.34.4、Rust 1.96.0；Ubuntu 22.04 ARM64。
- 构建镜像 ID：`sha256:218734915551fef677f3d78ccc5b7cf881dd9604883f9d0168768873c9380e19`。
- 运行镜像 ID：`sha256:2edbbc5dc405e9612ba3584ce95480277e3eb374407b5505fe26f17df77c7dbc`。
- 隔离源码、预构建前端及锁文件摘要见本地 `SOURCE_SHA256SUMS`；环境记录见 `source-baseline.json`。容器复用该前端构建，关闭重复 beforeBuildCommand，不启用测试 seed。
- `pnpm test`：29 文件、212 项通过。Lint 通过。包的运行日志与构建日志保存在同一 artifact 目录。

## RPM 与 AppImage 后续验收

沿用上述 Ubuntu 22.04 ARM64 源码快照、工具链和默认 features 构建 RPM 与 AppImage。缓存旧产物移至构建卷的独立备份目录；没有改写已有 DEB。AppImage 按既有流程移除不兼容的 libgcrypt.so.20、注入 AppStream 元数据、规范启动权限并重新打包，之后才计算摘要。

本轮 review 修复：

- **RPM 包内版本未核对**：原门禁只按文件名判断 RPM 版本。现通过 RPM 头部 VERSION 字段与 package.json 精确比较；新增整个门禁的回归，证明旧头部即使使用新文件名也不能通过。
- **AppImage 插件依赖误报**：包内实际含 libtiff.so.5，但逐 ELF 的 ldd 检查没有 AppRun 的私有库搜索路径。现在按 AppRun.wrapped 的目录设置 LD_LIBRARY_PATH，并排除宿主继承的搜索覆盖；DEB/RPM 仍按系统库检查。用真实编译的共享库验证“包外检查缺失 → 包内解析通过 → 删除包内库后再次失败”，未放宽 GLIBC、架构或缺库门禁。
- **本地构建副本干扰静态检查**：Git 已忽略 artifacts/，ESLint 与 Prettier 却仍扫描其中源码副本；补齐同范围的生成物忽略规则，不排除正式源码。

| 包 | 文件大小 | 运行验收 |
| --- | --- | --- |
| ImgConvert-0.3.1-1.aarch64.rpm | 17,102,406 字节 | Fedora 42 安装、启动探测及四格式转换通过 |
| ImgConvert_0.3.1_aarch64.AppImage | 90,757,640 字节 | Ubuntu 22.04 extract-and-run 启动探测及四格式转换通过 |

RPM SHA-256：`652e55bd1c83834711b3facebc250b921c58b7ff838283ea78806b73463365b3`。

AppImage SHA-256：`a81fe877eee187382612f3276a15b49ec9861c6cd690b36abe043fc269990534`。

`pnpm test` 现为 31 文件、214 项通过；Lint、类型和改动文件格式检查通过。Fedora 虚拟显示日志出现 EGL/DRI3 警告，因此只声明启动存活探测，不声明 GPU 加速或真实显示器验收。

## 未覆盖

Linux amd64 DEB/RPM/AppImage 的构建与仿真容器验证已由后续 [amd64 验收记录](ENVIRONMENTAL_IMPACT_LINUX_AMD64_REVIEW.md) 补齐；amd64 DEB/RPM 升级卸载已由 [生命周期记录](LINUX_PACKAGE_LIFECYCLE_REVIEW.md) 补齐；原生硬件、macOS/Windows、真实显示器与读屏尚未验收。DEB/RPM 的 0.2.23 → 0.3.1 升级及 remove 已由后续 [生命周期验收](LINUX_PACKAGE_LIFECYCLE_REVIEW.md) 补齐；其他版本路径及 purge 未覆盖。AppImage 采用 extract-and-run 模式，未验证 FUSE 挂载模式。容器 GUI 启动探测不等于环保面板的安装件交互测试；该交互目前由上轮原生 debug E2E 覆盖。

正式 GitHub Release 仍须满足 AGENTS.md 的完整平台、架构、签名/公证、安装运行及来源证据要求。此单独 DEB 不能作为完整 Release 发布。

最终安装测试退出码为 0，包含完整四格式成功记录。测试前后候选 SHA-256 一致；摘要清单与日志均已保存在候选目录。这不是所有平台或全部安装生命周期的发布验收通过。

三种 ARM64 包已统一通过最终结构及 GLIBC 门禁。RPM/AppImage 测试结束后摘要与归档候选一致，SHA256SUMS 已扩展为三包清单；本轮门禁工具摘要另存 VALIDATION_TOOLS_SHA256SUMS。
