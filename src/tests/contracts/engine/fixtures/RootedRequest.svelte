<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The same consumer with a root of its own around the request, which the
   * component going does not end. `rooted` is handed what does.
   */
  import { type ReqHandle, type ReqPlan, useReq } from '$lib/v1/index.js';

  interface Props {
    plan: () => ReqPlan;
    seen: (request: ReqHandle) => void;
    rooted: (stop: () => void) => void;
  }

  let { plan, seen, rooted }: Props = $props();

  const asked = $derived(plan());

  // svelte-ignore state_referenced_locally
  rooted(
    $effect.root(() => {
      seen(useReq(() => asked));
    })
  );
</script>
