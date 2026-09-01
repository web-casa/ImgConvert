<!-- SPDX-License-Identifier: Apache-2.0 -->

# ImgConvert UI redesign plan

Status: reviewed and corrected implementation plan  
Reference: `/home/ivmm/jietu/099.png`  
Visual direction: [`assets/design/ui-redesign-reference-v1.png`](assets/design/ui-redesign-reference-v1.png)

## 1. Outcome

Redesign the desktop workspace around one clear sequence:

1. import images;
2. inspect and adjust the queue;
3. choose a preset or conversion settings;
4. confirm the authorized output destination;
5. convert and inspect real progress/results.

The redesign keeps the existing Svelte 5, Tailwind CSS 4, shadcn-svelte primitives,
Solar icons, Tauri commands, conversion state, accessibility semantics, dark mode, localization,
and minimum window size. It is a targeted presentation and component-structure change, not a rewrite.

## 2. What to retain from the reference

- Warm off-white surfaces, dark navy text, and one restrained coral action color.
- A compact product header with a quiet engine-ready status.
- A left content workspace and one visually unified settings surface on the right.
- Dense horizontal queue rows that make filenames, dimensions, formats, and status easy to scan.
- A fixed bottom action dock that keeps output destination, progress, and the primary action visible.
- Softer borders and restrained elevation instead of card-on-card shadows.

## 3. What not to copy

- Do not draw macOS traffic-light controls inside the webview. Native window chrome remains owned by
  Tauri/the operating system.
- Do not display predicted savings until a real estimator exists. The dock shows only measured or
  already-known state: completed count, current stage, elapsed time when available, and errors.
- Do not add queue search or sorting in the first UI pass. They are new product behavior and need a
  separate requirement once real queue-size data justifies them.
- Do not hide existing target-size, metadata, color, cache, helper, and per-format controls merely to
  match a minimal mockup. Use progressive disclosure.
- Do not merge all settings logic into a new monolithic component.

## 4. Current UI audit

### Strengths to preserve

- Existing controls map directly to typed settings and real backend capabilities.
- Keyboard focus, disabled states, reduced motion, localization, and object URL cleanup already exist.
- The fixed conversion footer correctly keeps the destructive cancel/primary action reachable.
- Per-item format overrides and exact comparison preview are already part of each queue item.

### Problems to solve

- Cool slate tokens and repeated bordered cards make the product feel generic and visually flat.
- The header gives equal weight to product identity, engine diagnostics, and several utility actions.
- The import zone consumes too much height after files have already been added.
- Queue items become isolated grid cards, which slows scanning and wastes horizontal space.
- `WorkflowSettings` and `SettingsBar` appear as separate panels even though users understand them as
  one conversion configuration.
- Basic and expert controls compete at the same visual level; the right column becomes very long.
- Batch progress is repeated above the queue and in the footer.
- The default 900x680 and minimum 720x540 windows need a deliberate compact layout, not merely a
  narrower desktop grid.

## 5. Reviewed information architecture

### Top bar

- Left: existing app icon, `ImgConvert`, compact engine status chip.
- Right: theme, language, plugin diagnostics/settings menu, update indicator when enabled, privacy,
  and legal/about.
- Keep icon buttons at least 40x40 CSS pixels and expose visible tooltips plus accessible names.
- Move “reduce motion” into the settings/utility menu; keep the setting and keyboard accessibility.

### Import surface

- Empty queue: illustrated welcome surface, 240-280px high at large desktop widths.
- Populated queue: compact horizontal surface, 104-132px high, with the illustration reduced to a
  small decorative mark and all three import methods retained.
- Drag-over: coral border and tint, no scale animation when reduced motion is enabled.
- Import errors remain inline and expandable.

### Queue

- Replace the responsive card grid with a single vertical list.
- Each row contains thumbnail, filename and real metadata, source-to-target relationship, per-item
  format override, exact comparison preview, status/progress, and remove/more actions.
- Use 88-104px row height on wide layouts and 112-128px at compact widths.
- Preserve path details in title/secondary disclosure rather than letting full paths dominate.
- Keep status color secondary to its icon and text so status does not rely on color alone.

### Conversion panel

Compose one panel from small sections while retaining existing state ownership:

1. preset selector and custom preset management;
2. target format and quality;
3. resize summary/toggle;
4. target-size summary/toggle;
5. privacy metadata selector;
6. output behavior: concurrency, conflicts, suffix/template;
7. advanced accordion: color management, compression policies, cache, format-specific controls.

Only one advanced group should need to be open at a time. Expanded state is ephemeral UI state and
does not alter the persisted conversion settings contract.

### Action dock

- Left: authorized output destination and any reauthorization state.
- Center: one real batch summary; never duplicate it above the queue.
- Right: clear and start/cancel actions.
- During conversion, the primary action changes to cancel without moving position or changing width.
- At compact width, use two rows: destination/status first, actions second.

## 6. Visual system

