<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import NostrApp from '$lib/components/NostrApp.svelte';
  import Text from '$lib/components/Text.svelte';
  import UserReactionList from '$lib/components/UserReactionList.svelte';
  import type { Nostr } from '$lib/index.js';

  const relays: string[] = ['wss://relay.damus.io', 'wss://relay-jp.nostr.wirednet.jp'];
  const pubkey = '4d39c23b3b03bf99494df5f3a149c7908ae1bc7416807fdd6b34a31886eaae25';
  const limit = 10;

  const targetEventIdOf = (reaction: Nostr.Event) => {
    // Extract the last 'e' tag in .tags (NIP-25)
    return reaction.tags.filter(([tag]) => tag === 'e').slice(-1)[0][1];
  };
</script>

<svelte:head>
  <title>n-plus-1 (TBU) | nosvelte</title>
</svelte:head>

<NostrApp {relays}>
  <h1>n-plus-1 (TBU)</h1>

  <section>
    <UserReactionList
      queryKey={['n-plus-1', 'user-reaction-list', pubkey]}
      {pubkey}
      {limit}
      let:reactions
    >
      <div slot="loading">
        <p>Loading...</p>
      </div>

      <div slot="error" let:error>
        <p>{error}</p>
      </div>

      {#each reactions as reaction (reaction.id)}
        <!-- TODO: Re-use req to avoid N+1 problem -->
        <Text
          id={targetEventIdOf(reaction)}
          queryKey={['n-plus-1', targetEventIdOf(reaction)]}
          let:text
        >
          <div slot="loading">
            <p>Loading {reaction.id} ...</p>
          </div>

          <div slot="error" let:error>
            <p>{error}</p>
          </div>

          <div slot="nodata">
            <p>
              {reaction.content}
              Not found
            </p>
          </div>

          <p>
            {reaction.content}
            {text.content}
          </p>
        </Text>
      {/each}
    </UserReactionList>
  </section>
</NostrApp>
