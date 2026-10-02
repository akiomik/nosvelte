<script lang="ts">
  import { Metadata, type SendResult, useSend } from '$lib/v1/index.js';

  interface Props {
    pubkey: string;
  }

  let { pubkey }: Props = $props();

  const send = useSend();
  let result = $state<SendResult | undefined>();

  const post = async (): Promise<void> => {
    result = await send({ kind: 1, content: 'hello from the slice' });
  };
</script>

<Metadata {pubkey}>
  {#snippet children({ event })}
    <p data-testid="name">{(JSON.parse(event.content) as { name: string }).name}</p>
  {/snippet}
  {#snippet loading()}
    <p data-testid="loading">loading</p>
  {/snippet}
  {#snippet nodata()}
    <p data-testid="nodata">nodata</p>
  {/snippet}
  {#snippet error()}
    <p data-testid="error">error</p>
  {/snippet}
</Metadata>

<button data-testid="post" onclick={post}>post</button>

{#if result?.status === 'settled'}
  <ul data-testid="outcomes">
    {#each result.relays as answer (answer.relay)}
      <li data-testid="outcome">{answer.relay} {answer.outcome}</li>
    {/each}
  </ul>
{:else if result?.status === 'refused'}
  <p data-testid="refused">{result.code}</p>
{/if}
