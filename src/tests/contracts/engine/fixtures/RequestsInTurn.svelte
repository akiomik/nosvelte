<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The published entry and nothing else: `NostrApp` with `relays` only, a
   * first request under it, and a second request under the same provider that
   * is mounted only when the test re-renders this with `later` set — so the
   * second begins after whatever the test did to the relays the first opened.
   * Each request is handed back to the test as it is made.
   */
  import { NostrApp, type ReqHandle, type ReqPlan } from '$lib/v1/index.js';

  import WatchedRequest from './WatchedRequest.svelte';

  interface Props {
    relays: readonly string[];
    first: () => ReqPlan;
    second: () => ReqPlan;
    later: boolean;
    seen: (which: 'first' | 'second', request: ReqHandle) => void;
  }

  let { relays, first, second, later, seen }: Props = $props();
</script>

<NostrApp {relays}>
  <WatchedRequest plan={first} seen={(request) => seen('first', request)} published={() => {}} />
  {#if later}
    <WatchedRequest
      plan={second}
      seen={(request) => seen('second', request)}
      published={() => {}}
    />
  {/if}
</NostrApp>
