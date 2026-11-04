<script lang="ts" module>
  /** What the walk reached. */
  export interface Walked {
    /** How many entries the framework's context map held. */
    readonly entries: number;
    /** How many objects the walk reached from them. */
    readonly objects: number;
    /** Every query client reached, by identity. */
    readonly clients: readonly unknown[];
  }
</script>

<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * A descendant that never imports a context key, reporting every query
   * client it reaches through the framework's own context.
   *
   * **It walks rather than looks a name up**: from each value
   * `getAllContexts()` hands it, through every own member, to a bounded depth,
   * so a client nested inside a value is reached as well as one held directly.
   * A query client is recognised by the pair of methods every one answers, and
   * the arm decides whose it is by identity. A class's prototype is not walked
   * as a value somebody put there — `QueryClient.prototype` answers the same
   * pair — and neither is the language's own floor.
   */
  import { getAllContexts } from 'svelte';

  interface Props {
    walked: (report: Walked) => void;
  }

  let { walked }: Props = $props();

  const all = getAllContexts();
  // Plain arrays rather than `Set`s: `svelte/prefer-svelte-reactivity` refuses
  // a built-in `Set` in a component, and reactivity is not what these are for.
  const seen: unknown[] = [];
  const clients: unknown[] = [];
  let objects = 0;

  const walk = (value: unknown, depth: number): void => {
    if (depth < 0 || value === null || typeof value !== 'object') return;
    if (seen.includes(value)) return;
    seen.push(value);
    if ((value as { constructor?: { prototype?: unknown } }).constructor?.prototype === value)
      return;
    objects += 1;
    const held = value as Record<string | symbol, unknown>;
    if (typeof held['getQueryCache'] === 'function' && typeof held['setQueryData'] === 'function') {
      clients.push(value);
    }
    for (const key of Reflect.ownKeys(value)) {
      try {
        walk(held[key], depth - 1);
      } catch {
        // A member that refuses to be read is not a reference to follow.
      }
    }
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== Array.prototype) walk(proto, depth - 1);
  };

  for (const value of all.values()) walk(value, 6);

  // svelte-ignore state_referenced_locally
  walked({ entries: all.size, objects, clients });
</script>
