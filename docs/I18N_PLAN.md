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
2. 先用同步可得值决定首屏语言：
   - Tauri：`@tauri-apps/plugin-locale` 的 OS locale
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
- 接入 `@tauri-apps/plugin-locale`
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

- Partner Center 中文 / English listing
- 隐私政策中英双语
- 截图说明中英双语
- 明确不做 MSIX 包内 MRT 本地化

### Phase 4b：docs-site 英文站（独立，不阻塞发布）

- Fumadocs i18n 结构与英文内容
- 首页、安装、使用、隐私、排障优先

### Phase 5：QA 与发布

- key parity / missing key 测试
- `check:ui-i18n` 接入 `quality:frontend`
- Playwright 语言切换 smoke
- Windows MSIX 真实 runner smoke
- 重建 Store submission 包

## 9. 排期

| Phase | 预估 | 说明 |
| --- | --- | --- |
| 1 基础设施 | 0.5 天 | 合理 |
| 2 前端迁移 | 2 天 | `state.svelte.ts` 是主要工作量 |
| 3 Rust 错误码 | 4 天 | 结构化错误与 command 签名改造，预留 buffer |
| 4a Store/隐私 | 1 天 | 不阻塞发布 |
| 4b docs-site 英文 | 2 天 | 独立排期，不阻塞发布 |
| 5 QA/发布 | 0.5 天 | 含真实 Windows runner |

发布阻塞合计：`1 + 2 + 3 + 4a + 5 ≈ 8 天`；4b 后续单独完成。
