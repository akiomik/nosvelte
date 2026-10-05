/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The rules the canonical event set follows, and the domain its inputs are
 * drawn from, each with where it comes from: a sentence of NIP-01, or a
 * decision this library recorded (in 0003, and in 0002 for `ots`) where NIP-01
 * says nothing.
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

import { COORDINATE_KINDS, D_LOOKALIKES, INSTANTS, REGULAR, STRING_PAIRS } from './design.js';

/** Where a rule or a domain comes from. */
export type Source =
  | { readonly from: 'NIP-01'; readonly says: string }
  | { readonly from: '0002' | '0003'; readonly decides: string };

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
    rule: 'a d tag with no value is the empty value',
    source: {
      from: '0003',
      decides:
        'the same identifier as a missing or empty d, so a tag shape does not split a coordinate'
    }
  },
  {
    rule: 'two packets with one id are one event: the first one folded is kept whole, and a later one changes nothing',
    source: {
      from: '0003',
      decides:
        'the id commits to every field the rules read but not to sig (BIP-340 admits several valid signatures for one id) nor ots; keeping the first makes such a packet a replay (B5-C3)'
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

/**
 * The fields NIP-01 serializes to compute an event's id — everything the id
 * commits to: "[0, <pubkey, as a lowercase hex string>, <created_at, as a
 * number>, <kind, as a number>, <tags, as an array of arrays of non-null
 * strings>, <content, as a string>]".
 */
export const SERIALIZED = ['pubkey', 'created_at', 'kind', 'tags', 'content'] as const;

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

/**
 * Of a held revision `a` and an arriving `b` of one coordinate, the one
 * {@link RULES} keep: the later, on a tie the lower id, and of one id the held.
 */
export function newerOf<T extends Pick<Revision, 'created_at' | 'id'>>(a: T, b: T): T {
  if (a.id === b.id) return a;
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

const STRINGS = [...new Set(STRING_PAIRS.flat())];

/**
 * One field of an event: its domain in NIP-01, how the rules compare it, and
 * what each instrument puts in it — the enumerated design (`design.ts`, which
 * the landings' coverage rests on) and the seeded sweep beside it (which claims
 * none). The two are separate columns because they reach different values.
 */
export interface Field {
  readonly field: keyof Nostr.Event | 'tag name' | 'tag value' | 'd value' | 'tag shape';
  readonly domain: Source;
  readonly comparison: string;
  readonly enumerated: string;
  readonly swept: string;
}

/**
 * The domain of each field, from NIP-01, beside what the design and the sweep
 * put in it. **The values are synthetic**: ids and signatures are not hashes
 * and signatures of the events, pubkeys need not be curve points, and the
 * design's competitors and ranking variants use sentinel values (an id of all
 * `0` or all `f`, a one-letter content or tag name) chosen for their order,
 * because the seam under test is the fold, after verification — which `B5`'s
 * other rows and 0002 own. The table says so rather than calling them valid
 * events.
 */
export const FIELDS: readonly Field[] = [
  {
    field: 'id',
    domain: {
      from: 'NIP-01',
      says: '32-bytes lowercase hex-encoded sha256 of the serialized event data'
    },
    comparison: 'exact, and lexical for the tie',
    enumerated:
      '64 hex digits: pairs differing at the first, a middle or the last digit, and one differing at the first and last in opposite directions (HEX_PAIRS); ids in both orders against recency; two packets of one id; and for a competitor all-0, the midpoint and all-f',
    swept: '64 hex digits sharing a 56-digit prefix, in no relation to recency'
  },
  {
    field: 'pubkey',
    domain: {
      from: 'NIP-01',
      says: '32-bytes lowercase hex-encoded public key of the event creator'
    },
    comparison: 'exact',
    enumerated:
      '64 hex digits, in pairs differing at the first, a middle or the last digit, and one at the first and last in opposite directions (HEX_PAIRS)',
    swept: 'two authors per draw, 64 hex digits sharing a 60-digit prefix'
  },
  {
    field: 'created_at',
    domain: {
      from: 'NIP-01',
      says: 'unix timestamp in seconds — neither a bound nor whole seconds is stated; ingestion accepts any finite number (event.ts)'
    },
    comparison: 'numeric order',
    enumerated:
      'every ordered pair of design.ts INSTANTS (negative and negative fractional, zero, small, fractional down to below a millisecond, across 2^31, 2^32 and 2^53, and 2^60), ties at five of them, and for a competitor the representable number above, below and between',
    swept: 'one of design.ts INSTANTS'
  },
  {
    field: 'kind',
    domain: { from: 'NIP-01', says: 'integer between 0 and 65535' },
    comparison: 'by class, and the exact kind is part of every coordinate',
    enumerated:
      'every kind with a coordinate in design.ts (0, 3, 10000, 10002, 19999, 30000, 30023, 39999) across every dimension, and the regular kinds at every edge and unclassified (1 2 4 44 45 999 1000 9999 40000 65535)',
    swept:
      'the same kinds, a few per draw, and 20000 and 29999 where ephemeral events are asked for'
  },
  {
    field: 'tag shape',
    domain: { from: 'NIP-01', says: 'Each tag is an array of one or more strings' },
    comparison: 'the first element is the name',
    enumerated:
      'one-element tags, tags with extra elements up to ten (an unrelated tag, and the `d` tag after its value), the `d` tag after two others, two `d` tags in both orders of their values, three whose first is neither the smallest, the largest nor the last, a value-less `d`',
    swept:
      'zero to three unrelated tags of one, two or three elements, then no `d`, one `d`, one with an extra element, two, an empty then a named one, or a value-less one, and sometimes one more unrelated tag after them — not the ten-element tags nor the three-`d` shape'
  },
  {
    field: 'tag name',
    domain: { from: 'NIP-01', says: 'arbitrary string arrays' },
    comparison: 'exact',
    enumerated:
      "`d`, and D_LOOKALIKES (another case, padding on either side, the compatibility form, a part after a colon or a NUL, a percent-escape, a character outside the BMP after it, it as a JSON string, and it followed by each character NIP-01's serialization escapes) before and instead of it; every string fold applies to tag names unless NOT_FOR_TAG_NAMES exempts it; and, since a name is carried as well as read, both members of every STRING_PAIRS pair as an unrelated tag's name",
    swept: 'D_LOOKALIKES and two unrelated names'
  },
  {
    field: 'd value',
    domain: { from: 'NIP-01', says: 'arbitrary string arrays' },
    comparison:
      'exact; the first d tag decides, and none, a value-less one and an empty one are the empty value (0003)',
    enumerated: 'both members of every STRING_PAIRS pair, absent, value-less, and empty',
    swept: 'one STRING_PAIRS pair in focus per draw, and any string in STRING_PAIRS'
  },
  {
    field: 'tag value',
    domain: { from: 'NIP-01', says: 'arbitrary string arrays' },
    comparison: 'not read by the rules',
    enumerated:
      "both members of every STRING_PAIRS pair as an unrelated tag's value, the element after it and its tenth element, and as the `d` tag's third and tenth elements",
    swept: 'every string in STRING_PAIRS, as the second or third element'
  },
  {
    field: 'content',
    domain: {
      from: 'NIP-01',
      says: 'arbitrary string — and for kind 0, a stringified JSON object of metadata'
    },
    comparison: 'not read by the rules; carried whole',
    enumerated:
      "both members of every STRING_PAIRS pair, for every kind with a coordinate and every regular kind — JSON strings and objects among them, and each character NIP-01's serialization escapes. Kind 0 gets the same strings as every kind, so its metadata form is represented by the JSON objects, not by metadata documents",
    swept: 'strings from STRING_PAIRS around six hex digits, independent of the id'
  },
  {
    field: 'sig',
    domain: { from: 'NIP-01', says: '64-bytes lowercase hex of the signature' },
    comparison: 'not read by the rules; carried whole',
    enumerated:
      '128 hex digits: a HEX_PAIRS value written twice, so two signatures differ at two or four digits, between revisions and between two packets of one id; and all-0, all-8 and all-f in the ranking variants',
    swept: '128 hex digits, independent of every other field'
  },
  {
    field: 'ots',
    domain: {
      from: '0002',
      decides:
        'not a NIP-01 field: "plus `ots` when the wire carried one — deprecated in `nostr-typedef`, still sent, and a field a consumer can render, so dropping it would silently change what they see"'
    },
    comparison: 'not read by the rules; carried whole',
    enumerated:
      'absent against present, and both members of every STRING_PAIRS pair, between revisions and between two packets of one id',
    swept: 'absent, or any string in STRING_PAIRS'
  }
];

/** The kinds the sweep draws from: the design's, so the two never disagree. */
const KINDS = [...COORDINATE_KINDS, ...REGULAR] as const;

/** The sweep's tag names that are not `d`: the design's lookalikes, and two unrelated names. */
const OTHER_NAMES = [...D_LOOKALIKES, 'title', 'client'] as const;

/** Whether {@link RULES} keep an event of `kind` as itself. */
const isRegular = (kind: number): boolean =>
  !isReplaceable(kind) && !isAddressable(kind) && !isEphemeral(kind);

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
    else if (dShape < 0.84) tags.push(['d', dValue()], ['d', dValue()]);
    else if (dShape < 0.92) tags.push(['d', ''], ['d', dValue()]);
    else tags.push(['d']);
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
      tags,
      ...(rand() < 0.3 ? { ots: pick(rand, STRINGS) } : {})
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
      // An expiry is drawn for regular events only (`B5-C5`), so it goes
      // with the kind it was drawn for.
      event.tags = [
        ...(event.tags ?? []).filter(([name]) => name !== 'd' && name !== 'expiration'),
        ...d
      ];
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
