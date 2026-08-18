<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { tick } from "svelte";
  import { t } from "svelte-i18n";
  import { MagnifyingGlass } from "phosphor-svelte";
  import * as Select from "$lib/components/ui/select";
  import { FORMAT_CATEGORIES, writableFormats } from "$lib/state.svelte";

  type TriggerSize = "sm" | "default";

  let {
    value = $bindable(""),
    includeGlobal = false,
    globalValue = "__global",
    globalLabel = $t("formatSelect.followGlobal"),
    disabled = false,
    triggerClass = "w-48",
    triggerSize = "default",
    sourceFormats = [],
    onChange,
  }: {
    value?: string;
    includeGlobal?: boolean;
    globalValue?: string;
    globalLabel?: string;
    disabled?: boolean;
    triggerClass?: string;
    triggerSize?: TriggerSize;
    sourceFormats?: string[];
    onChange?: (value: string) => void;
  } = $props();

  let open = $state(false);
  let search = $state("");
  let searchInput: HTMLInputElement | null = $state(null);

  const formats = $derived(writableFormats());
  const sourceSet = $derived(new Set(sourceFormats));
  const selectedFormat = $derived(formats.find((format) => format.value === value));
  const triggerLabel = $derived(
    includeGlobal && value === globalValue
      ? globalLabel
      : selectedFormat
        ? $t(selectedFormat.labelKey)
        : $t("formatSelect.selectFormat"),
  );
  const filteredFormats = $derived(
    formats.filter((format) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      return [format.value, $t(format.labelKey), $t(format.descriptionKey)]
        .join(" ")
        .toLowerCase()
        .includes(query);
    }),
  );
  const groupedFormats = $derived(
    FORMAT_CATEGORIES.map((category) => ({
      ...category,
      formats: filteredFormats.filter((format) => format.category === category.value),
    })).filter((category) => category.formats.length > 0),
  );

  $effect(() => {
    if (open) {
      void tick().then(() => searchInput?.focus());
    } else {
      search = "";
    }
  });

  function choose(next: string) {
    if (disabled) {
      open = false;
      return;
    }

    value = next;
    open = false;
    onChange?.(next);
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter" && filteredFormats[0]) {
      event.preventDefault();
      choose(filteredFormats[0].value);
    } else if (event.key === "Escape") {
      open = false;
    }
  }
</script>

<Select.Root type="single" bind:open bind:value {disabled} onValueChange={choose}>
  <Select.Trigger size={triggerSize} class={triggerClass}>
    <span data-slot="select-value" class="truncate">{triggerLabel}</span>
  </Select.Trigger>
  <Select.Content
    class="w-[min(520px,calc(100vw-2rem))] max-h-[min(70vh,28rem)] p-1 max-sm:!fixed max-sm:!inset-x-2 max-sm:!bottom-2 max-sm:!top-auto max-sm:!w-auto max-sm:!translate-x-0 max-sm:!translate-y-0"
  >
    <div class="mb-1 flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
      <MagnifyingGlass size={15} weight="duotone" class="text-muted-foreground" />
      <input
        bind:this={searchInput}
        bind:value={search}
        class="h-6 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        placeholder={$t("formatSelect.searchFormats")}
        onpointerdown={(event) => event.stopPropagation()}
        onkeydown={handleSearchKeydown}
      />
    </div>

    {#if includeGlobal}
      <Select.Item value={globalValue} label={globalLabel} class="h-auto py-2 pr-7 pl-2">
        <span class="flex min-w-0 flex-col items-start gap-0.5">
          <span class="font-medium">{globalLabel}</span>
          <span class="text-left text-[11px] leading-4 text-muted-foreground">
            {$t("formatSelect.singleFileKeepsGlobal")}
          </span>
        </span>
      </Select.Item>
      <Select.Separator />
    {/if}

    {#each groupedFormats as group (group.value)}
      <div class="px-1 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
        {$t(group.labelKey)}
      </div>
      <div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {#each group.formats as format (format.value)}
          <Select.Item
            value={format.value}
            label={$t(format.labelKey)}
            class="h-auto items-start py-2 pr-7 pl-2"
          >
            <span class="flex min-w-0 flex-col items-start gap-0.5">
              <span class="flex w-full min-w-0 items-center gap-1.5">
                <span class="font-medium">{$t(format.labelKey)}</span>
                {#if sourceSet.has(format.value)}
                  <span class="rounded border px-1 text-[10px] text-muted-foreground">
                    {$t("formatSelect.source")}
                  </span>
                {/if}
                {#if value === format.value}
                  <span class="rounded bg-primary px-1 text-[10px] text-primary-foreground">
                    {$t("formatSelect.selected")}
                  </span>
                {/if}
              </span>
              <span class="text-left text-[11px] leading-4 text-muted-foreground">
                {$t(format.descriptionKey)}
              </span>
            </span>
          </Select.Item>
        {/each}
      </div>
    {:else}
      <div class="px-2 py-6 text-center text-sm text-muted-foreground">
        {$t("formatSelect.noMatchingFormats")}
      </div>
    {/each}
  </Select.Content>
</Select.Root>
