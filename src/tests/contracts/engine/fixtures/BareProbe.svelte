<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * {@link ThrowsWhenTold} with no boundary above it at all.
   *
   * The control for {@link BoundaryProbe}: 0004 C16 says the initial refusal is
   * thrown so an error boundary can receive it, and a consumer who has not
   * written one is the case that says what "receivable" costs.
   */
  import ThrowsWhenTold from './ThrowsWhenTold.svelte';

  interface Props {
    readonly where: 'init' | 'effect' | 'none';
    readonly generation: number;
    readonly onlifetime?: ((event: 'mounted' | 'destroyed') => void) | undefined;
  }

  let { where, generation, onlifetime }: Props = $props();
</script>

<ThrowsWhenTold {where} {generation} {onlifetime} />
