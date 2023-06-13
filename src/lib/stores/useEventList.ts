/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { uniq, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterTextList, scanArray } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useEventList(
  rxNostr: RxNostr,
  queryKey: QueryKey,
  ids: string[],
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  const filters = [{ ids, limit: ids.length }];
  const operator = pipe(filterTextList(ids), uniq(), verify(), scanArray());
  return useReq({ rxNostr, queryKey, filters, operator, req, initData: [] });
}
