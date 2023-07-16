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

  if (rxNostr.getRelays().length === 0) {
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
  const error = writable<Error>();

  const obs = rxNostr.use(_req).pipe(operator);
  const query = createQuery(queryKey, () => {
    return new Promise((resolve, reject) => {
      let fullfilled = false;

      obs.subscribe({
        next: (v) => {
          if (fullfilled) {
            queryClient.setQueryData(queryKey, v);
          } else {
            resolve(v);
            fullfilled = true;
          }
        },
        complete: () => status.set('success'),
        error: (e) => {
          console.error(e);
          status.set('error');
          error.set(e);

          if (!fullfilled) {
            reject(e);
            fullfilled = true;
          }
        }
      });
    });
  });

  return {
    data: derived(query, ($query) => $query.data, initData),
    status: derived([query, status], ([$query, $status]) => {
      if ($query.isSuccess) {
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
        return $error;
      }
    })
  };
}
