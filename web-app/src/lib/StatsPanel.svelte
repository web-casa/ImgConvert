<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ImpactDetails from "./ImpactDetails.svelte";
  import LockKeyhole from "@lucide/svelte/icons/lock-keyhole";

  import { formatBytes } from "./format";
  import type { QueueByteReductionSummary } from "./impact";
  import type { Copy } from "./workbench";

  /** 本地处理路径统计:计数 + 出站 0 B。变体可用 CSS 去卡片化(纯排版)。 */
  let {
    copy,
    importedCount,
    checkedCount,
    convertedCount,
    numberLocale,
    byteReduction,
  }: {
    copy: Copy;
    importedCount: number;
    checkedCount: number;
    convertedCount: number;
    numberLocale: string;
    byteReduction: QueueByteReductionSummary | undefined;
  } = $props();

  const reductionBasis = $derived(
    byteReduction
      ? copy.rail.outputReductionBasis.replace(
          "{count}",
          new Intl.NumberFormat(numberLocale).format(byteReduction.resultCount),
        )
      : "",
  );
</script>

<aside class="local-ledger" aria-labelledby="local-route-title">
  <div class="ledger-heading">
    <span id="local-route-title">{copy.rail.title}</span>
    <span class="live-dot">{copy.rail.localOnly}</span>
  </div>
  <ol class="route-steps">
    <li class:active={importedCount > 0}>
      <span>{importedCount}</span>{copy.rail.imported}
    </li>
    <li class:active={checkedCount > 0}>
      <span>{checkedCount}</span>{copy.rail.verified}
    </li>
    <li class:active={convertedCount > 0}>
      <span>{convertedCount}</span>{copy.rail.converted}
    </li>
  </ol>
  {#if byteReduction}
    <div class:no-reduction={byteReduction.measurement.savedBytes === 0} class="storage-reduction">
      <span class="storage-reduction-copy">
        <span id="storage-reduction-label">{copy.rail.outputReduction}</span>
        <small id="storage-reduction-basis">{reductionBasis}</small>
      </span>
      <strong>
        {byteReduction.measurement.savedBytes > 0
          ? formatBytes(byteReduction.measurement.savedBytes, numberLocale)
          : copy.rail.noNetReduction}
      </strong>
      <meter
        min="0"
        max={byteReduction.measurement.inputBytes}
        value={byteReduction.measurement.savedBytes}
        aria-labelledby="storage-reduction-label"
        aria-describedby="storage-reduction-basis"
      ></meter>
    </div>
    {#key byteReduction}
      <ImpactDetails
        batch
        measurement={byteReduction.measurement}
        {numberLocale}
        excludedCount={Math.max(0, convertedCount - byteReduction.resultCount)}
      />
    {/key}
  {/if}
  <div class="outbound-row">
    <LockKeyhole size={15} aria-hidden="true" />{copy.rail.outbound}
  </div>
</aside>
