<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * One event by id (0004's descriptor table: `{ ids: [id], limit: 1 }`,
   * `Event` and `Text` sharing the row). A single-event component, as
   * `Metadata` is.
   */
  import { useReq } from '../req.svelte.js';
  import { byId } from './descriptors.js';
  import type { TextProps } from './outlets.js';
  import RequestOutlets from './RequestOutlets.svelte';

  let { namespace, id, children, loading, error, nodata }: TextProps = $props();

  const request = useReq(() => ({ kind: 'request', descriptor: byId(id, namespace) }));
</script>

<RequestOutlets {request} event={children} {loading} {error} {nodata} />
