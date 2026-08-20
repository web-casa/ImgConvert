<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { FolderOpen, ArrowsClockwise, WarningCircle } from "phosphor-svelte";
  import { get } from "svelte/store";
  import { t } from "svelte-i18n";
  import {
    commandErrorMessage,
    formatLocalizedMessage,
    translationMessage,
    type LocalizedMessage,
  } from "$lib/localized-message";
  import * as Select from "$lib/components/ui/select";
  import { Slider } from "$lib/components/ui/slider";
  import { Switch } from "$lib/components/ui/switch";
  import { Label } from "$lib/components/ui/label";
  import { Button } from "$lib/components/ui/button";
  import FormatSelect from "$lib/components/FormatSelect.svelte";
  import {
    effectiveQualityFor,
    extOf,
    formatFromExt,
    capabilities,
    isTauriRuntime,
    pickSystemPaths,
    persistSettings,
    qualityFloorFor,
    queue,
    resetItemFormats,
    settings,
    supportsLossless,
    ui,
  } from "$lib/state.svelte";
  import { cn } from "$lib/utils.js";

  let { variant = "bar" }: { variant?: "bar" | "panel" } = $props();
  let outputMessage = $state<LocalizedMessage | null>(null);
  let activeSwitchHelp = $state<SwitchHelpKey | null>(null);
  const busy = $derived(ui.converting || ui.importing);
  const isPanel = $derived(variant === "panel");

  const switchHelp = {
    lossless: {
      labelKey: "settings.lossless.label",
      descriptionKey: "settings.lossless.description",
    },
    skipIfLarger: {
      labelKey: "settings.skipLarger.label",
      descriptionKey: "settings.skipLarger.description",
    },
    multiCandidate: {
      labelKey: "settings.multiCandidate.label",
      descriptionKey: "settings.multiCandidate.description",
    },
    autoQuality: {
      labelKey: "settings.autoQuality.label",
      descriptionKey: "settings.autoQuality.description",
    },
    generationLossProtection: {
      labelKey: "settings.generationProtection.label",
      descriptionKey: "settings.generationProtection.description",
    },
    resultCache: {
      labelKey: "settings.resultCache.label",
      descriptionKey: "settings.resultCache.description",
    },
    preserveMetadata: {
      labelKey: "settings.preserveMetadata.label",
      descriptionKey: "settings.preserveMetadata.description",
    },
    convertToSrgb: {
      labelKey: "settings.convertToSrgb.label",
      descriptionKey: "settings.convertToSrgb.description",
    },
  } as const;

  type SwitchHelpKey = keyof typeof switchHelp;

  const activeSwitchHelpContent = $derived(activeSwitchHelp ? switchHelp[activeSwitchHelp] : null);

  function isString(value: string | null): value is string {
    return value !== null;
  }

  const sourceFormats = $derived(
    queue.map((item) => formatFromExt(extOf(item.path))).filter(isString),
  );
  const canLossless = $derived(supportsLossless(settings.format));
  const qualityEnabled = $derived(settings.format !== "png" && !(canLossless && settings.lossless));
  const autoQualitySupported = $derived(
    ["jpeg", "webp"].includes(settings.format) && qualityEnabled,
  );
  const qualityTitleKey = $derived(
    settings.autoQuality && autoQualitySupported
      ? "settings.qualityUpperBound"
      : "settings.quality",
  );
  const hasQualityFloor = $derived(["jpeg", "webp", "avif"].includes(settings.format));
  const activeQualityFloor = $derived(qualityFloorFor(settings.format));
  const activeQualityFloorLabel = $derived(
    activeQualityFloor >= 30 ? `${activeQualityFloor}` : "settings.qualityFloorOff",
  );
  const effectiveQuality = $derived(effectiveQualityFor(settings.format));
  const qualityLabel = $derived(
    qualityEnabled && effectiveQuality > settings.quality
      ? `${settings.quality} -> ${effectiveQuality}`
      : `${settings.quality}`,
  );
  const autoQualityScoreLabel = $derived(`${settings.autoQualityScore}`);
  const overwriteLabelKey = $derived(
    settings.overwrite === "overwrite"
      ? "settings.overwrite"
      : settings.overwrite === "ask"
        ? "settings.overwriteAsk"
        : "settings.overwriteSkip",
  );
  const avifSubsampleLabel = $derived(settings.avifSubsample === "yuv420" ? "4:2:0" : "4:4:4");

  // 切到不支持无损的格式时,自动关掉无损开关
  $effect(() => {
    if (!canLossless && settings.lossless) {
      settings.lossless = false;
      persistSettings();
    }
  });

  async function pickOut() {
    if (busy) return;

    if (!isTauriRuntime()) {
      outputMessage = translationMessage("settings.webOutputDirUnsupported");
      return;
    }

    try {
      const paths = await pickSystemPaths({
        directory: true,
        multiple: false,
        title: get(t)("settings.chooseOutputDir") as string,
      });
      if (busy || !paths[0]) return;
      settings.outDir = paths[0];
      outputMessage = null;
      persistSettings();
    } catch (error) {
      outputMessage = commandErrorMessage(error);
    }
  }

  function clearOut() {
    if (busy) return;

    settings.outDir = null;
    outputMessage = null;
    persistSettings();
  }

  function setFormat(value: string) {
    if (busy) return;

    settings.format = value;
    persistSettings();
  }

  function localizedText(message: LocalizedMessage, currentTranslation: unknown): string {
    void currentTranslation;
    return formatLocalizedMessage(message);
  }

  function setOverwrite(value: string) {
    if (busy) return;

    if (value === "ask" || value === "skip" || value === "overwrite") {
      settings.overwrite = value;
    }
    persistSettings();
  }

  function setTemplate(value: string) {
    if (busy) return;

    settings.fileNameTemplate = value;
    persistSettings();
  }

  function commitConcurrency() {
    if (busy) return;

    settings.concurrency = Math.min(8, Math.max(0, Math.round(settings.concurrency)));
    persistSettings();
  }

  function clampQualityFloor(value: number) {
    const rounded = Math.min(100, Math.max(0, Math.round(value)));
    return rounded < 30 ? 0 : rounded;
  }

  function commitJpegQualityFloor() {
    if (busy) return;

    settings.jpegQualityFloor = clampQualityFloor(settings.jpegQualityFloor);
    persistSettings();
  }

  function commitWebpQualityFloor() {
    if (busy) return;

    settings.webpQualityFloor = clampQualityFloor(settings.webpQualityFloor);
    persistSettings();
  }

  function commitAvifQualityFloor() {
    if (busy) return;

    settings.avifQualityFloor = clampQualityFloor(settings.avifQualityFloor);
    persistSettings();
  }

  function commitPngOxipngLevel() {
    if (busy) return;

    settings.pngOxipngLevel = Math.min(6, Math.max(0, Math.round(settings.pngOxipngLevel)));
    persistSettings();
  }

  function commitPngQuantColors() {
    if (busy) return;

    settings.pngQuantColors = Math.min(256, Math.max(64, Math.round(settings.pngQuantColors)));
    persistSettings();
  }

  function commitWebpMethod() {
    if (busy) return;

    settings.webpMethod = Math.min(6, Math.max(0, Math.round(settings.webpMethod)));
    persistSettings();
  }

  function commitAvifSpeed() {
    if (busy) return;

    settings.avifSpeed = Math.min(10, Math.max(0, Math.round(settings.avifSpeed)));
    persistSettings();
  }

  function commitWebpNearLossless() {
    if (busy) return;

    settings.webpNearLossless = Math.min(100, Math.max(0, Math.round(settings.webpNearLossless)));
    persistSettings();
  }

  function commitAutoQualityScore() {
    if (busy) return;

    settings.autoQualityScore = Math.min(95, Math.max(50, Math.round(settings.autoQualityScore)));
    persistSettings();
  }

  function setAvifSubsample(value: string) {
    if (busy) return;

    if (value === "yuv444" || value === "yuv420") {
      settings.avifSubsample = value;
      persistSettings();
    }
  }

  function toggleSwitchHelp(key: SwitchHelpKey) {
    activeSwitchHelp = activeSwitchHelp === key ? null : key;
  }

  function updateSetting<T extends boolean>(setter: (checked: T) => void) {
    return (checked: T) => {
      setter(checked);
      persistSettings();
    };
  }
