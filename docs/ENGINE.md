# 引擎与打包技术参考(混合架构)

> **架构决策(2026-06-29 转向)**:从「libvips CLI 子进程」改为**混合架构**——
> **进程内宽松许可 Rust 编解码 crate + HEIC 系统/外部插件留门**。
> 目的:满足 **Mac App Store / Microsoft Store / Flathub** 上架(沙盒 + 宽松许可)。
> ⚠️ 范围澄清:6 个参考项目验证的是**进程内 crate 引擎选型**;**上架/沙盒路径无先例,需自建**(见 [REFERENCES.md](REFERENCES.md))。

## 0. 为什么放弃 libvips

- libvips 是 **LGPL**,其「可替换/relink」要求与 App Store DRM 冲突 → 上 MAS 有风险。
- libvips 走 **CLI 子进程**,与 App Sandbox(限制 fork/exec)冲突。
- 捆绑 libvips 需重定位/重签一长串 dylib(`dylibbundler` + `install_name_tool`),复杂且易出错;且 brew libheif 会牵入 **x265(GPL/专利)**。
- **混合架构反而更简单**:C 编解码器由 crate 在**构建期静态链接**进单一 Rust 二进制 → **无 dylib 捆绑、无 rpath 手术、签名只签一个二进制**;系统框架(ImageIO/WIC)始终存在,无需分发。

---

## 1. 进程内 core 设计(参考 slimg,MIT 可直接借鉴)

统一架构:**`Codec` trait + `ImageData`(`PixelBuffer::{Rgba8,Rgba16,RgbaF32}` 管线边界)+ `get_codec(Format)` 分发 + `pipeline`(decode → 变换 → encode)**。core 为纯库,零 UI/IO 框架依赖,供 Tauri GUI / CLI / 测试共用。

```
crates/
  imgconvert-core/   # 纯库:Codec trait、ImageData、各 codec、pipeline、format 检测
  imgconvert-cli/    # (可选)命令行前端
src-tauri/           # Tauri 后端,仅做胶水:invoke 命令 + Channel 进度 + 可选系统/插件能力探测
```

要点:
- 统一中间表示 **`ImageData`**;`decode → (可选 color policy / resize) → encode` 串成 pipeline。当前 core 已有 `PixelBuffer::{Rgba8,Rgba16,RgbaF32}` 和 `color_pipeline_capabilities()` 边界;PNG 可保留 16-bit RGBA,但 JPEG/WebP/AVIF 编码入口仍显式落到 **RGBA8 + 8-bit SDR**。F32 目前是 0..1 display-referred 内部缓冲,不等于 HDR 容器信令已完成。
- 色彩管理语义分两层:默认 `convert()` 保持嵌入 ICC/metadata 保真,不会自动改像素;显式 `convert_with_color_policy(..., ConvertToSrgb)` 会通过 LittleCMS 做像素级 ICC→sRGB 转换并清空源 ICC,避免写回 stale profile。Tauri/前端通过 `colorManagementPolicy` 暴露「转为 sRGB」。`resize_linear()` 使用 sRGB↔linear、预乘 alpha 的 bilinear resize;缩略图在大倍率缩小时改用线性光 area 预滤波。JPEG 预览会在解码阶段缩放；其他格式的全量预览解码限制为 3200 万像素，超限仅省略缩略图并显示格式占位。`resize_linear()` 对非空 ICC 输入会拒绝,要求先转 sRGB。
- **崩溃防护(Codex 修正)**:`std::panic::catch_unwind` **只能截 Rust panic,挡不住 C 侧 segfault/abort/UB**。真正的健壮性靠:libjpeg error handler + **输入尺寸/像素上限** + 对可疑文件走隔离 worker + fuzz/corpus 测试。不要承诺「防住 C 崩溃」。
- **格式检测**:magic bytes + 扩展名。
- **输入/输出边界**:SVG、静态 GIF、BMP 为只读输入格式；可写格式仍只有 JPEG、PNG、WebP、AVIF。SVG 不加载任何外部或 data-URI raster `<image>`，携带这类 `<image>` `href` 的文件会明确拒绝，不会因一个被选中的 SVG 读取其他路径或静默丢失内容。
- 解码**保留 ICC/EXIF/XMP**(支持范围见 §5),不要直接 `to_rgb8` 丢元数据。

---

## 2. 编解码 crate 选型与参数(全宽松,已被多项目验证)

| 格式 | 解码 | 编码 | crate(许可证) | 关键参数 |
|---|---|---|---|---|
| **JPEG** | `mozjpeg::Decompress`(保留 APP1/APP2) | `mozjpeg`(trellis 默认开,progressive) | `mozjpeg`(IJG/BSD) | quality 0–100;progressive(默认开,通常略小、更慢);高级参数已接 MozJPEG trellis scans。⚠️ **「JPEG→JPEG 无损系数转码(jpegtran 式)」走 DCT 系数域、绕过 RGBA8 管线**——`mozjpeg` crate 是否暴露该 transform API **需核实**;v1 暂不承诺 |
| **PNG** | `image` | `image` 编码 → **`oxipng`** 优化 | `oxipng`(MIT)、`image`(MIT/Apache)、`color_quant`(MIT,实验性限色) | 默认无损 level 0–6(**甜点 4**);实验性有损限色默认关闭,用 NeuQuant 映射 RGBA 后仍输出普通 PNG 再走 oxipng |
| **WebP** | `image` | **`webp`**(libwebp) | `webp`(Apache/MIT;底层 libwebp BSD) | quality(有损);**无损=独立 lossless 模式**(`WebPConfig.lossless`,**不是 q100**);method 0–6(**甜点 4**);near_lossless 0–100(100=关闭,仅无损模式生效);sharp_yuv 可选;alpha |
| **AVIF** | `libavif-sys`(dav1d 默认) | **`libavif-sys`(rav1e 有损 + aom 无损)** | `libavif-sys`(**BSD-2,以 cargo-about 实测为准**)、libavif(BSD-2)、rav1e(BSD-2)、libaom(BSD,以 cargo-about 实测为准) | quality、speed 0–10(甜点 8),subsample 4:4:4/4:2:0;`lossless=true` 强制 AOM 后端 + identity matrix + full range + quantizer 0 + YUV444,并以像素级 round-trip 测试守住。采 DropWebP 路线。⚠️ **弃用裸 `ravif`/`image::AvifEncoder` 的真因(Codex 修正)不是「丢 alpha」**(它们都能处理 RGBA8 alpha),而是 **ICC/EXIF/nclx 等容器元数据控制弱 + 后端不可插拔 + 解码一致性**;libavif 容器层能正确写 ICC/nclx/alpha/EXIF。后端可插拔:rav1e(默认有损,构建稳)/aom(真无损)/svt |
| **TIFF**(推后) | `image` | `image`(tiff feature) | `image` | v1 不做;无损 deflate/lzw |
| **SVG**(读) | `resvg` | — | `resvg`(Apache-2.0/MIT) | 仅本地栅格化；默认 96 DPI、16 MiB 源码上限、64 MP 画布上限；携带 `href` 的本地路径或 data URI `<image>` 会明确拒绝，避免 SVG 扩大文件访问边界或静默丢失内容 |
| **GIF**(读) | `image` | — | `image` | 仅静态 GIF；在 LZW 像素解码前检查 image descriptor 数量，动画 GIF 明确拒绝 |
| **BMP**(读) | `image` | — | `image` | 解码用，走与 PNG/JPEG 相同的尺寸和分配上限 |
| **PDF**(单向读) | `hayro`(Tauri 边界) | — | `hayro`(Apache-2.0 OR MIT) | PDF 不进入 core `Format`；桌面后端按 72–600 DPI 逐页渲染为有界 RGBA，再复用统一 workflow。支持全部页或 `1-3,5` 范围，一次最多 500 页；加密/密码 PDF 明确拒绝 |
| ~~**JPEG XL**~~ | — | — | — | **删除**(评审一致:libjxl 重型 C++,过早) |
| 缩放 | — | — | `fast_image_resize`(MIT/Apache) | — |
| 质量判定 | — | — | **`ssimulacra2`**(宽松,**勿用 dssim/AGPL**) | 感知打分,用于「自动质量」(§6) |

