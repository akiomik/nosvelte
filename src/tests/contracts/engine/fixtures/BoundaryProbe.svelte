<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * One `<svelte:boundary>` with a `failed` snippet, around {@link ThrowsWhenTold}.
   *
   * The shape a consumer of a provider would write, so that what the boundary
   * does to the provider's subtree is measured on the arrangement the decision
   * is about rather than on an effect root.
   */
  import ThrowsWhenTold from './ThrowsWhenTold.svelte';

  interface Props {
    readonly where: 'init' | 'effect' | 'none';
    readonly generation: number;
    readonly onerror?: ((error: unknown) => void) | undefined;
    readonly onlifetime?: ((event: 'mounted' | 'destroyed') => void) | undefined;
  }

  let { where, generation, onerror, onlifetime }: Props = $props();
</script>

<svelte:boundary {onerror}>
  <ThrowsWhenTold {where} {generation} {onlifetime} />

  {#snippet failed(error)}
    <p data-testid="failed">failed: {(error as Error).message}</p>
  {/snippet}
</svelte:boundary>
