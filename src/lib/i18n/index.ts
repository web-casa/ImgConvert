import { isTauri } from "@tauri-apps/api/core";
import { locale as osLocale } from "@tauri-apps/plugin-os";
import { get } from "svelte/store";
import { addMessages, init, locale as localeStore, t } from "svelte-i18n";
import { enUS } from "./messages/en-US";
import { zhCN } from "./messages/zh-CN";

export type AppLocale = "zh-CN" | "en-US";

export const locale = localeStore;

// Both dictionaries are bundled statically. Register them before init so the
// locale is available during module-level translations in state.svelte.ts.
addMessages("zh-CN", zhCN);
addMessages("en-US", enUS);

// Set the initial locale synchronously so module-level consumers such as
// state.svelte.ts can format messages immediately.
const bootLocale = navigatorLocale();
void init({
  fallbackLocale: "en-US",
  initialLocale: bootLocale,
});

export function normalizeLocale(value: string | null | undefined): AppLocale {
  return value?.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function navigatorLocale(): AppLocale {
  return normalizeLocale(typeof navigator === "undefined" ? undefined : navigator.language);
}

export async function systemLocale(): Promise<AppLocale> {
  if (!isTauri()) {
    return navigatorLocale();
  }
  try {
    return normalizeLocale(await osLocale());
  } catch (error) {
    console.warn("Failed to read system locale, falling back to browser locale:", error);
    return navigatorLocale();
  }
}

export async function initI18n(initialLocale?: AppLocale): Promise<void> {
  const requested = initialLocale ?? (await systemLocale());
  if (get(locale) !== requested) {
    await locale.set(requested);
  }
}

export function setAppLocale(nextLocale: AppLocale): void {
  void locale.set(nextLocale);
}

export function translate(key: string, params?: Record<string, string | number>): string {
  return get(t)(key, params ? { values: params } : undefined) as string;
}
