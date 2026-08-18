import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <span className="font-medium">ImgConvert</span>
          <span className="ml-2 text-xs opacity-40">Docs</span>
        </>
      ),
      url: "/",
    },
    links: [
      {
        text: "文档",
        url: "/docs",
        active: "url",
      },
      {
        text: "GitHub",
        url: "https://github.com/web-casa/ImgConvert",
        external: true,
      },
      {
        text: "Release",
        url: "https://github.com/web-casa/ImgConvert/releases/tag/v0.1.1",
        external: true,
      },
    ],
  };
}
