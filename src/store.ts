import type { Observable } from 'rxjs';
import { createRxOneshotReq, Nostr } from 'rx-nostr';
import type { RxNostr, RxReq, RxReqController, EventPacket } from 'rx-nostr';

type RxReqBase = RxReq & RxReqController;

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
