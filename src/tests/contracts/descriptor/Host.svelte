<script lang="ts">
  /**
   * Requests made through the published hook under one provider, each handed
   * back to the test as the handle a consumer holds.
   */
  import { NostrApp, type ReqHandle, type ReqPlan } from '$lib/v1/index.js';

  import Asker from './Asker.svelte';

  interface Props {
    relays: readonly string[];
    plans: (() => ReqPlan)[];
    seen?: (index: number, request: ReqHandle) => void;
  }

  let { relays, plans, seen = () => {} }: Props = $props();
</script>

<NostrApp {relays}>
  {#each plans as plan, index (index)}
    <Asker {plan} seen={(request) => seen(index, request)} />
  {/each}
</NostrApp>
