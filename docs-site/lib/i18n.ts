import { defineI18n } from "fumadocs-core/i18n";
import { uiTranslations } from "fumadocs-ui/i18n";

import { defaultDocsLocale, docsLocales } from "@/lib/locale-routing";

export const i18n = defineI18n({
  defaultLanguage: defaultDocsLocale,
  fallbackLanguage: null,
  hideLocale: "default-locale",
  languages: [...docsLocales],
});

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    "zh-CN": {
      "Ask AI(AI chat button)": "询问 AI",
      "Back to Home(404 page)": "返回首页",
      "Choose a language(language switcher)": "选择语言",
      "Choose a language(language switcher)(aria-label)": "选择语言",
      "Close Search(search dialog)(aria-label)": "关闭搜索",
      "Close Sidebar(aria-label)": "关闭侧边栏",
      "Collapse Sidebar(sidebar)(aria-label)": "折叠侧边栏",
      "Copied Text(code block)(aria-label)": "已复制",
      "Copy Anchor Link(heading anchor)(aria-label)": "复制标题链接",
      "Copy Text(code block)(aria-label)": "复制文本",
      "Dark(theme switcher)(aria-label)": "深色模式",
      "Edit on GitHub(edit page)": "在 GitHub 上编辑",
      "Hide Sidebar(sidebar)": "隐藏侧边栏",
      "Last updated on(page footer)": "最后更新于",
      "Light(theme switcher)(aria-label)": "浅色模式",
      "Next Page(pagination)": "下一页",
      "No Headings(table of contents)": "没有标题",
      "No results found(search dialog)": "没有找到结果",
      "On this page(table of contents)": "本页内容",
      "Open Search(search trigger)(aria-label)": "打开搜索",
      "Open Sidebar(sidebar)(aria-label)": "打开侧边栏",
      "Page Not Found(404 page)": "未找到页面",
      "Previous Page(pagination)": "上一页",
      "Search(search dialog)": "搜索",
      "Search(search trigger)": "搜索",
      "Show Sidebar(sidebar)": "显示侧边栏",
      "System(theme switcher)(aria-label)": "跟随系统",
      "Table of Contents(inline table of contents)": "目录",
      "Toggle Menu(mobile menu)(aria-label)": "切换菜单",
      "Toggle Theme(theme switcher)(aria-label)": "切换主题",
      displayName: "简体中文",
    },
    "en-US": {
      displayName: "English",
    },
  });
