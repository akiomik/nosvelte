<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * Hands the arm the context of the provider it is mounted under, before the
   * siblings after it are created.
   */
  import { getNostrContext, type NostrContext } from '$lib/v1/context.svelte.js';

  interface Props {
    ready: (context: NostrContext) => void;
  }

  let { ready }: Props = $props();

  // svelte-ignore state_referenced_locally
  ready(getNostrContext());
</script>
