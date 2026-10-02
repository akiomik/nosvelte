<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * One author's reactions (kind 7). `limit` defaults to 100 and is read once
   * per plan, by `reactions`, so the filter's bound and the retention are one
   * value (`C7-C6`). A value that is not a safe integer of at least 1 is
   * refused by the descriptor boundary before anything is sent, under the
   * first field that checks it: `0` passes as a filter bound and is refused as
   * the retention, and every other one is refused as the filter's `limit`.
   */
  import { useReq } from '../req.svelte.js';
  import { reactions } from './descriptors.js';
  import type { UserReactionListProps } from './outlets.js';
  import RequestOutlets from './RequestOutlets.svelte';

  let { namespace, pubkey, limit, children, loading, error, nodata }: UserReactionListProps =
    $props();

  const request = useReq(() => ({
    kind: 'request',
    descriptor: reactions(pubkey, () => limit, namespace)
  }));
</script>

<RequestOutlets {request} events={children} {loading} {error} {nodata} />
