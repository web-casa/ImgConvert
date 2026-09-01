# ImgConvert workflow features design

Status: reviewed design, ready for implementation  
Scope: batch resize rules, scenario presets, target file size, privacy metadata profiles,
before/after comparison preview

## Goals and non-goals

The five features must use one conversion contract from the frontend through Tauri to
`imgconvert-core`. A preview must not implement a visually similar but semantically different
encoder. Invalid or unsupported combinations fail explicitly; no setting silently falls back.

The first release deliberately does not add cropping, stretching, per-file resize overrides,
arbitrary EXIF field editing, PNG target-size optimization, or an image editor. These require
separate product semantics and should not be hidden inside a batch conversion feature.

## Product semantics

### Batch resize rules

One rule applies to every pending item in the batch. Dimensions are computed from the
orientation-normalized source size.

| Mode           | Input                         | Rule                                                                 |
| -------------- | ----------------------------- | -------------------------------------------------------------------- |
| `none`         | none                          | Preserve source dimensions.                                          |
| `fit`          | width + height                | Fit inside the box while preserving aspect ratio.                    |
| `width`        | width                         | Derive height from the source aspect ratio.                           |
| `height`       | height                        | Derive width from the source aspect ratio.                            |
| `longestEdge`  | edge                          | Set the longer edge and derive the shorter edge.                      |
| `percentage`   | integer percent, 1–400        | Scale both dimensions by the same ratio.                              |

All modes preserve aspect ratio and round to the nearest positive integer. Upscaling is disabled
by default. When it is disabled, a rule that would enlarge an image becomes a no-op. The existing
64-million-pixel core budget and checked arithmetic apply to calculated dimensions.

Resizing is performed in linear-light sRGB. If a source has a non-sRGB ICC profile, pixels are
converted to sRGB before resizing. The original ICC profile is not reattached to changed pixels;
this avoids assigning the wrong colour space to the result. The result and preview report that a
profile conversion occurred.

### Scenario presets

Presets are declarative setting snapshots. They never contain paths, helper commands, overwrite
authorization, output directories, locale/theme, or temporary queue state.

Built-in presets are immutable and versioned in source:

| Preset            | Core intent                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| Web sharing       | WebP, quality 82, longest edge 2048, colour-only metadata.                      |
| Email attachment  | JPEG, quality ceiling 82, longest edge 1600, 1 MiB target, colour-only metadata.|
| High-quality copy | AVIF, quality 90, original size, preserve all metadata.                         |
| Private sharing   | JPEG, quality 85, longest edge 2048, strip all metadata.                        |

Users can save up to 20 custom presets with a 64-character name. Custom presets use a versioned,
allowlisted schema persisted with settings. Applying a preset is atomic. Any subsequent edit makes
the UI display “Custom” unless the resulting allowlisted snapshot exactly matches a preset.

### Target file size

Target size is available only for lossy JPEG and lossy WebP in the first release. It is mutually
exclusive with automatic perceptual quality, lossless output, and PNG/AVIF targets. The UI disables
invalid combinations and the backend independently rejects crafted invalid requests.

The user supplies a maximum size in KiB (16 KiB–100 MiB). The normal quality setting is the quality
ceiling and the format-specific quality floor is the lower bound. Resize and metadata policy run
before target-size encoding, so the limit applies to the final encoded bytes including retained
metadata.

The encoder evaluates qualities from the ceiling downward in steps of five. After the first fitting
coarse candidate, it checks the four intervening qualities from high to low. At every quality, the
existing equivalent encoder candidates may compete and the smallest output is retained. This is a
bounded maximum of 19 quality levels. Every success is verified from complete bytes rather than a
monotonic-size assumption; the bounded search does not claim to exhaust pathological intermediate
quality dips that were not evaluated.

When the configured format floor is disabled, target-size search uses 30 as its safety floor. The
selected result is the highest evaluated quality whose complete byte stream is no larger than
the target. If even the floor cannot fit, the smallest evaluated result is returned with
`targetSizeMet=false` and a visible `targetSizeNotMet` warning. The result is never reported as a
successful size match when it exceeds the requested limit.

The existing “skip if larger” and generation-loss protection switches are compression-only
policies. They do not apply when the calculated output dimensions differ from the source dimensions;
otherwise an explicitly requested resize could be discarded as though it were an ineffective
same-size recompression. The UI explains and disables those switches while a resize rule is active,
and the backend derives the same decision from actual decoded dimensions.

### Privacy metadata profiles

The output metadata policy is a required enum:

| Profile       | ICC | EXIF | XMP | IPTC | Privacy meaning                                  |
| ------------- | --- | ---- | --- | ---- | ------------------------------------------------ |
| `stripAll`    | no  | no   | no  | no   | Convert profiled pixels to sRGB, then remove all supported metadata. |
| `colorOnly`   | yes | no   | no  | no   | Keep complete ICC; profile/device identifiers may remain. |
| `preserveAll` | yes | yes  | yes | yes  | Preserve normalized metadata where supported; not privacy-safe. |

