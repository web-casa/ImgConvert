<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import {
    estimateStorageImpact,
    estimateDailyAccumulationImpact,
    formatImpactRange,
    scenarioAssumptions,
  } from "@imgconvert/environmental-impact";
  import { environmentCopy, environmentSources } from "./lib/environment";
  const locale = window.location.pathname.startsWith("/en/") ? "en" : "zh";
  const copy = environmentCopy[locale];
  const numberLocale = locale === "zh" ? "zh-CN" : "en-US";
  let mb = $state<number | undefined>(1);
  let days = $state<number | undefined>(365);
  let copies = $state(0);
  let cloud = $state(true);
  let retained = $state(false);
  let participation = $state<number | undefined>(100);
  let globalDays = $state<number | undefined>(365);
  let globalCopies = $state(1);
  const individual = $derived.by(() => {
    if (!cloud || retained) return undefined;
    try {
      if (mb === undefined || !Number.isFinite(mb) || mb < 0 || mb > 1_000_000)
        throw new RangeError();
      return estimateStorageImpact(
        Math.round(mb * 1_000_000),
        scenarioAssumptions(days ?? NaN, copies),
      );
    } catch {
      return "invalid" as const;
    }
  });
  const globalResult = $derived.by(() => {
    try {
      if (
        participation === undefined ||
        !Number.isFinite(participation) ||
        participation < 0 ||
        participation > 100 ||
        !globalDays ||
        globalDays < 1
      )
        throw new RangeError();
      return estimateDailyAccumulationImpact(
        {
          dailySavedBytes: Math.round((6_000_000_000 * participation) / 100) * 1_000_000,
          activeDays: globalDays,
        },
        scenarioAssumptions(globalDays, globalCopies),
      );
    } catch {
      return "invalid" as const;
    }
  });
  function reset() {
    mb = 1;
    days = 365;
    copies = 0;
    cloud = true;
    retained = false;
    participation = 100;
    globalDays = 365;
    globalCopies = 1;
  }
</script>

<a class="skip-link" href="#environment-main"
  >{locale === "zh" ? "跳转至正文" : "Skip to content"}</a
