<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The provider (0004 C6): one resource domain — the connection pool, the
   * cache, the clock and the diagnostics — owned here and released when this
   * component goes. `relays` is applied on every change; `signer` is read once,
   * when the provider is created (0004, the send section).
   */
  import type { Snippet } from 'svelte';

  import { createNostrContext, setNostrContext } from '../context.svelte.js';
  import type { RelayInput } from '../scope.svelte.js';
  import type { NostrSigner } from '../send.svelte.js';

  interface Props {
    relays?: readonly RelayInput[];
    signer?: NostrSigner;
    children: Snippet;
  }

  let { relays = [], signer, children }: Props = $props();

  // svelte-ignore state_referenced_locally
  const context = createNostrContext({ relays, ...(signer === undefined ? {} : { signer }) });
  setNostrContext(context);

  $effect(() => {
    context.setRelays(relays);
  });
</script>

{@render children()}
