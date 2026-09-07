# Chrome Web Store listing — ImgConvert

> Last updated: 2026-09-06
>
> Local candidate status: **PRE-RELEASE EVIDENCE PARTIAL — DO NOT UPLOAD OR SUBMIT**
>
> The publisher reported that Chrome rejected version 0.3.2 on 2026-09-05 with reference
> **Yellow Argon** for excessive format keywords in both locales. The corrected listing text and
> packaged summaries below belong to the local 0.3.3 candidate; this does not establish a
> resubmission or approval.
>
> EXT-008 prepared the original local draft. EXT-010 changed the manifest, launch surface, UI, and
> disclosure after EXT-009, so the previous Chrome/Edge permission-prompt evidence is now
> historical rather than release-current. A publisher must rebuild that evidence, clear the
> production privacy and account gates, and explicitly authorize any dashboard action.

## Public distribution boundary

- The website shows a disabled Chrome Web Store placeholder until review succeeds. It must not be
  changed to an active store link until the listing is approved and its canonical URL is verified.
- GitHub Releases may carry the checked Chrome and Edge MV3 ZIPs for manual installation. Those ZIPs
  are release assets, not evidence of store approval, submission, or publication.
- `browser-extension-release-assets-finalize.yml` only uploads both checked ZIPs to an existing
  draft Release and refreshes the merged checksum manifest. The complete-release publisher remains
  the only workflow allowed to clear draft state.

## Store listing

- Extension name: `ImgConvert` (matches the localized manifest)
- Category: `Photos`
- Primary language: English
- Additional locale: Simplified Chinese (`zh_CN`)
- Homepage: <https://imgconvert.web.casa/>
- Support URL: <https://github.com/web-casa/ImgConvert/issues>
- English privacy URL: <https://imgconvert.web.casa/en/privacy/>
- Simplified Chinese privacy URL: <https://imgconvert.web.casa/privacy/>
- Visibility proposal: Public, all regions; the account owner must confirm before submission
- Publisher name and contact email: **account-owner confirmation required; not inferred from Git**

### English (`en`)

Short description (96 characters; exact manifest text):

```text
Convert images locally in your browser, with batch processing, previews, and adjustable quality.
```

Detailed description:

```text
ImgConvert converts images and PDF pages on your device, in a browser side panel or a separate full-screen workspace.

FEATURES
• Choose local files or drag them into the workspace.
• Select an output format and adjust quality and dimensions where supported.
• Convert several files, preview the results, and download them individually or together in a ZIP archive.
• Remove source metadata from converted images.
• Right-click a public HTTPS image and confirm its source before granting temporary site access to import it.
• Use light or dark mode and an English or Simplified Chinese interface.
• Compare output sizes and optionally explore a cloud-storage environmental scenario with visible assumptions; estimates are not measured carbon savings.

HOW TO USE
1. Click the ImgConvert toolbar icon to open the side panel.
2. Add files, choose your output settings, and start conversion.
3. Preview and download the results.

The side panel and full-screen workspace have separate file queues.

PRIVACY
Files are processed locally and are not uploaded to ImgConvert. Imported files and conversion results are cleared when you clear or close the workspace. Language, theme, and conversion defaults are saved on your device. No account is required, and the extension includes no advertising or usage analytics.

Optional web-image import temporarily handles the address and source of the image you select. After your permission, it downloads that image from its original site without cookies or referring-page information. Newly granted site access is removed when the import finishes, the workspace closes, or the operation is interrupted; previously existing access is preserved. ImgConvert does not collect your general browsing history.

PERMISSIONS
• Storage saves your preferences and temporarily tracks your selected web image and its access permission.
• Context menus add the image conversion command to the right-click menu.
• Side panel displays the converter beside your current webpage.
• Optional site access reads the selected image only after you confirm the source.

SUPPORT
Report problems or request help at https://github.com/web-casa/ImgConvert/issues
```

### Simplified Chinese (`zh_CN`)

Short description (28 characters; exact manifest text):

```text
在浏览器本地转换图片，支持批量处理、结果预览和质量调整。
```

Detailed description:

```text
ImgConvert 在你的设备上转换图片与 PDF 页面，可在浏览器侧栏或独立的全屏工作台中使用。

主要功能
• 选择本地文件，或将文件拖入工作台。
• 选择输出格式，并按格式支持情况调整质量和尺寸。
• 批量转换文件、预览结果，单独下载或打包下载。
• 转换后的图片移除源文件元数据。
• 右键选择公开 HTTPS 图片，确认来源并授予临时站点访问权后导入。
• 支持浅色、深色主题和中英文界面。
• 查看输出大小变化，并可按明确假设探索云存储环境情景；估算不代表实际减碳。

使用方法
1. 点击工具栏中的 ImgConvert 图标打开侧栏。
2. 添加文件，选择输出设置并开始转换。
3. 预览并下载结果。

侧栏和全屏工作台分别使用独立的文件队列。

隐私说明
文件在本地处理，不会上传到 ImgConvert。清空或关闭工作台时，已导入文件和转换结果会被清除。语言、主题和转换默认设置保存在你的设备上。无需注册账号，扩展不含广告或使用行为分析。

可选的网页图片导入功能会暂存你选中图片的地址和来源。经你授权后，扩展从图片所在站点下载该图片，请求不携带 Cookie 或来源页信息。导入完成、关闭或中断后，会移除本次新增的站点访问权，保留此前已有的授权。ImgConvert 不收集完整浏览历史。

权限说明
• 存储：保存偏好设置，并暂存所选网页图片的信息与授权状态。
• 右键菜单：在图片右键菜单中提供转换入口。
• 侧栏：在当前网页旁显示转换器。
• 可选站点访问：在你确认来源后读取所选图片。

支持
如需报告问题或寻求帮助，请前往 https://github.com/web-casa/ImgConvert/issues
```

