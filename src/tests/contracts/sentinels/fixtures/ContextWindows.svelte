<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A component that calls somebody else's function in each of the windows a
   * hook can run code in.
   *
   * It imports nothing from `svelte` on purpose. `src/tests/setup.ts` mocks that
   * specifier process-wide, so a fixture that imported `getContext` itself would
   * measure the mock — which is the whole thing the sentinel beside it exists to
   * get out from under. The real functions are handed in as props by a caller
   * that obtained them through `vi.importActual`, so what runs here is the
   * dependency and what this file contributes is only *when* it runs.
   */
  interface Props {
    /** Component initialisation: the body of the `<script>`, run by `push()`. */
    readonly atInit: () => void;
    /** Inside an `$effect`, which re-enters through `update_reaction`. */
    readonly inEffect: () => void;
    /** A DOM event handler, which is neither of the above. */
    readonly inHandler: () => void;
    /** A macrotask queued during initialisation — the shape an async queryFn has. */
    readonly laterInATask: () => void;
  }

  let { atInit, inEffect, inHandler, laterInATask }: Props = $props();

  // svelte-ignore state_referenced_locally
  atInit();
  // svelte-ignore state_referenced_locally
  setTimeout(laterInATask, 0);

  $effect(() => {
    inEffect();
  });
</script>

<button onclick={() => inHandler()}>probe</button>
