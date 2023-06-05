<script lang="ts">
  import { onDestroy } from 'svelte';
  import { readable } from 'svelte/store';
  import { createRxNostr, type Relay, type RxNostr, type ConnectionStatePacket } from 'rx-nostr';
  import { app, useConnections } from './store.js';

  export let relays: (string | Relay)[] = [];

  let client: RxNostr = createRxNostr();

  // TODO: Add empty relays support to useConnections
  $: connections = relays.length > 0 ? useConnections(client, relays) : readable([]);

  $: {
    client.setRelays(relays);
    app.set({ client });
  }

  onDestroy(() => {
    client.dispose();
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface $$Slots {
    default: { connections: ConnectionStatePacket[] };
  }
</script>

<slot connections={$connections} />
