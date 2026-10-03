<script lang="ts">
  /**
   * A provider built through `createNostrContext` with a transport naming seam
   * (`transportKeys`), handing its context back to the test, with the children
   * under it.
   */
  import type { Snippet } from 'svelte';

  import {
    createNostrContext,
    type NostrContext,
    setNostrContext
  } from '$lib/v1/context.svelte.js';
  import type { RelayInput, TransportKeys } from '$lib/v1/scope.svelte.js';
  import type { NostrSigner } from '$lib/v1/send.svelte.js';

  import { HARNESS_DIVERGENCES } from '../helpers/relay.js';

  interface Props {
    relays: readonly RelayInput[];
    transportKeys: TransportKeys;
    signer?: NostrSigner;
    seen?: (context: NostrContext) => void;
    children?: Snippet;
  }

  let { relays, transportKeys, signer, seen = () => {}, children }: Props = $props();

  // svelte-ignore state_referenced_locally
  const context = createNostrContext({
    relays,
    transportKeys,
    harness: HARNESS_DIVERGENCES,
    ...(signer === undefined ? {} : { signer })
  });
  setNostrContext(context);
  // svelte-ignore state_referenced_locally
  seen(context);
</script>

{@render children?.()}
