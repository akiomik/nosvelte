<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A request on the engine's standalone seam (`0002` A16), built inside a
   * component so that the framework's context above it is the one it would
   * read: the engine with the owner inputs `options` brings.
   */
  import { useStreamedReq, type UseStreamedReqOpts } from '$lib/v1/useStreamedReq.svelte.js';

  interface Props {
    options: () => UseStreamedReqOpts;
    seen: (request: ReturnType<typeof useStreamedReq>) => void;
  }

  let { options, seen }: Props = $props();

  // svelte-ignore state_referenced_locally
  seen(useStreamedReq(options));
</script>
