import { isTauri } from "@tauri-apps/api/core";
import { locale as osLocale } from "@tauri-apps/plugin-os";
import { init, locale as localeStore, register } from "svelte-i18n";
import { enUS } from "./messages/en-US";
import { zhCN } from "./messages/zh-CN";

export type AppLocale = "zh-CN" | "en-US";

export const locale = localeStore;

register("zh-CN", () => Promise.resolve(zhCN));
register("en-US", () => Promise.resolve(enUS));

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
    console.warn("读取系统语言失败,回退到浏览器语言:", error);
    return navigatorLocale();
  }
}

export async function initI18n(initialLocale?: AppLocale): Promise<void> {
  await init({
    fallbackLocale: "en-US",
    initialLocale: initialLocale ?? (await systemLocale()),
  });
}

export function setAppLocale(nextLocale: AppLocale): void {
  void locale.set(nextLocale);
}
