<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A provider built through `createNostrContext` with the harness the test
   * names, or with none, as the published `NostrApp` builds it, handing its
   * context back to the test, and one consumer's request under it
   * (`WatchedRequest`) — so a test can read which client a request the
   * provider runs is run on.
   */
  import {
    createNostrContext,
    type HarnessOverrides,
    type NostrContext,
    setNostrContext
  } from '$lib/v1/context.svelte.js';
  import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';

  import WatchedRequest from './WatchedRequest.svelte';

  interface Props {
    relays: readonly string[];
    harness: HarnessOverrides | undefined;
    plan: () => ReqPlan;
    ready: (context: NostrContext) => void;
    seen: (request: ReqHandle) => void;
  }

  let { relays, harness, plan, ready, seen }: Props = $props();

  // svelte-ignore state_referenced_locally
  const context = createNostrContext(harness === undefined ? { relays } : { relays, harness });
  setNostrContext(context);
  // svelte-ignore state_referenced_locally
  ready(context);
</script>

<WatchedRequest {plan} {seen} published={() => {}} />
