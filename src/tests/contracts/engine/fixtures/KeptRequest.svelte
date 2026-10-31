<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The published entry with {@link DerivedRequest} under it, mounted while
   * `mounted` holds, so the provider outlives the consumer whose handle is kept.
   * Given `rooted`, the consumer is {@link RootedRequest}, whose request outlives
   * the component and, unmounted whole, the provider. `beside` puts a second on
   * the same entry, whose `rooted` comes last, and `contexts` is handed what a
   * consumer under this entry would see.
   */
  import { NostrApp, type ReqHandle, type ReqPlan } from '$lib/v1/index.js';

  import ContextReader from './ContextReader.svelte';
  import DerivedRequest from './DerivedRequest.svelte';
  import RootedRequest from './RootedRequest.svelte';

  interface Props {
    relays: readonly string[];
    plan: () => ReqPlan;
    mounted: boolean;
    seen: (request: ReqHandle) => void;
    rooted?: (stop: () => void) => void;
    direct?: boolean;
    watched?: boolean;
    beside?: (request: ReqHandle) => void;
    contexts?: (read: Map<unknown, unknown>) => void;
  }

  let {
    relays,
    plan,
    mounted,
    seen,
    rooted,
    direct = false,
    watched = false,
    beside,
    contexts
  }: Props = $props();
</script>

<NostrApp {relays}>
  {#if contexts !== undefined}
    <ContextReader read={contexts} />
  {/if}
  {#if mounted}
    {#if rooted !== undefined}
      <RootedRequest {plan} {seen} {rooted} {direct} {watched} />
      {#if beside !== undefined}
        <RootedRequest {plan} seen={beside} {rooted} {direct} />
      {/if}
    {:else}
      <DerivedRequest {plan} {seen} />
    {/if}
  {/if}
</NostrApp>
