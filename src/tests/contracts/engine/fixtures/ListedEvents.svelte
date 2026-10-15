<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The published entry and nothing else: `NostrApp` with `relays` only, and
   * a published `EventList` under it, every outlet it renders handing the
   * test the argument it was given — the events and the request.
   */
  import { EventList, NostrApp } from '$lib/v1/index.js';

  interface Props {
    relays: readonly string[];
    ids: readonly string[];
    held: (outlet: string, argument: unknown) => void;
  }

  let { relays, ids, held }: Props = $props();
</script>

<NostrApp {relays}>
  <EventList {ids}>
    {#snippet children(argument)}{held('events', argument)}{/snippet}
    {#snippet loading(argument)}{held('loading', argument)}{/snippet}
    {#snippet nodata(argument)}{held('nodata', argument)}{/snippet}
    {#snippet error(argument)}{held('error', argument)}{/snippet}
  </EventList>
</NostrApp>
