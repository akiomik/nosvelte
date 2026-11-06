<script lang="ts" module>
  /** What the walk reached. */
  export interface Walked {
    /** How many entries the framework's context map held. */
    readonly entries: number;
    /** How many objects the walk reached from them. */
    readonly objects: number;
    /** Every query client reached, by identity. */
    readonly clients: readonly unknown[];
    /** Where each value the walk reached and could not look inside was found. */
    readonly unlooked: readonly string[];
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
   * `getAllContexts()` hands it, through every own member, with no depth to
   * run out, so a client nested inside a value is reached as well as one held
   * directly, and an object reached twice was looked inside wholly the first
   * time. A query client is recognised by the pair of methods every one
   * answers, and the arm decides whose it is by identity; what a client holds
   * is its cache, which the arms read as notifications, so the walk stops
   * there.
   *
   * **Every way it stops is a reading.** A value it cannot look inside is
   * reported where it was found rather than passed over: a function, which can
   * close over anything; an object that is neither a plain object nor an
   * array, whose class may keep private fields or whose internal slots — a
   * `Map`'s, a `Set`'s, a `Promise`'s — hold what its own members do not show;
   * and a member that throws when it is read.
   *
   * **It reads once**, as it is initialised: a value written into the map, or
   * into something in it, later than that is not read.
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
  const unlooked: string[] = [];

  const walk = (value: unknown, where: string): void => {
    if (typeof value === 'function') {
      unlooked.push(where);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (seen.includes(value)) return;
    seen.push(value);
    const held = value as Record<string | symbol, unknown>;
    if (typeof held['getQueryCache'] === 'function' && typeof held['setQueryData'] === 'function') {
      clients.push(value);
      return;
    }
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
      unlooked.push(where);
      return;
    }
    for (const key of Reflect.ownKeys(value)) {
      const at = `${where}.${String(key)}`;
      let member: unknown;
      try {
        member = held[key];
      } catch {
        unlooked.push(at);
        continue;
      }
      walk(member, at);
    }
  };

  for (const [key, value] of all) walk(value, String(key));

  // svelte-ignore state_referenced_locally
  walked({ entries: all.size, objects: seen.length, clients, unlooked });
</script>
