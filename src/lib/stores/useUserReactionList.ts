/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { filterByKind, uniq } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterPubkey, scanArray } from './operators.js';
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
  // Reactions are regular events, not addressable ones, so they are only
  // deduplicated by id; grouping them by an event coordinate would collapse
  // unrelated reactions into one.
  const operator = pipe(filterByKind(7), filterPubkey(pubkey), uniq(), scanArray());
  return useReq({ rxNostr, queryKey, filters, operator, req, initData: [] });
}
