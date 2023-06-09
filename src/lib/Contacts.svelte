<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import type { Nostr } from 'rx-nostr';

  import type { RxReqBase } from './stores/index.js';
  import { app, useContacts } from './stores/index.js';

  export let pubkey: string;
  export let req: RxReqBase | undefined = undefined;

  // TODO: Check if $app.client is defined
  $: result = useContacts($app.client, pubkey, req);
  $: data = result.data;
  $: isLoading = result.isLoading;
  $: error = result.error;
  $: isSuccess = result.isSuccess;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface $$Slots {
    default: { contacts: Nostr.Event; loading: boolean; success: boolean };
    loading: Record<never, never>;
    error: { error: Error };
    nodata: Record<never, never>;
  }
</script>

{#if $isLoading && $data === undefined}
  <slot name="loading" />
{:else if $isSuccess && $data === undefined}
  <slot name="nodata" />
{:else if $error}
  <slot name="error" error={$error} />
{:else}
  <slot contacts={$data?.event} loading={$isLoading} success={$isSuccess} />
{/if}
