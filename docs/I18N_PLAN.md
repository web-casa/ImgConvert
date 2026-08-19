# ImgConvert zh-CN / en-US 双语开发方案 v2

## 1. 范围与目标

- 桌面应用 UI 支持 `zh-CN` 与 `en-US`
- 新用户按 OS locale 自动选择；已有用户默认 `zh-CN`
- Topbar 提供语言切换，并复用现有 Tauri Store 持久化
- Rust 用户可见错误改为结构化错误码，前端本地化
- Microsoft Store 以 Partner Center listing 双语为准，暂不做 MSIX 包内 MRT 本地化
- docs-site 英文站独立排期，不阻塞 Store 发布

## 2. 技术选型

- 前端：`svelte-i18n` v4
  - 支持 Svelte 5
  - 项目规模下足够，不引入框架级 i18n
- OS locale：`@tauri-apps/plugin-os`
  - Tauri 桌面端优先使用 OS locale
  - 网页预览 fallback 到 `navigator.language`

## 3. 前端结构

```text
src/lib/i18n/
├── index.ts
├── messages/
│   ├── zh-CN.ts
│   └── en-US.ts
└── keys.ts
```

组件用法：

```svelte
<script lang="ts">
  import { t } from "svelte-i18n";
</script>

<h1>{$t("settings.targetFormat")}</h1>
```

## 4. 语言初始化时序

1. 应用启动时，同步初始化 `svelte-i18n`
   - 当前两份 message 都随应用静态打包，必须先用 `addMessages()` 注册，再调用 `init()`；
     不得把它们包装成 `register(() => Promise.resolve(...))` 异步 loader。`state.svelte.ts`
     在模块加载期间就会格式化 engine 状态，异步 loader 会让首屏 locale 尚未设置并导致
     `svelte-i18n` 抛错。
2. 先用同步可得值决定首屏语言：
   - Tauri：`@tauri-apps/plugin-os` 的 OS locale
   - Web：`navigator.language`
3. 异步读取 Tauri Store 的持久化 `settings.locale`
4. Store 加载完成后，如存在持久化值则 `locale.set(persisted)`
5. 在 Store 就绪前显示 loading gate，避免默认语言闪变

`Settings` 增加：

```ts
locale: "zh-CN" | "en-US"
```

已有用户无 `locale` 时默认 `zh-CN`；新用户按 OS locale。

## 5. 前端文案迁移原则

- `src/**/*.{svelte,ts}` 中用户可见文案全部改为 message key
- `src/lib/i18n/messages/**` 为唯一允许包含中文 UI 文案的目录
- `state.svelte.ts` 中的 `FORMAT` 数据不复制两份，改为：

```ts
{
  value: "jpeg",
  labelKey: "formats.jpeg.label",
  descriptionKey: "formats.jpeg.description"
}
```

- 动态错误只显示前端本地化消息；Rust 原文作为 detail 或日志

## 6. Rust 错误码设计

不使用无参数枚举，采用结构化错误：

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: ErrorCode,
    pub params: Option<serde_json::Value>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    FileNotFound,
    PermissionDenied,
    UnsupportedFormat,
    OutputExists,
    OutputNotSmaller,
    ConversionFailed,
    BatchFailed,
    ImportFailed,
    ClipboardImportFailed,
    NativeDialogFailed,
    ThumbnailFailed,
    CodecConfigurationFailed,
    TaskFailed,
}
```

前端渲染：

```ts
errors: {
  fileNotFound: {
    "zh-CN": "找不到文件：{path}",
    "en-US": "File not found: {path}"
  }
}
```

迁移路径：

- `Result<T, String>` 先保留内部使用
- 所有 `#[tauri::command]` 边界改为 `Result<T, CommandError>`
- 旧 String 错误在 command 出口统一包装为 `ConversionFailed` / 对应 code
- `detail` 只放底层错误原文，不决定用户语言

### 6.1 Phase 3 已确认的 IPC 错误契约

**状态：2026-08-19 已完成。**

