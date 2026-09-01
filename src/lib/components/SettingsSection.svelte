<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts" module>
  let sectionSequence = 0;
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { AltArrowDownIcon } from "@solar-icons/svelte/bold-duotone";
  import { DangerCircleIcon } from "@solar-icons/svelte/bold-duotone";
  import { cn } from "$lib/utils.js";

  let {
    title,
    summary = "",
    open = $bindable(false),
    disabled = false,
    error = false,
    onToggle,
    children,
  }: {
    title: string;
    summary?: string;
    open?: boolean;
    disabled?: boolean;
    error?: boolean;
    /** Controlled mode (accordion): parent owns the open state. */
    onToggle?: (open: boolean) => void;
    children: Snippet;
  } = $props();

  const panelId = `settings-section-${++sectionSequence}`;

  function toggle() {
    if (disabled) return;
    const next = !open;
    if (onToggle) {
      onToggle(next);
    } else {
      open = next;
    }
  }
</script>

<section>
  <button
    type="button"
    class="flex min-h-11 w-full items-center gap-2 rounded-md px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
    aria-expanded={open}
    aria-controls={panelId}
    {disabled}
    onclick={toggle}
  >
    <span class="min-w-0 flex-1">
      <span class={cn("block text-sm font-semibold", error && "text-destructive")}>{title}</span>
      {#if summary && !open}
        <span
          class={cn(
            "block truncate text-xs",
            disabled ? "text-muted-foreground/60" : "text-muted-foreground",
          )}
        >
          {summary}
        </span>
      {/if}
    </span>
    {#if error}
      <DangerCircleIcon size={15} class="shrink-0 text-destructive" />
    {/if}
    <AltArrowDownIcon
      size={15}
      class={cn(
        "shrink-0 text-muted-foreground transition-transform ease-[var(--motion-ease-img)]",
        open && "rotate-180",
      )}
    />
  </button>
  {#if open}
    <div id={panelId} class="px-4 pb-4">
      {@render children()}
    </div>
  {/if}
</section>
