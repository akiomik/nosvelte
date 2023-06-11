/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryClient, QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { Nostr, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterMetadataList, latestEachPubkey, scanArray } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useMetadataList(
  rxNostr: RxNostr,
  queryClient: QueryClient,
  queryKey: QueryKey,
  pubkeys: string[],
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  // TODO: Add npub support
  const filters = [{ kinds: [Nostr.Kind.Metadata], authors: pubkeys, limit: pubkeys.length }];
  const operator = pipe(filterMetadataList(pubkeys), verify(), latestEachPubkey(), scanArray());
  return useReq({ rxNostr, queryClient, queryKey, filters, operator, req, initData: [] });
}
