# WEB-001 / WEB-001B：Web raster 引擎 Spike 报告

> 日期：2026-09-02
>
> 候选：`@imagemagick/magick-wasm@0.0.43`、独立 jSquash codec 组合
>
> 结论：**stock ImageMagick 产物 no-go；独立 codec 组合通过 WEB-001B，允许进入 WEB-002 契约开发**

## 1. 结论

`@imagemagick/magick-wasm@0.0.43` 的浏览器技术路径成立：它能在独立 Web Worker 中完成 JPEG、PNG、WebP、AVIF 的 4 × 4 转换矩阵，三个浏览器引擎均能原生解码输出，透明度、XMP 清理、同源加载与取消后恢复也通过。

但是，stock WASM 的发布 `NOTICE` 明确包含多个 LGPL 组件，与 ImgConvert 现有 no-AGPL/GPL/LGPL 依赖政策冲突。npm 顶层包只声明 Apache-2.0，仓库原有 manifest 级 npm license gate 会放行，因此不能仅依据 `package.json` 许可证字段。

最终决策：

- 不把 stock `@imagemagick/magick-wasm` 加入根 workspace、正式 Web 应用或 Cloudflare Pages 产物。
- 保留独立、嵌套 lockfile 的 spike 作为可复现实验证据；它不参与根构建和发布。
- ImageMagick 的 AVIF 路径必须经过 LGPL 的 libheif；因此没有继续维护一个表面精简、实际仍违反项目政策的自编译分支。
- `WEB-001B` 改用 JPEG、PNG、WebP、AVIF 四个独立 codec，并已通过三浏览器、许可证、完整性、取消和 24 MP 基准门禁。
- 允许开始 `WEB-002` 的无 DOM 转换契约与能力注册；正式产品仍须在发布前补齐第三方许可全文、真实摄影/方向/ICC corpus 和移动设备资源预算。

## 2. WEB-001B 独立 codec 结果

独立候选位于 `spikes/web-codecs/`，使用精确锁定版本：

| 格式 | npm 包 | 原生实现 | 版本 |
| --- | --- | --- | --- |
| JPEG | `@jsquash/jpeg` | MozJPEG | 1.6.0 |
| PNG | `@jsquash/png` | Rust `png` crate | 3.1.1 |
| WebP | `@jsquash/webp` | libwebp | 1.5.0 |
| AVIF | `@jsquash/avif` | libavif + libaom + libsharpyuv | 2.1.1 |

### 2.1 为什么没有继续自编译 ImageMagick

核对官方 Magick.Native 构建定义后确认：ImageMagick 的 AVIF/HEIF delegate 通过 libheif 接入，而 libheif 本身是 LGPL。关闭 libheif 可以去掉阻断项，但也会同时失去本项目 Web v1 必须验证的 AVIF 路径。该路线因此已命中 `WEB-001B` 的许可证止损条件，直接切换到独立 codec，而不是继续消耗计划中的两个开发日。

### 2.2 三浏览器矩阵与恢复

最终 promotion run 使用 Chromium 149.0.7827.0、Firefox 151.0、WebKit 26.5：

| 浏览器引擎 | 4 × 4 | 原生解码 | XMP marker 清理 | 无外部请求 | 非法输入后恢复 | 取消后恢复 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium | 16/16 | 4/4 | 通过 | 通过 | 通过 | 100.1 ms |
| Firefox | 16/16 | 4/4 | 通过 | 通过 | 通过 | 391 ms |
| WebKit | 16/16 | 4/4 | 通过 | 通过 | 通过 | 165 ms |

矩阵验证真实透明像素；输出 JPEG 时显式铺白，其余允许格式保持 alpha。每个输出同时检查 magic、尺寸、alpha/opaque 语义和浏览器原生解码结果。取消通过终止并重建 Worker 实现，恢复时间包含新 Worker 和 codec 初始化，不等于 `terminate()` 调用耗时。

### 2.3 产物与加载

一次完整四格式矩阵实际加载 7 个 WASM，合计 5,739,428 bytes（gzip 约 1.87 MB）：PNG、JPEG 编解码、WebP SIMD 编解码和 AVIF 编解码。生产构建还携带 281,261 bytes 的 WebP 非 SIMD fallback，但同一运行时只选择其中一个 encoder。AVIF 多线程 encoder 没有进入最终 dist；标准产品路径不要求 COOP/COEP 或 `SharedArrayBuffer`。

