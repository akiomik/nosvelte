<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import { createRxForwardReq, Nostr } from 'rx-nostr';

  import Contacts from '$lib/Contacts.svelte';
  import Metadata from '$lib/Metadata.svelte';
  import NostrApp from '$lib/NostrApp.svelte';
  import Text from '$lib/Text.svelte';
  import UniqueEventList from '$lib/UniqueEventList.svelte';

  const relays = ['wss://relay.damus.io', 'wss://relay-jp.nostr.wirednet.jp'];
  const pubkey = '4d39c23b3b03bf99494df5f3a149c7908ae1bc7416807fdd6b34a31886eaae25';
  const req = createRxForwardReq();

  const targetEventIdOf = (reaction: Nostr.Event) => {
    // Extract the last 'e' tag in .tags (NIP-25)
    return reaction.tags.filter(([tag]) => tag === 'e').slice(-1)[0][1];
  };

  const pubkeysIn = (contacts: Nostr.Event) => {
    return contacts.tags.reduce((acc, [tag, value]) => {
      if (tag === 'p') {
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
  <title>timeline | svelte-nostr</title>
</svelte:head>

<NostrApp {relays}>
  <h1>timeline</h1>

  <Contacts {pubkey} let:contacts>
    {#if contacts}
      <UniqueEventList
        filters={[
          {
            authors: pubkeysIn(contacts),
            kinds: [Nostr.Kind.Text, Nostr.Kind.Repost, Nostr.Kind.Reaction],
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
            <section style="border: 1px black solid; padding: 1em;">
              <!-- TODO: Re-use request to avoid rate limitting -->
              <Metadata pubkey={event.pubkey} let:metadata>
                {#if metadata}
                  {#if event.kind === Nostr.Kind.Text}
                    <p>
                      {JSON.parse(metadata.content).name ?? 'nostrich'}
                      :
                      {event.content}
                    </p>
                  {:else if event.kind === Nostr.Kind.Repost}
                    <p>reposted by {JSON.parse(metadata.content).name ?? 'nostrich'}</p>
                    <Text id={targetEventIdOf(event)} let:text>
                      {#if text}
                        <Metadata pubkey={text.pubkey} let:metadata={repostedMetadata}>
                          {#if repostedMetadata}
                            <p>
                              {JSON.parse(repostedMetadata.content).name ?? 'nostrich'}
                              :
                              {text.content}
                            </p>
                          {:else}
                            <p>Failed to get profile (text.pubkey)</p>
                          {/if}
                        </Metadata>
                      {:else}
                        <p>Failed to get note ({targetEventIdOf(event)})</p>
                      {/if}
                    </Text>
                  {:else if event.kind === Nostr.Kind.Reaction}
                    <p>
                      {event.content === '+' ? '👍' : event.content} by {JSON.parse(
                        metadata.content
                      ).name ?? 'nostrich'}
                    </p>
                    <Text id={targetEventIdOf(event)} let:text>
                      {#if text}
                        <Metadata pubkey={text.pubkey} let:metadata={reactedMetadata}>
                          {#if reactedMetadata}
                            <p>
                              {JSON.parse(reactedMetadata.content).name ?? 'nostrich'}
                              :
                              {text.content}
                            </p>
                          {:else}
                            <p>Failed to get profile (text.pubkey)</p>
                          {/if}
                        </Metadata>
                      {:else}
                        <p>Failed to get note ({targetEventIdOf(event)})</p>
                      {/if}
                    </Text>
                  {/if}
                {/if}
              </Metadata>
            </section>
          {/each}
        </div>
      </UniqueEventList>
    {/if}
  </Contacts>
</NostrApp>
