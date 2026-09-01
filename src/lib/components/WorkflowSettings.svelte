<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { DisketteIcon, TrashBinMinimalisticIcon } from "@solar-icons/svelte/bold-duotone";
  import { t } from "svelte-i18n";
  import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
  import { translate } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";
  import * as Select from "$lib/components/ui/select";
  import { Switch } from "$lib/components/ui/switch";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import {
    MAX_PDF_DPI,
    MAX_PDF_PAGE_RANGE_CHARS,
    MIN_PDF_DPI,
    hasInvalidTargetSizeConfiguration,
    isPendingConversionItem,
    isTauriRuntime,
    isPdfItem,
    persistSettings,
    queue,
    settings,
    ui,
    validatePdfPageRange,
  } from "$lib/state.svelte";
  import {
    BUILTIN_WORKFLOW_PRESETS,
    MAX_CUSTOM_PRESETS,
    MAX_PRESET_NAME_CHARS,
    MAX_TARGET_SIZE_KIB,
    MIN_TARGET_SIZE_KIB,
    applyWorkflowSnapshot,
    createCustomWorkflowPreset,
    matchingWorkflowPresetId,
    type MetadataPolicy,
    type ResizeMode,
  } from "$lib/workflow-presets";

  type NumericWorkflowField =
    "resizeWidth" | "resizeHeight" | "resizeValue" | "targetSizeKib" | "pdfDpi";

  const busy = $derived(ui.converting || ui.importing);
  const activePresetId = $derived(matchingWorkflowPresetId(settings));
  const activeBuiltin = $derived(
    BUILTIN_WORKFLOW_PRESETS.find((preset) => preset.id === activePresetId),
  );
  const targetFormatSupported = $derived(["jpeg", "webp"].includes(settings.format));
  const invalidTargetWorkflow = $derived(hasInvalidTargetSizeConfiguration());
  const resizeEnabled = $derived(settings.resizeMode !== "none");
  const pdfItems = $derived(
    queue.filter((item) => isPendingConversionItem(item) && isPdfItem(item)),
  );
  const pdfRangeError = $derived.by(() => {
    // The validator returns localized copy. Subscribe this derivation to locale changes so an
    // already-visible inline error changes language with the rest of the settings drawer.
    $t("workflow.pdfRangeInvalid");
    return (
      pdfItems
        .map((item) =>
          validatePdfPageRange(settings.pdfPageRange, item.metadata?.pageCount ?? null),
        )
        .find((error) => error !== null) ?? validatePdfPageRange(settings.pdfPageRange)
    );
  });
  const singleResizeField = $derived(
    settings.resizeMode === "width"
      ? "resizeWidth"
      : settings.resizeMode === "height"
        ? "resizeHeight"
        : "resizeValue",
  );
  let presetName = $state("");

  function commit() {
    settings.preserveMetadata = settings.metadataPolicy === "preserveAll";
    persistSettings();
  }

  function applyPreset(id: string) {
    if (busy || id === "__custom") return;
    const selected =
      BUILTIN_WORKFLOW_PRESETS.find((preset) => preset.id === id) ??
      settings.customWorkflowPresets.find((preset) => preset.id === id);
    if (!selected) return;
    applyWorkflowSnapshot(settings, selected.snapshot);
    if (settings.targetSizeEnabled) {
      settings.autoQuality = false;
      settings.lossless = false;
    }
    commit();
  }

  function savePreset() {
    if (busy || settings.customWorkflowPresets.length >= MAX_CUSTOM_PRESETS) return;
    let sequence = settings.customWorkflowPresets.length;
    let id = "";
    do {
      id = `custom:${Date.now().toString(36)}-${sequence++}`;
    } while (settings.customWorkflowPresets.some((preset) => preset.id === id));
    const created = createCustomWorkflowPreset(id, presetName, settings);
    if (!created) return;
    settings.customWorkflowPresets.push(created);
    presetName = "";
    commit();
  }

  async function deletePreset(id: string) {
    if (busy || !id.startsWith("custom:")) return;
    const index = settings.customWorkflowPresets.findIndex((preset) => preset.id === id);
    if (index < 0) return;
    const preset = settings.customWorkflowPresets[index];
    if (!preset) return;
    const message = translate("workflow.confirmDeletePreset", { name: preset.name });
    // Native dialog on the desktop runtime (requires dialog:allow-message);
    // the web preview falls back to the browser confirmation.
    const confirmed = isTauriRuntime()
      ? await confirmDialog(message, {
          title: translate("workflow.deletePreset"),
          kind: "warning",
          okLabel: translate("workflow.deletePreset"),
          cancelLabel: translate("state.cancel"),
        })
      : window.confirm(message);
    if (!confirmed) return;
    settings.customWorkflowPresets.splice(index, 1);
    persistSettings();
  }

  function setResizeMode(value: string) {
    if (busy) return;
    if (!["none", "fit", "width", "height", "longestEdge", "percentage"].includes(value)) {
      return;
    }
    settings.resizeMode = value as ResizeMode;
    if (value === "percentage") settings.resizeValue = Math.min(400, settings.resizeValue);
    commit();
  }

  function setNumber(field: NumericWorkflowField, raw: string, min: number, max: number) {
    if (busy) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    settings[field] = Math.min(max, Math.max(min, Math.round(parsed)));
    commit();
  }

  function setAllowUpscale(checked: boolean) {
    if (busy) return;
    settings.resizeAllowUpscale = checked;
    commit();
  }

  function setTargetEnabled(checked: boolean) {
    if (busy || (checked && !targetFormatSupported)) return;
    settings.targetSizeEnabled = checked;
    if (checked) {
      settings.autoQuality = false;
      settings.lossless = false;
    }
    commit();
  }

  function setMetadataPolicy(value: string) {
    if (busy || !["stripAll", "colorOnly", "preserveAll"].includes(value)) return;
    settings.metadataPolicy = value as MetadataPolicy;
    commit();
  }

  function setPdfPageRange(value: string) {
    if (busy) return;
    settings.pdfPageRange = value.slice(0, MAX_PDF_PAGE_RANGE_CHARS);
  }
