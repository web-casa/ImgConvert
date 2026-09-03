<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Download from "@lucide/svelte/icons/download";
  import HardDriveDownload from "@lucide/svelte/icons/hard-drive-download";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Wifi from "@lucide/svelte/icons/wifi";
  import WifiOff from "@lucide/svelte/icons/wifi-off";

  import type { Copy } from "./workbench";
  import type { PwaStatus } from "./pwa";

  let {
    canInstall,
    copy,
    isOnline,
    status,
    onCheckUpdate,
    onClearData,
    onInstall,
    onUpdate,
  }: {
    canInstall: boolean;
    copy: Copy;
    isOnline: boolean;
    status: PwaStatus;
    onCheckUpdate: () => void;
    onClearData: () => void;
    onInstall: () => void;
    onUpdate: () => void;
  } = $props();

  const statusText = $derived(
    status.updateAvailable
      ? copy.pwa.updateReady
      : status.phase === "cleared"
        ? copy.pwa.cleared
        : status.phase === "error"
          ? copy.pwa.error
          : status.phase === "unsupported"
            ? copy.pwa.unsupported
            : status.phase === "checking"
              ? copy.pwa.checking
              : status.offlineReady
                ? copy.pwa.ready
                : copy.pwa.preparing,
  );
</script>

<article class="pwa-panel" aria-labelledby="pwa-title">
  <div class="pwa-heading">
    <span class="pwa-icon"><HardDriveDownload size={19} aria-hidden="true" /></span>
    <div>
      <p class="section-label">OFFLINE / THIS DEVICE</p>
      <h2 id="pwa-title">{copy.pwa.title}</h2>
    </div>
    <span class:offline={!isOnline} class="network-state">
      {#if isOnline}<Wifi size={14} aria-hidden="true" />{:else}<WifiOff
          size={14}
          aria-hidden="true"
        />{/if}
      {isOnline ? copy.pwa.online : copy.pwa.offline}
    </span>
  </div>
  <div class="pwa-body">
    <div class="pwa-status" aria-live="polite">
      {#if status.phase === "error" || status.phase === "unsupported"}
        <CircleAlert size={18} aria-hidden="true" />
      {:else if status.phase === "checking" || status.phase === "registering"}
        <RefreshCw class="pwa-spinner" size={18} aria-hidden="true" />
      {:else}
        <CheckCircle2 size={18} aria-hidden="true" />
      {/if}
      <div><strong>{statusText}</strong><span>{copy.pwa.body}</span></div>
    </div>
    <div class="pwa-actions">
      {#if status.updateAvailable}
        <button class="pwa-primary" type="button" onclick={onUpdate}>
          <RefreshCw size={16} aria-hidden="true" />{copy.pwa.update}
        </button>
      {:else if canInstall}
        <button class="pwa-primary" type="button" onclick={onInstall}>
          <Download size={16} aria-hidden="true" />{copy.pwa.install}
        </button>
      {/if}
      {#if status.phase !== "unsupported"}
        <button
          type="button"
          disabled={!isOnline || status.phase === "checking"}
          onclick={onCheckUpdate}
        >
          <RefreshCw size={16} aria-hidden="true" />{copy.pwa.checkUpdate}
        </button>
      {/if}
      <button type="button" onclick={onClearData}>
        <Trash2 size={16} aria-hidden="true" />{copy.pwa.clearData}
      </button>
    </div>
  </div>
</article>
