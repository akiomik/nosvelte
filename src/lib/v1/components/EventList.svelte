<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * Those events by id and nothing more (0004's descriptor table:
   * `{ ids, limit: ids.length }`, `EventList` and `UniqueEventList` sharing the
   * row — `UniqueEventList` is ids-only now). `ids` is read once per plan, by
   * `byIds`, so the filter's ids and its `limit` count one list (`B4-C9`).
   */
  import { useReq } from '../req.svelte.js';
  import { byIds } from './descriptors.js';
  import type { EventListProps } from './outlets.js';
  import RequestOutlets from './RequestOutlets.svelte';

  let { namespace, ids, children, loading, error, nodata }: EventListProps = $props();

  const request = useReq(() => ({ kind: 'request', descriptor: byIds(() => ids, namespace) }));
</script>

<RequestOutlets {request} events={children} {loading} {error} {nodata} />
