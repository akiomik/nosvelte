<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The published entry and nothing else: `NostrApp` with `relays` only, and
   * a published `EventList` under it — or, given `single`, a published `Event`
   * for the first id — every outlet it renders handing the test the argument
   * it was given: the events, or the event, and the request.
   */
  import { Event, EventList, NostrApp } from '$lib/v1/index.js';

  interface Props {
    relays: readonly string[];
    ids: readonly string[];
    single?: boolean;
    held: (outlet: string, argument: unknown) => void;
  }

  let { relays, ids, single = false, held }: Props = $props();
</script>

<NostrApp {relays}>
  {#if single}
    <Event id={ids[0] as string}>
      {#snippet children(argument)}{held('events', argument)}{/snippet}
      {#snippet loading(argument)}{held('loading', argument)}{/snippet}
      {#snippet nodata(argument)}{held('nodata', argument)}{/snippet}
      {#snippet error(argument)}{held('error', argument)}{/snippet}
    </Event>
  {:else}
    <EventList {ids}>
      {#snippet children(argument)}{held('events', argument)}{/snippet}
      {#snippet loading(argument)}{held('loading', argument)}{/snippet}
      {#snippet nodata(argument)}{held('nodata', argument)}{/snippet}
      {#snippet error(argument)}{held('error', argument)}{/snippet}
    </EventList>
  {/if}
</NostrApp>
