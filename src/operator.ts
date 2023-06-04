import { filter, scan, type OperatorFunction } from 'rxjs';
import { Nostr, latestEach } from 'rx-nostr';
import type { EventPacket } from 'rx-nostr';

export function filterId(id: string): OperatorFunction<EventPacket, EventPacket> {
  return filter((packet) => packet.event.id === id)
}

export function filterPubkey(pubkey: string): OperatorFunction<EventPacket, EventPacket> {
  return filter((packet) => packet.event.pubkey === pubkey)
}

export function filterMetadataList(pubkeys: string[]): OperatorFunction<EventPacket, EventPacket> {
  return filter(({ event }) => event.kind === Nostr.Kind.Metadata && pubkeys.includes(event.pubkey))
}

export function filterNaddr(kind: Nostr.Kind, pubkey: string, identifier: string): OperatorFunction<EventPacket, EventPacket> {
  return filter(({ event }) => event.kind === kind && event.pubkey === pubkey && event.tags[0][1] === identifier)
}

export function latestEachPubkey(): OperatorFunction<EventPacket, EventPacket> {
  return latestEach(({ event }) => event.pubkey);
}

export function scanArray<A>(): OperatorFunction<A, A[]> {
  return scan((acc: A[], a: A) => [...acc, a], []);
}
