<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The newest kind-10000 event of one author — their mute list — one row of
   * 0004's component descriptor table, built by `latestOf` in `descriptors.ts`.
   * A single-event component: a settled answer whose events are all past
   * their deadline renders `nodata`, with the request still reporting the
   * match (ruling 18). An incomplete one renders `error`, as every incomplete
   * answer does.
   */
  import { useReq } from '../req.svelte.js';
  import { latestOf } from './descriptors.js';
  import type { MuteProps } from './outlets.js';
  import RequestOutlets from './RequestOutlets.svelte';

  let { namespace, pubkey, children, loading, error, nodata }: MuteProps = $props();

  const request = useReq(() => ({
    kind: 'request',
    descriptor: latestOf(10000, pubkey, namespace)
  }));
</script>

<RequestOutlets {request} event={children} {loading} {error} {nodata} />
