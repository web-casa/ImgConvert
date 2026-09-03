# WEB-011 Web v1 发布前综合复审

> 复审日期：2026-09-03
>
> 本地结论：通过
>
> Cloudflare Pages Preview 结论：通过
>
> 公开发布结论：暂不放行，等待移动端真机门禁

## 1. 本次交付

- 补齐 24/32-bit BMP 和单帧 GIF 输入，覆盖到 JPEG、PNG、WebP、AVIF 四种输出。
- GIF 在读取完整容器并确认只有一帧后才进入 Worker；动画 GIF 明确拒绝，静态 GIF 在队列中持续显示首帧语义提示。
- BMP 在浏览器解码前校验 magic、文件长度、DIB 版本、位深、压缩方式、像素偏移、行跨度、尺寸与色彩空间。
- Raster Worker 重新探测收到的真实字节，不信任主线程传入的格式、尺寸和色彩配置声明；EXIF 方向 5–8 按归一化后的宽高复核。
- Worker 结果消息增加 64 MiB 硬上限；raster、SVG、PDF 输出复检均兼容小于 64 字节的合法文件。
- 转换进行中触发离开页面保护；375、768、1440 三档布局加入持续回归检查。
- 新增可复现门禁：`web:release:review:local` 与 `web:release:memory`。

## 2. Review 发现与修复

| 级别 | 发现 | 修复与证据 |
| --- | --- | --- |
| 阻塞 | 公开矩阵承诺 BMP/GIF，但 capability、probe、Worker 与文件选择器未接入 | 增加严格 BMP/GIF probe、Worker decoder、能力注册、双语提示和三浏览器 8 × 4 输入输出矩阵 |
| 高 | Worker 只校验主线程提供的 probe，可伪造输入格式或尺寸 | Worker 对转移后的真实字节重新 probe，并拒绝格式、长度、尺寸或色彩配置不一致 |
| 高 | 解码尺寸复核没有考虑 EXIF 方向交换宽高 | 方向 5–8 使用归一化尺寸；三浏览器 EXIF 用例重新通过 |
| 高 | Worker 成功消息未限制输出 ArrayBuffer 大小 | 协议层拒绝大于 64 MiB 的结果并回收异常 Worker |
| 中 | 小于 64 字节的合法输出会被二次 probe 参数误拒绝 | raster、SVG、PDF 统一使用至少 64 字节的窗口上限，同时仍只读取实际存在字节 |
| 中 | 转换进行中关闭页面没有未完成工作提示 | `beforeunload` 覆盖 active conversion，并由 E2E 验证取消后恢复正常 |
| 中 | 只持续检查 375 px 布局 | 自动化增加 768 px 与 1440 px 的水平溢出和关键容器边界检查 |
| 中 | iPhone 13 的较矮有效视口中，上传后的首个队列项仍可能完全落在首屏外 | 窄屏导入成功后只在队列项不可完整看见时滚动到队列，并尊重 reduced-motion；Pixel 7 与 iPhone 13 移动预检均通过 |
| 中 | GIF/BMP 色彩配置可能被当作无配置输入 | 识别 GIF `ICCRGBG1012`；BMP V4/V5 仅接受明确 sRGB/Windows 色彩空间，其余 fail closed |
| 中 | Playwright 只能启动本地 Vite，PWA scope 与同源隐私断言写死 localhost | 增加受限的 `IMGCONVERT_WEB_PREVIEW_ORIGIN`，只接受 HTTPS `*.pages.dev` origin；远程模式不启动本地服务器并按实际 origin 断言 |
| 中 | Preview smoke 未把 framing、referrer、permissions 与搜索引擎索引状态作为硬门禁 | 所有 HTML 路由新增安全头与 `X-Robots-Tag: noindex` 断言，并补充单元测试 |

