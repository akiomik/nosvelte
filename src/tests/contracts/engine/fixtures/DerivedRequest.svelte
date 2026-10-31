<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The consumer every component is: a request whose plan reads a `$derived` of
   * the component, handed out so that it can be kept past the component.
   */
  import { type ReqHandle, type ReqPlan, useReq } from '$lib/v1/index.js';

  interface Props {
    plan: () => ReqPlan;
    seen: (request: ReqHandle) => void;
  }

  let { plan, seen }: Props = $props();

  const asked = $derived(plan());

  // svelte-ignore state_referenced_locally
  seen(useReq(() => asked));
</script>
