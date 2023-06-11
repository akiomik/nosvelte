<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import Metadata from '$lib/components/Metadata.svelte';
  import NostrApp from '$lib/components/NostrApp.svelte';

  const relays: string[] = ['wss://relay.damus.io', 'wss://relay.snort.social'];
  const pubkey = '4d39c23b3b03bf99494df5f3a149c7908ae1bc7416807fdd6b34a31886eaae25';
</script>

<svelte:head>
  <title>simple | svelte-nostr</title>
</svelte:head>

<NostrApp {relays}>
  <h1>simple</h1>

  <section>
    <Metadata queryKey={['simple', 'metadata', pubkey]} {pubkey} let:metadata>
      <div slot="loading">
        <p>Loading...</p>
      </div>

      <div slot="error" let:error>
        <p>{error}</p>
      </div>

      <div slot="nodata">
        <p>Not found</p>
      </div>

      <p>{JSON.parse(metadata.content).name ?? 'nostrich'}</p>
    </Metadata>
  </section>
</NostrApp>
