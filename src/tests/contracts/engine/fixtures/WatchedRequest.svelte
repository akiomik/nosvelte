<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A consumer's own request, handed back to the test, and read by an effect
   * every time it publishes — so a test can take what the handle said as of
   * the Svelte flush in which it said it, rather than what it says by the time
   * the test looks. Two writes inside one flush read as one. The effect tracks
   * whatever `published` reads.
   */
  import { type ReqHandle, type ReqPlan, useReq } from '$lib/v1/index.js';

  interface Props {
    plan: () => ReqPlan;
    seen: (request: ReqHandle) => void;
    published: (request: ReqHandle) => void;
  }

  let { plan, seen, published }: Props = $props();

  // svelte-ignore state_referenced_locally
  const request = useReq(plan);
  // svelte-ignore state_referenced_locally
  seen(request);

  $effect(() => {
    published(request);
  });
</script>
