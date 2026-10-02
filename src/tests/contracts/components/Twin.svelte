<script lang="ts">
  /**
   * A request component and a consumer's own `useReq` side by side under one
   * provider, so the test can read the cache entries they make between them.
   */
  import { NostrApp, type ReqDescriptor } from '$lib/v1/index.js';

  import Keys from './Keys.svelte';
  import Own from './Own.svelte';
  import type { RequestComponent } from './types.js';

  interface Props {
    relays: readonly string[];
    which: RequestComponent;
    given: Record<string, unknown>;
    descriptor: ReqDescriptor;
    expose: (keys: () => string[]) => void;
  }

  let { relays, which: Request, given, descriptor, expose }: Props = $props();
</script>

<NostrApp {relays}>
  <Keys {expose} />
  <Request {...given}><span hidden></span></Request>
  <Own {descriptor} />
</NostrApp>
