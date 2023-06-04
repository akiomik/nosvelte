<script lang="ts">
  import NostrApp from '$lib/NostrApp.svelte';
  import Metadata from '$lib/Metadata.svelte';

  let relays: string[] = ['wss://relay.damus.io'];
  let newRelay = '';

  const unique = <A>(xs: A[]) => [...new Set(xs)];

  const removeRelay = (relay: string) => {
    relays = relays.filter((r) => r !== relay);
  };

  const addRelay = () => {
    if (newRelay) {
      relays = unique([...relays, newRelay]);
      newRelay = '';
    }
  };
</script>

<h1>Nostr profile viwer</h1>

<NostrApp {relays}>
  <ul>
    {#each relays as relay}
      <li>
        {relay}
        <button on:click={() => removeRelay(relay)}>Remove</button>
      </li>
    {/each}
  </ul>

  <label>
    New Relay
    <input type="text" bind:value={newRelay} />
  </label>
  <button on:click={addRelay}>Add</button>

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
