<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import LockKeyhole from "@lucide/svelte/icons/lock-keyhole";
  import Files from "@lucide/svelte/icons/files";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";

  import type { RasterOutputFormat } from "@imgconvert/conversion-contract";

  import { outputLabel } from "./format";
  import type { Copy } from "./workbench";

  /**
   * 输出设置:目标格式为单选卡片组,质量滑杆大触面。
   * 控件的 id/name/label 与原版一致,绑定直接落在 App 的 state 上。
   */
  let {
    copy,
    batchRunning,
    dimensionError,
    outputFormats,
    outputFormat = $bindable(),
    lossless = $bindable(),
    quality = $bindable(),
    resizeMode = $bindable(),
    resizeWidth = $bindable(),
    resizeHeight = $bindable(),
    jpegBackground = $bindable(),
    hasPdfEntries,
    pdfPageRange = $bindable(),
    pdfDpi = $bindable(),
    pdfDpiError,
    pdfPageError,
    pdfSettingsError,
  }: {
    copy: Copy;
    batchRunning: boolean;
    dimensionError: boolean;
    outputFormats: readonly RasterOutputFormat[];
    outputFormat: RasterOutputFormat;
    lossless: boolean;
    quality: number;
    resizeMode: "custom" | "original";
    resizeWidth: number;
    resizeHeight: number;
    jpegBackground: string;
    hasPdfEntries: boolean;
    pdfPageRange: string;
    pdfDpi: number;
    pdfDpiError: boolean;
    pdfPageError: boolean;
    pdfSettingsError: boolean;
  } = $props();

  const showLossless = $derived(outputFormat === "webp" || outputFormat === "avif");
  const showQuality = $derived(outputFormat !== "png" && !lossless);
</script>

<aside class="settings-panel" aria-labelledby="settings-title">
  <div class="settings-heading">
    <span><SlidersHorizontal size={18} aria-hidden="true" /></span>
    <div>
      <p class="section-label">OUTPUT / LOCAL</p>
      <h2 id="settings-title">{copy.settings.title}</h2>
    </div>
  </div>

  <fieldset class="settings-fields" disabled={batchRunning}>
    <legend class="sr-only">{copy.settings.title}</legend>

    <div class="settings-group">
      <div class="format-cards" role="radiogroup" aria-label={copy.settings.output}>
        {#each outputFormats as format (format)}
          <label class="format-card" class:selected={outputFormat === format}>
            <input type="radio" name="outputFormat" value={format} bind:group={outputFormat} />
            <span>{outputLabel(format)}</span>
          </label>
        {/each}
      </div>
    </div>

    {#if showLossless || showQuality}
      <div class="settings-group">
        {#if showLossless}
          <label class="check-row">
            <input type="checkbox" name="lossless" bind:checked={lossless} />
            <span
              ><strong>{copy.settings.lossless}</strong><small>{outputFormat.toUpperCase()}</small
              ></span
            >
          </label>
        {/if}
        {#if showQuality}
          <div class="label-row">
            <label for="quality">{copy.settings.quality}</label><output for="quality"
              >{quality}</output
            >
          </div>
          <input id="quality" type="range" name="quality" min="1" max="100" bind:value={quality} />
        {/if}
      </div>
    {/if}

    <div class="settings-group">
      <label for="resize-mode">{copy.settings.resize}</label>
      <select id="resize-mode" name="resizeMode" bind:value={resizeMode}>
        <option value="original">{copy.settings.originalSize}</option>
        <option value="custom">{copy.settings.customSize}</option>
      </select>
      {#if resizeMode === "custom"}
        <div class="dimension-grid">
          <label
            >{copy.settings.width}<input
              type="number"
              name="resizeWidth"
              min="1"
              max="65535"
              inputmode="numeric"
              autocomplete="off"
              aria-invalid={dimensionError}
              aria-describedby={dimensionError ? "dimension-error" : undefined}
              bind:value={resizeWidth}
            /></label
          >
          <label
            >{copy.settings.height}<input
              type="number"
              name="resizeHeight"
              min="1"
              max="65535"
              inputmode="numeric"
              autocomplete="off"
              aria-invalid={dimensionError}
              aria-describedby={dimensionError ? "dimension-error" : undefined}
              bind:value={resizeHeight}
            /></label
          >
        </div>
      {/if}
      {#if dimensionError}
        <p id="dimension-error" class="dimension-error-inline" role="status" aria-live="polite">
          {copy.settings.dimensionError}
        </p>
      {/if}
    </div>

    {#if hasPdfEntries}
      <div class="pdf-settings">
        <div class="pdf-settings-heading">
          <span><Files size={16} aria-hidden="true" /></span>
          <div>
            <strong>{copy.settings.pdfTitle}</strong>
            <small id="pdf-settings-hint">{copy.settings.pdfHint}</small>
          </div>
        </div>
        <div class="pdf-settings-grid">
          <div class="pdf-setting-field">
            <label for="pdf-pages">{copy.settings.pdfPages}</label>
            <input
              id="pdf-pages"
              type="text"
              name="pdfPages"
              autocomplete="off"
              spellcheck="false"
              aria-invalid={pdfPageError}
              aria-describedby={pdfPageError ? "pdf-settings-error" : "pdf-settings-hint"}
              bind:value={pdfPageRange}
            />
          </div>
          <div class="pdf-setting-field pdf-dpi-field">
            <label for="pdf-dpi">{copy.settings.pdfDpi}</label>
            <input
              id="pdf-dpi"
              type="number"
              name="pdfDpi"
              min="72"
              max="600"
              step="1"
              inputmode="numeric"
              autocomplete="off"
              aria-invalid={pdfDpiError}
              aria-describedby={pdfDpiError ? "pdf-settings-error" : "pdf-settings-hint"}
              bind:value={pdfDpi}
            />
          </div>
        </div>
        {#if pdfSettingsError}
          <p
            id="pdf-settings-error"
            class="dimension-error-inline"
            role="status"
            aria-live="polite"
          >
            {copy.settings.pdfError}
          </p>
        {/if}
      </div>
    {/if}

    {#if outputFormat === "jpeg"}
      <div class="settings-group color-group">
        <label for="jpeg-background">{copy.settings.background}</label>
        <input
          id="jpeg-background"
          type="color"
          name="jpegBackground"
          bind:value={jpegBackground}
        />
      </div>
    {/if}

    <div class="metadata-row">
      <LockKeyhole size={17} aria-hidden="true" />
      <div>
        <strong>{copy.settings.metadata}</strong><span>{copy.settings.metadataValue}</span>
      </div>
    </div>
  </fieldset>
</aside>