Use semantic OKLCH tokens rather than hardcoded component colors. Candidate light values must be
validated in-browser before landing:

| Token | Direction |
| --- | --- |
| `background` | warm ivory, approximately `oklch(0.985 0.012 72)` |
| `card` / `popover` | near-white warm surface |
| `foreground` | ink navy, approximately `oklch(0.25 0.045 258)` |
| `primary` | coral orange, approximately `oklch(0.70 0.19 38)` |
| `border` | low-chroma peach-gray |
| `muted` | warm neutral fill, not cool slate |
| `success` | restrained green with an explicit foreground token |
| `destructive` | existing semantic red, checked against both themes |

Dark mode uses warm charcoal/navy surfaces and a slightly lighter coral; it does not invert every
light token mechanically. Decorative texture, if used, must be CSS-only and under 2% opacity.

Typography remains a local-first cross-platform system stack with explicit Chinese fallbacks rather
than downloading a new font:

```css
font-family: "SF Pro Text", "Segoe UI Variable", "PingFang SC", "Microsoft YaHei",
  "Noto Sans CJK SC", system-ui, sans-serif;
```

Use 600 for headings, 500 for control labels, tabular figures for dimensions/bytes/progress, and no
all-caps labels except short file-format badges.

## 7. Asset plan

- `src/lib/assets/dropzone-upload-v2.png`: generated decorative upload illustration, 768x512 RGBA,
  genuine alpha, 236 KiB. Import it through Vite; use empty `alt` because adjacent text describes the
  action. Render at 180-220px in the empty state and 72-88px in compact mode.
- `docs/assets/design/ui-redesign-reference-v1.png`: wide visual-direction reference only. It is not
  a pixel-perfect contract and includes exploratory search/sort controls that are out of phase-one
  scope.
- Generation prompts and reference roles are recorded in
  [`assets/design/README.md`](assets/design/README.md).
- Keep runtime image thumbnails real. Do not bundle the mockup's example landscape photographs.
- Use Solar Icons (`@solar-icons/svelte`, line-duotone by default) for functional icons —
  migrated from Phosphor by user decision; generated bitmap icons would reduce consistency and
  accessibility.

## 8. Component plan

Prefer focused changes to existing components:

| Existing area | Planned change |
| --- | --- |
| `App.svelte` | semantic workspace grid, one status summary, responsive settings drawer trigger |
| `Topbar.svelte` | compact status hierarchy and utility menu; preserve every current action |
| `Dropzone.svelte` | empty/populated variants and generated illustration |
| `QueueItem.svelte` | list-row layout; retain lazy thumbnail loading and all actions |
| `WorkflowSettings.svelte` | render preset/resize/target-size/metadata sections without outer card |
| `SettingsBar.svelte` | render core/output/advanced sections without a second outer card |
| new `ConversionPanel.svelte` | visual composition only; no duplicate settings state |
| new `SettingsSection.svelte` | reusable section heading, summary, disclosure, disabled/error state |
| `OutputDestinationControl.svelte` | compact destination block that fits the action dock |
| `app.css` | warm semantic tokens, typography, focus ring, surface and density utilities |

Do not move conversion orchestration out of `state.svelte.ts` during this visual pass. Any later state
refactor should be an independent change with its own tests.

## 9. Responsive contract

| Window | Layout |
| --- | --- |
| >= 1200px | 68/32 workspace, 390-420px sticky settings panel, normal queue rows |
| 900-1199px | 340-370px settings panel, denser queue rows, compact top-bar labels |
| 720-899px | full-width queue; conversion settings open as a right drawer/sheet |
| height <= 640px | compact populated import surface, 56px header, two-row action dock |

The 720x540 minimum must remain functional without horizontal scrolling, hidden conversion actions,
or an unreachable settings section.

## 10. Accessibility and interaction contract

- WCAG AA text and control contrast in both themes.
- Visible 3px focus treatment that does not depend on color alone.
- 40px minimum desktop targets and 44px targets at compact/touch breakpoints.
- Logical tab order: header -> import -> queue -> settings -> destination -> primary action.
- Disclosure buttons expose `aria-expanded` and the controlled region.
- Progress uses text plus `aria-valuenow`; live announcements are throttled to stage/status changes.
- All motion uses opacity/transform and respects the existing reduced-motion setting.
- Native confirmations continue through `@tauri-apps/plugin-dialog`; the capability must include
  `dialog:allow-message` before the redesigned destructive flows ship.

## 11. Delivery phases

### Phase 0: correctness prerequisites

- Add the missing dialog permission and cover the confirmation path.
- Centralize comparison-preview invalidation so the redesigned visible preview never shows stale
  format/quality settings.
- Keep these fixes separate from visual commits where practical.

### Phase 1: tokens and shell

- Add warm light/dark semantic tokens and typography.
- Restructure header, workspace grid, and action dock without changing behavior.
- Verify 1536x1024, 900x680, and 720x540 in both locales.

