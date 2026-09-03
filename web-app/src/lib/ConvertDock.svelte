<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import CircleStop from "@lucide/svelte/icons/circle-stop";

  import type { Copy } from "./workbench";

  /** 转换按钮区:主按钮(开始/取消/再次转换)+ 尺寸错误或提示。 */
  let {
    copy,
    batchRunning,
    exportBusy,
    readyCount,
    convertedCount,
    dimensionError,
    onAction,
  }: {
    copy: Copy;
    batchRunning: boolean;
    exportBusy: boolean;
    readyCount: number;
    convertedCount: number;
    dimensionError: boolean;
    onAction: () => void;
  } = $props();
</script>

<div class="convert-area">
  <button
    class:cancel-button={batchRunning}
    type="button"
    disabled={!batchRunning &&
      (exportBusy || (readyCount === 0 && convertedCount === 0) || dimensionError)}
    aria-describedby={dimensionError ? "dimension-error" : "convert-hint"}
    onclick={onAction}
    >{batchRunning
      ? copy.actions.cancelConversion
      : readyCount === 0 && convertedCount > 0
        ? copy.settings.convertAgain
        : copy.settings.convert}{#if batchRunning}<CircleStop
        size={17}
        aria-hidden="true"
      />{:else}<ArrowRight size={17} aria-hidden="true" />{/if}</button
  >
  {#if !dimensionError}
    <p id="convert-hint">{copy.settings.convertHint}</p>
  {/if}
</div>
