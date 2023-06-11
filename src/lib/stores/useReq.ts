/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { RxReq } from 'rx-nostr';
import { createRxOneshotReq } from 'rx-nostr';
import { readable, writable } from 'svelte/store';

import { fromObservable } from './helpers.js';
import type { ReqResult, ReqStatus, UseReqOpts } from './types.js';

// TODO: Add cache support
// TODO: Add timeout support
export function useReq<A>({
  rxNostr,
  filters,
  operator,
  req,
  initData
}: UseReqOpts<A>): ReqResult<A> {
  if (rxNostr.getRelays().length === 0) {
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

  const data = rxNostr.use(_req).pipe(operator);
  const status = writable<ReqStatus>('loading');
  const error = writable<Error | undefined>(undefined);

  data.subscribe({
    complete: () => status.set('success'),
    error: (e) => {
      status.set('error');
      error.set(e);
    }
  });

  return {
    data: fromObservable(data),
    status,
    error
  };
}
