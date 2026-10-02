<script lang="ts">
  import { type RefreshOutcome, type ReqPlan, useReq } from '$lib/v1/index.js';

  interface Props {
    plan: () => ReqPlan;
  }

  let { plan }: Props = $props();

  // svelte-ignore state_referenced_locally
  const request = useReq(plan);
  let outcome = $state<RefreshOutcome | undefined>();
  const refusal = $derived(
    request.state.status === 'error'
      ? `${request.state.error.code}:${'field' in request.state.error ? String(request.state.error.field) : ''}`
      : ''
  );
</script>

<p data-testid="status">{request.state.status}</p>
<p data-testid="count">{request.state.status === 'loading' ? 0 : request.state.events.length}</p>
<p data-testid="refusal">{refusal}</p>
<p data-testid="members">{Object.keys(request).sort().join(',')}</p>
<button
  data-testid="refresh"
  onclick={async () => {
    outcome = await request.refresh();
  }}>refresh</button
>
{#if outcome !== undefined}
  <p data-testid="outcome">{outcome.kind}:{'reason' in outcome ? outcome.reason : ''}</p>
{/if}