The implementation filters complete normalized blobs. It does not modify arbitrary EXIF offsets or
MakerNotes. Existing persisted `preserveMetadata=false` migrates to `stripAll`; `true` migrates to
`preserveAll`. New requests carry the enum. The old boolean remains accepted for IPC compatibility
for one schema generation, but the enum wins when both are present.

`stripAll` converts pixels described by an embedded or helper-provided ICC profile to sRGB before
removing that profile. This keeps visual appearance stable even when resize is disabled or becomes
a no-op; the ICC input is therefore part of the result-cache key.

`colorOnly` is a colour-fidelity compromise, not a promise of complete anonymity: ICC profiles are
kept as whole blobs and may contain profile descriptions, manufacturer/model fields, or copyright
tags. The UI calls this out; users needing the strongest metadata privacy should use `stripAll`.

When resize converts pixels to sRGB, `preserveAll` still preserves EXIF/XMP/IPTC but cannot preserve
the original incompatible ICC profile. The result exposes a warning instead of silently claiming
byte-for-byte metadata preservation.

### Before/after comparison preview

The user explicitly opens a preview from a queue item. A modal shows source and converted previews
under an accessible horizontal reveal slider, plus source/output dimensions, encoded size, selected
quality, target-size status, and warnings.

The backend runs the exact in-memory workflow used by final conversion, including full-resolution
resize, target-size search, colour handling, and metadata policy. It then creates bounded PNG display
images (the product UI requests a maximum edge of 1200; the core API cap is 1600) from the source and
encoded result. Only these PNGs and scalar statistics cross IPC in a length-checked binary envelope;
the full encoded file is not
returned to the webview.

At most one preview generation is current. Opening or refreshing a preview cancels the previous
generation at core stage/candidate boundaries and uses a monotonically increasing generation ID so a
late native codec result cannot replace newer UI state. Native codec calls themselves remain
non-interruptible; stale results are discarded. Closing the modal revokes both object URLs.

## Data contracts

Frontend and Tauri use camelCase JSON; Rust core types use Rust names.

```text
ResizeRule {
  mode: none | fit | width | height | longestEdge | percentage
  width?: u32
  height?: u32
  value?: u32
  allowUpscale: bool
}

MetadataPolicy = stripAll | colorOnly | preserveAll

TargetSizeOptions {
  maxBytes: u64
  minQuality: u8
}

WorkflowOptions {
  resize: ResizeRule
  metadataPolicy: MetadataPolicy
  targetSize?: TargetSizeOptions
}

WorkflowResult {
  bytes
  width
  height
  selectedQuality?
  targetSizeMet?
  warnings[]
}
```

`ConvertOptions` adds `resize`, `metadataPolicy`, and `targetSizeBytes`. A per-item target-format
override that is incompatible with an enabled target size is reported on that queue item before the
batch starts; it is never silently converted without the limit. The result cache key includes the
normalized resize rule, calculated target dimensions, metadata policy, target byte limit, and quality
bounds. File naming and overwrite planning remain independent from these content options.

`ConvertResult` adds `warnings[]` because target-size, colour and filesystem warnings can coexist.
The existing singular `warning` field remains serialized for one compatibility generation; new
frontends merge and de-duplicate both fields.

Settings persist a `workflowSettingsVersion`. Migration clamps all numeric values, rejects unknown
enum values, limits custom preset count/name length, and writes normalized state back once.

## Architecture

### Core

Add a small workflow module and a single top-level workflow API. It owns this order:

```text
detect/decode → orientation normalization → metadata override → colour preparation
→ checked resize → metadata filtering → bounded encoder selection → WorkflowResult
```

Existing `convert*` functions become compatibility wrappers over the same internal pipeline. Panic,
deadline, pixel-budget, metadata-budget, and candidate checks stay at the shared boundary. Core has
no Tauri dependency; cancellation is an optional callback checked between stages and candidates.

### Tauri

`convert.rs` validates/normalizes the new request fields, builds the core workflow once, includes the
fields in memory estimates and cache keys, and maps workflow warnings into the existing warning
contract.

A new `preview.rs` follows the established thumbnail/import pattern: authorized source path,
256-MiB source-file cap, `spawn_blocking`, one active `PreviewState`, cancellation token, generation
ID, and bounded response images. It reuses the same `ConvertOptions`-to-core builder as file output.
It performs no filesystem write and therefore receives no overwrite or output-path authority.
Preview bypasses the on-disk result cache. The backend also enforces resource coordination: starting
a batch cancels the current preview, preview generation rejects while a batch is active, and one
shared execution gate serializes full-resolution preview work with single/batch conversions while a
native encoder reaches its next cancellation boundary. These checks still apply if a crafted IPC
request bypasses disabled frontend controls.

