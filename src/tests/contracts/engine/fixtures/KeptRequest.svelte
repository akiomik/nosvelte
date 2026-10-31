<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The published entry with {@link DerivedRequest} under it, mounted while
   * `mounted` holds, so the provider outlives the consumer whose handle is kept.
   */
  import { NostrApp, type ReqHandle, type ReqPlan } from '$lib/v1/index.js';

  import DerivedRequest from './DerivedRequest.svelte';

  interface Props {
    relays: readonly string[];
    plan: () => ReqPlan;
    mounted: boolean;
    seen: (request: ReqHandle) => void;
  }

  let { relays, plan, mounted, seen }: Props = $props();
</script>

<NostrApp {relays}>
  {#if mounted}
    <DerivedRequest {plan} {seen} />
  {/if}
</NostrApp>
