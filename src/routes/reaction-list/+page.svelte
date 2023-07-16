<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import { createRxForwardReq } from 'rx-nostr';

  import Metadata from '$lib/components/Metadata.svelte';
  import NostrApp from '$lib/components/NostrApp.svelte';
  import Text from '$lib/components/Text.svelte';
  import UniqueEventList from '$lib/components/UniqueEventList.svelte';
  import type { Nostr } from '$lib/index.js';

  const relays = [
    'wss://nostr.wine',
    'wss://relay-jp.nostr.wirednet.jp',
    'wss://nostr-relay.nokotaro.com'
  ];
  const pubkey = 'c81c7999f7276387317878e59d7c321093a433977ee6811ca76dc3a9738e1869';
  const filters = [
    {
      authors: [pubkey],
      kinds: [7],
      limit: 100
    }
  ];
  const req = createRxForwardReq();

  const targetEventIdOf = (reaction: Nostr.Event) => {
    // Extract the last 'e' tag in .tags (NIP-25)
    return reaction.tags.filter(([tag]) => tag === 'e').slice(-1)[0][1];
  };

  const sorted = (events: Nostr.Event[]) => {
    return [...events].sort((a, b) => b.created_at - a.created_at);
  };
</script>

<svelte:head>
  <title>reaction-list | nosvelte</title>
</svelte:head>

<NostrApp {relays}>
  <h1>reaction-list</h1>

  <UniqueEventList
    queryKey={['reaction-list', 'unique-reaction-list', pubkey]}
    {filters}
    {req}
    let:events={reactions}
  >
    <div slot="loading">
      <p>Loading...</p>
    </div>

    <div slot="error" let:error>
      <p>{error}</p>
    </div>

    <div style="display: flex; flex-direction: column; gap: 1em;">
      {#each sorted(reactions) as reaction (reaction.id)}
        <Metadata
          queryKey={['reaction-list', 'metadata', reaction.pubkey]}
          pubkey={reaction.pubkey}
          let:metadata
        >
          <section style="border: 1px black solid; padding: 1em;">
            <p>
              {reaction.content === '+' ? '👍' : reaction.content}
              by
              {JSON.parse(metadata.content).name ?? 'nostrich'}
            </p>

            <Text
              queryKey={['reaction-list', targetEventIdOf(reaction)]}
              id={targetEventIdOf(reaction)}
              let:text
            >
              <div slot="loading">
                <p>Loading note... ({targetEventIdOf(reaction)})</p>
              </div>

              <div slot="error">
                <p>Failed to get note ({targetEventIdOf(reaction)})</p>
              </div>

              <div slot="nodata">
                <p>Note not found ({targetEventIdOf(reaction)})</p>
              </div>

              <Metadata
                queryKey={['reaction-list', 'metadata', text.pubkey]}
                pubkey={text.pubkey}
                let:metadata={reactedMetadata}
              >
                <div slot="loading">
                  <p>Loading profile... ({text.pubkey})</p>
                </div>

                <div slot="error">
                  <p>Failed to get profile ({text.pubkey})</p>
                </div>

                <div slot="nodata">
                  <p>Profile not found ({text.pubkey})</p>
                </div>

                <p>
                  {JSON.parse(reactedMetadata.content).name ?? 'nostrich'}
                  :
                  {text.content}
                </p>

                <p>
                  elapsed:
                  {reaction.created_at - text.created_at}
                  sec.
                </p>
              </Metadata>
            </Text>
          </section>
        </Metadata>
      {/each}
    </div>
  </UniqueEventList>
</NostrApp>
