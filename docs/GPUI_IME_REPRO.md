# macOS IME candidate popup survives a Kit dialog

Upstream report draft; not posted. G2 remains open. The reproduction uses only GPUI Kit and does not initialize ImgConvert settings, services, or file access.

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
3. Click `Open dialog` without confirming or cancelling the composition.
4. Observe the dialog and the old native candidate popup together.

Expected: moving focus to the non-text dialog ends the previous native conversion session; its candidate popup is no longer displayed over the dialog. The dialog should receive its first keyboard command.

Actual (reproduced on 2026-10-19): `Close` is present, the original field still reports `ni hao`, and an unnamed native window still contains a list with `AXIdentifier=InputMethodCandidateList`. The old candidate popup remains over the dialog. The same issue occurs with a physical click in ImgConvert's privacy dialog; its blur callback restores the saved suffix while the old candidate popup stays visible. Space then dismisses the candidate without acting on the dialog.

## Investigation boundary

`Window::draw` already sends `TextInputStateChange::FocusLost` when the focused region stops accepting text. The macOS backend in this locked version uses the trait's default no-op implementation. This is a candidate cause, not proof that one hook fixes every composition/focus transition.

Apple's installed `NSTextInputContext.h` documents `discardMarkedText` as discarding the current conversion session and requires the client to clear its marked range. A patch must respect the input owner, UI-thread reentrancy, window lifetime, and focus gained again before deferred cleanup. It must also verify typing after returning from the dialog. The patch must not globally cancel another window's input context.

Window movement during an existing composition is a separate observation: the same stale popup position occurred in a native Cocoa `NSTextField` control on this Mac. Do not present that observation as a GPUI-specific regression or claim this focus issue fixes it.