</script>

{#snippet settingSwitch(
  key: SwitchHelpKey,
  label: string,
  checked: boolean,
  disabled: boolean,
  onChange: (checked: boolean) => void,
  muted = false,
)}
  <div
    class={cn(
      "grid min-h-[4.25rem] grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 rounded-md border bg-background/70 px-2.5 py-2 transition-colors",
      activeSwitchHelp === key
        ? "border-primary/40 bg-primary/5"
        : "border-border/80 hover:border-foreground/20 hover:bg-muted/45",
      muted && "opacity-45",
    )}
  >
    <span class="min-w-0 text-pretty text-sm font-medium leading-5">{label}</span>
    <Button
      variant="ghost"
      size="icon"
      class={cn(
        "size-7 rounded-md text-muted-foreground hover:text-foreground",
        activeSwitchHelp === key && "bg-background text-foreground",
      )}
      aria-label={$t("settings.descriptionAria", { values: { label } })}
      aria-pressed={activeSwitchHelp === key}
      onclick={() => toggleSwitchHelp(key)}
    >
      <WarningCircle size={15} weight={activeSwitchHelp === key ? "fill" : "duotone"} />
    </Button>
    <div class="col-span-2 flex items-center justify-between gap-3">
      <span class="text-[11px] leading-none text-muted-foreground">
        {checked ? $t("settings.enabled") : $t("settings.disabled")}
      </span>
      <Switch size="sm" aria-label={label} {checked} {disabled} onCheckedChange={onChange} />
    </div>
  </div>
{/snippet}

