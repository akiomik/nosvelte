<script lang="ts">
  /**
   * A provider whose transport names each relay with a trailing slash, built
   * through `createNostrContext`'s `transportKeys` seam, and a send made under
   * it handed back to the test.
   */
  import type { Snippet } from 'svelte';

  import { createNostrContext, setNostrContext } from '$lib/v1/context.svelte.js';
  import { canonicalUrl } from '$lib/v1/scope.svelte.js';
  import type { NostrSigner } from '$lib/v1/send.svelte.js';

  interface Props {
    relays: readonly string[];
    signer: NostrSigner;
    children: Snippet;
  }

  let { relays, signer, children }: Props = $props();

  // svelte-ignore state_referenced_locally
  const context = createNostrContext({
    relays,
    signer,
    transportKeys: (urls) => urls.map((url) => `${canonicalUrl(url)}/`)
  });
  setNostrContext(context);
</script>

{@render children()}
