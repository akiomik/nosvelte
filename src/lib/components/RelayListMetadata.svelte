<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   */

  import type { QueryKey } from '@tanstack/svelte-query';
  import type { Nostr } from 'rx-nostr';

  import type { ReqStatus, RxReqBase } from '$lib/stores/index.js';
  import { app, useRelayListMetadata } from '$lib/stores/index.js';

  export let queryKey: QueryKey;
  export let pubkey: string;
  export let req: RxReqBase | undefined = undefined;

  // TODO: Check if $app.rxNostr is defined
  $: result = useRelayListMetadata($app.rxNostr, queryKey, pubkey, req);
  $: data = result.data;
  $: status = result.status;
  $: error = result.error;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface $$Slots {
    default: { relayListMetadata: Nostr.Event; status: ReqStatus };
    loading: Record<never, never>;
    error: { error: Error };
    nodata: Record<never, never>;
  }
</script>

{#if $error}
  <slot name="error" error={$error} />
{:else if $data}
  <slot relayListMetadata={$data?.event} status={$status} />
{:else if $status === 'loading'}
  <slot name="loading" />
{:else}
  <slot name="nodata" />
{/if}
