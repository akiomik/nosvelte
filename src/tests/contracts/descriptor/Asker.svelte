<script lang="ts">
  /** A consumer's own request, handed back to the test as the handle it holds. */
  import { type ReqHandle, type ReqPlan, useReq } from '$lib/v1/index.js';

  interface Props {
    plan: () => ReqPlan;
    seen: (request: ReqHandle) => void;
  }

  let { plan, seen }: Props = $props();

  // svelte-ignore state_referenced_locally
  seen(useReq(plan));
</script>
