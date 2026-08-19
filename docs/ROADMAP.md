# 开发路线图

> 📍 **当前进度(2026-07-05)**:P0.5 引擎尖刺已通(`imgconvert-core` 跑通 JPEG/PNG/WebP/AVIF,测试全绿)→ **P0「前端整顿」三项已落地**(组件化架构 + core 能力契约 + shadcn 控件/格式选择器)→ **P0.5 批量进度/取消协议、许可闭环、原生工具链预检、文件访问授权边界与并发诊断已落地** → **P1 文件导入层、并发批量、导入元数据 ping、异步缩略图、ask 覆盖批量协议、文件可靠性与剪贴板导入最小闭环已落地** → **P1.5 Linux/Windows 外部 HEIC 可选导入闭环已落地**(manifest 协议、系统/插件 helper、用户显式 helper 白名单、插件诊断 UI、渠道禁用边界) → **P2 高级压缩与保真功能项已落地**(per-format 参数、skip-if-larger、多候选、质量下限、ICC/EXIF/XMP、自动质量、代际防护、结果缓存、实验性 PNG 限色、高级参数 UI) → **P3 Linux 发布闭环与本机 RC 实测已落地**(release workflow、stale artifact 防护、包元数据校验、AppImage scrub、发行版 Docker smoke matrix、checksums、Flatpak build/install/runtime conversion smoke) → **后续平台发布护栏已落地**(macOS/Windows metadata + store external-helper build-time guardrail + macOS direct/MAS entitlements + Windows direct installer guardrail) → **macOS/Windows 发布闭环 repo 侧已落地**(系统 HEIC read-only provider、scoped/persisted scope、直发/MAS/MSIX 留门、签名/安装 smoke 脚本) → **图像管线后续增强已推进到第八批**(色彩管线、metadata、AVIF lossless、质量测试、Fuzz/corpus + replay/minimize、质量 heuristics 第三批) → **GitHub Actions 公共仓库免费标准 runner 策略与发布剩余项 readiness 已落地**(CI push/PR 自动、`v*` tag 自动 Linux amd64+arm64 release、macOS/Windows/updater 手动触发且无付费确认、`ci:cost:check`、`release:readiness`、README 状态同步检查)。详见 [DEVLOG.md](DEVLOG.md)。

> 原则:**UI/UX 优先**——先把界面与交互做出来「看得见」,再逐步接真实功能与高级压缩。
> 参考依据见 [REFERENCES.md](REFERENCES.md),引擎/打包设计见 [ENGINE.md](ENGINE.md)。

> ⚠️ **架构决策(2026-06-29 转向「混合架构」;2026-06-29 二轮:三方评审 + 用户拍板后修订)**:
> - **引擎**:放弃 libvips CLI,改为**进程内宽松许可 Rust 编解码 crate**——JPEG `mozjpeg`、PNG `oxipng`、WebP `webp`(libwebp)、**AVIF `libavif-sys`(rav1e 有损 + aom 无损,采 DropWebP 路线)**、解码/容器 `image`。C 编解码器构建期静态链接。**主程序不内置 HEIC**;macOS/Windows 可走系统原生,另预留独立进程 HEIC 插件/helper(单独 LGPL 分发,decode-only)。
> - **平台优先级(已改)**:**Linux 优先**。第一期只在 **GitHub Releases** 发布 `.deb/.rpm/AppImage` 与 updater 资产;Flathub、macOS、Windows 商店均后移。**但架构必须为商店留门**:主程序核心无子进程、纯宽松许可、文件访问抽象成「用户显式授权目录」(兼容 macOS security-scoped bookmark / Flatpak portal)。可选 HEIC helper 属主包外直发增强,商店构建默认禁用。
> - **许可证**:**Apache-2.0**(已从 AGPL 切换完毕);`deny.toml` 禁止 GPL/AGPL/LGPL;`imagequant`(GPL)→ `color_quant`,`dssim`(AGPL)→ `ssimulacra2`。
> - **格式(v1)**:JPEG/PNG/WebP/AVIF(全平台 crate);HEIC 主包不内置,可选插件作为后续增强;TIFF/JXL 推后。
> - **三方评审已纳入的修正**:见文末「评审修正清单」。

## 阶段总览

| 阶段 | 主题 | 目标 |
|---|---|---|
| **P0** | UI/UX 外壳 | 界面、交互、设计系统全部可见可点(后端可先用 mock 或最小 core) |
| **P0.5** | 技术尖刺(并行) | core crate / C 工具链 / AVIF 后端 / 许可清单 / **文件访问抽象(为商店留门)**,避免返工 |
| **P1** | 拖拽 + 批量 + 真实转换 | 拖拽、并发批量(rav1e `threads=1` 防 oversubscribe)、进度(Channel)、取消 |
| **P1.5** | 可选 codec 插件 | HEIC 外部 helper 协议、系统依赖探测、decode-only 插件 |
| **P2** | 高级压缩与保真 | 自动质量(**仅 JPEG/WebP**)、ICC/EXIF/XMP 透传、代际防护 |
| **P3** | 发布(Linux 优先) | 第一期 **GitHub Releases `.deb/.rpm/AppImage` + updater**;Flathub、macOS(直分发→MAS)、Windows(→MS Store)后续阶段 |

---

## P0 — UI/UX 外壳(先做,先看)

目标:不接(或假接)后端也能完整演示界面与交互。

> ✅ **脚手架已就位**:Svelte 5 + pnpm/Node LTS + shadcn-svelte(Tailwind v4)+ phosphor-svelte(duotone),`src/App.svelte` 已是一个能拖拽/选文件/调参数/调 `convert_image` 的可运行界面。P0 在此基础上完善设计与交互。

> ✅ **2026-06-30 审计后的 P0 第一优先级已完成(详见 [DEVLOG.md](./DEVLOG.md))。** 原先「没接完的重构 + 旧 libvips 引擎契约」已收口为以下三项:

