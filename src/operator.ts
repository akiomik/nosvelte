import { filter, type OperatorFunction } from 'rxjs';
import type { EventPacket } from 'rx-nostr';

export function filterPubkey(pubkey: string): OperatorFunction<EventPacket, EventPacket> {
  return filter((packet) => packet.event.pubkey === pubkey)
}
