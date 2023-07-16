/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterMetadataList, latestEachPubkey, scanArray } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useMetadataList(
  rxNostr: RxNostr,
  queryKey: QueryKey,
  pubkeys: string[],
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  // TODO: Add npub support
  const filters = [{ kinds: [0], authors: pubkeys, limit: pubkeys.length }];
  const operator = pipe(filterMetadataList(pubkeys), verify(), latestEachPubkey(), scanArray());
  return useReq({ rxNostr, queryKey, filters, operator, req, initData: [] });
}
