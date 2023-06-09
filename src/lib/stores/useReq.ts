/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { EventPacket, RxNostr, RxReq } from 'rx-nostr';
import { createRxOneshotReq, Nostr } from 'rx-nostr';
import type { OperatorFunction } from 'rxjs';
import { readable, writable } from 'svelte/store';

import { fromObservable } from './helpers.js';
import type { ReqResult, RxReqBase } from './types.js';

// TODO: Add cache support
// TODO: Add timeout support
export function useReq<A>(
  client: RxNostr,
  filters: Nostr.Filter[],
  opeartor: OperatorFunction<EventPacket, A>,
  req?: RxReqBase | undefined,
  initData?: A | undefined
): ReqResult<A> {
  if (client.getRelays().length === 0) {
    return {
      data: readable<A>(initData),
      isLoading: readable(false),
      isError: readable(false),
      isSuccess: readable(true),
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

  const data = client.use(_req).pipe(opeartor);
  const isLoading = writable(true);
  const isSuccess = writable(false);
  const isError = writable(false);
  const error = writable<Error | undefined>(undefined);

  data.subscribe({
    complete: () => {
      isLoading.set(false);
      isSuccess.set(true);
    },
    error: (e) => {
      isError.set(true);
      error.set(e);
    }
  });

  return {
    data: fromObservable(data),
    isLoading,
    isSuccess,
    isError,
    error
  };
}
