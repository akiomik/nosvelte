<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * `NostrApp` reduced to the one thing C16 is about: a **reactive `relays`
   * prop**.
   *
   * `createNostrContext` is called in initialisation, where a refusal throws
   * and an error boundary above can receive it; the prop is applied in an
   * `$effect`, which is where the decision that a later refusal must *not*
   * throw comes from. Both halves are here rather than in an effect root
   * because an effect root is not a component: it has no boundary above it, so
   * the thing 0004 C16 chose between is invisible from one.
   */
  import type { Snippet } from 'svelte';

  import type { NostrContext } from '$lib/v1/context.svelte.js';
  import { createNostrContext, setNostrContext } from '$lib/v1/context.svelte.js';
  import type { RelayInput, TransportKeys } from '$lib/v1/scope.svelte.js';
  import type { NostrSigner } from '$lib/v1/send.svelte.js';

  import { HARNESS_DIVERGENCES } from '../helpers/relay.js';

  interface Props {
    readonly relays?: readonly RelayInput[] | undefined;
    readonly transportKeys?: TransportKeys | undefined;
    readonly signer?: NostrSigner | undefined;
    /** Hands the context out so a test can hold the objects C16 says survive. */
    readonly onready?: ((context: NostrContext) => void) | undefined;
    /**
     * **C16's alternative, buildable so that it can be measured.**
     *
     * The design that was rejected: let the refusal out of the effect. Nothing
     * in the library does this — the flag is read here and nowhere else — and
     * `CF6` is what it exists for.
     */
    readonly rethrow?: boolean | undefined;
    readonly children?: Snippet | undefined;
  }

  let { relays = [], transportKeys, signer, onready, rethrow = false, children }: Props = $props();

  // Read once, on purpose: the context is created here and never again, so
  // these are values rather than cells. The prop's later movement is the
  // `$effect` below, which is the whole subject of C16.
  // svelte-ignore state_referenced_locally
  const context = createNostrContext({
    relays,
    harness: HARNESS_DIVERGENCES,
    // Spread rather than written as a field: `exactOptionalPropertyTypes` is on,
    // so an absent seam has to be an absent property rather than an `undefined`
    // one — and the option's type saying "a transport or nothing" instead is
    // exactly the widening that would let a provider be built with no seam by
    // accident.
    ...(transportKeys === undefined ? {} : { transportKeys }),
    ...(signer === undefined ? {} : { signer })
  });
  setNostrContext(context);
  // svelte-ignore state_referenced_locally
  onready?.(context);

  $effect(() => {
    // Unconditionally, including the first run, which is what a prop-driven
    // provider does: the list is the one the context was built with, so the
    // scope finds it equal and returns without moving anything.
    context.setRelays(relays);
    if (rethrow && context.configurationError !== undefined) throw context.configurationError;
  });
</script>

{@render children?.()}
