<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The published entry with {@link DerivedRequest} under it, mounted while
   * `mounted` holds, so the provider outlives the consumer whose handle is kept.
   * Given `rooted`, the consumer is {@link RootedRequest}, which outlives the
   * provider.
   */
  import { NostrApp, type ReqHandle, type ReqPlan } from '$lib/v1/index.js';

  import DerivedRequest from './DerivedRequest.svelte';
  import RootedRequest from './RootedRequest.svelte';

  interface Props {
    relays: readonly string[];
    plan: () => ReqPlan;
    mounted: boolean;
    seen: (request: ReqHandle) => void;
    rooted?: (stop: () => void) => void;
  }

  let { relays, plan, mounted, seen, rooted }: Props = $props();
</script>

<NostrApp {relays}>
  {#if rooted !== undefined}
    <RootedRequest {plan} {seen} {rooted} />
  {:else if mounted}
    <DerivedRequest {plan} {seen} />
  {/if}
</NostrApp>
