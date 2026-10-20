# GPUI shared focus handle can trap Shift-Tab in a nested control

## Versions and environment

- gpui-kit / gpui-base / gpui-component 0.7.1; gpui-pre / gpui-pre-sum-tree 0.3.8.
- Rust 1.96.0, Linux aarch64. Headless real-window interaction test; no VoiceOver or OS input-method interaction is needed to reproduce this ordering bug.
- The application currently has an independent input-owner patch in gpui-pre. The relevant `src/tab_stop.rs` was byte-identical to the 0.3.8 registry archive before this candidate; the report concerns that unmodified file.
- Upstream report: [longbridge/gpui-kit#3612](https://github.com/longbridge/gpui-kit/issues/3612). The candidate is now applied to the product vendor source. With that source the three product regressions and the legal-dialog reverse-cycle UI test pass; without it, the original shared-handle and cached-replay regressions fail, as does the UI cycle. The `tab_stop` state-change regression is an invariant and passes on both sources.

## Reproduction

Place this in `tests/tab_stop.rs` of a gpui-kit 0.7.1 test package with `test-support` enabled on its gpui-kit development dependency. Run `cargo test --test tab_stop --locked`.

The fixture registers the same retained focus handle on an outer semantic wrapper and an inner input region. Forward Tab reaches After; Shift-Tab reaches the shared control, but the next Shift-Tab stays there instead of reaching Before.

```rust
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Minimal shared-focus regression, also suitable for the upstream report.
use gpui_kit::component::button::Button;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    AppContext as _, Context, FocusHandle, InteractiveElement as _, IntoElement,
    ParentElement as _, Render, Styled as _, TestAppContext, Window, WindowOptions, div, px,
};

struct SharedFocus {
    focus: FocusHandle,
}
impl Render for SharedFocus {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .child(Button::new("before").label("Before"))
            .child(
                div().id("outer").track_focus(&self.focus).child(
                    div()
                        .id("inner")
                        .track_focus(&self.focus)
                        .h(px(30.))
                        .child("Shared focus"),
                ),
            )
            .child(Button::new("after").label("After"))
    }
}

#[gpui_kit::test]
fn reverse_tab_leaves_a_shared_focus_handle(cx: &mut TestAppContext) {
    let (handle, focus) = cx.update(|cx| {
        gpui_kit::init(cx);
        let (handle, view) = gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|cx| SharedFocus {
                focus: cx.focus_handle().tab_stop(true),
            })
        })
        .expect("open minimal fixture");
        (handle, view.read(cx).focus.clone())
    });
    cx.update_window(handle, |_, window, cx| {
        window.activate_window();
        window.render_frame(cx);
        window.focus(&focus, cx);
        window.render_frame(cx);
        window.press("tab", cx);
        window.render_frame(cx);
        assert_eq!(window.find("after").focused(), Some(true));
        window.press("shift-tab", cx);
        window.render_frame(cx);
        assert_eq!(window.focused(cx), Some(focus));
        window.press("shift-tab", cx);
        window.render_frame(cx);
        assert_eq!(window.find("before").focused(), Some(true));
    })
    .unwrap();
}
```

Expected: the final assertion focuses Before. Observed on the original tab-stop source: `Some(false)` instead of `Some(true)`; the test fails. This also affects reverse traversal when an application binds an accessibility wrapper to a retained input's actual focus handle.

## Candidate change

`TabStopMap::insert` updates `by_id` to the last registration but leaves earlier entries in the ordered tree. Their key includes insertion order. Reverse traversal therefore finds another entry for the same handle, while the next lookup starts from the final entry again. Keeping the ordering tree in sync with last-registration lookup avoids the repeated stop:

```diff
--- a/src/tab_stop.rs
+++ b/src/tab_stop.rs
@@ -85,7 +85,11 @@
             tab_stop: focus_handle.tab_stop,
             path,
         };
-        self.by_id.insert(focus_handle.id, order.clone());
+        // Re-registering a focus handle moves its one tab stop. Keep the
+        // ordered tree consistent with the last-registration lookup map.
+        if let Some(previous) = self.by_id.insert(focus_handle.id, order.clone()) {
+            self.order.remove(&previous, ());
+        }
         self.order.insert_or_replace(order, ());
     }

```

The candidate uses the existing SumTree removal API. Full native application accessibility behavior remains a separate acceptance check; this minimal test proves tab ordering only. No account paths, screenshots, recordings, image fixtures or settings are needed for the report.
