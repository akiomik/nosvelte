<script lang="ts">
  import Metadata from '$lib/components/Metadata.svelte';
  import NostrApp from '$lib/components/NostrApp.svelte';
  import Text from '$lib/components/Text.svelte';

  const relays = ['wss://relay.damus.io', 'wss://relay.snort.social'];
  const id = 'b6cf76789bd25d11eafa65d28c16dd640056919f703191aa06619c5b21f732e3';
</script>

<NostrApp {relays}>
  <h1>readme</h1>

  <Text queryKey={[id]} {id} let:text>
    <Metadata queryKey={['metadata', text.pubkey]} pubkey={text.pubkey} let:metadata>
      <!-- Shows "jack: Japan confirmed punk" -->
      <p>{JSON.parse(metadata.content).name}: {text.content}</p>
    </Metadata>
  </Text>
</NostrApp>
