# Web 转换器移动端验收门禁

> 自动化移动模拟：通过
>
> 移动 Safari / Android Chrome 真机：待执行
>
> Production：真机记录填写完整并评审前不得放行

## 1. 自动化预检

本地构建后执行 Pixel 7/Chromium 与 iPhone 13/WebKit 的移动设备模拟：

```bash
pnpm run web:app:e2e:mobile
```

对 Cloudflare Pages Preview 执行同一组预检：

```bash
IMGCONVERT_WEB_PREVIEW_ORIGIN=https://<branch>.<project>.pages.dev \
  pnpm --dir web-app test:e2e:mobile
```

该预检验证：

- 上传后队列回执自动进入可视区域，并保持“上传区 → 队列 → 设置”的阅读顺序；
- 页面没有水平溢出，实际 WebP 转换和下载完成；
- 转换期间没有跨源请求或未处理的页面异常；
- 两个项目串行执行，避免 WASM 编码器争抢测试宿主资源。

Playwright 的设备配置只模拟视口、触控与浏览器引擎参数。桌面 WebKit 不是 iOS Safari，桌面
Chromium 也不是 Android Chrome，因此该命令不能替代真机内存、进程回收和系统下载行为验收。

## 2. 必须覆盖的真机

至少记录以下两类物理设备；具体型号以产品计划支持的最低配置和一个当前代表配置为准：

| 平台 | 最低覆盖 | 代表覆盖 |
| --- | --- | --- |
| iOS/iPadOS | 计划支持的最低系统、最低内存设备上的 Safari | 当前稳定版 Safari 的代表设备 |
| Android | 计划支持的最低系统、最低内存设备上的 Chrome | 当前稳定版 Chrome 的代表设备 |

每条记录必须包含设备型号、可用内存、系统版本、浏览器完整版本、Preview Deployment ID、Git
commit 和测试日期。不能用模拟器、桌面设备模拟或浏览器窗口缩放代替。

## 3. 真机步骤

1. 清除站点数据，打开已冻结 commit 对应的 Cloudflare Pages Preview。
2. 使用自有或明确许可的 JPEG、PNG、WebP、AVIF 测试图，依次覆盖 4、8、12、16、24 MP；每个
   候选预算至少连续转换三次，并覆盖 WebP、PNG、JPEG、AVIF 输出。
3. 对通过的最大档位验证预览、单文件下载、取消后重试、批量队列和清空队列；操作期间页面必须
   保持响应，不能出现系统强制刷新、标签页崩溃、空白结果或无法回收的持续增长。
4. 复核 SVG 和 PDF 的一条正常输入、一条超限输入；超限任务必须在重型解码/渲染开始前给出可操作
   的拒绝提示。
5. 完成一次在线加载后切换飞行模式，重新打开已缓存应用并完成一次允许预算内的转换和下载。
6. 通过 Safari Web Inspector 或 Chrome 远程调试确认用户文件名和内容没有发往站外；记录控制台、
   页面崩溃或系统内存警告。
7. 如果某一档失败，把运行时像素上限降到此前在所有必测真机上均连续通过的档位，更新中英文提示、
   单元测试和 E2E，再从新的 Preview 重跑。不得仅依据 `navigator.deviceMemory` 或 UA 猜测预算。

## 4. 放行记录

| 设备与浏览器 | Commit / Deployment | 连续通过的最大档位 | 超限提前拒绝 | 离线 | 下载 | 无崩溃/异常增长 | 结论 |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| iOS Safari | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |
| Android Chrome | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |

Production 放行要求：两行均填写实际设备信息并通过，最终运行时像素上限不高于两类设备共同通过的
最低档位，复审人确认记录与对应 Preview commit 一致。
