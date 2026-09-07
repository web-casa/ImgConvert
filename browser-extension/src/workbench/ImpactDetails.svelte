<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import {
    STORAGE_IMPACT_MODEL_V1,
    calculateConversionImpact,
    formatImpactRange,
    scenarioAssumptions,
    type ByteReductionMeasurement,
    type ReplacementStatus,
  } from "@imgconvert/environmental-impact";
  let {
    measurement,
    numberLocale,
    excludedCount = 0,
    batch = false,
    formatBytes,
  }: {
    measurement: ByteReductionMeasurement | undefined;
    numberLocale: string;
    excludedCount?: number;
    batch?: boolean;
    formatBytes: (bytes: number) => string;
  } = $props();
  const zh = $derived(numberLocale.startsWith("zh"));
  let open = $state(false);
  let cloud = $state(false);
  let days = $state<number | undefined>(365);
  let copies = $state(0);
  let replacement = $state<ReplacementStatus>("hypothetical");
  function reset() {
    cloud = false;
    days = 365;
    copies = 0;
    replacement = "hypothetical";
  }
  const result = $derived.by(() => {
    if (!open || !cloud || !measurement) return undefined;
    try {
      return calculateConversionImpact(
        {
          comparable: true,
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

{#if measurement}
  <p class="impact-measurement" data-testid="impact-measurement">
    {batch
      ? zh
        ? "合资格结果净变化"
        : "Eligible results: net change"
      : zh
        ? "输出大小变化"
        : "Output size change"} ·
    {measurement.byteDifference > 0
      ? zh
        ? "减少"
        : "Smaller by"
      : measurement.byteDifference < 0
        ? zh
          ? "增加"
          : "Larger by"
        : zh
          ? "不变"
          : "Unchanged"}
    {formatBytes(Math.abs(measurement.byteDifference))}
  </p>
{/if}

<details
  class="impact-details"
  {open}
  ontoggle={(event) => {
    open = event.currentTarget.open;
    if (!open) reset();
  }}
>
  <summary>{zh ? "了解存储与环境影响" : "Explore storage and environmental impact"}</summary>
  <p>
    {zh
      ? "输出变小不代表磁盘空间已释放，也不代表已节电或减碳。"
      : "A smaller output does not establish freed disk space, electricity savings or avoided emissions."}
  </p>
  {#if batch}
    <p>
      {zh
        ? "此批量面板对上方合资格结果使用统一假设；不会合并单文件面板的替换状态或环境估算。"
        : "This batch panel applies one shared scenario to the eligible results above. It does not combine replacement states or estimates from individual panels."}
    </p>
  {/if}
  {#if excludedCount > 0}
    <p>
      {zh
        ? `另有 ${excludedCount} 个已完成结果不适合比较，未计入。`
        : `${excludedCount} other completed results are not comparable and are excluded.`}
    </p>
  {/if}
  {#if !measurement}
    <p>
      {zh
        ? "仅对单个静态栅格图片输出估算；文档、矢量图、动图及多输出结果不参与。"
        : "Estimates cover single static raster outputs only; documents, vectors, animations and multiple outputs are excluded."}
    </p>
  {:else}
    <label
      >{zh ? "存储情景" : "Storage scenario"}
      <select aria-label={zh ? "存储情景" : "Storage scenario"} bind:value={cloud}>
        <option value={false}
          >{zh ? "本地或未知：仅展示字节变化" : "Local or unknown: byte measurements only"}</option
        >
        <option value={true}
          >{zh ? "探索云存储假设" : "Explore a cloud storage hypothetical"}</option
        >
      </select>
    </label>
    {#if cloud}
      <label
        >{zh ? "原文件" : "Original files"}
        <select aria-label={zh ? "原文件" : "Original files"} bind:value={replacement}>
          <option value="hypothetical"
            >{zh ? "假设用输出替换原图" : "Assume outputs replace originals"}</option
          >
          <option value="confirmed"
            >{zh ? "我已替换原图（自行确认）" : "I replaced the originals (self-reported)"}</option
          >
          <option value="retained">{zh ? "仍保留原图" : "Originals are retained"}</option>
        </select>
      </label>
      <label
        >{zh ? "保留天数（0–3650）" : "Retention days (0–3650)"}<input
          type="number"
          min="0"
          max="3650"
          step="1"
          bind:value={days}
        /></label
      >
      <label
        >{zh ? "副本数" : "Copies"}<select bind:value={copies}
          ><option value={0}>1–3</option>{#each [1, 2, 3] as n (n)}<option value={n}>{n}</option
            >{/each}</select
        ></label
      >
      <div aria-live="polite">
        {#if result === "invalid"}
          <p role="alert">
            {zh ? "请输入 0 至 3650 的整数天数。" : "Enter a whole number of days from 0 to 3650."}
          </p>
        {:else if result?.kind === "estimate"}
          <p>
            <strong>{zh ? "云存储情景估算" : "Cloud storage scenario estimate"}</strong><br
            />{formatImpactRange(result.estimate.energyWattHours, "energy", numberLocale)} · {formatImpactRange(
              result.estimate.carbonGramsCo2,
              "carbon",
              numberLocale,
            )}
          </p>
          <p>
            {zh
              ? "采用平均容量分摊模型；这是假设范围，不是已实现或净减排，也不是置信区间。即使自行确认替换，仍只是估算。"
              : "Average capacity allocation; this is an assumption range, not achieved or net reductions or a confidence interval. Self-reported replacement remains an estimate."}
          </p>
        {:else if result?.kind === "unavailable"}
          <p>
            {result.reason === "original-retained"
              ? zh
                ? "原图仍保留，不能据此计算正向存储减排。"
                : "Retaining originals does not support a positive storage reduction estimate."
              : zh
                ? "输出没有净减少，不计算正向环境效益。"
                : "There is no net output reduction to estimate a positive benefit from."}
          </p>
        {/if}
      </div>
      <p>
        {zh
          ? "模型 v1.0.0 · 不含转换耗电、网络传输、硬件制造与处置；参数仅在当前面板内使用。"
          : "Model v1.0.0 · Excludes conversion energy, networks, hardware manufacture and disposal. Settings stay in this panel."}
      </p>
    {/if}
  {/if}
  <details class="impact-method">
    <summary>{zh ? "计算方法与来源（离线可读）" : "Method and sources (available offline)"}</summary
    >
    <p>
      {zh
        ? "模型 v1.0.0：容量（TB）× 保留小时数 × 0.65–1.2 Wh/TB·h × PUE 1.1–1.185 × 副本数 = 电量（Wh）。电量 ÷ 1000 × 473 g CO₂/kWh = 克 CO₂。碳强度为 2024 年全球平均；这些历史系数不代表特定供应商或本地设备。"
        : "Model v1.0.0: capacity (TB) × retention hours × 0.65–1.2 Wh/TB·h × PUE 1.1–1.185 × copies = energy (Wh). Energy ÷ 1000 × 473 g CO₂/kWh = grams CO₂. Grid intensity is the 2024 global average; historical factors do not describe a specific provider or local device."}
    </p>
    <p>
      {zh
        ? "这是平均容量分摊，不是边际节电、实际或净减排；范围不是置信区间。不含转换耗电、网络、制造、处置与反弹效应。参数仅在当前面板中使用，不保存或上传。1 MB = 1,000,000 字节；上方文件大小使用 KiB/MiB（二进制单位）。"
        : "Average capacity allocation, not marginal electricity savings or achieved or net reductions. The range is not a confidence interval. Excludes conversion energy, networks, manufacture, disposal and rebound effects. Parameters stay in this panel and are not saved or uploaded. 1 MB = 1,000,000 bytes; file sizes above use binary KiB/MiB."}
    </p>
    <ul>
      {#each STORAGE_IMPACT_MODEL_V1.sources as source (source.id)}<li>
          <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
        </li>{/each}
    </ul>
  </details>
</details>

<style>
  .impact-measurement {
    margin-block: 0.5rem;
    color: var(--ink);
    font-size: 0.8rem;
    line-height: 1.6;
  }
  .impact-method {
    margin-top: 0.75rem;
  }
  ul {
    padding-left: 1.2rem;
  }
  .impact-details {
    color: var(--ink);
    background: var(--paper);
    padding: 0.65rem;
    border-radius: 0.3rem;
    margin-block: 0.65rem;
    font-size: 0.8rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  summary {
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  p {
    color: inherit;
    margin-block: 0.6rem;
  }
  label {
    display: grid;
    gap: 0.25rem;
    margin-block: 0.65rem;
  }
  input,
  select {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 0.3rem;
    padding: 0.4rem;
  }
  option {
    color: #18221c;
    background: #fcf9f3;
  }
  a {
    color: inherit;
  }
  :focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 3px;
  }
</style>
