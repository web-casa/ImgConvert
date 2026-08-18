import Link from "next/link";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";
import { NavIcon } from "@/components/icons";
import {
  highlights,
  formats,
  entryPoints,
  stats,
  downloadHref,
  repoHref,
  version,
} from "./_home-data";

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <main>
        {/* Hero with mockup */}
        <section className="m-hero">
          <div className="relative z-10 mx-auto max-w-6xl px-6 py-20 lg:py-28">
            <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.1fr]">
              <div className="m-rise">
                <span className="eyebrow mb-6">
                  <span className="size-1.5 rounded-full bg-[var(--imgconvert-lime)]" />
                  本地优先 · 图像批量转换管线
                </span>
                <h1 className="text-[2.4rem] md:text-[3rem] font-semibold leading-[1.08] tracking-tight">
                  把图像工作流，
                  <br />
                  <span className="relative inline-block">
                    装回你自己的机器
                    <span
                      aria-hidden
                      className="absolute -bottom-1 left-0 h-[6px] w-full rounded-full bg-[var(--imgconvert-lime)] opacity-70"
                    />
                  </span>
                </h1>
                <p className="mt-7 max-w-md text-base leading-7 text-[var(--imgconvert-ink-soft)]">
                  Tauri 2 + Rust 图像核心的桌面工具。拖拽导入、选择格式、压缩策略——
                  全部本机完成，不上传、不依赖云、无需网络。
                </p>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link className="btn-primary" href="/docs/install">
                    开始安装
                  </Link>
                  <a
                    className="btn-secondary"
                    href={downloadHref}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    下载 {version}
                  </a>
                </div>
                <div className="mt-6 flex flex-wrap gap-3 text-xs text-[var(--imgconvert-ink-soft)] mono">
                  <span>Apache-2.0</span>
                  <span aria-hidden>·</span>
                  <span>Linux first</span>
                  <span aria-hidden>·</span>
                  <span>amd64 + aarch64</span>
                </div>
              </div>

              {/* Mock browser window */}
              <div className="m-rise d2 relative hidden lg:block">
                <div className="m-window">
                  <div className="m-winbar">
                    <div className="m-winbar-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="m-wintitle">ImgConvert — 12 files queued</div>
                  </div>
                  <div className="m-winbody">
                    <aside className="m-side">
                      <div className="m-side-section">format</div>
                      <div className="m-side-item active">
                        <span className="m-side-dot" />
                        AVIF
                      </div>
                      <div className="m-side-item">
                        <span className="m-side-dot" />
                        WebP
                      </div>
                      <div className="m-side-item">
                        <span className="m-side-dot" />
                        JPEG
                      </div>
                      <div className="m-side-item">
                        <span className="m-side-dot" />
                        PNG
                      </div>
                      <div className="m-side-section">preset</div>
                      <div className="m-side-item">
                        <span className="m-side-dot" />
                        无损
                      </div>
                      <div className="m-side-item active">
                        <span className="m-side-dot" />
                        极致压缩
                      </div>
                    </aside>
                    <div className="m-canvas">
                      <div className="m-toolbar">
                        <span className="m-pill">质量 · 85</span>
                        <span className="m-pill">skip-if-larger ✓</span>
                      </div>
                      <div className="m-drop">
                        <div>
                          <NavIcon
                            name="image"
                            className="mx-auto mb-2 size-7 text-[var(--imgconvert-lime-deep)]"
                          />
                          <div className="text-sm font-medium">拖拽图片到这里</div>
                          <div className="mt-1 text-xs text-[var(--imgconvert-ink-soft)]">
                            JPEG · PNG · WebP · AVIF
                          </div>
                        </div>
                      </div>
                      <div className="m-files">
                        <div className="m-file">
                          <span className="mono text-xs">IMG_2024_mountains.jpg</span>
                          <span className="ext">AVIF</span>
                        </div>
                        <div className="m-file">
                          <span className="mono text-xs">portrait-alpha.png</span>
                          <span className="ext">AVIF</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="m-statusbar">
                    <span>● 本机 · 离线</span>
                    <span>0 / 12 已处理 · 1.2 MB saved</span>
                  </div>
                </div>

                <div className="m-floatcard hidden lg:block" style={{ top: "8%", right: "-5%" }}>
                  <div className="v">SPEED</div>
                  <div className="k mt-1">2 核 SIMD</div>
                  <div className="text-xs text-[var(--imgconvert-ink-soft)]">
                    oxipng + rav1e/aom
                  </div>
                </div>
                <div className="m-floatcard hidden lg:block" style={{ bottom: "10%", left: "-7%" }}>
                  <div className="v">PRIVACY</div>
                  <div className="k mt-1">零上传</div>
                  <div className="text-xs text-[var(--imgconvert-ink-soft)]">无遥测 · 无云调用</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats inline grid */}
        <section className="border-y border-[var(--imgconvert-line)]">
          <div className="mx-auto max-w-6xl px-6 py-8 grid grid-cols-2 sm:grid-cols-4 gap-6">
            {stats.map((s) => (
              <div key={s.label} className="m-rise d3">
                <div className="text-3xl font-semibold tracking-tight">{s.value}</div>
                <div className="mt-1 mono text-[0.7rem] uppercase tracking-wider text-[var(--imgconvert-ink-soft)]">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Highlights as polaroid cards */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-12 max-w-2xl">
            <span className="eyebrow mb-3 block">为什么选择 ImgConvert</span>
            <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">设计原则</h2>
            <span className="accent-rule mt-4" />
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {highlights.map((h, i) => (
              <article
                key={h.title}
                className="m-rise bg-[var(--surface-raised)] border border-[var(--imgconvert-line)] rounded-2xl p-7"
                style={{
                  transform: `rotate(${i === 1 ? "-1" : i === 2 ? "1" : "0"}deg)`,
                  transition: "transform .3s var(--ease-out)",
                }}
              >
                <div className="flex items-center justify-between">
                  <NavIcon name={h.icon} className="size-7 text-[var(--imgconvert-lime-deep)]" />
                  <span className="mono text-xs text-[var(--imgconvert-ink-soft)]">{h.index}</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold">{h.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--imgconvert-ink-soft)]">
                  {h.detail}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* Formats : magazine grid */}
        <section className="border-t border-[var(--imgconvert-line)] bg-[var(--surface-sunken)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-10 flex items-end justify-between gap-6 flex-wrap">
              <div>
                <span className="eyebrow mb-3 block">格式能力矩阵</span>
                <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">
                  支持的核心格式
                </h2>
              </div>
              <p className="max-w-md text-sm text-[var(--imgconvert-ink-soft)]">
                HEIC 通过平台系统能力或外部 helper 作为可选输入，不进入主 codec 矩阵。
              </p>
            </div>
            <div className="m-maggrid">
              {formats.map((f) => (
                <div key={f.name} className="flex flex-col gap-2">
                  <span className="mono text-[0.7rem] tracking-wider uppercase text-[var(--imgconvert-ink-soft)]">
                    {f.glyph}
                  </span>
                  <span className="text-2xl font-semibold tracking-tight">{f.name}</span>
                  <span className="text-sm text-[var(--imgconvert-ink-soft)]">{f.desc}</span>
                  <span className="mono text-[0.72rem] text-[var(--imgconvert-lime-deep)]">
                    {f.tag}
                  </span>
                </div>
              ))}
            </div>
            <Link
              href="/docs/heic"
              className="mt-6 inline-block text-sm text-[var(--imgconvert-lime-deep)] underline decoration-2 underline-offset-4"
            >
              详见 HEIC 策略 →
            </Link>
          </div>
        </section>

        {/* Entries */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-12 max-w-2xl">
            <span className="eyebrow mb-3 block">文档目录</span>
            <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">快速导航</h2>
            <span className="accent-rule mt-4" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {entryPoints.map(({ label, desc, href, icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-start gap-4 p-5 border border-[var(--imgconvert-line)] rounded-xl bg-[var(--surface-raised)] transition hover:border-[var(--imgconvert-lime)] hover:-translate-y-0.5"
              >
                <div className="grid size-9 place-items-center rounded-lg bg-[var(--imgconvert-lime-tint)] text-[var(--imgconvert-lime-deep)]">
                  <NavIcon name={icon} className="size-4" />
                </div>
                <div className="flex-1">
                  <div className="font-medium">{label}</div>
                  <div className="mt-1 text-sm text-[var(--imgconvert-ink-soft)]">{desc}</div>
                </div>
                <NavIcon
                  name="arrow"
                  className="size-4 text-[var(--imgconvert-ink-soft)] transition group-hover:text-[var(--imgconvert-lime-deep)] group-hover:translate-x-0.5"
                />
              </Link>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-[var(--imgconvert-line)] bg-[var(--surface-sunken)]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
              <div className="max-w-xl">
                <span className="eyebrow mb-3 block">开源 &amp; 上架友好</span>
                <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">
                  Apache-2.0 许可证
                </h2>
                <p className="mt-4 text-base leading-7 text-[var(--imgconvert-ink-soft)]">
                  主程序和核心依赖树均采用宽松许可证，适合个人使用、企业内部部署与商店上架。
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link className="btn-primary" href="/docs/install">
                  开始使用
                </Link>
                <a
                  className="btn-secondary"
                  href={repoHref}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  GitHub →
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}