> 本节在实现前锁定，避免前后端各自猜测 Tauri reject payload。Tauri command 的
> `Err` 必须序列化为下列 JSON 对象；不得再把 Rust 的中文/英文底层错误字符串直接
> 当作用户界面文案。

```json
{
  "code": "fileNotFound",
  "params": { "path": "/images/missing.png" },
  "detail": "输入文件不存在: /images/missing.png"
}
```

`code` 使用 `camelCase` 枚举值。当前 Phase 3 的稳定集合为：

| Rust `ErrorCode` | IPC `code` | `params` | 使用场景 |
| --- | --- | --- | --- |
| `FileNotFound` | `fileNotFound` | `path` | 已知输入文件不存在 |
| `PermissionDenied` | `permissionDenied` | `path` | 已知文件/目录权限拒绝 |
| `UnsupportedFormat` | `unsupportedFormat` | `format` | 不支持的输入或目标格式 |
| `OutputExists` | `outputExists` | `path` | 输出路径已存在且策略不允许覆盖 |
| `OutputNotSmaller` | `outputNotSmaller` | `path` | skip-if-larger / 代际防护导致的跳过 |
| `ConversionFailed` | `conversionFailed` | `path` | 其余单文件转换失败 |
| `BatchFailed` | `batchFailed` | 无 | 批量协调或进度通道失败 |
| `ImportFailed` | `importFailed` | `path`（可选） | 导入扫描失败 |
| `ClipboardImportFailed` | `clipboardImportFailed` | 无 | 剪贴板图片导入失败 |
| `NativeDialogFailed` | `nativeDialogFailed` | 无 | Linux 原生文件选择器失败 |
| `ThumbnailFailed` | `thumbnailFailed` | `path` | 缩略图生成失败 |
| `CodecConfigurationFailed` | `codecConfigurationFailed` | `path`（可选） | HEIC helper 配置失败 |
| `TaskFailed` | `taskFailed` | 无 | 阻塞任务调度/不可归类的后端失败 |

规则：

- `params` 只放适合 UI 插值的标量值（当前为路径或格式）；未使用时为 `null`。
- `detail` 保留原始技术原因，前端只可在**开发环境**的开发者控制台记录，且**绝不**显示或插值到用户界面；生产环境的后台失败日志必须先映射为本地化 message，不能直接输出 reject payload。
- 前端只按 `errors.<code>` 渲染 ICU message；未知、旧版字符串或畸形 payload 一律走
  `errors.taskFailed`，不能回退显示原始错误。
- 除 command reject 外，批量 `fileError` / `fileSkipped` progress event、导入扫描的逐项
  error、以及输出规划的 error 字段也使用同一个 `CommandError` 结构，避免绕过本地化
  的字符串通道。
- `codec_diagnostics()` 是成功返回的技术诊断快照，不属于 command error 通道；但
  `set_selected_heic_helper()` 的失败必须遵循此契约。

前端通过项目现有 `svelte-i18n`（其 formatter 基于 `intl-messageformat`）插值，消息采用
ICU 语法，例如 `"File not found: {path}"`。两份 locale 文件同时新增同一组 `errors.*`
key，并由现有 key parity 测试守护。项目的 `translate()` 封装和直接 `$t` / `get(t)` 调用
必须把插值对象放入 `values`：`translate(key, params)` 会转为 `{ values: params }`，直接调用
则使用 `$t(key, { values: params })`。这是 `svelte-i18n` v4 的 ICU 参数接口，不能把 params
直接作为第二个对象的顶层字段。

### 6.2 Phase 3 复核补充（2026-08-19）

- UI 路径和后台路径都必须经过同一错误格式化层。缩略图、剪贴板临时文件清理、HEIC helper 同步等没有用户提示的后台失败，生产环境只能记录本地化后的通用消息；原始 `detail` 仅由格式化层在开发环境记录。

## 7. CI 硬编码检查

新增：

```text
scripts/check-ui-hardcoded-strings.mjs
package.json: check:ui-i18n
```

