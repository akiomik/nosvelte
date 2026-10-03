/**
 * Runes harness for driving the engine's own hooks from a plain `.test.ts`.
 *
 * TanStack Query v6 drives its observer with `$state`/`$effect` rather than a
 * store, and `$effect` needs an active effect context; this module provides
 * one via `$effect.root`. Ported from the spike's harness with the engine.
 */
import { flushSync } from 'svelte';

export interface Mounted<T> {
  value: T;
  /** Tears the root down — the equivalent of the component being destroyed. */
  destroy: () => void;
}

/**
 * Run `fn` inside an effect root, mimicking a component instance.
 *
 * The returned `destroy` is what makes teardown observable: it is the only
 * thing that removes v6's query observer, since v6 ties observer lifetime to
 * `$effect` rather than to store subscribers.
 */
export function mount<T>(fn: () => T): Mounted<T> {
  let value!: T;
  const destroy = $effect.root(() => {
    value = fn();
  });

  // Let the `$effect` inside `createQuery` attach its observer before the
  // caller looks at anything.
  flushSync();

  return { value, destroy };
}

export function flush(): void {
  flushSync();
}

export interface Box<T> {
  current: T;
}

/** A `$state` cell, so a test can change what an options accessor reads. */
export function box<T>(initial: T): Box<T> {
  let value = $state(initial);

  return {
    get current() {
      return value;
    },
    set current(next: T) {
      value = next;
    }
  };
}

/**
 * Like {@link mount}, but without the flush.
 *
 * A component's first render happens before its effects run, so anything a
 * store computes in an effect is not what the first paint shows. `mount` hides
 * that by flushing, which is right for almost every test here and wrong for the
 * one property that is about the first read: a mutation that removed a store's
 * initial value killed nothing, because the flush had already replaced it.
 */
export function mountUnflushed<T>(fn: () => T): Mounted<T> {
  let value!: T;
  const destroy = $effect.root(() => {
    value = fn();
  });

  return { value, destroy };
}

/**
 * A reader with a subscription, for tests that need one and cannot write it.
 *
 * `$effect` is a compiler construct and a `.test.ts` file cannot hold one, so a
 * plain test that wants to measure what a *reader* does — rather than what a
 * value is — has to reach for this. The body runs inside whatever root
 * {@link mount} is building, and re-runs when the state it read changes, which
 * is the whole point: an arm about "nothing re-derived afterwards" needs
 * something that would have.
 */
export function readerEffect(body: () => void): void {
  $effect(body);
}
