<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { ClipboardText, FolderOpen, Images, StopCircle, UploadSimple } from "phosphor-svelte";
  import { get } from "svelte/store";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import { formatCommandError } from "$lib/command-error";
  import {
    cancelImportScan,
    importClipboard,
    importPaths,
    isTauriRuntime,
    pickSystemPaths,
    ui,
    readableExtensions,
  } from "$lib/state.svelte";

  const busy = $derived(ui.converting || ui.importing);
  const importErrorPreview = $derived(ui.importErrors.slice(0, 5));
  const hiddenImportErrors = $derived(
    Math.max(0, ui.importErrors.length - importErrorPreview.length),
  );

  async function pickFiles() {
    if (busy) return;

    if (!isTauriRuntime()) {
      ui.importMessage = get(t)("dropzone.webFilePickerUnavailable") as string;
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
      ui.importMessage = get(t)("dropzone.errorDropHint", {
        values: { error: formatCommandError(error) },
      } as any) as string;
    }
  }

  async function pickDirectories() {
    if (busy) return;

    if (!isTauriRuntime()) {
      ui.importMessage = get(t)("dropzone.webDirectoryPickerUnavailable") as string;
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
      ui.importMessage = get(t)("dropzone.errorFolderDropHint", {
        values: { error: formatCommandError(error) },
      } as any) as string;
    }
  }
</script>

<section
  class="rounded-lg border-2 border-dashed bg-card p-6 text-center transition-colors ease-[var(--motion-ease-img)]
         {ui.dragActive ? 'border-primary bg-primary/5' : 'border-border'}"
>
  <UploadSimple size={34} weight="duotone" class="mx-auto text-muted-foreground" />
  <p class="mt-2 text-sm font-medium">
    {ui.importing ? $t("dropzone.importing") : $t("dropzone.dropHint")}
  </p>
  <p class="mb-3 text-xs text-muted-foreground">{$t("dropzone.features")}</p>
  <div class="flex flex-wrap justify-center gap-2">
    <Button variant="outline" size="sm" onclick={pickFiles} disabled={busy}>
      <Images weight="duotone" />
      {$t("dropzone.chooseFiles")}
    </Button>
    <Button variant="outline" size="sm" onclick={pickDirectories} disabled={busy}>
      <FolderOpen weight="duotone" />
      {$t("dropzone.chooseFolder")}
    </Button>
    <Button variant="outline" size="sm" onclick={importClipboard} disabled={busy}>
      <ClipboardText weight="duotone" />
      {$t("dropzone.pasteImport")}
    </Button>
    {#if ui.importing}
      <Button
        variant="ghost"
        size="sm"
        onclick={cancelImportScan}
        disabled={ui.importCancelRequested}
      >
        <StopCircle weight="duotone" />
        {ui.importCancelRequested
          ? $t("dropzone.canceling")
          : ui.importMode === "clipboard"
            ? $t("dropzone.cancelImport")
            : $t("dropzone.cancelScan")}
      </Button>
    {/if}
  </div>
  {#if ui.importMessage}
    <p class="mt-3 text-xs text-muted-foreground">{ui.importMessage}</p>
  {/if}
  {#if ui.importErrors.length}
    <details class="mx-auto mt-3 max-w-3xl text-left text-xs text-muted-foreground">
      <summary class="cursor-pointer text-center hover:text-foreground">
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
          <li>{$t("dropzone.hiddenErrors", { values: { count: hiddenImportErrors } } as any)}</li>
        {/if}
      </ul>
    </details>
  {/if}
</section>
