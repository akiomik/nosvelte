/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { readable } from 'svelte/store';

import type { ReqResult, ReqStatus } from '$lib/stores/index.js';

/**
 * Builds a `ReqResult` backed by static stores, for stubbing a `use*` store
 * hook when unit-testing a component's slot-selection logic in isolation
 * from the real data-fetching pipeline (already covered by `src/tests/stores`).
 *
 * `data` accepts `undefined` even though `ReqResult<A>['data']` is typed as
 * `Readable<A>`, matching the real hooks: components always read it as
 * `$data?.foo`, since a query can be `'loading'` or genuinely empty.
 */
export function fakeReqResult<A>(
  data: A | undefined,
  status: ReqStatus = 'success',
  error?: Error
): ReqResult<A> {
  return {
    data: readable(data as A),
    status: readable(status),
    error: readable(error)
  };
}
