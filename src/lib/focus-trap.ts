// SPDX-License-Identifier: Apache-2.0

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !element.closest('[hidden], [aria-hidden="true"]'),
  );
}

/**
 * Keeps Tab navigation inside a modal, including the case where the focused
 * control becomes disabled and the browser moves focus to body.
 */
export function trapTabWithin(event: KeyboardEvent, container: HTMLElement): boolean {
  if (event.key !== "Tab" || event.defaultPrevented) return false;

  const focusable = focusableElements(container);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    container.focus();
    return true;
  }

  const active = document.activeElement;
  if (
    !(active instanceof HTMLElement) ||
    !container.contains(active) ||
    !focusable.includes(active)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
