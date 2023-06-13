# svelte-nostr

An experimental Svelte library for building [Nostr](https://nostr.com) apps easily.
Highly inspired by sveltefire.

```svelte
<script lang="ts">
  import Metadata from '$lib/components/Metadata.svelte';
  import NostrApp from '$lib/components/NostrApp.svelte';

  const relays: string[] = ['wss://relay.damus.io', 'wss://relay.snort.social'];
  const pubkey = '4d39c23b3b03bf99494df5f3a149c7908ae1bc7416807fdd6b34a31886eaae25';
</script>

<NostrApp {relays}>
  <Metadata queryKey={['metadata', pubkey]} {pubkey} let:metadata>
    <div slot="loading">
      <p>Loading...</p>
    </div>
  
    <div slot="error" let:error>
      <p>{error}</p>
    </div>
  
    <div slot="nodata">
      <p>Not found</p>
    </div>
  
    <!-- Shows user name -->
    <p>{JSON.parse(metadata.content).name ?? 'nostrich'}</p>
  </Metadata>
</NostrApp>
```

## Features

- Zero-configuration
- Svelte stores and components to use Nostr events
- Caching requests

## Exapmles

You can see some example codes in (src/routes)[https://github.com/akiomik/svelte-nostr/tree/main/src/routes].
