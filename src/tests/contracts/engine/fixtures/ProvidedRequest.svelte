<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A provider built through `createNostrContext`, handing its context back to
   * the test, with one consumer's request under it (`WatchedRequest`) — so a
   * test can reach the transport the provider holds while a request it began
   * is running.
   */
  import {
    createNostrContext,
    type NostrContext,
    setNostrContext
  } from '$lib/v1/context.svelte.js';
  import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
  import type { RelayInput } from '$lib/v1/scope.svelte.js';

  import { HARNESS_DIVERGENCES } from '../helpers/relay.js';
  import WatchedRequest from './WatchedRequest.svelte';

  interface Props {
    relays: readonly RelayInput[];
    plan: () => ReqPlan;
    ready: (context: NostrContext) => void;
    seen: (request: ReqHandle) => void;
  }

  let { relays, plan, ready, seen }: Props = $props();

  // svelte-ignore state_referenced_locally
  const context = createNostrContext({ relays, harness: HARNESS_DIVERGENCES });
  setNostrContext(context);
  // svelte-ignore state_referenced_locally
  ready(context);
</script>

<WatchedRequest {plan} {seen} published={() => {}} />
