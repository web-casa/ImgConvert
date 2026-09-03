<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Upload from "@lucide/svelte/icons/upload";

  import type { AdmissionNotice, Copy } from "./workbench";

  /**
   * 拖放区:拖拽/点选/粘贴入口(粘贴监听在 App)与准入提示。
   * 事件行为与原版一致;dragActive 是本组件内部态,文件通过 onFiles 上抛。
   */
  let {
    copy,
    notices,
    onFiles,
  }: {
    copy: Copy;
    notices: AdmissionNotice[];
    onFiles: (files: readonly File[]) => void;
  } = $props();

  let dragActive = $state(false);

  function handleFileSelection(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    onFiles(Array.from(input.files ?? []));
    input.value = "";
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    dragActive = false;
    onFiles(Array.from(event.dataTransfer?.files ?? []));
  }
</script>

<label
  class:drag-active={dragActive}
  class="drop-zone"
  ondragenter={(event) => {
    event.preventDefault();
    dragActive = true;
  }}
  ondragover={(event) => event.preventDefault()}
  ondragleave={(event) => {
    if (event.currentTarget === event.target) dragActive = false;
  }}
  ondrop={handleDrop}
>
  <input
    class="file-input"
    type="file"
    name="images"
    accept=".jpg,.jpeg,.jfif,.png,.webp,.avif,.bmp,.gif,.svg,.pdf,image/jpeg,image/png,image/webp,image/avif,image/bmp,image/x-ms-bmp,image/gif,image/svg+xml,application/pdf"
    multiple
    onchange={handleFileSelection}
  />
  <span class="drop-icon"><Upload size={23} aria-hidden="true" /></span>
  <span class="drop-copy">
    <strong>{copy.drop.title}</strong>
    <span>{copy.drop.body}</span>
  </span>
  <span class="select-button">{copy.actions.select}<ArrowRight size={16} aria-hidden="true" /></span
  >
  <span class="format-row">
    <span>{copy.drop.formats}</span><i aria-hidden="true"></i><span>{copy.drop.limit}</span>
  </span>
  <small>{copy.drop.pasteHint}</small>
</label>

{#if notices.length > 0}
  <div class="admission-notices" aria-live="polite">
    {#each notices as notice (notice.id)}
      <p>
        <TriangleAlert size={16} aria-hidden="true" /><strong>{notice.name}</strong>
        {copy.errors[notice.failure.code]}
      </p>
    {/each}
  </div>
{/if}
