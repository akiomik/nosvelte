<script lang="ts">
  import type { EventPacket } from 'rx-nostr';
  import { app, useMetadata, type RxReqBase } from './store';

  export let pubkey: string;
  export let req: RxReqBase | undefined = undefined;

  const { data, isLoading, isSuccess, error } = useMetadata($app.client, pubkey, req);

  interface $$Slots {
    default: { data: EventPacket; loading: boolean; success: boolean };
    loading: {};
    error: { error: Error };
  }
</script>

{#if $isLoading && !$data}
  <slot name="loading" />
{:else if $error}
  <slot name="error" error={$error} />
{:else}
  <slot data={$data} loading={$isLoading} success={$isSuccess} />
{/if}
