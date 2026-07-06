import "./global.css";

import type { Metadata } from "next";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "ImgConvert Docs",
    template: "%s | ImgConvert Docs",
  },
  description: "ImgConvert 的发布、架构、格式能力与开发文档。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