### Frontend

- `conversion-options.ts` owns the single settings/item → `ConvertRequest` builder.
- `workflow-presets.ts` owns allowlisted preset snapshots, built-ins, matching, validation, and
  migration helpers.
- `WorkflowSettings.svelte` owns preset, resize, target-size, and privacy controls.
- `ComparisonPreview.svelte` owns preview state, reveal slider, keyboard interaction, and URL cleanup.
- `QueueItem.svelte` only emits the open-preview action; it does not perform IPC.

Editing is disabled during a running conversion. Setting changes mark an open preview as stale; the
user explicitly refreshes it, and importing many files never auto-starts preview work.

## Security and resource budgets

- Preview accepts only paths that pass the same selected-path authorization as thumbnails.
- Presets cannot contain paths, overwrite flags, helpers, shell text, or unknown keys.
- All dimensions and percentages are clamped and checked before allocation.
- Target size is capped at 100 MiB; source-file and metadata caps remain unchanged.
- Preview returns two PNGs whose maximum edge is 1200 for current product requests (with a 1600 core
  API cap) and never exposes source metadata to the webview.
- One preview is current; a shared backend execution gate serializes full-resolution preview work
  with single and batch conversion. Starting a batch cancels the current preview before waiting for
  the gate, so native encoder calls cannot overlap their peak working sets even if cancellation is
  only observed at the next safe boundary.
- Unsupported format/mode combinations fail closed in both frontend normalization and Rust.

## Test strategy

Core tests cover every resize mode, orientation-aware dimensions, no-upscale behavior, overflow and
pixel budgets, metadata profile matrices in JPEG/PNG/WebP/AVIF, resize/ICC conversion, target-size
fit/non-fit boundaries, quality floors, complete-byte limit verification, timeout/cancellation, and
panic containment.

Tauri tests cover serde compatibility, old boolean migration behavior, invalid combinations, cache
key separation, memory estimates, warnings, authorized preview paths, replacement cancellation, and
bounded preview output.

Frontend tests cover settings migration, preset allowlists/matching, atomic application, custom
preset limits, request building, invalid-combination normalization, preview stale-response rejection,
URL revocation, native range state, and localized warnings. Desktop E2E previews and converts a
resized target-size image through Tauri/core; built-in preset application is covered by the atomic
frontend unit test.

## Design review and corrections

The initial design was reviewed backwards from failure modes. The following corrections are part of
the implementation contract:

1. **Colour correctness:** the initial “preserve ICC while resizing” idea was invalid because the
   existing linear resize API requires sRGB/no-ICC pixels. Resized pixels now convert to sRGB and the
   incompatible source profile is not reattached; a warning exposes the change.
2. **Target-size determinism:** binary search was rejected because encoder size is not guaranteed to
   be monotonic across equivalent candidates. A bounded descending ladder plus local refinement
   always verifies the chosen complete byte stream.
3. **Metadata safety:** fine-grained EXIF toggles were rejected for the first release. Rebuilding or
   mutating unknown MakerNote/offset layouts risks corruption. Whole-blob profiles are explicit and
   testable. Under `stripAll`, malformed ICC metadata cannot block privacy removal: decoded samples
   are retained, the invalid profile is discarded, and a persistent warning reports colour
   uncertainty instead of silently degrading.
4. **Preview fidelity:** a fast downscaled sample conversion was rejected because it could choose a
   different target-size quality than the final image. The exact full-resolution workflow runs first;
   only display transfer is downscaled.
5. **Cancellation honesty:** native encoders cannot be preempted safely. Cancellation is checked at
   stage/candidate boundaries and generation IDs discard late results. A shared execution gate also
   prevents a cancelled preview's native call from overlapping a new conversion; UI copy must not
   promise instantaneous interruption.
6. **Preset authority:** presets originally included general settings. They are now strict workflow
   allowlists and cannot alter destinations, overwrite decisions, helper paths, locale, or theme.
7. **Compatibility:** replacing `preserveMetadata` outright would break saved settings and older IPC
   clients. A versioned migration and one-generation backend fallback preserve behavior without
   weakening the new enum contract.
8. **Component size:** adding all controls to the existing 900-line settings component was rejected.
   New modules isolate workflow, preset, and preview state while reusing the current UI primitives.
9. **Policy interaction:** generation-loss and “skip if larger” checks were originally left unchanged.
   They are now limited to conversions whose dimensions are unchanged, so an intentional resize is
   never skipped by compression-only heuristics.

## Delivery slices

1. Core types, shared pipeline, resize/metadata/target-size algorithms, unit tests.
2. Tauri request/cache/result integration and preview state/command, unit tests.
3. Frontend migration, option builder, presets and workflow controls, unit tests.
4. Comparison modal, queue integration, desktop E2E.
5. Full clippy/test/typecheck/lint/build/fuzz/security/license/docs gates and final cross-layer review.
