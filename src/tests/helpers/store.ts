/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { Readable, Unsubscriber } from 'svelte/store';

/**
 * `derived()` stores only run their computation once they have a subscriber.
 * `createQuery()`'s internal store chain is no exception, so a query's
 * `queryFn` (and thus the REQ it sends) never runs until something
 * subscribes to one of `useReq()`'s returned stores. Call this right after
 * `useReq()` to activate it, mirroring what a Svelte component's `$store`
 * access would do.
 */
export function activate<A>(store: Readable<A>): Unsubscriber {
  return store.subscribe(() => undefined);
}

export function waitFor<A>(
  store: Readable<A>,
  predicate: (value: A) => boolean,
  timeout = 1000
): Promise<A> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error('waitFor: timed out waiting for condition'));
    }, timeout);

    const unsubscribe = store.subscribe((value) => {
      if (settled) return;

      // A store can emit values the predicate wasn't written to handle
      // (e.g. a query's data is genuinely `undefined` while pending, even
      // though its declared type says otherwise). Treat a throw as "not
      // matched yet" rather than letting it escape from inside `subscribe()`,
      // which would leave this callback permanently registered with no way
      // to unsubscribe.
      let matched: boolean;
      try {
        matched = predicate(value);
      } catch {
        matched = false;
      }
      if (!matched) return;

      settled = true;
      clearTimeout(timer);
      queueMicrotask(() => unsubscribe());
      resolve(value);
    });
  });
}

export function toArray<A>(store: Readable<A>, timeout: number): Promise<A[]> {
  return new Promise((resolve) => {
    const xs: A[] = [];
    const unsubscribe = store.subscribe((x) => xs.push(x));
    setTimeout(() => {
      unsubscribe();
      resolve(xs);
    }, timeout);
  });
}
