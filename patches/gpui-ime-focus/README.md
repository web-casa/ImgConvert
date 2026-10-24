# macOS IME focus source overrides

The GPUI workspace applies `[patch.crates-io]` to `gpui-pre` and `gpui-pre-macos` **0.3.8** and to `gpui-base` **0.7.1** under `apps/gpui/vendor`. Kit/component/assets/macros remain the original locked **0.7.1** packages. Normal Cargo builds use the overrides directly; no preparation, alternate config, or lock rewriting is required.

Only the three modified crates' runtime sources, required Windows resources, original manifests/README and complete Apache license texts are retained (319 files). Upstream example/test targets and their media are omitted, and local manifests cannot publish. The source overrides are excluded from application workspace membership. [gpui-kit#3605](https://github.com/longbridge/gpui-kit/issues/3605) was posted with explicit authorization before activation. The migration plan §3.1, source registration in [GPUI_PATCHES.md](../../docs/GPUI_PATCHES.md), and G2's remaining native acceptance requirements continue to apply.

## Normal builds and source audit

```bash
cargo build --manifest-path apps/gpui/Cargo.toml --locked
python3 patches/gpui-ime-focus/verify.py --metadata
# Optional independent reconstruction from already cached release archives:
python3 patches/gpui-ime-focus/verify.py --archives \
  "$HOME/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f"
```

`verify.py` checks every retained byte against `vendor-files.json`, validates the twelve modified source files against the reviewed diffs, rejects extra/missing/modified files and links, and verifies the resolved packages come from the actual product paths. Reconstructing the original registry entries must reproduce the pre-activation lock hash: only the three source entries changed, with no version changes. Archive audit uses the existing safe extractor and compares every retained byte with the pinned archives plus patches; only removal of example/test targets and `publish = false` changes manifests. It creates temporary data only below the owned `apps/gpui/target/tmp` root. The architecture guard runs source checks; GPUI CI also verifies actual metadata after its normal builds/tests. Source files and the product lock use LF on all checkouts.

## Shared tab-stop registration

