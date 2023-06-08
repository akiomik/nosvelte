<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import type { Nostr } from 'rx-nostr';

  import NostrApp from '$lib/NostrApp.svelte';
  import Text from '$lib/Text.svelte';
  import UserReactionList from '$lib/UserReactionList.svelte';

  const relays: string[] = ['wss://relay.damus.io', 'wss://relay-jp.nostr.wirednet.jp'];
  const pubkey = '4d39c23b3b03bf99494df5f3a149c7908ae1bc7416807fdd6b34a31886eaae25';
  const limit = 10;

  const targetEventIdOf = (reaction: Nostr.Event) => {
    // Extract the last 'e' tag in .tags (NIP-25)
    return reaction.tags.filter(([tag]) => tag === 'e').slice(-1)[0][1];
  };
</script>

<svelte:head>
  <title>n-plus-1 (TBU) | svelte-nostr</title>
</svelte:head>

<NostrApp {relays}>
  <h1>n-plus-1 (TBU)</h1>

  <section>
    <UserReactionList {pubkey} {limit} let:reactions>
      <div slot="loading">
        <p>Loading...</p>
      </div>

      <div slot="error" let:error>
        <p>{error}</p>
      </div>

      {#each reactions as reaction (reaction.id)}
        <!-- TODO: Re-use req to avoid N+1 problem -->
        <Text id={targetEventIdOf(reaction)} let:text>
          <div slot="loading">
            <p>Loading {reaction.id} ...</p>
            <p />
          </div>

          <div slot="error" let:error>
            <p>{error}</p>
          </div>

          <p>
            {reaction.content}
            {#if text}
              {text.content}
            {:else}
              Not found
            {/if}
          </p>
        </Text>
      {/each}
    </UserReactionList>
  </section>
</NostrApp>
