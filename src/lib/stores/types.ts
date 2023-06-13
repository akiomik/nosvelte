/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryClient, QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, Nostr, Relay, RxNostr, RxReq, RxReqController } from 'rx-nostr';
import type { OperatorFunction } from 'rxjs';
import type { Readable } from 'svelte/store';

export type RxReqBase = RxReq & RxReqController;

export type ReqStatus = 'loading' | 'success' | 'error';

export interface ReqResult<A> {
  data: Readable<A>;
  status: Readable<ReqStatus>;
  error: Readable<Error | undefined>;
}

export interface UseConnectionsOpts {
  rxNostr: RxNostr;
  relays: (string | Relay)[];
}

export interface UseReqOpts<A> {
  rxNostr: RxNostr;
  queryClient: QueryClient;
  queryKey: QueryKey;
  filters: Nostr.Filter[];
  operator: OperatorFunction<EventPacket, A>;
  req?: RxReqBase;
  initData?: A;
}
