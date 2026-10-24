# GPUI 0.4 macOS 发布验收记录（G3-6）

本文件逐项记录 `docs/RELEASE_QA.md` 中 macOS 条目在 GPUI 候选上的结果。用户在 2026-10-24 批准以 Parallels 虚拟机（macOS 13.6 arm64，无 GPU 直通）的结果作为验收依据。这里不发布 Release，也不提交商店。

## 候选

| 项目 | 值 |
| --- | --- |
| 源码 | main `8a2744e`（含 #79 截断 JPEG、#80 对话框辅助功能、#81 输出目录选择、#82 重复输出提示） |
| Developer ID DMG | run 40086028282：arm64 `2af030c6…`，x86_64 `1bd40860…`；均已签名、公证并 staple（x64 首次 staple 遇网络中断，第 2 次尝试重跑失败作业后通过；之后合入的 PR #83 为今后的 staple 增加重试） |
| MAS 通用 PKG | run 40086061849：`ImgConvert_0.4.0_mas.pkg validated by App Store Connect`（只校验，未上传） |
| 真实 GUI 冒烟 | run 40085939946：arm64 与 x64 托管 runner 上用源码构建的未签名 app 均通过（不是上面的签名 DMG） |

## 自动化门槛

DMG 工作流对每个架构执行 `file`、`lipo -archs`、`otool -L`、深度签名校验、Developer ID 授权、公证与 Gatekeeper 评估，并用 `check-macos-bundle-artifacts.mjs --require-signed --require-notarized` 校验最终 DMG；两架构均通过。MAS 工作流校验两切片 `lipo`、沙盒授权、描述文件与安装包签名，并经 App Store Connect 校验通过。

## 图片语料（虚拟机 arm64，direct 候选）

语料由脚本生成（CMYK JPEG、带透明 PNG、动画 WebP/GIF、路径与文字 SVG、引用外部图片的 SVG、静态 GIF、BMP、`sips` 生成的 HEIC 与 ImageIO 写出的双帧 HEIC、8000×8000 噪声 PNG、10000×10000 PNG、截断一半的 JPEG），经探针导入后以 AVIF 为目标转换；透明、SVG 与 data URI 用例另以小语料分别转 PNG/WebP/AVIF（无损）和 JPEG。

| 用例 | 结果 |
| --- | --- |
| CMYK JPEG | 完成；输出转回 PNG 后 RGB 均值与源一致（57, 63, 105），未反相 |
| 带透明 PNG | 无损转 PNG、WebP、AVIF：alpha 通道与源逐像素相同，可见像素 RGB 最大差 0；转 JPEG 按设计合成到白底 |
| 动画 WebP / 动画 GIF | 拒绝，不写出首帧输出 |
| 路径与文字 SVG | 转 PNG、WebP、AVIF、JPEG 四种输出均完成 |
| 引用外部图片或 data URI 位图的 SVG | 均拒绝，无输出 |
| 静态 GIF、BMP | 完成；BMP 输出 RGB 均值与源一致 |
| 静态 HEIC（ImageIO） | 完成 |
| 双帧 HEIC（ImageIO） | 拒绝，不写出首帧输出 |
| 8000×8000 | 完成。单张：峰值 RSS 约 1.9 GiB；四张同批（8 GiB 内存、4 核虚拟机）：峰值 2.1 GiB，耗时 174 s，约为单张的四倍，即按内存预算串行，没有失控的并行 |
| 10000×10000 | 在分配像素前拒绝 |
| 截断 JPEG | 拒绝、无输出（修复前会以灰色填充“成功”输出，PR #79 修复） |

补充发现：语料中同名不同扩展名的文件（`animated.gif` / `animated.webp`）映射到同一输出，后者原先显示批次级文案“批量转换无法完成”，已由 PR #82 改为专门提示。

x64 的 ImageIO HEIC 路径：虚拟机为 arm64 且未安装 Rosetta。HEIC 解码位于两壳共用的 `imgconvert-platform`，在 `macos-15-intel` 托管 runner 上由 `macos-intel-smoke.yml` 的 HEIC 冒烟覆盖（该冒烟构建的是 Tauri 壳，证明的是共用路径，不是 GPUI x64 包），本轮在 main 上重新运行（run 40088724030，`macOS Intel ImageIO Smoke` 通过，HEIC 导入并转换为 PNG）。

## 安装生命周期（虚拟机 arm64，独立 HOME）

全部在测试账号下的 `~/imgc-glass/lifecycle` 中进行，`HOME` 指向独立目录，不触碰真实用户数据。

1. 从 GitHub Release 下载 v0.3.1 arm64 DMG，SHA-256 与 Release 的 `SHA256SUMS` 一致；接受许可后拷贝到用户级 `Applications`，Gatekeeper 评估为 Notarized Developer ID。
2. 写入 0.3.1 store 格式的设置（WebP、质量 72、深色、英文）并启动 0.3.1：界面显示 “WEBP · Quality 72”、深色、英文，且 0.3.1 把设置文件改写为完整的规范化记录。
3. 升级：给 GPUI DMG 加上浏览器下载的隔离标记后挂载，删除旧 app 并拷入新 app（版本 0.4.0，CFBundleVersion 3）。首次打开出现系统提示“Apple 对其进行了检查，未检测到任何恶意软件”，点“打开”后以 App Translocation 方式启动，进程 `HOME` 仍为独立目录。
4. 升级后界面保持深色、英文、WebP、质量 72，即保留了 0.3.1 的用户设置；首次写入设置时生成 `settings.json.pre-gpui` 备份。
5. 用安装后的 app 转换 JPEG、PNG、WebP、AVIF、SVG、静态 GIF、BMP 七种输入，7/7 完成。
6. 卸载：删除 app 后可执行文件不存在，7 个输出与设置目录保留。

x64 的安装生命周期没有在 Intel 实机或虚拟机上做；x64 的启动、导入与转换只有托管 runner 上源码构建 app 的 GUI 冒烟，签名 x64 DMG 只经过工作流内的签名/公证/Gatekeeper 校验。

## 商店与签名验收

- Direct macOS：两架构 DMG 公证通过、staple 并经 Gatekeeper 评估（见上）。
- Mac App Store：通用 PKG 已通过 App Store Connect 校验。上传 TestFlight、在 Intel 与 Apple 芯片实机上用处理后的构建验收沙盒路径（选文件、选输出目录、转换、重启后重新选择输出目录、媒体库隐私域允许/拒绝），需要用户决定并在实机上操作，**尚未进行**；`RELEASE_QA.md` 要求的 App Review 连续实机录屏同样未做。

## 结论

除 TestFlight 实机验收（G3-2 剩余部分）、App Review 录屏与 x64 实机生命周期外，`RELEASE_QA.md` 的 macOS 条目在本候选上通过（上文注明了哪些是虚拟机原生、哪些是 CI 或共用路径证据）。G3-6 记为“部分完成，等待 TestFlight”。

## 证据

| 项目 | 位置 |
| --- | --- |
| 语料脚本与日志 | 测试机 `~/imgc-glass/qa-corpus/`（`run.sh`、`app-avif.log`、`ax-avif.txt`） |
| 生命周期截图 | 测试机 `~/imgc-glass/lifecycle/tauri-031-seeded.png`、`gpui-upgraded.png` |
| Intel HEIC 冒烟 | run 40088724030 |
