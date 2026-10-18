# GPUI 壳的设置文件路径（迁移方案 §3.5）

状态：2026-10-17 首次核实，依据源码而非实机；各渠道实机核对项见文末。

## Tauri 版实际写在哪里

Svelte 壳通过 `tauri-plugin-store` 打开 `load("settings.json", { autoSave: 300 })`
（`src/lib/state.svelte.ts`）。插件把相对路径解析到 `BaseDirectory::AppData`
（`tauri-plugin-store 2.4.3`，`src/store.rs`），Tauri 2 的 `app_data_dir` 是
`dirs::data_dir()/<identifier>`（`tauri 2.12.1`，`src/path/desktop.rs`），
identifier 为 `com.ivmm.imgconvert`（`src-tauri/tauri.conf.json`）。

方案 v0.7 的 §3.5 表把 Linux 写成 `$XDG_CONFIG_HOME`，这是错误的：Tauri 用的是
**data** 目录，不是 config 目录。macOS 与 Windows 上两者相同，Linux 上不同。

| 渠道 | `dirs::data_dir()` | 实际文件 |
| --- | --- | --- |
| macOS 直发 | `~/Library/Application Support` | `~/Library/Application Support/com.ivmm.imgconvert/settings.json` |
| MAS | 沙盒容器内的 `Library/Application Support` | 同相对路径，容器由 bundle id 决定 |
| Windows 直发 | `%APPDATA%`（Roaming） | `%APPDATA%\com.ivmm.imgconvert\settings.json` |
| MSIX | 同上；AppData 是否被虚拟化待实机核实 | 同上 |
| Linux deb/rpm/AppImage | `$XDG_DATA_HOME`，默认 `~/.local/share` | `~/.local/share/com.ivmm.imgconvert/settings.json` |
| Snap/Flatpak | 沙盒 home 内的 `$XDG_DATA_HOME` | 同相对路径 |

## GPUI 壳如何解析

`crates/imgconvert-platform/src/paths.rs`（经 `imgconvert_backend::paths` 导出）：

- `app_data_dir()` = `dirs::data_dir()/com.ivmm.imgconvert`，与 Tauri 同一 crate、同一函数。
- `settings_file()` = `<app_data_dir>/settings.json`。
- `instance_lock_file()` = `<app_data_dir>/instance.lock`。

同目录下 GPUI 壳还会产生：

| 文件 | 作用 |
| --- | --- |
| `settings.json.pre-gpui` | GPUI 壳首次写入前对 Tauri 文件的一次性备份（先复制到 `.pre-gpui.tmp` 再 rename 发布，不会留下半截备份），之后不再覆盖；降级到 0.3.x 前恢复它 |
| `settings.json.tmp` | 原子写入的临时文件（写满并 `fsync` 后才 rename）；下次启动时若它是完整 JSON 对象且不早于主文件则补做 rename，否则视为半截写入删除 |
| `settings.json.lock` | `fd-lock` 文件锁，序列化 GPUI 壳自身多实例的写入 |
| `settings.json.corrupt-<unix 秒>[-n]` | 解析失败时移走的原文件（同一秒内第二个文件追加 `-n`，不覆盖），随后用默认值启动 |
| `instance.lock` | 单实例标记。持有者在整个生命周期内对它保持操作系统独占文件锁（`File::try_lock`：Unix `flock`，Windows `LockFileEx`），进程结束（含崩溃）即释放，因此不依赖 pid 存活判断，也没有 pid 复用问题；获取是原子的，两个同时启动的进程不会都成功。文件内容 `{ pid, flavor, version }` 只用于"已在运行"提示（Windows 上独占锁会挡住读取，提示降级为不带版本号）。文件从不删除：删除一个别人已打开的文件会让对方锁住孤儿 inode。任何持有者（同一 flavor 也算）存活时，新进程只显示"已在运行"窗口，且设置只留在内存、不碰共享文件 |

## 读写规则（已实现，`crates/imgconvert-platform/src/settings.rs`）

- 读：整个 store 文档读入，`settings` 键经 `normalize` 修复（`normalizeSettings`、
  `normalizePersistedOutputSuffixSettings`、`normalizePersistedConversionPolicySettings`、
  `normalizeCustomWorkflowPresets`、`normalizeWorkflowSnapshot` 的移植，TS 用例已改写为
  Rust 单测）。顶层其他键与 `settings` 内未知键原样保留并回写。
- 写：`settings.json.lock` 上锁（最多等 500 ms，超时报错而不是卡住前台）→ 首次备份 → 临时文件写入并 `fsync` → rename。
- 自动保存：GPUI 壳在最后一次修改后 300 ms 合并写入，连续修改最长 2 s 必写一次；
  退出（`Quit` action 与 `on_app_quit`）时同步 flush。
- 写入失败：错误保存在 `SettingsModel::last_error`，工作流面板状态区以危险色显示
  "设置无法保存"，记录保持 dirty 等待下次写入。
- 读取失败（文件存在但读不了，不是"不存在"）：本次会话用默认值运行且**不持久化**，
  面板显示错误；这样瞬时读错误不会把用户的配置覆盖成默认值。
- JS 语义对齐：字符串 trim 用 ECMAScript 的空白集合（不含 U+0085，含 U+FEFF），
  `slice(0, n)` 按 UTF-16 单元截断，`Math.round` 的负半值向 +∞，
  `conversionPolicyVersion` 用数值相等（`2.0` 也算 2），`String(["webp"])` 视为 `webp`。

## 尚待实机核对

- MSIX：`%APPDATA%` 是否被虚拟化到包目录（方案 §3.5、§8）。
- Snap/Flatpak：`$XDG_DATA_HOME` 在沙盒内的实际值，以及 0.3.x 与 GPUI 包是否落在同一 home。
- 0.3.x 过渡版的锁接入见 `src-tauri/src/startup.rs`：Tauri 在缓存清理、插件注册和 WebView 创建前取锁，flavor 为 `tauri`、version 为包版本，由 app state 持有到退出。占用时（含同 flavor）只启动没有 WebView、store 插件和 IPC 的原生提示框，关闭后退出；不读写共享设置。无法解析数据目录或取锁发生 IO 错误时也停止启动：Tauri store 没有 GPUI 的“仅内存设置”模式，不能保证未持锁启动不会写盘。两壳安装件的互斥/崩溃恢复端到端验收仍待 R2；代码接入不等于 G1 已关闭。
