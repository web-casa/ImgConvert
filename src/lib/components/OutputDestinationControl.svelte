<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onMount } from "svelte";
  import { FolderOpen, WarningCircle, X } from "phosphor-svelte";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import { formatCommandError } from "$lib/command-error";
  import {
    chooseOutputDirectory,
    clearOutputDirectory,
    getRuntimeFileAccess,
    hasTemporaryQueuedInput,
    isTauriRuntime,
    outputDirectoryGrant,
    queue,
    settings,
    type RuntimeFileAccess,
    ui,
  } from "$lib/state.svelte";

  let access = $state<RuntimeFileAccess | null>(null);
  let feedback = $state<string | null>(null);
  const busy = $derived(ui.converting || ui.importing);
  const customDirectory = $derived(settings.outDir?.trim() ?? "");
  const hasTemporaryInput = $derived(hasTemporaryQueuedInput(queue));
  const checkingAccess = $derived(isTauriRuntime() && access === null);
  const needsSessionGrant = $derived(
    !!customDirectory &&
      !!access?.requiresOutputDirectorySessionGrant &&
      !outputDirectoryGrant.sessionGranted,
  );
  const needsDirectory = $derived(
    !customDirectory && (!!access?.requiresOutputDirectory || hasTemporaryInput),
  );
  const needsAttention = $derived(checkingAccess || needsSessionGrant || needsDirectory);
  const statusKey = $derived(
    !isTauriRuntime()
      ? "app.outputWebPreview"
      : checkingAccess
        ? "app.outputAccessChecking"
        : hasTemporaryInput && !customDirectory
          ? "app.outputFolderRequiredForClipboard"
          : needsSessionGrant
            ? "app.outputFolderReauthorizationRequired"
            : needsDirectory
              ? "app.outputFolderRequired"
              : customDirectory || "app.outputSourceFolders",
  );

  onMount(() => {
    if (!isTauriRuntime()) return;
    void getRuntimeFileAccess().then((value) => {
      access = value;
    });
  });

  async function selectDirectory() {
    if (busy || !isTauriRuntime()) return;
    feedback = null;
    try {
      await chooseOutputDirectory();
    } catch (error) {
      feedback = formatCommandError(error);
    }
  }

  async function resetDirectory() {
    if (busy) return;
    feedback = null;
    try {
      await clearOutputDirectory();
    } catch (error) {
      feedback = formatCommandError(error);
    }
  }
</script>

<div class="w-full min-w-0 sm:max-w-[32rem]" aria-live="polite">
  <div
    class={`flex min-w-0 items-center gap-2 rounded-md border bg-card/85 px-2.5 py-2 shadow-sm ${needsAttention ? "border-amber-500/55 bg-amber-500/8" : ""}`}
  >
    {#if needsAttention}
      <WarningCircle size={17} weight="fill" class="shrink-0 text-amber-600 dark:text-amber-300" />
    {:else}
      <FolderOpen size={17} weight="duotone" class="shrink-0 text-primary" />
    {/if}
    <div class="min-w-0 flex-1">
      <p class="text-[11px] font-medium text-muted-foreground">{$t("app.outputLocation")}</p>
      <p
        class="truncate text-xs font-medium text-foreground"
        title={customDirectory || $t(statusKey)}
        dir={customDirectory ? "ltr" : undefined}
      >
        {customDirectory || $t(statusKey)}
      </p>
      {#if customDirectory && (checkingAccess || needsSessionGrant)}
        <p class="mt-0.5 truncate text-[10px] leading-3 text-amber-700 dark:text-amber-300">
          {$t(statusKey)}
        </p>
      {/if}
    </div>
    {#if customDirectory}
      <Button
        variant="ghost"
        size="icon"
        class="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        onclick={resetDirectory}
        disabled={busy}
        aria-label={$t("app.clearOutputLocation")}
        title={$t("app.clearOutputLocation")}
      >
        <X size={16} />
      </Button>
    {/if}
    <Button
      variant={needsAttention ? "default" : "outline"}
      size="sm"
      class="shrink-0"
      onclick={selectDirectory}
      disabled={busy || !isTauriRuntime()}
    >
      <FolderOpen size={16} />
      {customDirectory ? $t("app.changeOutputLocation") : $t("app.chooseOutputLocation")}
    </Button>
  </div>
  {#if feedback}
    <p class="mt-1 text-right text-[11px] text-destructive">{feedback}</p>
  {/if}
</div>
