# GPUI accessibility "press" clicks whatever is drawn at a scrolled-out node's position

## Versions and environment

- gpui-kit / gpui-base / gpui-component 0.7.1; gpui-pre 0.3.8; accesskit 0.24 / accesskit_macos 0.26.
- Observed natively on macOS 13.6 (arm64, Parallels VM) with VoiceOver on and with System Events `AXPress`, in the ImgConvert GPUI candidate built from `db5a98f`. The headless regression below needs two test-support hooks from the candidate patch, because the test platform has no accessibility adapter.
- Upstream report: **not filed**. Filing an issue is an outward-facing action and waits for the maintainer's authorization; this file is written so it can be posted as is.

## Cause

`Window::handle_a11y_action` (`src/window.rs`) handles `Action::Click` for nodes without their own listener by synthesizing a mouse-down/up at the centre of the node's recorded bounds. Those bounds are the element's layout bounds after the scroll offset, but they are not clipped to the enclosing scroll container. When the node is scrolled out of the viewport:

- if its centre lies outside the window, nothing happens (the press is silently lost);
- if its centre lies over another element (a header, a tab bar, a toolbar), **that element is clicked instead**.

`Action::ScrollIntoView` (macOS `AXScrollToVisible`, Windows `IScrollItemProvider::ScrollIntoView`) is not declared or handled, so assistive technology cannot bring the node into view first.

## Native reproduction (macOS)

1. Lay out a header or tab bar above an `overflow_y_scroll()` container whose children are buttons or switches with roles.
2. Scroll the container until a child sits under the header (its own rect is entirely above the viewport).
3. With VoiceOver on, move the VO cursor to that child and press VO-Space, or run `perform action "AXPress"` on it through System Events.

Observed: the header control is activated and the child is unchanged. In ImgConvert the settings switch "Lossless" scrolled under the tab bar switched the panel to the "Privacy" tab; a switch below the window's bottom edge ignored the press (value stayed `true`), while the same press on a visible switch toggled it.

## Headless regression

`apps/gpui/crates/shell/tests/a11y_actions.rs` (eight tests) uses a 40 px header above a 200 px scroll container of 30 rows. With the original click fallback, a press on the row scrolled under the header increments the header's click count (`left: 1, right: 0`), and a press on a row below the viewport, or a `ScrollIntoView`, leaves the row outside the viewport. The ImgConvert UI test `a11y_press_on_a_setting_scrolled_under_the_tabs_reaches_the_setting` fails with the active tab `Privacy` instead of `Format`.

## Candidate fix

- During prepaint, record for each accessibility node the content mask it was drawn under, the hitbox its own element inserted, and the chain of enclosing scroll containers (shared offset cell, viewport, maximum offset, scrolling axes). Nodes in the same containers share one chain. Hitboxes of elements that act on a pointer press (click, mouse-down or mouse-up listeners) are recorded too. Nodes inside a scroll container declare `Action::ScrollIntoView`.
- `Click` tries the centre of the node's *visible* part, then the rest of a three-by-three grid, and synthesizes the mouse events at the first point where hit testing reaches the node's own hitbox (the same test `Hitbox::is_hovered` applies) with no other pointer-press hitbox above it, such as a command button inside a row or a grip that only handles mouse-down. A parent's hitbox always lies below its children's. Otherwise it scrolls the node into view and tries once more, two frames later (the first frame applies the scroll, the second hit-tests the new layout). If the node still cannot be reached, nothing is clicked.
- `ScrollIntoView` moves the containers innermost first, only along the axes each one scrolls, aligning the node's nearest edge (its top edge when it is larger than the viewport), clamped to each container's range.
- While accessibility is active, cached views (`AnyView::cached`) do not reuse their previous prepaint, which would otherwise leave their nodes out of the tree. Cached subtrees therefore rebuild every frame while assistive technology is active.
- Test support gains `Window::simulate_a11y_activation` and `Window::simulate_a11y_action(id, action, cx)`. Like a platform adapter, the latter only performs actions the node declares (returning `false` otherwise); an id shared by several nodes panics instead of picking one.

Related, outside GPUI: a gpui-component `Popover` opens on its trigger wrapper's mouse-down, so a trigger `Button` without a click listener declares no `Click` and cannot be pressed by VoiceOver at all. ImgConvert gives its trigger an empty click listener.

Not covered: virtual lists that manage their own offsets (`list`, `uniform_list`) and content in deferred/anchored layers do not register enclosing scroll containers.
