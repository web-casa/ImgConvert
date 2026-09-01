<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { DangerCircleIcon } from "@solar-icons/svelte/bold-duotone";
  import { t } from "svelte-i18n";
  import * as Select from "$lib/components/ui/select";
  import { Slider } from "$lib/components/ui/slider";
  import { Switch } from "$lib/components/ui/switch";
  import { Label } from "$lib/components/ui/label";
  import { Button } from "$lib/components/ui/button";
  import FormatSelect from "$lib/components/FormatSelect.svelte";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import {
    effectiveQualityFor,
    extOf,
    formatFromExt,
    capabilities,
    clearResultCache,
    DEFAULT_OUTPUT_SUFFIX,
    normalizeOutputSuffixInput,
    isTauriRuntime,
    persistSettings,
    persistenceStatus,
    qualityFloorFor,
    queue,
    settings,
    supportsLossless,
    ui,
  } from "$lib/state.svelte";
  import { cn } from "$lib/utils.js";

  let suffixFeedback = $state<"adjusted" | "required" | null>(null);
  let outputSuffixDraft = $state(settings.outputSuffix);
  let outputSuffixEditing = $state(false);
  let activeSwitchHelp = $state<SwitchHelpKey | null>(null);
  let clearingCache = $state(false);
  let cacheClearResult = $state<{ count: number; error: string | null } | null>(null);
  const busy = $derived(ui.converting || ui.importing);

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
    convertToSrgb: {
      labelKey: "settings.convertToSrgb.label",
      descriptionKey: "settings.convertToSrgb.description",
    },
  } as const;

  type SwitchHelpKey = keyof typeof switchHelp;

  const activeSwitchHelpContent = $derived(activeSwitchHelp ? switchHelp[activeSwitchHelp] : null);

  $effect(() => {
    if (!outputSuffixEditing && outputSuffixDraft !== settings.outputSuffix) {
      outputSuffixDraft = settings.outputSuffix;
    }
  });

  // Advanced accordion: at most one group open at a time. Ephemeral UI state;
  // it is never persisted into the conversion settings.
  type AdvancedGroup = "compression" | "color" | "cache" | "formatParameters";
  let openAdvancedGroup = $state<AdvancedGroup | null>(null);
  function advancedGroupToggle(group: AdvancedGroup) {
    return (open: boolean) => {
      const nextGroup = open ? group : null;
      if (nextGroup !== openAdvancedGroup) activeSwitchHelp = null;
      openAdvancedGroup = nextGroup;
    };
  }

  function isString(value: string | null): value is string {
    return value !== null;
  }

  const sourceFormats = $derived(
    queue.map((item) => formatFromExt(extOf(item.path))).filter(isString),
  );
  const canLossless = $derived(supportsLossless(settings.format));
  const resizePoliciesDisabled = $derived(settings.resizeMode !== "none");
  const qualityEnabled = $derived(settings.format !== "png" && !(canLossless && settings.lossless));
  const autoQualitySupported = $derived(
    ["jpeg", "webp"].includes(settings.format) && qualityEnabled && !settings.targetSizeEnabled,
  );
  const qualityTitleKey = $derived(
    (settings.autoQuality && autoQualitySupported) || settings.targetSizeEnabled
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
  const enabledPolicyCount = $derived(
    [
      settings.lossless,
      settings.skipIfLarger,
      settings.multiCandidate,
      settings.autoQuality && autoQualitySupported,
      settings.generationLossProtection,
    ].filter(Boolean).length,
  );

  async function clearCache() {
    if (clearingCache || busy || !isTauriRuntime()) return;
    clearingCache = true;
    cacheClearResult = null;
    try {
      cacheClearResult = { count: await clearResultCache(), error: null };
    } catch (error) {
      cacheClearResult = { count: 0, error: String(error) };
    } finally {
      clearingCache = false;
    }
  }

  // 切到不支持无损的格式时,自动关掉无损开关
  $effect(() => {
    if (!canLossless && settings.lossless) {
      settings.lossless = false;
      persistSettings();
    }
  });

  function setFormat(value: string) {
    if (busy) return;

    settings.format = value;
    persistSettings();
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

  function setOutputSuffixEnabled(checked: boolean) {
    if (busy) return;

    settings.outputSuffixEnabled = checked;
    if (checked && !settings.outputSuffix.trim()) {
      settings.outputSuffix = DEFAULT_OUTPUT_SUFFIX;
    }
    outputSuffixEditing = false;
    outputSuffixDraft = settings.outputSuffix;
    suffixFeedback = null;
    persistSettings();
  }

  function updateOutputSuffixDraft(value: string) {
    if (busy) return;

    const normalized = normalizeOutputSuffixInput(value);
    outputSuffixEditing = true;
    outputSuffixDraft = normalized.value;
    if (!normalized.value) {
      suffixFeedback = "required";
      return;
    }
    settings.outputSuffix = normalized.value;
    suffixFeedback = normalized.adjusted ? "adjusted" : null;
    persistSettings();
  }

  function commitOutputSuffixDraft() {
    outputSuffixEditing = false;
    if (!outputSuffixDraft) {
      settings.outputSuffix = DEFAULT_OUTPUT_SUFFIX;
      outputSuffixDraft = DEFAULT_OUTPUT_SUFFIX;
      suffixFeedback = "required";
      persistSettings();
    }
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
        "size-10 rounded-md text-muted-foreground hover:text-foreground",
        activeSwitchHelp === key && "bg-background text-foreground",
      )}
      aria-label={$t("settings.descriptionAria", { values: { label } })}
      aria-pressed={activeSwitchHelp === key}
      onclick={() => toggleSwitchHelp(key)}
    >
      <DangerCircleIcon size={15} />
    </Button>
    <div class="col-span-2 flex items-center justify-between gap-3">
      <span class="text-[11px] leading-none text-muted-foreground">
        {checked ? $t("settings.enabled") : $t("settings.disabled")}
      </span>
      <Switch size="sm" aria-label={label} {checked} {disabled} onCheckedChange={onChange} />
    </div>
  </div>
{/snippet}

{#snippet switchHelpBox()}
  {#if activeSwitchHelpContent}
    <div
      class="mb-2 rounded-md border border-primary/15 bg-muted/55 px-3 py-2 text-xs leading-5 text-muted-foreground"
    >
      <span class="font-medium text-foreground">
        {$t(activeSwitchHelpContent.labelKey)}
      </span>
      <span>{$t("settings.descriptionSeparator")}{$t(activeSwitchHelpContent.descriptionKey)}</span>
    </div>
  {/if}
{/snippet}

<section class="px-4 py-3">
  <h3 class="text-sm font-semibold">{$t("settings.coreSectionTitle")}</h3>
  {#if persistenceStatus.error}
    <p
      class="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
      role="alert"
    >
      {$t("settings.persistenceFailed", { values: { message: persistenceStatus.error } })}
    </p>
  {/if}

  <div class="mt-3 grid gap-4">
    <div class="flex flex-col gap-1.5">
      <Label class="text-xs text-muted-foreground">{$t("settings.targetFormat")}</Label>
      <FormatSelect
        bind:value={settings.format}
        {sourceFormats}
        onChange={setFormat}
        disabled={busy}
        triggerClass="w-full"
        ariaLabel={$t("settings.targetFormat")}
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
          ariaLabel={$t(qualityTitleKey)}
          min={1}
          max={100}
          step={1}
          disabled={!qualityEnabled || busy}
          onValueCommit={persistSettings}
        />
      </div>
    </div>
  </div>
</section>

<SettingsSection
  title={$t("settings.outputSectionTitle")}
  summary={`${settings.concurrency > 0 ? settings.concurrency : $t("settings.concurrencyAuto")} · ${$t(overwriteLabelKey)} · ${
    settings.outputSuffixEnabled ? settings.outputSuffix : settings.fileNameTemplate
  }`}
>
  <div class="grid gap-4">
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
          ariaLabel={$t("settings.concurrency")}
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
        <Select.Trigger class="w-full" disabled={busy} aria-label={$t("settings.existingFiles")}
          >{$t(overwriteLabelKey)}</Select.Trigger
        >
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
      <div class="flex items-center justify-between gap-3">
        <Label class="text-xs text-muted-foreground">{$t("settings.outputSuffix")}</Label>
        <div class="flex items-center gap-2">
          <Label class="text-xs text-muted-foreground">{$t("settings.addOutputSuffix")}</Label>
          <Switch
            size="sm"
            checked={settings.outputSuffixEnabled}
            disabled={busy}
            onCheckedChange={setOutputSuffixEnabled}
            aria-label={$t("settings.addOutputSuffix")}
          />
        </div>
      </div>
      {#if settings.outputSuffixEnabled}
        <input
          value={outputSuffixDraft}
          class="h-10 rounded-md border bg-background px-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder={DEFAULT_OUTPUT_SUFFIX}
          aria-label={$t("settings.outputSuffix")}
          aria-describedby="output-suffix-hint"
          aria-invalid={suffixFeedback === "required"}
          disabled={busy}
          oninput={(event) => updateOutputSuffixDraft(event.currentTarget.value)}
          onblur={commitOutputSuffixDraft}
          onkeydown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <p id="output-suffix-hint" class="text-[11px] leading-4 text-muted-foreground">
          {$t("settings.outputSuffixHint")}
        </p>
        {#if suffixFeedback}
          <p class="text-[11px] leading-4 text-amber-700 dark:text-amber-300" aria-live="polite">
            {$t(
              suffixFeedback === "adjusted"
                ? "settings.outputSuffixAdjusted"
                : "settings.outputSuffixRequired",
            )}
          </p>
        {/if}
      {:else}
        <p class="text-[11px] leading-4 text-amber-700 dark:text-amber-300">
          {$t("settings.suffixDisabledCollisionHint")}
        </p>
        <details class="rounded-md border border-dashed bg-muted/25 px-2.5 py-2">
          <summary
            class="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {$t("settings.advancedFileNameTemplate")}
          </summary>
          <p class="mt-1 text-[11px] leading-4 text-muted-foreground">
            {$t("settings.advancedFileNameTemplateHint")}
          </p>
          <input
            value={settings.fileNameTemplate}
            class="mt-2 h-10 w-full rounded-md border bg-background px-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            placeholder="%name%"
            aria-label={$t("settings.fileNameTemplate")}
            disabled={busy}
            oninput={(event) => setTemplate(event.currentTarget.value)}
          />
        </details>
      {/if}
    </div>

    <p class="text-xs text-muted-foreground">{$t("settings.outputAtBottom")}</p>
  </div>
</SettingsSection>

<SettingsSection
  title={$t("settings.advancedCompressionTitle")}
  summary={$t("settings.advancedEnabledCount", { values: { count: enabledPolicyCount } })}
  open={openAdvancedGroup === "compression"}
  onToggle={advancedGroupToggle("compression")}
>
  {@render switchHelpBox()}
  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
    {@render settingSwitch(
      "lossless",
      $t("settings.lossless.label"),
      settings.lossless,
      !canLossless || settings.targetSizeEnabled || busy,
      updateSetting((checked) => {
        settings.lossless = checked;
      }),
      !canLossless || settings.targetSizeEnabled || busy,
    )}
    {@render settingSwitch(
      "skipIfLarger",
      $t("settings.skipLarger.label"),
      settings.skipIfLarger,
      busy || resizePoliciesDisabled,
      updateSetting((checked) => {
        settings.skipIfLarger = checked;
      }),
      busy || resizePoliciesDisabled,
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
      busy || resizePoliciesDisabled,
      updateSetting((checked) => {
        settings.generationLossProtection = checked;
      }),
      busy || resizePoliciesDisabled,
    )}
  </div>
</SettingsSection>

<SettingsSection
  title={$t("settings.advancedColorTitle")}
  summary={settings.colorManagementPolicy === "convertToSrgb"
    ? $t("settings.enabled")
    : $t("settings.disabled")}
  open={openAdvancedGroup === "color"}
  onToggle={advancedGroupToggle("color")}
>
  {@render switchHelpBox()}
  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
</SettingsSection>

<SettingsSection
  title={$t("settings.resultCache.label")}
  summary={settings.resultCache ? $t("settings.enabled") : $t("settings.disabled")}
  open={openAdvancedGroup === "cache"}
  onToggle={advancedGroupToggle("cache")}
>
  {@render switchHelpBox()}
  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
  </div>
  <div class="mt-2 flex flex-wrap items-center gap-2">
    <Button
      variant="outline"
      size="sm"
      onclick={clearCache}
      disabled={busy || clearingCache || !isTauriRuntime()}
    >
      {clearingCache ? $t("settings.clearingResultCache") : $t("settings.clearResultCache")}
    </Button>
    {#if cacheClearResult?.error}
      <span class="text-xs text-destructive" role="alert">
        {$t("settings.clearResultCacheFailed", {
          values: { message: cacheClearResult.error },
        })}
      </span>
    {:else if cacheClearResult}
      <span class="text-xs text-muted-foreground" role="status">
        {$t("settings.resultCacheCleared", { values: { count: cacheClearResult.count } })}
      </span>
    {/if}
  </div>
</SettingsSection>

<SettingsSection
  title={$t("settings.formatParameters")}
  summary={settings.format === "jpeg"
    ? settings.jpegProgressive
      ? $t("settings.jpegProgressiveMode")
      : $t("settings.jpegBaselineMode")
    : settings.format === "png"
      ? `oxipng ${settings.pngOxipngLevel}`
      : settings.format === "webp"
        ? `${$t("settings.webpMethod")} ${settings.webpMethod}`
        : settings.format === "avif"
          ? `${$t("settings.avifSpeed")} ${settings.avifSpeed}`
          : ""}
  open={openAdvancedGroup === "formatParameters"}
  onToggle={advancedGroupToggle("formatParameters")}
>
  <div class="flex min-w-0 flex-col gap-2">
    {#if settings.format === "jpeg"}
      <div class="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-2">
        <div class="flex items-center gap-2">
          <Switch
            bind:checked={settings.jpegProgressive}
            disabled={busy}
            onCheckedChange={persistSettings}
            aria-label={$t("settings.progressiveJpeg")}
          />
          <Label class="text-sm">{$t("settings.progressiveJpeg")}</Label>
        </div>
        <div class="flex items-center gap-2">
          <Switch
            bind:checked={settings.jpegTrellis}
            disabled={busy}
            onCheckedChange={persistSettings}
            aria-label={$t("settings.trellisScans")}
          />
          <Label class="text-sm">{$t("settings.trellisScans")}</Label>
        </div>
      </div>
    {:else if settings.format === "png"}
      <div class="grid gap-2 pt-1 md:grid-cols-[120px_minmax(0,1fr)]" class:opacity-40={busy}>
        <div class="flex items-center justify-between gap-3 md:block">
          <Label class="text-sm text-muted-foreground">{$t("settings.pngOptimizationLevel")}</Label>
          <span class="tabular-nums text-xs text-muted-foreground md:mt-1 md:block">
            {settings.pngOxipngLevel}
          </span>
        </div>
        <div class="flex min-h-10 min-w-0 items-center">
          <Slider
            type="single"
            bind:value={settings.pngOxipngLevel}
            ariaLabel={$t("settings.pngOptimizationLevel")}
            min={0}
            max={6}
            step={1}
            disabled={busy}
            onValueCommit={commitPngOxipngLevel}
          />
        </div>
      </div>
      <div class="flex h-8 items-center gap-2" class:opacity-40={busy}>
        <Switch
          bind:checked={settings.pngLossyQuantize}
          disabled={busy}
          onCheckedChange={persistSettings}
          aria-label={$t("settings.experimentalQuantize")}
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
              ariaLabel={$t("settings.colorCount")}
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
      <div class="grid gap-2 pt-1 md:grid-cols-[120px_minmax(0,1fr)]" class:opacity-40={busy}>
        <div class="flex items-center justify-between gap-3 md:block">
          <Label class="text-sm text-muted-foreground">{$t("settings.webpMethod")}</Label>
          <span class="tabular-nums text-xs text-muted-foreground md:mt-1 md:block">
            {settings.webpMethod}
          </span>
        </div>
        <div class="flex min-h-10 min-w-0 items-center">
          <Slider
            type="single"
            bind:value={settings.webpMethod}
            ariaLabel={$t("settings.webpMethod")}
            min={0}
            max={6}
            step={1}
            disabled={busy}
            onValueCommit={commitWebpMethod}
          />
        </div>
      </div>
      {#if canLossless && settings.lossless}
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
              ariaLabel={$t("settings.nearLossless")}
              min={0}
              max={100}
              step={1}
              disabled={busy}
              onValueCommit={commitWebpNearLossless}
            />
          </div>
        </div>
      {/if}
      <div class="flex h-8 items-center gap-2" class:opacity-40={busy}>
        <Switch
          bind:checked={settings.webpSharpYuv}
          disabled={busy}
          onCheckedChange={persistSettings}
          aria-label={$t("settings.sharpYuv")}
        />
        <Label class="text-sm">{$t("settings.sharpYuv")}</Label>
      </div>
    {:else if settings.format === "avif"}
      <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
        <div class="space-y-1.5" class:opacity-40={busy}>
          <div class="flex items-center justify-between gap-3">
            <Label class="text-sm text-muted-foreground">{$t("settings.avifSpeed")}</Label>
            <span class="tabular-nums text-xs text-muted-foreground">{settings.avifSpeed}</span>
          </div>
          <div class="flex min-h-10 items-center">
            <Slider
              type="single"
              bind:value={settings.avifSpeed}
              ariaLabel={$t("settings.avifSpeed")}
              min={0}
              max={10}
              step={1}
              disabled={busy}
              onValueCommit={commitAvifSpeed}
            />
          </div>
        </div>
        <div class="space-y-1.5">
          <Label class="text-sm text-muted-foreground">{$t("settings.avifChromaSubsampling")}</Label
          >
          <Select.Root
            type="single"
            bind:value={settings.avifSubsample}
            disabled={busy}
            onValueChange={setAvifSubsample}
          >
            <Select.Trigger
              class="w-full"
              disabled={busy}
              aria-label={$t("settings.avifChromaSubsampling")}>{avifSubsampleLabel}</Select.Trigger
            >
            <Select.Content>
              <Select.Item value="yuv444" label="4:4:4">4:4:4</Select.Item>
              <Select.Item value="yuv420" label="4:2:0">4:2:0</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
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
            ariaLabel={$t("settings.targetScore")}
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
              ariaLabel={$t("settings.minimumQuality")}
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
              ariaLabel={$t("settings.minimumQuality")}
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
              ariaLabel={$t("settings.minimumQuality")}
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
</SettingsSection>