#### 🔧 前端整顿(P0 优先,三项一起)
- [x] **① 合并到组件化架构**:以 `src/lib/state.svelte.ts` + `Topbar`/`Dropzone`/`SettingsBar`/`QueueItem` 为基准,写真正组装它们的 `App.svelte`,删除老 `App.svelte` 的内联重复逻辑(两套并存会漂移)。
- [x] **② 引擎契约换新架构**:`src-tauri` 删除 `vips` 子进程逻辑,以 path 依赖接入 `imgconvert-core`;`engine_info`→`capabilities()`(可读/可写/无损格式矩阵,Linux 无 HEIC);`convert_image` 走 core 的 `convert(bytes, Format, EncodeOptions)`;前端「引擎状态」文案 + 类型随之更新(目标契约见 DEVLOG)。
- [x] **③ 控件升级 shadcn + 格式选择器**:原生 `<select>/<range>/<checkbox>` 换成 `ui/select`(做成可搜索分类的格式选择器,复刻 vert FormatDropdown 交互,**不抄 AGPL 源码**)/`ui/slider`/`ui/switch`;格式列表由 `capabilities().writable` 驱动,别硬编码。

### 设计系统(基座已有,借鉴 vert 完善)
- [x] 设计 token(`src/app.css`,shadcn-svelte slate 主题,oklch)+ light/dark 变量
- [x] 主题手动切换(`.dark` class 切换)+ 持久化
- [x] 自定义弹性 easing 过渡 + **「关闭动效」开关**(`prefers-reduced-motion`)
- [x] 按文件类型染色体系(图片蓝为主,预留音视频/文档色)
- [x] 图标统一 phosphor duotone(`IconContext`)

### 主界面布局
- [x] 顶栏(标题 + 引擎状态 + 设置入口)
- [x] **拖拽区 + 全屏拖拽彩色模糊覆盖反馈**(拖入时整窗高亮)
- [x] **队列卡片网格**:每文件卡片(缩略图占位 / 文件名 / 进度条 / 单文件格式选择 / 状态徽章 / 移除)
- [x] 顶部工具条:全部转换 / 清空 / 统一设格式 / 选输出目录
- [x] 空状态、批量计数、整体进度条(文件多时出现)

### 格式选择器(复刻 vert 的 FormatDropdown,**最值得做的单点**)
- [x] 搜索 + 分类标签 + 网格布局
- [x] 输入即搜、回车选第一个、源格式/已选高亮
- [x] 桌面下拉浮层(防溢出)/ 窄屏底部抽屉

### 设置面板
- [x] 质量滑块 + 无损开关(随格式启用/禁用)
- [x] 输出目录 / 同目录、覆盖策略(Ask/Overwrite/Skip)
- [x] 文件名模板(`%name%`/`%date%`/`%extension%`)
- [x] 保留/剥离元数据开关
- [x] 设置持久化(Tauri store)

### 交付物
- 一个能拖入文件、看到卡片队列、调参数、点「转换」(此时可调用现有 `convert_image` 或 mock)的完整界面。

> 框架已定:**Svelte 5**(脚手架已就位)。⚠️ 项目为 Apache-2.0,**不可直接搬 vert(AGPL)源码**;FormatDropdown / 全屏拖拽 / 设计 token 只借鉴其交互/视觉思路,用 shadcn-svelte 自行实现;可直接复用的是 DropWebP(MIT)的前端逻辑。

---

## P0.5 — 技术尖刺(与 P0 并行,降风险)

> 高风险点:core crate / AVIF 后端构建 / 文件访问抽象(决定 P1 设计,且关系到日后商店沙盒)/ 许可合规。先各做最小验证。
>
> 🚦 **强制门槛**:进入 P3 打包前必须通过——① 干净 Linux(Debian/Ubuntu/Fedora)上转换跑通;② 依赖树**不含 GPL/AGPL/LGPL**(无 imagequant/dssim/x265);③ `THIRD_PARTY_LICENSES` 可自动生成 + **应用内「开源许可」页**可见;④ 文件访问只走「用户显式授权目录」抽象(为 Flatpak portal / 未来 MAS bookmark 留门)。

