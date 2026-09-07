# Snapcraft / Snap Store

官方资料核对：2026-09-05；构建前复核 Snapcraft、base 和 extension 支持组合。

## 构建

区分 `base`、`confinement`、`grade`、产品 `version`、Store revision 与 channel。`grade: stable` 不意味着已发布 stable；不同架构记录各自上传 revision。

读取实际 lifecycle 和 extension 展开内容。对 Tauri 直接使用 Cargo 构建时确认前端嵌入与 production custom protocol。若 extension 注入环境导致 host-linked 工具 libc 冲突，按证据限定清理阶段，不把构建 workaround 传播到全部运行时。

检查 snap 内部的元数据、ELF 架构、命令、desktop entry、图标、动态库、权限和生产 UI。没有 `--artifact` 的源码规则检查不能当作最终包检查。

## strict 下的用户路径

`home` 主要面向用户 home 下非隐藏文件；`removable-media` 默认不自动连接。portal 提供用户选择文件的授权，能覆盖隐藏文件或外接盘场景；不要从输入文件可读推导父目录可写。

测试输出目录选择、拒绝、取消、只读目录、外接盘未连接/已连接和真实桌面 session。不要把 `snap install --dangerous` 与 `--devmode` 混淆：前者用于本地未 assertion 验证的包，后者放宽 confinement，不能用于证明 strict 验收。

有限的转换 smoke 要求明确成功退出与输出校验，超时就是失败/未完成。若允许某项可选 interface 连接失败，报告该功能未覆盖，不宣称整个权限矩阵已通过。

## 分发

先使用 build-only 和可恢复测试环境，再在已有授权下上传 edge。验证 Store 安装/refresh 后提升已测试的各架构 revision 至 candidate/stable，避免无故重建改变字节。渐进式发布前查询当前 channel map 与工具帮助。

凭据限制 snap、ACL 与渠道，设置适当有效期，不提交 export-login 文件。公开 metadata 更新和 revision release 都是外部写操作；仅要求文档或 review 时不执行。

对更新和回滚分别考虑程序 revision 与数据迁移兼容性，不能承诺切回旧渠道就恢复所有用户状态。

## 官方入口

- [项目字段](https://documentation.ubuntu.com/snapcraft/latest/reference/project-file/snapcraft-yaml/)
- [Bases](https://documentation.ubuntu.com/snapcraft/latest/reference/bases/)
- [Confinement](https://documentation.ubuntu.com/security/security-features/privilege-restriction/snap-confinement/)
- [安装模式](https://snapcraft.io/docs/explanation/snap-development/install-modes/)
- [home](https://snapcraft.io/docs/reference/interfaces/home-interface/)
- [removable-media](https://snapcraft.io/docs/reference/interfaces/removable-media-interface/)
- [Portals](https://snapcraft.io/docs/explanation/snap-development/xdg-desktop-portals/)
- [revision 与渠道提升](https://documentation.ubuntu.com/snapcraft/latest/how-to/publishing/manage-revisions-and-releases/)