## Single purpose

ImgConvert locally converts user-selected images and PDF pages into JPEG, PNG, WebP, or AVIF in a
visible browser workbench.

## Permissions justification

| Permission / declaration | Dashboard justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                | Saves one bounded language/theme/conversion-preference record locally, holds one selected HTTPS image URL/origin for at most two minutes while handing it to the visible workbench, and tracks a URL-free temporary permission lease until newly granted exact-host access is removed. Image bytes, thumbnails, results, queue history, page content, and cookies are never written to extension storage.                                                                                        |
| `contextMenus`           | Adds the user-initiated “Convert with ImgConvert” command only to HTTPS images on HTTPS pages. Clicking it is the only way the extension receives the selected image URL and source window.                                                                                                                                                                                                                                                                                                      |
| `sidePanel`              | Keeps the complete local converter visible beside the current webpage. The toolbar action opens this browser-owned panel, and users remain free to resize or close it.                                                                                                                                                                                                                                                                                                                           |
| Optional `https://*/*`   | Makes exact-host access available for the optional web-image feature. The extension does not receive required access to all HTTPS sites: after showing the selected origin, it requests only that exact scheme/host/explicit-port pattern, performs one credential-free and no-referrer read, blocks redirects, caps the response at 32 MB, and removes newly granted access after completion, panel closure, interruption, or worker recovery without removing access that predates the import. |
| `homepage_url`           | Identifies the canonical public ImgConvert website in browser extension-management UI. It is metadata, grants no host access, and does not cause a request during startup or conversion.                                                                                                                                                                                                                                                                                                         |

No required host permission, `activeTab`, `tabs`, `scripting`, `downloads`, `offscreen`, content
script, externally connectable endpoint, or web-accessible resource is declared.

## Privacy practices answers

### Data handled

Use conservative disclosures because Chrome's User Data FAQ requires disclosure even for local
processing:

| Dashboard category                                                                                                                   | Select? | Exact handling                                                                                                                                             | Sent to ImgConvert or retained?                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web history                                                                                                                          | Yes     | The single HTTPS image URL and origin explicitly selected through “Convert with ImgConvert”; not general browsing history, page DOM, titles, or other tabs | No. The URL is held in session storage for at most two minutes and removed when claimed. A URL-free exact-host permission lease remains in restricted local storage only until access cleanup, including recovery after browser restart; the selected HTTPS host receives the normal request for its own URL. |
| Website content                                                                                                                      | Yes     | Local image/PDF bytes selected by the user and the one optional HTTPS image response                                                                       | No. Processing is in the visible workspace's memory; content is removed on clear/close and is never sent to an ImgConvert server.                                                                                                                                                                             |
| Personally identifiable information, health, financial, authentication information, personal communications, location, user activity | No      | Not accessed or inferred                                                                                                                                   | No                                                                                                                                                                                                                                                                                                            |

The extension does not sell data, use data outside its single purpose, use data for advertising or
creditworthiness, allow humans to read user content, or transfer user data to ImgConvert or a data
broker. It includes no analytics, telemetry, crash reporting, advertising, or account system.

### Remote code

Select: **No, I am not using remote code.** Every JavaScript, Worker, WASM, CSS, HTML, icon, and
locale file is packaged in the ZIP. A user-selected HTTPS image is data and is never executed.

### Limited Use statement

The source privacy pages include this disclosure for the extension:

> ImgConvert's use of information received from browser extension APIs complies with the Chrome Web
> Store User Data Policy, including the Limited Use requirements.

## Graphics and screenshots

All paths are under `browser-extension/store/assets/v0.3.3/`.

