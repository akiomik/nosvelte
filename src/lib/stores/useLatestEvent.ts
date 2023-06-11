/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryClient, QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { latest, Nostr, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useLatestEvent(
  rxNostr: RxNostr,
  queryClient: QueryClient,
  queryKey: QueryKey,
  filters: Nostr.Filter[],
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  const operator = pipe(verify(), latest());
  return useReq({ rxNostr, queryClient, queryKey, filters, operator, req });
}
