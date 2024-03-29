/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { uniq, verify } from 'rx-nostr';
import { pipe } from 'rxjs';

import { filterId } from './operators.js';
import type { ReqResult, RxReqBase } from './types.js';
import { useReq } from './useReq.js';

export function useEvent(
  rxNostr: RxNostr,
  queryKey: QueryKey,
  id: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  const filters = [{ ids: [id], limit: 1 }];
  const operator = pipe(filterId(id), uniq(), verify());
  return useReq({ rxNostr, queryKey, filters, operator, req });
}
