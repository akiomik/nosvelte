<script lang="ts">
  import { NostrApp, type NostrSigner } from '$lib/v1/index.js';

  import Poster from './Poster.svelte';

  interface Props {
    left: string;
    right: string;
    signer: NostrSigner;
  }

  let { left, right, signer }: Props = $props();
</script>

<NostrApp relays={[left]} {signer}>
  <Poster label="left" />
</NostrApp>
<NostrApp relays={[right]} {signer}>
  <Poster label="right" />
</NostrApp>
