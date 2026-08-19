import Link from "next/link";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { notFound } from "next/navigation";

import { NavIcon } from "@/components/icons";
import { downloadHref, homeData, repoHref, version } from "@/lib/home-data";
import { baseOptions } from "@/lib/layout.shared";
import { getDocsLocale, localePath } from "@/lib/locale-routing";

type HomePageProps = {
  params: Promise<{
    lang: string;
  }>;
};

export default async function HomePage({ params }: HomePageProps) {
  const locale = getDocsLocale((await params).lang);

  if (!locale) {
    notFound();
  }

  const copy = homeData[locale];

  return (
    <HomeLayout {...baseOptions(locale)}>
      <main>
        <section className="m-hero">
          <div className="relative z-10 mx-auto max-w-6xl px-6 py-20 lg:py-28">
            <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.1fr]">
              <div className="m-rise">
                <span className="eyebrow mb-6">
                  <span className="size-1.5 rounded-full bg-[var(--imgconvert-lime)]" />
                  {copy.hero.eyebrow}
                </span>
                <h1 className="text-[2.4rem] font-semibold leading-[1.08] tracking-tight md:text-[3rem]">
                  {copy.hero.headingLeading}
                  <br />
                  <span className="relative inline-block">
                    {copy.hero.headingAccent}
                    <span
                      aria-hidden
                      className="absolute -bottom-1 left-0 h-[6px] w-full rounded-full bg-[var(--imgconvert-lime)] opacity-70"
                    />
                  </span>
                </h1>
                <p className="mt-7 max-w-md text-base leading-7 text-[var(--imgconvert-ink-soft)]">
                  {copy.hero.description}
                </p>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link className="btn-primary" href={localePath(locale, "/docs/install")}>
                    {copy.hero.install}
                  </Link>
                  <a
                    className="btn-secondary"
                    href={downloadHref}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {copy.hero.download} {version}
                  </a>
                </div>
                <div className="mt-6 flex flex-wrap gap-3 font-mono text-xs text-[var(--imgconvert-ink-soft)]">
                  <span>Apache-2.0</span>
                  <span aria-hidden>·</span>
                  <span>Linux first</span>
                  <span aria-hidden>·</span>
                  <span>amd64 + aarch64</span>
                </div>
              </div>

              <div className="m-rise d2 relative hidden lg:block">
                <div className="m-window">
                  <div className="m-winbar">
                    <div className="m-winbar-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="m-wintitle">{copy.mockup.queued}</div>
                  </div>
                  <div className="m-winbody">
                    <aside className="m-side">
                      <div className="m-side-section">{copy.mockup.format}</div>
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
                      <div className="m-side-section">{copy.mockup.preset}</div>
                      <div className="m-side-item">
                        <span className="m-side-dot" />
                        {copy.mockup.lossless}
                      </div>
                      <div className="m-side-item active">
                        <span className="m-side-dot" />
                        {copy.mockup.compression}
                      </div>
                    </aside>
                    <div className="m-canvas">
                      <div className="m-toolbar">
                        <span className="m-pill">{copy.mockup.quality}</span>
                        <span className="m-pill">{copy.mockup.skip}</span>
                      </div>
                      <div className="m-drop">
                        <div>
                          <NavIcon
                            className="mx-auto mb-2 size-7 text-[var(--imgconvert-lime-deep)]"
                            name="image"
                          />
                          <div className="text-sm font-medium">{copy.mockup.drop}</div>
                          <div className="mt-1 text-xs text-[var(--imgconvert-ink-soft)]">
                            JPEG · PNG · WebP · AVIF
                          </div>
                        </div>
                      </div>
                      <div className="m-files">
                        <div className="m-file">
                          <span className="font-mono text-xs">IMG_2024_mountains.jpg</span>
                          <span className="ext">AVIF</span>
                        </div>
                        <div className="m-file">
                          <span className="font-mono text-xs">portrait-alpha.png</span>
                          <span className="ext">AVIF</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="m-statusbar">
                    <span>{copy.mockup.offline}</span>
                    <span>{copy.mockup.processed}</span>
                  </div>
                </div>

                <div className="m-floatcard hidden lg:block" style={{ right: "-5%", top: "8%" }}>
                  <div className="v">SPEED</div>
                  <div className="k mt-1">{copy.mockup.cores}</div>
                  <div className="text-xs text-[var(--imgconvert-ink-soft)]">
                    oxipng + rav1e/aom
                  </div>
                </div>
                <div className="m-floatcard hidden lg:block" style={{ bottom: "10%", left: "-7%" }}>
                  <div className="v">PRIVACY</div>
                  <div className="k mt-1">{copy.mockup.noUpload}</div>
                  <div className="text-xs text-[var(--imgconvert-ink-soft)]">
                    {copy.mockup.noTelemetry}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-[var(--imgconvert-line)]">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-8 sm:grid-cols-4">
            {copy.stats.map((stat) => (
              <div className="m-rise d3" key={stat.label}>
                <div className="text-3xl font-semibold tracking-tight">{stat.value}</div>
                <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-wider text-[var(--imgconvert-ink-soft)]">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-12 max-w-2xl">
            <span className="eyebrow mb-3 block">{copy.sections.principlesEyebrow}</span>
            <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">
              {copy.sections.principlesTitle}
            </h2>
            <span className="accent-rule mt-4" />
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {copy.highlights.map((highlight, index) => (
              <article
                className="m-rise rounded-2xl border border-[var(--imgconvert-line)] bg-[var(--surface-raised)] p-7"
                key={highlight.title}
                style={{
                  transform: `rotate(${index === 1 ? "-1" : index === 2 ? "1" : "0"}deg)`,
                  transition: "transform .3s var(--ease-out)",
                }}
              >
                <div className="flex items-center justify-between">
                  <NavIcon
                    className="size-7 text-[var(--imgconvert-lime-deep)]"
                    name={highlight.icon}
                  />
                  <span className="font-mono text-xs text-[var(--imgconvert-ink-soft)]">
                    {highlight.index}
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-semibold">{highlight.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--imgconvert-ink-soft)]">
                  {highlight.detail}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-[var(--imgconvert-line)] bg-[var(--surface-sunken)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
              <div>
                <span className="eyebrow mb-3 block">{copy.sections.formatsEyebrow}</span>
                <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">
                  {copy.sections.formatsTitle}
                </h2>
              </div>
              <p className="max-w-md text-sm text-[var(--imgconvert-ink-soft)]">
                {copy.sections.formatsDescription}
              </p>
            </div>
            <div className="m-maggrid">
              {copy.formats.map((format) => (
                <div className="flex flex-col gap-2" key={format.name}>
                  <span className="font-mono text-[0.7rem] uppercase tracking-wider text-[var(--imgconvert-ink-soft)]">
                    {format.glyph}
                  </span>
                  <span className="text-2xl font-semibold tracking-tight">{format.name}</span>
                  <span className="text-sm text-[var(--imgconvert-ink-soft)]">{format.desc}</span>
                  <span className="font-mono text-[0.72rem] text-[var(--imgconvert-lime-deep)]">
                    {format.tag}
                  </span>
                </div>
              ))}
            </div>
            <Link
              className="mt-6 inline-block text-sm text-[var(--imgconvert-lime-deep)] underline decoration-2 underline-offset-4"
              href={localePath(locale, copy.sections.formatsLinkHref)}
            >
              {copy.sections.formatsLink}
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-12 max-w-2xl">
            <span className="eyebrow mb-3 block">{copy.sections.docsEyebrow}</span>
            <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">
              {copy.sections.navigationTitle}
            </h2>
            <span className="accent-rule mt-4" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {copy.entryPoints.map(({ desc, href, icon, label }) => (
              <Link
                className="group flex items-start gap-4 rounded-xl border border-[var(--imgconvert-line)] bg-[var(--surface-raised)] p-5 transition hover:-translate-y-0.5 hover:border-[var(--imgconvert-lime)]"
                href={localePath(locale, href)}
                key={href}
              >
                <div className="grid size-9 place-items-center rounded-lg bg-[var(--imgconvert-lime-tint)] text-[var(--imgconvert-lime-deep)]">
                  <NavIcon className="size-4" name={icon} />
                </div>
                <div className="flex-1">
                  <div className="font-medium">{label}</div>
                  <div className="mt-1 text-sm text-[var(--imgconvert-ink-soft)]">{desc}</div>
                </div>
                <NavIcon
                  className="size-4 text-[var(--imgconvert-ink-soft)] transition group-hover:translate-x-0.5 group-hover:text-[var(--imgconvert-lime-deep)]"
                  name="arrow"
                />
              </Link>
            ))}
          </div>
        </section>

        <section className="border-t border-[var(--imgconvert-line)] bg-[var(--surface-sunken)]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
              <div className="max-w-xl">
                <span className="eyebrow mb-3 block">{copy.sections.ctaEyebrow}</span>
                <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">
                  {copy.sections.ctaTitle}
                </h2>
                <p className="mt-4 text-base leading-7 text-[var(--imgconvert-ink-soft)]">
                  {copy.sections.ctaDescription}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link className="btn-primary" href={localePath(locale, "/docs/install")}>
                  {copy.sections.getStarted}
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
