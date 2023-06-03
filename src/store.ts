import { writable, type Readable } from 'svelte/store';
import { pipe, filter } from 'rxjs';
import type { Observable, OperatorFunction } from 'rxjs';
import { createRxOneshotReq, Nostr, verify, latest } from 'rx-nostr';
import type { RxNostr, RxReq, RxReqController, EventPacket } from 'rx-nostr';

export type RxReqBase = RxReq & RxReqController;

export interface ReqResult<A> {
  data: Observable<A>,
  isLoading: Readable<boolean>,
  isSuccess: Readable<boolean>,
  isError: Readable<boolean>,
  error: Readable<Error | undefined>,
}

function composeOperators<A>(
  preOperator: OperatorFunction<A, A> | undefined,
  operator: OperatorFunction<A, A>,
  postOperator: OperatorFunction<A, A> | undefined
): OperatorFunction<A, A> {
  if (preOperator && postOperator) {
    return pipe(preOperator, operator, postOperator);
  } else if (preOperator) {
    return pipe(preOperator, operator);
  } else if (postOperator) {
    return pipe(operator, postOperator);
  } else {
    return operator;
  }
}

// TODO: Add cache support
// TODO: Add timeout support
export function useEvents(
  client: RxNostr,
  filters: Nostr.Filter[],
  req?: RxReqBase | undefined,
  preOperator?: OperatorFunction<EventPacket, EventPacket> | undefined,
  postOperator?: OperatorFunction<EventPacket, EventPacket> | undefined
): ReqResult<EventPacket> {
  let _req: RxReq;
  if (req) {
    req.emit(filters);
    _req = req;
  } else {
    _req = createRxOneshotReq({ filters });
  }

  const opeartor = composeOperators(preOperator, verify(), postOperator);
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
  req?: RxReqBase | undefined,
  preOperator?: OperatorFunction<EventPacket, EventPacket> | undefined,
  postOperator?: OperatorFunction<EventPacket, EventPacket> | undefined,
): ReqResult<EventPacket> {
  const operator = composeOperators(preOperator, latest(), postOperator);

  return useEvents(client, filters, req, undefined, operator);
}

export function useMetadata(
  client: RxNostr,
  pubkey: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  // TODO: Add npub support
  const filters = [{ authors: [pubkey] }]
  const preOperator = filter((packet: EventPacket) => packet.event.pubkey === pubkey); // For reusing req
  return useLatestEvent(client, filters, req, preOperator);
}
