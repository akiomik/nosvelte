/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { latest, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterNaddr } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useArticle(
  rxNostr: RxNostr,
  queryKey: QueryKey,
  pubkey: string,
  identifier: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  const filters = [{ kinds: [30023], authors: [pubkey], '#d': [identifier], limit: 1 }];
  const operator = pipe(filterNaddr(30023, pubkey, identifier), verify(), latest());
  return useReq({ rxNostr, queryKey, filters, operator, req });
}
