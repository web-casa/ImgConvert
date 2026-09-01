<script lang="ts">
  import { Slider as SliderPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    value = $bindable(),
    orientation = "horizontal",
    ariaLabel,
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<SliderPrimitive.RootProps> & { ariaLabel?: string } = $props();
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<SliderPrimitive.Root
  bind:ref
  bind:value={value as never}
  data-slot="slider"
  {orientation}
  class={cn(
    "relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
    className,
  )}
  {...restProps}
>
  {#snippet children({ thumbItems })}
    <span
      data-slot="slider-track"
      data-orientation={orientation}
      class={cn(
        "relative h-2 w-full grow overflow-hidden rounded-full bg-border/80 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2",
      )}
    >
      <SliderPrimitive.Range
        data-slot="slider-range"
        class={cn(
          "absolute bg-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
        )}
      />
    </span>
    {#each thumbItems as thumb (thumb.index)}
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        index={thumb.index}
        aria-label={ariaLabel}
        class="relative block size-4 shrink-0 rounded-full border-2 border-background bg-primary shadow-sm ring-ring/45 transition-[color,box-shadow,transform] after:absolute after:-inset-3 hover:scale-105 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:scale-95 active:ring-3 disabled:pointer-events-none disabled:opacity-50"
      />
    {/each}
  {/snippet}
</SliderPrimitive.Root>
