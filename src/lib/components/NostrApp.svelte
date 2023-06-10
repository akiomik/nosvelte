<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import type { ConnectionStatePacket, Relay } from 'rx-nostr';
  import { createRxNostr } from 'rx-nostr';
  import { onDestroy } from 'svelte';

  import { app, useConnections } from '$lib/stores/index.js';

  export let relays: (string | Relay)[] = [];

  const rxNostr = createRxNostr();

  $: connections = useConnections({ rxNostr, relays });

  $: {
    rxNostr.setRelays(relays);
    app.set({ rxNostr });
  }

  onDestroy(() => {
    rxNostr.dispose();
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface $$Slots {
    default: { connections: ConnectionStatePacket[] };
  }
</script>

<slot connections={$connections} />
