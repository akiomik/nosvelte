<script lang="ts">
  /**
   * Under a provider with a transport naming seam: a consumer's own requests,
   * and a send, each handed back to the test.
   */
  import type { NostrContext } from '$lib/v1/context.svelte.js';
  import type { ReqHandle, ReqPlan, Send } from '$lib/v1/index.js';
  import type { RelayInput, TransportKeys } from '$lib/v1/scope.svelte.js';
  import type { NostrSigner } from '$lib/v1/send.svelte.js';

  import Asker from '../../descriptor/Asker.svelte';
  import KeyedProvider from './KeyedProvider.svelte';
  import SendProbe from './SendProbe.svelte';

  interface Props {
    relays: readonly RelayInput[];
    transportKeys: TransportKeys;
    signer?: NostrSigner;
    plans: (() => ReqPlan)[];
    request?: (index: number, handle: ReqHandle) => void;
    send?: (send: Send) => void;
    seen?: (context: NostrContext) => void;
  }

  let {
    relays,
    transportKeys,
    signer,
    plans,
    request = () => {},
    send = () => {},
    seen = () => {}
  }: Props = $props();
</script>

<KeyedProvider {relays} {transportKeys} {seen} {...signer === undefined ? {} : { signer }}>
  {#each plans as plan, index (index)}
    <Asker {plan} seen={(handle) => request(index, handle)} />
  {/each}
  <SendProbe seen={send} />
</KeyedProvider>
