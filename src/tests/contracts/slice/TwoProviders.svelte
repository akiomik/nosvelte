<script lang="ts">
  import { NostrApp, type NostrSigner } from '$lib/v1/index.js';

  import Poster from './Poster.svelte';

  interface Props {
    left: string;
    right: string;
    leftSigner: NostrSigner;
    rightSigner: NostrSigner;
  }

  let { left, right, leftSigner, rightSigner }: Props = $props();
</script>

<NostrApp relays={[left]} signer={leftSigner}>
  <Poster label="left" />
</NostrApp>
<NostrApp relays={[right]} signer={rightSigner}>
  <Poster label="right" atInit />
</NostrApp>
