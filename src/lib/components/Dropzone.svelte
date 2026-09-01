<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import {
    ClipboardTextIcon,
    FolderOpenIcon,
    GalleryWideIcon,
    StopCircleIcon,
  } from "@solar-icons/svelte/bold-duotone";
  import { get } from "svelte/store";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import dropzoneIllustrationUrl from "$lib/assets/dropzone-upload-v2.png";
  import {
    cancelImportScan,
    importClipboard,
    importPaths,
    isTauriRuntime,
    pickSystemPaths,
    queue,
    setImportCommandError,
    setImportMessage,
    ui,
    capabilities,
    formatLabel,
    readableExtensions,
  } from "$lib/state.svelte";

  const busy = $derived(ui.converting || ui.importing);
  const hasItems = $derived(queue.length > 0);
  const importErrorPreview = $derived(ui.importErrors.slice(0, 5));
  const hiddenImportErrors = $derived(
    Math.max(0, ui.importErrors.length - importErrorPreview.length),
  );
  const readableFormatOrder = ["jpeg", "png", "webp", "avif", "svg", "gif", "bmp", "heic", "pdf"];
  const readableFormats = $derived.by(() => {
    const available = new Set(capabilities.readable);
    const ordered = readableFormatOrder.filter(
      (format) => available.has(format) || format === "heic",
    );
    const remaining = capabilities.readable.filter((format) => !ordered.includes(format));
    return [...ordered, ...remaining];
  });
  const writableFormats = $derived([...capabilities.writable]);
  let formatsExpanded = $state(false);

  async function pickFiles() {
    if (busy) return;

    if (!isTauriRuntime()) {
      setImportMessage("dropzone.webFilePickerUnavailable");
      return;
    }

    try {
      const paths = await pickSystemPaths({
        multiple: true,
        title: get(t)("dropzone.chooseImages") as string,
        extensions: readableExtensions(),
      });
      if (busy || !paths.length) return;
      await importPaths(paths);
    } catch (error) {
      setImportCommandError(error, "dropzone.errorDropHint");
    }
  }

  async function pickDirectories() {
    if (busy) return;

    if (!isTauriRuntime()) {
      setImportMessage("dropzone.webDirectoryPickerUnavailable");
      return;
    }

    try {
      const paths = await pickSystemPaths({
        directory: true,
        multiple: true,
        title: get(t)("dropzone.chooseImageFolder") as string,
      });
      if (busy || !paths.length) return;
      await importPaths(paths);
    } catch (error) {
      setImportCommandError(error, "dropzone.errorFolderDropHint");
    }
  }
</script>

