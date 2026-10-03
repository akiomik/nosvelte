<script lang="ts">
  /**
   * Requests made through the published hook under one provider, each handed
   * back to the test as the handle a consumer holds, and, when asked for, the
   * provider's relay diagnostics and a send operation.
   */
  import {
    NostrApp,
    type NostrSigner,
    type RelayInput,
    type ReqHandle,
    type ReqPlan,
    type Send,
    useRelayDiagnostics
  } from '$lib/v1/index.js';

  import Asker from './Asker.svelte';
  import Diagnostics from './Diagnostics.svelte';
  import Sender from './Sender.svelte';

  interface Props {
    relays: readonly RelayInput[];
    plans: (() => ReqPlan)[];
    seen?: (index: number, request: ReqHandle) => void;
    diagnostics?: (diagnostics: ReturnType<typeof useRelayDiagnostics>) => void;
    signer?: NostrSigner;
    sender?: (send: Send) => void;
  }

  let { relays, plans, seen = () => {}, diagnostics, signer, sender }: Props = $props();
</script>

<NostrApp {relays} {...signer === undefined ? {} : { signer }}>
  {#if diagnostics !== undefined}
    <Diagnostics seen={diagnostics} />
  {/if}
  {#if sender !== undefined}
    <Sender seen={sender} />
  {/if}
  {#each plans as plan, index (index)}
    <Asker {plan} seen={(request) => seen(index, request)} />
  {/each}
</NostrApp>
