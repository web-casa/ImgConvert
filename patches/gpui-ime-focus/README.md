# Inactive macOS IME focus cleanup candidate

This is an opt-in experiment for the locked `gpui-pre` / `gpui-pre-macos` 0.3.8 pair. **The product does not use these patches.** The normal workspace manifest and lock remain unchanged. No framework source tree is vendored in Git.

The migration plan §3.1 requires an upstream minimal reproduction before activating a local framework patch. The report in [GPUI_IME_REPRO.md](../../docs/GPUI_IME_REPRO.md) was posted as [longbridge/gpui-kit#3605](https://github.com/longbridge/gpui-kit/issues/3605) with explicit user authorization on 2026-10-19. The earlier discard-only experiment left a stale popup after accessibility activation; this revision additionally resets the active native context with ownership/lifetime guards. Each revision needs its own native evidence; see the acceptance record. A reviewed experiment is not G2 acceptance or permission to release.

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

## Prepare without activating

Requires Python 3.9+, Git and Cargo's already downloaded `.crate` archives. The script validates the workspace lock fingerprint, complete archive SHA-256 values from the lock, patch hashes, and resulting touched source hashes. It extracts only regular files and directories, refuses path traversal or links, writes only to a new directory below this checkout's `apps/gpui/target/tmp`, and leaves product configuration alone.

```bash
python3 patches/gpui-ime-focus/prepare.py \
  --cache-directory "$HOME/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f" \
  --output "$PWD/apps/gpui/target/tmp/ime-focus-candidate"
python3 -m unittest discover -s patches/gpui-ime-focus -p 'test_*.py'
```

Use the actual Cargo registry index directory if its name differs. An existing output is never replaced. Preparation failure removes only the output directory it exclusively created. Preparation does not download packages, run Cargo, or change a registry source directory.

## Standalone regression checks

Preparation also creates `harness`, a Kit-only test workspace, seeded from the verified product lock. It contains no ImgConvert services or business dependencies. Its initial metadata resolution writes only its own lock. The verifier checks the generated manifest/module wiring and the 13 expected test identities, rejects redirected ownership roots and dependencies outside the original name/version/source set, checks Kit **including assets/macros** remains exactly 0.7.1 and GPUI exactly 0.3.8, confirms the two patched sources are actually selected, and rejects stale test copies.

```bash
# macOS: verify the matrix, then run exactly 13 headless regressions.
CARGO_TARGET_DIR="$HOME/tools/imgconvert/apps/gpui/target" \
  python3 patches/gpui-ime-focus/check.py \
  "$PWD/apps/gpui/target/tmp/ime-focus-candidate"

# Other systems may inspect the matrix, without claiming native test coverage.
python3 patches/gpui-ime-focus/check.py \
  "$PWD/apps/gpui/target/tmp/ime-focus-candidate" --metadata-only
```

Use a suitable dedicated Cargo target cache; the path above is an example, not a required source checkout. The checker uses offline metadata, verifies every resolved dependency against the product lock, then runs the harness with its own `--locked` lock. No product source, manifest or lock needs temporary mutation. The normal example remains available for explicit tests in a disposable patched product checkout.

The ten control tests cover dialog transfer and returning to type, editable/read-only text transfer, ordinary redraw, real cached paint reuse, shared-focus entity replacement, refocus before/during paint, focus transfer during render, input removal without explicit blur, and composition undo/redo. Three scheduling tests verify cleanup wakes its own follow-up frame, a late first client is installed on the next frame, and a permanently missing target settles.

The framework's existing test-support context gains two inspection methods: `frame_wake_observer` and `text_input_handler_observer`. They return observers owning the test handle, so assertions can run inside a window update before test mode automatically redraws at effect flush. They do not borrow App again, draw, or change application focus; the second preserves the installed test-platform handler. No raw test-window object is exposed. This avoids compiling the published crate's unrelated unit suite, which references font fixtures outside its archive and has a failing property-test macro in the locked release. The regression checks are not dependent on those fixtures.

All 13 tests are macOS-only. The checker rejects a full run on another OS and rejects a successful Cargo run with fewer than 13 tests; a metadata-only pass proves no window behavior. Headless checks cover client state and scheduling, not the native popup. The unpatched product example must fail the transfer/removal cases; redraw/refocus controls must preserve their marked ranges. The standalone scheduling tests require the candidate's test-support inspection methods.

For native checks, build `--example g2_ime_repro` and the app with the same candidate config in a disposable product worktree. Its native build needs temporary path-patch lock resolution; preserve its original lock and restore it with an exit trap, including on failure. Never commit that experimental lock. Confirm real marked `ni hao` plus `InputMethodCandidateList` **before** opening a dialog; literal `nihao` without a popup is not a valid setup. Record popup disappearance, first Escape reaching the dialog, fresh composition and confirmation after returning, rapid refocus, window close, and independent windows. Also run ImgConvert's read-only privacy dialog in the dedicated sandbox candidate and verify its suffix persistence policy. Restore ABC, VoiceOver state and the normal unpatched preview afterward. Do not replace the already authorized capture helper or alter TCC databases.

## Exit conditions

Do not enable these patches until the upstream report is authorized and posted, candidate review findings are resolved, the regression baseline fails and patched tests pass, and native dialog/client lifecycle checks pass. Activation needs its own source/license/CI review; the candidate config is not an active product dependency. Remove the candidate when the locked upstream versions contain the equivalent verified fix, rerun the same state and native checks without patches, and update [GPUI_PATCHES.md](../../docs/GPUI_PATCHES.md).
