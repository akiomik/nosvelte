<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createRxNostr, type Relay, type RxNostr } from 'rx-nostr';
  import { app } from './store';

  export let relays: (string | Relay)[];

  let client: RxNostr;

  onMount(() => {
    client = createRxNostr();
  });

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
