/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * NIP-01's replacement rules, written from the protocol rather than imported
 * from the library: the oracle the event-set arms compare the fold against,
 * and a generator of the inputs they compare it on.
 *
 * **Why a model rather than more fixtures.** Three rounds of review each found
 * a mutation of `eventset.ts` that the hand-picked fixtures let through — ids
 * that sorted the same way as recency, every revision with the same content,
 * one tag held constant, kind 3 left out, a relay that only ever arrived last
 * — and each repair was one more fixture beside the gap it closed. What the
 * rows promise is a rule over every event, so the arms draw events across
 * every dimension the rule could read, and compare what the fold keeps with
 * what this file says NIP-01 keeps. Nothing here calls the library: an oracle
 * that borrowed `replacementKey` or `laterWins` agreed with every mutation of
 * them, which is the defect the bound's arms had twice.
 */
import type Nostr from 'nostr-typedef';

/** What the rule reads of an event, whether the caller's or one this library owns. */
export interface Revision {
  readonly id: string;
  readonly kind: number;
  readonly pubkey: string;
  readonly created_at: number;
  readonly tags: readonly (readonly string[])[];
}

/** The coordinate NIP-01 gives an event: one per author and kind, one per `d` too, or the event itself. */
export function coordinateOf(event: Revision): string {
  const { kind } = event;
  if (kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000))
    return `replaceable:${kind}:${event.pubkey}`;
  if (kind >= 30000 && kind < 40000) {
    const d = event.tags.find(([name]) => name === 'd')?.[1] ?? '';
    return `addressable:${kind}:${event.pubkey}:${d}`;
  }
  return `event:${event.id}`;
}

/** Of two revisions of one coordinate, the one NIP-01 keeps: the later, and on a tie the lower id. */
export function newerOf<T extends Pick<Revision, 'created_at' | 'id'>>(a: T, b: T): T {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;
  return a.id <= b.id ? a : b;
}

/** The revision NIP-01 keeps for each coordinate among `events`. */
export function winnersOf<T extends Revision>(events: readonly T[]): Map<string, T> {
  const kept = new Map<string, T>();
  for (const event of events) {
    const coordinate = coordinateOf(event);
    const held = kept.get(coordinate);
    kept.set(coordinate, held === undefined ? event : newerOf(held, event));
  }
  return kept;
}

/** Deterministic PRNG, so a failure is reproducible from the seed alone. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)] as T;

/** A copy of `items` in an order drawn from `rand`. */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let at = out.length - 1; at > 0; at -= 1) {
    const other = Math.floor(rand() * (at + 1));
    [out[at], out[other]] = [out[other] as T, out[at] as T];
  }
  return out;
}

/**
 * Every kind class with a coordinate, at the edges of its range and inside it,
 * and the regular kinds around them. No ephemeral kind: the fold refuses those
 * before any coordinate is read, which is `B5`'s other arms' subject.
 */
const KINDS = [0, 1, 3, 9999, 10000, 10002, 19999, 30000, 30023, 39999, 40000] as const;

/**
 * `count` events drawn across every dimension the replacement rule could read
 * — kind, author, `d` absent, empty or named, an unrelated tag that varies and
 * sits before or after `d`, content, and a `created_at` drawn from three values
 * so ties are common — with ids distinct and in no relation to recency.
 * `expiring` gives some events an `expiration` tag drawn from `expiries`.
 */
export function arbitraryEvents(
  rand: () => number,
  count: number,
  { expiries = [] }: { expiries?: readonly number[] } = {}
): Partial<Nostr.Event>[] {
  const ids = shuffled(
    Array.from({ length: count }, (_, at) => `id${String(at).padStart(2, '0')}`),
    rand
  );
  return ids.map((id) => {
    const tags: string[][] = [];
    const title = ['title', pick(rand, ['x', 'y'])];
    const d = pick(rand, [undefined, '', 's', 't'] as const);
    const dTag = d === undefined ? undefined : ['d', d];
    if (rand() < 0.5) tags.push(title);
    if (dTag !== undefined) tags.push(dTag);
    if (tags.length < 2 && rand() < 0.5) tags.push(title);
    if (expiries.length > 0 && rand() < 0.4)
      tags.push(['expiration', String(pick(rand, expiries))]);
    return {
      id,
      kind: pick(rand, KINDS),
      pubkey: pick(rand, ['p1', 'p2']),
      created_at: pick(rand, [10, 20, 30]),
      content: `content of ${id}`,
      tags
    };
  });
}
