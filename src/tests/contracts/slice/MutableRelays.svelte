<script lang="ts">
  import { NostrApp, type ReqPlan } from '$lib/v1/index.js';

  import ReqProbe from './ReqProbe.svelte';

  interface Props {
    first: string;
    second: string;
    plan: () => ReqPlan;
  }

  let { first, second, plan }: Props = $props();

  // The consumer's own `$state` list, changed in place rather than replaced.
  // svelte-ignore state_referenced_locally
  const relays = $state<(string | { url: string; read: boolean; write: boolean })[]>([
    { url: first, read: false, write: true }
  ]);
</script>

<button
  data-testid="read"
  onclick={() => {
    const entry = relays[0];
    if (typeof entry === 'object') entry.read = true;
  }}>read</button
>
<button data-testid="push" onclick={() => relays.push(second)}>push</button>

<NostrApp {relays}>
  <ReqProbe {plan} />
</NostrApp>
