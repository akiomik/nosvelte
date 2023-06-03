import type { Observable } from 'rxjs';
import { createRxOneshotReq, Nostr, verify, latest } from 'rx-nostr';
import type { RxNostr, RxReq, RxReqController, EventPacket } from 'rx-nostr';

export type RxReqBase = RxReq & RxReqController;

// TODO: Add cache support
// TODO: Add operators support
// TODO: Add timeout support
export function useEvents(
  client: RxNostr,
  filters: Nostr.Filter[],
  req: RxReqBase | undefined
): Observable<EventPacket> {
  let _req: RxReq;
  if (req) {
    req.emit(filters);
    _req = req;
  } else {
    _req = createRxOneshotReq({ filters });
  }

  return client.use(_req);
}

export function useLatestEvent(
  client: RxNostr,
  filters: Nostr.Filter[],
  req: RxReqBase | undefined
): Observable<EventPacket> {
  return useEvents(client, filters, req).pipe(
    verify(),
    latest()
  );
}

export function useMetadata(
  client: RxNostr,
  pubkey: string,
  req: RxReqBase | undefined
): Observable<EventPacket> {
  // TODO: Add npub support
  // TODO: Add pubkey filter for reusing req
  const filters = [{ authors: [pubkey] }]
  return useLatestEvent(client, filters, req);
}
