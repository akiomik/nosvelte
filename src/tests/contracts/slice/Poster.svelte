<script lang="ts">
  import { type SendResult, useSend } from '$lib/v1/index.js';

  interface Props {
    label: string;
  }

  let { label }: Props = $props();

  // Built during initialisation, called later from a handler.
  const send = useSend();
  let result = $state<SendResult | undefined>();
</script>

<button
  data-testid={`post-${label}`}
  onclick={async () => {
    result = await send({ kind: 1, content: `from ${label}` });
  }}>post</button
>

{#if result?.status === 'settled'}
  {#each result.relays as answer (answer.relay)}
    <p data-testid={`outcome-${label}`}>{answer.relay} {answer.outcome}</p>
  {/each}
{/if}
