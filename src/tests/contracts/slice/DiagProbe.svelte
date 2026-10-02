<script lang="ts">
  import { useRelayDiagnostics } from '$lib/v1/index.js';

  const diagnostics = useRelayDiagnostics();
  // Every refusal this provider published, by identity; a record, not state.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const seen = new Set<unknown>();
  let refusals = $state(0);
  $effect(() => {
    const refusal = diagnostics.configurationError;
    if (refusal !== undefined) seen.add(refusal);
    refusals = seen.size;
  });
</script>

<p data-testid="code">{diagnostics.configurationError?.code ?? 'none'}</p>
<p data-testid="refusals">{refusals}</p>
<p data-testid="scope">{Object.keys(diagnostics.relays).join(',')}</p>
