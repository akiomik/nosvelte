<script lang="ts">
  import type { QueryKey } from '@tanstack/svelte-query';

  import { Metadata } from '$lib/components/index.js';
  import type { RxReqBase } from '$lib/stores/index.js';

  export let queryKey: QueryKey;
  export let pubkey: string;
  export let req: RxReqBase | undefined = undefined;
</script>

<Metadata {queryKey} {pubkey} {req}>
  <svelte:fragment let:metadata let:status>
    <div data-testid="default">{JSON.stringify({ metadata, status })}</div>
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
</Metadata>
