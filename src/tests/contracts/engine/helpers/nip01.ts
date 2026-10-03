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
 * The `d` tags a draw may carry, beside carrying none. Values that collide
 * under a careless reading — the empty one, one with a colon, ones with
 * surrounding space, one that differs only in case — and shapes NIP-01 still
 * reads one way: extra elements after the value, and two `d` tags, of which
 * the first is the identifier even when it is the empty one.
 */
/**
 * Strings that read differently under a careless comparison: case, Unicode's
 * two spellings of one glyph (`é` composed and decomposed — two values NIP-01
 * keeps apart), surrounding and inner whitespace, a colon, and a character
 * outside the BMP. Drawn for every free-form string a draw carries: `d`
 * values, the unrelated tag's value, and content.
 */
const TRICKY = [
  's',
  'S',
  '\u00e9',
  'e\u0301',
  ' s',
  's ',
  's:x',
  '\u{1F642}',
  '  indented\n'
] as const;

const D_TAGS: readonly (readonly string[][])[] = [
  [['d', '']],
  ...TRICKY.map((value) => [['d', value]]),
  [['d', 's']],
  [['d', 'S']],
  [['d', 't']],
  [['d', 's:x']],
  [['d', 's:y']],
  [['d', ' s']],
  [['d', 's ']],
  [['d', 's', 'metadata one']],
  [['d', 's', 'metadata two']],
  [
    ['d', 's'],
    ['d', 't']
  ],
  [
    ['d', 't'],
    ['d', 's']
  ],
  [
    ['d', ''],
    ['d', 's']
  ]
];

/**
 * The `created_at` values a draw takes. Few, so ties are common; spanning a
 * change of digit count, so a comparison that read them as strings — where
 * `'9'` sorts after `'10'` — orders some pair the other way; starting at `0`,
 * which a truthiness test mistakes for absent; and spanning the 32-bit
 * boundaries, since NIP-01 bounds them by nothing narrower than a JavaScript
 * number.
 */
const INSTANTS = [0, 1, 9, 10, 99, 100, 1000, 2_147_483_647, 2_147_483_648, 4_294_967_296] as const;

/** Whether NIP-01 gives `kind` no coordinate of its own beyond the event. */
const isRegular = (kind: number): boolean =>
  !(kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000));

/** `length` lowercase hex digits. */
const hex = (rand: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rand() * 16).toString(16)).join('');

/**
 * `count` events drawn across the dimensions the replacement rule reads, and
 * the ones it must not, with each field's value drawn from the domain NIP-01
 * gives it rather than a short label:
 *
 * - ids and authors are full-length hex and share long prefixes, so nothing
 *   that reads a prefix of either can tell them apart;
 * - signatures and contents vary independently of ids, so neither an id's
 *   order nor a predecessor's value can stand in for the event's own;
 * - kinds and authors are drawn from a few per draw, so revisions of one
 *   coordinate meet often, under the `d` tags above or none and an unrelated
 *   tag that varies;
 * - `created_at` is drawn from {@link INSTANTS}.
 *
 * `expiries` gives some **regular** events an `expiration` tag, which is the
 * arrangement `B5-C5` names; a revision that expired would leave the published
 * view on its own and hide what the bound kept.
 */
export function arbitraryEvents(
  rand: () => number,
  count: number,
  { expiries = [] }: { expiries?: readonly number[] } = {}
): Partial<Nostr.Event>[] {
  const idPrefix = hex(rand, 56);
  const ids = new Set<string>();
  while (ids.size < count) ids.add(`${idPrefix}${hex(rand, 8)}`);
  const authorPrefix = hex(rand, 60);
  const authors = [`${authorPrefix}0000`, `${authorPrefix}ffff`];
  const kinds = shuffled(KINDS, rand).slice(0, 1 + Math.floor(rand() * 3));
  return [...ids].map((id) => {
    const kind = pick(rand, kinds);
    const tags: string[][] = [];
    // An unrelated tag whose name is not `d` however it is read — `D` among
    // them, which a case-folding reader takes for one — and whose value varies.
    const title = [pick(rand, ['title', 'Title', 'D']), pick(rand, TRICKY)];
    const dTags = rand() < 0.2 ? [] : pick(rand, D_TAGS).map((tag) => [...tag]);
    if (rand() < 0.5) tags.push(title);
    tags.push(...dTags);
    if (tags.length < 2 && rand() < 0.5) tags.push(title);
    if (expiries.length > 0 && isRegular(kind) && rand() < 0.6)
      tags.push(['expiration', String(pick(rand, expiries))]);
    return {
      id,
      kind,
      pubkey: pick(rand, authors),
      created_at: pick(rand, INSTANTS),
      content: `${pick(rand, TRICKY)}${hex(rand, 6)}${pick(rand, TRICKY)}`,
      sig: hex(rand, 128),
      tags
    };
  });
}
