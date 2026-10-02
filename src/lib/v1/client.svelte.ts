/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A15 and #77: the library builds its own query client, and lets go of it.
 *
 * A15 says the client is the library's. That was a decision with nothing behind
 * it — the wiring check listed the symbol as absent, and the spike took a client
 * from context, which is the shared-client shape A15 rejects. This is the
 * symbol.
 *
 * #77 is the other half. The current provider builds a client in a reactive
 * statement, so every re-evaluation constructs a new one and abandons the old
 * without unmounting it. Each mounted client holds one focus listener and one
 * online listener (measured), so the leak is one of each per re-evaluation, for
 * the life of the page.
 *
 * Owning a thing means releasing it, so creation and disposal are the same
 * decision and belong in the same place.
 */

import { QueryClient } from 'tanstack-svelte-query-v6';

import { libraryQueryDefaults } from './engine.js';

/**
 * A client the library owns, tied to the lifetime of the effect that made it.
 *
 * The defaults are applied here rather than per query, which is what A15 is
 * *for*: `defaultOptions.queries` is the second input into the option merge, so
 * owning the client turns the hole a caller's client opens into the first line
 * of defence.
 *
 * The teardown does two things and needs both. `unmount()` releases the focus
 * and online listeners — without it they accumulate, which is #77. `clear()`
 * drops the cache, without which a provider that comes and goes leaves its
 * entries alive with no observer that could ever read them again.
 *
 * **What it releases that it used to leave.** A request still fetching when the
 * provider dies left a collection timer armed *after* this teardown returned,
 * holding the accumulated value for the whole window: `clear()` destroys the
 * entry and clears its timer, and then the in-flight promise settles and the
 * cache library re-arms one from its own `finally`. Measured with two
 * instruments — a wrapped `setTimeout`/`clearTimeout` pair and
 * `process.getActiveResourcesInfo()` — one per provider generation, none when
 * the request had settled first.
 *
 * **It was written down as "not fixable from here", and that was false.** The
 * argument was that `updateGcTime` takes the *maximum* of the old and new
 * value, so the window cannot be shortened. True, and about a different repair:
 * the window does not have to move for the entry to be destroyed *after* the
 * settlement that re-arms it. The teardown below does that, and `LC18` holds
 * both arms. **A general "cannot" is worth as much as the constructions it
 * ruled out**, and that one had tried exactly one.
 */
export function createOwnedQueryClient(
  /**
   * Which arm this client is for.
   *
   * **Taken as an argument rather than detected here**, because the provider has
   * already resolved it and two detections of one fact are two facts waiting to
   * disagree — query-core's own `isServer` is `typeof window === 'undefined'`
   * frozen at import, and this library's is evaluated per provider.
   *
   * It decides `gcTime`, which is the one option whose value differs by arm: on
   * a server nothing is created that would need releasing, so an entry is never
   * scheduled for collection at all. Defaulted to the browser for the callers
   * that build a client without a provider.
   */
  environment: 'browser' | 'server' = 'browser',
  /**
   * What the client's owner wants done **before** the cache is torn down.
   *
   * **Ordering, and it is a contract rather than a convenience.** The provider
   * disposes as one linearised operation — revoke, then cancel *as a disposal*
   * so a `refresh()` in flight is rejected with `provider-disposed`, then
   * release the cache — and for one round the cache's release lived in its own
   * `$effect` and ran first. Nothing said so while the arms handed the hook a
   * client of their own: the query was on a cache nobody tore down, so the
   * disposal's abandonment was the only thing that could settle the call.
   * Measured through the published arrangement (`RM8`), the cancellation won
   * and the code became `attempt-abandoned` — a fact about the call where the
   * record promises a fact about the owner.
   *
   * Passed in rather than ordered by two effects, because effect teardown order
   * is the framework's to decide and this is ours.
   */
  first?: (() => void) | undefined
): { readonly client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { ...libraryQueryDefaults(environment) } }
  });

  $effect(() => {
    client.mount();

    return () => {
      first?.();
      // **What `clear()` alone leaves behind, and how it is taken back.**
      // `clear()` destroys each entry, which clears its collection timer — and
      // then a fetch that was still in flight settles, and the cache library
      // re-arms one from its own `finally`. Measured with two instruments: a
      // wrapped `setTimeout`/`clearTimeout` pair and
      // `process.getActiveResourcesInfo()`. One timer per provider generation,
      // holding the accumulated value for the whole window.
      //
      // **This was written down as "not fixable from here" and that was
      // false.** The argument was that `updateGcTime` takes the *maximum* of
      // the old and new value, so the window cannot be shortened — true, and
      // beside the point: the repair is not to shorten the window but to
      // destroy the entry *after* the settlement that re-arms it. `promise` and
      // `destroy()` are both on the cache library's public object, so this is a
      // seam rather than a reach into internals.
      //
      // Ordered before `clear()` so the queries still exist to be asked for
      // their promises; `catch` because a rejected fetch is an ordinary way for
      // one to end and is not this teardown's business. `LC18` measures both
      // arms — settled, and in flight at the moment the provider goes.
      for (const query of client.getQueryCache().getAll()) {
        void query.promise?.finally(() => query.destroy()).catch(() => undefined);
      }
      client.unmount();
      client.clear();
    };
  });

  return {
    get client() {
      return client;
    }
  };
}
