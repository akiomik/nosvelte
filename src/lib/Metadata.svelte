<!--
@license Apache-2.0
@copyright 2023 Akiomi Kamakura
-->

<script lang="ts">
  import type { Nostr } from 'rx-nostr';

  import type { RxReqBase } from './store.js';
  import { app, useMetadata } from './store.js';

  export let pubkey: string;
  export let req: RxReqBase | undefined = undefined;

  // TODO: Check if $app.client is defined
  $: result = useMetadata($app.client, pubkey, req);
  $: data = result.data;
  $: isLoading = result.isLoading;
  $: error = result.error;
  $: isSuccess = result.isSuccess;

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
