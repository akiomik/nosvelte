<script lang="ts">
  import type { Nostr } from 'rx-nostr';
  import { app, useMetadata, emptyResult, type RxReqBase } from './store.js';
  import { readable } from 'svelte/store';

  export let pubkey: string;
  export let req: RxReqBase | undefined = undefined;

  // TODO: Improve empty relay handling
  $: available = $app.client && $app.client.getRelays().length > 0;
  $: result = available ? useMetadata($app.client, pubkey, req) : emptyResult;
  $: data = available ? result.data : readable();
  $: isLoading = available ? result.isLoading : readable(false);
  $: error = available ? result.error : readable();
  $: isSuccess = available ? result.isSuccess : readable(true);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface $$Slots {
    default: { metadata: Nostr.Event; loading: boolean; success: boolean };
    loading: Record<never, never>;
    error: { error: Error };
  }
</script>

{#if $isLoading && $data === undefined}
  <slot name="loading" />
{:else if $error}
  <slot name="error" error={$error} />
{:else}
  <slot metadata={$data?.event} loading={$isLoading} success={$isSuccess} />
{/if}
