/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { QueryKey } from '@tanstack/svelte-query';
import type { EventPacket, RxNostr } from 'rx-nostr';

import type { ReqResult, RxReqBase } from './types.js';
import { useReplaceableEvent } from './useReplaceableEvent.js';

export function useMetadata(
  rxNostr: RxNostr,
  queryKey: QueryKey,
  pubkey: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  return useReplaceableEvent(rxNostr, queryKey, pubkey, 0, req);
}