### bench 默认值(项目实测持续校准)
- **oxipng level 4**(比 2 省 8–28%,时间 2×;6 只再省 ~1% 不值)
- **AVIF speed 8**(Linux arm64 release 实测 `1024x768/q82/3轮`:speed 8 median 432.170 ms / 34,477 B;speed 10 median 175.945 ms / 67,290 B。Apple Silicon 的 [macOS Smoke run 32225662409](https://github.com/web-casa/ImgConvert/actions/runs/32225662409) 以同口径复核: speed 8 median 791.185 ms / 34,477 B;speed 10 median 286.359 ms / 67,290 B。speed 8 在 macOS 慢 2.763×,但体积小 48.76%,继续作为全平台默认)
- **WebP method 4**(Linux arm64 release 实测 method 4 median 28.280 ms / 17,220 B;method 6 median 31.570 ms / 17,270 B,更慢且更大,继续保留 method 4。当前通过 `webp::WebPConfig` + `encode_advanced()` 传入,不需要额外引入 `libwebp-sys` 直连依赖)
- **JPEG progressive 默认开**(通常比 baseline **略小**、但更慢——⚠️ Codex 指出「~3×」量级不实,以项目实测百分比为准;UI 提供 baseline「最大兼容」选项)
- **skip-if-larger 默认关**:Tauri 胶水层可在 core 编码后、写文件前比较候选输出与源文件字节数；仅当用户显式开启该压缩策略时，候选 `>=` 源文件会跳过写入并计入 skipped。默认保证指定格式迁移（例如为旧系统生成 PNG）。
- **多候选取最小默认开**:core 暴露 `convert_best_of()` 保证只解码一次。Tauri 生成等价候选并取最小:JPEG baseline/progressive、PNG 多个 oxipng level、WebP 多个 method;AVIF 暂不多候选。候选不改变 quality/lossless/目标格式。

### ⚠️ 两个 copyleft 雷(宽松/上架必须避开)
- **`imagequant`(GPL-3.0/商业)**——有损 PNG 调色板量化。**替换**为:`color_quant`(NeuQuant,MIT)实验性限色或只做 oxipng 无损。
- **`dssim`(AGPL/GPL)**——视觉差异。**改用 `ssimulacra2`**(宽松)。

### 有损 vs 无损
- AVIF:libavif/rav1e 有损为主(quality/speed);`lossless=true` 走独立 AOM 真无损路径(identity matrix + full range + quantizer 0 + YUV444),进入 `LOSSLESS_FORMATS` / capabilities。用户即使选择 4:2:0,无损路径也会强制 4:4:4。rav1e 当前不能声明真无损。
- WebP:`encode_lossless`(完全可逆,适合图形/截图)vs `encode(quality)`(有损)。
- PNG:默认无损(oxipng);有损=量化(避开 imagequant)。
- JPEG:永远有损;无损只能转码(DCT 系数重排,不改像素)。
- TIFF:deflate/lzw 无损;jpeg 有损。

---

## 3. HEIC:系统原生 + 可选外部插件(主程序仍不内置)

HEIC = HEIF 容器 + 常见 HEVC 编码,有专利;**主程序不捆绑 x265、不链接 libheif、不把 LGPL/GPL codec 放进 Apache-2.0 主包**。⚠️ 关键决策(评审 #1):**「主依赖树禁 LGPL」与「Linux 直接链接 libheif」自相矛盾 → Linux v1 不内置 HEIC**。但可以在 v1 之后做**外部插件/helper**:主程序只实现插件协议,用户显式安装后激活 HEIC 导入。

| 平台 | HEIC 解码 | HEIC 编码 | 实现 |
|---|---|---|---|
| **Linux(v1 主包)** | ❌ 不内置 | ❌ 不做 | 避免 LGPL/x265/专利 |
| **Linux 可选插件** | ✅ decode-only | ❌ 不做 | 独立进程 helper;优先检测系统 `heif-convert`/`heif-dec`,或单独 LGPL 插件动态链接系统 libheif/libde265 |
| **macOS(第一批)** | ✅ ImageIO read-only | ❌ 暂不启用 | `macos_system_codecs.rs` 进程内调系统 `ImageIO.framework`,HEIC/HEIF 解码为 PNG 字节再进 core;provider kind=`system-imageio`,不 shell `sips`,不链接 libheif/x265 |
| **Windows 系统路线** | WIC + 用户装 HEVC 扩展 | ❌ 不承诺 | `windows-rs` 调 WIC;**仅解码**,运行时探测扩展是否注册,缺失则引导安装,**不承诺开箱即用**(评审 #5) |
| **Windows 可选插件** | ✅ decode-only | ❌ 不做 | 已接入独立 `imgconvert-heic-helper.exe` 外部 helper 协议;自建 decode-only libheif/libde265 动态包,不直接整包带 MSYS2 `libheif` 发行包(其依赖可能含 x265) |

- macOS 上 **ImageIO 也能写 AVIF**(macOS 13+),但 AVIF 我们已用 `libavif-sys` 跨平台统一,系统 ImageIO 仅作 HEIC 专用。
- macOS HEIC 编码输出暂不启用。若未来要做,必须在 direct + MAS sandbox 中实测 `CGImageDestination` HEVC 编码、专利/文案边界和 App Review 风险,再把 HEIC 加进 writable。
- 参考:DropWebP `backend/src/command.rs:55-85`(magic-byte 检测 `ftyp/heic` → 调系统解码)。

### Linux 插件依赖矩阵(安装检测,不假设全都有)

- **Debian/Ubuntu 系**:`libheif-examples` 提供 sample tools(`heif-convert`/`heif-dec` 等,版本/文件名以发行版为准);`heif-gdk-pixbuf` 只让 GTK/GDK Pixbuf 生态能读,`heif-thumbnailer` 只给文件管理器缩略图,**不会自动让 Tauri/core 支持 HEIC**。插件应优先探测可执行文件而不是只探测包名。
- **Fedora 系**:官方仓库有 `libheif` / `libheif-tools` / `heif-pixbuf-loader`;HEVC-encoded HEIC 支持常由 RPM Fusion 的 `libheif-freeworld` 补齐。插件 UI 应显示「需要启用 RPM Fusion/安装 freeworld 组件」而不是笼统报“HEIC 不支持”。
- **Flatpak/Flathub**:默认主包仍不含 HEIC。若以后做 Flatpak 插件,必须先确认 portal 沙盒内能否执行外部 helper、访问用户授权路径,并把 LGPL helper 作为独立扩展/可替换组件处理。

### 插件协议边界

- 主程序只查找插件 manifest,例如 `imgconvert-codec-heic.json`:
  ```json
  {
    "id": "imgconvert-heic-helper",
    "protocol": 1,
    "license": "LGPL-3.0-or-later",
    "readable": ["heic", "heif", "hif"],
    "writable": [],
    "mode": "external-process",
    "decode": {
      "kind": "heic-to-png-file",
      "command": "bin/imgconvert-heic-helper",
      "args": ["{input}", "{output}"],
      "output": "png"
    }
  }
  ```
- 当前 v1 manifest 发现顺序:
  - `IMGCONVERT_CODEC_PLUGIN_DIRS` 环境变量(按平台 path-list 分隔,用于开发/直发包显式配置);
  - Linux/Unix:`$XDG_DATA_HOME/imgconvert/codecs` 或 `$HOME/.local/share/imgconvert/codecs`;
  - Linux/Unix:`$XDG_DATA_DIRS/imgconvert/codecs`,默认覆盖 `/usr/local/share/imgconvert/codecs` 与 `/usr/share/imgconvert/codecs`;
  - Windows:`%LOCALAPPDATA%\ImgConvert\codecs` 与 `%PROGRAMDATA%\ImgConvert\codecs`;
  - 目录中优先读取 `imgconvert-codec-heic.json`,然后读取其它 `imgconvert-codec-*.json`。
- 当前 v1 provider 激活优先级:**用户显式选择 helper → manifest provider → 系统 PATH helper**。手动 helper 通过 `set_selected_heic_helper` 写入本次运行的后端白名单,前端设置持久化路径并在启动/能力检测时同步;有效路径会保存为 canonical 可执行文件,按默认 `{input} {output}` argv 协议调用;失效路径仅用于诊断展示,不会执行。
- v1 校验规则:
  - `protocol` 必须为 `1`;`mode` 必须为 `external-process`;`decode.kind` 必须为 `heic-to-png-file`;`decode.output` 必须为 `png`。
  - `readable` 只能声明 `heic/heif/hif`,且必须包含 `heic`;`writable` 必须为空。
  - `license` 允许 `LGPL-2.1-only` / `LGPL-2.1-or-later` / `LGPL-3.0-only` / `LGPL-3.0-or-later` 以及 MIT/Apache/BSD/MPL 等宽松许可;拒绝 GPL/AGPL。
  - `command` 可以是 manifest 目录内的相对路径,也可以是受信任目录里的绝对路径;相对路径禁止 `..`,符号链接解析后不能逃出 manifest 目录。manifest/helper 文件会解析到 canonical 路径后校验父目录信任与文件写权限,manifest 文件读取上限为 64 KiB。
  - 用户显式选择的 helper 同样必须解析为 canonical 的受信任普通可执行文件；Linux 校验父目录及所有祖先目录、helper 文件均不可 group/world-writable；Windows 只接受 Program Files、`%PROGRAMDATA%\\ImgConvert\\codecs` 或 `%LOCALAPPDATA%\\ImgConvert\\codecs` 下的 `.exe`。因此“手动选择”只授予配置意图，不能绕过路径信任检查，也不执行 shell。
  - `args` 是 argv 模板,占位符 `{input}` / `{output}` 必须各自作为独立 argv entry 出现;可选 `{metadata}` 也必须是独立 argv entry,用于让 helper 写 metadata sidecar;主程序不执行 shell。
- v1 错误码前缀包括:`HEIC_PLUGIN_PROTOCOL_UNSUPPORTED`、`HEIC_PLUGIN_LICENSE_UNSUPPORTED`、`HEIC_PLUGIN_READABLE_UNSUPPORTED`、`HEIC_PLUGIN_WRITABLE_UNSUPPORTED`、`HEIC_PLUGIN_MANIFEST_UNTRUSTED`、`HEIC_PLUGIN_MANIFEST_TOO_LARGE`、`HEIC_PLUGIN_HELPER_UNTRUSTED`、`HEIC_PLUGIN_HELPER_NOT_EXECUTABLE`、`HEIC_PLUGIN_ARGS_INVALID`、`HEIC_PLUGIN_DECODE_KIND_UNSUPPORTED`、`HEIC_PLUGIN_OUTPUT_UNSUPPORTED`。
- 调用方式优先用**独立进程 + JSON/stdin/stdout/临时文件**,不要 `dlopen` 到主进程。这样主程序 Apache-2.0 依赖树保持干净,LGPL helper 可单独履行源码/替换/NOTICE 义务。
- 第一版只做 `HEIC/HEIF -> PNG/RGBA/temp file` 再进入现有 core 管线;不提供 HEIC 编码输出。metadata sidecar 第一批允许 helper 额外写 `metadata.json`:
  ```json
  { "version": 1, "icc": "icc.bin", "exif": "exif.bin", "xmp": "xmp.bin", "iptc": "iptc.bin" }
  ```
  sidecar 引用的 blob 必须是同一受控临时目录内的普通文件名,JSON 上限 64 KiB,单个 metadata blob 上限 16 MiB;主程序读取后会规范化 EXIF/XMP orientation 并传给 core。`iptc` 字段可选,老 helper 不需要提供。未声明 `{metadata}` 的老 helper 仍只输出 PNG。
- 安全约束:HEIC 源文件先受 256 MiB 上限约束；helper 路径必须来自受信任安装目录；用户显式选择也必须通过该信任检查。manifest 不允许任意 shell;传参使用 argv/JSON,禁止拼 shell 命令;临时文件放应用受控目录并清理。helper/ImageIO/WIC 输出的桥接 PNG 读取上限为 256 MiB，且批处理把 HEIC 系统解码串行化；helper stdout 不落盘,stderr 只保留前 64 KiB;metadata sidecar 禁止绝对路径、`..` 和子目录逃逸。
- 平台信任边界:Linux 使用 PATH/manifest/手动 helper 目录及其祖先、manifest/helper 文件均不可 group/world-writable 的信任模型,临时目录 0700。Windows 外部 helper 已启用:手动 helper、manifest/PATH 自动发现均只接受 canonical 后位于 Program Files、`%PROGRAMDATA%\ImgConvert\codecs` 或 `%LOCALAPPDATA%\ImgConvert\codecs` 下的 `.exe`;helper 解码临时目录位于 `%LOCALAPPDATA%\ImgConvert\Temp\heic`,同样不走 shell。macOS 外部 helper 自动发现暂不启用;Windows WIC 和 macOS ImageIO 系统解码仍是 P3 平台项,不是 P1.5 外部 helper 的一部分。
- 分发约束:外部 helper 主要面向直发包/用户自行安装场景;App Store/MS Store/Flathub 构建默认禁用外部 helper,除非对应渠道明确允许并完成单独合规设计。当前实现支持用 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` 在运行时或构建时禁用外部 codec/helper 自动发现,诊断 UI 会显示禁用原因。

---

## 4. 跨平台 C 工具链(我们最担心的点,已有现成配方)

C 编解码器(rav1e/mozjpeg/libaom/dav1d via libavif)在**构建期**需要原生工具链:

- **NASM**(rav1e、mozjpeg 的 **x86/x86_64** 汇编)——⚠️ **仅 x86 需要,不是「所有平台」(Codex 修正)**:`mozjpeg-sys` 在 Intel 用 nasm、**ARM 用 gas**;libavif/rav1e 同理按 target arch 分。CI 工具链按「crate × feature × target arch」列矩阵,别一刀切。
  - **macOS x86_64 / universal 构建当前钉 NASM 2.16.03**；工作流会校验下载 SHA-256。若 libaom 上游的探测逻辑变化，先在 Intel 和 universal smoke 中验证后再更新版本。
  - ⚠️ **装好后在 build 脚本里做版本检测,失败给明确错误**——别让 cmake 抛玄学报错(评审 #11)。这是已知脆弱点,长期关注上游修复以摆脱钉版本。
  - Windows:`ilammy/setup-nasm` 或 `choco install nasm` + MSVC(`ilammy/msvc-dev-cmd`)。
- **cmake**(libavif/libaom)、**meson + ninja**(dav1d)。
- **声明式装依赖**:用 **cargo-dist** 的 `[dist.dependencies.{apt,homebrew,chocolatey}]` 统一声明 nasm/cmake/meson/ninja(slimg 范式)。Linux v1 重点验证 Debian/Ubuntu(apt)+ Fedora(dnf)。
- **P0.5 预检入口**:`pnpm run toolchain:check` 已检查 cmake / meson / ninja,并只在 x86/x86_64 检查 NASM。该脚本已接入 `quality:rust`;P3 已把 Tauri debug bundle smoke 扩到 Linux amd64 + arm64,并通过 Docker runtime matrix 覆盖 Ubuntu `.deb`、Debian `.deb`、Fedora `.rpm`、Ubuntu AppImage。
- **RustSec advisory 例外边界**:CI 的 `cargo deny check ... advisories` 与 `pnpm run audit:rust` 只忽略 `src-tauri/deny.toml` / `scripts/audit-rust-advisories.mjs` 中列明的上游例外。当前例外来自 Tauri Linux GTK3/WebKitGTK 栈、Tauri `plist -> quick-xml` 配置解析链和 rav1e/libavif 构建链;它们不改变图片解码安全边界。若 `plist/tauri-utils` 升到 `quick-xml >=0.41.0` 或 Tauri 切到 gtk4-rs,必须删除对应 ignore。
- **P3 Linux 发布入口**:`pnpm run release:linux` 会先清理旧 bundle,再显式调用 `tauri build --bundles deb,rpm,appimage`;AppImage 会经过 `scripts/scrub-linux-appimage.mjs` 删除 deny-list 系统库(当前 `libgcrypt.so.20`)并重新打包,随后用 `scripts/check-linux-bundle-artifacts.mjs` 解包 `.deb`/`.rpm`/`.AppImage`，校验版本、包内容、每个 bundled ELF 的架构和 `ldd`、GLIBC 基线、AppImage root symlink 和 `.desktop` 元数据,最后生成 `SHA256SUMS`。`release:linux:debug` 只打 `.deb` 用于快速 smoke;需要 debug 全量 bundle 时用 `release:linux:debug:all`。
- **P3 安装启动 smoke**:`scripts/smoke-linux-package-install.mjs` 支持 host 和 Docker 模式。CI debug `.deb` smoke 会安装包并启动一次;release workflow 跑 `pnpm run release:linux:smoke:docker`,覆盖 Ubuntu 24.04 `.deb`、Debian 13 `.deb`、Fedora 42 `.rpm`、Ubuntu 22.04 AppImage。启动层同时支持 `xvfb-run` 与裸 `Xvfb`;AppImage smoke 设置 `APPIMAGE_EXTRACT_AND_RUN=1`,避免容器无 FUSE 时误报。Docker 模式会在无直接 socket 权限时尝试 `sudo -n docker`;本机可用 `IMGCONVERT_DOCKER_APT_MIRROR=https://...` 覆盖 Ubuntu apt 源,该值只接受 http/https 且拒绝 shell 元字符。
- **P3 Flatpak 第一版**:`packaging/flatpak/io.github.yeagoo.imgconvert.yml` 固定 app-id、desktop/metainfo、portal-friendly 权限和主包禁宿主外部 codec helper(`IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`)。当前 manifest 使用 Flathub 可解析且未 EOL 的 GNOME `50` runtime 与 `release:flatpak:prepare` 生成的 release archive,仍不得把 HEIC/helper 放进主包。
- **Flatpak HEIC extension 真包(repo 侧)**:主包额外设置 `IMGCONVERT_ALLOW_FLATPAK_CODEC_EXTENSIONS=1` 并定义 `io.github.yeagoo.imgconvert.Codecs` extension point(`/app/extensions/codecs`)。后端在全局禁外部 codec 时只扫描该沙盒内扩展目录,不扫描宿主 PATH/XDG helper。`packaging/flatpak/extensions/heic/io.github.yeagoo.imgconvert.Codecs.Heic.yml` 固定 `libde265 v1.1.1` 与 `libheif v1.23.1` 源码 sha256,构建 `heif-dec` wrapper 作为 decode-only helper,安装 LGPL license/notice,并显式关闭 HEIC encoding、`x265` 与 GPL-only codec 路径。真实 Flathub addon 提交、专利/频道审核和 HEIC 样张沙盒 smoke 仍是发布验收项。
- **P3 Flatpak source bundle**:`pnpm run release:flatpak:prepare` 已把 Flathub 最后一公里收口为生成式 source archive:源码树复制到临时 staging,Corepack 将 `package.json` 固定的 pnpm 打成 `.flatpak-vendor/corepack.tgz`,Cargo 依赖通过 `cargo vendor --locked` 放入 `.flatpak-vendor/cargo`,pnpm 包通过 `pnpm fetch --frozen-lockfile` 放入 `.flatpak-vendor/pnpm-store`,再打成 `target/flatpak/sources/imgconvert-<version>-source.tar.gz` 并回写 manifest sha256。默认 manifest 使用本地 `path:` source 便于本仓库/CI build;真正 Flathub PR 在发布该 archive 后用 `release:flatpak:prepare -- --source-url=https://.../imgconvert-<version>-source.tar.gz` 切换为 `url:` source。Flatpak build 侧使用 node/rust SDK extension、离线 Corepack cache、`pnpm install --offline` 和 `cargo build --release --locked --offline`。
- **P3 Flatpak 真实运行 smoke**:`pnpm run release:flatpak:smoke` 会准备 source archive、跑 manifest guardrail、用 `flatpak-builder` 构建,再分别通过 `flatpak-builder --run` 与安装后的 `flatpak run --user --command=imgconvert` 执行隐藏转换 smoke。该 smoke 仍保持 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`,验证主 Flatpak 包内真实 JPEG/WebP/PNG/AVIF 转换链路,不启用 HEIC helper。
- **P3 包内转换 smoke**:安装后的 Linux 包可用 `IMGCONVERT_PACKAGE_CONVERT_SMOKE=1 imgconvert` 进入隐藏 smoke 路径,不启动 GUI,直接用真实 core 编解码链把内置 PNG 转换为 JPEG/WebP/PNG/AVIF 并验证输出 magic/尺寸。`release:linux:smoke:docker` 默认在启动 smoke 后执行该转换 smoke。
- **Tauri updater GitHub Releases 通道**:默认 `tauri.conf.json` 只保留空的 inert updater 公钥/endpoint。MAS/MSIX store 构建会设置 `IMGCONVERT_DISABLE_UPDATER=1`,在编译期移除 updater 插件注册、限制 capabilities 为 `default` 并隐藏更新入口,商店更新分别交给 Apple/Microsoft。直发更新必须先用 `TAURI_UPDATER_PUBKEY` / `TAURI_UPDATER_ENDPOINTS` 生成 `src-tauri/target/updater/tauri.updater.generated.conf.json`,再作为额外 Tauri config 构建。应用内“应用更新”入口通过 `@tauri-apps/plugin-updater` 检查、下载并用 `@tauri-apps/plugin-process` restart;capability 只开放 `updater:default` 与 `process:allow-restart`。GitHub Releases 默认 endpoint 为 `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`。`pnpm run release:linux:updater` 由 `scripts/release-linux-updater.mjs` 编排完整 Linux AppImage updater build;本机可从 `~/.tauri/imgconvert-updater.key*` 读取 key 并只注入子进程环境,CI 仍使用 GitHub Secrets。AppImage scrub 后会用 `tauri signer sign` 重签最终 artifact;`pnpm run release:updater:manifest` 支持 Tauri v2 的 `.AppImage/.msi/.exe + .sig` 以及旧兼容 `.tar.gz/.zip + .sig`,`pnpm run release:updater:verify` 上传前校验 URL、平台 key 与 `.sig` 内容。Flatpak 更新仍交给 Flathub;`.deb/.rpm` 默认交给发行包渠道。
- **Tauri in-app updater smoke**:`pnpm run release:updater:upgrade-smoke:eligibility` 只验证旧/新 release manifest、artifact 和签名,可在任意架构运行。`pnpm run release:updater:upgrade-smoke` 是真实 GUI 升级 smoke,当前只支持 Linux x86_64 AppImage:脚本用 Xvfb/xdotool 启动旧 AppImage、点击更新弹层、等待 AppImage 被 latest artifact 替换,再运行 `IMGCONVERT_PACKAGE_CONVERT_SMOKE=1` 验证更新后的二进制。GitHub `Updater Upgrade Smoke` workflow 为手动触发,运行在免费的公共仓库标准 Ubuntu runner 上。
- **GitHub Actions 公共仓库成本护栏**:CI 在 `main` push 与 PR 上自动运行标准免费 runner;`v*` tag 自动触发 Linux amd64+arm64 release;macOS/Windows/updater 发布仍为手动触发但不再需要付费确认。`pnpm run ci:cost:check` 静态检查仅使用免费标准 runner,防止误改到 paid larger runner 或 schedule 循环。详见 [CI_COSTS.md](CI_COSTS.md)。
- **发布 readiness 报告**:`pnpm run release:readiness` 是只读汇总入口,把本机可跑 guardrail、已有 artifact 与外部阻塞项分开列出。它不会构建、联网或触发 GitHub Actions,适合发布前先确认 macOS/Windows/updater/Flathub HEIC 还有哪些必须依赖真实账号、证书或 runner。
- AVIF 走 **`libavif-sys` 混合后端**:有损默认 rav1e(构建稳、速度参数继续由平台 benchmark 校准);真无损走 AOM,因为 libavif 上游明确 rav1e 不能支持 lossless。libavif 容器层经 cmake 构建,libaom 带来额外 C/C++ 构建成本和 x86 NASM 要求。
- **静态链接**:codec 全静态进二进制。⚠️ 注意 **Linux 上 webkit2gtk 仍是动态系统库**(Tauri 依赖,各发行版版本不同),所以「单一静态二进制」仅指 codec 部分,不含系统 WebView。

---

## 5. ICC / EXIF / XMP / IPTC 保真(脏活,Hando 有带测试的实现可参考重写)

- **当前语义**:工作流提供 `stripAll`(先按 ICC 转为 sRGB，再移除 ICC/EXIF/XMP/IPTC)、`colorOnly`(仅 ICC)和 `preserveAll`(保留全部支持项)三种 profile。旧 `preserveMetadata` 仅作为一代 IPC/持久化迁移兼容；新 enum 同时存在时优先。解码阶段会尽量提取 metadata 到 `ImageData { icc, exif, xmp, iptc }`,编码前按完整 blob 白名单过滤。
- **JPEG**:已实现 APP1 EXIF、APP1 XMP、APP2 ICC 1-based 分块与 APP13 Photoshop IPTC-NAA resource(`0x0404`)提取/写回。EXIF 存 TIFF payload,写 JPEG 时补 `Exif\0\0`;XMP 存 raw packet;IPTC 存 raw IIM payload。长 XMP 超过单 APP1 上限时会写标准 marker packet + Extended XMP APP1 分片,读取时按 GUID/总长/offset 重组。
- **PNG**:已实现 `iCCP` zlib 解压/压缩、`eXIf` 和 `iTXt` XMP(`XML:com.adobe.xmp`)提取;读取端支持未压缩与 zlib 压缩 iTXt,写入端统一输出未压缩 iTXt。写入发生在 **oxipng 优化之后**、`IHDR` 后,避免优化器剥离。
- **WebP**:已实现 RIFF chunk 手术;必要时插入/更新 `VP8X`,设置 ICC/EXIF/XMP flag,写 `ICCP`、`EXIF` 与 `XMP ` chunk 并更新 RIFF size。
- **AVIF**:✅ `libavif-sys` 路径已通过 `avifImageSetProfileICC` / `avifImageSetMetadataExif` / `avifImageSetMetadataXMP` 写回 ICC/EXIF/XMP;解码读取 `avifImage.icc/exif/xmp`。裸 `ravif`/`image` 被弃用的核心原因仍是容器元数据/ICC 控制弱。
- **EXIF/container orientation**:JPEG/PNG/WebP 解码会把像素**真旋正**；AVIF 解码会按 MIAF 顺序应用容器 `irot` / `imir`，仅在容器没有方向变换时才用 EXIF orientation 兜底。像素旋正后 EXIF orientation 会规范化为 1，XMP orientation 会移除，避免后续查看器二次旋转；各格式 `probe()` 返回同一旋正后尺寸。
- **语义 metadata 模块**:`inspect_metadata_semantics()` 可报告 EXIF orientation、MakerNote offset/byte_len、IPTC dataset 列表与常见字段名、XMP orientation/history 语义。MakerNote 与厂商私有字段只识别边界并原样保留,不做猜测性解析或改写。
- **导入 probe DPI**:`probe()` 不解码像素即可返回 PNG `pHYs`、JPEG JFIF density、JPEG/WebP/AVIF EXIF Resolution(`XResolution`/`YResolution`/`ResolutionUnit`)。AVIF 通过 libavif parse 阶段暴露的 EXIF metadata 读取,不调用 `avifDecoderNextImage` 做像素解码。
- **XMP 边界**:当前以 raw packet 透传为主,但会保守移除 `tiff` / `exif` namespace 下的 `Orientation` attribute/element/self-closing element,避免像素已旋正后留下二次旋转语义;同时移除 `xmpMM` namespace 下的 `History` 编辑历史节点。清理逻辑支持自定义 XML namespace 前缀,不依赖固定 `tiff:` / `exif:` / `xmpMM:` 前缀。
- **Display P3 / ICC 测试**:core 测试中自生成 Apache-2.0 兼容的 Display P3 ICC fixture。覆盖两类语义:开启 `preserveMetadata` 后 P3 ICC 在 JPEG/PNG/WebP/AVIF 间逐字节保留;显式 `ConvertToSrgb` 后像素确实变化、alpha 保持、源 ICC 被清空。
- **HEIC sidecar**:外部 helper 若声明 `{metadata}` 可把 HEIC 原始 ICC/EXIF/XMP/IPTC 以 sidecar blob 交回主程序;Tauri 会把该 metadata override 传入 core。结果缓存 key 在 profile 会保留 metadata、显式转 sRGB、`stripAll` 先转像素，或 resize 可能使用 override ICC 改变像素时纳入相应 sidecar hash。
- **metadata 资源上限**:容器 metadata blob 统一限制为 16 MiB;JPEG Extended XMP 声明总长、JPEG APP13/IPTC、PNG zlib metadata 解压、WebP/AVIF metadata copy 和写回路径都受该上限保护。
- **未做**:厂商 MakerNote 私有字段深层语义改写、JPEG/WebP/AVIF 16-bit/HDR 落盘保真、HDR PQ/HLG/nclx 端到端。

---

## 6. 自动质量(可选高级特性,Hando 思路,重写)

- ⚠️ **仅对 JPEG/WebP 开放**(Claude 自审 N2):`ssimulacra2` 二分搜索每轮一次完整编码,且需要可调 quality 旋钮。**PNG 默认无损(无 quality 可搜)、有损量化又是实验性默认关**,故 PNG 不进自动质量;**AVIF 编码慢,二分 = 不可用**(评审 #3),只给「固定 quality + 视觉无损」两档。
- P2 已落地每格式质量下限阈值:JPEG/WebP/AVIF 有损模式支持 30-100,低于 30 视为禁用;自动质量搜索不得低于该下限。PNG 无 quality 搜索,WebP/AVIF 无损模式忽略有损质量下限。
- 用 **`ssimulacra2`** 感知打分 + **二分搜索**:找「达到目标分 S 的最小质量」(质量阶梯 step≈4,最坏评分次数由 `AUTO_QUALITY_MAX_SCORING_EVALUATIONS=7` 约束)。`ssimulacra2` 关闭默认 rayon feature,避免与文件级并发叠加。
- **WebP 无损候选 vs 有损候选同时竞争,取小者**。JPEG 只做有损搜索;AVIF 不做自动质量。
- **代际损失防护默认关**:对已是有损的源(JPEG/AVIF/lossy WebP),可按 **bits-per-pixel** 分级收紧门槛;当前最低收益阈值为 2%/3%/5%/8%。仅在用户显式启用时才跳过收益不足的重编码，保证指定格式迁移。VP8L lossless WebP 与 AVIF lossless 目标不触发。PNG 默认仍按无损源处理,但若 core 的 JPEG 8×8 亮度/色度网格或 WebP-like 4×4 块边界 hint 明显命中,会在用户启用 `generationLossProtection` 时按有损来源处理。
- **结果缓存**:Tauri 层用源文件 `blake3` + 目标格式 + 编码/尺寸/metadata/目标体积设置生成 v5 cache key。v3 记录只保存已有输出的 hash/size 和尺寸、实际质量、目标状态、色彩转换/无效 ICC 丢弃状态，命中时可重建 warning；不缓存图片内容。缓存默认开启，并受 30 天、4096 条预算和受限手动清理约束。
- **平台 benchmark**:`pnpm run bench:platform` 默认用 release profile 跑隐藏入口,输出 AVIF/WebP JSON lines,并生成 `target/benchmarks/*.json` 汇总报告(样本、median、吞吐、字节数、默认参数建议),用于 Linux/macOS/Windows/arm64 复核 AVIF speed、WebP method、耗时和输出体积。`--profile=debug` 仅用于脚本烟测。旧 `bench:avif:macos` 复用同一报告层,作为 Apple Silicon AVIF 专项入口；手动 `macOS Smoke` 会上传 `imgconvert-macos-arm64-avif-benchmark` JSON artifact 并保留 14 天。
- **wall-clock 软超时**:Tauri 转换路径默认每文件 180s 预算,可用 `IMGCONVERT_CONVERT_TIMEOUT_SECONDS` 覆盖,`0/off/disabled/none` 关闭。core 的 timed API 在解码后、候选编码/评分边界检查 deadline;单个进程内 C/Rust codec 调用不做强杀,避免不安全地终止线程,但超时结果不会写盘,多候选/自动质量不会继续追加后续候选。
- **图像质量测试体系**:`pnpm run test:image-quality` 运行 core integration suite,覆盖 deterministic golden fixtures、CMYK JPEG 导入、PNG/WebP/AVIF lossless 像素逐字节一致性、JPEG/WebP/AVIF 高质量有损 PSNR/MAE 下限、动画 WebP 与损坏输入的干净拒绝、10,000 × 10,000 PNG 在分配前的像素上限拒绝、输出字节确定性和 JPEG 8×8 亮度/色度网格、WebP-like 4×4 block artifact hint。该入口只用自生成 fixture,适合 CI;真实相机 corpus/fuzz 仍是独立后续项。跨平台物理安装与商店验收见 [RELEASE_QA.md](RELEASE_QA.md)。
- **Fuzz/corpus**:`fuzz/` 为独立 cargo-fuzz crate,不进普通 workspace。`decode_pipeline` 覆盖 magic/probe/thumbnail/有界 decode,`convert_pipeline` 覆盖有界真实转换,`metadata_semantics` 覆盖 EXIF/XMP/IPTC 语义检查和规范化；`src-tauri/fuzz/` 另覆盖外部 codec manifest、授权导入扫描器和有界 PDF 文档解析。`pnpm run fuzz:prepare` 为两个 fuzz crate 生成 deterministic seeds,并从本地 `corpus/real` 或 `IMGCONVERT_REAL_CORPUS_DIRS` 导入真实 JPEG/PNG/WebP/AVIF/SVG/GIF/BMP 到 ignored corpus;真实图片和 fuzz artifacts 不入仓库。`pnpm run fuzz:replay` 不依赖 `cargo-fuzz`,会把两个 corpus 及各自 `artifacts/<target>/` crash inputs 走与 libFuzzer 相同的共享 harness,写入带 core/Tauri 分区的 `target/fuzz-corpus/replay-report.json`;`fuzz:smoke` 串起 prepare + compile + 六目标 replay。`pnpm run fuzz:minimize` 默认 dry-run 生成 `target/fuzz-corpus/minimize-report.json`;显式 `fuzz:minimize:run` 才调用 `cargo fuzz tmin` 并复跑 artifacts。
- **PDF 资源/并发边界**:PDF 正式预览/转换源文件限制 256 MiB，导入扫描的可选 metadata 探测另限每文件 16 MiB、每次扫描累计 64 MiB；超出任一预算的 PDF 仍进入队列，但把页数/尺寸延迟到预览或转换，避免批量导入被完整文档解析阻塞。页范围解析不展开超大范围；每页在调用渲染器前同时检查 `u16` 视口与 core 的 64 MP 像素预算。页面串行渲染并共享单文档缓存，批处理调度把 PDF 任务按完整 768 MiB 预算估算，因此不会与另一转换 worker 并发。取消在导入 metadata 探测前后、正式页边界及统一编码管线边界检查；wall-clock 预算按独立页面重置，避免长文档因累计耗时被误杀。单次 Hayro 页面解释与单次编码仍属于不可强杀调用。
- 未做:Windows 真实 runner benchmark 报告、真实 corpus 驱动的更多压缩噪声指纹、长期 fuzz 运行和真实 crash 样本积累。

---

### 输入动画事实与编码器边界（B2a）

- `ImageProbe.animation` 为 `Static` / `Animated` / `Unknown`。探测只记录容器事实，不因动画本身报错；尺寸头也不完整时仍可返回解码错误。PNG 读 IDAT 前的 acTL，AVIF 独立检查序列轨道的 imageCount（不依赖 major brand 选中的主图），GIF 遍历 image descriptor，WebP 读 has_animation。可用前缀不足以判断时是 Unknown，不能冒充静态。
- 解码入口拒绝 APNG、多帧 AVIF/GIF 和动画 WebP，统一使用 core `Unsupported`；PNG 使用 image 0.25.10 的 `is_apng()`，AVIF 在 NextImage 前检查帧数；未声明但存在的轨道或不完整容器保留 Unknown，完整解码仍无法确认时返回 Decode 错误。缩略图、预览、普通转换均经过这些入口，不静默丢帧。Unknown 允许进入完整解码，由完整容器再判断。
- `Format::encoder_capabilities()` 是进程内输出能力表：JPEG 65,500、WebP 16,383、AVIF 65,535、PNG 2³¹−1 的边长上限；全部仍受 64 MP 像素预算约束。PNG 支持 8/16 位输出，其余当前落盘路径为 8 位；JPEG 不含 alpha，其余支持 alpha；均不输出动画。JPEG 上限来自 mozjpeg 的 JPEG_MAX_DIMENSION，AVIF 使用已启用编码器共同可支持的边界，不宣称全容器理论上限。
- 工作流按显式尺寸规则计算最终尺寸后、生成预览/缩放/编码之前检查编码器边界；不自动缩小。直接编码器入口同样检查，覆盖自动质量和像素调用路径。Tauri 能力矩阵新增 encoders；GPUI/Tauri 共用 backend 的转换预检，在缓存读取前拒绝已知动画与输出越界。
- 结果缓存语义版本从 v5 升到 v6，避免早先 APNG/AVIF 丢帧结果被复用。测试不打开真实结果缓存。动画 DTO、队列标记及动画计数仍属于 B2b，本片不扩展导入 DTO。

## 7. 进度 / 取消(全员缺失,我们自建,直接领先)

- **桌面启动互斥**：Tauri 与 GPUI 复用 backend 导出的 `instance_lock` 协议及 `paths::instance_lock_file()`。Tauri 在创建 WebView 和注册 store 前取得独占锁，作为应用状态持有到退出（含批次 shutdown 等待）；锁占用时只显示原生提示后退出，不创建业务服务、不读取共享设置。Tauri 无法定位数据目录或取锁 IO 失败时拒绝启动，避免 store 在无锁状态写入；GPUI 的既有仅内存/错误策略不变。锁文件永久保留，进程退出或崩溃由 OS 释放锁；旧版未实现协议的 Tauri 安装件仍不能受此保护。

- **进度**:用 **Tauri Channel**(有序、低延迟、按调用作用域),非 event。批量逐文件 + 文件内进度。
  ```rust
  use tauri::ipc::Channel;
  #[derive(Clone, serde::Serialize)]
  #[serde(rename_all = "camelCase", tag = "event", content = "data")]
  enum ProgressEvent { Started { total: usize }, FileProgress { index: usize, percent: f64 }, Finished }
  ```
  可参考 Hando 的 **EventSink trait**(生产/测试两实现)做可测试抽象,但用 Channel 落地。
- **取消**:`tokio_util::sync::CancellationToken` 存入 `.manage()`,长任务 `select!` 监听;参考项目**无一实现**,这是我们的增量。
  - 普通图片与 PDF 页面都把 token 以 `is_cancelled` 钩子传入 `imgconvert_core::convert_workflow_with_control`/`convert_image_workflow_with_control`：核心在解码前后、色彩与缩放之后、每个编码候选前后、每次质量评分前后检查并返回 `Error::Cancelled`；后端以 `write_output` 之前（结果缓存命中路径则是缓存查找之前）的 token 检查为提交判定点：检查时已取消的结果不落盘，检查通过后允许完成写出与收尾。单次原生编码调用（mozjpeg/libwebp/libavif/oxipng 的一次 encode）仍不可中断，取消在它返回后的下一个检查点生效。批次 worker 对已取消 token 下的错误不发 `FileError`，因此取消项既不计失败也不计完成。
- **输出写入**：覆盖模式沿用同目录临时文件 + `fsync` + rename（Windows 先暂存旧输出，失败可回滚）。新建输出（不覆盖）同样先写同目录临时文件并 `fsync`，再经 `imgconvert_platform::atomic_output::commit_new_file` 以“不覆盖”语义一次提交：Linux `renameat2(RENAME_NOREPLACE)`、macOS `renamex_np(RENAME_EXCL)`、Windows 不带 `MOVEFILE_REPLACE_EXISTING` 且不带 `MOVEFILE_COPY_ALLOWED` 的 `MoveFileExW`。因此新建输出在提交前对外不可见，写入中断只留下 `.imgconvert-*.tmp`；提交时目标已被占用返回 `OutputExists` 并删临时文件。只有文件系统报告不支持该改名（`EINVAL`/`ENOTSUP`/`EXDEV`、`ERROR_NOT_SUPPORTED`）才退到 `hard_link` + 删临时名，硬链接的权限/目录缺失等错误仍按原义返回，删临时名失败只发 `temporaryFileRetained` 告警（可与 `modifiedTimeNotPreserved` 并存）；两种原语都不支持的文件系统返回错误并提示更换输出目录，不退回直写。
- **并发**:全局信号量限并发(默认 `(num_cpus-1).clamp(1,8)`)。⚠️ **关键(评审 #4 + Codex)**:AVIF 编码器内部多线程;文件级并发 × 内部多线程 = **oversubscribe + OOM**。走 libavif 路线时应设 **libavif encoder `maxThreads=1`**(sys 层对应 C 字段;高层 `libavif` wrapper 是 `set_max_threads`),靠文件级并行,不要两层都开。
- **P0.5 诊断**:`AVIF_ENCODER_MAX_THREADS=1` 已提升为 `imgconvert-core` 常量并写入 `avifEncoder.maxThreads`;Tauri `runtime_diagnostics()` 暴露默认并发、内存预算、RGBA 工作集倍率和 AVIF 内部线程上限。批处理估算同时纳入导入尺寸的像素工作集和实际源文件字节数，文件大小无法可靠读取时按 256 MiB 上限保守预留。单测覆盖该诊断,平台性能/线程数实测放到 P3/macOS 阶段。
- **传参传文件路径**,⚠️ 别学 tavif/compressor 把整图 base64 穿 IPC。

---

## 8. 许可证合规与上架

### 许可证(本项目为上架采用 Apache-2.0)
- ⚠️ 已采用 **Apache-2.0**(宽松 + 专利授权)。这意味着:**Hando(AGPL)、springbok 引擎(GPL/AGPL)代码不可抄**,只能同款宽松 crate 重写;**imagequant(GPL)/dssim(AGPL)必须替换**;`deny.toml` 禁止 GPL/AGPL/LGPL。详见 [LEGAL.md](LEGAL.md)。
- 用 **`cargo-about`** 生成 `THIRD_PARTY_LICENSES`,**CI 自动跑**。
- ⚠️ **应用内「开源许可」页(评审 #7,必做)**:Apache-2.0 §4(d) 要求保留 NOTICE;`mozjpeg` 的 **IJG 许可含命名条款**(不得用 IJG 名义背书),`webp`/`libavif`/`rav1e` 的 **BSD** 要求二进制分发保留版权与免责声明。商店二进制里用户拿不到仓库文件,所以必须在 App 内做一个可滚动的全文「开源致谢」页(嵌入完整 NOTICE/许可文本,非链接)。

### 发布渠道(第一期 GitHub Releases,商店后移)
| 渠道 | 打包 | 沙盒 | 签名 | 文件访问 |
|---|---|---|---|---|
| **GitHub Releases 第一期** | Linux `.deb`/`.rpm`/AppImage + updater assets | 无 | updater artifact 用 Tauri key 签名 | 自由;⚠️ webkit2gtk 动态系统依赖,各发行版版本不同 |
| **Flathub(后续)** | Flatpak | portal | — | **文件 portal**(拿到的可能是 portal 路径非真实路径,P0.5 验证) |
| **Mac App Store(后续)** | `.pkg` | **App Sandbox 必须** | Apple Distribution + provisioning | 用户选择文件读写；每次启动重新选择输出目录 |
| **Microsoft Store(后续)** | **MSIX**(Tauri 非一等)| `runFullTrust` | Partner Center | 较自由 |
| 直接分发(macOS/Win,后续)| `.dmg`/`.msi` | 无 | Developer ID + 公证 / 代码签名 | 自由 |

- ⚠️ **为商店留门(贯穿全程)**:即使第一期只发 GitHub Releases Linux 包,也要保持**主程序核心无子进程**、**文件访问抽象成「用户显式授权目录」**(Flatpak portal ↔ 未来 MAS security-scoped bookmark 同一抽象),否则后续上 Flathub/MAS 会大返工(评审 #6)。P1.5 HEIC helper 是主包外直发增强,商店构建默认禁用。
- **P0.5 文件授权边界**:`crates/imgconvert-backend/src/access.rs`（原 `src-tauri/src/access.rs`）已作为唯一授权路径 grant 入口,当前直发路径、剪贴板临时文件和输出目录都先经该层。该层刻意不要求 canonical 路径,避免破坏 Flatpak portal 映射路径;macOS 第一批在同一层保留 `CFURLStartAccessingSecurityScopedResource`/`CFURLStopAccessingSecurityScopedResource` RAII 钩子，但当前 MAS 设计不跨启动保留访问，而是每次启动重新选择输出目录。未来若实现持久化，必须由原生文件选择层提供真实 security-scoped bookmark data。
- **平台发布护栏第一批**:`pnpm run release:platform:check` 静态校验 macOS/Windows 发布元数据、平台图标、Apache-2.0 许可证和商店禁外部 helper 的 build-time 机制。实际 MAS/MS Store build 前用 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 pnpm run release:store-env:check` 强制确认构建环境已关闭外部 codec/helper 自动发现;这与 Flatpak manifest 的运行时禁用互补。
- **架构前提护栏**:`pnpm run architecture:check` 静态校验主程序 Apache-2.0、pnpm 锁文件策略、core 格式矩阵不含 HEIC、`image/libavif-sys/ssimulacra2/lcms2` 的关键 feature 边界、禁止 libvips/libheif/x265/imagequant/dssim、store/Flatpak 禁宿主外部 helper、HEIC provider read-only 和 `access.rs` 显式授权路径抽象。`release:platform:check` 与 `quality:security` 会先跑该入口。
- **macOS 打包/沙盒护栏第一批**:`src-tauri/tauri.macos.conf.json` 是 Tauri 在 macOS 上自动合并的直发配置,启用 hardened runtime 并使用 `entitlements.macos.direct.plist`(不启用 App Sandbox)。MAS candidate 先由 `pnpm run release:macos:mas:prepare` 生成配置，再用 `universal-apple-darwin` 构建 `arm64` + `x86_64` app，对应 `entitlements.macos.mas.plist`:App Sandbox + network client（仅本地 WKWebView IPC）+ user-selected read/write；不声明没有实现的 app-scoped bookmarks。`PrivacyInfo.xcprivacy` 作为 bundle resource 并由最终包校验。`pnpm run release:macos:check` 会拒绝 broad filesystem/network server/temporary exception entitlement 与未使用 bookmark entitlement;`IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 pnpm run release:macos:store:check` 是 MAS build 前置门槛。
- **macOS runtime 第一批**:`macos_system_codecs.rs` 暴露系统 ImageIO HEIC readable-only provider，并拒绝多帧输入以免悄悄丢帧；`macos_security.rs` 提供 security-scoped start/stop RAII 边界；`pnpm run bench:avif:macos` 在 Apple Silicon 上测 rav1e AVIF speed。`pnpm run release:macos:smoke` 聚合 direct/store guardrail、AVIF benchmark、可选 HEIC 样张路径转换 smoke 和可选 `.dmg` notarytool/stapler/Gatekeeper 检查；另有 `macOS Intel Smoke` 在真实 Intel runner 复核 ImageIO。每个 app 内的 Mach-O 均会检查架构、链接和签名。MAS sandbox HEIC GUI、Media Library TCC、以及重启后重新选择输出目录仍需真实安装后的交互验收；当前不支持 bookmark 持久化。
- **Windows 打包/Store 护栏第一批**:`src-tauri/tauri.windows.conf.json` 是 Tauri 在 Windows 上自动合并的直发配置,面向 `.msi`/NSIS。它显式禁止降级安装、使用 SHA-256 signing digest、silent embedded WebView2 bootstrapper、稳定 WiX `upgradeCode` 和 NSIS current-user 默认安装。`pnpm run release:windows:direct:check` 会校验这些边界;`IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 pnpm run release:windows:store:check` 只做 Store candidate preflight。
- **Windows runtime 第一批**:`pnpm run release:windows:smoke` 聚合 direct/store guardrail 与隐藏包内转换 smoke,在 Windows runner 上验证真实 JPEG/WebP/PNG/AVIF 转换链路。`.github/workflows/windows-smoke.yml` 手动 `build_direct` 可构建 unsigned `.msi`/NSIS `.exe`,检查 PE 架构；开启 `install_smoke` 后会实际安装、从中文且带空格的路径启动、转换到中文输出目录并卸载。MSIX 会校验 manifest/payload PE 架构、`makeappx validate` 和 sideload 生命周期。真实代码签名、timestamp 和 Partner Center 提交仍需 Windows 发布阶段继续推进。
- **MAS 现状(2026-08 实查)**:Tauri 2 + Svelte **可上 MAS**——App Sandbox、Entitlements.plist、provisioning、Mac Installer Distribution 证书与 `.pkg` 路线均可用，Svelte 静态资源运行在 WKWebView。Tauri desktop dialog 返回的是路径，`fileAccessMode` 只在 iOS 生效，不能当作 macOS bookmark API。当前产品选择不做跨启动 bookmark 持久化：每次启动重新选择输出目录，以 user-selected read/write entitlement 获得本进程范围；若未来需要持久化访问，必须新增真实 bookmark 创建、存储、解析、stale bookmark 处理及原生 macOS 实机测试。
- **HEVC/HEIC 专利(评审 #9)**:调用系统编解码器是**实务安全垫**(平台已付费),**非法律免责**;按平台能力如实表述,营销勿平铺「支持 HEIC」;商用前请 IP 律师出意见。

---

## 9. 关键文档 / 参考路径

- 参考实现:slimg `crates/slimg-core/src/codec/*`、`dist-workspace.toml`、`about.toml`(MIT,可直接借鉴);Hando `encoder/auto.rs`、`icc.rs`、`metadata.rs`、`docs/bench-results.md`(AGPL,重写);DropWebP `backend/src/command.rs`(系统 HEIC)。
- crate 文档:docs.rs/{mozjpeg, oxipng, webp, libavif-sys, image, fast_image_resize, ssimulacra2}
- Tauri:Channel https://v2.tauri.app/develop/calling-frontend/ · macOS 签名 https://v2.tauri.app/distribute/sign/macos/
- cargo-dist:https://opensource.axo.dev/cargo-dist/ · cargo-about:https://github.com/EmbarkStudios/cargo-about


## GPUI update compatibility contract (S8)

`imgconvert-platform::update_policy` owns the shared minimum-system gate used by
the Tauri bridge and GPUI updater. GPUI 0.4.x and later require OS-keyed numeric
`minimum_system_version`; Linux additionally requires a hardware Vulkan 1.3
device. Older 0.3.x updates remain eligible without GPUI hardware. These checks
do not read or write settings or conversion caches.

The optional GPUI app-settings updater owns its state independently of the
dialog. Blocking HTTP, signature verification and installation run outside the
UI thread. The shell only composes the entry point. The direct Linux AppImage
path downloads a bounded signed raw artifact, checks its architecture, then
flushes settings and atomically installs only when no conversion is active.
Failures preserve the old file until the replacement is committed. Production
endpoints and release authorization are outside this internal preview slice.
See `docs/UPDATER.md` for configuration and SDK smoke scope.


## GPUI 剪贴板导入（S9）

- 队列的粘贴按钮、编辑菜单和 Ctrl/Command+V 进入同一 owner。复用 Kit 的标准 `input::Paste`，设置输入框消费文本粘贴；模态对话框不把粘贴路由到背后的队列。
- `platform::clipboard` 是可选系统能力，backend 转发该 feature；Tauri 默认依赖图不启用它。原生读取使用 arboard 3.7.0（MIT/Apache）独立连接，始终在后台执行，按文件列表、位图、文本顺序查询。不会使用锁定版 GPUI 同步的桌面 clipboard read，也不依赖其 macOS/Wayland 的文字优先协商。Wayland 需要 data-control 协议或 XWayland 剪贴板桥；两者都没有时提示无法读取，可改用文件选择器，不静默阻塞界面。
- 原生位图按 RGBA8 导入，OS/库完成像素采集后，应用在复制/编码前复用 core 的 64 MP 尺寸和长度验证，再编码成 PNG；不承诺保留复制来源文件的 ICC/EXIF 或动画。剪贴板库自身的格式解码和传输分配不受应用的像素预检控制。Kit 测试平台则提供编码图片 fixture，仍经 backend 的真实格式探测与 128 MiB 编码文件上限。
- 完整原生路径优先；不能表示为 UTF-8 的路径明确计数，不以预览位图替代。文本按行接受本机绝对路径和 `file:` URL，忽略 URI 注释及 copy/cut 头；普通路径保留合法尾部空白，URL 解码与授权仍只在 backend access 层完成。目录扫描继续使用共享的递归、条目、文件数与深度预算；部分成功和截断有可见反馈。
- 位图复用 backend 的受管临时目录、标记文件和 session lock。注册保留到退出，清空队列时后台清理；普通用户文件从不因队列清空而删除。一次读取/导入的取消注册保留到主线程最终入队，停止在提交前再次检查。取消只回收本次新建的位图，扫描已有受管图片路径不获得删除所有权。原生库读取不能强行中断，取消在返回后的提交点生效；单个导入未结束前拒绝重复粘贴/选择/拖放。启动时按已有锁协议后台清理过期且不活跃的剪贴板会话。

- 两个 workspace 对 arboard 统一使用 `vendor/arboard` 的窄补丁：3.7.0 上游已修 CRLF；本地保留百分号解码后的非 UTF-8 原生文件名字节，使队列能报告不支持的路径，并将 Windows 的“文件列表存在但读取失败”与“没有文件列表格式”区分，避免偷偷导入预览。来源、完整许可、改动和回归命令见 `vendor/arboard/IMGCONVERT_PATCHES.md`。


## GPUI 逐项目标格式（S10）

- 队列项目以仅会话的 `target_format` 覆盖全局工作流格式；默认与“跟随全局格式”使用全局值，明确覆盖不会随全局格式或预设变化。候选值只取 backend 能力矩阵的 writable，禁止把 HEIC/PDF 等只读格式作为输出。改格式或重置格式会把受影响的结果恢复为待转换；清空重导后没有覆盖。
- 行内使用 Kit 标准菜单，支持选中态、键盘导航和 Escape；稳定项目 key 绑定触发器，不为整个虚拟队列预分配 Select 实体。工具栏与项目采用两行布局，为最小窗口保留文件名、格式与状态空间。批次执行、桥接收尾或导入期间禁用编辑，菜单提交再次核查。
- 批次、预览与输出路径预检共用 `options_for_item`：逐项覆盖优先于全局（含探针的全局格式参数），质量下限、无损能力与目标体积校验都按实际输出格式。全局不支持目标体积但全部覆盖为 JPEG/WebP 时可启用；任一实际输出不支持时阻止 Start 并显示配置错误。
- 转换请求代次独立于缩略图代次：格式编辑使旧预检失效，但不拒收在途缩略图。后台预检完成时须匹配原请求身份，成功与失败都不能覆盖后来的请求。预览监听该项目覆盖变化，标记现有/生成中的结果过期，显式刷新后采用新格式。


## GPUI 隐私与许可（S11 + L6）

app-settings 拥有隐私和开源许可对话框。隐私直接编译嵌入中英文政策，许可直接嵌入 GPUI workspace 生成全文；打开对话框不联网、不读取用户文件或修改缓存。只读多行控件保留选择、复制、滚动；界面语言变化会刷新当前隐私副本。支持链接仅在用户点击后交给默认浏览器。

`license:gpui` 以独立 GPUI 锁文件和共享许可策略生成 all-target/all-feature 清单，并与 Cargo 实际依赖树核对覆盖；除 cargo-about 的许可全文外，还保留原生/资源 NOTICE、版权和专利文本。`license:gpui:verify` 纳入 CI，生成物变化必须提交。来源与范围见 `GPUI_LICENSE_AUDIT.md`；这不是三平台安装件或最终发布包的合规验收。


## GPUI 功能核对（S12 + R10）

GPUI 对照 Tauri 生产状态机的 17 个命令完成入口核对，证据及原生验收边界见 `GPUI_FEATURE_PARITY.md`。本片补齐结构化错误的中英翻译、缺失参数兜底、扫描错误/上限反馈、来源格式标识和逐项移除。Stop 的注册保留到前台提交，取消不追加部分发现；移除只清理本进程注册的临时图片，维护缩略图预算和过期 ticket。backend 提供独立的额外保护来源入口，计划及服务 gate 内执行预检都保护整个队列的文件身份（含完成项及硬链接别名），既有 API 保留。下一批仅提交未完成项目，保留已完成项的状态和环境测量；重置/改逐项格式可显式重新转换。macOS 保存的输出路径必须在当前会话重新选择授权。插值只处理模板中的 `%{name}`，用户参数不被二次替换；全部应用键检查双语与参数集合，修正 YAML 未加引号的 `Off`。这些入口和无头测试不替代 G2/R11 的原生沙盒、IME 与辅助功能验收。

## 动画事实与精度告警（B2b）

导入元数据通过 `ImportAnimation::{Static, Animated, Unknown}` 传出 core 的动画事实，core 探测类型继续不依赖 serde。PDF 标为静态文档，探测失败/预算不足按未知处理；GPUI 行标记和待转换计数区分“动画（暂不支持）”与“状态未确认”。未知输入仍进入完整解码确认，已知动画继续由共享 backend 在缓存/解码前拒绝。

Workflow 新增 `BitDepthReduced { from, to }` 与 `AlphaFlattened`，通过原有 backend 告警通道传给两壳。JPEG/WebP/AVIF 的 8-bit 输出与 PNG 量化降位深按选中的实际输出记录；保留 16-bit 的 PNG 不报降位深，未获选的量化候选不决定告警。AVIF 解码器在 RGBA8 化时保留原始 10/12-bit 降位深记录，颜色转换、缩放与 PNG 输出不会丢掉这个记录。透明合成仅在 JPEG 实际待编码像素含非不透明 alpha 时产生，包含 16-bit alpha 不能先量化成 8-bit 再作判定。告警描述表示精度通道的降低，不是对视觉损失或减排的估计。

GPUI 成功项目保留告警并提供完整 tooltip/辅助文本，语言切换重译；Tauri 同步双语 formatter，并对未来未知 code 显示通用告警。结果缓存键升级 v7，纳入动画事实与新告警语义；记录升级 v4，保存位深/透明告警，缓存命中与首次执行保持同样的告警顺序。旧记录安全视为 miss，不做用户缓存迁移或清除。

## Security scope 状态与 G2 原生验收

`ScopedResource::started()` 在 macOS 返回底层 `CFURLStartAccessingSecurityScopedResource` 的实际结果，URL 分配成功本身不表示 session 已启动。该状态不作为文件 I/O 权限 gate：PowerBox 的进程内选择器授权与 security-scoped bookmark session 是不同机制，direct 运行也可能不需要 scope。仅成功 start 的 session 在 Drop 时 stop，所有已创建 URL 仍释放。原生回归覆盖已创建但未调用 start 的 CFURL、独立临时夹具上的实际 start 返回值及空路径；不假定各 macOS 版本对普通文件 URL 返回相同结果；macOS Smoke 显式运行该回归。

设置分组按钮显式提供双语名称和 toggled 状态。Kit 0.7.1 的 Slider 没有名称 API，因此既有键盘包装承担原生 Slider 角色、范围、数值及增减动作，隐藏内部重复的无名称辅助节点，鼠标仍由 Kit Slider 处理。原生动作与键盘共用步进入口，最低质量在 Off 与 30–100 的有效值之间变化，忙碌期间仍拒绝修改。共享 ChoiceItem 通过 Kit 的 render 扩展提供可读文本节点，保留框架的选择、点击和键盘行为。

G2/R11 的原生朗读、IME 与签名沙盒授权执行步骤和证据要求见 `GPUI_G2_ACCEPTANCE.md`。无头测试与 Tauri Smoke 不替代 GPUI 实际候选验收；缺少证据时门槛保持未关闭。

`scripts/record-gpui-macos-voiceover.applescript` 仅收集真实 VO 光标文本、最后朗读与屏幕矩形，要求候选主窗口聚焦、字幕面板开启并拒绝选择器及窗口外 VO 光标。输出不构成通过结论；容器末尾重复、提示替换朗读和模态交互仍需连续字幕视频及实际状态变化核对，不能以 AX 标签或固定等待替代。

按用户确认的文案规则（2026-10-19），顶部信息入口显示“插件诊断 / 隐私 / 关于”（英文 Plugin diagnostics / Privacy / About），不加省略号；这是对 Kit 弹窗入口默认标点规则的产品例外。添加文件、选择输出目录等仍需后续选择的命令保留省略号。

GPUI shared 的构建脚本显式追踪 `locales` 目录：本地化宏读取 YAML 本身不会让普通增量构建感知文件变化，目录内容变化必须重新生成嵌入翻译，避免源码已改但运行程序仍显示旧文案。

## GPUI 卡片分栏

按 2026-10-19 用户参考图重排主窗口，详见 `GPUI_CARD_LAYOUT.md`。左栏为原工作区的区域快捷入口，转换定位格式选择器（包括质量禁用的 PNG），设置展开并聚焦外观，队列恢复根焦点；导航不创建或改变批次。右侧预设选择移到顶部，管理控件保留在原分组，Select 不重复挂载。中部空队列集中展示文件、目录和粘贴入口；目录选择仅允许目录，扫描及取消复用原流程。格式信息在后台读取并按 helper 配置变化刷新，过期结果不覆盖新配置。

2026-10-22 用户选定“清透玻璃 2.0”取代卡片分栏，详见 `GPUI_GLASS_LAYOUT.md`：删除区域导航栏与操作栏设置齿轮（两块面板始终可见），标题行胶囊承载窗口级命令与“外观”，操作栏改为队列面板底部的悬浮胶囊；行为、批次与设置模型不变。

底栏改为正常布局中的固定区域，内容、列表末尾和设置区均止于其上方，不再用悬浮遮挡补偿；输出安全、会话授权、开始/取消及状态模型不变。导入说明、格式标签、设置标题和底栏状态提供原生辅助文本。窄窗口收起导航文字但保留名称和提示，沿用主题 token 并验证明暗/中英。G2 门槛仍按原生验收清单执行。


### GPUI 队列原生辅助语义（G2 后续）

队列行是以文件名命名的原生 Group，文件名、来源/尺寸/动画事实、扫描反馈与非运行状态使用可读 Label；运行状态 Group 保留带文件名的 ProgressIndicator。完成状态同时提供完成、输入/输出尺寸与全部本地化告警，失败/跳过同时提供状态和共享错误 formatter 的用户文案，不暴露后端 detail。对比与存储情景操作的无障碍名称包含文件名。所有语义从同一队列快照在渲染时派生，切换语言同步更新；不新增逐行 retained 实体或 Tab 停靠点。静态文本只提供 value，不把相同内容重复设为 label/title，避免 VoiceOver 连读两遍；同样修正 Choice 选项、空队列说明/格式标识和底栏状态。

批次总进度条另有“批量转换进度”/“Batch conversion progress”名称，数值继续由同一 BatchModel 的已结束任务比例派生。100% 表示批次任务已结束，成功/跳过/失败仍由相邻状态文本说明。`scripts/check-gpui-macos-progress.applescript` 在原生主窗口核对进度条名称和数值，可用于运行及完成状态；它只读辅助树，不替代 VoiceOver 朗读或连续录屏。

G2 原生 IME 检查使用 `check-gpui-macos-ime.applescript` 区分精确字段文本及系统候选列表，连续记录核对确认、翻页、取消和布局变化。候选框覆盖对话框的问题已由只含 Kit 的 `g2_ime_repro` 例程复现；当前开发构建已接入下述版本锁定的框架修复，业务输入与持久化契约不变。现象、证据和未采纳实验分别见 `GPUI_G2_ACCEPTANCE.md`、`GPUI_IME_REPRO.md`、`GPUI_PATCHES.md`。

IME 焦点清理差分及来源核验工具保存在 `patches/gpui-ime-focus`；正常 GPUI workspace 通过 `[patch.crates-io]` 使用两个保留完整许可的本地运行时源码包 `gpui-pre` / `gpui-pre-macos` 0.3.8。Kit 五包保持 0.7.1，其余依赖版本不变；无需额外 Cargo 配置。候选在绘制后按实际 handler 的焦点/实体身份结束旧 client 的组合，再清理该窗口原生上下文；不把 Kit 行为补到业务表单。独立 Kit 测试工程通过既有 test-support 层的窄观察接口覆盖输入状态、缓存、焦点和补帧，仍须单独取得系统候选框原生证据。上游最小复现已获授权提交为 longbridge/gpui-kit#3605；上下文重置候选已通过指定原生 AX/CG 及独立窗口输入对照，正式接入保留 116 个必要源码、构建资源、manifest 与许可文件，来源核验按原始发布归档加差分逐字节复现，CI 检查实际选中的来源与版本。已发布的 Tauri 线不受影响；默认 GPUI 开发构建使用此修复，完整 G2 仍待剩余原生矩阵。

后缀草稿清空后若进入未确认的 IME 组合，失焦仍按既有策略恢复已保存后缀；现在同时清除旧空草稿留下的 Required 提示。真正空草稿的默认值回退及提示、非法路径字符的归一化及 Adjusted 提示保持原行为。后缀反馈用原生 Label 暴露当前双语文字，不改变表单布局；组件回归分别核对未提交组合、普通空值回退及一次粘贴的归一化。


## GPUI 模态语义焦点（已接入）

文档只读控件把辅助角色绑定到实际编辑焦点，并复用 Kit Root 的 Tab/Shift-Tab 焦点约束；弹窗外的工作区辅助子树在模态存在期间隐藏。共享焦点的底层排序问题已由原始失败、接入后通过的回归固定：同一 `FocusId` 的旧排序项在再次注册时删除，避免反向 Tab 卡在同一 handle。上游报告为 longbridge/gpui-kit#3612，复现与差分见 `GPUI_TAB_STOP_REPRO.md`，补丁来源与校验见 `patches/gpui-ime-focus`。这些是无头交互结果，不替代原生键盘/VoiceOver 验收；当前证据和剩余工作见 `GPUI_G2_ACCEPTANCE.md`。
