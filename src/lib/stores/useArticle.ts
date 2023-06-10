/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { EventPacket, RxNostr } from 'rx-nostr';
import { latest, Nostr, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterNaddr } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useArticle(
  rxNostr: RxNostr,
  pubkey: string,
  identifier: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  const filters = [
    { kinds: [Nostr.Kind.Article], authors: [pubkey], '#d': [identifier], limit: 1 }
  ];
  const operator = pipe(filterNaddr(Nostr.Kind.Article, pubkey, identifier), verify(), latest());
  return useReq({ rxNostr, filters, operator, req });
}