## 3. 已通过门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm run quality:frontend` | 通过：类型、lint、Prettier、dead-code、构建、i18n、docs 与发布产物检查全绿 |
| conversion contract | 16/16 通过 |
| web image engine | 61/61 通过 |
| Web app 单元测试 | 27/27 通过 |
| 根测试 | 135/135 通过 |
| 本地 Playwright Chromium/Firefox/WebKit | 73 通过，2 个目录 API 能力用例按设计跳过；包含右侧 sticky 队列、长队列内部滚动与移动端导入反馈 |
| 本地移动设备模拟 | Pixel 7/Chromium 与 iPhone 13/WebKit 2/2 通过；上传回执、队列顺序、实际转换、下载、无横向溢出和无内容出站均通过；不替代真机门禁 |
| Pages Preview Playwright Chromium/Firefox/WebKit | 按引擎隔离验收合计 73 通过，2 个目录 API 能力用例按设计跳过；首次三引擎并发冷加载时 Chromium SVG→AVIF 在 76% 超时，单项复跑及 Chromium 单 worker 完整 25 项均通过；远程配置现已固定为单 worker，避免重型 WASM 编码器争抢宿主资源 |
| 输入 × 输出 | JPEG/PNG/WebP/AVIF/BMP/GIF/SVG/PDF × JPEG/PNG/WebP/AVIF 实际转换通过 |
| PWA/隐私/取消 | scope、离线、更新、缓存清除、无内容出站、主动取消与恢复通过 |
| 响应式与键盘 | 375/768/1440 无水平溢出；skip link、主题、关键控件键盘路径通过 |
| 发布产物 | 19 个关键路由、22 个 converter 文件、125 个发布文件通过结构/CSP/cache 配置门禁 |
| npm 供应链 | `pnpm audit --prod` 为 0 个已知漏洞；npm license 与生成 NOTICE 校验通过 |
| 24 MP 内存趋势 | Chromium 8 次：预热后 RSS 中位数增长 19,365,888 bytes，低于 371,353,804.8 bytes 门槛；峰值 2,686,971,904 bytes |
| 24 MP 兼容性 | Firefox 与 WebKit 各 1 次完成；该结果只证明兼容性，不宣称长期无泄漏 |

## 4. Cloudflare Pages Preview 验收

- Preview：<https://web-011-preview-20260903.imgconvert-cis.pages.dev>
- Deployment ID：`798fe03a-6aa4-461d-9480-f7aa76dc89c8`
- 分支标识：`web-011-preview-20260903`；环境确认为 Preview，Production deployment 未变。
- 真实响应 smoke：11 个 HTML 路由与 17 个 converter 资产通过 MIME、CSP、cache、Service Worker scope、`nosniff`、framing、referrer、permissions 和 `noindex` 门禁。
- 真实浏览器：JPEG/PNG/WebP/AVIF/BMP/GIF/SVG/PDF 到 4 种 raster 输出、下载、离线、PWA 更新、缓存清除、取消恢复与无内容出站均通过；Chromium 为避免 AVIF WASM 并发资源竞争，另以单 worker 完整复跑 25/25 通过。
- 视觉复审：首页、Web 转换器、Docs、Blog、Legal、Privacy 在 375/768/1440 宽度没有水平溢出、遮挡、空白路由或控制台错误，现有 Kimi 视觉结构保持一致；导入队列在宽屏右侧 sticky，长队列在栏内滚动，窄屏紧跟上传区。
- 移动模拟：Pixel 7/Chromium（412 × 839）与 iPhone 13/WebKit（390 × 664）均完成远程上传、首屏队列计数反馈和实际转换，无横向溢出或页面异常；该结果不替代移动 Safari/Android Chrome 真机内存门禁。

## 5. 仍需外部环境完成

以下项目不应伪装为本地已通过，也不应在完成前公开发布 Web v1：

1. 在目标移动 Safari 与 Android Chrome 真机上确定动态像素预算。移动端不强制处理 24 MP，但必须能在重型解码前拒绝超出已确认预算的输入。

   执行步骤与放行记录见 [移动端验收门禁](WEB_CONVERTER_MOBILE_DEVICE_ACCEPTANCE.md)。

2. 只有上述结果写回本清单后，才可以批准 Cloudflare production 发布。本次只部署了 Preview，没有更新或推断 Production 发布授权。

## 6. 复现命令

```bash
pnpm run web:release:review:local
pnpm run web:release:memory
pnpm run web:app:e2e:mobile
pnpm run web:release:preview:smoke -- --url=https://<branch>.<project>.pages.dev
IMGCONVERT_WEB_PREVIEW_ORIGIN=https://<branch>.<project>.pages.dev pnpm --dir web-app test:e2e
IMGCONVERT_WEB_PREVIEW_ORIGIN=https://<branch>.<project>.pages.dev pnpm --dir web-app test:e2e:mobile
```
