<script lang="ts">
  import NostrApp from '$lib/NostrApp.svelte';
  import Metadata from '$lib/Metadata.svelte';
</script>

<NostrApp relays={['wss://relay.damus.io']}>
  <Metadata pubkey="4d39c23b3b03bf99494df5f3a149c7908ae1bc7416807fdd6b34a31886eaae25" let:metadata>
    <div slot="loading">
      <p>Loading...</p>
    </div>

    <div slot="error" let:error>
      <p>{error}</p>
    </div>

    <p>{JSON.parse(metadata.content).name}</p>
  </Metadata>
</NostrApp>
