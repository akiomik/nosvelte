<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * Hands the arm every context this point sees, which is what a consumer needs
   * to build a request under a provider after that provider has gone.
   */
  import { getAllContexts } from 'svelte';

  interface Props {
    read: (contexts: Map<unknown, unknown>) => void;
  }

  let { read }: Props = $props();

  // svelte-ignore state_referenced_locally
  read(getAllContexts());
</script>
