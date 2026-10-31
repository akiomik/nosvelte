<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The same consumer with a root of its own around the request, which the
   * component going does not end. `rooted` is handed what does. Given `direct`,
   * the plan is read as it is rather than through the component's `$derived`,
   * and given `watched`, an `$effect` in the root reads `activity`.
   */
  import { type ReqHandle, type ReqPlan, useReq } from '$lib/v1/index.js';

  interface Props {
    plan: () => ReqPlan;
    seen: (request: ReqHandle) => void;
    rooted: (stop: () => void) => void;
    direct?: boolean;
    watched?: boolean;
  }

  let { plan, seen, rooted, direct = false, watched = false }: Props = $props();

  const asked = $derived(plan());

  // svelte-ignore state_referenced_locally
  const read = direct ? plan : () => asked;
  // svelte-ignore state_referenced_locally
  const watching = watched;

  // svelte-ignore state_referenced_locally
  rooted(
    $effect.root(() => {
      const request = useReq(read);
      seen(request);
      if (watching) {
        $effect(() => {
          void request.activity;
        });
      }
    })
  );
</script>
