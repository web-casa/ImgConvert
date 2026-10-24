# GPUI 功能清单核对（S12 + R10）

核对日期：2026-10-19。基线是 `src/lib/state.svelte.ts`、`src/lib/command-error.ts` 与 `src/lib/components/FormatSelect.svelte`。GPUI 直接调用共享 Rust 服务，不保留 Tauri IPC 名称。以下“覆盖”表示功能入口与契约已对照；自动测试、静态核对和需要真实平台的验收分别记录。

## 17 个生产命令

`state.svelte.ts` 使用 17 个生产命令；`desktop_e2e_seed` 是额外测试入口，不计入。Tauri 注册表另有 perf probe 入口，也不属于该生产状态机。

GPUI 路径均以 `apps/gpui/crates/` 为根。

| Tauri 命令 | GPUI 对应入口 | 验证证据与边界 |
|---|---|---|
| `capabilities` | `workflow/src/settings_form.rs`、`workflow_panel::writable_formats` | writable/lossless/ICC 使用同一个 backend 能力表；逐项格式 UI 测试确认 HEIC/PDF 不可作为输出 |
| `codec_diagnostics` | `diagnostics/src/plugin_diagnostics.rs::refresh` | `plugin_diagnostics_dialog_probes_and_edits_the_helper`；各平台探测实现仍在 platform |
| `set_selected_heic_helper` | 同文件 `set_helper_path` | picker、选择/清除、设置持久化与重探测；失败显示本地化消息；Windows WIC 人工显示核对仍属 R7/G4 |
| `file_access_runtime` | `workflow/src/workflow_panel.rs::start` | 调用共享 `access::runtime_file_access`；macOS 保存路径不能代替本次会话选择，路径更改后旧授权失效；纯逻辑矩阵测试。原生 MAS 授权仍属 R11 |
| `pick_paths` | `shared/src/file_prompt.rs` | Kit 原生选择器，导入允许多个文件/目录、输出仅一个目录、helper 仅一个文件；options 单测与既有选择器 UI 测试。系统取消/不可用均返回 None；具体 OS picker 错误分类没有独立 UI，纳入 G2/G4 原生验收 |
| `scan_import_paths` | `queue/src/import.rs::import_paths` | 真实 PNG/PDF 导入测试核对元数据；缺失路径与扫描上限不再静默。错误数量、跳过数量、上限和取消分别展示；每项错误细节 UI 与 Tauri 的展开列表不同，当前为汇总 |
| `cancel_import_scan` | 同文件 `cancel_import`；clipboard 共用注册 | Stop 到前台提交前均有效；取消丢弃本次发现，不影响已有队列；真实 Stop UI 测试、带非空部分结果/完成未提交结果的确定性提交测试及 backend 元数据探测取消测试 |
| `import_clipboard_image` | `queue/src/clipboard.rs::paste` | 位图/原生文件列表/文本路径、失败/部分成功、取消、输入框内 Paste 与模态隔离已有 UI 测试；问题类型和计数保留到渲染再翻译 |
| `cleanup_imported_temp_file` | 同文件 `cleanup`；队列 Clear/Remove | 仅 backend 注册的本进程位图临时文件可删；清空、逐项移除与取消各有 UI 测试；普通原图及扫描得到的现有托管来源不因取消被误删 |
| `generate_thumbnail` | `queue/src/thumbnails.rs`、`QueueView::request_thumbnails` | backend 缩略图、并发上限、LRU 字节预算、generation 拒绝过期结果；模型测试覆盖淘汰/清空/移除后重试；PDF 无栅格缩略图时保留文件占位 |
| `generate_comparison_preview` | `preview/src/comparison_preview.rs::refresh` | backend 生成、解码前后图、设置/逐项格式变更标记 stale、尺寸/质量/告警；真实预览 UI 测试 |
| `cancel_comparison_preview` | 同文件 `cancel` 与 Dialog 关闭/Drop | request id 丢弃迟到结果并释放图片；批次开始、项目移除、关闭均取消；原有 UI 测试。PDF 首个所选页与 Tauri 一致，逐页切换仍是 R6 |
| `plan_conversions` | `workflow/src/workflow_panel.rs::start_with_safety_checks`、`output_safety.rs` | 共享计划、覆盖询问、源文件二次确认、全部队列来源（包括 Done 项及其别名）的冲突保护；真实 Dialog 流程与陈旧计划成功/失败回写隔离测试 |
| `convert_batch` | `shared/src/progress_bridge.rs::start_batch` | shared service + 同一 ConvertOptions；完成项不参加下一批，新增项可单独转换；只重置本批状态；新 UI 回归测试保留完成项目及其字节测量，并阻止后续批次覆盖这些原图 |
| `cancel_batch` | `workflow_panel::cancel` → `progress_bridge::cancel_batch` | backend token 与 Cancelling 状态；B1a 核心转换中/提交前/缓存命中前取消测试；批次 bridge 结束前禁止下一批 |
| `clear_result_cache` | `workflow/src/settings_form.rs::clear_result_cache` | 静态核对同一 backend `result_cache::clear`、忙时禁用与后台调用；后端临时缓存单测。此次不点击清除用户真实缓存 |
| `validate_update_manifest` | `app-settings/src/service.rs`、backend/platform updater validation | S8 受控清单/SDK 兼容性演练、篡改/异架构/超限下载拒绝测试和更新对话框 Fake Driver UI；生产端点不变 |

