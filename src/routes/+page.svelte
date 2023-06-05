<!--
@license Apache-2.0
@copyright 2023 Akiomi Kamakura
-->

<script lang="ts">
  import NostrApp from '$lib/NostrApp.svelte';
  import Metadata from '$lib/Metadata.svelte';

  let relays: string[] = ['wss://relay.damus.io', 'wss://relay.snort.social'];
  let newRelay = '';
  let pubkey = '4d39c23b3b03bf99494df5f3a149c7908ae1bc7416807fdd6b34a31886eaae25';

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

<NostrApp {relays} let:connections>
  <section>
    <h2>Relays</h2>

    <ul>
      {#each connections as connection (connection.from)}
        <li>
          {connection.from}
          /
          {connection.state}
          <button on:click={() => removeRelay(connection.from)}>Remove</button>
        </li>
      {/each}
    </ul>

    <form on:submit={addRelay}>
      <input
        type="text"
        bind:value={newRelay}
        placeholder="wss://..."
        pattern="wss?://.+"
        required
      />
      <button type="submit">Add</button>
    </form>
  </section>

  <section>
    <h2>Profile</h2>

    <input
      type="text"
      bind:value={pubkey}
      placeholder="pubkey"
      pattern="[a-z0-9]{64}"
      required
      size="64"
    />

    {#if pubkey}
      <Metadata {pubkey} let:metadata>
        <div slot="loading">
          <p>Loading...</p>
        </div>

        <div slot="error" let:error>
          <p>{error}</p>
        </div>

        {#if metadata}
          <p>{JSON.parse(metadata.content).name}</p>
        {:else}
          <p>Not found</p>
        {/if}
      </Metadata>
    {/if}
  </section>
</NostrApp>