冷启动基线分别为 Chromium 144.5 ms、Firefox 206 ms、WebKit 174 ms。这些是当前 Linux CI 主机上的相对基线，不是终端设备承诺。

### 2.4 大图与内存

6000 × 4000（24 MP）PNG → AVIF 通过：

| 浏览器引擎 | 次数 | 单次耗时 | 结果 |
| --- | ---: | ---: | --- |
| Chromium | 8 | 首次 4.39 s，后续 3.57–3.85 s | 8/8 |
| Firefox | 1 | 51.53 s | 1/1 |
| WebKit | 1 | 3.47 s | 1/1 |

浏览器的 `measureUserAgentSpecificMemory()` 在该自动化环境不可用，因此没有把它误报为通过。Linux `/proc` 进程树采样显示 Chromium 8 次循环预热窗口到结束窗口的 RSS 中位数增长 19,550,208 bytes（约 18.6 MiB），低于门禁的 `max(64 MiB, 15%)`；峰值约 2.50 GiB。Firefox/WebKit 只做了一次兼容性运行，不能据此宣称长期无泄漏。

48 MP 与 64 MP 的 PNG 头部样本均在解码前被 24 MP 运行时预算拒绝。这个结果证明“提前拒绝”路径成立，但当前 probe 仅覆盖 PNG；`WEB-003` 必须为每个允许输入格式实现有界头部探测。24 MP 只能作为首轮桌面浏览器工程上限，移动端预算必须更低并由真机数据决定。

### 2.5 许可证与完整性

`license:check` 已验证：

- 四个 jSquash 包及 `wasm-feature-detect` 的精确版本和 npm 许可证；
- jSquash 源码 revision `da47a2be3b302beb5a5ae164a2ab7aa21a041d90` 中的构建版本；
- libavif、libaom、libsharpyuv、MozJPEG、libwebp 和 PNG Rust 依赖的宽松许可证清单；
- npm 中 9 个 WASM 变体的精确 SHA-256；
- AGPL/GPL/LGPL marker 阻断。

该门禁通过，`pnpm audit --prod` 无已知漏洞。它是工程供应链门禁，不代替法律意见；正式应用仍需生成并提供包含完整许可与 attribution 文本的第三方声明资产。

### 2.6 尚未宣称通过的能力

- EXIF orientation 归一化与真实 EXIF/IPTC 容器 round-trip；
- 非 sRGB ICC 识别、转换和 fail-closed 行为；
- 动画 WebP/GIF 探测；
- BMP/GIF 输入、SVG 和 PDF 管线；
- 真实摄影 corpus、移动 Safari/Android 低内存设备和长时间多文件队列；
- 正式应用的第三方许可全文生成与 UI 入口。

## 3. Stock ImageMagick 实验实现

隔离原型位于 `spikes/web-magick-wasm/`，包含：

- Vite 生产构建与本地 WASM 资源。
- 独立 TypeScript Web Worker。
- JPEG/PNG/WebP/AVIF 4 × 4 转换矩阵。
- 真实透明像素的 alpha/opaque 语义断言。
- 向四种输入容器写入最小 XMP，再验证 `strip()` 后输出 profile 为空。
- 浏览器 `createImageBitmap` 原生解码验证。
- 终止忙碌 Worker、拒绝原请求、创建新 Worker 并重新完成矩阵的恢复验证。
- 网络请求审计：转换期间不得访问 loopback origin 以外地址。
- 最终 WASM `NOTICE` 的 bundle 级许可证解析与阻断门禁。

原型没有复制 VERT 源码、CSS、素材或 fixture，也没有修改桌面 `imgconvert-core` 和营销站构建。

## 4. Stock ImageMagick 技术结果

测试环境：Linux arm64、Node 24.18.0、pnpm 10.34.4、Playwright 1.61.1；runtime 分别为 Chromium 149.0.7827.0、Firefox 151.0、WebKit 26.5。

### 4.1 格式矩阵

