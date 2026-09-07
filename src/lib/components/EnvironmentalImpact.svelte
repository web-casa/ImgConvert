<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { t } from "svelte-i18n";
  import { locale } from "$lib/i18n";
  import {
    calculateConversionImpact,
    formatImpactRange,
    scenarioAssumptions,
    STORAGE_IMPACT_MODEL_V1,
    type ByteReductionMeasurement,
    type ReplacementStatus,
  } from "@imgconvert/environmental-impact";
  let {
    measurement,
    comparable = false,
    batchCount,
    excluded = 0,
  }: {
    measurement?: ByteReductionMeasurement;
    comparable?: boolean;
    batchCount?: number;
    excluded?: number;
  } = $props();
  let open = $state(false);
  let cloud = $state(false);
  let days = $state<number | undefined>(365);
  let copies = $state(0);
  let replacement = $state<ReplacementStatus>("hypothetical");
  const numberLocale = $derived($locale ?? "en-US");
  function reset() {
    cloud = false;
    days = 365;
    copies = 0;
    replacement = "hypothetical";
  }
  function formatBytes(bytes: number) {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let index = 0;
    while (bytes >= 1024 && index < units.length - 1) {
      bytes /= 1024;
      index++;
    }
    return `${new Intl.NumberFormat(numberLocale, { maximumSignificantDigits: 3 }).format(bytes)} ${units[index]}`;
  }
  const result = $derived.by(() => {
    if (!open || !cloud || !measurement || !comparable) return undefined;
    try {
      return calculateConversionImpact(
        {
          comparable,
          inputBytes: measurement.inputBytes,
          outputBytes: measurement.outputBytes,
          replacement,
        },
        scenarioAssumptions(days ?? NaN, copies),
      );
    } catch {
      return "invalid" as const;
    }
  });
</script>

<div
  class="environment-panel w-full min-w-0 rounded-md border bg-background p-3 text-xs text-foreground"
  data-testid="environment-panel"
>
  {#if batchCount !== undefined}<p>
      {$t("environment.batch", { values: { count: batchCount, excluded } })}
    </p>{/if}
  {#if measurement}<p class="mb-2 font-medium" data-testid="environment-measurement">
      {$t(
        measurement.byteDifference > 0
          ? "environment.smaller"
          : measurement.byteDifference < 0
            ? "environment.larger"
            : "environment.same",
        { values: { bytes: formatBytes(Math.abs(measurement.byteDifference)) } },
      )}
    </p>{/if}
  <details
    {open}
    ontoggle={(event) => {
      open = event.currentTarget.open;
      if (!open) reset();
    }}
  >
    <summary>{$t("environment.title")}</summary>
    <p>{$t("environment.boundary")}</p>
    {#if !measurement || !comparable}<p>{$t("environment.excluded")}</p>
    {:else}
      <label
        ><span>{$t("environment.storage")}</span><select
          aria-label={$t("environment.storage")}
          bind:value={cloud}
          ><option value={false}>{$t("environment.local")}</option><option value={true}
            >{$t("environment.cloud")}</option
          ></select
        ></label
      >
      {#if cloud}
        <div class="controls">
          <label class="original"
            ><span>{$t("environment.originals")}</span><select
              aria-label={$t("environment.originals")}
              bind:value={replacement}
              ><option value="hypothetical">{$t("environment.hypothetical")}</option><option
                value="confirmed">{$t("environment.confirmed")}</option
              ><option value="retained">{$t("environment.retained")}</option></select
            ></label
          >
          <label
            ><span>{$t("environment.days")}</span><input
              type="number"
              min="0"
              max="3650"
              step="1"
              bind:value={days}
            /></label
          >
          <label
            ><span>{$t("environment.copies")}</span><select
              aria-label={$t("environment.copies")}
              bind:value={copies}
              ><option value={0}>1–3</option>{#each [1, 2, 3] as n (n)}<option value={n}>{n}</option
                >{/each}</select
            ></label
          >
        </div>
        <div aria-live="polite">
          {#if result === "invalid"}<p role="alert">{$t("environment.invalid")}</p>
          {:else if result?.kind === "estimate"}<p>
              <strong>{$t("environment.estimate")}</strong><br />{formatImpactRange(
                result.estimate.energyWattHours,
                "energy",
                numberLocale,
              )} · {formatImpactRange(result.estimate.carbonGramsCo2, "carbon", numberLocale)}
            </p>
            <p>{$t("environment.limits")}</p>
          {:else if result?.kind === "unavailable"}<p>
              {$t(
                result.reason === "original-retained"
                  ? "environment.retainedNotice"
                  : "environment.noReduction",
              )}
            </p>{/if}
        </div>
      {/if}
    {/if}
    <details class="method">
      <summary>{$t("environment.method")}</summary>
      <p>{$t("environment.formula")}</p>
      <p>{$t("environment.privacy")}</p>
      <ul>
        {#each STORAGE_IMPACT_MODEL_V1.sources as source (source.id)}<li>
            {source.title}<br /><span class="select-text">{source.url}</span>
          </li>{/each}
      </ul>
    </details>
  </details>
</div>

<style>
  .environment-panel {
    line-height: 1.65;
    overflow-wrap: anywhere;
  }
  summary {
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  p,
  .method {
    margin-block: 0.7rem;
  }
  label {
    display: grid;
    gap: 0.3rem;
    margin-block: 0.6rem;
    min-width: 0;
  }
  input,
  select {
    color: var(--foreground);
    background: var(--background);
    width: 100%;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    padding: 0.5rem;
    font: inherit;
  }
  .controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .original {
    grid-column: 1 / -1;
  }
  :focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 3px;
  }
  li {
    margin-block: 0.5rem;
  }
</style>
