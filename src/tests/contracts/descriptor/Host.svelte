<script lang="ts">
  /**
   * Requests made through the published hook under one provider, each handed
   * back to the test as the handle a consumer holds, and, when asked for, the
   * provider's relay diagnostics.
   */
  import { NostrApp, type ReqHandle, type ReqPlan, useRelayDiagnostics } from '$lib/v1/index.js';

  import Asker from './Asker.svelte';
  import Diagnostics from './Diagnostics.svelte';

  interface Props {
    relays: readonly string[];
    plans: (() => ReqPlan)[];
    seen?: (index: number, request: ReqHandle) => void;
    diagnostics?: (diagnostics: ReturnType<typeof useRelayDiagnostics>) => void;
  }

  let { relays, plans, seen = () => {}, diagnostics }: Props = $props();
</script>

<NostrApp {relays}>
  {#if diagnostics !== undefined}
    <Diagnostics seen={diagnostics} />
  {/if}
  {#each plans as plan, index (index)}
    <Asker {plan} seen={(request) => seen(index, request)} />
  {/each}
</NostrApp>
