<script lang="ts">
  import type { QueryClientConfig } from '@tanstack/svelte-query';
  import type { DefaultRelayConfig } from 'rx-nostr';

  import { Event, NostrApp } from '$lib/components/index.js';

  export let relays: (string | DefaultRelayConfig)[] = [];
  export let queryClientConfig: QueryClientConfig = {};
</script>

<NostrApp {relays} {queryClientConfig} let:connections>
  <div data-testid="connections">{JSON.stringify(connections)}</div>

  <!-- Rendered with no manual `setQueryClientContext()` call: proves the
       QueryClientProvider set up by NostrApp actually reaches a descendant. -->
  <Event queryKey={['NostrAppHost-event']} id="child-id">
    <svelte:fragment let:status>
      <div data-testid="child-status">{status}</div>
    </svelte:fragment>
    <svelte:fragment slot="nodata">
      <div data-testid="child-nodata">nodata</div>
    </svelte:fragment>
  </Event>
</NostrApp>
