# Linux Ubuntu 22.04 构建环境

`Dockerfile.jammy` 提供项目 GLIBC 2.35 基线的构建环境。工具版本与当前项目对应；Ubuntu 包仓库和 Rust 安装脚本未固定摘要，因此不承诺逐字节可复现。首次验证范围及产物见 [amd64 验收记录](../../docs/ENVIRONMENTAL_IMPACT_LINUX_AMD64_REVIEW.md)。

## 构建镜像

```sh
sudo docker build --platform=linux/amd64 --build-arg TARGETARCH=amd64 \
  -f packaging/linux/Dockerfile.jammy \
  -t imgconvert-linux-builder:ubuntu22.04-amd64 packaging/linux
```

ARM64 对应 `--platform=linux/arm64 --build-arg TARGETARCH=arm64`，镜像标签也应区分架构。平台必须与 TARGETARCH 一致。跨架构 Docker 需要宿主已有 binfmt 支持；在 ARM64 宿主运行 amd64 容器属于仿真，不能代替原生 amd64 验收。

## 隔离源码与编译缓存

先将当前候选源码、锁文件和生产 `dist/` 复制到独立目录并生成 SHA-256 清单；不要复制宿主 `node_modules`。本次候选使用 `artifacts/linux-amd64-2026-09-07/source`。下面命令应在仓库根目录执行。

```sh
sudo docker run --rm --platform=linux/amd64 \
  -v "$PWD/artifacts/linux-amd64-2026-09-07/source:/workspace" \
  -v imgconvert-target-jammy-amd64:/build \
  -v imgconvert-cargo-registry-jammy-amd64:/root/.cargo/registry \
  -v imgconvert-cargo-git-jammy-amd64:/root/.cargo/git \
  -e CARGO_TARGET_DIR=/build -e RUSTUP_TOOLCHAIN=1.96.0 \
  -w /workspace imgconvert-linux-builder:ubuntu22.04-amd64 sh -c '
    pnpm --filter imgconvert --filter @imgconvert/environmental-impact install --frozen-lockfile --ignore-scripts &&
    pnpm tauri build --ci --target x86_64-unknown-linux-gnu --bundles deb --config '\''{"build":{"beforeBuildCommand":""}}'\''
  '
```

禁用 `beforeBuildCommand` 的前提是已提供本候选的生产前端，且已把它纳入来源清单。未准备前端时应先按项目脚本构建，不能复用不明来源的 `dist/`。`RUSTUP_TOOLCHAIN` 使用项目固定编译器，避免 Linux 构建额外安装根工具链文件所列的 Darwin targets；默认 features 不变，不启用 `desktop-e2e`。

编译卷必须按架构隔离，并固定挂载路径 `/build`，Tauri 缓存包含绝对路径。Cargo registry/git 是源码缓存，可复用，但不能共用不同架构的编译产物卷或 Node 原生依赖目录。

## 验证安装件

将最终包放在隔离副本的 `src-tauri/target/<target>/release/bundle/deb/`，或先创建该副本的 `src-tauri/target` 空目录，再将编译卷只读挂载到那里；只读源码挂载内不能临时创建挂载点。在匹配架构的 Ubuntu 构建容器中运行门禁，保证 `ldd` 使用正确架构的用户空间：

```sh
node scripts/check-linux-bundle-artifacts.mjs --target=x86_64-unknown-linux-gnu --bundles=deb
```

宿主仓库对应 target 目录有候选后，安装验证使用新的容器：

```sh
node scripts/smoke-linux-package-install.mjs \
  --target=x86_64-unknown-linux-gnu --bundle=deb \
  --image=amd64/ubuntu:22.04 --platform=linux/amd64 --convert-smoke
```

`--target` 为已识别的 x86_64/amd64 或 aarch64/arm64 时，脚本自动选择 Docker 平台；显式 `--platform` 冲突会拒绝执行。没有 target 时不推定跨架构平台。转换必须退出 0 并输出完整成功记录；GUI 启动探测仅覆盖进程启动，不等同于界面交互验收。

