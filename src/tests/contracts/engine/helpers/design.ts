/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The inputs the event-set landings are run on, **enumerated rather than
 * sampled**, and the catalogue of foldings their domains are checked against.
 *
 * **Why enumerated.** Eight rounds of review found gaps in arms that drew
 * their inputs at random, and the gaps came in three kinds, each a property of
 * sampling rather than of any one draw:
 *
 * - a kill held only by whatever a seed happened to draw, and lost when the
 *   draws changed (twice), or held by one landing and not its sibling;
 * - two dimensions that moved together in the draws, so one stood in for the
 *   other (an id's order and its recency, a pubkey and its last digits);
 * - counters added to certify what the draws reached, which then certified
 *   less than their labels said.
 *
 * So every case here changes **one dimension** of a base event and nothing
 * else — a minimal pair — and every case is run, every time. Coverage is a
 * property of this file, not of a seed: what is not listed here is not tested,
 * and that is visible by reading it.
 *
 * **Why a catalogue of foldings.** The other kind of gap was a value the
 * domain never took — a case, a Unicode form, a line ending, a negative time —
 * found one at a time. What those values have in common is a transformation a
 * careless reader applies and the exact comparison in `RULES` does not:
 * case-folding, normalising, trimming, truncating, reading a number as a
 * string. {@link FOLDS} lists those transformations per domain, and the
 * landing `ES29` checks that each domain holds a pair the folding merges, or an
 * order it breaks. A transformation found next is one line here, and that arm
 * then refuses a domain that cannot show it.
 */
import type Nostr from 'nostr-typedef';

/** `length` hex digits of `digit`. */
const run = (digit: string, length: number): string => digit.repeat(length);

/**
 * 64-digit lowercase hex values, in pairs that differ in exactly one digit —
 * the first, one in the middle, the last — so no prefix, suffix or slice of
 * the value can stand in for the whole of it.
 */
export const HEX_PAIRS: readonly (readonly [string, string])[] = [
  [`1${run('a', 63)}`, `2${run('a', 63)}`],
  [`${run('a', 31)}1${run('a', 32)}`, `${run('a', 31)}2${run('a', 32)}`],
  [`${run('a', 63)}1`, `${run('a', 63)}2`]
];

/**
 * Strings in pairs that differ by one thing a careless reader folds: case,
 * Unicode's composed and decomposed forms, compatibility forms, surrounding,
 * inner and line-ending whitespace, a prefix, a suffix, the part after a colon,
 * and an empty value against a named one.
 */
export const STRING_PAIRS: readonly (readonly [string, string])[] = [
  ['s', 'S'],
  ['é', 'é'],
  ['ｄ', 'd'],
  ['ﬁ', 'fi'],
  ['s', ' s'],
  ['s', 's '],
  ['s x', 's  x'],
  ['s\tx', 's x'],
  ['a\r\nb', 'a\nb'],
  ['abcd1', 'abcd2'],
  ['1wxyz', '2wxyz'],
  ['s:x', 's:y'],
  ['', 's']
];

/**
 * Tag names that are not `d` and that a careless reader takes for it: another
 * case, padding, and the compatibility form of the letter.
 */
export const D_LOOKALIKES = ['D', ' d ', 'd ', 'ｄ'] as const;

/**
 * `created_at` values in ascending order: negative, zero, small, across a
 * change of digit count, across 2^31 and 2^32, and across 2^53 — every finite
 * number ingestion accepts is in the domain, since NIP-01 gives no bound.
 */
export const INSTANTS = [
  -2,
  -1,
  0,
  1,
  9,
  10,
  99,
  100,
  2 ** 31 - 1,
  2 ** 31,
  2 ** 32 - 1,
  2 ** 32,
  2 ** 53 - 1,
  2 ** 53,
  2 ** 60
] as const;

/** A transformation a careless reader applies, and the domain it is checked against. */
export type Fold =
  | {
      readonly name: string;
      readonly domain: 'identifier string' | 'payload string' | 'tag name' | 'hex';
      readonly apply: (value: string) => string;
    }
  | {
      readonly name: string;
      readonly domain: 'instant';
      readonly key: (value: number) => number | string;
    };

/**
 * The catalogue. For an identifier domain, a folding is shown by a pair it
 * merges; for a payload domain, by a value it changes; for instants, by an
 * ordered pair whose order it breaks.
 */
export const FOLDS: readonly Fold[] = [
  ...(['identifier string', 'payload string'] as const).flatMap((domain) => [
    { name: 'lower case', domain, apply: (value: string) => value.toLowerCase() },
    { name: 'upper case', domain, apply: (value: string) => value.toUpperCase() },
    { name: 'trim', domain, apply: (value: string) => value.trim() },
    { name: 'trim start', domain, apply: (value: string) => value.trimStart() },
    { name: 'trim end', domain, apply: (value: string) => value.trimEnd() },
    { name: 'NFC', domain, apply: (value: string) => value.normalize('NFC') },
    { name: 'NFD', domain, apply: (value: string) => value.normalize('NFD') },
    { name: 'NFKC', domain, apply: (value: string) => value.normalize('NFKC') },
    { name: 'NFKD', domain, apply: (value: string) => value.normalize('NFKD') },
    { name: 'collapse whitespace', domain, apply: (value: string) => value.replace(/\s+/g, ' ') },
    { name: 'CRLF to LF', domain, apply: (value: string) => value.replace(/\r\n/g, '\n') },
    { name: 'first four', domain, apply: (value: string) => value.slice(0, 4) },
    { name: 'last four', domain, apply: (value: string) => value.slice(-4) },
    { name: 'before a colon', domain, apply: (value: string) => value.split(':')[0] ?? '' }
  ]),
  { name: 'lower case', domain: 'tag name', apply: (value) => value.toLowerCase() },
  { name: 'trim', domain: 'tag name', apply: (value) => value.trim() },
  { name: 'NFKC', domain: 'tag name', apply: (value) => value.normalize('NFKC') },
  { name: 'first eight', domain: 'hex', apply: (value) => value.slice(0, 8) },
  { name: 'last four', domain: 'hex', apply: (value) => value.slice(-4) },
  { name: 'all but the first', domain: 'hex', apply: (value) => value.slice(1) },
  { name: 'all but the last', domain: 'hex', apply: (value) => value.slice(0, -1) },
  { name: 'first half', domain: 'hex', apply: (value) => value.slice(0, 32) },
  { name: 'as a string', domain: 'instant', key: (value) => String(value) },
  { name: 'absolute', domain: 'instant', key: (value) => Math.abs(value) },
  { name: 'signed 32-bit', domain: 'instant', key: (value) => value | 0 },
  { name: 'unsigned 32-bit', domain: 'instant', key: (value) => value >>> 0 },
  {
    name: 'clamped to the safe integers',
    domain: 'instant',
    key: (value) => Math.min(value, Number.MAX_SAFE_INTEGER)
  },
  { name: 'zero as absent', domain: 'instant', key: (value) => (value === 0 ? -Infinity : value) },
  { name: 'read as milliseconds', domain: 'instant', key: (value) => Math.trunc(value / 1000) }
];

/** What each fold's domain holds: identifier and payload strings, tag names, hex, instants. */
export const DOMAINS = {
  'identifier string': STRING_PAIRS,
  'payload string': STRING_PAIRS,
  'tag name': D_LOOKALIKES.map((name) => ['d', name] as const),
  hex: HEX_PAIRS
} as const;

/** One case: events whose fold the oracle decides, and what changed between them. */
export interface Case {
  readonly label: string;
  readonly events: readonly Partial<Nostr.Event>[];
  /** Whether the events share one coordinate, as the dimension changed implies. */
  readonly sameCoordinate: boolean;
}

const BASE_ID = HEX_PAIRS[0]?.[0] as string;
const BASE_AUTHOR = HEX_PAIRS[1]?.[0] as string;
const BASE_SIG = `${run('5', 128)}`;

/** A base event of `kind`, with every field at a fixed value. */
export function base(kind: number, overrides: Partial<Nostr.Event> = {}): Partial<Nostr.Event> {
  return {
    id: BASE_ID,
    kind,
    pubkey: BASE_AUTHOR,
    created_at: 10,
    content: 'content',
    sig: BASE_SIG,
    tags: kind >= 30000 && kind < 40000 ? [['d', 's']] : [],
    ...overrides
  };
}

/** An id distinct from every other in a case, built from `seed` without relating it to recency. */
const idFor = (seed: string): string => `${seed}${run('0', 64 - seed.length)}`;

/** Kinds in each class with a coordinate, at the edges of the range and inside it. */
const REPLACEABLE = [0, 3, 10000, 10002, 19999] as const;
const ADDRESSABLE = [30000, 30023, 39999] as const;
const REGULAR = [1, 2, 4, 44, 45, 999, 1000, 9999, 40000, 65535] as const;

/**
 * The minimal pairs the identity and recency rules are run on. Each changes
 * one dimension of a base event; its `sameCoordinate` is what the dimension's
 * role in the rules implies, stated here independently of the oracle so the
 * oracle is checked too.
 */
export function minimalPairs(): Case[] {
  const cases: Case[] = [];
  const withIds = (
    older: Partial<Nostr.Event>,
    newer: Partial<Nostr.Event>,
    idOrder: 'up' | 'down'
  ) => {
    const [a, b] = idOrder === 'up' ? ['1', '2'] : ['2', '1'];
    return [
      { ...older, id: idFor(`${a}0`), created_at: 10 },
      { ...newer, id: idFor(`${b}0`), created_at: 20 }
    ];
  };
  for (const idOrder of ['up', 'down'] as const) {
    // Kind: two kinds of one class are two coordinates.
    for (const [x, y] of [
      [0, 3],
      [0, 10000],
      [3, 10002],
      [10000, 19999],
      [10002, 19999],
      [30000, 30023],
      [30023, 39999],
      [0, 30000]
    ] as const)
      cases.push({
        label: `kind ${x} / ${y} (${idOrder})`,
        events: withIds(base(x), base(y), idOrder),
        sameCoordinate: false
      });
    for (const kind of [...REPLACEABLE, ...ADDRESSABLE]) {
      // Author: two authors are two coordinates, whichever digit differs.
      for (const [at, [x, y]] of HEX_PAIRS.entries())
        cases.push({
          label: `kind ${kind}, authors differing at one digit (pair ${at}) (${idOrder})`,
          events: withIds(base(kind, { pubkey: x }), base(kind, { pubkey: y }), idOrder),
          sameCoordinate: false
        });
      // Fields the coordinate does not read: one coordinate, the newer kept whole.
      const payload: [string, Partial<Nostr.Event>, Partial<Nostr.Event>][] = [
        ...STRING_PAIRS.map(([x, y]): [string, Partial<Nostr.Event>, Partial<Nostr.Event>] => [
          `content ${JSON.stringify(x)} / ${JSON.stringify(y)}`,
          { content: x },
          { content: y }
        ]),
        ...HEX_PAIRS.map(([x, y]): [string, Partial<Nostr.Event>, Partial<Nostr.Event>] => [
          `sig differing at one digit`,
          { sig: `${x}${x}` },
          { sig: `${y}${y}` }
        ]),
        ['a one-element tag', {}, { tags: [...(base(kind).tags ?? []), ['client']] }],
        [
          'an unrelated tag with extra elements',
          { tags: [...(base(kind).tags ?? []), ['t', 'x']] },
          { tags: [...(base(kind).tags ?? []), ['t', 'y', 'z']] }
        ]
      ];
      for (const [label, older, newer] of payload)
        cases.push({
          label: `kind ${kind}, ${label} (${idOrder})`,
          events: withIds(base(kind, older), base(kind, newer), idOrder),
          sameCoordinate: true
        });
    }
    for (const kind of REPLACEABLE) {
      // A `d` tag is not part of a replaceable coordinate.
      for (const [x, y] of STRING_PAIRS)
        cases.push({
          label: `kind ${kind}, d ${JSON.stringify(x)} / ${JSON.stringify(y)} (${idOrder})`,
          events: withIds(
            base(kind, { tags: [['d', x]] }),
            base(kind, { tags: [['d', y]] }),
            idOrder
          ),
          sameCoordinate: true
        });
    }
    for (const kind of ADDRESSABLE) {
      // The `d` value is part of an addressable coordinate, read exactly.
      for (const [x, y] of STRING_PAIRS)
        cases.push({
          label: `kind ${kind}, d ${JSON.stringify(x)} / ${JSON.stringify(y)} (${idOrder})`,
          events: withIds(
            base(kind, { tags: [['d', x]] }),
            base(kind, { tags: [['d', y]] }),
            idOrder
          ),
          sameCoordinate: false
        });
      // The `d` tag's shape: the first `d` decides; none, a value-less one and
      // an empty one are the empty value; a name that only looks like `d` is
      // not one.
      const shapes: [string, string[][], string[][], boolean][] = [
        ['none / empty', [], [['d', '']], true],
        ['value-less / empty', [['d']], [['d', '']], true],
        ['value-less then named / empty', [['d'], ['d', 's']], [['d', '']], true],
        [
          'two, first s / s',
          [
            ['d', 's'],
            ['d', 't']
          ],
          [['d', 's']],
          true
        ],
        [
          'empty then named / named',
          [
            ['d', ''],
            ['d', 's']
          ],
          [['d', 's']],
          false
        ],
        ['extra elements / plain', [['d', 's', 'm']], [['d', 's']], true],
        ...D_LOOKALIKES.map((name): [string, string[][], string[][], boolean] => [
          `${JSON.stringify(name)} before d / d`,
          [
            [name, 'x'],
            ['d', 's']
          ],
          [['d', 's']],
          true
        ]),
        ...D_LOOKALIKES.map((name): [string, string[][], string[][], boolean] => [
          `${JSON.stringify(name)} alone / d s`,
          [[name, 's']],
          [['d', 's']],
          false
        ]),
        ['d after two other tags / d', [['t', 'x'], ['client'], ['d', 's']], [['d', 's']], true]
      ];
      for (const [label, x, y, same] of shapes)
        cases.push({
          label: `kind ${kind}, d tags ${label} (${idOrder})`,
          events: withIds(base(kind, { tags: x }), base(kind, { tags: y }), idOrder),
          sameCoordinate: same
        });
    }
  }
  // Regular kinds: no coordinate beyond the event, whatever else they share.
  for (const kind of REGULAR)
    for (const [x, y] of HEX_PAIRS)
      cases.push({
        label: `kind ${kind}, two events`,
        events: [base(kind, { id: x }), base(kind, { id: y, created_at: 20 })],
        sameCoordinate: false
      });
  // Recency: every ordered pair of instants, with the ids in both orders, and
  // equal instants with ids differing at one digit.
  for (const kind of [0, 30023] as const) {
    for (let older = 0; older < INSTANTS.length; older += 1)
      for (let newer = older + 1; newer < INSTANTS.length; newer += 1)
        for (const [lowId, highId] of [
          ['1', '2'],
          ['2', '1']
        ] as const)
          cases.push({
            label: `kind ${kind}, ${INSTANTS[older]} then ${INSTANTS[newer]}`,
            events: [
              base(kind, { id: idFor(lowId), created_at: INSTANTS[older] as number }),
              base(kind, { id: idFor(highId), created_at: INSTANTS[newer] as number })
            ],
            sameCoordinate: true
          });
    for (const instant of [-1, 0, 10, 2 ** 53] as const)
      for (const [x, y] of HEX_PAIRS)
        cases.push({
          label: `kind ${kind}, tie at ${instant}`,
          events: [
            base(kind, { id: x, created_at: instant }),
            base(kind, { id: y, created_at: instant })
          ],
          sameCoordinate: true
        });
  }
  // **Both directions of every pair.** Each case above makes one side the
  // older; the swap keeps the ids and instants where they are and exchanges
  // everything else, so whatever the dimension changed is carried by the
  // winner once and by the superseded revision once. Built one way only, a
  // fold that dropped a value-less `d` from what it stores went unseen,
  // because the value-less side was always the one superseded.
  const swapped = cases.map(({ label, events, sameCoordinate }) => {
    const [first, second] = events as [Partial<Nostr.Event>, Partial<Nostr.Event>];
    return {
      label: `${label}, swapped`,
      events: [
        { ...second, id: first.id as string, created_at: first.created_at as number },
        { ...first, id: second.id as string, created_at: second.created_at as number }
      ],
      sameCoordinate
    } satisfies Case;
  });
  return [...cases, ...swapped];
}

/**
 * A regular competitor for a bound, placed against a superseded revision and
 * its winner by `created_at` — newer than both, between, older than both, or
 * tying either — with contents that run against its id in both directions,
 * and, for `B5-C5`, an expiry that the clock crosses between arrivals.
 */
export function competitorsFor(
  superseded: Partial<Nostr.Event>,
  winner: Partial<Nostr.Event>,
  { expiring = false }: { expiring?: boolean } = {}
): Partial<Nostr.Event>[] {
  const older = superseded.created_at as number;
  const newer = winner.created_at as number;
  const instants = new Set<number>([newer + 1, older - 1, newer, older]);
  if (newer - older > 1) instants.add(older + 1);
  // Ids below both revisions', between them, and above both — a bound that
  // ranks a tie by id the wrong way keeps the competitor over the winner only
  // when the competitor's id sits between the two.
  const [low, high] = [superseded.id as string, winner.id as string].sort();
  const ids = ['!', `${low as string}0`, `${high as string}~`];
  const out: Partial<Nostr.Event>[] = [];
  for (const created_at of instants)
    for (const [at, id] of ids.entries())
      out.push(
        base(1, {
          id,
          created_at,
          content: ['m', 'z', 'a'][at] as string,
          tags: expiring ? [['expiration', '500']] : []
        })
      );
  return out;
}

/**
 * The fields a bound's ranking might wrongly read, assigned across a trio so
 * that their order runs against the ids' — for a winner and a superseded
 * revision that tie on `created_at`, where the bound's tie-break decides which
 * entry keeps the slot. Each variant overrides one field on all three events;
 * the first is no override.
 */
export function rankingVariants(): readonly (readonly [
  Partial<Nostr.Event>,
  Partial<Nostr.Event>,
  Partial<Nostr.Event>
])[] {
  const out: [Partial<Nostr.Event>, Partial<Nostr.Event>, Partial<Nostr.Event>][] = [[{}, {}, {}]];
  for (const field of ['content', 'sig'] as const)
    for (const [w, l, c] of [
      ['z', 'a', 'm'],
      ['a', 'z', 'm']
    ] as const)
      out.push([{ [field]: w }, { [field]: l }, { [field]: c }]);
  return out;
}

/** Every order of `items`. */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest])
  );
}
