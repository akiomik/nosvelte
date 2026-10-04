/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The rules the canonical event set follows, and the domain its inputs are
 * drawn from, each with where it comes from: a sentence of NIP-01, or a
 * decision this library recorded in 0003 where NIP-01 says nothing.
 *
 * **Why both columns.** Seven rounds of review found mutations the arms let
 * through, and the last ones were not gaps in the fixtures but in the reading
 * of the protocol: this file used to state, as NIP-01's, rules NIP-01 does not
 * make — that kinds it leaves unclassified are regular, that the first of
 * several `d` tags decides, that a missing `d` is the empty one, that the
 * equal-timestamp rule covers addressable events — and drew field values by
 * example rather than from the domain NIP-01 gives each field. So every rule
 * the oracle applies is in {@link RULES} with its source, every field the
 * generator draws is in {@link FIELDS} with its domain and the comparison the
 * rules apply to it, and the draws are derived from that table rather than
 * picked. Nothing here calls the library: an oracle that borrowed
 * `replacementKey` or `laterWins` agreed with every mutation of them.
 */
import type Nostr from 'nostr-typedef';

/** Where a rule or a domain comes from. */
export type Source =
  | { readonly from: 'NIP-01'; readonly says: string }
  | { readonly from: '0003'; readonly decides: string };

/** One rule the oracle applies, and its source. */
export interface Rule {
  readonly rule: string;
  readonly source: Source;
}

/**
 * Every rule {@link coordinateOf} and {@link newerOf} apply. The `NIP-01`
 * entries quote the protocol; the `0003` entries are this library's decisions,
 * recorded there, for the cases NIP-01 leaves open — a port inherits the first
 * from the protocol and the second from us.
 */
export const RULES: readonly Rule[] = [
  {
    rule: 'kinds 1, 2, 4–44 and 1000–9999 are regular',
    source: { from: 'NIP-01', says: '1000 <= n < 10000 || 4 <= n < 45 || n == 1 || n == 2' }
  },
  {
    rule: 'kinds 0, 3 and 10000–19999 are replaceable, one coordinate per author and kind',
    source: { from: 'NIP-01', says: '10000 <= n < 20000 || n == 0 || n == 3' }
  },
  {
    rule: 'kinds 20000–29999 are ephemeral',
    source: { from: 'NIP-01', says: '20000 <= n < 30000' }
  },
  {
    rule: 'an ephemeral event is not stored; the set notes that one was dropped',
    source: {
      from: '0003',
      decides:
        'NIP-01 says ephemeral events are not expected to be stored; the fold drops one and records the drop (B7a)'
    }
  },
  {
    rule: 'kinds 30000–39999 are addressable, one coordinate per author, kind and d value',
    source: { from: 'NIP-01', says: '30000 <= n < 40000' }
  },
  {
    rule: 'kinds NIP-01 leaves unclassified (45–999, 40000–65535) are kept as regular events',
    source: {
      from: '0003',
      decides: 'an event no rule replaces is kept as itself, which loses nothing'
    }
  },
  {
    rule: 'a replaceable revision with a later created_at supersedes; on a tie the lower id is kept',
    source: {
      from: 'NIP-01',
      says: 'In case of replaceable events with the same timestamp, the event with the lowest id (first in lexical order) should be retained.'
    }
  },
  {
    rule: 'the same tie rule is applied to addressable revisions',
    source: {
      from: '0003',
      decides: 'one total order for every class with a coordinate, so a fold is order-independent'
    }
  },
  {
    rule: 'an addressable coordinate reads the first d tag; a missing d tag is the empty value',
    source: {
      from: '0003',
      decides:
        'reading the first and taking none as empty gives every addressable event exactly one identifier'
    }
  },
  {
    rule: 'every string the rules read is compared exactly, code unit by code unit',
    source: {
      from: '0003',
      decides:
        'NIP-01 gives no folding, so none is applied: case, Unicode form and whitespace all distinguish'
    }
  }
];

/** What the rules read of an event, whether the caller's or one this library owns. */
export interface Revision {
  readonly id: string;
  readonly kind: number;
  readonly pubkey: string;
  readonly created_at: number;
  readonly tags: readonly (readonly string[])[];
}

const isReplaceable = (kind: number): boolean =>
  kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
const isAddressable = (kind: number): boolean => kind >= 30000 && kind < 40000;
/** Whether {@link RULES} drop an event of `kind` rather than store it. */
export const isEphemeral = (kind: number): boolean => kind >= 20000 && kind < 30000;

/** The coordinate {@link RULES} give an event: per author and kind, per `d` too, or the event itself. */
export function coordinateOf(event: Revision): string {
  const { kind } = event;
  if (isReplaceable(kind)) return `replaceable:${kind}:${event.pubkey}`;
  if (isAddressable(kind)) {
    const d = event.tags.find(([name]) => name === 'd')?.[1] ?? '';
    return `addressable:${kind}:${event.pubkey}:${d}`;
  }
  return `event:${event.id}`;
}

