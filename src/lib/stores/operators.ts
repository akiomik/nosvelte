/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type Nostr from 'nostr-typedef';
import type { EventPacket } from 'rx-nostr';
import { latestEach } from 'rx-nostr';
import type { OperatorFunction } from 'rxjs';
import { filter, map, pipe, scan } from 'rxjs';

/**
 * The `d` tag value that addresses a parameterized replaceable event.
 *
 * NIP-01 places no constraint on where the tag sits, so it has to be looked up
 * by name; an event without one is addressed as if its identifier were empty.
 */
function identifierOf({ tags }: Nostr.Event): string {
  return tags.find(([name]) => name === 'd')?.[1] ?? '';
}

export function filterId(id: string): OperatorFunction<EventPacket, EventPacket> {
  return filter((packet) => packet.event.id === id);
}

export function filterTextList(ids: string[]): OperatorFunction<EventPacket, EventPacket> {
  return filter(({ event }) => event.kind === 1 && ids.includes(event.id));
}

export function filterPubkey(pubkey: string): OperatorFunction<EventPacket, EventPacket> {
  return filter((packet) => packet.event.pubkey === pubkey);
}

export function filterMetadataList(pubkeys: string[]): OperatorFunction<EventPacket, EventPacket> {
  return filter(({ event }) => event.kind === 0 && pubkeys.includes(event.pubkey));
}

export function filterNaddr(
  kind: number,
  pubkey: string,
  identifier: string
): OperatorFunction<EventPacket, EventPacket> {
  return filter(
    ({ event }) =>
      event.kind === kind && event.pubkey === pubkey && identifierOf(event) === identifier
  );
}

export function latestEachPubkey(): OperatorFunction<EventPacket, EventPacket> {
  return latestEach(({ event }) => event.pubkey);
}

function naddrOf(event: Nostr.Event): string {
  return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;
}

export function latestEachNaddr(): OperatorFunction<EventPacket, EventPacket> {
  return latestEach(({ event }) => naddrOf(event));
}

export function scanArray<A>(): OperatorFunction<A, A[]> {
  return scan((acc: A[], a: A) => [...acc, a], []);
}

export function collectGroupBy<A, K>(f: (a: A) => K): OperatorFunction<A, Map<K, A[]>> {
  return pipe(
    scanArray(),
    map((xs) => {
      const dict = new Map<K, A[]>();
      xs.forEach((x) => {
        const key = f(x);
        const value = dict.get(key);
        if (value) {
          dict.set(key, [...value, x]);
        } else {
          dict.set(key, [x]);
        }
      });
      return dict;
    })
  );
}

export function scanLatestEach<A, K>(f: (a: A) => K): OperatorFunction<A, A[]> {
  return pipe(
    // Only the newest value per key is ever read, so only that is kept. Built
    // on `collectGroupBy()` this used to retain the whole history and rebuild
    // every group on each emission, which grew without bound on a long-lived
    // stream. The accumulator is copied rather than mutated because `scan()`
    // shares one seed across subscriptions, and `useReq()` resubscribes on
    // every refetch.
    scan((acc: Map<K, A>, a: A) => new Map(acc).set(f(a), a), new Map<K, A>()),
    // A Map keeps insertion order, and re-setting an existing key does not move
    // it, so entries stay in first-seen order.
    map((dict) => Array.from(dict.values()))
  );
}

/**
 * Accumulate packets into a list holding the newest event per pubkey.
 *
 * `latestEachPubkey()` re-emits whenever a newer event for a pubkey arrives, so
 * accumulating it with `scanArray()` would append the update next to the event
 * it supersedes instead of replacing it.
 */
export function scanLatestEachPubkey(): OperatorFunction<EventPacket, EventPacket[]> {
  return pipe(
    latestEachPubkey(),
    scanLatestEach(({ event }) => event.pubkey)
  );
}

/**
 * Accumulate packets into a list holding the newest event per addressable
 * event coordinate. See {@link scanLatestEachPubkey} for why plain
 * accumulation is not enough.
 */
export function scanLatestEachNaddr(): OperatorFunction<EventPacket, EventPacket[]> {
  return pipe(
    latestEachNaddr(),
    scanLatestEach(({ event }) => naddrOf(event))
  );
}
