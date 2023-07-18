/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { filterKind, uniq, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterPubkey, scanArray } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useUserTextList(
  rxNostr: RxNostr,
  queryKey: QueryKey,
  pubkey: string,
  limit: number,
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  // TODO: Add note1 support
  const filters = [{ kinds: [1], authors: [pubkey], limit }];
  const operator = pipe(filterKind(1), filterPubkey(pubkey), uniq(), verify(), scanArray());
  return useReq({ rxNostr, queryKey, filters, operator, req, initData: [] });
}
