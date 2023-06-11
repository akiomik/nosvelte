<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import type { Nostr } from 'rx-nostr';

  import type { ReqStatus, RxReqBase } from '$lib/stores/index.js';
  import { app, useUserReactionList } from '$lib/stores/index.js';

  export let pubkey: string;
  export let req: RxReqBase | undefined = undefined;
  export let limit = 100;

  // TODO: Check if $app.rxNostr is defined
  $: result = useUserReactionList($app.rxNostr, pubkey, limit, req);
  $: data = result.data;
  $: status = result.status;
  $: error = result.error;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface $$Slots {
    default: { reactions: Nostr.Event[]; status: ReqStatus };
    loading: Record<never, never>;
    error: { error: Error };
    nodata: Record<never, never>;
  }
</script>

{#if $error}
  <slot name="error" error={$error} />
{:else if $data?.length > 0}
  <slot reactions={$data?.map(({ event }) => event)} status={$status} />
{:else if $status === 'loading'}
  <slot name="loading" />
{:else}
  <slot name="nodata" />
{/if}
