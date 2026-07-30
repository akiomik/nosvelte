<script lang="ts">
  import type { QueryKey } from '@tanstack/svelte-query';

  import { EventList } from '$lib/components/index.js';
  import type { RxReqBase } from '$lib/stores/index.js';

  export let queryKey: QueryKey;
  export let ids: string[];
  export let req: RxReqBase | undefined = undefined;
</script>

<EventList {queryKey} {ids} {req}>
  <svelte:fragment let:events let:status>
    <div data-testid="default">{JSON.stringify({ events, status })}</div>
  </svelte:fragment>
  <svelte:fragment slot="loading">
    <div data-testid="loading">loading</div>
  </svelte:fragment>
  <svelte:fragment slot="error" let:error>
    <div data-testid="error">{error.message}</div>
  </svelte:fragment>
  <svelte:fragment slot="nodata">
    <div data-testid="nodata">nodata</div>
  </svelte:fragment>
</EventList>
