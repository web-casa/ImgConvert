// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import { trapTabWithin } from "$lib/focus-trap";

function tabEvent(shiftKey = false): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "Tab", shiftKey, cancelable: true });
}

describe("modal focus trap", () => {
  let dialog: HTMLDivElement;
  let first: HTMLButtonElement;
  let last: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("tabindex");
    dialog = document.createElement("div");
    dialog.tabIndex = -1;
    first = document.createElement("button");
    last = document.createElement("button");
    dialog.append(first, last);
    document.body.append(dialog);
  });

  it("recovers focus into the modal when the active control becomes disabled", () => {
    last.focus();
    last.disabled = true;
    const event = tabEvent();

    expect(trapTabWithin(event, dialog)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("moves escaped focus to the directional modal boundary", () => {
    document.body.tabIndex = -1;
    document.body.focus();

    expect(trapTabWithin(tabEvent(), dialog)).toBe(true);
    expect(document.activeElement).toBe(first);

    document.body.focus();
    expect(trapTabWithin(tabEvent(true), dialog)).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("cycles between the first and last controls", () => {
    first.focus();
    expect(trapTabWithin(tabEvent(true), dialog)).toBe(true);
    expect(document.activeElement).toBe(last);

    expect(trapTabWithin(tabEvent(), dialog)).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("focuses the modal itself when no controls remain enabled", () => {
    first.disabled = true;
    last.disabled = true;

    expect(trapTabWithin(tabEvent(), dialog)).toBe(true);
    expect(document.activeElement).toBe(dialog);
  });

  it("does not target controls disabled by an ancestor fieldset", () => {
    const fieldset = document.createElement("fieldset");
    const nested = document.createElement("input");
    fieldset.disabled = true;
    fieldset.append(nested);
    dialog.prepend(fieldset);
    document.body.tabIndex = -1;
    document.body.focus();

    expect(trapTabWithin(tabEvent(), dialog)).toBe(true);
    expect(document.activeElement).toBe(first);
  });
});
