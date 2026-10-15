<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The published entry and nothing else: `NostrApp` with `relays` only, so
   * the verifier is the one the library supplies, and one request under it,
   * watched as it publishes (`WatchedRequest`).
   */
  import { NostrApp, type ReqHandle, type ReqPlan } from '$lib/v1/index.js';

  import WatchedRequest from './WatchedRequest.svelte';

  interface Props {
    relays: readonly string[];
    plan: () => ReqPlan;
    seen: (request: ReqHandle) => void;
    published: (request: ReqHandle) => void;
  }

  let { relays, plan, seen, published }: Props = $props();
</script>

<NostrApp {relays}>
  <WatchedRequest {plan} {seen} {published} />
</NostrApp>
