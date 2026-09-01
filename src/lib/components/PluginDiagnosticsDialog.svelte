<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import {
    CloseIcon,
    FolderOpenIcon,
    PlugCircleIcon,
    RefreshIcon,
    TrashBinMinimalisticIcon,
    WidgetIcon,
  } from "@solar-icons/svelte/bold-duotone";
  import { CheckCircleIcon, DangerCircleIcon } from "@solar-icons/svelte/bold-duotone";
  import { get } from "svelte/store";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import { diagnosticDetailForDisplay } from "$lib/diagnostic-message";
  import {
    commandErrorMessage,
    formatLocalizedMessage,
    translationMessage,
    type LocalizedMessage,
  } from "$lib/localized-message";
  import {
    loadCodecDiagnostics,
    pickSystemPaths,
    setSelectedHeicHelperPath,
    type CodecDiagnostics,
    type DiagnosticMessage,
    type ManifestDiagnostic,
    type ManifestSearchDirDiagnostic,
    type SystemCodecDiagnostic,
    type SystemHelperDiagnostic,
  } from "$lib/state.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let diagnostics = $state<CodecDiagnostics | null>(null);
  let loading = $state(false);
  let helperBusy = $state(false);
  let loadError = $state<LocalizedMessage | null>(null);
  let actionMessage = $state<LocalizedMessage | null>(null);
  let actionDiagnostic = $state<DiagnosticMessage | null>(null);
  let wasOpen = $state(false);

  const heic = $derived(diagnostics?.heic ?? null);
  const acceptedManifests = $derived(
    heic?.manifestDirs.flatMap((dir) =>
      dir.manifests.filter((manifest) => manifest.status === "accepted"),
    ) ?? [],
  );
  const rejectedManifests = $derived(
    heic?.manifestDirs.flatMap((dir) =>
      dir.manifests.filter((manifest) => manifest.status === "rejected"),
    ) ?? [],
  );
  const availableSystemCodecs = $derived(
    heic?.systemCodecs.filter((codec) => codec.available) ?? [],
  );
  const availableHelpers = $derived(heic?.systemHelpers.filter((helper) => helper.available) ?? []);

  $effect(() => {
    const opened = open && !wasOpen;
    wasOpen = open;
    if (!opened || loading) return;
    void refresh();
  });

  async function refresh() {
    loading = true;
    loadError = null;
    try {
      diagnostics = await loadCodecDiagnostics();
    } catch (error) {
      loadError = commandErrorMessage(error, "diagnostics.loadError");
    } finally {
      loading = false;
    }
  }

  async function chooseSelectedHelper() {
    if (helperBusy) return;
    helperBusy = true;
    actionMessage = null;
    actionDiagnostic = null;
    try {
      const selected = await pickSystemPaths({
        multiple: false,
        directory: false,
        title: get(t)("diagnostics.chooseHeicHelper") as string,
      });
      if (!selected[0]) return;
      const diagnostic = await setSelectedHeicHelperPath(selected[0]);
      if (diagnostic.available) {
        actionMessage = translationMessage("diagnostics.manualHelperEnabled");
      } else if (diagnostic.message) {
        actionDiagnostic = diagnostic.message;
      } else {
        actionMessage = translationMessage("diagnostics.manualHelperUnavailable");
      }
      await refresh();
    } catch (error) {
      actionMessage = commandErrorMessage(error, "diagnostics.setHelperFailed");
    } finally {
      helperBusy = false;
    }
  }

  async function clearSelectedHelper() {
    if (helperBusy) return;
    helperBusy = true;
    actionMessage = null;
    actionDiagnostic = null;
    try {
      await setSelectedHeicHelperPath(null);
      actionMessage = translationMessage("diagnostics.helperCleared");
      await refresh();
    } catch (error) {
      actionMessage = commandErrorMessage(error, "diagnostics.clearHelperFailed");
    } finally {
      helperBusy = false;
    }
  }

  function close() {
    open = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (open && event.key === "Escape") close();
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  function statusText(status: string): string {
    switch (status) {
      case "accepted":
        return "diagnostics.statusAccepted";
      case "ready":
        return "diagnostics.statusReady";
      case "rejected":
        return "diagnostics.statusRejected";
      case "missing":
        return "diagnostics.statusMissing";
      case "empty":
        return "diagnostics.statusEmpty";
      case "untrusted":
        return "diagnostics.statusUntrusted";
      case "unreadable":
        return "diagnostics.statusUnreadable";
      case "notDirectory":
        return "diagnostics.statusNotDirectory";
      case "unsupported":
        return "diagnostics.statusUnsupported";
      case "disabled":
        return "diagnostics.statusDisabled";
      default:
        return status;
    }
  }

  function statusTone(status: string): string {
    if (status === "accepted" || status === "ready") {
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    }
    if (status === "rejected" || status === "untrusted" || status === "unreadable") {
      return "border-destructive/35 bg-destructive/10 text-destructive";
    }
    return "border-border bg-muted text-muted-foreground";
  }

  const diagnosticMessageKeys: Record<string, string> = {
    externalCodecsBuildDisabled: "diagnostics.messages.externalCodecsBuildDisabled",
    externalCodecsBuildDisabledFlatpakEnabled:
      "diagnostics.messages.externalCodecsBuildDisabledFlatpakEnabled",
    externalCodecsEnvironmentDisabled: "diagnostics.messages.externalCodecsEnvironmentDisabled",
    externalCodecsEnvironmentDisabledFlatpakEnabled:
      "diagnostics.messages.externalCodecsEnvironmentDisabledFlatpakEnabled",
    externalCodecTrustUnsupported: "diagnostics.messages.externalCodecTrustUnsupported",
    desktopRuntimeRequired: "diagnostics.messages.desktopRuntimeRequired",
    selectedHelperNotConfigured: "diagnostics.messages.selectedHelperNotConfigured",
    selectedHelperUnavailable: "diagnostics.messages.selectedHelperUnavailable",
    directoryMissing: "diagnostics.messages.directoryMissing",
    pathNotDirectory: "diagnostics.messages.pathNotDirectory",
    directoryUntrusted: "diagnostics.messages.directoryUntrusted",
    manifestNotFound: "diagnostics.messages.manifestNotFound",
    directoryUnreadable: "diagnostics.messages.directoryUnreadable",
    manifestRejected: "diagnostics.messages.manifestRejected",
    pathEnvironmentMissing: "diagnostics.messages.pathEnvironmentMissing",
    helperNotFoundInTrustedPath: "diagnostics.messages.helperNotFoundInTrustedPath",
    wicUnsupportedPlatform: "diagnostics.messages.wicUnsupportedPlatform",
    wicAvailable: "diagnostics.messages.wicAvailable",
    wicMissing: "diagnostics.messages.wicMissing",
    wicProbeFailed: "diagnostics.messages.wicProbeFailed",
    windowsHeifInstallHint: "diagnostics.messages.windowsHeifInstallHint",
  };

  function diagnosticText(message: DiagnosticMessage): string {
    const key = diagnosticMessageKeys[message.code] ?? "diagnostics.messages.unknown";
    return $t(key, {
      values: {
        code: message.code,
        detail: diagnosticDetailForDisplay(
          message.detail,
          import.meta.env.DEV,
          $t("diagnostics.messages.detailsHidden") as string,
        ),
      },
    }) as string;
  }

  function providerKindText(kind: string): string {
    const key =
      kind === "manifest"
        ? "diagnostics.providerManifest"
        : kind === "system-helper"
          ? "diagnostics.systemHelper"
          : kind === "selected-helper"
            ? "diagnostics.manualHelper"
            : kind === "system-imageio"
              ? "diagnostics.systemImageIO"
              : kind === "system-wic"
                ? "diagnostics.windowsWIC"
                : null;
    return key ? ($t(key) as string) : kind;
  }

  function searchSourceText(source: string): string {
    const key =
      source === "explicit"
        ? "diagnostics.sourceExplicit"
        : source === "platform"
          ? "diagnostics.sourcePlatform"
          : source === "flatpak-extension"
            ? "diagnostics.sourceFlatpakExtension"
            : null;
    return key ? ($t(key) as string) : source;
  }

  function localizedText(message: LocalizedMessage, currentTranslation: unknown): string {
    void currentTranslation;
    return formatLocalizedMessage(message);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 grid bg-background/80 p-3 backdrop-blur-sm sm:place-items-center"
    role="presentation"
    onclick={handleBackdropClick}
  >
    <div
      class="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border bg-card shadow-xl sm:h-[min(82vh,820px)] sm:max-w-5xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plugin-diagnostics-title"
      tabindex="-1"
    >
      <header class="flex items-start gap-3 border-b px-4 py-3">
        <WidgetIcon size={22} class="mt-0.5 text-primary" />
        <div class="min-w-0 flex-1">
          <h2 id="plugin-diagnostics-title" class="text-sm font-semibold">
            {$t("diagnostics.title")}
          </h2>
          <p class="mt-1 text-xs text-muted-foreground">{$t("diagnostics.description")}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          title={$t("diagnostics.refresh")}
          onclick={refresh}
          disabled={loading}
        >
          <RefreshIcon size={20} class={loading ? "animate-spin" : ""} />
        </Button>
        <Button variant="ghost" size="icon" title={$t("diagnostics.close")} onclick={close}>
          <CloseIcon size={20} />
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-auto bg-background px-4 py-4">
        {#if loadError}
          <p
            class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {localizedText(loadError, $t)}
          </p>
        {:else if loading && !diagnostics}
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshIcon size={16} class="animate-spin" />
            {$t("diagnostics.loading")}
          </div>
        {:else if heic}
          <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
            <section class="rounded-lg border bg-card p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    {#if heic.enabled}
                      <CheckCircleIcon size={18} class="text-success" />
                      <h3 class="text-sm font-semibold">{$t("diagnostics.heicEnabled")}</h3>
                    {:else}
                      <DangerCircleIcon size={18} class="text-muted-foreground" />
                      <h3 class="text-sm font-semibold">{$t("diagnostics.heicDisabled")}</h3>
                    {/if}
                  </div>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {$t("diagnostics.extensions", {
                      values: { extensions: heic.extensions.join(" / ") },
                    })}
                  </p>
                  {#if heic.disabledReason}
                    <p class="mt-1 text-xs text-muted-foreground">
                      {diagnosticText(heic.disabledReason)}
                    </p>
                  {/if}
                </div>
                <span
                  class="rounded-md border px-2 py-1 text-xs {heic.enabled
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground'}"
                >
                  {heic.enabled ? $t("diagnostics.active") : $t("diagnostics.inactive")}
                </span>
              </div>

              {#if heic.activeProvider}
                <div class="mt-3 rounded-md border bg-background p-3">
                  <div class="flex items-center gap-2 text-sm font-medium">
                    <PlugCircleIcon size={16} class="text-primary" />
                    {heic.activeProvider.id}
                  </div>
                  <dl class="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div class="min-w-0">
                      <dt class="font-medium text-foreground">{$t("diagnostics.type")}</dt>
                      <dd>{providerKindText(heic.activeProvider.kind)}</dd>
                    </div>
                    <div class="min-w-0">
                      <dt class="font-medium text-foreground">{$t("diagnostics.license")}</dt>
                      <dd>
                        {heic.activeProvider.license ??
                          (heic.activeProvider.kind === "system-imageio"
                            ? $t("diagnostics.systemImageIO")
                            : heic.activeProvider.kind === "system-wic"
                              ? $t("diagnostics.windowsWIC")
                              : $t("diagnostics.systemHelper"))}
                      </dd>
                    </div>
                    <div class="min-w-0 sm:col-span-2">
                      <dt class="font-medium text-foreground">{$t("diagnostics.executable")}</dt>
                      <dd class="truncate" title={heic.activeProvider.path}>
                        {heic.activeProvider.path}
                      </dd>
                    </div>
                    <div class="min-w-0 sm:col-span-2">
                      <dt class="font-medium text-foreground">{$t("diagnostics.argv")}</dt>
                      <dd class="truncate font-mono" title={heic.activeProvider.args.join(" ")}>
                        {heic.activeProvider.args.length > 0
                          ? heic.activeProvider.args.join(" ")
                          : $t("diagnostics.noExternalArgs")}
                      </dd>
                    </div>
                  </dl>
                </div>
              {:else}
                <p
                  class="mt-3 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"
                >
                  {$t("diagnostics.noProvider")}
                </p>
              {/if}
            </section>

            <section class="rounded-lg border bg-card p-3">
              <h3 class="text-sm font-semibold">{$t("diagnostics.summaryTitle")}</h3>
              <dl class="mt-3 grid grid-cols-2 gap-2 text-xs">
                {@render SummaryStat(
                  $t("diagnostics.externalCodecs"),
                  heic.externalCodecsEnabled
                    ? $t("diagnostics.enabled")
                    : $t("diagnostics.disabled"),
                )}
                {@render SummaryStat(
                  $t("diagnostics.manualHelper"),
                  heic.selectedHelper.available
                    ? $t("diagnostics.available")
                    : heic.selectedHelper.configured
                      ? $t("diagnostics.unavailable")
                      : $t("diagnostics.notConfigured"),
                )}
                {@render SummaryStat($t("diagnostics.acceptedManifests"), acceptedManifests.length)}
                {@render SummaryStat($t("diagnostics.rejectedManifests"), rejectedManifests.length)}
                {@render SummaryStat($t("diagnostics.systemCodecs"), availableSystemCodecs.length)}
                {@render SummaryStat($t("diagnostics.systemHelpers"), availableHelpers.length)}
              </dl>
            </section>
          </div>

          <section class="mt-3 rounded-lg border bg-card p-3">
            <h3 class="text-sm font-semibold">{$t("diagnostics.licenseBoundaryTitle")}</h3>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">
              {$t("diagnostics.licenseBoundaryBody")}
            </p>
          </section>

          <section class="mt-3 rounded-lg border bg-card p-3">
            <h3 class="text-sm font-semibold">{$t("diagnostics.systemCodecsTitle")}</h3>
            <div class="mt-2 grid gap-2 md:grid-cols-2">
              {#each heic.systemCodecs as codec (codec.id)}
                {@render SystemCodecRow(codec)}
              {:else}
                <p class="text-sm text-muted-foreground">{$t("diagnostics.noSystemCodecs")}</p>
              {/each}
            </div>
          </section>

          <section class="mt-3 rounded-lg border bg-card p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">{$t("diagnostics.manualHelperTitle")}</h3>
              <div class="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onclick={chooseSelectedHelper}
                  disabled={helperBusy || !heic.externalCodecsEnabled}
                >
                  <FolderOpenIcon size={20} />
                  {$t("diagnostics.choose")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={clearSelectedHelper}
                  disabled={helperBusy || !heic.selectedHelper.configured}
                >
                  <TrashBinMinimalisticIcon size={20} />
                  {$t("diagnostics.clear")}
                </Button>
              </div>
            </div>
            {#if actionMessage || actionDiagnostic}
              <p class="mt-2 text-xs text-muted-foreground">
                {actionDiagnostic
                  ? diagnosticText(actionDiagnostic)
                  : actionMessage
                    ? localizedText(actionMessage, $t)
                    : ""}
              </p>
            {/if}
            {#if heic.selectedHelper.configured}
              <div class="mt-3 rounded-md border bg-background p-3">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-medium">
                    {heic.selectedHelper.available
                      ? $t("diagnostics.available")
                      : $t("diagnostics.unavailable")}
                  </span>
                  <span
                    class="rounded border px-1.5 py-0.5 text-[11px] {heic.selectedHelper.available
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground'}"
                  >
                    {$t("diagnostics.selected")}
                  </span>
                </div>
                <p
                  class="mt-2 truncate font-mono text-xs text-muted-foreground"
                  title={heic.selectedHelper.path ?? ""}
                >
                  {heic.selectedHelper.path}
                </p>
                {#if heic.selectedHelper.message}
                  <p class="mt-2 break-words font-mono text-[11px] leading-4 text-destructive">
                    {diagnosticText(heic.selectedHelper.message)}
                  </p>
                {/if}
              </div>
            {:else}
              <p
                class="mt-3 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"
              >
                {$t("diagnostics.notConfiguredHelper")}
              </p>
            {/if}
          </section>

          <section class="mt-3 rounded-lg border bg-card p-3">
            <h3 class="text-sm font-semibold">{$t("diagnostics.systemHelpersTitle")}</h3>
            <div class="mt-2 grid gap-2 md:grid-cols-2">
              {#each heic.systemHelpers as helper (helper.command)}
                {@render HelperRow(helper)}
              {:else}
                <p class="text-sm text-muted-foreground">{$t("diagnostics.webPreviewNoHelpers")}</p>
              {/each}
            </div>
          </section>

          <section class="mt-3 rounded-lg border bg-card p-3">
            <h3 class="text-sm font-semibold">{$t("diagnostics.manifestSearchTitle")}</h3>
            <div class="mt-2 space-y-2">
              {#each heic.manifestDirs as dir (`${dir.source}:${dir.path}`)}
                {@render ManifestDir(dir)}
              {:else}
                <p class="text-sm text-muted-foreground">
                  {$t("diagnostics.webPreviewNoManifests")}
                </p>
              {/each}
            </div>
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#snippet SummaryStat(label: string, value: number | string)}
  <div class="rounded-md border bg-background px-3 py-2">
    <dt class="text-muted-foreground">{label}</dt>
    <dd class="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
  </div>
{/snippet}

{#snippet SystemCodecRow(codec: SystemCodecDiagnostic)}
  <div class="rounded-md border bg-background p-3">
    <div class="flex items-center justify-between gap-2">
      <span class="font-mono text-xs font-medium">{codec.id}</span>
      <span
        class="rounded border px-1.5 py-0.5 text-[11px] {codec.available
          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground'}"
      >
        {codec.available ? $t("diagnostics.found") : $t("diagnostics.missing")}
      </span>
    </div>
    <p class="mt-2 text-xs text-muted-foreground">{diagnosticText(codec.message)}</p>
    {#if codec.installHint}
      <p class="mt-2 text-xs text-muted-foreground">{diagnosticText(codec.installHint)}</p>
    {/if}
    <p class="mt-2 font-mono text-[11px] text-muted-foreground">
      {providerKindText(codec.kind)} · {codec.readable.join(" / ")}
    </p>
  </div>
{/snippet}

{#snippet HelperRow(helper: SystemHelperDiagnostic)}
  <div class="rounded-md border bg-background p-3">
    <div class="flex items-center justify-between gap-2">
      <span class="font-mono text-xs font-medium">{helper.command}</span>
      <span
        class="rounded border px-1.5 py-0.5 text-[11px] {helper.available
          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground'}"
      >
        {helper.available ? $t("diagnostics.found") : $t("diagnostics.missing")}
      </span>
    </div>
    <p
      class="mt-2 truncate text-xs text-muted-foreground"
      title={helper.path ?? (helper.message ? diagnosticText(helper.message) : "")}
    >
      {helper.path ?? (helper.message ? diagnosticText(helper.message) : "")}
    </p>
  </div>
{/snippet}

{#snippet ManifestDir(dir: ManifestSearchDirDiagnostic)}
  <div class="rounded-md border bg-background p-3">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {searchSourceText(dir.source)}
          </span>
          <span class="rounded border px-1.5 py-0.5 text-[11px] {statusTone(dir.status)}">
            {$t(statusText(dir.status))}
          </span>
        </div>
        <p class="mt-2 truncate font-mono text-xs text-muted-foreground" title={dir.path}>
          {dir.path}
        </p>
      </div>
    </div>
    {#if dir.message}
      <p class="mt-2 text-xs text-muted-foreground">{diagnosticText(dir.message)}</p>
    {/if}

    {#if dir.manifests.length}
      <div class="mt-3 space-y-2">
        {#each dir.manifests as manifest (manifest.path)}
          {@render ManifestRow(manifest)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet ManifestRow(manifest: ManifestDiagnostic)}
  <div class="rounded-md border bg-card px-3 py-2">
    <div class="flex items-center justify-between gap-2">
      <p class="min-w-0 truncate font-mono text-xs" title={manifest.path}>
        {manifest.path}
      </p>
      <span class="shrink-0 rounded border px-1.5 py-0.5 text-[11px] {statusTone(manifest.status)}">
        {$t(statusText(manifest.status))}
      </span>
    </div>
    {#if manifest.provider}
      <p class="mt-1 text-xs text-muted-foreground">
        {manifest.provider.id} · {manifest.provider.license ?? $t("diagnostics.noLicense")}
      </p>
    {/if}
    {#if manifest.message}
      <p class="mt-1 break-words font-mono text-[11px] leading-4 text-destructive">
        {diagnosticText(manifest.message)}
      </p>
    {/if}
  </div>
{/snippet}
