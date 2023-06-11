/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { createQuery, useQueryClient } from '@tanstack/svelte-query';
import type { RxReq } from 'rx-nostr';
import { createRxOneshotReq } from 'rx-nostr';
import { readable, writable } from 'svelte/store';

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

  if (rxNostr.getRelays().length === 0) {
    queryClient.setQueryData(queryKey, initData);

    return {
      data: readable<A>(initData),
      status: readable('success'),
      error: readable()
    };
  }

  const data = writable<A>(initData);
  const status = writable<ReqStatus>('loading');
  const error = writable<Error | undefined>(undefined);

  const query = createQuery(queryKey, () => {
    let _req: RxReq;
    if (req) {
      req.emit(filters);
      _req = req;
    } else {
      _req = createRxOneshotReq({ filters });
    }

    const obs = rxNostr.use(_req).pipe(operator);
    let resolved = false;

    return new Promise((resolve, reject) => {
      obs.subscribe({
        next: (v) => {
          if (resolved) {
            queryClient.setQueryData(queryKey, v);
          } else {
            resolve(v);
            resolved = true;
          }
        },
        complete: () => status.set('success'),
        error: (e) => reject(e)
      });
    });
  });

  // TODO: Unsubscribe
  // TODO: Use CreateQueryResult type
  query.subscribe((q: { isError: boolean; error: Error | undefined; data: A }) => {
    if (q.isError) {
      status.set('error');
      error.set(q.error);
    } else {
      data.set(q.data);
    }
  });

  return {
    data,
    status,
    error
  };
}