<section class={cn("rounded-lg border bg-card p-4", isPanel && "h-fit")}>
  <div
    class={cn(
      "grid gap-4",
      isPanel ? "grid-cols-1" : "lg:grid-cols-[220px_minmax(220px,1fr)_180px_180px_220px]",
    )}
  >
    {#if isPanel}
      <div class="flex items-center justify-between gap-3 border-b pb-3">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold">{$t("settings.title")}</h2>
          <p class="mt-1 truncate text-xs text-muted-foreground">
            {settings.format.toUpperCase()} · {$t(qualityTitleKey)}
            {qualityLabel}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onclick={resetItemFormats}
          disabled={busy || !queue.length}
          class="shrink-0"
        >
          <ArrowsClockwise weight="duotone" />
          {$t("settings.followGlobal")}
        </Button>
      </div>
    {/if}

    <div class="flex flex-col gap-1.5">
      <Label class="text-xs text-muted-foreground">{$t("settings.targetFormat")}</Label>
      <FormatSelect
        bind:value={settings.format}
        {sourceFormats}
        onChange={setFormat}
        disabled={busy}
        triggerClass="w-full"
      />
    </div>

    <div class={cn("flex min-w-0 flex-col gap-2", !qualityEnabled || busy ? "opacity-40" : "")}>
      <div class="flex items-center justify-between gap-3">
        <Label class="text-xs text-muted-foreground">{$t(qualityTitleKey)}</Label>
        <b class="tabular-nums text-sm text-foreground">{qualityLabel}</b>
      </div>
      <div class="flex h-8 items-center">
        <Slider
          type="single"
          bind:value={settings.quality}
          min={1}
          max={100}
          step={1}
          disabled={!qualityEnabled || busy}
          onValueCommit={persistSettings}
        />
      </div>
    </div>

    <div class={cn("flex min-w-0 flex-col gap-2", busy ? "opacity-40" : "")}>
      <div class="flex items-center justify-between gap-3">
        <Label class="text-xs text-muted-foreground">{$t("settings.concurrency")}</Label>
        <b class="tabular-nums text-sm text-foreground">
          {settings.concurrency > 0 ? settings.concurrency : $t("settings.concurrencyAuto")}
        </b>
      </div>
      <div class="flex h-8 items-center">
        <Slider
          type="single"
          bind:value={settings.concurrency}
          min={0}
          max={8}
          step={1}
          disabled={busy}
          onValueCommit={commitConcurrency}
        />
      </div>
    </div>

    <div class="flex min-w-0 flex-col gap-1.5">
      <Label class="text-xs text-muted-foreground">{$t("settings.existingFiles")}</Label>
      <Select.Root
        type="single"
        bind:value={settings.overwrite}
        disabled={busy}
        onValueChange={setOverwrite}
      >
        <Select.Trigger class="w-full" disabled={busy}>{$t(overwriteLabelKey)}</Select.Trigger>
        <Select.Content>
          <Select.Item value="ask" label={$t("settings.overwriteAsk")}>
            {$t("settings.overwriteAsk")}
          </Select.Item>
          <Select.Item value="skip" label={$t("settings.overwriteSkip")}>
            {$t("settings.overwriteSkip")}
          </Select.Item>
          <Select.Item value="overwrite" label={$t("settings.overwrite")}>
            {$t("settings.overwrite")}
          </Select.Item>
        </Select.Content>
      </Select.Root>
    </div>

    <div class="flex min-w-0 flex-col gap-1.5">
      <Label class="text-xs text-muted-foreground">{$t("settings.fileNameTemplate")}</Label>
      <input
        value={settings.fileNameTemplate}
        class="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        placeholder="%name%"
        disabled={busy}
        oninput={(event) => setTemplate(event.currentTarget.value)}
      />
    </div>

    <div class={cn("min-w-0", isPanel ? "border-t pt-3" : "lg:col-span-3")}>
      {#if activeSwitchHelpContent}
        <div
          class="mb-2 rounded-md border border-primary/15 bg-muted/55 px-3 py-2 text-xs leading-5 text-muted-foreground"
        >
          <span class="font-medium text-foreground">
            {$t(activeSwitchHelpContent.labelKey)}
          </span>
          <span
            >{$t("settings.descriptionSeparator")}{$t(activeSwitchHelpContent.descriptionKey)}</span
          >
        </div>
      {/if}

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {@render settingSwitch(
          "lossless",
          $t("settings.lossless.label"),
          settings.lossless,
          !canLossless || busy,
          updateSetting((checked) => {
            settings.lossless = checked;
          }),
          !canLossless || busy,
        )}
        {@render settingSwitch(
          "skipIfLarger",
          $t("settings.skipLarger.label"),
          settings.skipIfLarger,
          busy,
          updateSetting((checked) => {
            settings.skipIfLarger = checked;
          }),
          busy,
        )}
        {@render settingSwitch(
          "multiCandidate",
          $t("settings.multiCandidate.label"),
          settings.multiCandidate,
          busy,
          updateSetting((checked) => {
            settings.multiCandidate = checked;
          }),
          busy,
        )}
        {@render settingSwitch(
          "autoQuality",
          $t("settings.autoQuality.label"),
          settings.autoQuality && autoQualitySupported,
          !autoQualitySupported || busy,
          updateSetting((checked) => {
            settings.autoQuality = checked;
          }),
          !autoQualitySupported || busy,
        )}
        {@render settingSwitch(
          "generationLossProtection",
          $t("settings.generationProtection.label"),
          settings.generationLossProtection,
          busy,
          updateSetting((checked) => {
            settings.generationLossProtection = checked;
          }),
          busy,
        )}
        {@render settingSwitch(
          "resultCache",
          $t("settings.resultCache.label"),
          settings.resultCache,
          busy,
          updateSetting((checked) => {
            settings.resultCache = checked;
          }),
          busy,
        )}
        {@render settingSwitch(
          "preserveMetadata",
          $t("settings.preserveMetadata.label"),
          settings.preserveMetadata,
          busy,
          updateSetting((checked) => {
            settings.preserveMetadata = checked;
          }),
          busy,
        )}
        {@render settingSwitch(
          "convertToSrgb",
          $t("settings.convertToSrgb.label"),
          settings.colorManagementPolicy === "convertToSrgb",
          busy || !capabilities.colorPipeline.iccTransform,
          updateSetting((checked) => {
            settings.colorManagementPolicy = checked ? "convertToSrgb" : "preserve";
          }),
          busy || !capabilities.colorPipeline.iccTransform,
        )}
      </div>
    </div>

    {#if !isPanel}
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onclick={resetItemFormats}
          disabled={busy || !queue.length}
        >
          <ArrowsClockwise weight="duotone" />
          {$t("settings.followGlobalFormat")}
        </Button>
      </div>
    {/if}

    <div class="flex min-w-0 items-center gap-2">
      <Button variant="ghost" size="sm" onclick={pickOut} disabled={busy}>
        <FolderOpen weight="duotone" />
        {$t("settings.outputDirectory")}
      </Button>
      <button
        class="max-w-[220px] truncate text-left text-xs text-muted-foreground hover:text-foreground"
        title={settings.outDir ?? $t("settings.sameAsSourceClear")}
        onclick={clearOut}
        disabled={busy}
      >
        {settings.outDir ?? $t("settings.sameAsSource")}
      </button>
      {#if outputMessage}
        <span class="text-xs text-muted-foreground">{localizedText(outputMessage, $t)}</span>
      {/if}
    </div>

    <div class={cn("flex min-w-0 flex-col gap-2 border-t pt-3", isPanel ? "" : "lg:col-span-5")}>
      <div class="flex items-center justify-between gap-3">
        <Label class="text-xs text-muted-foreground">{$t("settings.formatParameters")}</Label>
        {#if settings.format === "jpeg"}
          <span class="text-xs text-muted-foreground">
            {settings.jpegProgressive
              ? $t("settings.jpegProgressiveMode")
              : $t("settings.jpegBaselineMode")}
          </span>
        {:else if settings.format === "png"}
          <span class="text-xs text-muted-foreground">oxipng {settings.pngOxipngLevel}</span>
        {:else if settings.format === "webp"}
          <span class="text-xs text-muted-foreground"
            >{$t("settings.webpMethod")} {settings.webpMethod}</span
          >
        {:else if settings.format === "avif"}
          <span class="text-xs text-muted-foreground"
            >{$t("settings.avifSpeed")} {settings.avifSpeed}</span
          >
        {/if}
      </div>

      {#if settings.format === "jpeg"}
        <div class="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-2">
          <div class="flex items-center gap-2">
            <Switch
              bind:checked={settings.jpegProgressive}
              disabled={busy}
              onCheckedChange={persistSettings}
            />
            <Label class="text-sm">{$t("settings.progressiveJpeg")}</Label>
          </div>
          <div class="flex items-center gap-2">
            <Switch
              bind:checked={settings.jpegTrellis}
              disabled={busy}
              onCheckedChange={persistSettings}
            />
            <Label class="text-sm">{$t("settings.trellisScans")}</Label>
          </div>
        </div>
      {:else if settings.format === "png"}
        <div class="flex h-8 items-center gap-3">
          <Slider
            type="single"
            bind:value={settings.pngOxipngLevel}
            min={0}
            max={6}
            step={1}
            disabled={busy}
            onValueCommit={commitPngOxipngLevel}
          />
        </div>
        <div class="flex h-8 items-center gap-2" class:opacity-40={busy}>
          <Switch
            bind:checked={settings.pngLossyQuantize}
            disabled={busy}
            onCheckedChange={persistSettings}
          />
          <Label class="text-sm">{$t("settings.experimentalQuantize")}</Label>
        </div>
        {#if settings.pngLossyQuantize}
          <div class="grid gap-2 pt-1 md:grid-cols-[120px_minmax(0,1fr)]" class:opacity-40={busy}>
            <div class="flex items-center justify-between gap-3 md:block">
              <Label class="text-sm text-muted-foreground">{$t("settings.colorCount")}</Label>
              <span class="tabular-nums text-xs text-muted-foreground md:mt-1 md:block">
                {settings.pngQuantColors}
              </span>
            </div>
            <div class="flex h-8 min-w-0 items-center">
              <Slider
                type="single"
                bind:value={settings.pngQuantColors}
                min={64}
                max={256}
                step={1}
                disabled={busy}
                onValueCommit={commitPngQuantColors}
              />
            </div>
          </div>
        {/if}
      {:else if settings.format === "webp"}
        <div class="flex h-8 items-center gap-3">
          <Slider
            type="single"
            bind:value={settings.webpMethod}
            min={0}
            max={6}
            step={1}
            disabled={busy}
            onValueCommit={commitWebpMethod}
          />
        </div>
        <div class="grid gap-2 pt-1 md:grid-cols-[120px_minmax(0,1fr)]" class:opacity-40={busy}>
          <div class="flex items-center justify-between gap-3 md:block">
            <Label class="text-sm text-muted-foreground">{$t("settings.nearLossless")}</Label>
            <span class="tabular-nums text-xs text-muted-foreground md:mt-1 md:block">
              {settings.webpNearLossless === 100
                ? $t("settings.nearLosslessOff")
                : settings.webpNearLossless}
            </span>
          </div>
          <div class="flex h-8 min-w-0 items-center">
            <Slider
              type="single"
              bind:value={settings.webpNearLossless}
              min={0}
              max={100}
              step={1}
              disabled={busy}
              onValueCommit={commitWebpNearLossless}
            />
          </div>
        </div>
        <div class="flex h-8 items-center gap-2" class:opacity-40={busy}>
          <Switch
            bind:checked={settings.webpSharpYuv}
            disabled={busy}
            onCheckedChange={persistSettings}
          />
          <Label class="text-sm">{$t("settings.sharpYuv")}</Label>
        </div>
      {:else if settings.format === "avif"}
        <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
          <div class="flex h-8 items-center gap-3">
            <Slider
              type="single"
              bind:value={settings.avifSpeed}
              min={0}
              max={10}
              step={1}
              disabled={busy}
              onValueCommit={commitAvifSpeed}
            />
          </div>
          <Select.Root
            type="single"
            bind:value={settings.avifSubsample}
            disabled={busy}
            onValueChange={setAvifSubsample}
          >
            <Select.Trigger class="h-8 w-full" disabled={busy}>{avifSubsampleLabel}</Select.Trigger>
            <Select.Content>
              <Select.Item value="yuv444" label="4:4:4">4:4:4</Select.Item>
              <Select.Item value="yuv420" label="4:2:0">4:2:0</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
      {/if}

      {#if autoQualitySupported && settings.autoQuality}
        <div class="grid gap-2 pt-1 md:grid-cols-[120px_minmax(0,1fr)]" class:opacity-40={busy}>
          <div class="flex items-center justify-between gap-3 md:block">
            <Label class="text-sm text-muted-foreground">{$t("settings.targetScore")}</Label>
            <span class="tabular-nums text-xs text-muted-foreground md:mt-1 md:block">
              {autoQualityScoreLabel}
            </span>
          </div>
          <div class="flex h-8 min-w-0 items-center">
            <Slider
              type="single"
              bind:value={settings.autoQualityScore}
              min={50}
              max={95}
              step={1}
              disabled={busy}
              onValueCommit={commitAutoQualityScore}
            />
          </div>
        </div>
      {/if}

      {#if hasQualityFloor}
        <div
          class="grid gap-2 pt-1 md:grid-cols-[120px_minmax(0,1fr)]"
          class:opacity-40={!qualityEnabled || busy}
        >
          <div class="flex items-center justify-between gap-3 md:block">
            <Label class="text-sm text-muted-foreground">{$t("settings.minimumQuality")}</Label>
            <span class="tabular-nums text-xs text-muted-foreground md:mt-1 md:block">
              {typeof activeQualityFloorLabel === "string" &&
              activeQualityFloorLabel.startsWith("settings.")
                ? $t(activeQualityFloorLabel)
                : activeQualityFloorLabel}
            </span>
          </div>
          <div class="flex h-8 min-w-0 items-center">
            {#if settings.format === "jpeg"}
              <Slider
                type="single"
                bind:value={settings.jpegQualityFloor}
                min={0}
                max={100}
                step={1}
                disabled={!qualityEnabled || busy}
                onValueCommit={commitJpegQualityFloor}
              />
            {:else if settings.format === "webp"}
              <Slider
                type="single"
                bind:value={settings.webpQualityFloor}
                min={0}
                max={100}
                step={1}
                disabled={!qualityEnabled || busy}
                onValueCommit={commitWebpQualityFloor}
              />
            {:else if settings.format === "avif"}
              <Slider
                type="single"
                bind:value={settings.avifQualityFloor}
                min={0}
                max={100}
                step={1}
                disabled={!qualityEnabled || busy}
                onValueCommit={commitAvifQualityFloor}
              />
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>
