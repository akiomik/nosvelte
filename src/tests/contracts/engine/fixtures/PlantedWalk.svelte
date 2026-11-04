<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * `ContextWalker` under one value of the arm's own, put in the framework's
   * context above it with no library in the tree: the walk's control.
   */
  import { setContext } from 'svelte';

  import ContextWalker, { type Walked } from './ContextWalker.svelte';

  interface Props {
    planted: unknown;
    walked: (report: Walked) => void;
  }

  let { planted, walked }: Props = $props();

  // svelte-ignore state_referenced_locally
  setContext(Symbol('planted'), planted);
</script>

<ContextWalker {walked} />