The same source tree also carries the `TabStopMap::insert` fix for [longbridge/gpui-kit#3612](https://github.com/longbridge/gpui-kit/issues/3612). Re-registering a `FocusId` now removes its previous ordered-tree node before inserting the new one, so `by_id` and `order` agree on the last registration. This prevents reverse traversal from repeatedly returning to a focus handle that is registered by both an accessibility wrapper and its inner control. The reported reproduction is in [`docs/GPUI_TAB_STOP_REPRO.md`](../../docs/GPUI_TAB_STOP_REPRO.md); product regressions in `apps/gpui/crates/shell/tests/tab_stop.rs` cover the original shared handle, cached-frame replay and a `tab_stop` state change. This is focus ordering only, not native keyboard or VoiceOver acceptance.

## Accessibility press and scroll-into-view

The same `gpui-pre` source also changes `element.rs`, `elements/div.rs`, `window.rs`, `window/a11y.rs` and `view.rs` so an accessibility `Click` on a node without its own listener no longer synthesizes a mouse click at a stale, unclipped or covered position. Prepaint records each node's clip, its own hitbox and its enclosing scroll containers (with their scrolling axes), plus every hitbox that acts on a pointer press; a press is delivered only at a point (centre first, then a three-by-three grid) where hit testing reaches that hitbox with no other such hitbox above it, otherwise the node is scrolled into view and pressed two frames later, or not at all. Nodes inside scroll containers declare and handle `ScrollIntoView`, which only moves the axes a container scrolls. Cached views do not reuse their prepaint while accessibility is active, so their nodes stay in the tree. Test support gains `Window::simulate_a11y_activation` and `Window::simulate_a11y_action`. The analysis and reproduction are in [`docs/GPUI_A11Y_CLICK_REPRO.md`](../../docs/GPUI_A11Y_CLICK_REPRO.md); product regressions are `apps/gpui/crates/shell/tests/a11y_actions.rs` and the UI test `a11y_press_on_a_setting_scrolled_under_the_tabs_reaches_the_setting`. Reported upstream as [longbridge/gpui-kit#3658](https://github.com/longbridge/gpui-kit/issues/3658).

## Live regions

`elements/div.rs` also gains `aria_live(Live)`, which sets AccessKit's `live` property so platform adapters announce the element's value when it changes, and `gpui.rs` re-exports `accesskit::Live`. Test support gains `Window::a11y_node_for_test` to read the last frame's node. ImgConvert's action bar uses it for a size-less status node that exists for one frame when a batch starts, is cancelled, finishes or fails, or a settings write fails, so each milestone is announced once (`batch_milestones_are_announced_once`, `settings_and_batch_failures_are_both_announced`).

## Disabled state for assistive technology

`elements/div.rs` also gains `InteractiveElement::aria_disabled(bool)`, which sets AccessKit's `disabled` property. Kit's `disabled` only withholds the click handler, so a disabled button was announced as available. ImgConvert calls it through `a11y::DisabledForAll::disabled_for_all` on Kit buttons (`disabled_commands_are_disabled_for_assistive_technology`).

## Dialog role and name

`gpui-base`'s `FocusTrapContainer` wraps Kit's modal host but did not forward `a11y_role`, `write_a11y_info` or `a11y_synthetic_children`, so the host's `Role::Dialog` never reached the tree and every dialog was an unnamed group; VoiceOver announced an opened dialog only as "window". The vendored `src/focus_trap.rs` forwards the three methods. `gpui-pre`'s `window/a11y.rs` names an unlabeled `Dialog`/`AlertDialog` node after the first `Heading` in its subtree, in document order, and test support gains `Window::a11y_nodes_with_role_for_test`; `a11y_node_for_test` now returns the finalized node. ImgConvert renders dialog titles through `a11y::dialog_title` (`dialogs_are_named_after_their_titles_for_assistive_technology`).

## Ownership and behavior

- Each registered handler retains its focus ID; entity-backed handlers also report their retained client ID. These identities survive cached paint reuse.
- After painting, before installing the replacement handler, compare the old client with the actual next client and current focus. Transfers during render and disappearance without an explicit blur count as losing the input client.
- Clear the **old** client's marked range and commit its composition undo transaction, then synchronously discard that window view's native conversion session and reset its activation when it remains the active client. The native handler slot stays empty during AppKit callbacks, and no native mutex is held across the call.
- Discard/deactivate only the view's `inputContext`; read `currentInputContext` only to guard ownership. Retain the view/context through callbacks, check closure, and reactivate only if the same view is still the key window's first responder and no other context became active. No deferred task can later cancel a newly started composition.
- Preserve the current preedit text according to `unmark_text`; this is not a rollback to the text before composition. ImgConvert's existing suffix blur policy remains responsible for restoring its persisted suffix.
- A→B→A without an intervening frame preserves A's current composition. A transfer that actually installs another client ends the previous composition.
- Custom `InputHandler` implementations without an entity ID fall back to focus identity. Two custom clients sharing a focus handle must supply distinct stable `input_client_id` values; that unusual case is not inferred automatically.
- If the first focus happens after its input has painted, allow one recovery frame for that missing target. A permanently absent target must settle rather than continually redraw.
- Cleanup is enabled only on macOS. Other platforms retain their existing input lifecycle.

## Prepare an isolated regression harness

Requires Python 3.9+, Git and Cargo's already downloaded `.crate` archives. The script validates the workspace lock fingerprint, complete archive SHA-256 values from the lock, patch hashes, and resulting touched source hashes. It extracts only regular files and directories, refuses path traversal or links, writes only to a new directory below this checkout's `apps/gpui/target/tmp`, and leaves product configuration alone.

```bash
python3 patches/gpui-ime-focus/prepare.py \
  --cache-directory "$HOME/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f" \
  --output "$PWD/apps/gpui/target/tmp/ime-focus-candidate"
python3 -m unittest discover -s patches/gpui-ime-focus -p 'test_*.py'
```

Use the actual Cargo registry index directory if its name differs. An existing output is never replaced. Preparation failure removes only the output directory it exclusively created. Preparation does not download packages, run Cargo, or change a registry source directory.

## Standalone regression checks

Preparation also creates `harness`, a Kit-only test workspace, seeded from the verified product lock. It contains no ImgConvert services or business dependencies. Its initial metadata resolution writes only its own lock. The verifier checks the generated manifest/module wiring and the 13 expected test identities, rejects redirected ownership roots and dependencies outside the original name/version/source set, checks Kit **including assets/macros** remains exactly 0.7.1 and GPUI exactly 0.3.8, confirms the selected paths, and rejects stale test copies. With `--active` it hashes and tests the actual product overrides, not the separately staged copies. Omitting that flag retains the isolated-copy mode for experiments.

```bash
# macOS: verify the matrix and test the actual active product overrides.
CARGO_TARGET_DIR="$HOME/tools/imgconvert/apps/gpui/target" \
  python3 patches/gpui-ime-focus/check.py \
  "$PWD/apps/gpui/target/tmp/ime-focus-candidate" --active

# Other systems may inspect the matrix, without claiming native test coverage.
python3 patches/gpui-ime-focus/check.py \
  "$PWD/apps/gpui/target/tmp/ime-focus-candidate" --active --metadata-only
```

Use a suitable dedicated Cargo target cache; the path above is an example, not a required source checkout. The checker uses offline metadata, verifies every resolved dependency against the product lock, then runs the harness with its own `--locked` lock. No product source, manifest or lock needs temporary mutation. The normal product example also tests these ten controls directly with the active workspace and its unchanged lock.

The ten control tests cover dialog transfer and returning to type, editable/read-only text transfer, ordinary redraw, real cached paint reuse, shared-focus entity replacement, refocus before/during paint, focus transfer during render, input removal without explicit blur, and composition undo/redo. Three scheduling tests verify cleanup wakes its own follow-up frame, a late first client is installed on the next frame, and a permanently missing target settles.

The framework's existing test-support context gains two inspection methods: `frame_wake_observer` and `text_input_handler_observer`. They return observers owning the test handle, so assertions can run inside a window update before test mode automatically redraws at effect flush. They do not borrow App again, draw, or change application focus; the second preserves the installed test-platform handler. No raw test-window object is exposed. This avoids compiling the published crate's unrelated unit suite, which references font fixtures outside its archive and has a failing property-test macro in the locked release. The regression checks are not dependent on those fixtures.

All 13 tests are macOS-only. The checker rejects a full run on another OS and rejects a successful Cargo run with fewer than 13 tests; a metadata-only pass proves no window behavior. Headless checks cover client state and scheduling, not the native popup. The unpatched product example must fail the transfer/removal cases; redraw/refocus controls must preserve their marked ranges. The standalone scheduling tests require the candidate's test-support inspection methods.

For native checks, build `--example g2_ime_repro` and the app normally with `--locked`, using no alternate source config or temporary lock mutation. The active product path is what needs acceptance. Confirm real marked `ni hao` plus `InputMethodCandidateList` **before** opening a dialog; literal `nihao` without a popup is not a valid setup. Record popup disappearance, first Escape reaching the dialog, fresh composition and confirmation after returning, rapid refocus, window close, and independent windows. Also run ImgConvert's read-only privacy dialog in the dedicated sandbox candidate and verify its suffix persistence policy. Restore ABC, VoiceOver state and the dedicated preview afterward. Do not replace the already authorized capture helper or alter TCC databases.

## Exit conditions

The upstream report, review, negative baseline and specific native candidate results are recorded in the G2 acceptance log. Activation additionally requires normal-product source/license/build verification. This does not close G2 or authorize release: full VoiceOver and sandbox acceptance still need their own evidence. When a locked upstream version contains the equivalent verified fix, remove both source overrides and their source inventory, rerun the same state and native checks using normal registry dependencies, and update the registration. Upgrades remain independent reviewed changes under migration plan §3.1.
