<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createRxNostr, type Relay, type RxNostr } from 'rx-nostr';
  import { app } from './store.js';

  export let relays: (string | Relay)[];

  let client: RxNostr = createRxNostr();

  onDestroy(() => {
    client.dispose();
  });

  // TODO: Manage connections
  $: {
    client.setRelays(relays);
    app.set({ client });
  }
</script>

<slot />
