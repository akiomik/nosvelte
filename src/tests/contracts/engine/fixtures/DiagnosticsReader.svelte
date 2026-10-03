<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A descendant that reads the published hook and renders both of its fields.
   *
   * The refusal is asserted **through the template** rather than off the
   * context, because "a consumer can act on it" is a claim about what a
   * component can render, and the field being present on an object is a weaker
   * one. Its own lifetime is reported so that a subtree destroyed by an error
   * boundary is observable as a fact rather than inferred from a missing node.
   */
  import { onMount } from 'svelte';

  import { useRelayDiagnostics } from '$lib/v1/diagnostics.svelte.js';

  interface Props {
    readonly onlifetime?: ((event: 'mounted' | 'destroyed') => void) | undefined;
  }

  let { onlifetime }: Props = $props();

  const diagnostics = useRelayDiagnostics();

  /**
   * Every row of the map, in full, as one line.
   *
   * The `relays` line below is the membership alone, which is what a map that
   * shrinks would show — and a map whose rows had *lost* their capabilities or
   * their connection state would leave it untouched. `SS3` reads this one, on
   * a server, where there is no transport for a connection state to come from
   * and every row must therefore say `initialized`.
   *
   * `-` rather than an empty field for the three optional things, so that a
   * missing value and an empty string are not the same string.
   */
  const rows = $derived(
    Object.values(diagnostics.relays)
      // `RelayDiagnostics` is a partial map — indexing it with a string a
      // consumer holds may find nothing, which is the half the type says out
      // loud — so enumerating it hands back `RelayDiagnostic | undefined`.
      // Every row of an accepted scope is there; this is the type being read
      // rather than a case that arises.
      .filter((relay) => relay !== undefined)
      .map(
        (relay) =>
          `${relay.url}|${relay.connection}|${relay.read ? 'r' : '-'}|${relay.write ? 'w' : '-'}|${relay.lastNotice?.text ?? '-'}`
      )
      .join(' ')
  );

  // `onMount` rather than `$effect`, and the difference is the whole point of
  // the observation: an effect that reads a prop re-runs when the parent
  // re-renders, so it reports `destroyed, mounted` for a component that was
  // never destroyed — measured, and it is what a first version of `CF4` read as
  // a teardown. This runs once per component instance and its cleanup runs when
  // that instance ends.
  /**
   * What each row says the consumer wrote, which is the join a consumer has to
   * the map's keys. Rendered separately from `rows` so that an arm reading the
   * capabilities is not also reading this.
   */
  const spellings = $derived(
    Object.values(diagnostics.relays)
      .filter((relay) => relay !== undefined)
      .map((relay) => `${relay.url}=${relay.configuredUrls.join('+')}`)
      .join(' ')
  );

  onMount(() => {
    onlifetime?.('mounted');
    return () => onlifetime?.('destroyed');
  });
</script>

<p data-testid="relays">{Object.keys(diagnostics.relays).join(',')}</p>
<p data-testid="diagnostics">{rows}</p>
<p data-testid="configured">{spellings}</p>
<p data-testid="configuration-error">{diagnostics.configurationError?.code ?? 'none'}</p>
