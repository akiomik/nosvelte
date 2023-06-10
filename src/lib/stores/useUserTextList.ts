/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { EventPacket, RxNostr } from 'rx-nostr';
import { filterKind, Nostr, uniq, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterPubkey, scanArray } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useUserTextList(
  client: RxNostr,
  pubkey: string,
  limit: number,
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  // TODO: Add note1 support
  const filters = [{ kinds: [Nostr.Kind.Text], authors: [pubkey], limit }];
  const operator = pipe(
    filterKind(Nostr.Kind.Text),
    filterPubkey(pubkey),
    uniq(),
    verify(),
    scanArray()
  );
  return useReq({ client, filters, operator, req, initData: [] });
}
