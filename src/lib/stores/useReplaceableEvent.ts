/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { filterKind, latest, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterPubkey } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useReplaceableEvent(
  rxNostr: RxNostr,
  queryKey: QueryKey,
  pubkey: string,
  kind: number,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  // TODO: Add npub support
  const filters = [{ kinds: [kind], authors: [pubkey], limit: 1 }];
  const operator = pipe(filterKind(kind), filterPubkey(pubkey), verify(), latest());
  return useReq({ rxNostr, queryKey, filters, operator, req });
}
