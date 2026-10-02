<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * One long-form article (kind 30023), addressed by its author and its `d`
   * tag. A single-event component, as `Metadata` is.
   */
  import { useReq } from '../req.svelte.js';
  import { article } from './descriptors.js';
  import type { ArticleProps } from './outlets.js';
  import RequestOutlets from './RequestOutlets.svelte';

  let { namespace, pubkey, identifier, children, loading, error, nodata }: ArticleProps = $props();

  const request = useReq(() => ({
    kind: 'request',
    descriptor: article(pubkey, identifier, namespace)
  }));
</script>

<RequestOutlets {request} event={children} {loading} {error} {nodata} />