## 状态机与文案补齐

- **错误本地化**：`shared/src/command_error.rs` 穷尽匹配共享的 24 个 ErrorCode，复用 Tauri 双语含义，校验 path/format 参数，缺失或复杂值回退 taskFailed；后端 detail 保留诊断用途，不作为用户文案。队列保留结构化错误，Error 与 Skipped 均可查看完整 tooltip，切换语言立即重译。全局格式 Select 也在队列和语言变化时同步 retained 选项，真实 UI 检查导入、移除及 Clear 后的来源标签。预览、计划/批次启动、诊断操作和清理缓存失败使用本地化反馈。
- **扫描反馈**：保留 added/skipped/errors/truncated/cancelled 原始字段，渲染时翻译；注册生命周期覆盖前台提交，取消不追加部分结果。剪贴板反馈也保留问题类型与计数，避免工作线程把某种语言固定进模型。
- **逐项移除**：域 key 作为按钮/行/状态标识，导入或批次运行/收尾时禁止；重建索引、维护缩略图预算、重置存活 Loading 项使其可重试、拒绝旧 ticket，并清理本项拥有的临时文件。Clear 仍保留独立测试。
- **完成项**：下一批仅取 `is_pending_conversion`；修改逐项格式或 Reset formats 可显式让结果重新待转换。Done 项的源信息、缩略图和环境测量不会被下一批重置。目标体积与 PDF 页范围校验也只考察此次待转换项目。来源冲突保护继续包含整个队列，计划和执行 gate 内预检都按文件身份核对，硬链接别名也不能绕过。
- **来源提示 R10**：行元数据展示来源格式；全局 Select 与逐项标准菜单在与来源一致的可写选项上显示“来源 / Source”，选中状态仍由 Kit 提供。探测失败/预算延后时与 Tauri 一样以扩展名作为提示（JPG→JPEG、HEIF/HIF→HEIC），不把提示当作已成功解码。只读来源不会因此成为输出选项。
- **PDF**：共享扫描页数/默认渲染尺寸与导入预算、页范围/DPI 校验、加密/无效/资源上限错误及多输出命名均复用 backend。`parity_pdf_import_metadata_and_source_format_menu` 真实导入仓库的最小 PDF，并核对页数与显示；已有参数表单测试覆盖页范围编辑。更深 PDF 负例由 backend `pdf`/`convert` 测试覆盖，不声称无头测试等于原生字体/HiDPI 验收。

## i18n 与 Kit zh-CN

1. TypeScript 模板 `{count}` 迁到 rust-i18n 时写为 `%{count}`，参数名与消息含义保持一致；不能直接复制括号语法。
2. `tr_with` 只扫描原始模板一次；参数中的 `%{other}`、路径或任意用户文本按字面插入，不能再次替换。重复占位符全部替换，未知/未闭合占位符保留字面，便于发现文案问题。
3. `every_app_key_has_both_locales_and_matching_placeholders` 对全部应用键验证 en/zh-CN 存在与参数集合一致，中文不能靠英文 fallback 蒙混通过。此检查发现并修正两处未加引号的 YAML `Off`（否则被解析成布尔值、运行时返回键名）。
4. Kit 固定版本 0.7.1 的 `locales/ui.yml` 静态核对：**78 个英文叶键均有 zh-CN**，包括 Select、Dialog 确定/取消、Input 剪切/复制/粘贴/全选、List 搜索及日期/颜色等控件。应用只支持 en/zh-CN，`set_locale` 同步 Kit 全局，随后刷新窗口；已有真实 UI 语言切换测试核对应用控件与表单重绘。该 78/78 是固定源码文案覆盖统计，不能代替原生辅助功能朗读验收。

## 验收范围

backend 新增带额外保护来源的计划/批次服务入口，既有调用入口继续保留；保护路径与执行任务分开传递，不向逐项 ConvertOptions/IPC DTO 填入重复队列。依赖锁文件和转换引擎保持不变；macOS/Windows 手动 Smoke 的来源保护测试过滤器增加本片回归，不构建或发布正式安装件。不操作真实设置、缓存或系统剪贴板；测试使用内存设置、GPUI TestPlatform、仓库 fixture 与 TMPDIR。根 workspace/GPUI workspace、前端和许可/文档/架构/发布/成本护栏的最终结果记录在 PR。

G1/G2/G3 仍保持开放。MAS 真实授权、VoiceOver、IME、签名双架构 DMG 与安装件 QA 需要对应环境与证据；S12 的入口覆盖表不关闭这些门槛。B2b 的动画 DTO/队列标记/计数、位深/alpha 告警仍是下一独立切片；R6/R7 等既有遗留项按开发方案推进。