/** Of two revisions of one coordinate, the one {@link RULES} keep: the later, and on a tie the lower id. */
export function newerOf<T extends Pick<Revision, 'created_at' | 'id'>>(a: T, b: T): T {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;
  return a.id <= b.id ? a : b;
}

/** The revision {@link RULES} keep for each coordinate among `events`. */
export function winnersOf<T extends Revision>(events: readonly T[]): Map<string, T> {
  const kept = new Map<string, T>();
  for (const event of events) {
    if (isEphemeral(event.kind)) continue;
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

/** `length` lowercase hex digits. */
const hex = (rand: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rand() * 16).toString(16)).join('');

/**
 * Strings that the exact comparison in {@link RULES} keeps apart and a careless
 * one merges: each **pair** below differs by one thing a reader might fold —
 * case, Unicode form, leading, trailing or inner whitespace, a colon that a
 * splitter cuts at, an empty value against a named one. Drawn wherever a field
 * is an arbitrary string.
 */
const STRING_PAIRS: readonly (readonly [string, string])[] = [
  ['s', 'S'],
  ['é', 'é'],
  ['s', ' s'],
  ['s', 's '],
  ['s x', 's  x'],
  ['s', 's:x'],
  ['', 's'],
  ['\u{1F642}', '\u{1F643}']
];
const STRINGS = [...new Set(STRING_PAIRS.flat())];

/** One field of an event: its domain in NIP-01, how the rules compare it, and what is drawn. */
export interface Field {
  readonly field: keyof Nostr.Event | 'tag name' | 'tag value' | 'd value' | 'tag shape';
  readonly domain: Source;
  readonly comparison: string;
  readonly drawn: string;
}

/**
 * The domain of each field, from NIP-01, beside what the generator draws for
 * it. **The draws are synthetic**: ids and signatures are not hashes and
 * signatures of the events, and pubkeys need not be curve points, because the
 * seam under test is the fold, after verification — which `B5`'s other rows
 * and 0002 own. The table says so rather than calling the draws valid events.
 */
export const FIELDS: readonly Field[] = [
  {
    field: 'id',
    domain: {
      from: 'NIP-01',
      says: '32-bytes lowercase hex-encoded sha256 of the serialized event data'
    },
    comparison: 'exact, and lexical for the tie',
    drawn: '64 hex digits sharing a 56-digit prefix, in no relation to recency'
  },
  {
    field: 'pubkey',
    domain: {
      from: 'NIP-01',
      says: '32-bytes lowercase hex-encoded public key of the event creator'
    },
    comparison: 'exact',
    drawn: 'two authors per draw, 64 hex digits sharing a 60-digit prefix'
  },
  {
    field: 'created_at',
    domain: { from: 'NIP-01', says: 'unix timestamp in seconds — no bound is stated' },
    comparison: 'numeric order',
    drawn:
      'negative, zero, small, across a change of digit count, across 2^31 and 2^32, and the largest safe integer — the last a bound this library takes from JavaScript numbers (0003), not from NIP-01'
  },
  {
    field: 'kind',
    domain: { from: 'NIP-01', says: 'integer between 0 and 65535' },
    comparison: 'by class',
    drawn:
      'every class boundary on both sides — 0 1 2 3 4 44 45 999 1000 9999 10000 19999 30000 39999 40000 65535 — no ephemeral kind, which the fold refuses before any rule reads it'
  },
  {
    field: 'tag shape',
    domain: { from: 'NIP-01', says: 'Each tag is an array of one or more strings' },
    comparison: 'the first element is the name',
    drawn:
      'one-element tags, tags with extra elements, the `d` tag after zero to three others, two `d` tags'
  },
  {
    field: 'tag name',
    domain: { from: 'NIP-01', says: 'arbitrary string arrays' },
    comparison: 'exact',
    drawn:
      '`d`, and names a careless reader takes for it: `D`, ` d `, `d ` — beside unrelated names'
  },
  {
    field: 'd value',
    domain: { from: 'NIP-01', says: 'arbitrary string arrays' },
    comparison: 'exact',
    drawn: 'both members of every pair in STRING_PAIRS, absent, and empty'
  },
  {
    field: 'tag value',
    domain: { from: 'NIP-01', says: 'arbitrary string arrays' },
    comparison: 'not read by the rules',
    drawn: 'every string in STRING_PAIRS'
  },
  {
    field: 'content',
    domain: { from: 'NIP-01', says: 'arbitrary string' },
    comparison: 'not read by the rules; carried whole',
    drawn: 'every string in STRING_PAIRS around a random core, independent of the id'
  },
  {
    field: 'sig',
    domain: { from: 'NIP-01', says: '64-bytes lowercase hex of the signature' },
    comparison: 'not read by the rules; carried whole',
    drawn: '128 hex digits, independent of every other field'
  }
];

/** {@link FIELDS}'s `kind` row as values. */
const KINDS = [
  0, 1, 2, 3, 4, 44, 45, 999, 1000, 9999, 10000, 19999, 30000, 39999, 40000, 65535
] as const;

/** {@link FIELDS}'s `created_at` row as values. */
const INSTANTS = [
  -2,
  -1,
  0,
  1,
  9,
  10,
  99,
  100,
  2_147_483_647,
  2_147_483_648,
  4_294_967_296,
  Number.MAX_SAFE_INTEGER
] as const;

/** {@link FIELDS}'s `tag name` row: names that are not `d`, some of which a careless reader takes for it. */
const OTHER_NAMES = ['D', ' d ', 'd ', 'title', 'client'] as const;

/** Whether {@link RULES} keep an event of `kind` as itself. */
const isRegular = (kind: number): boolean => !isReplaceable(kind) && !isAddressable(kind);

/**
 * `count` events drawn from {@link FIELDS}: each field independently of the
 * others, kinds and authors from a few per draw so revisions of one coordinate
 * meet. `expiries` gives some **regular** events an `expiration` tag, which is
 * the arrangement `B5-C5` names.
 */
export function arbitraryEvents(
  rand: () => number,
  count: number,
  { expiries = [], ephemeral = false }: { expiries?: readonly number[]; ephemeral?: boolean } = {}
): Partial<Nostr.Event>[] {
  const idPrefix = hex(rand, 56);
  const ids = new Set<string>();
  while (ids.size < count) ids.add(`${idPrefix}${hex(rand, 8)}`);
  const authorPrefix = hex(rand, 60);
  const authors = [`${authorPrefix}0000`, `${authorPrefix}ffff`];
  const kinds = shuffled(ephemeral ? [...KINDS, 20000, 29999] : KINDS, rand).slice(
    0,
    1 + Math.floor(rand() * 3)
  );
  // An addressable kind in most draws, since only it reads `d`, and a pair in
  // focus shows nothing unless two revisions of one addressable coordinate
  // family carry its two members.
  if (rand() < 0.6 && !kinds.some(isAddressable)) kinds.push(pick(rand, [30000, 30023, 39999]));
  // **One pair in focus per draw**, drawn for most `d` values, so the two
  // members of a pair meet as revisions of one author's kind often enough for
  // every pair to be counted — a value only ever drawn beside unrelated ones
  // shows nothing about the comparison that would merge it with its twin.
  const focus = pick(rand, STRING_PAIRS);
  const dValue = (): string => (rand() < 0.7 ? pick(rand, focus) : pick(rand, STRINGS));
  const drawn = [...ids].map((id) => {
    const kind = pick(rand, kinds);
    const tags: string[][] = [];
    // Zero to three unrelated tags before the `d` tags, of every shape.
    for (let other = Math.floor(rand() * 4); other > 0; other -= 1) {
      const name = pick(rand, OTHER_NAMES);
      tags.push(
        pick(rand, [
          [name],
          [name, pick(rand, STRINGS)],
          [name, pick(rand, STRINGS), pick(rand, STRINGS)]
        ])
      );
    }
    // The `d` tags: none, one, one with extra elements, or two.
    const dShape = rand();
    if (dShape < 0.2) {
      // No `d` tag at all.
    } else if (dShape < 0.6) tags.push(['d', dValue()]);
    else if (dShape < 0.75) tags.push(['d', dValue(), pick(rand, STRINGS)]);
    else if (dShape < 0.88) tags.push(['d', dValue()], ['d', dValue()]);
    else tags.push(['d', ''], ['d', dValue()]);
    if (rand() < 0.3) tags.push([pick(rand, OTHER_NAMES), pick(rand, STRINGS)]);
    if (expiries.length > 0 && isRegular(kind) && rand() < 0.6)
      tags.push(['expiration', String(pick(rand, expiries))]);
    return {
      id,
      kind,
      pubkey: pick(rand, authors),
      created_at: pick(rand, INSTANTS),
      content: `${pick(rand, STRINGS)}${hex(rand, 6)}${pick(rand, STRINGS)}`,
      sig: hex(rand, 128),
      tags
    };
  });
  // **And the meeting itself, placed rather than hoped for.** Where the draw
  // has an addressable kind, its first two events become revisions of one
  // author's coordinate family whose `d` values are the two members of the
  // pair in focus, and sometimes a third carries an empty `d` before a named
  // one beside them. Every other field stays as drawn. Left to chance, a pair
  // met a handful of times in three hundred draws, and a change to the draws
  // lost kills twice before a counter said so.
  const addressable = kinds.find(isAddressable);
  if (addressable !== undefined && drawn.length >= 2) {
    const placeD = (event: Partial<Nostr.Event>, d: string[][]): void => {
      event.kind = addressable;
      event.pubkey = authors[0] as string;
      event.tags = [...(event.tags ?? []).filter(([name]) => name !== 'd'), ...d];
    };
    placeD(drawn[0] as Partial<Nostr.Event>, [['d', focus[0]]]);
    placeD(drawn[1] as Partial<Nostr.Event>, [['d', focus[1]]]);
    if (drawn.length >= 3 && rand() < 0.5)
      placeD(drawn[2] as Partial<Nostr.Event>, [
        ['d', ''],
        ['d', focus[1]]
      ]);
  }
  return drawn;
}

/**
 * The arrangements `B5`'s rows name, found in one arrival order. A sweep counts
 * them over its draws and asserts each was reached, so a change to the draws
 * that stops reaching one fails rather than leaving the sweep blind to it.
 */
export type Arrangement =
  | 'revisions of one coordinate'
  | 'a superseded revision arrives after its winner'
  | 'a superseded revision arrives before its winner'
  | 'revisions tie on created_at'
  | 'revisions of one coordinate from two relays'
  | 'several coordinates in one set'
  | 'two authors of one kind';

/** Which {@link Arrangement}s `order` reaches, for events and the relay each arrived from. */
export function arrangementsOf(
  order: readonly { readonly event: Revision; readonly from?: string }[]
): Set<Arrangement> {
  const found = new Set<Arrangement>();
  const byCoordinate = new Map<string, { event: Revision; from?: string; at: number }[]>();
  order.forEach(({ event, from }, at) => {
    const list = byCoordinate.get(coordinateOf(event)) ?? [];
    list.push({ event, ...(from === undefined ? {} : { from }), at });
    byCoordinate.set(coordinateOf(event), list);
  });
  if (byCoordinate.size > 1) found.add('several coordinates in one set');
  const authorsByKind = new Map<number, Set<string>>();
  for (const { event } of order) {
    const set = authorsByKind.get(event.kind) ?? new Set<string>();
    set.add(event.pubkey);
    authorsByKind.set(event.kind, set);
  }
  if ([...authorsByKind.values()].some((authors) => authors.size > 1))
    found.add('two authors of one kind');
  for (const revisions of byCoordinate.values()) {
    if (revisions.length < 2) continue;
    found.add('revisions of one coordinate');
    const winner = revisions.reduce((a, b) => (newerOf(a.event, b.event) === a.event ? a : b));
    for (const each of revisions) {
      if (each === winner) continue;
      found.add(
        each.at > winner.at
          ? 'a superseded revision arrives after its winner'
          : 'a superseded revision arrives before its winner'
      );
      if (each.event.created_at === winner.event.created_at)
        found.add('revisions tie on created_at');
    }
    if (new Set(revisions.map(({ from }) => from)).size > 1)
      found.add('revisions of one coordinate from two relays');
  }
  return found;
}

/**
 * The value meetings a sweep must reach, beside its arrangements: each pair in
 * {@link STRING_PAIRS} as the `d` values of two revisions of one author's
 * addressable kind, and an empty `d` followed by a named one beside another
 * revision. An arrangement reached with values that never differ by the one
 * thing a careless reader folds shows nothing about that reader — which is how
 * a change to the draws once lost kills the arrangement counters kept.
 */
export const MEETINGS: readonly string[] = [
  ...STRING_PAIRS.map(([a, b]) => `d pair ${JSON.stringify(a)} | ${JSON.stringify(b)}`),
  'd empty then named, beside another revision'
];

/** Which {@link MEETINGS} `events` reach. */
export function meetingsOf(events: readonly Revision[]): Set<string> {
  const found = new Set<string>();
  const groups = new Map<string, Revision[]>();
  for (const event of events) {
    if (!isAddressable(event.kind)) continue;
    const key = `${event.kind}:${event.pubkey}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const firstD = (event: Revision): string | undefined =>
    event.tags.find(([name]) => name === 'd')?.[1];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const values = new Set(group.map(firstD).filter((value) => value !== undefined));
    for (const [a, b] of STRING_PAIRS)
      if (values.has(a) && values.has(b))
        found.add(`d pair ${JSON.stringify(a)} | ${JSON.stringify(b)}`);
    if (
      group.some((event) => {
        const ds = event.tags.filter(([name]) => name === 'd');
        return ds.length > 1 && ds[0]?.[1] === '' && ds[1]?.[1] !== '';
      })
    )
      found.add('d empty then named, beside another revision');
  }
  return found;
}