| 浏览器引擎 | 4 × 4 转换 | 原生解码 JPEG/PNG/WebP/AVIF | Alpha/opaque | XMP strip | 外部请求 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 16/16 | 4/4 | 通过 | 通过 | 0 |
| Firefox | 16/16 | 4/4 | 通过 | 通过 | 0 |
| WebKit | 16/16 | 4/4 | 通过 | 通过 | 0 |

引擎报告：

```text
ImageMagick 7.1.2-30 Q8 wasm32 344e9056f:20260823
features: Cipher
delegates: bzlib freetype heic jng jp2 jpeg jxl lcms lqr openexr png raw tiff webp xml zlib
```

运行时 capability 同时显示 HEIC 可读但不可写。这不改变产品决定：Web v1 不能因为 stock 引擎“碰巧可读”就宣称 HEIC 支持。

### 4.2 初始化、转换与取消

下表来自一次最终本机测试，仅作为相对基线，不作为用户设备性能承诺：

| 浏览器引擎 | WASM 初始化 | 96 × 64 矩阵最慢单元 | Worker terminate 调用 | 取消并重建后完成恢复矩阵 |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 67.1 ms | 17.8 ms | 0.4 ms | 150.4 ms |
| Firefox | 205 ms | 108 ms | 1 ms | 401 ms |
| WebKit | 118 ms | 19 ms | 1 ms | 437 ms |

“取消并恢复”包含重新下载/缓存命中、WASM 初始化和完整恢复矩阵，不能误称为取消延迟。真正同步 `Worker.terminate()` 调用在本机为 0.4–1 ms。

### 4.3 构建产物

| 产物 | 未压缩 | gzip |
| --- | ---: | ---: |
| x86/wasm32 `magick.wasm` | 14,828,458 bytes | 5,192,849 bytes |
| Worker JS | 约 202 KB | 构建日志未单列 |
| 页面入口 JS | 约 3.6 KB | 约 1.75 KB |

WASM SHA-256：

```text
5a4ed1017eda113144c86ae839c22c610afebcfebfa22b1da18e00e98d78b0f7
```

该包还同时发布 x64 WASM，npm unpacked size 约 31.1 MB；本实验和普通浏览器构建只引用 x86/wasm32 产物。

## 5. Stock ImageMagick 许可证结果

### 5.1 顶层声明

- npm package：Apache-2.0。
- ImageMagick 主许可证：允许再分发，但必须保留许可证与 attribution/NOTICE。
- 仓库现有 `pnpm run license:npm`：通过，因为它检查 npm manifest 的 SPDX 许可路径。

### 5.2 最终 WASM NOTICE

bundle 级检查发现以下强制阻断项：

| 内置组件 | NOTICE 中的禁止许可证标记 |
| --- | --- |
| de265 1.1.1 | LGPL |
| glib 2.64.3 | LGPL |
| heif 1.23.1 | LGPL |
| lqr 0.4.2 | LGPL |
| raw 0.22.2 | LGPL |

命令 `pnpm --dir spikes/web-magick-wasm license:check` 会按设计返回非零状态，防止该候选被误提升为正式依赖。`license:report` 只输出相同事实，供报告与 CI 诊断使用。

这次结果还暴露了一个通用供应链规则：以后所有包含预编译 WASM/native artifact 的 npm 包，必须同时检查包内 NOTICE/许可证与真实 delegate，不能只检查顶层 SPDX。

## 6. Review 后修正的原型问题

