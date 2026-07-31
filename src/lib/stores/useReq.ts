/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { createQuery, useQueryClient } from '@tanstack/svelte-query';
import type { RxReq } from 'rx-nostr';
import { createRxOneshotReq } from 'rx-nostr';
import { derived, readable, writable } from 'svelte/store';

import type { ReqResult, ReqStatus, UseReqOpts } from './types.js';

// TODO: Add throttling support
// TODO: Add timeout support
export function useReq<A>({
  rxNostr,
  queryKey,
  filters,
  operator,
  req,
  initData
}: UseReqOpts<A>): ReqResult<A> {
  const queryClient = useQueryClient();

  if (Object.keys(rxNostr.getDefaultRelays()).length === 0) {
    queryClient.setQueryData(queryKey, initData);

    return {
      data: readable<A>(initData),
      status: readable('success'),
      error: readable()
    };
  }

  let _req: RxReq;
  if (req) {
    req.emit(filters);
    _req = req;
  } else {
    _req = createRxOneshotReq({ filters });
  }

  const status = writable<ReqStatus>('loading');
  const error = writable<Error | undefined>();

  const obs = rxNostr.use(_req).pipe(operator);
  const query = createQuery<A, Error>({
    queryKey,
    queryFn: ({ signal }) => {
      // Every attempt starts from a clean slate. These stores outlive a single
      // fetch, so without this a retry or refetch that succeeds still reports
      // the previous attempt's failure.
      status.set('loading');
      error.set(undefined);

      return new Promise<A>((resolve, reject) => {
        let fulfilled = false;
        let latest: A;

        const subscription = obs.subscribe({
          next: (v) => {
            latest = v;

            if (fulfilled) {
              queryClient.setQueryData(queryKey, v);
            } else {
              fulfilled = true;
              // Resolving synchronously would pin the query to this first
              // value: anything the relays deliver in the same task reaches
              // `setQueryData()` before the resolution is processed, and is
              // then overwritten by it. Deferring to a microtask lets the whole
              // batch land first.
              queueMicrotask(() => resolve(latest));
            }
          },
          complete: () => {
            status.set('success');

            // A REQ that matches nothing completes on EOSE without ever
            // emitting: `latest()` scans without a seed and `scanArray()`'s
            // seed only surfaces once the source emits. Resolving here keeps
            // the query from staying pending forever, which would otherwise
            // leave `.status` reporting 'success' while `.data` never
            // settles. TanStack Query rejects `undefined` as query data, so
            // `null` stands in for "completed with no events" and is mapped
            // back to `initData` below.
            if (!fulfilled) {
              resolve((initData ?? null) as A);
              fulfilled = true;
            }
          },
          error: (e) => {
            console.error(e);
            status.set('error');
            error.set(e);

            if (!fulfilled) {
              reject(e);
              fulfilled = true;
            }
          }
        });

        // Reading `signal` opts this query into cancellation: when its last
        // observer goes away while the fetch is still in flight — a component
        // unmounting before the relays reach EOSE, or an explicit
        // `cancelQueries()` — the REQ is closed instead of being left open.
        signal.addEventListener('abort', () => subscription.unsubscribe());
      });
    }
  });

  return {
    // `createQuery()`'s store emits synchronously on subscribe, so `derived()`'s
    // initial value is replaced by `$query.data` right away — including while
    // the query is still pending, when that data is `undefined`. Falling back
    // to `initData` makes it the value seen throughout a request, not just
    // before the first emission, and maps the `null` resolved above back to it.
    data: derived(query, ($query) => ($query.data ?? initData) as A, initData),
    status: derived([query, status], ([$query, $status]) => {
      // The local store wins when it holds an error: a stream that fails after
      // the query already resolved can't move `$query` off 'success', and
      // reporting success next to a set `.error` is a state consumers can't
      // make sense of.
      if ($status === 'error') {
        return 'error';
      } else if ($query.isSuccess) {
        return 'success';
      } else if ($query.isError) {
        return 'error';
      } else {
        return $status;
      }
    }),
    error: derived([query, error], ([$query, $error]) => {
      if ($query.isError) {
        return $query.error;
      } else {
        return $error as Error;
      }
    })
  };
}