- [x] **core crate 尖刺**(2026-06):建 `crates/imgconvert-core`,`Codec` trait + `ImageData`(RGBA8,8-bit SDR,带不变量校验)+ pipeline,接 `mozjpeg`/`oxipng`/`webp`/`image`,跑通 JPEG/PNG/WebP 一轮转换 + 跨格式转换;`image` 已 `default-features=false`(避免带回 AVIF/ravif/rayon/nasm);JPEG 编码 `catch_unwind` 截 Rust panic、alpha 合成白底;WebP 解码 `BitstreamFeatures` 预检拒动图/超尺寸。aarch64 Linux 编译 + clippy(`-D warnings`)+ fmt + 10 测试全过。P2 已用 `webp::WebPConfig`/`encode_advanced()` 接入 method;near_lossless/sharp_yuv 仍留到后续高级参数面板再评估是否需要更底层 binding。
- [x] **AVIF 后端尖刺**(2026-06):`libavif-sys 0.17`(`codec-rav1e` 有损编码 + `codec-dav1d` 解码,`default-features=false`)接入 core,`AvifCodec` 实现编解码 + magic 检测(`ftyp`/avif·avis)。后续为 AVIF 真无损补充 `codec-aom`,lossless 时选择 AOM,lossy 仍走 rav1e。验证:**alpha 往返**(YUV444 + RGBA)、**ICC 逐字节往返**(`avif_preserves_icc` 测试,证实弃用裸 ravif 的主因已解决,评审 #8)、**convert 管线 PNG↔AVIF**。FFI 用 RAII guard(`ImageGuard`/`EncoderGuard`/`DecoderGuard`/`RwDataGuard`)保证各返回路径释放 C 资源。⚠️ 待办:**N3** `maxThreads=1` 已设但尚未用多核工具证明压住编码器内部线程;speed=8 默认值已由 Apple Silicon 实测确认。
- [x] **C 工具链尖刺**:新增 `pnpm run toolchain:check`,检查 cmake / meson / ninja,并在 x86/x86_64 检查 NASM;当前 Linux arm64 本机通过。三发行版/双架构 release matrix 仍放 P3 CI,但本地和 CI 已有明确失败诊断。
- [x] **文件访问抽象尖刺(新增,前移)**:新增 `src-tauri/src/access.rs` 授权路径边界,导入扫描、输出目录和剪贴板临时文件都先收口为 grant;不依赖 canonical 路径,为 Flatpak portal 映射路径和 macOS security-scoped bookmark shim 留接口。Flatpak 包内 runtime conversion smoke 已在 P3 落地;交互式文件 portal 选择/授权流仍作为人工发布验收项。
- [x] **并发尖刺**:文件级 worker 上限 + 内存预算降并发已落地;`AVIF_ENCODER_MAX_THREADS=1` 作为 core 常量写入 libavif encoder,并通过 `runtime_diagnostics()` 暴露默认并发、内存预算和 AVIF 内部线程上限。Apple Silicon rav1e speed 已实测并保持默认 8;内部线程上限本身仍需独立的多核线程观测。
- [x] **许可清单尖刺**:`cargo-about` 生成 `THIRD_PARTY_LICENSES`;**做应用内「开源许可」页**(全文,含 IJG/BSD/Apache NOTICE);`cargo deny` 禁 GPL/AGPL/LGPL。npm 侧读取已安装包的 LICENSE/NOTICE/COPYING 文件并纳入生成物;少量缺失文件的 npm 包在生成物中标记,发布前人工复核。
- [x] **进度/取消协议**:Tauri **Channel** + `CancellationToken` 最小闭环。当前 `convert_batch` 串行执行,取消在文件边界生效;P1 再接文件级并发/信号量/内存预算。
- [x] **最小 CI**:`cargo fmt --check`、`cargo clippy`、`cargo test`、`cargo deny check`、`pnpm run check`、`pnpm run build`。已新增 `.github/workflows/ci.yml`,并补 `quality:frontend` / `quality:rust` / `quality:security` / Playwright Web preview E2E。
- [x] **(macOS 阶段第一批)系统 HEIC 导入尖刺**:新增 `macos_system_codecs.rs`,macOS 下通过系统 `ImageIO.framework` 解码 HEIC/HEIF 为 PNG 字节再进入 core 管线;能力矩阵以 `system-imageio` provider 暴露 readable-only HEIC,不链接 libheif/x265,不声明 HEIC 输出。
- [x] **(macOS runner 验收)ImageIO HEIC smoke**:GitHub-hosted `macos-15` 默认用隐藏转换入口生成 PNG fixture,再用 `sips` 生成 HEIC,通过 ImageIO provider 跑完整路径转换 smoke。MAS sandbox GUI 交互仍需 Apple 账号/签名后的人工验收;HEIC 编码输出暂不启用,若未来要做必须单独审计 HEVC 编码专利/沙盒行为/产品文案。
- [x] **HEIC 外部插件协议尖刺(P1.5 候选)**:主程序只做 manifest 发现 + 独立进程调用 + 能力矩阵合并;Linux 插件优先检测系统 `heif-convert`/`heif-dec`,Windows 插件可单独打包 decode-only `imgconvert-heic-helper.exe`。主程序依赖树继续禁 GPL/AGPL/LGPL;插件单独 LGPL 分发,第一版只读 HEIC/HEIF,不写 HEIC。Linux/Windows 外部 helper 协议、manifest 与诊断 UI 已落地;Windows WIC 系统路线已在 Windows 发布阶段以 read-only provider 落地。
- [x] **(macOS 阶段第一批)rav1e arm64 benchmark harness**:新增 `IMGCONVERT_AVIF_BENCHMARK=1` 隐藏入口与 `pnpm run bench:avif:macos`,默认测 1024×768、speed 8/10、3 轮,输出 JSON lines;benchmark 有尺寸/像素预算,避免误设环境变量导致大内存 smoke。
- [x] **(macOS 实机验收)rav1e arm64 实测**(2026-08-19):[macOS Smoke run 32225662409](https://github.com/web-casa/ImgConvert/actions/runs/32225662409) 在免费公开 `macos-15` 的 `arm64` runner 上，用 release profile 跑 `1024×768`、quality 82、speed 8/10 各 3 次；artifact 记录 host 为 `darwin/arm64`、3 CPU、约 7 GiB 内存。lossy rav1e (`maxThreads=1`) 的中位数为 speed 8 **791.185 ms / 34,477 B**，speed 10 **286.359 ms / 67,290 B**。speed 8 虽慢 **2.763×**，但文件小 **48.76%**；远超「省不到 2% 且慢过 1.4× 才改 10」的切换条件，因此保持 `EncodeOptions::default().avif_speed = 8`，不引入 macOS 特例或更换 codec。ImageIO/svt-av1 是不同编码器选择，不是这一 rav1e speed 决策所必需的对照。该 workflow 已上传 14 天保留的 `imgconvert-macos-arm64-avif-benchmark` JSON artifact。
- [x] **(macOS 阶段第一批)security-scoped resource start/stop 钩子**:新增 `macos_security.rs`,用 `CFURLStartAccessingSecurityScopedResource` / `CFURLStopAccessingSecurityScopedResource` 做 RAII;导入扫描和转换读写路径已接入 `access::scoped_path_access()`。
- [x] **(macOS 阶段第一批)runtime smoke 聚合入口**:新增 `pnpm run release:macos:smoke`,可在 macOS 真机上串起 release guardrail、AVIF benchmark、可选 HEIC 样张路径转换 smoke、可选 direct build 和 `.dmg` notarization/staple/Gatekeeper 检查;Linux 上可用 `--allow-non-macos --skip-benchmark --skip-heic` 做脚本预检。
- [x] **(macOS 阶段)security-scoped 授权持久化 repo 侧闭环**:前端 Tauri dialog 在 macOS 使用 `fileAccessMode: "scoped"`,后端注册 `tauri-plugin-fs` + `tauri-plugin-persisted-scope`,capability 仅给 `fs:scope` 用于持久化 dialog 授权;导入/转换路径继续用 `macos_security.rs` RAII start/stop 生命周期。真实 MAS GUI prompt/重启后授权恢复仍需签名包实机验收。

## P1 — 拖拽 + 批量 + 真实转换

- [x] Tauri `tauri://drag-drop` 原生拖拽(拿绝对路径,改写自 DropWebP MIT)
- [x] 剪贴板粘贴导入
- [x] 递归目录扫描 + 扩展名过滤 + 去重 + 扫描上限/取消(改写自 DropWebP)
- [x] **Rust 端并发批量最小闭环**(全局任务队列 + worker 上限)——已替换 skip/overwrite 路径的串行批量。
  - 外层全局并发上限(默认 `(available_parallelism-1).clamp(1,8)`)+ 用户可调并发已落地;大图场景按导入尺寸提示做内存预算降并发。
  - 进程内无子进程,不存在 vips「多进程×多线程」过度并发问题,但 `libavif`(rav1e)/`oxipng` 本身吃内存且内部多线程(设 maxThreads=1),仍需控流。
- [x] **进度/取消统一走 Tauri Channel**(有序、低延迟、按调用作用域;`{index, percent, stage, status}`)。取消 = `CancellationToken`(见 ENGINE.md §7)。ask 覆盖策略已通过 `plan_conversions` 前置确认,实际转换统一走 batch Channel。
- [x] 批处理三态(成功/跳过/错误)+ 单张失败不中断 + 末尾汇总
- [x] **格式选择器由 core 支持矩阵驱动**(core 暴露可读/可写格式),别硬编码
- [x] 导入 ping 尺寸/DPI(当前尺寸 + PNG `pHYs`/JPEG JFIF + JPEG/WebP/AVIF EXIF Resolution DPI;失败不阻断导入)
- [x] 异步生成缩略图(视口懒加载 + 并发 2 + Blob URL 生命周期清理)
- [x] **原子写 + 保留时间戳 + 保留目录结构**(原子临时文件写入已落地;目录导入保留相对目录;输出 best-effort 保留源 mtime;写失败会提示并清理半成品)
- [x] HEIC:⚠️ **主程序 v1 不内置 HEIC**;Linux 通过 P1.5 外部 helper/plugin 完成 decode-only 可选导入闭环。macOS/Windows 系统原生 HEIC 是**后续平台阶段**任务,不作为 P1 阻塞项(见 ENGINE.md §3 / LEGAL.md)。
- [x] **文件可靠性最小闭环**:失败清理半成品;同名冲突策略;**EXIF orientation 真旋正**;超大图内存预算/降并发;符号链接/权限错误友好处理;传参**传路径不传字节**。
- [x] **ICC/EXIF/XMP 元数据保真**:完整透传或容器级显式剥离审计(见 ENGINE.md §5),放入 P2 保真阶段。

---

## P1.5 — 可选 Codec 插件(HEIC decode-only)

目标:在不污染 Apache-2.0 主依赖树的前提下,让用户显式安装后启用 HEIC/HEIF 导入。

- [x] **插件协议(v1 manifest 最小闭环)**:已定义并实现 manifest(`id/protocol/license/readable/writable/mode/decode`)、能力发现、版本兼容、错误码前缀;主程序把插件能力合并到 `capabilities().codecProviders` 并标记为 optional/provider。
- [x] **插件诊断 UI**:新增 `codec_diagnostics()` 与顶栏诊断弹层,显示 active provider、手动 helper、manifest 搜索目录/拒绝原因、系统 helper 探测结果;弹层每次打开刷新,顶栏能力文案在窄屏截断。
- [x] **独立进程 helper 调用**:当前已禁止 `dlopen` 到主进程,通过 argv + 受控临时 PNG 文件调用外部 helper,不走 shell;已做 helper 超时、HEIF/HEIC magic 校验、Unix 私有临时目录、stderr/输出文件大小上限。
- [x] **用户显式 helper 白名单**:诊断 UI 可选择/清除本机 helper;后端保存 canonical 可执行文件路径并在每次使用前校验,失效路径显示为不可用但不会执行。发现优先级为手动 helper → manifest provider → 系统 PATH helper。
- [x] **Linux helper(系统 PATH 探测最小闭环)**:当前优先调用系统 `heif-convert`/`heif-dec`;Debian/Ubuntu 提示安装 `libheif-examples`,Fedora 提示可能需要 RPM Fusion `libheif-freeworld`;`heif-gdk-pixbuf`/`heif-thumbnailer` 继续只作为文件管理器能力,不当作 core 能力。
- [x] **Windows 外部 helper**:免费插件路线可自带 `imgconvert-heic-helper.exe + libheif/libde265` decode-only 动态库;主程序支持用户手动选择 helper、manifest provider 与受信任 PATH 探测。不要直接打包现成 MSYS2 `libheif` 发行包,因依赖组合可能带 `x265`/GPL;必须自建并审计。Windows WIC + HEIF/HEVC 扩展探测已在 P3 平台发布阶段落地为 `system-wic` read-only provider。
- [x] **许可与专利文案**:插件单独 LGPL 分发并提供源码/NOTICE;第一版只声明 HEIC/HEIF 输入,不提供 HEIC 输出;UI 文案写「HEIC 可选导入」,不写“开箱支持 HEIC”。
- [x] **渠道边界**:外部 helper 默认只面向直发包/用户自行安装场景;App Store/MS Store/Flathub 构建可通过 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` 禁用外部 codec/helper 自动发现,除非后续证明渠道允许这种扩展模型。

---

## P2 — 高级压缩与保真

- [x] **per-format 参数第一批**(在 core 已接 mozjpeg/oxipng/webp/libavif-sys 之上):quality、progressive、oxipng level、AVIF speed、WebP method;默认值为 oxipng=4 / AVIF speed=8 / WebP method=4,其中 AVIF/WebP 已用 Linux arm64 release benchmark 第一批复核，AVIF speed=8 已由 macOS Apple Silicon 真实 runner 复核；Windows 数据继续按发布验收补齐。已贯通 core、Tauri IPC、设置持久化和 shadcn 格式参数 UI。
- [x] 全局有损/无损开关 + 每格式质量下限阈值(TIFF 为 **P2 可选**,非 v1 承诺,与顶部「TIFF 推后」一致)。当前全局无损对 PNG/WebP/AVIF 生效;JPEG/WebP/AVIF 有损模式可设 30-100 的质量下限,低于 30 视为禁用。
- [x] **有损 PNG 量化用宽松库**:`color_quant`(MIT)实验性限色,默认关闭;仍输出普通 PNG 并继续走 oxipng。⚠️ **不用 imagequant/GPL**。
- [x] **skip-if-larger / 永不变差第一批**:候选输出不小于源文件时跳过写入,批量计为 skipped;默认开启,可在设置里关闭以强制格式迁移。
- [x] **多候选取最小第一批**(借鉴 ImageOptim + Hando keep_bar):同一目标格式下比较等价多参数候选,只写最小有效输出。当前覆盖 JPEG baseline/progressive、PNG oxipng level、WebP method;不改变 quality/lossless/目标格式,AVIF 暂不做多候选以避免编码时间爆炸。
- [x] **自动质量(仅 JPEG/WebP)**:`ssimulacra2`(BSD-2-Clause,default-features=false)感知打分 + step≈4 二分搜索压到目标分;WebP lossless 作为候选参与比较。
- [x] **ICC/EXIF/XMP 透传容器手术**:默认剥离,开启 `preserveMetadata` 后 JPEG APP1 EXIF/XMP + Extended XMP + APP2 ICC(含分块)、PNG `iCCP`/`eXIf`/`iTXt` XMP(读压缩/未压缩,写未压缩)、WebP RIFF/`VP8X`/`ICCP`/`EXIF`/`XMP `、AVIF libavif ICC/EXIF/XMP metadata API 均可保留。JPEG/PNG 解码旋正后把 EXIF orientation 改写为 1。
- [x] **代际损失防护**:对 JPEG/AVIF/lossy WebP 源再次输出有损格式时按 source bpp 分级要求最低收益(2%/3%/5%/8%),收益不足计 skipped;VP8L lossless WebP 与 AVIF lossless 目标不触发。
- [x] 结果缓存(设置哈希 + 文件 blake3 哈希)跳过已优化:默认开启,命中时复用已有输出;缓存只记录 hash/size,不缓存图片内容。
- [x] 高级参数面板(AVIF speed/subsample、WebP near_lossless/sharp_yuv、MozJPEG trellis 等):已接 core/Tauri/前端设置持久化。
- [x] ⚠️ **不做**:JPEG XL(评审一致,过早);PNG 有损限色仅标「实验性」,PNG 默认仍是 oxipng 无损。
- [x] **CI 进阶**:npm license audit、Tauri build smoke test、`cargo-about` 自动生成校验、依赖树 GPL/AGPL/LGPL 拦截、GitHub Actions 干净 Linux 冒烟。

### 图像管线后续增强路线

- [x] **Metadata fidelity v2**:JPEG/PNG/WebP/AVIF 已支持 XMP raw packet 默认剥离/开启保留;JPEG Extended XMP 分片可写可读,PNG 压缩 `iTXt` XMP 可读。不新增依赖,不引入 GPL/AGPL/LGPL。
- [x] **AVIF 真无损 guardrail 第一批**:core 曾以 `AVIF_LOSSLESS_SUPPORTED=false` 保护能力矩阵,防止把 `quality=100` 冒充真无损;`probe_avif_lossless_candidate()` 用透明/不透明 case 实测像素级一致性。
- [x] **AVIF 真无损启用尖刺 harness**:`lossless=true` 的 AVIF 内部候选已尝试 identity matrix + full range + quantizer 0 + YUV444;`probe_avif_lossless_candidate()` 输出透明/不透明、YUV444/YUV420 请求、最大通道差和 encoded bytes。
- [x] **AVIF 真无损对外启用**:rav1e/libavif spike 实测仍有 1 channel delta,且 libavif 上游明确 rav1e 不支持 lossless;本批改为 AOM/libavif lossless path。像素级 round-trip 测试验证后,`AVIF_LOSSLESS_SUPPORTED=true`,`LOSSLESS_FORMATS` / capabilities / 前端 fallback 均加入 AVIF。无损路径会忽略用户 4:2:0 请求并强制 YUV444;自动质量与 AVIF 多候选仍保持关闭,避免编码时间爆炸。
- [x] **色彩管线 v2 第一批**:`ImageData` 已升级为 `PixelBuffer::{Rgba8,Rgba16,RgbaF32}`,Tauri 能力矩阵暴露 `colorPipeline`;core 缩略图改为线性空间、预乘 alpha resize。
- [x] **色彩管线 v2 完整实现**:新增 LittleCMS 静态 ICC transform,`ConvertToSrgb` 支持 `RGBA8/RGBA16/RGBAF32`;Tauri/前端接入显式 color policy;PNG 16-bit 解码/默认编码保真;新增主图 `resize_linear()` 并拒绝带 ICC 输入,要求先转 sRGB。边界:JPEG/WebP/AVIF 仍落 RGBA8,F32/HDR 容器信令后续再做。
- [x] **语义级 metadata 模块第一批**:新增 `RawMetadata` 和 metadata override 转换入口;EXIF orientation 规范化为 1,XMP 中 `tiff:Orientation` attribute/element 保守移除,避免旋正后双旋。
- [x] **语义级 metadata 模块第二批**:XMP 语义清理覆盖 `tiff:Orientation` / `exif:Orientation` 的属性、普通节点和自闭合节点,并移除 `xmpMM:History` 编辑历史节点。容器级 JPEG Extended XMP、AVIF XMP 与 PNG 压缩 `iTXt` XMP 已完成 raw passthrough。
- [x] **语义级 metadata 模块完整实现**:core 新增 `RawMetadata.iptc`、JPEG APP13/IPTC-NAA 读写、`inspect_metadata_semantics()` 语义报告、EXIF MakerNote 边界识别和多命名空间 XMP orientation/history 清理。边界:MakerNote/厂商私有字段只识别不改写;PNG/WebP/AVIF 暂不写原生 IPTC IIM。
- [x] **HEIC/helper metadata sidecar**:manifest args 可选 `{metadata}` 独立 argv;helper 可输出 sidecar JSON 引用 ICC/EXIF/XMP blob,主程序限大小/限路径读取并传入 core,结果缓存 key 在 preserve metadata 或转 sRGB 时纳入 sidecar hash。
- [x] **质量 heuristics 第一批**:core 新增 PNG 中 JPEG 8×8 网格 hint 与自动质量最大评分次数 guardrail;Tauri 代际损失防护在用户启用时把这类 PNG 作为有损来源处理。
- [x] **质量 heuristics 第二批**:core 的 `detect_lossy_artifacts()` 扩展 `webp_block_score`,可检测 PNG 中明显 WebP-like 4×4 块边界;平滑 PNG 误报通过绝对边界差门槛和单测守住。Tauri 仍按 hint 是否存在触发代际防护,无需 API 改动。
- [x] **质量 heuristics 第三批**:core 的 `detect_lossy_artifacts()` 扩展 JPEG 8×8 色度网格评分,覆盖亮度网格不明显但 Cb/Cr 在块边界跳变的 PNG;该结果继续只作为 conservative hint 触发代际防护,不宣称来源格式证明。
- [x] **平台质量 benchmark harness**:新增 `pnpm run bench:platform`,隐藏入口输出 AVIF/WebP JSON lines,支持平台、宽高、轮数、quality、AVIF speeds、WebP methods 参数化;`bench:avif:macos` 继续兼容 Apple Silicon AVIF 专项。
- [x] **图像质量测试体系第一批**:新增 `pnpm run test:image-quality` 和 core integration test suite,覆盖 golden lossless 像素一致性、高质量有损 PSNR/MAE 下限、corrupted input 干净失败、输出确定性与 JPEG 网格 artifact hint。
- [x] **平台质量 benchmark 数据闭环第一批**:`bench:platform` 默认改为 release profile 并生成 `target/benchmarks/*.json` 汇总报告/默认参数建议;本机 Linux arm64 release 数据复核后继续保留 AVIF speed=8 与 WebP method=4;2026-08-19 的 macOS `macos-15` arm64 runner 数据也确认 AVIF speed=8，并上传同格式 JSON artifact 供 14 天复核。core/Tauri 已接 per-file 180s wall-clock 软超时(`IMGCONVERT_CONVERT_TIMEOUT_SECONDS` 可覆盖),多候选/自动质量在候选边界停止。Windows 真实 runner 数据留到对应发布验收时用同一报告格式补齐，公共仓库只使用免费标准 runner。
- [x] **Fuzz + 真实图片 corpus 第一批**:新增 `fuzz/` cargo-fuzz crate,覆盖 decode/probe/thumbnail、bounded convert、metadata semantics 三个 target;新增 `pnpm run fuzz:prepare` 生成 deterministic seeds 并从本地 `corpus/real` / `IMGCONVERT_REAL_CORPUS_DIRS` 导入真实 JPEG/PNG/WebP/AVIF 到 ignored corpus,写 `target/fuzz-corpus/real-corpus-manifest.json`;`pnpm run fuzz:check` 编译 fuzz targets。真实图片不入仓库,避免版权/隐私污染。
- [x] **Fuzz corpus replay 回归入口**:新增 `pnpm run fuzz:replay`,不依赖 `cargo-fuzz` 即可把 prepared corpus 和 `fuzz/artifacts/<target>/` crash inputs 走 core decode/convert/metadata 路径并生成 `target/fuzz-corpus/replay-report.json`;`pnpm run fuzz:smoke` 已升级为 prepare + compile + replay,适合低成本本机/CI 守门。
- [x] **Fuzz crash artifact 最小化入口**:新增 `pnpm run fuzz:minimize` dry-run 报告和显式 `pnpm run fuzz:minimize:run`。后者调用 `cargo fuzz tmin <target> <artifact>` 后复跑 artifacts;报告不泄漏外部绝对路径。长期 fuzz 运行与真实 crash 样本积累仍需开发者显式执行。

---

## P3 — 发布(Linux 优先,GitHub Releases 第一期)

> 评审一致:个人/小团队不要四渠道并行。第一期只做 GitHub Releases 直发包,验证需求后再逐步推进 Flathub、macOS / Windows 直发与商店。

**第一期(GitHub Releases only):**
- [x] **CI 矩阵第一批**:GitHub Actions Tauri build smoke 改为 Linux **amd64 + arm64** 原生 runner;继续跑 C 工具链预检(NASM + cmake/meson/ninja)并上传 debug `.deb` artifact。
- [x] **CI/release 第二批**:新增 Linux release workflow(tag `v*`/手动触发),在 amd64 + arm64 上构建 release `.deb/.rpm/AppImage` 并上传 artifact;CI debug `.deb` 构建后会安装并 `xvfb-run` 启动 smoke。
- [x] **CI 矩阵扩展**:release workflow 在 amd64 + arm64 构建后跑 Docker/runtime smoke matrix:Ubuntu `.deb`、Debian `.deb`、Fedora `.rpm`、Ubuntu AppImage;脚本支持 `xvfb-run` 与裸 `Xvfb`,AppImage 使用 extract-and-run 规避容器 FUSE 缺失。
- [x] **GitHub Actions 公共仓库成本策略**:仓库转 public 后只使用免费标准 runner(`ubuntu-24.04`/`ubuntu-24.04-arm`/`windows-latest`/`macos-15`);CI 在 `main` push 与 PR 上自动跑 Linux 质量检查,fuzz 自动启用,Windows HEIC 与 Linux package smoke 在 main push 自动跑;`v*` tag 自动构建 Linux amd64+arm64 release;macOS/Windows/updater workflow 仍手动触发但不再需要 paid confirmation;`pnpm run ci:cost:check` 静态防回退到 paid runner 或 schedule。
- [x] **打包入口第一批**:新增 `pnpm run release:linux`/`release:linux:debug(:all)` 与 artifact verifier;正式 release 入口显式构建/校验 `.deb + .rpm + AppImage`,debug smoke 默认只打 `.deb`。
- [x] **打包元数据/校验第二批**:release 脚本先清理旧 bundle,artifact verifier 校验版本、`.deb` 依赖、包内二进制和 `.desktop` 元数据;`.desktop` 已补 `Graphics;Photography;` 分类;release 会生成 `SHA256SUMS`。
- [x] **打包实测入口**:**.deb(Debian/Ubuntu)+ .rpm(Fedora)+ AppImage** 干净发行版安装/启动 smoke 已接入 `pnpm run release:linux:smoke:docker`;安装包内真实转换 smoke 已通过隐藏 `IMGCONVERT_PACKAGE_CONVERT_SMOKE=1` 二进制入口接入 Docker matrix。
- [x] **Linux Release Candidate 实测闭环**:本机 `pnpm run release:linux` 生成 `.deb/.rpm/AppImage + SHA256SUMS`;artifact verifier 解包检查 `.deb` 与 AppImage 的二进制/desktop/GLIBC/根 symlink,AppImage scrub 移除 deny-list 系统库;Docker matrix 实测 Ubuntu `.deb`、Debian 13 `.deb`、Fedora `.rpm`、Ubuntu AppImage 启动均通过。
- [x] **Flathub repo 侧闭环(后续提交,不阻塞第一期)**:Flatpak manifest + desktop/metainfo + `release:flatpak:verify` 已落地;manifest 不申请 host/home filesystem,主包默认 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`,不含 HEIC。manifest 已从仓库根 `dir` source 改为 `release:flatpak:prepare` 生成的 release archive,并在 archive 内带 vendored Corepack/pnpm 与 Cargo/npm inputs;本地/CI 用 `path:` source,Flathub PR 可用 `--source-url=` 切换为 release `url:` source。Flatpak 发布 app-id 使用 `io.github.yeagoo.imgconvert` 以通过 Flathub 官方上游身份 lint,Tauri/macOS bundle identifier 仍保留 `com.ivmm.imgconvert`。`pnpm run release:flatpak:smoke` 已完成本机真实 `flatpak-builder` 构建、user install、`flatpak-builder --run` 和 `flatpak run` 包内转换 smoke;manifest 已升到 GNOME 50 runtime,AppStream metadata license 改为 `CC0-1.0`,aarch64 Flatpak 的 `libdav1d-sys` Meson cross file 在 prepare 阶段 patch 并同步 Cargo checksum。`release:flathub:metadata` / `release:flathub:metadata:lint` / `release:flathub:main-pr` 现在覆盖 Flathub AppStream 元数据、linter 入口和主包 PR 工作目录生成。可选 HEIC extension 真包 repo 侧已落地:主包只允许 `/app/extensions/codecs` 下的 Flatpak 扩展 manifest,不扫描宿主 PATH/XDG helper;`packaging/flatpak/extensions/heic/` 提供 `io.github.yeagoo.imgconvert.Codecs.Heic` decode-only manifest,固定 `libde265`/`libheif` 源码 tarball + sha256,关闭 encoding/x265/GPL-only 路径并安装 LGPL notice;`release:flatpak:heic:download-check` 可在未安装主 app runtime 时校验上游源码 URL/sha256,`release:flathub:heic-pr` 生成单独 addon PR 工作目录,`release:flatpak:heic:real-smoke` 可把主包与 extension 装入同一本地 repo 后用真实 HEIC 样张做沙盒内转换 smoke。真实 Flathub 主包/addon 审核、screenshot 远端 URL 发布和专利/频道接受后移,不作为第一期 GitHub Release 阻塞项。
- [x] **自动更新基础 + GitHub Releases 启用入口**:AppImage/.deb/.rpm release 产物生成 `SHA256SUMS`;Flatpak 更新由 Flathub 托管。Tauri updater 已注册并接应用内“应用更新”入口;`release:updater:prepare` 按 `TAURI_UPDATER_PUBKEY`/`TAURI_UPDATER_ENDPOINTS` 生成 release-only updater config,`release:linux:updater` 构建 scrub 后重签的 AppImage updater artifact,`release:updater:local` 可在本机默认读取 `~/.tauri/imgconvert-updater.key*` 后生成并校验 `target/updater/latest.json`,`release:updater:verify` 校验 manifest URL/平台/签名与本地产物一致,手动 `Updater Release` workflow 可上传 release assets。`release:updater:upgrade-smoke:eligibility` 验证旧/新 release 和签名,`release:updater:upgrade-smoke` / 手动 `Updater Upgrade Smoke` workflow 在 Linux x86_64 + Xvfb/xdotool 下执行真实应用内升级 smoke。默认 `tauri.conf.json` 不硬编码占位密钥或 endpoint;MAS/MSIX store 构建强制 `IMGCONVERT_DISABLE_UPDATER=1`,编译期移除 updater 插件注册并限制 capability,商店更新交给 Apple/Microsoft。真实发布仍需要仓库 secrets 中的 Tauri updater public/private key。
- [x] **发布 readiness 报告入口**:`pnpm run release:readiness` 默认按第一期 GitHub-only 范围汇总静态检查、Linux artifact、updater artifact 和外部阻塞项;`pnpm run release:readiness:github:ready` 是 GitHub Release 发布前硬闸门,任何 in-scope artifact/签名/updater 前置不是 ready 都会失败;`pnpm run release:readiness:all` / `--scope=all` 才显示 Flathub、macOS、Windows、商店和长期 benchmark/corpus 项。该入口不构建、不联网、不触发 GitHub Actions runner,用于每次发布前快速判断“本地能继续什么 / 必须等什么”。

**后续阶段(留门,不阻塞 v1):**
- [x] **macOS/Windows 发布护栏第一批**:新增 `release:platform:check` / `release:macos:check` / `release:windows:check` / `release:store-env:check`,静态校验发布元数据、平台图标、Apache-2.0 许可证和 store build 的 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` 外部 helper 禁用机制。
- [x] **macOS 打包/沙盒护栏第一批**:新增 `tauri.macos.conf.json`、`tauri.macos.mas.conf.json`、direct/MAS entitlements plist 与 `packaging/macos/README.md`;`release:macos:check` 会验证直发 hardened runtime、MAS App Sandbox、用户选择文件读写与 app-scoped bookmark entitlement,并拒绝 broad temporary entitlement。
- [x] **Windows 打包/Store 护栏第一批**:新增 `tauri.windows.conf.json` 与 `packaging/windows/README.md`;`release:windows:direct:check` 校验 direct installer 不允许降级、WebView2 silent embedded bootstrapper、最低 WebView2 版本、稳定 WiX `upgradeCode` 和 NSIS current-user 默认安装;Store preflight 继续强制 `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1`,真实 MSIX/`runFullTrust`/Partner Center 留到 Windows 实测阶段。
- [x] **macOS 发布闭环(repo 侧)**:直分发 `.dmg` 构建/校验脚本、显式 `notarytool` 公证/`stapler`/Gatekeeper verifier、MAS generated entitlements/provisioning config、signed `.app` candidate、可选 MAS `.pkg` packaging、GitHub-hosted HEIC smoke 与 artifact upload 已落地。真实 Developer ID/MAS 签名、公证、App Store Connect 上传和 MAS GUI 授权验收依赖 Apple Developer 账号/secrets。
- [x] **Windows 阶段第一批**:新增 Windows Smoke workflow,GitHub-hosted `windows-latest` 默认跑前端 typecheck、Windows release guardrail、Tauri backend fmt/clippy/test 与隐藏真实转换 smoke;手动触发可构建 unsigned `.msi`/NSIS `.exe` 并上传 artifact。
- [x] **Windows repo 侧发布闭环**:直分发 `.msi/.exe` 起步;Windows Smoke 手动 workflow 可构建 direct installers,签名/timestamp 脚本、安装后启动 smoke、WIC HEIC read-only provider 与 MSIX `runFullTrust` manifest prepare 已落地。HEIC **仅解码**,运行时探测 HEIF/HEVC 扩展,缺失则引导安装,**不承诺开箱即用**。
- [ ] **Windows 实签/Store 实跑**:需要真实 Windows 代码签名证书、timestamp 后 SmartScreen 声誉积累、安装 smoke runner 实跑、Partner Center identity、MSIX packaging/signing、Store assets/隐私/年龄分级元数据与商店提交验收。
- [x] ⚠️ **架构前提静态护栏(全程保持)**:`pnpm run architecture:check` 已把主程序核心无 HEIC/无 libvips/libheif/x265/imagequant/dssim、Apache-2.0、`image`/关键 codec `default-features=false`、依赖许可 deny、文件访问显式授权抽象、store build 禁外部 helper 和 Flatpak 主包不含 HEIC helper 变成发布前检查。P1.5 HEIC helper 仍是主包外直发/用户安装增强,商店构建默认禁用;该 invariant 后续仍需随新依赖/新格式持续维护。

---

## 评审修正清单(2026-06-29 三方外部评审纳入)

> 三份独立模型评审 + crates.io 实查后确认并采纳。**驳回的 FUD**:ssimulacra2 实为 BSD-2-Clause(非 WTFPL/GPL),干净可用。

| # | 评审发现 | 处理 | 落点 |
|---|---|---|---|
| 1 | 禁 LGPL 与 Linux libheif 自相矛盾 | **主程序不内置 HEIC**;如做 HEIC,只能外部 helper decode-only 单独分发 | 本文件 / LEGAL |
| 2 | rav1e 无 arm64 汇编,Apple Silicon AVIF 慢 | macOS `arm64` 实测后保持 speed 8：虽慢 2.763×，但体积小 48.76%，不更换后端 | P0.5 / ENGINE |
| 3 | ssimulacra2 二分搜索 × AVIF 不可用;PNG 无 quality 可搜 | 自动质量**仅 JPEG/WebP** | P2 |
| 4 | 文件级并发 × rav1e 内部线程 oversubscribe | rav1e `threads=1` | P0.5 / P1 |
| 5 | Windows HEIC 仅解码、需 HEVC 扩展 | 运行时探测 + 不承诺开箱即用,不编码 | P3 |
| 6 | 沙盒约束反向决定文件 API,晚验证会返工 | 文件访问抽象**前移 P0.5** | P0.5 |
| 7 | NOTICE/IJG/BSD 归属 | **应用内「开源许可」页** | P0.5 |
| 8 | ravif/image 容器元数据(ICC/EXIF/nclx)控制弱(alpha 其实能处理) | **AVIF 改用 libavif-sys**(DropWebP 路线) | ENGINE |
| 9 | HEVC 专利:系统 API ≠ 法律免责 | 文案按平台能力如实写;商用前找 IP 律师 | LEGAL |
| 10 | color_quant 质量 < imagequant | PNG 默认无损;有损量化标实验性 | P2 |
| 11 | NASM 2.15.05 钉版本脆弱 | build 加版本检测 + 明确报错 | P0.5 / ENGINE |
| 12 | JPEG XL 过早 | 删除 | P2 |

---

## 技术栈版本(2026-06-29 核对并锁定)

| 组件 | 锁定版本 | 备注 |
|---|---|---|
| Rust | **1.96.0**(stable) | `src-tauri/rust-toolchain.toml`(Rust 无 LTS) |
| Tauri CLI / api | **2.11.4** / **2.11.1** | crate `tauri` 2.11.x |
| Vite | **8.1.0** | ⚠️ Vite 8 默认 Rolldown,较新 |
| TypeScript | **6.0.3** | 6.0 是面向 TS 7(原生编译器)的过渡版 |
| 图像引擎 | **进程内 Rust crate**(混合架构) | `mozjpeg`/`oxipng`/`webp`/**`libavif-sys`(rav1e 有损 + aom 无损)**/`image`;HEIC 主包不内置,系统/插件能力另行探测;**取代 libvips**;详见 ENGINE.md |
| C 构建工具链 | **NASM**(macOS 钉 2.15.05;装后做版本检测)+ cmake + meson/ninja | rav1e/mozjpeg/libavif/libwebp 静态链接需要;Linux 上 webkit2gtk 仍为动态系统库 |
| 许可证 | **Apache-2.0** ✅ | 为上架从 AGPL 转;含专利授权;禁 GPL/AGPL/LGPL 依赖(deny.toml) |
| 包管理/运行时 | **pnpm 10 + Node LTS** ✅ | `package.json#packageManager` + `pnpm-lock.yaml`;Rust 后端不受影响 |
| 前端框架 | **Svelte 5(runes)** ✅ | `@sveltejs/vite-plugin-svelte` 7.x |
| UI 组件库 | **shadcn-svelte 1.3 + Tailwind v4** ✅ | `components.json` 已配;`pnpm dlx shadcn-svelte add <c>` 加组件 |
| 图标 | **phosphor-svelte 3.1(duotone)** ✅ | 全局 `IconContext weight="duotone"` |

> 已写入 `package.json` / `rust-toolchain.toml`,并经 **`pnpm run check`(0 错)+ `pnpm run build`** 验证通过。
> ⚠️ **Fallback**:TS 6 / Vite 8 都较新(TS 6 是面向 TS 7 的过渡版,Vite 8 用 Rolldown)。若与 Tauri / Svelte 插件链出现兼容问题,短期回退到 **TS 5.9 / Vite 7**。

## 已定技术决策

- **前端框架:Svelte 5(runes)** —— 轻、快、组件化省事。⚠️ **注意**:转宽松许可后,**不能再直接搬 vert(AGPL)源码**;只借鉴其交互/布局思路,自行实现。
- **包管理:pnpm + Node LTS** —— Tauri 桌面复杂度主要在 Rust/Cargo/WebView/系统依赖/签名打包;前端不依赖 Bun runtime。`beforeDevCommand`/`beforeBuildCommand` 用 `pnpm run`,锁文件只保留 `pnpm-lock.yaml`。
- **UI 库:shadcn-svelte 1.3 + Tailwind v4** —— 组件即代码(复制进仓库,可改),`components.json` 已配;`src/app.css` 是设计 token 单一出处(改色/圆角只此一处)。已内置 `Button`,其余用 `pnpm dlx shadcn-svelte add <component>`。
- **图标:phosphor-svelte 3.1,默认 duotone** —— 在 `App.svelte` 用 `<IconContext values={{ weight: "duotone" }}>` 全局设默认。

### 当前脚手架文件结构
```
index.html              # 挂载点 #app
src/main.ts             # Svelte mount()
src/App.svelte          # 主界面(已接 convert_image 后端)
src/app.css             # Tailwind v4 + shadcn 设计 token(改主题在此)
src/lib/utils.ts        # cn() 助手
src/lib/components/ui/   # shadcn-svelte 组件(button 已加)
components.json          # shadcn-svelte CLI 配置
svelte.config.js / vite.config.ts / tsconfig.json
```

> ⚠️ 复用提示(已随转宽松更新):**vert 是 AGPL,源码不可直接搬入宽松项目**——FormatDropdown、全屏拖拽遮罩等只借鉴交互/视觉思路,用 shadcn-svelte 自行实现。可直接复用的前端是 **DropWebP(MIT)** 的拖拽/批量逻辑(去 Vue 化)。
