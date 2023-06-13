/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryClient, QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { filterKind, latest, Nostr, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterPubkey } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useContacts(
  rxNostr: RxNostr,
  queryClient: QueryClient,
  queryKey: QueryKey,
  pubkey: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  // TODO: Add npub support
  const filters = [{ kinds: [Nostr.Kind.Contacts], authors: [pubkey], limit: 1 }];
  const operator = pipe(filterKind(Nostr.Kind.Contacts), filterPubkey(pubkey), verify(), latest());
  return useReq({ rxNostr, queryClient, queryKey, filters, operator, req });
}
