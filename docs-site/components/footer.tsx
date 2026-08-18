import Link from "next/link";

import { NavIcon } from "@/components/icons";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          {/* Brand column */}
          <div className="flex items-center gap-3">
            <img
              alt="ImgConvert app icon"
              className="size-9 rounded-lg border border-[var(--imgconvert-line)]"
              height={36}
              src="/app-icon.png"
              width={36}
            />
            <div>
              <div className="text-sm font-semibold">ImgConvert</div>
              <div className="mono text-xs text-[var(--imgconvert-ink-soft)]">
                v0.1.2 · Apache-2.0
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-3">
            <FooterCol title="文档">
              <Link className="block" href="/docs/install">
                安装
              </Link>
              <Link className="block" href="/docs/usage">
                使用
              </Link>
              <Link className="block" href="/docs/commands">
                命令速查
              </Link>
            </FooterCol>
            <FooterCol title="工程">
              <Link className="block" href="/docs/architecture">
                架构
              </Link>
              <Link className="block" href="/docs/formats">
                格式能力
              </Link>
              <Link className="block" href="/docs/development">
                开发质量
              </Link>
            </FooterCol>
            <FooterCol title="资源">
              <a
                className="flex items-center gap-1.5"
                href="https://github.com/web-casa/ImgConvert"
                rel="noreferrer noopener"
                target="_blank"
              >
                GitHub
                <NavIcon name="arrow" className="size-3" />
              </a>
              <a
                className="flex items-center gap-1.5"
                href="https://github.com/web-casa/ImgConvert/releases"
                rel="noreferrer noopener"
                target="_blank"
              >
                Releases
                <NavIcon name="arrow" className="size-3" />
              </a>
            </FooterCol>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-[var(--imgconvert-line)] pt-5 text-xs text-[var(--imgconvert-ink-soft)] md:flex-row md:items-center md:justify-between">
          <span>本地优先 · 不上传任何图片 · 主依赖树禁 GPL / AGPL / LGPL</span>
          <span className="mono">© {new Date().getFullYear()} ImgConvert contributors</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 text-sm">
      <span className="eyebrow eyebrow-flush text-[0.65rem]">{title}</span>
      {children}
    </div>
  );
}
