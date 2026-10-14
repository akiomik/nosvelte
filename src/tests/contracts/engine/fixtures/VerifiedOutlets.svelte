<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * Under a provider with a verifier of the test's own: a consumer's request,
   * rendered through the request components' outlets, with the handle and every
   * outlet's argument handed back to the test.
   */
  import type Nostr from 'nostr-typedef';

  import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
  import type { RelayInput } from '$lib/v1/scope.svelte.js';

  import AskedOutlets from './AskedOutlets.svelte';
  import VerifyingProvider from './VerifyingProvider.svelte';

  interface Props {
    relays: readonly RelayInput[];
    verifyEvent: (event: Nostr.Event) => Promise<boolean>;
    plan: () => ReqPlan;
    request: (handle: ReqHandle) => void;
    held: (outlet: string, argument: unknown) => void;
  }

  let { relays, verifyEvent, plan, request, held }: Props = $props();
</script>

<VerifyingProvider {relays} {verifyEvent}>
  <AskedOutlets {plan} seen={request} {held} />
</VerifyingProvider>
