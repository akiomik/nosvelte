<script lang="ts">
  import type { QueryKey } from '@tanstack/svelte-query';

  import { Event } from '$lib/components/index.js';
  import type { RxReqBase } from '$lib/stores/index.js';

  export let queryKey: QueryKey;
  export let id: string;
  export let req: RxReqBase | undefined = undefined;
</script>

<Event {queryKey} {id} {req}>
  <svelte:fragment let:event let:status>
    <div data-testid="default">{JSON.stringify({ event, status })}</div>
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
</Event>
