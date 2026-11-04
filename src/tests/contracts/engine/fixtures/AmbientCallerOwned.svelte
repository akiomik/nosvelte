<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A request on the engine's standalone seam under a consumer's own query
   * provider: the dependency's `QueryClientProvider` around
   * `CallerOwnedRequest`, so the ambient context holds `consumer`.
   */
  import { type QueryClient, QueryClientProvider } from 'tanstack-svelte-query-v6';

  import type { useStreamedReq, UseStreamedReqOpts } from '$lib/v1/useStreamedReq.svelte.js';

  import CallerOwnedRequest from './CallerOwnedRequest.svelte';

  interface Props {
    consumer: QueryClient;
    options: () => UseStreamedReqOpts;
    seen: (request: ReturnType<typeof useStreamedReq>) => void;
  }

  let { consumer, options, seen }: Props = $props();
</script>

<QueryClientProvider client={consumer}>
  <CallerOwnedRequest {options} {seen} />
</QueryClientProvider>
