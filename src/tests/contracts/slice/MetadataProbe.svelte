<script lang="ts">
  import { Metadata, NostrApp } from '$lib/v1/index.js';

  interface Props {
    relays: readonly string[];
    pubkey: string;
  }

  let { relays, pubkey }: Props = $props();
</script>

<NostrApp {relays}>
  <Metadata {pubkey}>
    {#snippet children({ event, request })}
      <p data-testid="name">{(JSON.parse(event.content) as { name: string }).name}</p>
      <p data-testid="default-request">{request.state.status}</p>
    {/snippet}
    {#snippet loading({ request })}
      <p data-testid="loading">{request.activity}</p>
    {/snippet}
    {#snippet nodata({ request })}
      <p data-testid="nodata">
        {request.state.status === 'settled'
          ? `matched:${String(request.state.hasMatchEvidence)}`
          : '-'}
      </p>
    {/snippet}
    {#snippet error({ request, error })}
      <p data-testid="error">
        {`${error === (request.state.status === 'error' ? request.state.error : undefined) ? 'same' : 'copy'} ${error.code}`}
      </p>
    {/snippet}
  </Metadata>
</NostrApp>