规则：

- 扫描 `src/**/*.{svelte,ts}`
- 排除 `src/lib/i18n/messages/**`
- 除注释外，出现 CJK 字符即失败
- 不扫描 `src-tauri/**`；Rust 日志/注释/测试保留中文
- 加入 `quality:frontend`

## 8. 分阶段计划

### Phase 1：i18n 基础设施

- 接入 `svelte-i18n`
- 接入 `@tauri-apps/plugin-os`
- `zh-CN.ts` / `en-US.ts` 骨架
- `settings.locale` 持久化
- Topbar 语言切换按钮
- loading gate 与语言初始化时序
- message key parity 测试

### Phase 2：前端全量迁移

- `App.svelte`
- `Dropzone.svelte`
- `FormatSelect.svelte`
- `SettingsBar.svelte`
- `QueueItem.svelte`
- `Topbar.svelte`
- `UpdateDialog.svelte`
- `LegalDialog.svelte`
- `PluginDiagnosticsDialog.svelte`
- `state.svelte.ts`
- 格式数据改为 key 引用

### Phase 3：Rust 结构化错误迁移

- [x] 定义 `CommandError` / `ErrorCode`
- [x] 迁移核心 command 边界：
  - import
  - convert
  - native dialog
  - clipboard
  - thumbnail
  - external codec diagnostics
- [x] 前端错误映射与 ICU 插值
- [x] 保留底层 detail，且不在用户界面显示

### Phase 4a：Store listing 与隐私政策

**当前状态（2026-08-19）：** 发布负责人已确认公开免费、账户可用全部市场、本地优先
定位、GitHub Pages、GitHub Issues 和现有无遥测事实。已在
[Store listing 与隐私政策准备包](STORE_LISTING_4A.md) 写入双语文案、英文政策和 Pages
工作流；仍需仓库管理员启用 Pages、生成 Windows 实机截图，并由 Partner Center 账户
负责人导出 CSV、完成 IARC 和提交。未完成这些外部动作前，不发起 submission。

- Partner Center 中文 / English listing
- 隐私政策中英双语
- 截图说明中英双语
- 明确不做 MSIX 包内 MRT 本地化

### Phase 4b：docs-site 英文站（独立，不阻塞发布）

**当前状态（2026-08-19）：** 已完成 Fumadocs i18n 路由与首批英文内容；保持中文既有
URL，不把未翻译文档静默展示为中文。

- [x] Fumadocs i18n 结构与英文内容
- [x] 首页、安装、使用、隐私、排障优先

#### 4b 实施契约（2026-08-19）

- `zh-CN` 是隐藏在 URL 中的默认 locale，继续使用既有的 `/` 和
  `/docs/...` 中文链接；`en-US` 使用显式的 `/en-US/...` 和
  `/en-US/docs/...` 链接。不能为这次文档国际化破坏已分享的中文 URL。
- 文档 loader 使用 Fumadocs 的 dot 文件解析和 `fallbackLanguage: null`。
  英文 URL 只能呈现实际翻译过的英文页面；尚未翻译的中文文档不能静默回退为中文。
- Next 16 的 `proxy.ts` 负责 locale rewrite；搜索 API 保持在 `app/api/search`
  之外，不放进 `[lang]` 路由段。loader、页面树、页面查询和搜索全部传入当前 locale。
- `zh-CN` 隐藏前缀后的 Fumadocs framework pathname 必须在 SSR 与浏览器两端都规范为
  `/docs/...`；否则 rewrite 后的内部 `/zh-CN/docs/...` 会让活动导航或交互组件发生
  hydration mismatch。`en-US` 的显式前缀不得被移除。
- 英文第一批仅覆盖首页、安装、使用、隐私和排障。英文 `meta.en-US.json` 只列出
  这些已翻译页面，避免导航到空页。语言切换遇到尚无英文版本的中文文档时应回到英文
  文档首页，而不是生成 404。用户直接输入未翻译英文文档深链或未知英文根级路径时，
  必须返回带当前 locale 上下文的 404，不能回退中文或显示框架默认页。
