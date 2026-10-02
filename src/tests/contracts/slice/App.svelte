<script lang="ts">
  /**
   * The consumer the walking slice is witnessed through: an application that
   * mounts the provider and, under it, a profile that reads, posts and shows
   * what each relay answered. Written as a consumer would, against the v1
   * entry only.
   */
  import { NostrApp, type NostrSigner } from '$lib/v1/index.js';

  import Profile from './Profile.svelte';

  interface Props {
    relays: readonly string[];
    signer: NostrSigner;
    pubkey: string;
  }

  let { relays, signer, pubkey }: Props = $props();
</script>

<NostrApp {relays} {signer}>
  <Profile {pubkey} />
</NostrApp>
