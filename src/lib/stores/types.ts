/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { EventPacket, Nostr, Relay, RxNostr, RxReq, RxReqController } from 'rx-nostr';
import type { OperatorFunction } from 'rxjs';
import type { Readable } from 'svelte/store';

export type RxReqBase = RxReq & RxReqController;

export interface ReqResult<A> {
  data: Readable<A>;
  isLoading: Readable<boolean>;
  isSuccess: Readable<boolean>;
  isError: Readable<boolean>;
  error: Readable<Error | undefined>;
}

export interface UseConnectionsOpts {
  client: RxNostr;
  relays: (string | Relay)[];
}

export interface UseReqOpts<A> {
  client: RxNostr;
  filters: Nostr.Filter[];
  operator: OperatorFunction<EventPacket, A>;
  req?: RxReqBase;
  initData?: A;
}
