<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The published entry under a consumer's own query provider, which is the
   * arrangement a consumer writes: the dependency's `QueryClientProvider`
   * around `NostrApp` with `relays` only, and one request under it. Without
   * `consumer`, the same tree with no query provider above it. `ready` hands
   * over the provider's context before the request exists; `walked` reports
   * what a descendant that imports no key reaches through the framework's
   * context (`ContextWalker`).
   */
  import { type QueryClient, QueryClientProvider } from 'tanstack-svelte-query-v6';

  import type { NostrContext } from '$lib/v1/context.svelte.js';
  import { NostrApp, type ReqHandle, type ReqPlan } from '$lib/v1/index.js';

  import ContextWalker, { type Walked } from './ContextWalker.svelte';
  import ProviderReader from './ProviderReader.svelte';
  import WatchedRequest from './WatchedRequest.svelte';

  interface Props {
    consumer?: QueryClient | undefined;
    relays: readonly string[];
    plan: () => ReqPlan;
    seen: (request: ReqHandle) => void;
    ready: (context: NostrContext) => void;
    walked?: ((report: Walked) => void) | undefined;
  }

  let { consumer, relays, plan, seen, ready, walked }: Props = $props();
</script>

{#snippet provided()}
  <NostrApp {relays}>
    <ProviderReader {ready} />
    {#if walked !== undefined}
      <ContextWalker {walked} />
    {/if}
    <WatchedRequest {plan} {seen} published={() => {}} />
  </NostrApp>
{/snippet}

{#if consumer === undefined}
  {@render provided()}
{:else}
  <QueryClientProvider client={consumer}>
    {@render provided()}
  </QueryClientProvider>
{/if}
