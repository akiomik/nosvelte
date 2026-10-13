<script lang="ts" module>
  import type { ReqHandle, Send } from '$lib/v1/index.js';

  /** What a consumer holds: the request's handle and the send operation. */
  export interface Held {
    readonly request: ReqHandle;
    readonly send: Send;
  }
</script>

<script lang="ts">
  import { type ReqPlan, useReq, useSend } from '$lib/v1/index.js';

  interface Props {
    plan: () => ReqPlan;
    expose: (held: Held) => void;
  }

  let { plan, expose }: Props = $props();

  // svelte-ignore state_referenced_locally
  expose({ request: useReq(plan), send: useSend() });
</script>
