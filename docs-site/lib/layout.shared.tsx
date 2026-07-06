import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "ImgConvert Docs",
      url: "/",
    },
    links: [
      {
        text: "文档",
        url: "/docs",
      },
      {
        text: "GitHub",
        url: "https://github.com/yeagoo/imgconvert",
      },
      {
        text: "Release",
        url: "https://github.com/yeagoo/imgconvert/releases/tag/v0.1.1",
      },
    ],
  };
}
