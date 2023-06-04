<script lang="ts">
  import { app, useMetadata } from './store';

  export let pubkey: string;
  export let req: RxReqBase | undefined = undefined;

  const { data, isLoading, isSuccess, error } = useMetadata($app.client, pubkey, req)

  interface $$Slots {
    default: { data: EventPacket  },
    loading: {},
    error: { error: Error },
  }
</script>

{#if isLoading && !metadata}
  <slot name="loading" />
{:else if error}
  <slot name="error" error={$error} />
{:else}
  <slot data={$data} loading={$isLoading} success={$isSuccess} />
{/if}
