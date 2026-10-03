<script lang="ts">
  /** `useSend` under the renaming provider, handed back to the test. */
  import type { Send } from '$lib/v1/index.js';
  import type { NostrSigner } from '$lib/v1/send.svelte.js';

  import RenamingProvider from './RenamingProvider.svelte';
  import SendProbe from './SendProbe.svelte';

  interface Props {
    relays: readonly string[];
    signer: NostrSigner;
    seen: (send: Send) => void;
  }

  let { relays, signer, seen }: Props = $props();
</script>

<RenamingProvider {relays} {signer}>
  <SendProbe {seen} />
</RenamingProvider>
