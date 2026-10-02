<script lang="ts">
  import { NostrApp } from '$lib/v1/index.js';

  import DiagProbe from './DiagProbe.svelte';

  interface Props {
    relays: readonly string[];
  }

  let { relays }: Props = $props();
</script>

<NostrApp {relays}>
  <DiagProbe />
</NostrApp>
