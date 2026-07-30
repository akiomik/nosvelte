<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import { createRxForwardReq } from 'rx-nostr';

  import Contacts from '$lib/components/Contacts.svelte';
  import Metadata from '$lib/components/Metadata.svelte';
  import NostrApp from '$lib/components/NostrApp.svelte';
  import Text from '$lib/components/Text.svelte';
  import UniqueEventList from '$lib/components/UniqueEventList.svelte';
  import type { Nostr } from '$lib/index.js';

  const relays = ['wss://relay.damus.io', 'wss://relay-jp.nostr.wirednet.jp'];
  const pubkey = '4d39c23b3b03bf99494df5f3a149c7908ae1bc7416807fdd6b34a31886eaae25';
  const req = createRxForwardReq();

  const targetEventIdOf = (reaction: Nostr.Event): string | undefined => {
    // Extract the last 'e' tag in .tags (NIP-25)
    return reaction.tags.filter(([tag]) => tag === 'e').slice(-1)[0]?.[1];
  };

  const pubkeysIn = (contacts: Nostr.Event): string[] => {
    return contacts.tags.reduce<string[]>((acc, [tag, value]) => {
      if (tag === 'p' && value !== undefined) {
        return [...acc, value];
      } else {
        return acc;
      }
    }, []);
  };

  const sorted = (events: Nostr.Event[]) => {
    return [...events].sort((a, b) => b.created_at - a.created_at);
  };
</script>

<svelte:head>
  <title>timeline | nosvelte</title>
</svelte:head>

<NostrApp {relays}>
  <h1>timeline</h1>

  <Contacts queryKey={['timeline', 'contacts', pubkey]} {pubkey} let:contacts>
    <div slot="nodata">
      <p>Contacts not found</p>
    </div>

    <UniqueEventList
      queryKey={['timeline', 'feed', pubkey]}
      filters={[
        {
          authors: pubkeysIn(contacts),
          kinds: [1, 6, 7],
          limit: 10
        }
      ]}
      {req}
      let:events
    >
      <div slot="loading">
        <p>Loading...</p>
      </div>

      <div slot="error" let:error>
        <p>{error}</p>
      </div>

      <div style="display: flex; flex-direction: column; gap: 1em;">
        {#each sorted(events) as event (event.id)}
          {@const targetEventId = targetEventIdOf(event)}
          <!-- TODO: Re-use request to avoid rate limitting -->
          <Metadata
            queryKey={['timeline', 'metadata', event.pubkey]}
            pubkey={event.pubkey}
            let:metadata
          >
            <section style="border: 1px black solid; padding: 1em;">
              {#if event.kind === 1}
                <p>
                  {JSON.parse(metadata.content).name ?? 'nostrich'}
                  :
                  {event.content}
                </p>
              {:else if event.kind === 6}
                <p>reposted by {JSON.parse(metadata.content).name ?? 'nostrich'}</p>
                {#if targetEventId}
                  <Text queryKey={['timeline', targetEventId]} id={targetEventId} let:text>
                    <div slot="nodata">
                      <p>Failed to get note ({targetEventId})</p>
                    </div>

                    <Metadata
                      queryKey={['timeline', 'metadata', text.pubkey]}
                      pubkey={text.pubkey}
                      let:metadata={repostedMetadata}
                    >
                      <div slot="nodata">
                        <p>Failed to get profile (text.pubkey)</p>
                      </div>

                      <p>
                        {JSON.parse(repostedMetadata.content).name ?? 'nostrich'}
                        :
                        {text.content}
                      </p>
                    </Metadata>
                  </Text>
                {/if}
              {:else if event.kind === 7}
                <p>
                  {event.content === '+' ? '👍' : event.content}
                  by
                  {JSON.parse(metadata.content).name ?? 'nostrich'}
                </p>
                {#if targetEventId}
                  <Text queryKey={['timeline', targetEventId]} id={targetEventId} let:text>
                    <div slot="nodata">
                      <p>Failed to get note ({targetEventId})</p>
                    </div>

                    <Metadata
                      queryKey={['timeline', 'metadata', text.pubkey]}
                      pubkey={text.pubkey}
                      let:metadata={reactedMetadata}
                    >
                      <div slot="nodata">
                        <p>Failed to get profile (text.pubkey)</p>
                      </div>

                      <p>
                        {JSON.parse(reactedMetadata.content).name ?? 'nostrich'}
                        :
                        {text.content}
                      </p>
                    </Metadata>
                  </Text>
                {/if}
              {/if}
            </section>
          </Metadata>
        {/each}
      </div>
    </UniqueEventList>
  </Contacts>
</NostrApp>