### Phase 2: import and queue

- Add the generated illustration and adaptive drop-zone density.
- Convert queue cards to rows while preserving lazy thumbnails, per-file format, preview, progress,
  remove, error, skipped, and temporary-file states.

### Phase 3: conversion panel

- Compose existing workflow/basic/advanced controls into one surface.
- Add summaries and progressive disclosure; do not remove expert settings.
- Replace preset deletion's `window.confirm` with the native dialog API.

### Phase 4: compact layout and polish

- Add the settings drawer at 720-899px and the two-row action dock for short windows.
- Complete focus, hover, active, loading, empty, import-error, conversion-error, cancelled, and
  reduced-motion states.

### Phase 5: validation and documentation

- Update screenshots only after desktop E2E passes.
- Run frontend typecheck/lint/tests/build, Rust/Tauri tests affected by dialog behavior, and desktop
  E2E import/preview/convert/confirm flows.
- Review generated assets for alpha, dimensions, decoded memory, license documentation, and package
  inclusion.

## 12. Test matrix and acceptance criteria

Automated coverage:

- component tests for empty/populated/importing/error/converting/done queue states;
- no control or localized key lost when composing the settings panel;
- settings drawer focus trap, Escape close, and focus restoration;
- destructive confirmations invoke the native dialog command with the required capability;
- visual screenshots at 1536x1024, 900x680, and 720x540, light/dark, zh-CN/en-US;
- desktop E2E imports, changes a setting, refreshes exact preview, confirms an overwrite path, converts,
  and checks the real output.

Acceptance criteria:

- all existing user-visible capabilities remain reachable;
- no horizontal scroll at the configured minimum window size;
- primary conversion/cancel action remains visible at every supported size;
- populated import surface and queue show at least three rows at 900x680;
- no estimated output/savings value is displayed without backend data;
- no stale exact preview after target format, quality, resize, target size, metadata, or per-item format
  changes;
- no new runtime dependency is required for the visual redesign.

## 13. Design review corrections

The initial visual direction was reviewed against product truth, minimum-window constraints, and
maintainability. The corrected plan changes the following:

1. The large reference drop zone becomes adaptive after import.
2. Search/sort are removed from phase one because no current product contract supports them.
3. Predicted savings are replaced with honest progress/status.
4. Native window chrome is not recreated in Svelte.
5. The settings area is visually unified but remains composed from focused components.
6. Advanced controls remain reachable through disclosure rather than being deleted.
7. The 720x540 layout uses a settings drawer instead of squeezing two unusable columns.
8. The existing local-first font and icon strategy is retained; only the decorative upload image is
   generated.
9. Preview invalidation and native dialog permission are explicit correctness prerequisites.
10. The mockup is treated as art direction, while the responsive and accessibility contracts define
    the implementation.

## 14. Second review addendum (pre-development audit against the codebase)

Verified against the working tree before implementation:

1. **No drawer/menu primitive exists.** `src/lib/components/ui/` only contains button, label,
   select, separator, slider, and switch. The compact-width settings drawer and the topbar utility
   menu must be hand-rolled following the existing dialog patterns (`LegalDialog.svelte`,
   `PrivacySupportDialog.svelte`): overlay + panel, focus trap, Escape close, focus restoration. No
   new runtime dependency is permitted.
2. **Coral contrast must be fixed before landing.** `oklch(0.70 0.19 38)` with a white foreground is
   roughly 2.6-3.0:1 and fails WCAG AA for button text. Light theme primary should land near
   `oklch(0.58-0.63 0.17-0.19 38)` with white foreground, or keep the lighter coral with an ink-navy
   foreground. Dark theme needs its own validated pair; current dark `--primary` is near-white and
   also drives progress bars and focus accents, so every `text-primary`/`bg-primary` usage must be
   rechecked in both themes. Success green (`text-emerald-600`) likewise needs an explicit dark-mode
   variant.
3. **i18n gate.** New strings (drawer trigger/close, section summaries, utility menu) must be added
   to both `en-US.ts` and `zh-CN.ts`; `tests/i18n.test.ts` enforces key symmetry and rejects
   unreferenced keys.
4. **Test/E2E selectors to preserve.** `data-testid="start-conversion"` on the primary footer
   action; topbar buttons' `aria-label`/title keys (`topbar.reduceMotion`, etc.) are exercised by
   existing tests. If reduce-motion moves into a utility menu, keep an equivalent discoverable
   control with the same semantics and update tests accordingly.
5. **SettingsBar variants.** `variant="panel"` is only consumed by `App.svelte`; composing
   `ConversionPanel` must not leave dead variant branches (knip runs in the gate).
6. **Phase 0 preview invalidation scope.** Centralize invalidation for: global target format,
   quality, lossless toggle, resize rules, target size, metadata policy, suffix/output settings that
   affect bytes, and per-item format overrides. The open comparison preview must refresh or be
   marked stale after any of these change.
