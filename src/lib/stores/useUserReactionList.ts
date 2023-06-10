/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { EventPacket, RxNostr } from 'rx-nostr';
import { filterKind, Nostr, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterPubkey, latestEachNaddr, scanArray } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useUserReactionList(
  rxNostr: RxNostr,
  pubkey: string,
  limit: number,
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  const filters = [{ kinds: [Nostr.Kind.Reaction], authors: [pubkey], limit }];
  const operator = pipe(
    filterKind(Nostr.Kind.Reaction),
    filterPubkey(pubkey),
    verify(),
    latestEachNaddr(),
    scanArray()
  );
  return useReq({ rxNostr, filters, operator, req, initData: [] });
}
