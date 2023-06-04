import { writable, type Readable } from 'svelte/store';
import { pipe } from 'rxjs';
import type { Observable, OperatorFunction } from 'rxjs';
import { createRxOneshotReq, Nostr, verify, latest, filterKind } from 'rx-nostr';
import type { RxNostr, RxReq, RxReqController, EventPacket } from 'rx-nostr';

import { filterPubkey } from './operator';

export type RxReqBase = RxReq & RxReqController;

export interface ReqResult<A> {
  data: Observable<A>,
  isLoading: Readable<boolean>,
  isSuccess: Readable<boolean>,
  isError: Readable<boolean>,
  error: Readable<Error | undefined>,
}

// TODO: Add cache support
// TODO: Add timeout support
export function useEvents(
  client: RxNostr,
  filters: Nostr.Filter[],
  opeartor: OperatorFunction<EventPacket, EventPacket>,
  req?: RxReqBase | undefined,
): ReqResult<EventPacket> {
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
    data,
    isLoading,
    isSuccess,
    isError,
    error,
  };
}

export function useLatestEvent(
  client: RxNostr,
  filters: Nostr.Filter[],
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  const operator = pipe(verify(), latest());
  return useEvents(client, filters, operator, req);
}

export function useMetadata(
  client: RxNostr,
  pubkey: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  // TODO: Add npub support
  const filters = [{ kinds: [Nostr.Kind.Metadata], authors: [pubkey] }];
  const operator = pipe(
    filterKind(Nostr.Kind.Metadata),
    filterPubkey(pubkey),
    verify(),
    latest(),
  );
  return useEvents(client, filters, operator, req);
}
