import "./global.css";

import type { Metadata } from "next";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/footer";

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
      <body className="flex min-h-screen flex-col font-sans">
        <RootProvider>
          <div className="flex flex-1 flex-col">
            <div className="flex-1">{children}</div>
            <SiteFooter />
          </div>
        </RootProvider>
      </body>
    </html>
  );
}