{#snippet formatDisclosure(compact: boolean)}
  <details bind:open={formatsExpanded} class="group mt-1 text-xs">
    <summary
      class="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 rounded px-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden {compact
        ? 'justify-start'
        : 'mx-auto justify-center'}"
    >
      <span>{$t("dropzone.supportedFormats.summary")}</span>
      <span aria-hidden="true">·</span>
      <span class="font-medium text-primary group-open:hidden">
        {$t("dropzone.supportedFormats.viewAll")}
      </span>
      <span class="hidden font-medium text-primary group-open:inline">
        {$t("dropzone.supportedFormats.collapse")}
      </span>
    </summary>
    <div
      class="mt-1.5 grid max-w-lg gap-2 rounded-md border bg-background/85 p-3 text-left shadow-sm {compact
        ? ''
        : 'mx-auto'}"
    >
      <div class="grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-2">
        <span class="pt-1 font-medium text-foreground">
          {$t("dropzone.supportedFormats.importLabel")}
        </span>
        <div class="flex flex-wrap gap-1.5">
          {#each readableFormats as format (format)}
            <span
              class="inline-flex items-center gap-1 rounded border px-2 py-1 text-foreground {format ===
              'heic'
                ? capabilities.heic
                  ? 'border-success/35 bg-success/10'
                  : 'border-border bg-muted text-muted-foreground'
                : 'border-border bg-card'}"
            >
              {format === "heic" ? "HEIC / HEIF" : formatLabel(format)}
              {#if format === "heic" && !capabilities.heic}
                <span>{$t("dropzone.supportedFormats.optional")}</span>
              {/if}
            </span>
          {/each}
        </div>
      </div>
      <div class="grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-2">
        <span class="pt-1 font-medium text-foreground">
          {$t("dropzone.supportedFormats.exportLabel")}
        </span>
        <div class="flex flex-wrap gap-1.5">
          {#each writableFormats as format (format)}
            <span class="rounded border border-border bg-card px-2 py-1 text-foreground">
              {formatLabel(format)}
            </span>
          {/each}
        </div>
      </div>
      <p class="text-xs leading-relaxed text-muted-foreground">
        {$t("dropzone.supportedFormats.note")}
      </p>
    </div>
  </details>
{/snippet}

{#snippet importActions(compact: boolean)}
  <div class="flex flex-wrap gap-2 {compact ? 'justify-end' : 'justify-center'}">
    <Button
      variant="outline"
      size="sm"
      class="min-h-11 sm:min-h-10"
      onclick={pickFiles}
      disabled={busy}
    >
      <GalleryWideIcon size={20} />
      {$t("dropzone.chooseFiles")}
    </Button>
    <Button
      variant="outline"
      size="sm"
      class="min-h-11 sm:min-h-10"
      onclick={pickDirectories}
      disabled={busy}
    >
      <FolderOpenIcon size={20} />
      {$t("dropzone.chooseFolder")}
    </Button>
    <Button
      variant="outline"
      size="sm"
      class="min-h-11 sm:min-h-10"
      onclick={importClipboard}
      disabled={busy}
    >
      <ClipboardTextIcon size={20} />
      {$t("dropzone.pasteImport")}
    </Button>
    {#if ui.importing}
      <Button
        variant="ghost"
        size="sm"
        onclick={cancelImportScan}
        disabled={ui.importCancelRequested}
      >
        <StopCircleIcon size={20} />
        {ui.importCancelRequested
          ? $t("dropzone.canceling")
          : ui.importMode === "clipboard"
            ? $t("dropzone.cancelImport")
            : $t("dropzone.cancelScan")}
      </Button>
    {/if}
  </div>
{/snippet}

<section
  class="rounded-lg border-2 border-dashed bg-card transition-colors ease-[var(--motion-ease-img)]
         {ui.dragActive ? 'border-primary bg-primary/10' : 'border-border'}
         {hasItems ? 'px-4 py-3' : 'px-6 py-8'}"
>
  {#if hasItems}
    <div
      class="flex min-h-[104px] flex-wrap gap-x-4 gap-y-3 {formatsExpanded
        ? 'items-start'
        : 'items-center'}"
    >
      <img
        src={dropzoneIllustrationUrl}
        alt=""
        class="w-20 shrink-0 select-none"
        width="80"
        height="53"
        aria-hidden="true"
        draggable="false"
      />
      <div class="min-w-0 flex-1 basis-56">
        <p class="text-sm font-medium">
          {ui.importing ? $t("dropzone.importing") : $t("dropzone.dropHint")}
        </p>
        {@render formatDisclosure(true)}
        <p class="text-xs text-muted-foreground">{$t("dropzone.features")}</p>
        {#if ui.importMessage}
          <p class="mt-1 text-xs text-muted-foreground">{ui.importMessage}</p>
        {/if}
      </div>
      {@render importActions(true)}
    </div>
  {:else}
    <div
      class="mx-auto flex min-h-[240px] max-w-xl flex-col items-center justify-center text-center"
    >
      <img
        src={dropzoneIllustrationUrl}
        alt=""
        class="w-[200px] select-none"
        width="200"
        height="133"
        aria-hidden="true"
        draggable="false"
      />
      <p class="mt-3 text-sm font-medium">
        {ui.importing ? $t("dropzone.importing") : $t("dropzone.dropHint")}
      </p>
      {@render formatDisclosure(false)}
      <p class="mb-3 text-xs text-muted-foreground">{$t("dropzone.features")}</p>
      {@render importActions(false)}
      {#if ui.importMessage}
        <p class="mt-3 text-xs text-muted-foreground">{ui.importMessage}</p>
      {/if}
    </div>
  {/if}
  {#if ui.importErrors.length}
    <details class="mx-auto mt-3 max-w-3xl text-left text-xs text-muted-foreground">
      <summary
        class="cursor-pointer rounded text-center outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {$t("dropzone.viewErrors")}
      </summary>
      <ul class="mt-2 space-y-1 rounded-md border bg-background p-2">
        {#each importErrorPreview as error (`${error.path}:${error.message}`)}
          <li class="min-w-0">
            <span class="font-medium text-foreground">{error.message}</span>
            <span class="block truncate" title={error.path}>{error.path}</span>
          </li>
        {/each}
        {#if hiddenImportErrors}
          <li>{$t("dropzone.hiddenErrors", { values: { count: hiddenImportErrors } })}</li>
        {/if}
      </ul>
    </details>
  {/if}
</section>
