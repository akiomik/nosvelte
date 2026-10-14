<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A consumer's own request, rendered through the outlets every request
   * component renders through, with the handle handed back to the test.
   *
   * **`RequestOutlets` over the consumer's handle rather than a published
   * component**, because every published component makes a non-live request
   * (0004's component descriptor table, `descriptors.ts`), and a row about a
   * live request's forward leg has no published component to render it. What
   * is rendered is the branch each of them renders through.
   */
  import { type ReqHandle, type ReqPlan, useReq } from '$lib/v1/index.js';

  import Outlets from './Outlets.svelte';

  interface Props {
    plan: () => ReqPlan;
    seen: (request: ReqHandle) => void;
    held: (outlet: string, argument: unknown) => void;
  }

  let { plan, seen, held }: Props = $props();

  // svelte-ignore state_referenced_locally
  const request = useReq(plan);
  // svelte-ignore state_referenced_locally
  seen(request);
</script>

<Outlets {request} single={false} {held} />
