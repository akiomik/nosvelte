<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import type { QueryClientConfig } from '@tanstack/svelte-query';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import type { ConnectionStatePacket, Relay } from 'rx-nostr';
  import { createRxNostr } from 'rx-nostr';
  import { onDestroy } from 'svelte';

  import { app, useConnections } from '$lib/stores/index.js';

  export let queryClientConfig: QueryClientConfig = {};
  export let relays: (string | Relay)[] = [];

  const rxNostr = createRxNostr();
  const defaultQueryClientConfig = {
    defaultOptions: {
      queries: {
        staleTime: 1000 * 30,
        refetchInterval: Infinity
      }
    }
  };

  $: connections = useConnections({ rxNostr, relays });
  $: mergedQueryClientConfig = { ...defaultQueryClientConfig, ...queryClientConfig };
  $: queryClient = new QueryClient(mergedQueryClientConfig);

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

<QueryClientProvider client={queryClient}>
  <slot connections={$connections} />
</QueryClientProvider>
