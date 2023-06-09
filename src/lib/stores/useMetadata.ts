/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { EventPacket, RxNostr } from 'rx-nostr';
import { filterKind, latest, Nostr, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterPubkey } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useMetadata(
  client: RxNostr,
  pubkey: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  // TODO: Add npub support
  const filters = [{ kinds: [Nostr.Kind.Metadata], authors: [pubkey], limit: 1 }];
  const operator = pipe(filterKind(Nostr.Kind.Metadata), filterPubkey(pubkey), verify(), latest());
  return useReq(client, filters, operator, req);
}
