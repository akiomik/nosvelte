<script lang="ts">
  /**
   * Reads the provider's cache keys for the test: the request entries only,
   * not the deferred one or a refusal's.
   */
  import { getNostrContext } from '$lib/v1/context.svelte.js';

  interface Props {
    expose: (keys: () => string[]) => void;
  }

  let { expose }: Props = $props();

  const { client } = getNostrContext();
  // svelte-ignore state_referenced_locally
  expose(() =>
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
      .filter((key) => key[0] === 'nosvelte' && key.length === 2 && key[1] !== 'deferred')
      .map((key) => String(key[1]))
      .sort()
  );
</script>
