<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A subtree that fails where a provider would fail, and says whether it is
   * still alive.
   *
   * Two places, because 0004 C16 decides differently about them: a throw from
   * the component's initialisation, which is where `createNostrContext` runs,
   * and a throw from an `$effect` that reads a prop, which is where a relay
   * list arriving as `NostrApp.relays` would be applied. The measurement is
   * what Svelte does with each; the library's choice is downstream of that.
   */
  interface Props {
    /** Where it throws. `'none'` is the control — the subtree that lives. */
    readonly where: 'init' | 'effect' | 'none';
    /** Bumped by the test to make the effect re-run with a value that throws. */
    readonly generation: number;
    /** Called from `onMount`/teardown so destruction is observable. */
    readonly onlifetime?: ((event: 'mounted' | 'destroyed') => void) | undefined;
  }

  import { onMount } from 'svelte';

  let { where, generation, onlifetime }: Props = $props();

  // Read once, at initialisation, which is where a provider builds its context.
  // svelte-ignore state_referenced_locally
  if (where === 'init') throw new Error(`init-${generation}`);

  // `onMount` rather than `$effect`: an effect that reads a prop re-runs on a
  // parent re-render and reports a teardown that did not happen.
  onMount(() => {
    onlifetime?.('mounted');
    return () => onlifetime?.('destroyed');
  });

  $effect(() => {
    if (where === 'effect' && generation > 0) throw new Error(`effect-${generation}`);
  });
</script>

<p data-testid="subtree">alive {generation}</p>
