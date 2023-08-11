# nosvelte

[![npm version](https://badge.fury.io/js/nosvelte.svg)](https://badge.fury.io/js/nosvelte)
[![Node.js CI](https://github.com/akiomik/nosvelte/actions/workflows/node-ci.yml/badge.svg)](https://github.com/akiomik/nosvelte/actions/workflows/node-ci.yml)

An experimental Svelte library for building [Nostr](https://nostr.com) apps easily.
Highly inspired by [sveltefire](https://github.com/codediodeio/sveltefire).

```svelte
<script lang="ts">
  import { Metadata, NostrApp, Text } from 'nosvelte';

  const relays = ['wss://relay.damus.io', 'wss://relay.snort.social'];
  const id = 'b6cf76789bd25d11eafa65d28c16dd640056919f703191aa06619c5b21f732e3';
</script>

<NostrApp {relays}>
  <Text queryKey={[id]} {id} let:text>
    <Metadata queryKey={['metadata', text.pubkey]} pubkey={text.pubkey} let:metadata>
      <!-- Shows "jack: Japan confirmed punk" -->
      <p>{JSON.parse(metadata.content).name}: {text.content}</p>
    </Metadata>
  </Text>
</NostrApp>
```

## Features

- Zero-configuration
- Svelte stores and components to use Nostr events
- Caching requests

## Installation

```
npm install nosvelte
```

## Exapmles

You can see some example codes in [src/routes](https://github.com/akiomik/nosvelte/tree/main/src/routes).
