// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! A Kit `Select` over fixed ids with translated labels, shared by the
//! settings form and the scenario panel. The id is the value a confirmation
//! resolves to, so two options with the same label stay distinct.

use gpui_kit::component::IndexPath;
use gpui_kit::component::searchable_list::SearchableListItem;
use gpui_kit::component::select::SelectState;
use gpui_kit::{
    App, AppContext as _, Entity, InteractiveElement as _, IntoElement, ParentElement as _, Role,
    SharedString, StatefulInteractiveElement as _, TestSupportExt as _, Window, div,
};

/// One option: a stable id as the value, a translated label as the text.
#[derive(Debug, Clone, PartialEq)]
pub struct ChoiceItem {
    id: String,
    label: SharedString,
}

impl ChoiceItem {
    pub fn new(id: impl Into<String>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn label(&self) -> &SharedString {
        &self.label
    }
}

impl SearchableListItem for ChoiceItem {
    type Value = String;

    fn title(&self) -> SharedString {
        self.label.clone()
    }

    fn value(&self) -> &Self::Value {
        &self.id
    }

    fn render(&self, _: &mut Window, _: &mut App) -> impl IntoElement {
        // Plain strings have no native AX node. Keep Kit's row selection and
        // click handling while giving its presentation a readable text node.
        div()
            .id(SharedString::from(format!("choice-label:{}", self.id)))
            .test_support()
            .role(Role::Label)
            .aria_value(self.label.clone())
            .child(self.label.clone())
    }
}

/// The retained select state plus the items it was built from.
pub struct Choice {
    state: Entity<SelectState<Vec<ChoiceItem>>>,
    items: Vec<ChoiceItem>,
}

impl Choice {
    pub fn new(items: Vec<ChoiceItem>, selected: &str, window: &mut Window, cx: &mut App) -> Self {
        let selected_ix = items.iter().position(|item| item.id == selected);
        let state = cx.new(|cx| {
            SelectState::new(
                items.clone(),
                selected_ix.map(|ix| IndexPath::default().row(ix)),
                window,
                cx,
            )
        });
        Self { state, items }
    }

    /// The Kit state to render with `Select::new` and to subscribe to.
    pub fn state(&self) -> &Entity<SelectState<Vec<ChoiceItem>>> {
        &self.state
    }

    /// The id currently committed in the select, if any.
    pub fn selected_id(&self, cx: &App) -> Option<String> {
        self.state
            .read(cx)
            .selected_index(cx)
            .and_then(|ix| self.items.get(ix.row))
            .map(|item| item.id.clone())
    }

    /// Replaces the items when ids or labels changed (the committed
    /// selection is rebuilt too, so a locale switch updates the accessible
    /// value) and moves the selection to `selected`. Idempotent.
    pub fn sync(
        &mut self,
        items: Vec<ChoiceItem>,
        selected: &str,
        window: &mut Window,
        cx: &mut App,
    ) {
        let replaced = items != self.items;
        if replaced {
            self.items.clone_from(&items);
            self.state
                .update(cx, |state, cx| state.set_items(items, window, cx));
        }
        let wanted = self.items.iter().position(|item| item.id == selected);
        let current = self.state.read(cx).selected_index(cx).map(|ix| ix.row);
        if replaced || wanted != current {
            self.state.update(cx, |state, cx| {
                state.set_selected_index(wanted.map(|ix| IndexPath::default().row(ix)), window, cx);
            });
        }
    }
}
