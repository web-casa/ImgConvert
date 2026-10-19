# macOS IME candidate popup survives a Kit dialog

Upstream report: [longbridge/gpui-kit#3605](https://github.com/longbridge/gpui-kit/issues/3605), posted with explicit user authorization on 2026-10-19. G2 remains open. The reproduction uses only GPUI Kit and does not initialize ImgConvert settings, services, or file access.

## Environment

- macOS 13.6, Apple Silicon, Simplified Chinese Pinyin (`com.apple.inputmethod.SCIM.ITABC`).
- `gpui-kit = 0.7.1`, `gpui-base/gpui-component = 0.7.1`, `gpui-pre/gpui-pre-macos = 0.3.8`.
- Rust 1.96.0. No local framework patch in the failing candidate.

## Reproduction

Source: [`g2_ime_repro.rs`](../apps/gpui/crates/shell/examples/g2_ime_repro.rs). It uses a retained `InputState`, one `Input`, and the normal `WindowExt::open_dialog` API. There are no input event subscriptions, normalization callbacks, or persistence.

```bash
cargo run --manifest-path apps/gpui/Cargo.toml -p imgconvert-gpui \
  --example g2_ime_repro --no-default-features --locked
```

For an upstream checkout, copy the source into an existing Kit example that uses the same locked version matrix above. A new project with only `gpui-kit = "=0.7.1"` does **not** guarantee this matrix: its compatible constraints may resolve base/component/assets/macros to 0.7.2. The repository command above with `--locked` is the verified reproduction environment. The source imports only Kit and `std`, but the shell package still compiles its declared business dependencies; none are initialized by this example. Do not use the ImgConvert diagnostic scripts as an upstream dependency.

1. Focus the `Composition` field and select Simplified Chinese Pinyin.
2. Physically type `n`, `i`, `h`, `a`, `o`. Check that the field shows marked `ni hao` and that the native candidate list includes `你好`; literal `nihao` without a candidate list is not this state.
3. Activate `Open dialog` with its accessibility `AXPress` action without confirming or cancelling the composition. Test an actual CoreGraphics mouse click separately; it is a control path, not a reliably failing reproduction.
4. Observe the dialog and the old native candidate popup together.

Expected: moving focus to the non-text dialog ends the previous native conversion session; its candidate popup is no longer displayed over the dialog. The dialog should receive its first keyboard command.

Actual (reproduced on 2026-10-19): `Close` is present, the original field still reports `ni hao`, and an unnamed native window still contains a list with `AXIdentifier=InputMethodCandidateList`. The old candidate popup remains over the dialog. The same issue reliably occurs with accessibility activation of ImgConvert's privacy dialog; its blur callback restores the saved suffix while the old candidate popup stays visible. Space/Escape then dismisses the candidate without acting on the dialog. The final CoreGraphics mouse control commits raw Pinyin and closes the popup in both unpatched and patched builds; earlier click observations did not establish this input-delivery distinction. Do not require the CG control to fail or attribute its precommit behavior to the patch.

## Investigation boundary

`Window::draw` already sends `TextInputStateChange::FocusLost` when the focused region stops accepting text. The macOS backend in this locked version uses the trait's default no-op implementation. This is a candidate cause, not proof that one hook fixes every composition/focus transition.

Apple's installed `NSTextInputContext.h` documents `discardMarkedText` as discarding the current conversion session and requires the client to clear its marked range. A patch must respect the input owner, UI-thread reentrancy, window lifetime, and focus gained again before deferred cleanup. It must also verify typing after returning from the dialog. The patch must not globally cancel another window's input context.

Window movement during an existing composition is a separate observation: the same stale popup position occurred in a native Cocoa `NSTextField` control on this Mac. Do not present that observation as a GPUI-specific regression or claim this focus issue fixes it.

A downstream experimental patch and explicit regression harness are now prepared in [`patches/gpui-ime-focus`](../patches/gpui-ime-focus/README.md). They are inactive and do not change this unpatched reproduction. The initial owner-aware discard-only revision still left the native popup after accessibility `AXPress`, despite restoring the saved field value. The later revision also resets this view's active native context with lifetime/ownership guards. Its no-log native candidates pass the specific AX/CG, first-Escape, direct recomposition, independent Cocoa context and composing-close cases recorded in [GPUI_G2_ACCEPTANCE.md](GPUI_G2_ACCEPTANCE.md). This is an inactive downstream candidate, not an upstream fix or completed G2 gate. The upstream report is posted; product activation remains pending. Headless state checks alone do not establish native session cleanup.
