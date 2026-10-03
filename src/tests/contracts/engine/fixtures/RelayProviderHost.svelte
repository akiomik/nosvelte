<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The arrangement C16 decides for: a provider under an error boundary, with a
   * descendant that reads the diagnostics hook.
   *
   * `boundary` is a prop so the same tree can be rendered without one. That is
   * not decoration — the boundary is what destroys the subtree, so a consumer
   * who has not written one behaves differently, and 0004 C16's "throw so a
   * boundary can receive it" is a claim about the arrangement rather than about
   * the throw.
   */
  import type { NostrContext } from '$lib/v1/context.svelte.js';
  import type { RelayInput, TransportKeys } from '$lib/v1/scope.svelte.js';
  import type { NostrSigner } from '$lib/v1/send.svelte.js';

  import DiagnosticsReader from './DiagnosticsReader.svelte';
  import RelayProvider from './RelayProvider.svelte';
  import ThrowsWhenTold from './ThrowsWhenTold.svelte';

  interface Props {
    readonly relays?: readonly RelayInput[] | undefined;
    readonly transportKeys?: TransportKeys | undefined;
    readonly signer?: NostrSigner | undefined;
    readonly boundary?: boolean | undefined;
    readonly rethrow?: boolean | undefined;
    readonly onerror?: ((error: unknown) => void) | undefined;
    readonly onready?: ((context: NostrContext) => void) | undefined;
    readonly onlifetime?: ((event: 'mounted' | 'destroyed') => void) | undefined;
    /**
     * Whether the diagnostics panel is mounted at all. Default `true`.
     *
     * A prop rather than a second host, because what `RD4` and `RD5` are about
     * is the *transition*: the provider is rendered with no reader, something
     * happens on the socket, and the reader arrives afterwards — which is the
     * order a consumer reaches by opening a panel because a relay misbehaved.
     * Two hosts could show a reader that was never there and a reader that
     * always was, and neither is that sequence.
     */
    readonly reader?: boolean | undefined;
    /**
     * A second child, after the reader, that throws while it initialises.
     *
     * The provider is built and its subtree has started producing content
     * before the throw, which is the state `SS4` is about: on a server the
     * renderer runs its cleanup only after collecting content *successfully*,
     * so a child that throws is precisely the case an `onDestroy`-based release
     * does not reach. Placed after {@link DiagnosticsReader} rather than
     * instead of it so that the arm differs from `SS3` in one thing.
     */
    readonly childThrows?: boolean | undefined;
  }

  let {
    relays = [],
    transportKeys,
    signer,
    boundary = true,
    rethrow = false,
    onerror,
    onready,
    onlifetime,
    childThrows = false,
    reader = true
  }: Props = $props();
</script>

{#if boundary}
  <svelte:boundary {onerror}>
    <RelayProvider {relays} {transportKeys} {signer} {onready} {rethrow}>
      {#if reader}<DiagnosticsReader {onlifetime} />{/if}
      {#if childThrows}<ThrowsWhenTold where="init" generation={1} />{/if}
    </RelayProvider>

    {#snippet failed(error)}
      <p data-testid="failed">
        {(error as Error).name}:{(error as { code?: string }).code ?? 'no-code'}
      </p>
    {/snippet}
  </svelte:boundary>
{:else}
  <RelayProvider {relays} {transportKeys} {signer} {onready} {rethrow}>
    {#if reader}<DiagnosticsReader {onlifetime} />{/if}
    {#if childThrows}<ThrowsWhenTold where="init" generation={1} />{/if}
  </RelayProvider>
{/if}
