<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import type { ConnectionStatePacket, Relay, RxNostr } from 'rx-nostr';
  import { createRxNostr } from 'rx-nostr';
  import { onDestroy } from 'svelte';

  import { app, useConnections } from '$lib/stores/index.js';

  export let relays: (string | Relay)[] = [];

  let client: RxNostr = createRxNostr();

  $: connections = useConnections({ client, relays });

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
