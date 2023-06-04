<script lang="ts">
  import type { Nostr } from 'rx-nostr';
  import { app, useMetadata, type RxReqBase } from './store';

  export let pubkey: string;
  export let req: RxReqBase | undefined = undefined;

  const { data, isLoading, isSuccess, error } = useMetadata($app.client, pubkey, req);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface $$Slots {
    default: { metadata: Nostr.Event; loading: boolean; success: boolean };
    loading: Record<never, never>;
    error: { error: Error };
  }
</script>

{#if $isLoading && !$data}
  <slot name="loading" />
{:else if $error}
  <slot name="error" error={$error} />
{:else}
  <slot metadata={$data.event} loading={$isLoading} success={$isSuccess} />
{/if}
