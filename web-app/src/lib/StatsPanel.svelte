<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import LockKeyhole from "@lucide/svelte/icons/lock-keyhole";

  import type { Copy } from "./workbench";

  /** 本地处理路径统计:计数 + 出站 0 B。变体可用 CSS 去卡片化(纯排版)。 */
  let {
    copy,
    importedCount,
    checkedCount,
    convertedCount,
  }: {
    copy: Copy;
    importedCount: number;
    checkedCount: number;
    convertedCount: number;
  } = $props();
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
  <div class="outbound-row">
    <LockKeyhole size={15} aria-hidden="true" />{copy.rail.outbound}
  </div>
</aside>
