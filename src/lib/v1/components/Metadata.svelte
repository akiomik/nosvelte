<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The newest kind-0 event of one author (0004 C7's `Metadata` row: one
   * filter `{ kinds: [0], authors: [pubkey], limit: 1 }`, everything else at
   * its default). A single-event component: when the answer holds events it
   * can show none of — every one hidden past its deadline — it renders
   * `nodata` rather than `default`, with the request still reporting the match
   * (ruling 18).
   */
  import { deriveOutlet } from '../engine.js';
  import { useReq } from '../req.svelte.js';
  import type { MetadataProps } from './outlets.js';

  let { namespace, pubkey, children, loading, error, nodata }: MetadataProps = $props();

  const request = useReq(() => ({
    kind: 'request',
    descriptor: {
      filters: [{ kinds: [0], authors: [pubkey], limit: 1 }],
      ...(namespace === undefined ? {} : { namespace })
    }
  }));
  const outlet = $derived(deriveOutlet(request.state));
  const event = $derived(request.state.status === 'loading' ? undefined : request.state.events[0]);
</script>

{#if outlet.slot === 'loading'}
  {@render loading?.({ request })}
{:else if outlet.slot === 'error'}
  {@render error?.({ request, error: outlet.error })}
{:else if outlet.slot === 'nodata' || event === undefined}
  {@render nodata?.({ request })}
{:else}
  {@render children({ event, request })}
{/if}
