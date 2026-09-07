# ImgConvert Chromium extension

This workspace contains the Manifest V3 extension for Google Chrome and Chromium Microsoft Edge.
The toolbar action opens a responsive browser side panel by default; its Full screen control opens
an independent workbench tab. Both surfaces use the Web converter's current Softlab visual language.
EXT-005 adds an image-only HTTPS context menu to the EXT-004 local conversion workbench. EXT-006
adds deterministic preference migration, update-only transient cleanup, offline startup/runtime
verification, and per-vendor bundle reports. EXT-007 added browser-identity evidence, Chrome/Edge
vendor matrices, keyboard/axe checks, an exact 24 MP resource-recovery gate, and the historic
Chromium 102 floor; Side Panel support now sets the current minimum to Chromium 116. A selected web
image is handed only to the side-panel workbench as one bounded, expiring descriptor;
the workbench asks for that exact scheme/host/port, performs one credential-free bounded read,
removes a newly granted permission after completion or interruption, and then sends the memory-only
`File` through the same queue and byte-probing runtime. A URL-free permission lease is kept in
restricted local extension storage only until cleanup, so an unexpected browser restart can finish
removing access without persisting the selected image URL. EXT-008 prepares the bilingual store draft and reviewed assets. EXT-009 adds
fail-closed production-dependency, privacy-deployment, current-build vendor-prompt, and final-candidate
evidence without uploading to either store.

The header wordmark and compact footer provide explicit links to the official website, localized
documentation and privacy policy, desktop downloads, and source repository. They open only after a
user click, in a separate tab, with `noopener`, `noreferrer`, and a no-referrer policy. These links
load no remote code into the extension and add no extension permission; the manifest's
`homepage_url` points to the same canonical website.

## Requirements

- Node.js 22.13 or newer (or Node.js 24)
- pnpm 10.34.4
- Chrome/Chromium for local smoke; Microsoft Edge for the Edge vendor smoke
- OpenSSL for the HTTPS-only web-image permission smoke fixture

