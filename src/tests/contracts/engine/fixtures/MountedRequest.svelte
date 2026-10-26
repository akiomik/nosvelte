<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The published entry with one request under it that the arm can tear down
   * on its own: `NostrApp` with `relays` only, and the consumer mounted while
   * `mounted` holds, so the provider and its connections outlive it. With
   * `ready`, the provider's context is handed over before the consumer exists.
   */
  import type { NostrContext } from '$lib/v1/context.svelte.js';
  import { NostrApp, type ReqHandle, type ReqPlan } from '$lib/v1/index.js';

  import ProviderReader from './ProviderReader.svelte';
  import WatchedRequest from './WatchedRequest.svelte';

  interface Props {
    relays: readonly string[];
    plan: () => ReqPlan;
    mounted: boolean;
    seen: (request: ReqHandle) => void;
    ready?: (context: NostrContext) => void;
  }

  let { relays, plan, mounted, seen, ready }: Props = $props();
</script>

<NostrApp {relays}>
  {#if ready !== undefined}
    <ProviderReader {ready} />
  {/if}
  {#if mounted}
    <WatchedRequest {plan} {seen} published={() => {}} />
  {/if}
</NostrApp>
