<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * Under a provider with a verifier of the test's own: a consumer's request,
   * and the provider's context, each handed back to the test.
   */
  import type Nostr from 'nostr-typedef';

  import type { NostrContext } from '$lib/v1/context.svelte.js';
  import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
  import type { RelayInput } from '$lib/v1/scope.svelte.js';

  import Asker from '../../descriptor/Asker.svelte';
  import VerifyingProvider from './VerifyingProvider.svelte';

  interface Props {
    relays: readonly RelayInput[];
    verifyEvent: (event: Nostr.Event) => Promise<boolean>;
    plan: () => ReqPlan;
    request: (handle: ReqHandle) => void;
    seen: (context: NostrContext) => void;
  }

  let { relays, verifyEvent, plan, request, seen }: Props = $props();
</script>

<VerifyingProvider {relays} {verifyEvent} {seen}>
  <Asker {plan} seen={request} />
</VerifyingProvider>
