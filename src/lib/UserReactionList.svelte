<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import type { Nostr } from 'rx-nostr';

  import type { RxReqBase } from './store.js';
  import { app, useUserReactionList } from './store.js';

  export let pubkey: string;
  export let req: RxReqBase | undefined = undefined;
  export let limit = 100;

  // TODO: Check if $app.client is defined
  $: result = useUserReactionList($app.client, pubkey, limit, req);
  $: data = result.data;
  $: isLoading = result.isLoading;
  $: error = result.error;
  $: isSuccess = result.isSuccess;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface $$Slots {
    default: { reactions: Nostr.Event[]; loading: boolean; success: boolean };
    loading: Record<never, never>;
    error: { error: Error };
  }
</script>

{#if $isLoading && $data === undefined}
  <slot name="loading" />
{:else if $error}
  <slot name="error" error={$error} />
{:else}
  <slot reactions={$data?.map(({ event }) => event)} loading={$isLoading} success={$isSuccess} />
{/if}