| Asset                         | Dimensions                                          | Status | Path                                                           |
| ----------------------------- | --------------------------------------------------- | ------ | -------------------------------------------------------------- |
| Store icon                    | 128×128 PNG, 96×96 artwork with transparent padding | Ready  | `shared/chrome-store-icon-128.png` and packaged `icon/128.png` |
| Screenshot 1, English/Chinese | 1280×800                                            | Ready  | `{en-US,zh-CN}/01-local-batch-converted.png`                   |
| Screenshot 2, English/Chinese | 1280×800                                            | Ready  | `{en-US,zh-CN}/02-output-controls.png`                         |
| Screenshot 3, English/Chinese | 1280×800                                            | Ready  | `{en-US,zh-CN}/03-verified-preview.png`                        |
| Screenshot 4, English/Chinese | 1280×800                                            | Ready  | `{en-US,zh-CN}/04-local-first-overview.png`                    |
| Screenshot 5, English/Chinese | 1280×800                                            | Ready  | `{en-US,zh-CN}/05-dark-workbench.png`                          |
| Small promo                   | 440×280 PNG, text-free                              | Ready  | `shared/small-promo-440x280.png`                               |
| Marquee promo                 | 1400×560 PNG, text-free                             | Ready  | `shared/marquee-promo-1400x560.png`                            |

The screenshots were captured from the actual packaged Chrome build after importing and converting
two controlled repository images. `provenance.json` binds the product icon, screenshot inputs, and
generated assets to the product version, browser identity, source hashes, and build fingerprint.
The promo assets contain only the product icon and brand geometry; they make no feature or
store-status claims.

## Reviewer instructions

Use [reviewer-notes.en-US.txt](browser-extension/store/reviewer-notes.en-US.txt) for the dashboard.
The Simplified Chinese equivalent is available beside it. No account, network service, or test
credential is required for local conversion.

## 2026-09-05 Chrome rejection correction

The publisher reports that Chrome rejected 0.3.2 for **Yellow Argon** (keyword stuffing), citing
the repeated format-name lists in the English and Simplified Chinese summaries and descriptions.
This is a report about store metadata; it does not establish the outcome of other review checks.

The local correction removes format enumerations from both packaged summaries and both detailed
descriptions. The copy now explains the task, workflow, and privacy behavior in ordinary sentences.
The matching Edge summary and local draft validator are updated together. The public description
still discloses user-selected web-image access; shortening the listing must not hide that feature.

Before resubmission:

1. Update both localized detailed descriptions on the existing Chrome listing, replacing the old
   text rather than appending a second description. Keep the product name `ImgConvert`.
2. The rejected summary is also packaged in `_locales/*/messages.json`. Use the rebuilt 0.3.3
   package under `browser-extension/.output/store-candidate/v0.3.3/`. The previous 0.3.2 ZIPs are
   historical artifacts and do not contain this correction. Upload the new package as an update to
   the existing listing.
3. Refresh the package-bound evidence and resolve the existing production-privacy verification
   gap before submitting. A text correction does not establish complete submission readiness.
4. If the dashboard provides a reviewer-note field, explain that both locales' summaries and
   descriptions were rewritten to remove repeated format lists. Do not claim this has been uploaded
   until the dashboard contains the corrected package and text.

Use concise, contextual format references only when needed to explain a feature. A keyword count
below a particular number is not a guarantee of approval. Detailed format compatibility belongs in
the documentation and converter UI; do not turn the short summary into a format index.

References: [Yellow Argon guidance](https://developer.chrome.com/docs/webstore/troubleshooting#keyword-stuffing),
[listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements),
and [package versus listing updates](https://developer.chrome.com/docs/webstore/update).

## Version history

| Version | Date       | Changes                                                                                                                                           | Status                                                     |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 0.3.4   | 2026-09-06 | Added measured output differences, optional cloud-storage scenarios, and offline methodology; no additional permissions                           | Local development candidate; not submitted                 |
| 0.3.3   | 2026-09-06 | Removed repeated format lists from both localized summaries and descriptions; regenerated the Chrome/Edge packages and store assets               | Local resubmission candidate; not submitted                |
| 0.3.2   | 2026-09-05 | Fixed settings upgrades, side-panel handoff isolation, interrupted permission cleanup, PDF validation scope, and privacy-safe official-site links | Chrome rejected (publisher report); copy corrected locally |
| 0.3.1   | 2026-09-04 | Local conversion, bounded batch export, consent-gated HTTPS image import, and a responsive side-panel/full-screen workbench                       | Local draft only                                           |

## EXT-009 evidence and remaining publication blockers

- The account owner must confirm the publisher identity and monitored contact email.
- Chrome for Testing `152.0.7977.82` and Microsoft Edge Stable `152.0.4191.62` passed the previous
  Allow/Deny matrix against fingerprint `84ef902885be28bf181ee4a43b8036c9f0e9706b6f0d2c0689b6cf135680fedb`.
  EXT-010 changed the current build, so these reports must be rerun and rebound before finalization.
- The extension's 24-package production graph has zero advisories in the recorded OSV query. The
  canonical npm endpoint has been intermittent; the final report records whether npm completed or a
  bounded timeout required the independent OSV result.
- The updated bilingual privacy disclosure passes at
  <https://ext-009-privacy-20260904.imgconvert-cis.pages.dev/>, deployment
  `1b56e7bc-e242-4c6f-bcff-78df25519ca6`. The canonical production pages still serve the previous
  copy, so production privacy verification and final candidate freezing correctly fail.
- Creating a listing, uploading a ZIP, submitting review, or publishing requires separate explicit
  user authorization.