>
<div class="environment-shell">
  <header>
    <a class="brand" href={locale === "zh" ? "/" : "/en/"}
      >ImgConvert<span> / {locale === "zh" ? "环境" : "Environment"}</span></a
    >
    <nav aria-label={copy.home}>
      <a href="/convert/">{copy.convert} ↗</a><a
        href={locale === "zh" ? "/en/environment/" : "/environment/"}
        lang={locale === "zh" ? "en" : "zh-CN"}>{locale === "zh" ? "English" : "中文"}</a
      >
    </nav>
  </header>
  <main id="environment-main">
    <section class="environment-hero">
      <p class="eyebrow">{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p class="intro">{copy.intro}</p>
      <a href="#calculators">{copy.local} ↓</a>
    </section>
    <section class="lifecycle" aria-label={copy.local}>
      {#each copy.facts as fact, index (fact[0])}<article>
          <p class="eyebrow">{fact[0]}</p>
          <h2>{fact[1]}</h2>
          <p>{fact[2]}</p>
          {#if index === 2}<a href={environmentSources[3].url} rel="noreferrer">ITU / UNITAR ↗</a
            >{/if}
        </article>{/each}
    </section>
    <div id="calculators" class="calculators">
      <section class="calculator" aria-labelledby="individual-title">
        <p class="eyebrow">01 / MB → Wh → CO₂</p>
        <h2 id="individual-title">{copy.individual}</h2>
        <p>{copy.individualIntro}</p>
        <label class="check"><input type="checkbox" bind:checked={cloud} />{copy.cloud}</label>
        <label class="check"><input type="checkbox" bind:checked={retained} />{copy.retained}</label
        >
        <div class="controls">
          <label
            >{copy.mb}<input
              type="number"
              min="0"
              max="1000000"
              step="any"
              bind:value={mb}
            /></label
          ><label
            >{copy.days}<input type="number" min="0" max="3650" step="1" bind:value={days} /></label
          ><label
            >{copy.copies}<select bind:value={copies}
              ><option value={0}>1–3</option>{#each [1, 2, 3] as n (n)}<option value={n}>{n}</option
                >{/each}</select
            ></label
          >
        </div>
        <div class="estimate" aria-live="polite">
          {#if !cloud}<p>{copy.unknown}</p>{:else if retained}<p>
              {copy.retainedMessage}
            </p>{:else if individual === "invalid"}<p role="alert">
              {copy.invalid}
            </p>{:else if individual}<p class="eyebrow">{copy.estimate}</p>
            <dl>
              <dt>{copy.energy}</dt>
              <dd>{formatImpactRange(individual.energyWattHours, "energy", numberLocale)}</dd>
              <dt>{copy.carbon}</dt>
              <dd>{formatImpactRange(individual.carbonGramsCo2, "carbon", numberLocale)}</dd>
            </dl>
            <small>{copy.range}</small>{/if}
        </div>
      </section>
      <section class="calculator" aria-labelledby="global-title">
        <p class="eyebrow">02 / 1 MB × 6,000,000,000</p>
        <h2 id="global-title">{copy.global}</h2>
        <p>
          {copy.globalIntro} <a href={environmentSources[2].url} rel="noreferrer">ITU 2025 ↗</a>
        </p>
        <div class="controls">
          <label
            >{copy.participation}<input
              type="number"
              min="0"
              max="100"
              step="any"
              bind:value={participation}
            /></label
          ><label
            >{copy.days}<input
              type="number"
              min="1"
              max="3650"
              step="1"
              bind:value={globalDays}
            /></label
          ><label
            >{copy.copies}<select bind:value={globalCopies}
              >{#each [1, 2, 3] as n (n)}<option value={n}>{n}</option>{/each}</select
            ></label
          >
        </div>
        <div class="estimate" aria-live="polite">
          {#if globalResult === "invalid"}<p role="alert">{copy.invalid}</p>{:else}<p
              class="eyebrow"
            >
              {copy.estimate}
            </p>
            <dl>
              <dt>{copy.end}</dt>
              <dd>
                {new Intl.NumberFormat(numberLocale, { maximumSignificantDigits: 3 }).format(
                  globalResult.savedBytesAtPeriodEnd / 1e18,
                )} EB
              </dd>
              <dt>{copy.energy}</dt>
              <dd>{formatImpactRange(globalResult.energyWattHours, "energy", numberLocale)}</dd>
              <dt>{copy.carbon}</dt>
              <dd>{formatImpactRange(globalResult.carbonGramsCo2, "carbon", numberLocale)}</dd>
            </dl>
            <small>{copy.range}</small>{/if}
        </div>
      </section>
    </div>
    <div class="calculator-note">
      <p>{copy.privacy}</p>
      <button onclick={reset}>{copy.reset}</button>
    </div>
    <section class="method" id="method">
      <p class="eyebrow">v1.0.0 / 2026-09-05</p>
      <h2>{copy.method}</h2>
      <p>{copy.formula}</p>
      <p>
        {copy.factors} <a href={environmentSources[0].url} rel="noreferrer">CCF ↗</a> ·
        <a href={environmentSources[1].url} rel="noreferrer">Ember 2025 ↗</a>
      </p>
      <p class="limits">{copy.limits}</p>
    </section>
    <section class="actions">
      <h2>{copy.practical}</h2>
      <ul>
        {#each copy.actions as action (action)}<li>{action}</li>{/each}
      </ul>
    </section>
    <section class="sources">
      <h2>{copy.sources}</h2>
      <ul>
        {#each environmentSources as source (source.url)}<li>
            <a href={source.url} rel="noreferrer">{source.title} ↗</a>
          </li>{/each}
      </ul>
    </section>
  </main>
  <footer>
    <a href={locale === "zh" ? "/" : "/en/"}>ImgConvert / {copy.home}</a><a
      href={locale === "zh" ? "/privacy/" : "/en/privacy/"}
      >{locale === "zh" ? "隐私政策" : "Privacy"}</a
    >
  </footer>
</div>

<style>
  .environment-shell {
    max-width: 1160px;
    margin: auto;
    padding-inline: 32px;
  }
  header,
  nav,
  footer,
  .calculator-note {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  header,
  footer {
    padding-block: 28px;
    border-bottom: 1px solid var(--line);
  }
  .brand {
    font-weight: 750;
    text-decoration: none;
  }
  .brand span {
    font-weight: 400;
  }
  a {
    color: var(--green-deep);
    text-underline-offset: 0.25em;
  }
  .environment-hero {
    padding-block: 88px 72px;
    max-width: 860px;
  }
  h1 {
    font: 700 clamp(2.5rem, 5.4vw, 4.8rem)/1.12 var(--font-display);
    letter-spacing: -0.045em;
    margin: 24px 0;
    text-wrap: balance;
  }
  .intro {
    font-size: 1.25rem;
    max-width: 720px;
  }
  p,
  li {
    line-height: 1.85;
  }
  .eyebrow {
    font-size: 0.75rem;
    font-weight: 650;
    letter-spacing: 0.08em;
    color: var(--green-deep);
  }
  .lifecycle {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-strong);
  }
  .lifecycle article {
    padding: 28px 24px 28px 0;
  }
  .lifecycle article + article {
    padding-left: 24px;
    border-left: 1px solid var(--line);
  }
  h2 {
    font-size: 1.5rem;
    letter-spacing: -0.025em;
    line-height: 1.35;
  }
  .calculators {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 36px;
    padding-top: 64px;
    scroll-margin-top: 24px;
  }
  .calculator {
    min-width: 0;
  }
  .calculator > p {
    min-height: 6em;
  }
  .calculator > .eyebrow {
    min-height: auto;
  }
  .controls {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 12px;
    margin-block: 24px;
  }
  label {
    display: grid;
    gap: 8px;
    font-size: 0.85rem;
    line-height: 1.6;
  }
  .check {
    display: flex;
    align-items: start;
    margin-block: 12px;
  }
  input:not([type="checkbox"]),
  select,
  button {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    padding: 10px;
    background: var(--paper-raised);
    color: var(--ink);
    font: inherit;
  }
  input[type="checkbox"] {
    margin-top: 5px;
    accent-color: var(--green-deep);
  }
  .estimate {
    background: var(--sage);
    padding: 24px;
    min-height: 185px;
  }
  .estimate p {
    margin-top: 0;
  }
  dl {
    margin: 0;
  }
  dt {
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  dd {
    font-size: clamp(1.3rem, 2.1vw, 1.8rem);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    margin: 6px 0 20px;
    overflow-wrap: anywhere;
  }
  small {
    color: var(--ink-soft);
  }
  .calculator-note {
    font-size: 0.85rem;
    padding-block: 24px;
  }
  button {
    width: auto;
    cursor: pointer;
    flex-shrink: 0;
  }
  .method {
    border-top: 1px solid var(--line-strong);
    padding-block: 36px;
    max-width: 850px;
  }
  .limits {
    border-left: 3px solid var(--green);
    padding-left: 20px;
  }
  .actions,
  .sources {
    padding-bottom: 32px;
  }
  li {
    margin-block: 10px;
  }
  footer {
    border-top: 1px solid var(--line);
    border-bottom: 0;
  }
  :focus-visible {
    outline: 3px solid var(--green-deep);
    outline-offset: 4px;
  }
  @media (max-width: 760px) {
    .environment-shell {
      padding-inline: 20px;
    }
    header {
      align-items: start;
    }
    header,
    nav {
      flex-wrap: wrap;
      gap: 16px;
    }
    .environment-hero {
      padding-block: 48px;
    }
    .lifecycle,
    .calculators {
      grid-template-columns: 1fr;
    }
    .lifecycle article + article {
      border-left: 0;
      border-top: 1px solid var(--line);
      padding-left: 0;
    }
    .calculator > p {
      min-height: auto;
    }
    .controls {
      grid-template-columns: 1fr 1fr;
    }
    .controls label:first-child {
      grid-column: 1 / -1;
    }
    .calculator-note {
      align-items: start;
      flex-direction: column;
    }
  }
</style>
