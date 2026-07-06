import Link from "next/link";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";

const highlights = [
  {
    title: "本地优先",
    detail: "转换和压缩默认在本机完成，不上传用户图片。",
  },
  {
    title: "Linux 先行",
    detail: "第一期 GitHub Releases 已覆盖 arm64/aarch64 与 amd64 AppImage updater。",
  },
  {
    title: "许可边界",
    detail: "主程序 Apache-2.0，主依赖树禁止 GPL/AGPL/LGPL。",
  },
];

const entryPoints = [
  ["安装", "/docs/install"],
  ["使用", "/docs/usage"],
  ["排障", "/docs/troubleshooting"],
  ["命令", "/docs/commands"],
  ["发布", "/docs/release"],
  ["架构", "/docs/architecture"],
];

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <main>
        <section className="docs-hero">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
            <div className="flex flex-col justify-center">
              <p className="mono-label mb-5 w-fit border border-fd-border bg-fd-background px-3 py-1 text-xs uppercase text-fd-muted-foreground">
                ImgConvert / Local-first image pipeline
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">
                ImgConvert 文档站
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-fd-muted-foreground">
                面向安装、使用、排障、发布和开发维护的项目文档。这里聚合当前 GitHub Release
                第一批交付状态，并为后续 Flathub、macOS、Windows 留出清晰入口。
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  className="inline-flex h-11 items-center border border-fd-foreground bg-fd-foreground px-5 text-sm font-medium text-fd-background transition hover:bg-fd-muted-foreground"
                  href="/docs"
                >
                  阅读文档
                </Link>
                <Link
                  className="inline-flex h-11 items-center border border-fd-border bg-fd-background px-5 text-sm font-medium transition hover:bg-fd-muted"
                  href="https://github.com/yeagoo/imgconvert/releases/tag/v0.1.1"
                >
                  查看 v0.1.1
                </Link>
              </div>
            </div>

            <div className="grid content-center gap-3">
              <div className="flex items-center gap-4 border border-fd-foreground bg-fd-background p-5 shadow-[6px_6px_0_rgba(0,0,0,0.14)]">
                <img
                  alt="ImgConvert app icon"
                  className="size-16 border border-fd-border"
                  height={64}
                  src="/app-icon.png"
                  width={64}
                />
                <div>
                  <p className="mono-label text-xs text-fd-muted-foreground">v0.1.1</p>
                  <p className="mt-1 text-lg font-semibold">GitHub Releases first</p>
                </div>
              </div>
              {highlights.map((item, index) => (
                <div
                  className="border border-fd-border bg-fd-background/88 p-5 shadow-[6px_6px_0_rgba(0,0,0,0.08)]"
                  key={item.title}
                >
                  <p className="mono-label text-xs text-fd-muted-foreground">0{index + 1}</p>
                  <h2 className="mt-3 text-xl font-semibold">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            {entryPoints.map(([label, href]) => (
              <Link
                className="group border border-fd-border bg-fd-background p-5 transition hover:-translate-y-0.5 hover:border-fd-foreground"
                href={href}
                key={href}
              >
                <span className="text-sm font-medium">{label}</span>
                <span className="mt-5 block text-sm text-fd-muted-foreground group-hover:text-fd-foreground">
                  打开 →
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}
