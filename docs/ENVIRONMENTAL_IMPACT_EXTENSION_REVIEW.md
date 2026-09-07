# 扩展环保功能实施与复核（ENV-004）

日期：2026-09-06。新开发版本：0.3.4。Chrome/Edge 0.3.3 候选文件保留。此次仅本地开发、构建和审核材料准备，没有上传、提交审核或发布。桌面接入 ENV-005 仍待实施。

## 实现

- 完成转换后，单文件显示实际输出大小差异；队列下方汇总合资格静态栅格结果的净变化。较大输出抵扣较小输出；文档、矢量图、动画、多输出及失败/取消任务不参与估算。
- 环保面板默认本地/未知，只提供字节事实。主动选择云存储假设后，可调整天数、副本和原图保留状态；原图仍保留时不显示正向估算，自述替换仍标为模型估算。
- 单结果和批量假设独立，批量不累加单文件面板的数字。各面板参数仅驻留当前文档内存，关闭重置、移除销毁；侧栏与完整工作区不会互相传递假设。
- 方法和来源随扩展打包，离线可读。本轮没有部署官网专题或验证其线上可用性，所以不添加依赖它的外部入口。原始资料链接固定、无任务参数，并使用 `noreferrer`。
- 把既有 Web 的资格判定及净差统计提取到纯 TypeScript 计算包；Web 保留兼容导出，扩展使用同一实现。没有修改科学模型、转换引擎、权限、CSP、存储 schema 或后台消息协议。
- 准备 0.3.4 双语商店文案、认证说明、新版本截图和 ZIP；现有 0.3.3 版本化材料不覆盖。

## Review 发现与修复

1. 首版把说明放在文件名列里，完整页面下可用宽度不足。已改为队列项独立整行，并用浏览器断言面板宽度至少达到队列项的 70%。旧粘性卡片高度还会裁掉批量控件；有结果时解除此限制，并验证批量入口可点击且不超出卡片边界。
2. Web 与扩展若各自维护资格规则容易漂移；改为共用实现，补充未知格式、失败/取消、动图、多输出、负净差及安全整数边界的模型测试。
3. 原英文认证说明为 2010 字符，超过用户提供的表单上限。重写后为 1724 字符，包含新增功能测试步骤，并在本地商店门禁加入小于 2000 字符的校验。
4. 上一阶段 Web 浏览器截图目录尚未被 Git 忽略；补入 `web-app/.output/`，避免测试截图与追踪文件进入源码提交。
5. 修复专项 smoke 脚本的浏览器全局声明和格式问题。首次格式化后仍出现链式表达式换行差异，再次使用扩展内 Prettier 3.9.4 格式化后通过检查。

## 验证记录

| 检查                           | 结果                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| 计算包类型检查、测试、构建     | 17 项测试通过                                                                            |
| Web 兼容性回归                 | 类型检查、构建、33 项测试通过                                                            |
| 扩展单元及发布证据测试         | 96 + 5 项通过                                                                            |
| 扩展类型、lint、格式、生产构建 | 通过；类型检查 0 错误、0 警告                                                            |
| 权限、CSP、远程代码及体积门禁  | 两目标通过；各 26 文件                                                                   |
| Chrome/Edge 目标生产包专项     | 两包均在 Chromium 149 通过；离线、双语、320 px、双文档隔离、状态清理、整行宽度、批量入口 |
| 环保面板无障碍                 | 两目标各 16 项 axe 规则通过，零违规；键盘开启面板通过                                    |
| 参数与网络                     | 操作前后 local/session 存储一致，两个目标均零 HTTP(S) 请求                               |
| 原生侧栏                       | Chrome 目标在 Chromium 两个原生侧栏窗口的归属与关闭清理通过                              |
| 商店草稿                       | 14 项版本化资产、双语认证说明、两 ZIP、来源清单检查通过；未上传                          |
| 文档、架构、deadcode           | 通过                                                                                     |

最终两个 ZIP 各 3,788,858 字节，SHA256 均为 `8cc106c5f87c4249972a6e1eba382e61101a306d2d624dcc836a95a9a931a21e`。0.3.3 两包仍为 `45242ff66df4da411557b47eb788273a3675f97a2fcf8cb9e758c2741fe64938`。逐项比较 0.3.3 与 0.3.4 manifest，仅版本号变化；没有增加权限。

候选目录：`browser-extension/.output/store-candidate/v0.3.4/`。商店图片：`browser-extension/store/assets/v0.3.4/`。专项报告和截图：`browser-extension/.output/reports/{chrome,edge}-environment.json`、`browser-extension/.output/reports/environment-{chrome,edge}/`。已查看修复后的真实完整页面与中文窄侧栏截图。本轮范围内已知功能问题已修复；以下发布验收边界仍然适用。

专项 smoke 在真实加载的生产扩展包上执行，覆盖双文档队列、英语/中文、完整页面/侧栏 URL、离线计算、原图保留与自述替换、空输入、关闭重置、移除、320 px 宽度和 axe 检查。操作前后比较 `chrome.storage.local/session`，检测参数是否被保存；收集 HTTP(S) 请求并要求为零。原生侧栏测试另行验证两浏览器窗口的描述符归属和关闭清理，不能将侧栏 URL 的 DOM 测试表述为原生侧栏全部环保交互覆盖。

主要复现命令：

```sh
pnpm impact:check
pnpm --dir web-app typecheck
pnpm --dir web-app test
pnpm --dir browser-extension check
pnpm --dir browser-extension store:prepare
xvfb-run -a node browser-extension/scripts/smoke-unpacked.mjs --browser=chrome --expected-product=chromium --environment --native-side-panel --offline --report=.output/reports/chrome-environment.json
IMGCONVERT_EDGE_EXECUTABLE=/usr/bin/chromium xvfb-run -a node browser-extension/scripts/smoke-unpacked.mjs --browser=edge --expected-product=chromium --environment --offline --report=.output/reports/edge-environment.json
```

## 验收范围

本机可用 Chromium 149；没有把加载 Edge 目标包的 Chromium 测试称为微软 Edge 官方浏览器验收。官方 Chrome/Edge、最低版本、真实移动设备和真人读屏测试不在本轮全部覆盖范围内。完整商店冻结仍需该新候选对应的 vendor/更新/隐私/依赖审计证据和账号操作。

本轮 review 限定环保功能及其集成，不等于对整个既有工作区、桌面 Rust 路径或所有发布管线重新做过完整审计。桌面版本仍未增加环保界面。