构建、安装验证、商店提交和公开发布分别记录。单个 Linux 包不足以公开 GitHub Release，完整条件见 [AGENTS.md](../../AGENTS.md)。

## 继续构建 RPM / AppImage

同一源码和编译卷可以继续使用 `--bundles rpm,appimage`。AppImage 构建和后处理须设置 `APPIMAGE_EXTRACT_AND_RUN=1`；将独立的 `imgconvert-tauri-cache-amd64` 卷挂载到 `/root/.cache/tauri`，避免复用 ARM64 打包工具。另将编译卷挂载到 `/workspace/src-tauri/target`，供现有后处理脚本定位产物，`CARGO_TARGET_DIR` 仍保持 `/build`。

构建后必须依次执行：

```sh
node scripts/scrub-linux-appimage.mjs --target=x86_64-unknown-linux-gnu
node scripts/check-linux-bundle-artifacts.mjs --target=x86_64-unknown-linux-gnu --bundles=deb,rpm,appimage
```

后处理会移除不兼容的 libgcrypt、注入 AppStream 元数据并重新打包，因此必须在它完成后保存候选及计算 SHA-256。RPM 使用 `--bundle=rpm --image=fedora:42`，AppImage 使用 `--bundle=appimage --image=amd64/ubuntu:22.04` 执行安装 smoke；两者均传 amd64 target、`--platform=linux/amd64` 和 `--convert-smoke`。

依赖门禁不能直接把宿主 `ldd` 的“not a dynamic executable”当作静态程序证明：现在会用 `readelf -d` 复核，存在 NEEDED 或无法读取时拒绝放行。请在匹配架构的用户空间运行完整门禁。

## amd64 升级与卸载

已有本地历史 0.2.8 包时，可验证到当前候选的升级路径。先在历史包目录核对其 `SHA256SUMS`，再执行：

```sh
node scripts/smoke-linux-package-install.mjs \
  --target=x86_64-unknown-linux-gnu --bundle=deb \
  --image=amd64/ubuntu:22.04 --platform=linux/amd64 \
  --upgrade-from="$PWD/src-tauri/target/v028-artifact-audit/linux-amd64/deb/ImgConvert_0.2.8_amd64.deb"
node scripts/smoke-linux-package-install.mjs \
  --target=x86_64-unknown-linux-gnu --bundle=rpm \
  --image=fedora:42 --platform=linux/amd64 \
  --upgrade-from="$PWD/src-tauri/target/v028-artifact-audit/linux-amd64/rpm/ImgConvert-0.2.8-1.x86_64.rpm"
```

该模式自动执行新旧版本转换、配置/图片保留检查和 remove；所有安装操作均在临时容器内。新版启动后会复核升级前的原图和旧输出摘要，配置允许 JSON 格式规范化，但语言与质量值必须保留。升级路径由旧包实际版本确定，不能把 0.2.8 的结果记为 0.2.23，也不覆盖全部历史版本或 purge。详见 [生命周期记录](../../docs/LINUX_PACKAGE_LIFECYCLE_REVIEW.md)。

## AppImage 手动替换与文件保留

```sh
node scripts/smoke-linux-package-install.mjs \
  --target=x86_64-unknown-linux-gnu --bundle=appimage \
  --image=amd64/ubuntu:22.04 --platform=linux/amd64 \
  --replace-from="$PWD/src-tauri/target/v028-artifact-audit/linux-amd64/appimage/ImgConvert_0.2.8_amd64.AppImage"
```

`--replace-from` 仅适用于容器内 AppImage，不能与 `--upgrade-from` 混用。它自动执行转换验证，先运行旧文件副本，然后将新文件以临时文件加同目录重命名的方式替换到同一路径。新文件必须逐字节匹配候选，且与旧文件不同；最终删除运行副本，复核配置、原图与输出保留。

该入口不根据文件名推定版本顺序，也不验证自动更新器、签名更新、桌面集成或 FUSE。调用前核对新旧包来源和摘要；版本路径在验收记录中按实际候选填写。默认仍使用 extract-and-run 模式，挂载的两个原始文件保持只读。