## Commands

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run guardrails
pnpm run bundle:report
pnpm run zip
pnpm run smoke:chrome
pnpm run smoke:chrome:offline
pnpm run smoke:chrome:update
pnpm run smoke:minimum:chromium
pnpm run smoke:vendor:chrome
pnpm run smoke:vendor:edge
pnpm run smoke:web-import:chrome
pnpm run smoke:web-import:chrome:deny
pnpm run smoke:web-import:edge
pnpm run smoke:web-import:edge:deny
pnpm run store:prepare
pnpm run store:audit
pnpm run store:privacy:verify -- --base-url=https://example.pages.dev --environment=preview --deployment-id=<uuid> --report=.output/reports/privacy-preview.json
pnpm run store:finalize -- --deployment-id=<production-uuid>
```

When testing a replacement ZIP, extract it into a new empty directory and click Reload on the
unpacked extension (or remove the old unpacked entry and load the new directory). Do not merge a
new ZIP over an older extracted build: hashed chunks from the old build can remain on disk, and
Chromium does not reload changed unpacked files automatically.

The checked Chrome and Edge ZIPs are attached to the same draft GitHub Release as the desktop
installers by `browser-extension-release-assets-finalize.yml`. The Release remains a draft until
the complete desktop and extension matrix plus merged checksums passes the publication gate. These
GitHub ZIPs support manual installation; they do not imply Chrome Web Store or Edge Add-ons review.

The smoke test loads `.output/chrome-mv3` as an unpacked extension, verifies the configured Side
Panel behavior/path, checks 320, 400, and 480 px panels with no horizontal overflow, verifies every
official link and its safe new-tab attributes, then checks the Full screen link,
then verifies that normal startup does not load codec assets, converts a two-file batch through the visible UI, verifies preview, WebP/ZIP
downloads, preference persistence, page-memory queue cleanup, and the 375 px layout, then runs the
packaged 8 × 4 conversion matrix and 32-entry ZIP check. Set
`IMGCONVERT_CHROMIUM_EXECUTABLE` to override the local Chromium binary. For Edge, run
`pnpm run smoke:edge` with `IMGCONVERT_EDGE_EXECUTABLE` set. On a headless Linux host, wrap the smoke
command with `xvfb-run -a`.

The minimum/vendor commands additionally run keyboard plus axe checks and generate/convert a
6000 × 4000 PNG. When local Linux process-tree RSS is available, the test requires at least 128 MiB
to be reclaimed after removal/reload and no more than 192 MiB to remain over the pre-import baseline.
Each JSON report records the executing product/version, runtime identity, exact build fingerprint,
capabilities, accessibility evidence, and resource measurements. Use `--expected-major=<number>` on
the underlying `scripts/smoke-unpacked.mjs` command when recording a frozen release candidate.

The offline smoke starts from a fresh profile, switches the browser context offline before opening
the workbench, and repeats the visible conversion plus packaged 8 × 4 runtime matrix. The update
smoke installs the previous patch version as a fixture and then loads the current build from the
same absolute path and profile, proving the extension ID is unchanged, valid settings survive the
v1→v2 storage migration, extra content-shaped fields are removed, and no remote request occurs. Corresponding
`smoke:edge:offline` and `smoke:edge:update` commands require a native Edge executable.

`guardrails`/`bundle:report` writes `.output/reports/chrome-bundle.json` and
`.output/reports/edge-bundle.json`. Each report includes the manifest summary, budget headroom,
background dependency graph, initial converter assets, and every packaged file's byte size and
SHA-256. Reports are generated build evidence and remain outside source control.

`pnpm run smoke:native:chrome` (under `xvfb-run -a` on a headless Linux host) opens two
**native** side panels and checks per-window handoff, lease registration, and cleanup on close.
This complements the ordinary smoke's tab-hosted layout tests. Native Chromium side-panel
messages may omit both `sender.tab` and `sender.documentId`, while `runtime.getContexts()`
returns `windowId: -1`; background window routing consequently trusts this extension's exact
side-panel page's `windows.getCurrent()` result. It is not independent window authentication.

The two web-import smoke commands open a native optional-permission prompt and require a real Allow
or Deny choice respectively. They verify that no request occurs before consent, denied access sends
no request, an allowed request contains no Cookie/Authorization/Referer, the one-time descriptor is
removed, and a newly granted origin permission is removed after import. The regular offline smoke
also keeps simultaneous full-screen and side-panel surfaces isolated and verifies that dismissing a
prepared handoff removes its URL-free lease. Equivalent Edge commands are available and require a
native Edge executable.

`store:audit` binds the canonical npm audit result and an OSV query of the extension's exact
production graph to the current lockfile. The privacy verifier opens both localized pages in a real
browser and records HTTPS, status, CSP, response-header, visible-copy, and HTML-hash evidence.
`store:finalize` first reruns `store:check`, then requires the four current-fingerprint vendor reports,
the current-lockfile dependency report, and a passing canonical production privacy report. It writes
only local `final-evidence.json`; listing creation, upload, submission, and publication remain separate
account-owner actions.

## Permission boundary

The manifest declares `storage`, `contextMenus`, and `sidePanel`, plus an optional HTTPS host
candidate. It never
holds required host access: the visible button requests only the selected image URL's canonical
scheme/host/explicit port. The background does not fetch or convert. It stores at most one 8 KiB,
two-minute descriptor per window in `storage.session`; consumption removes the
descriptor before returning it. Image bytes, base64, results, and queue history never enter extension
storage. `data:`, `blob:`, browser/file URLs, direct IP literals, and local/non-public hostnames fall
back to local file selection. Known wildcard DNS aliases that map labels to private or loopback
addresses (`nip.io`, `sslip.io`, `localtest.me`, `lvh.me`, and `vcap.me`) are rejected as well.
Redirects are rejected, and response bytes are capped at 32 MiB before
the existing format/pixel/safety probe runs. There is no popup, content script, page DOM access,
remote code, credentialed request, or background conversion runtime.

Ordinary official-site links are navigation, not converter dependencies: no website request is
made during extension startup or conversion, and no file, result, preference, or page context is
attached when a user explicitly opens one. Each external link suppresses its opener and referrer.

The browser owns Side Panel placement and width, so the extension cannot force an exact right-hand
25% layout. Users can choose the browser's panel side and drag its divider. ImgConvert supports the
practical 320–480 px panel range and keeps the full-screen tab as a separate memory-only session;
files and results are never persisted merely to move between surfaces.

Hostname checks do not resolve DNS and therefore cannot prove that a public-looking hostname will
never resolve or rebind to a private address. The extension does not request the `dns` or
`webRequest` APIs and does not disable browser Private Network Access protections; this residual is
kept explicit rather than represented as complete private-network blocking.

The exhaustive 8×4 codec self-test is compiled only into a separate diagnostics build used by the
browser smoke harness. Production/store builds contain neither its URL trigger nor its diagnostics
module, and `guardrails` rejects either marker if it reaches a production bundle.

The preference payload remains product schema v1, while its WXT storage container is version 2.
Migration is idempotent on background/workbench startup, preserves only validated non-content
settings, and canonicalizes away unknown fields. An extension-version update also removes only the
owned converter-tab and pending-import session keys; it does not clear preferences, permissions, or
unknown storage keys.

## Runtime boundary

`@imgconvert/web-conversion-runtime` owns queue admission/probing, batch-export planning, codec
adapters, archive protocol/scheduler, filename rules, and Worker execution functions shared with the
Web app. WXT owns only the extension view, preference adapter, static Worker asset factories, and
entrypoints. Normal startup creates no Worker and loads no codec or WASM asset; the selected work
loads only when conversion or ZIP export begins.

The converter shares the Web retained-output budget: 128 MiB per PDF and 256 MiB across the
queue. Partial PDF results remain downloadable; pages skipped for lack of capacity are listed
as failures. Download and remove completed items, or select fewer pages, before retrying.