| 问题 | 修正 |
| --- | --- |
| DOM 与 WebWorker lib 放进同一 tsconfig，产生全局声明冲突 | 拆成 app/worker 两份 tsconfig |
| 上游 `.d.ts` 在 Worker 导入时仍暴露 DOM-only Canvas 类型 | 使用最小 type-only shim，不关闭本项目源码类型检查 |
| 初始代码猜错版本属性 | 按安装后的声明改用 `Magick.imageMagickVersion` |
| Firefox/WebKit revision 与 Playwright package 不匹配 | 安装 1.61.1 对应 runtime 后重跑，缺浏览器不降级为通过 |
| WASM 缓存命中返回 304，被测试误判失败 | 接受 200/304，只对带实体的 200 检查 MIME |
| 初始 fixture 有 alpha 通道但像素完全不透明 | 加入真实透明区并验证 `hasAlpha` + `isOpaque` |
| 无 metadata 的输入不能证明 strip | 四种源格式先写入 XMP，确认存在后再验证输出清空 |
| `cancelMs` 实际包含恢复过程 | 拆为 `terminationCallMs` 与 `cancelAndRecoveryMs` |
| build 失败后测试仍读取旧 dist | build/test 改为独立、顺序执行 |
| no-go 实验包曾进入根 workspace/lockfile | 改为嵌套 workspace，并恢复根 lockfile 原状 |
| 旧 Worker 的迟到 error 可能终止已创建的新 Worker | 事件处理和替换函数都核对 Worker 实例身份 |
| `dispose()` 后仍可发请求并永久等待 | dispose 后立即拒绝请求，并统一清空 pending promise |
| Worker 消息只靠 TypeScript 类型假设 | 主线程和 Worker 都增加运行时结构、ID、字节数、格式与迭代次数验证 |
| 测试只计数原生解码结果 | 每种格式都断言成功、宽度和高度；补非法输入恢复与同源 GET/no-body 检查 |
| preview 异常时可能留下进程 | 增加启动、操作和关闭超时，失败时 SIGTERM 后有界升级 SIGKILL |

## 7. Stock 候选没有继续执行的项目

没有对 stock 候选继续执行 24/48/64 MP 内存压力、真实摄影 corpus、EXIF orientation 和 ICC 色彩转换测试。原因不是把这些项目视为通过，而是许可证已先触发不可绕过的 no-go；继续生成无法用于发布的性能数据没有决策价值。

24 MP、48/64 MP 提前拒绝、取消、三浏览器矩阵和 bundle license gate 已迁移到 `WEB-001B`。EXIF orientation、ICC、真实摄影 corpus 与移动端预算仍保留为明确未完成项。

## 8. WEB-001B 原止损规则与实际结果

原计划优先验证“精简自编译 magick-wasm”路线：

1. 只保留 ImageMagick、jpeg-turbo、libpng、libwebp、aom、lcms 和必要的 zlib/brotli 等宽松许可证组件。
2. 明确关闭 HEIC/de265/glib、lqr、raw、PDF/Ghostscript、网络和不需要的格式 delegate。
3. 生成新的完整 NOTICE、delegate 列表、SBOM 与可复现构建说明。
4. 必须先通过 bundle license gate，再复用本 spike 的三浏览器矩阵。
5. 然后补 24 MP 成功、48/64 MP 成功或解码前拒绝、worker 工作集与长期循环测试。

`WEB-001B` 的止损条件：

- 两个开发日内无法得到可复现的精简 WASM；或
- gzip 仍超过 8 MiB；或
- 仍包含任何 AGPL/GPL/LGPL 组件；或
- 三浏览器矩阵、alpha、strip、取消任一失败。

实际在源码构建定义中确认 AVIF 依赖 LGPL libheif，已命中第三条并转向独立 codec。独立候选随后通过现阶段门禁。`WEB-002` 已据此建立无 DOM contract 和 capability registry；`WEB-003` 也已完成四格式有界头部探测、串行 Worker 调度、取消/超时回收和迟到事件隔离的首版；`WEB-004` 已完成 `/convert/` Svelte 应用壳、真实本地导入、串行 probe 与队列交互；`WEB-005` 已接入独立 codec Worker、四格式转换、缩放、alpha 背景、输出复检、预览和单文件下载。下一开发项为 `WEB-006` SVG 安全管线。UI 只能依赖这些契约，不感知底层 codec。

## 9. 复现命令

```bash
pnpm --dir spikes/web-magick-wasm install
pnpm --dir spikes/web-magick-wasm build
pnpm --dir spikes/web-magick-wasm test
pnpm --dir spikes/web-magick-wasm license:report
pnpm --dir spikes/web-magick-wasm license:check # 预期失败：stock bundle no-go

pnpm --dir spikes/web-codecs install
pnpm --dir spikes/web-codecs promotion:check
pnpm --dir spikes/web-codecs benchmark
pnpm --dir spikes/web-codecs audit --prod
```