- 文档站隐私页使用 Fumadocs `<include>` 引用仓库根目录的 `PRIVACY.md` 和
  `PRIVACY.en.md`。这两份政策仍是唯一正文来源；不得复制为第三份可漂移的政策文本。
  由于规范政策正文自身提供 H1，文档页不得再额外渲染 Fumadocs 的页面标题或摘要，
  以免产生重复的一级标题。
- 这项工作只改 docs-site 的内容、路由和验证，不部署或启用 GitHub Pages，不创建
  Partner Center submission，也不改变 Store 的 codec/updater 禁用约束、公共 runner
  策略或 Flatpak app-id。
- 每次变更至少执行 docs-site 的 typecheck/build、双语路由与内容静态检查，以及实际
  浏览器 smoke；根仓库的 `quality:frontend` 应同时覆盖 docs-site 的编译检查。

### Phase 5：QA 与发布

**当前状态（2026-08-19）：** 仓库内 QA、Windows hosted runner MSIX install smoke 与 Store
submission artifact 重建均已完成。`Windows Smoke`
([run 32218246687](https://github.com/web-casa/ImgConvert/actions/runs/32218246687)) 使用临时
`ImgConvert.DevSmoke` identity 成功执行 sideload 后的转换 smoke；`Windows Store MSIX`
([run 32218253749](https://github.com/web-casa/ImgConvert/actions/runs/32218253749)) 成功上传
`imgconvert-windows-x64-msix-submission` artifact。两者均未创建 Partner Center submission。

- key parity / missing key 测试
- `check:ui-i18n` 接入 `quality:frontend`
- Playwright 语言切换 smoke
- Windows MSIX 真实 runner smoke
- 重建 Store submission 包

#### Phase 5 仓库内实施契约（2026-08-19）

- `tests/i18n.test.ts` 必须继续比较两份 locale 的完整 leaf key 集合；
  `quality:frontend` 必须继续执行 Vitest 和 `check:ui-i18n`，防止新增或遗漏
  `zh-CN` / `en-US` key 只在一侧出现。
- Playwright 必须显式设定浏览器 context locale，不能依赖执行机语言；smoke 至少验证中文
  初始首屏、Topbar 语言按钮切至英文后的 title/主操作文案，以及切回中文后的同一用户可见
  状态。这样覆盖真实的 OS/browser locale 初始化和持久化前切换路径。
- `windows-smoke.yml` 的手动 `store_msix` 路径是 Windows hosted 真实 runner smoke 的 repo
  入口：必须使用 `windows-latest` 标准 hosted runner、临时 `ImgConvert.DevSmoke` identity、
  `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` 和 `IMGCONVERT_DISABLE_UPDATER=1`，并按顺序运行
  `release:windows:msix` 与 `release:windows:msix:smoke`。静态 platform guardrail 必须守住
  这些标记；此 smoke 不得发布或创建 Partner Center submission。
- `Windows Store MSIX` workflow 只重建并上传 submission artifact。下载 artifact、录入
  Partner Center、IARC 和提交仍是账户负责人执行的外部动作，不能由仓库 QA 自动代替。

## 9. 排期

| Phase | 预估 | 说明 |
| --- | --- | --- |
| 1 基础设施 | 0.5 天 | 合理 |
| 2 前端迁移 | 2 天 | `state.svelte.ts` 是主要工作量 |
| 3 Rust 错误码 | 4 天 | 结构化错误与 command 签名改造，预留 buffer |
| 4a Store/隐私 | 1 天 | 不阻塞发布 |
| 4b docs-site 英文 | 2 天 | 独立排期，不阻塞发布 |
| 5 QA/发布 | 0.5 天 | 含真实 Windows runner |

发布阻塞合计：`1 + 2 + 3 + 4a + 5 ≈ 8 天`；4b 已于 2026-08-19 单独完成。
