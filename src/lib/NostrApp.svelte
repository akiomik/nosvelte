<script lang="ts">
  import { createRxNostr, type Relay } from 'rx-nostr';
  import { app } from './store';

  export let relays: Relay[];

  const client = createRxNostr()

  // TODO: Manage connections
  $: {
    client.setRelays(relays);
    app.set({ client });
  }
</script>

<slot />
