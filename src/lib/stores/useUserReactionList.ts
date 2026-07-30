/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { filterByKind } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterPubkey, latestEachNaddr, scanArray } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useUserReactionList(
  rxNostr: RxNostr,
  queryKey: QueryKey,
  pubkey: string,
  limit: number,
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  const filters = [{ kinds: [7], authors: [pubkey], limit }];
  const operator = pipe(filterByKind(7), filterPubkey(pubkey), latestEachNaddr(), scanArray());
  return useReq({ rxNostr, queryKey, filters, operator, req, initData: [] });
}
