<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A provider built through `createNostrContext` with a verifier of the test's
   * own, handing its context back, with the children under it.
   *
   * **Through the provider, not around it.** `createNostrContext` takes a
   * `verifyEvent` and every request under it is checked by that one, as it is
   * by the library's own under `NostrApp`. So a test that has to see what the
   * verifier was handed reaches the hook and the cache the way a consumer's
   * request does, with no owner input brought by the request itself.
   */
  import type Nostr from 'nostr-typedef';
  import type { Snippet } from 'svelte';

  import {
    createNostrContext,
    type NostrContext,
    setNostrContext
  } from '$lib/v1/context.svelte.js';
  import type { RelayInput } from '$lib/v1/scope.svelte.js';

  import { HARNESS_DIVERGENCES } from '../helpers/relay.js';

  interface Props {
    relays: readonly RelayInput[];
    verifyEvent: (event: Nostr.Event) => Promise<boolean>;
    seen?: (context: NostrContext) => void;
    children?: Snippet;
  }

  let { relays, verifyEvent, seen = () => {}, children }: Props = $props();

  // svelte-ignore state_referenced_locally
  const context = createNostrContext({ relays, verifyEvent, harness: HARNESS_DIVERGENCES });
  setNostrContext(context);
  // svelte-ignore state_referenced_locally
  seen(context);
</script>

{@render children?.()}
