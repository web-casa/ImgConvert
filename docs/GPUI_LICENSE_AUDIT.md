# GPUI 许可全文与原生 NOTICE 复核（S11 + L6）

## 范围与再生成

GPUI 使用自己的 `apps/gpui/Cargo.lock` 与实际 workspace，而不是复制 Tauri/npm 清单。`pnpm run license:gpui` 固定 cargo-about 0.9.0，复用 `src-tauri/about.toml` 的许可策略，生成 `apps/gpui/THIRD_PARTY_LICENSES.md` 和 `apps/gpui/licenses/inventory.json`。应用直接编译嵌入前者，不需要联网或仓库目录。`pnpm run license:gpui:verify` 比较完整生成物，已接入 `license:check` 与 Security And Licenses CI。

覆盖采用 `cargo tree --workspace --all-features --target all --edges normal,build,dev` 的实际启用依赖图，逐项要求 cargo-about 有对应许可文本。它保守包含所有目标、可选 updater、工作区 build/dev 依赖；不代表每个条目都进入每个发布二进制。不能直接拿 cargo metadata 的全部 resolve nodes 作构建图：其中还会保留传递包未使用的 dev/optional feature 依赖。生成物不含本机路径或时间戳，清单记录包版本、声明许可、作者、仓库、全文哈希与补充文本哈希。

cargo-about 在离线模式下只扫描锁定包的实际文件，避免远端识别服务影响复现。首次 Cargo 解析可下载锁定包；运行时的许可页没有网络请求。部分上游 crate 没有打包独立 LICENSE，cargo-about 会提供 SPDX 标准全文；清单保留其声明作者、版本和仓库。已额外保留这些包现有的 LICENSE/COPYING，以及精确上游提交的补充文本（`licenses/upstream/sources.json` 记录 URL 和 SHA-256）。不得根据作者元数据臆造版权年份或许可证授权声明。上游缺少独立文件的旧包装包仍按其发布的 Cargo 许可声明列示，不把标准文本冒充上游版权文件。

## 原生库与资源核查

下表对应脚本中强制存在的来源文件。版本、全文哈希在生成清单中，升级或删除依赖必须重新核查；所有实际打包的根 NOTICE 另行自动保留。

| 组件 | 包中实际文本 | 复核结论与边界 |
|---|---|---|
| mozjpeg / libjpeg-turbo / IJG | `mozjpeg-sys/LICENSE` | 保留完整作者、IJG、Turbo BSD 条件与命名约束；不是只列 Rust wrapper 的 SPDX |
| libwebp | `libwebp-sys/vendor/COPYING`、`PATENTS`、`AUTHORS` | 保留 Google/WebP 作者、BSD 条件、免责与专利文本 |
| libavif | `libavif-sys/libavif/LICENSE` | 保留实际 BSD-2 原文；wrapper 的标准模板不替代 C 库版权 |
| rav1e | `rav1e/LICENSE`、`PATENTS` | 保留 BSD 及 AV1 专利文本 |
| libaom | `libaom-sys/vendor/LICENSE`、`PATENTS` | 保留 AOM 版权、BSD 条件与 AV1 专利文本 |
| libyuv、x86inc、vector、fastfeat | libaom 源树各 `third_party/*/LICENSE` | 保守保留源树许可。libavif 的构建脚本显式禁用 libyuv 查找，libaom 禁用工具/测试；不据该源树清单声称每个子组件均被链接 |
| dav1d | `libdav1d-sys/vendor/COPYING`、`vendor/doc/PATENTS` | 保留实际 BSD 与专利原文 |
| LittleCMS | `lcms2-sys/vendor/LICENSE` | 保留实际 MIT 作者与条件 |
| libdeflate | `libdeflate-sys/libdeflate/COPYING` | 保留实际 C 库版权与 MIT 文本 |
| FreeType | `freetype-sys/freetype2/docs/FTL.TXT` | 保留 FTL 许可及所要求的 FreeType 归属；Linux 系统字体运行时与最终包的动态库封装仍需 G4/G5 包审计 |
| ring / BoringSSL / fiat | ring 的 `LICENSE`、`LICENSE-BoringSSL`、`LICENSE-other-bits`、`third_party/fiat/LICENSE` | 保留 vendored 加密实现的组合许可 |
| Lucide / Feather 图标 | `gpui-kit-assets/LICENSE-LUCIDE` | 保留 ISC 版权及 Feather 派生列表；该文件不会由 assets crate 的 Apache SPDX 自动替代 |

Kit Assets 当前只启用应用使用的图标；示例字体不由应用引入。项目自己的 Apache-2.0 LICENSE 与 NOTICE 也完整嵌入。原生系统框架（ImageIO、WIC、CoreText、DirectWrite 等）不是本片新增分发物；最终 DMG、MSIX、AppImage/Snap/Flatpak 中实际打包的系统动态库、签名和商店验收继续属于 G3/G4/G5，不以本片替代。

## 应用内验收

隐私页显示仓库现有中英文政策的离线副本，语言变化会刷新当前政策；许可原文不翻译。两页使用 Kit 标准只读多行文本控件，可选择、复制、滚动，Escape/关闭按钮由标准 Dialog 管理。支持链接只有用户点击才在默认浏览器打开。页内没有自动访问网络、扫描文件、清缓存或改变设置的操作。

真实组件 UI 测试核对：完整政策和完整许可尾部可复制，键入/删除/粘贴不改变政策，不向背后队列导入，最小窗口下正文和关闭按钮可达，中英文切换、Escape 及关闭后的焦点恢复。负向验证和最终 CI 证据记录于本片 PR。此记录不关闭 G1/G2/G3 或最终发布门槛。

本片验收结果：GPUI 72 项通过（shell 22 项 UI，app-settings 另有真实正文滚动/缩放测试），隐私键盘流程以 SEED=7 复跑通过。许可正向复现及完整 license:check 通过；临时破坏图标归属时 --check 明确报生成物过期，恢复后再次通过。core.autocrlf=true 的真实 checkout-index 模拟验证 22 份文档/来源文件保持 LF 且逐字节相同。支持链接采用有键盘语义的 Base Link，并以局部动作覆盖 Dialog 的默认 Enter；正文只读 Tab 动作转发标准焦点遍历。首轮 Codex 2P2/1P3 已修，两次复核无新增 P1/P2/P3。原始记录在本地 artifacts/reviews/codex-s11-*，CI 证据在 PR。

## macOS IME 源码覆盖的归属复核（2026-10-19）

默认 GPUI 构建使用 `apps/gpui/vendor` 中三个 Apache-2.0 包 `gpui-pre` / `gpui-pre-macos` 0.3.8 与 `gpui-base` 0.7.1 的运行时源码覆盖。319 个保留文件包括原始 `LICENSE-APACHE`、`Cargo.toml.orig`、运行时代码与 Windows 构建资源；未复制整个 Kit 框架或无关示例/媒体。版本、原始归档 SHA256、差分及完整文件清单由 `patches/gpui-ime-focus` 固定；`verify.py --archives` 逐字节重建来源，正常 Cargo metadata 验证实际选中路径。上游报告和删除条件见 `GPUI_PATCHES.md`。

启用后重新执行 `pnpm run license:gpui:verify` 通过：898 个依赖包、210 份许可正文、281 份补充文本，生成物逐字节不变。来源覆盖没有新增依赖版本或许可；最终发布物的渠道签名与包审计仍按 G3/G4/G5 执行。
