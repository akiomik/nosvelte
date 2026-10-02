<script lang="ts">
  import { type SendResult, useSend } from '$lib/v1/index.js';

  interface Props {
    label: string;
    /** Call the operation during initialisation too, not only from the handler. */
    atInit?: boolean;
  }

  let { label, atInit = false }: Props = $props();

  // Built during initialisation, called from a handler or right away.
  const send = useSend();
  let result = $state<SendResult | undefined>();
  const post = async (): Promise<void> => {
    result = await send({ kind: 1, content: `from ${label}` });
  };
  // svelte-ignore state_referenced_locally
  if (atInit) void post();
</script>

<button data-testid={`post-${label}`} onclick={post}>post</button>

{#if result?.status === 'settled'}
  {#each result.relays as answer (answer.relay)}
    <p data-testid={`outcome-${label}`}>{answer.relay} {answer.outcome}</p>
  {/each}
{/if}
