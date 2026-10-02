<script lang="ts">
  import { NostrApp, type ReqPlan } from '$lib/v1/index.js';

  import ReqProbe from './ReqProbe.svelte';

  interface Props {
    relays: readonly string[];
    plan: () => ReqPlan;
  }

  let { relays, plan }: Props = $props();
</script>

<NostrApp {relays}>
  <ReqProbe {plan} />
</NostrApp>
