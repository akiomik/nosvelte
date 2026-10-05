<script lang="ts">
  /**
   * Every outlet a request component renders through, each handing the test the
   * argument it was given — the object a consumer's snippet holds.
   *
   * `RequestOutlets` rather than a published component, because it is where
   * every one of them builds those arguments (`PB13` reads that premise off the
   * components' sources), and driving it with an engine handle lets an arm put
   * the request in each slot without a provider and a signed event per slot.
   */
  import RequestOutlets from '$lib/v1/components/RequestOutlets.svelte';
  import type { ReqHandle } from '$lib/v1/index.js';

  interface Props {
    request: ReqHandle;
    /** A single-event component's `event` outlet, rather than a list's `events`. */
    single: boolean;
    held: (outlet: string, argument: unknown) => void;
  }

  let { request, single, held }: Props = $props();
</script>

{#if single}
  <RequestOutlets {request}>
    {#snippet event(argument)}{held('event', argument)}{/snippet}
    {#snippet loading(argument)}{held('loading', argument)}{/snippet}
    {#snippet nodata(argument)}{held('nodata', argument)}{/snippet}
    {#snippet error(argument)}{held('error', argument)}{/snippet}
  </RequestOutlets>
{:else}
  <RequestOutlets {request}>
    {#snippet events(argument)}{held('events', argument)}{/snippet}
    {#snippet loading(argument)}{held('loading', argument)}{/snippet}
    {#snippet nodata(argument)}{held('nodata', argument)}{/snippet}
    {#snippet error(argument)}{held('error', argument)}{/snippet}
  </RequestOutlets>
{/if}