</script>

<section class="px-4 py-3">
  <h3 class="text-sm font-semibold">{$t("workflow.preset")}</h3>

  <div class="mt-3 space-y-4">
    <div class="space-y-1.5">
      <Select.Root
        type="single"
        value={activePresetId ?? "__custom"}
        disabled={busy}
        onValueChange={applyPreset}
      >
        <Select.Trigger
          class="min-h-11 w-full sm:min-h-10"
          disabled={busy}
          aria-label={$t("workflow.preset")}
        >
          {activeBuiltin
            ? $t(activeBuiltin.labelKey)
            : (settings.customWorkflowPresets.find((preset) => preset.id === activePresetId)
                ?.name ?? $t("workflow.customSettings"))}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="__custom" label={$t("workflow.customSettings")}>
            {$t("workflow.customSettings")}
          </Select.Item>
          {#each BUILTIN_WORKFLOW_PRESETS as preset (preset.id)}
            <Select.Item value={preset.id} label={$t(preset.labelKey)}>
              {$t(preset.labelKey)}
            </Select.Item>
          {/each}
          {#each settings.customWorkflowPresets as preset (preset.id)}
            <Select.Item value={preset.id} label={preset.name}>{preset.name}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      {#if activeBuiltin}
        <p class="text-[11px] leading-4 text-muted-foreground">
          {$t(activeBuiltin.descriptionKey)}
        </p>
      {/if}
    </div>

    <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <input
        class="h-11 min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-10"
        value={presetName}
        maxlength={MAX_PRESET_NAME_CHARS}
        placeholder={$t("workflow.presetName")}
        aria-label={$t("workflow.presetName")}
        disabled={busy || settings.customWorkflowPresets.length >= MAX_CUSTOM_PRESETS}
        oninput={(event) => (presetName = event.currentTarget.value)}
      />
      <Button
        class="min-h-11 sm:min-h-10"
        variant="outline"
        size="sm"
        onclick={savePreset}
        disabled={busy ||
          !presetName.trim() ||
          settings.customWorkflowPresets.length >= MAX_CUSTOM_PRESETS}
      >
        <DisketteIcon size={20} />
        {$t("workflow.savePreset")}
      </Button>
      <p class="col-span-2 text-[11px] text-muted-foreground">
        {$t("workflow.presetLimit", { values: { count: MAX_CUSTOM_PRESETS } })}
      </p>
      {#if settings.customWorkflowPresets.length}
        <div class="col-span-2 max-h-40 space-y-1 overflow-y-auto">
          {#each settings.customWorkflowPresets as preset (preset.id)}
            <div
              class="flex items-center justify-between gap-2 rounded-md border bg-background/60 py-1 pl-2"
            >
              <span class="truncate text-xs" title={preset.name}>{preset.name}</span>
              <Button
                variant="ghost"
                size="icon"
                class="size-11 shrink-0 sm:size-10"
                onclick={() => void deletePreset(preset.id)}
                disabled={busy}
                aria-label={`${$t("workflow.deletePreset")}: ${preset.name}`}
              >
                <TrashBinMinimalisticIcon size={14} />
              </Button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</section>

<SettingsSection
  title={$t("workflow.pdfTitle")}
  summary={settings.pdfPageRange.trim()
    ? $t("workflow.pdfSelectedPages")
    : $t("workflow.pdfAllPages")}
  error={pdfRangeError !== null}
>
  <fieldset class="space-y-3" disabled={busy}>
    <label class="block space-y-1 text-xs text-muted-foreground">
      <span>{$t("workflow.pdfPages")}</span>
      <input
        class="h-11 w-full rounded-md border bg-background px-2 text-sm text-foreground sm:h-10"
        class:border-destructive={pdfRangeError !== null}
        value={settings.pdfPageRange}
        maxlength={MAX_PDF_PAGE_RANGE_CHARS}
        placeholder={$t("workflow.pdfPagesPlaceholder")}
        aria-invalid={pdfRangeError !== null}
        aria-describedby="pdf-page-range-help"
        oninput={(event) => setPdfPageRange(event.currentTarget.value)}
        onchange={() => commit()}
      />
    </label>
    <p
      id="pdf-page-range-help"
      class="text-[11px] leading-4"
      class:text-destructive={pdfRangeError !== null}
      class:text-muted-foreground={pdfRangeError === null}
    >
      {pdfRangeError ?? $t("workflow.pdfPagesHint")}
    </p>
    <label class="block space-y-1 text-xs text-muted-foreground">
      <span>{$t("workflow.pdfDpi")}</span>
      <input
        class="h-11 w-full rounded-md border bg-background px-2 text-sm text-foreground sm:h-10"
        type="number"
        min={MIN_PDF_DPI}
        max={MAX_PDF_DPI}
        value={settings.pdfDpi}
        onchange={(event) =>
          setNumber("pdfDpi", event.currentTarget.value, MIN_PDF_DPI, MAX_PDF_DPI)}
      />
    </label>
    <p class="text-[11px] leading-4 text-muted-foreground">
      {$t(pdfItems.length ? "workflow.pdfDpiHintActive" : "workflow.pdfDpiHint")}
    </p>
  </fieldset>
</SettingsSection>

<SettingsSection
  title={$t("workflow.resizeTitle")}
  summary={$t(`workflow.resizeModes.${settings.resizeMode}`)}
>
  <fieldset class="space-y-3" disabled={busy}>
    <div class="space-y-1.5">
      <Label class="text-xs text-muted-foreground">{$t("workflow.resizeMode")}</Label>
      <Select.Root
        type="single"
        value={settings.resizeMode}
        disabled={busy}
        onValueChange={setResizeMode}
      >
        <Select.Trigger
          class="min-h-11 w-full sm:min-h-10"
          disabled={busy}
          aria-label={$t("workflow.resizeMode")}
        >
          {$t(`workflow.resizeModes.${settings.resizeMode}`)}
        </Select.Trigger>
        <Select.Content>
          {#each ["none", "fit", "width", "height", "longestEdge", "percentage"] as mode (mode)}
            <Select.Item value={mode} label={$t(`workflow.resizeModes.${mode}`)}>
              {$t(`workflow.resizeModes.${mode}`)}
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    {#if settings.resizeMode === "fit"}
      <div class="grid grid-cols-2 gap-2">
        <label class="space-y-1 text-xs text-muted-foreground">
          <span>{$t("workflow.width")}</span>
          <input
            class="h-11 w-full rounded-md border bg-background px-2 text-sm text-foreground sm:h-10"
            type="number"
            min="1"
            max="65535"
            value={settings.resizeWidth}
            onchange={(event) => setNumber("resizeWidth", event.currentTarget.value, 1, 65_535)}
          />
        </label>
        <label class="space-y-1 text-xs text-muted-foreground">
          <span>{$t("workflow.height")}</span>
          <input
            class="h-11 w-full rounded-md border bg-background px-2 text-sm text-foreground sm:h-10"
            type="number"
            min="1"
            max="65535"
            value={settings.resizeHeight}
            onchange={(event) => setNumber("resizeHeight", event.currentTarget.value, 1, 65_535)}
          />
        </label>
      </div>
    {:else if settings.resizeMode !== "none"}
      <label class="block space-y-1 text-xs text-muted-foreground">
        <span>
          {$t(
            settings.resizeMode === "width"
              ? "workflow.width"
              : settings.resizeMode === "height"
                ? "workflow.height"
                : settings.resizeMode === "percentage"
                  ? "workflow.percentage"
                  : "workflow.value",
          )}
        </span>
        <input
          class="h-11 w-full rounded-md border bg-background px-2 text-sm text-foreground sm:h-10"
          type="number"
          min="1"
          max={settings.resizeMode === "percentage" ? 400 : 65_535}
          value={settings[singleResizeField]}
          onchange={(event) =>
            setNumber(
              singleResizeField,
              event.currentTarget.value,
              1,
              settings.resizeMode === "percentage" ? 400 : 65_535,
            )}
        />
      </label>
    {/if}

    {#if resizeEnabled}
      <div
        class="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-background/70 px-3 py-2"
      >
        <Label class="text-xs leading-4">{$t("workflow.allowUpscale")}</Label>
        <Switch
          size="sm"
          checked={settings.resizeAllowUpscale}
          disabled={busy}
          onCheckedChange={setAllowUpscale}
          aria-label={$t("workflow.allowUpscale")}
        />
      </div>
      <p class="text-[11px] leading-4 text-amber-700 dark:text-amber-300">
        {$t("workflow.compressionPolicyDisabled")}
      </p>
    {/if}
  </fieldset>
</SettingsSection>

<SettingsSection
  title={$t("workflow.targetTitle")}
  summary={settings.targetSizeEnabled ? `${settings.targetSizeKib} KiB` : $t("settings.disabled")}
  error={invalidTargetWorkflow}
>
  <fieldset class="space-y-3" disabled={busy}>
    <div
      class="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-background/70 px-3 py-2"
    >
      <Label class="text-xs leading-4">{$t("workflow.targetEnable")}</Label>
      <Switch
        size="sm"
        checked={settings.targetSizeEnabled}
        disabled={busy || (!targetFormatSupported && !settings.targetSizeEnabled)}
        onCheckedChange={setTargetEnabled}
        aria-label={$t("workflow.targetEnable")}
      />
    </div>
    {#if settings.targetSizeEnabled}
      <label class="block space-y-1 text-xs text-muted-foreground">
        <span>{$t("workflow.targetKib")}</span>
        <input
          class="h-11 w-full rounded-md border bg-background px-2 text-sm text-foreground sm:h-10"
          type="number"
          min={MIN_TARGET_SIZE_KIB}
          max={MAX_TARGET_SIZE_KIB}
          value={settings.targetSizeKib}
          onchange={(event) =>
            setNumber(
              "targetSizeKib",
              event.currentTarget.value,
              MIN_TARGET_SIZE_KIB,
              MAX_TARGET_SIZE_KIB,
            )}
        />
      </label>
    {/if}
    <p
      class="text-[11px] leading-4"
      class:text-destructive={invalidTargetWorkflow}
      class:text-muted-foreground={!invalidTargetWorkflow}
    >
      {$t(invalidTargetWorkflow ? "workflow.targetUnsupported" : "workflow.targetHint")}
    </p>
  </fieldset>
</SettingsSection>

<SettingsSection
  title={$t("workflow.metadataTitle")}
  summary={$t(`workflow.metadata.${settings.metadataPolicy}`)}
>
  <fieldset class="space-y-3" disabled={busy}>
    <div class="space-y-1.5">
      <Label class="text-xs text-muted-foreground">{$t("workflow.metadataPolicy")}</Label>
      <Select.Root
        type="single"
        value={settings.metadataPolicy}
        disabled={busy}
        onValueChange={setMetadataPolicy}
      >
        <Select.Trigger
          class="min-h-11 w-full sm:min-h-10"
          disabled={busy}
          aria-label={$t("workflow.metadataPolicy")}
        >
          {$t(`workflow.metadata.${settings.metadataPolicy}`)}
        </Select.Trigger>
        <Select.Content>
          {#each ["stripAll", "colorOnly", "preserveAll"] as policy (policy)}
            <Select.Item value={policy} label={$t(`workflow.metadata.${policy}`)}>
              {$t(`workflow.metadata.${policy}`)}
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      <p class="text-[11px] leading-4 text-muted-foreground">
        {$t(`workflow.metadata.${settings.metadataPolicy}Description`)}
      </p>
    </div>
  </fieldset>
</SettingsSection>
