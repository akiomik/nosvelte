<script lang="ts">
  import { NostrApp, Metadata } from 'svelte-nostr';
</script>

<NostrApp relays={['wss://relay.damus.io']}>
  <Metadata pubkey="4d39c23b3b03bf99494df5f3a149c7908ae1bc7416807fdd6b34a31886eaae25" />
</NostrApp>
