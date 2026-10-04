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
 * **Why crossed, and checked.** The ninth round found the same gap one level
 * up: the cases were a union of products chosen by hand — ties built for two
 * kinds only, ranking variants over two of the three payload fields — and a
 * kind or a field left out of one product was invisible beside the others. So
 * each case now names where it sits on the design's axes (its kinds, how its
 * two `created_at` relate, the dimension it changes, and its direction), the
 * axes are lists here, every dimension is built at every relation and in both
 * directions over every kind {@link CROSSINGS} names, and `ES29` refuses a
 * design in which any of those crossings has no case. Every field of an event
 * has a role in {@link FIELD_ROLES}, and every payload field is a dimension
 * and a ranking variant, so a field cannot be left out of either silently.
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
 * the value can stand in for the whole of it; and one pair that differs at the
 * first and the last digit in opposite directions, so an order read from any
 * position but the first disagrees with the true one.
 */
export const HEX_PAIRS: readonly (readonly [string, string])[] = [
  [`1${run('a', 63)}`, `2${run('a', 63)}`],
  [`${run('a', 31)}1${run('a', 32)}`, `${run('a', 31)}2${run('a', 32)}`],
  [`${run('a', 63)}1`, `${run('a', 63)}2`],
  [`1${run('a', 62)}2`, `2${run('a', 62)}1`]
];

/**
 * Strings in pairs that differ by one thing a careless reader folds: case,
 * Unicode's composed and decomposed forms, compatibility forms, surrounding,
 * inner and line-ending whitespace, a prefix, a suffix, the part after a colon,
 * a number's spelling, a percent-escape, the part after a NUL, a plus read as
 * a space, and an empty value against a named one.
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
  ['01', '1'],
  ['%73', 's'],
  ['s\0x', 's'],
  ['a+b', 'a b'],
  ['', 's']
];

/**
 * Tag names that are not `d` and that a careless reader takes for it: another
 * case, padding, and the compatibility form of the letter.
 */
export const D_LOOKALIKES = ['D', ' d ', 'd ', 'ｄ'] as const;

/**
 * `created_at` values in ascending order: negative, zero, small, fractional,
 * across a change of digit count, across 2^31 and 2^32, and across 2^53 —
 * every finite number ingestion accepts is in the domain, since NIP-01 states
 * neither a bound nor that the seconds are whole.
 */
export const INSTANTS = [
  -2,
  -1,
  0,
  1,
  9,
  10,
  10.25,
  10.5,
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
    }
  | {
      readonly name: string;
      readonly domain: 'hex order';
      readonly key: (value: string) => string;
    }
  | {
      readonly name: string;
      readonly domain: 'd selection';
      readonly select: (tags: readonly (readonly string[])[]) => string;
    };

/** The `d` values of `tags`, in order; a value-less one reads as empty. */
const dValues = (tags: readonly (readonly string[])[]): string[] =>
  tags.filter(([name]) => name === 'd').map((tag) => tag[1] ?? '');

/** The `d` value the rules read: the first (0003). */
export const firstD = (tags: readonly (readonly string[])[]): string => dValues(tags)[0] ?? '';

/** A percent-decoding reader, which leaves a value it cannot decode as it is. */
function uriDecoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The catalogue. For an identifier domain, a folding is shown by a pair it
 * merges; for a payload domain, by a value it changes; for instants and for
 * hex read as an order, by an ordered pair whose order it breaks; for the
 * choice among several `d` tags, by a pair of tag lists whose coordinate it
 * judges differently from the first `d`.
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
    { name: 'before a colon', domain, apply: (value: string) => value.split(':')[0] ?? '' },
    {
      name: 'as a number',
      domain,
      apply: (value: string) =>
        value.trim() !== '' && Number.isFinite(Number(value)) ? String(Number(value)) : value
    },
    { name: 'URI-decoded', domain, apply: uriDecoded },
    { name: 'before a NUL', domain, apply: (value: string) => value.split('\0')[0] ?? '' },
    { name: 'plus as a space', domain, apply: (value: string) => value.replace(/\+/g, ' ') }
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
  { name: 'read as milliseconds', domain: 'instant', key: (value) => Math.trunc(value / 1000) },
  { name: 'floor', domain: 'instant', key: (value) => Math.floor(value) },
  { name: 'ceiling', domain: 'instant', key: (value) => Math.ceil(value) },
  { name: 'rounded', domain: 'instant', key: (value) => Math.round(value) },
  { name: 'truncated', domain: 'instant', key: (value) => Math.trunc(value) },
  {
    name: 'bytes reversed',
    domain: 'hex order',
    key: (value) => (value.match(/../g) ?? []).reverse().join('')
  },
  { name: 'digits reversed', domain: 'hex order', key: (value) => [...value].reverse().join('') },
  {
    name: 'halves exchanged',
    domain: 'hex order',
    key: (value) => value.slice(32) + value.slice(0, 32)
  },
  { name: 'the last', domain: 'd selection', select: (tags) => dValues(tags).at(-1) ?? '' },
  { name: 'the smallest', domain: 'd selection', select: (tags) => dValues(tags).sort()[0] ?? '' },
  {
    name: 'the largest',
    domain: 'd selection',
    select: (tags) => dValues(tags).sort().at(-1) ?? ''
  },
  { name: 'all joined', domain: 'd selection', select: (tags) => dValues(tags).join(',') }
];

/** What each fold's domain holds: identifier and payload strings, tag names, hex, instants. */
export const DOMAINS = {
  'identifier string': STRING_PAIRS,
  'payload string': STRING_PAIRS,
  'tag name': D_LOOKALIKES.map((name) => ['d', name] as const),
  hex: HEX_PAIRS
} as const;

/** Kinds in each class with a coordinate, at the edges of the range and inside it. */
export const REPLACEABLE = [0, 3, 10000, 10002, 19999] as const;
export const ADDRESSABLE = [30000, 30023, 39999] as const;
export const COORDINATE_KINDS = [...REPLACEABLE, ...ADDRESSABLE] as const;
/** Regular kinds at the edges of NIP-01's ranges, and kinds it leaves unclassified. */
export const REGULAR = [1, 2, 4, 44, 45, 999, 1000, 9999, 40000, 65535] as const;

/** How a case's two `created_at` relate: one newer, or a tie the ids decide. */
export const RELATIONS = ['newer', 'tie'] as const;
export type Relation = (typeof RELATIONS)[number];

/** A case as built, or with everything but the ids and instants exchanged. */
export const DIRECTIONS = ['as built', 'swapped'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * The fields of an event the rules keep but never read — `ots` among them,
 * which NIP-01 does not name and ingestion carries when it is a string.
 */
export const PAYLOAD_FIELDS = ['content', 'sig', 'tags', 'ots'] as const;

/**
 * Every field of an event, by the role the rules give it: the coordinate, the
 * ranking between revisions, or the payload carried whole. `tags` is both — its
 * `d` is part of an addressable coordinate, and the rest is payload. And
 * **outside the id**: the id is the hash of every other field but `sig` and
 * `ots`, so two packets can share an id and differ in those — BIP-340 admits
 * several valid signatures for one id. Which is kept is a decision (0003).
 */
export const FIELD_ROLES = {
  id: ['ranking'],
  created_at: ['ranking'],
  kind: ['coordinate'],
  pubkey: ['coordinate'],
  tags: ['coordinate', 'payload'],
  content: ['payload'],
  sig: ['payload', 'outside the id'],
  ots: ['payload', 'outside the id']
} as const satisfies { readonly [K in keyof Nostr.Event]-?: readonly string[] };

/** The fields {@link FIELD_ROLES} puts outside the id. */
export const OUTSIDE_THE_ID = (
  Object.entries(FIELD_ROLES) as [keyof typeof FIELD_ROLES, readonly string[]][]
)
  .filter(([, roles]) => roles.includes('outside the id'))
  .map(([field]) => field);

/** The dimensions a case changes. */
export type Dimension =
  | 'kind'
  | 'author'
  | (typeof PAYLOAD_FIELDS)[number]
  | 'd value'
  | 'd shape'
  | 'instant'
  | 'regular'
  | 'same id';

/**
 * **The crossings the design promises**: each dimension, over each kind and at
 * each relation listed for it, in both directions. `ES29` refuses the design if
 * any one of these has no case. Two packets of one id tie by construction, so
 * `same id` is crossed with the tie alone, over every kind.
 */
export const CROSSINGS: {
  readonly [D in Dimension]: {
    readonly kinds: readonly number[];
    readonly relations: readonly Relation[];
  };
} = {
  kind: { kinds: COORDINATE_KINDS, relations: RELATIONS },
  author: { kinds: COORDINATE_KINDS, relations: RELATIONS },
  content: { kinds: COORDINATE_KINDS, relations: RELATIONS },
  sig: { kinds: COORDINATE_KINDS, relations: RELATIONS },
  tags: { kinds: COORDINATE_KINDS, relations: RELATIONS },
  ots: { kinds: COORDINATE_KINDS, relations: RELATIONS },
  'd value': { kinds: COORDINATE_KINDS, relations: RELATIONS },
  'd shape': { kinds: COORDINATE_KINDS, relations: RELATIONS },
  instant: { kinds: COORDINATE_KINDS, relations: RELATIONS },
  regular: { kinds: REGULAR, relations: RELATIONS },
  'same id': { kinds: [...COORDINATE_KINDS, ...REGULAR], relations: ['tie'] }
};

/** One case: events whose fold the oracle decides, and where it sits on the axes. */
export interface Case {
  readonly label: string;
  readonly events: readonly Partial<Nostr.Event>[];
  /** Whether the events share one coordinate, as the dimension changed implies. */
  readonly sameCoordinate: boolean;
  readonly dimension: Dimension;
  /** The kinds of the case's events. */
  readonly kinds: readonly number[];
  readonly relation: Relation;
  readonly direction: Direction;
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

const isReplaceableKind = (kind: number): boolean =>
  (REPLACEABLE as readonly number[]).includes(kind);

/** The `created_at` of a case's two events at `relation`. */
const instantsAt = (relation: Relation): readonly [number, number] =>
  relation === 'newer' ? [10, 20] : [10, 10];

/**
 * The minimal pairs the identity and recency rules are run on. Each changes
 * one dimension of a base event; its `sameCoordinate` is what the dimension's
 * role in the rules implies, stated here independently of the oracle so the
 * oracle is checked too.
 */
export function minimalPairs(): Case[] {
  const cases: Omit<Case, 'direction'>[] = [];
  const add = (
    dimension: Dimension,
    label: string,
    [older, newer]: readonly [Partial<Nostr.Event>, Partial<Nostr.Event>],
    sameCoordinate: boolean
  ) => {
    for (const relation of RELATIONS)
      for (const idOrder of ['up', 'down'] as const) {
        const [a, b] = idOrder === 'up' ? ['1', '2'] : ['2', '1'];
        const [first, second] = instantsAt(relation);
        cases.push({
          label: `${label} (${relation}, ids ${idOrder})`,
          events: [
            { ...older, id: idFor(`${a}0`), created_at: first },
            { ...newer, id: idFor(`${b}0`), created_at: second }
          ],
          sameCoordinate,
          dimension,
          kinds: [...new Set([older.kind as number, newer.kind as number])],
          relation
        });
      }
  };
  // Kind: two kinds with a coordinate are two coordinates, every pair of them.
  for (const [at, x] of COORDINATE_KINDS.entries())
    for (const y of COORDINATE_KINDS.slice(at + 1))
      add('kind', `kind ${x} / ${y}`, [base(x), base(y)], false);
  for (const kind of COORDINATE_KINDS) {
    // Author: two authors are two coordinates, whichever digit differs.
    for (const [at, [x, y]] of HEX_PAIRS.entries())
      add(
        'author',
        `kind ${kind}, authors differing at one digit (pair ${at})`,
        [base(kind, { pubkey: x }), base(kind, { pubkey: y })],
        false
      );
    // Fields the coordinate does not read: one coordinate, the winner kept whole.
    for (const [x, y] of STRING_PAIRS)
      add(
        'content',
        `kind ${kind}, content ${JSON.stringify(x)} / ${JSON.stringify(y)}`,
        [base(kind, { content: x }), base(kind, { content: y })],
        true
      );
    for (const [x, y] of HEX_PAIRS)
      add(
        'sig',
        `kind ${kind}, sig differing at one digit`,
        [base(kind, { sig: `${x}${x}` }), base(kind, { sig: `${y}${y}` })],
        true
      );
    const coordinateTags = base(kind).tags ?? [];
    add(
      'tags',
      `kind ${kind}, a one-element tag`,
      [base(kind), base(kind, { tags: [...coordinateTags, ['client']] })],
      true
    );
    add(
      'tags',
      `kind ${kind}, an unrelated tag with extra elements`,
      [
        base(kind, { tags: [...coordinateTags, ['t', 'x']] }),
        base(kind, { tags: [...coordinateTags, ['t', 'y', 'z']] })
      ],
      true
    );
    add('ots', `kind ${kind}, ots absent / present`, [base(kind), base(kind, { ots: 's' })], true);
    for (const [x, y] of STRING_PAIRS)
      add(
        'ots',
        `kind ${kind}, ots ${JSON.stringify(x)} / ${JSON.stringify(y)}`,
        [base(kind, { ots: x }), base(kind, { ots: y })],
        true
      );
    // The `d` value: part of an addressable coordinate, read exactly; not part
    // of a replaceable one.
    for (const [x, y] of STRING_PAIRS)
      add(
        'd value',
        `kind ${kind}, d ${JSON.stringify(x)} / ${JSON.stringify(y)}`,
        [base(kind, { tags: [['d', x]] }), base(kind, { tags: [['d', y]] })],
        isReplaceableKind(kind)
      );
    // The `d` tag's shape: the first `d` decides; none, a value-less one and
    // an empty one are the empty value; a name that only looks like `d` is
    // not one. For a replaceable kind, no shape is part of the coordinate.
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
      [
        'two, first t / t',
        [
          ['d', 't'],
          ['d', 's']
        ],
        [['d', 't']],
        true
      ],
      [
        'three, first m / m',
        [
          ['d', 'm'],
          ['d', 'z'],
          ['d', 'a']
        ],
        [['d', 'm']],
        true
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
      add(
        'd shape',
        `kind ${kind}, d tags ${label}`,
        [base(kind, { tags: x }), base(kind, { tags: y })],
        isReplaceableKind(kind) || same
      );
  }
  // Regular kinds: no coordinate beyond the event, whatever else they share.
  for (const kind of REGULAR)
    add('regular', `kind ${kind}, two events`, [base(kind), base(kind)], false);
  // Recency, for every kind with a coordinate: every ordered pair of instants
  // with the ids in both orders, and ties at instants across the domain with
  // ids differing at one digit.
  for (const kind of COORDINATE_KINDS) {
    for (let older = 0; older < INSTANTS.length; older += 1)
      for (let newer = older + 1; newer < INSTANTS.length; newer += 1)
        for (const [lowId, highId] of [
          ['1', '2'],
          ['2', '1']
        ] as const)
          cases.push({
            label: `kind ${kind}, ${INSTANTS[older]} then ${INSTANTS[newer]} (ids ${lowId}${highId})`,
            events: [
              base(kind, { id: idFor(lowId), created_at: INSTANTS[older] as number }),
              base(kind, { id: idFor(highId), created_at: INSTANTS[newer] as number })
            ],
            sameCoordinate: true,
            dimension: 'instant',
            kinds: [kind],
            relation: 'newer'
          });
    for (const instant of [-1, 0, 10, 10.25, 2 ** 53] as const)
      for (const [x, y] of HEX_PAIRS)
        cases.push({
          label: `kind ${kind}, tie at ${instant}`,
          events: [
            base(kind, { id: x, created_at: instant }),
            base(kind, { id: y, created_at: instant })
          ],
          sameCoordinate: true,
          dimension: 'instant',
          kinds: [kind],
          relation: 'tie'
        });
  }
  // **Two packets of one id**, for every kind: everything the id commits to
  // equal, and one field outside it different — another valid signature, or
  // another `ots`. They are one event, and the first to arrive is kept (0003).
  for (const kind of CROSSINGS['same id'].kinds) {
    const variants: [string, Partial<Nostr.Event>, Partial<Nostr.Event>][] = [
      ...HEX_PAIRS.map(([x, y]): [string, Partial<Nostr.Event>, Partial<Nostr.Event>] => [
        'another sig',
        { sig: `${x}${x}` },
        { sig: `${y}${y}` }
      ]),
      ['ots absent / present', {}, { ots: 's' }],
      ...STRING_PAIRS.map(([x, y]): [string, Partial<Nostr.Event>, Partial<Nostr.Event>] => [
        `ots ${JSON.stringify(x)} / ${JSON.stringify(y)}`,
        { ots: x },
        { ots: y }
      ])
    ];
    for (const [label, x, y] of variants)
      cases.push({
        label: `kind ${kind}, one id, ${label}`,
        events: [base(kind, x), base(kind, y)],
        sameCoordinate: true,
        dimension: 'same id',
        kinds: [kind],
        relation: 'tie'
      });
  }
  // **Both directions of every pair.** Each case above makes one side the
  // older; the swap keeps the ids and instants where they are and exchanges
  // everything else, so whatever the dimension changed is carried by the
  // winner once and by the superseded revision once. Built one way only, a
  // fold that dropped a value-less `d` from what it stores went unseen,
  // because the value-less side was always the one superseded.
  return DIRECTIONS.flatMap((direction) =>
    cases.map((built): Case => {
      if (direction === 'as built') return { ...built, direction };
      const [first, second] = built.events as [Partial<Nostr.Event>, Partial<Nostr.Event>];
      return {
        ...built,
        label: `${built.label}, swapped`,
        events: [
          { ...second, id: first.id as string, created_at: first.created_at as number },
          { ...first, id: second.id as string, created_at: second.created_at as number }
        ],
        direction
      };
    })
  );
}

const FLOAT = new DataView(new ArrayBuffer(8));

/** The representable number next to `value`, above it (`1`) or below it (`-1`). */
export function adjacent(value: number, direction: 1 | -1): number {
  if (value === 0) return direction * Number.MIN_VALUE;
  FLOAT.setFloat64(0, value);
  FLOAT.setBigInt64(0, FLOAT.getBigInt64(0) + (value > 0 === direction > 0 ? 1n : -1n));
  return FLOAT.getFloat64(0);
}

/** A 64-digit hex id strictly between `low` and `high`, or none where they are adjacent. */
const idBetween = (low: string, high: string): string | undefined => {
  const middle = (BigInt(`0x${low}`) + BigInt(`0x${high}`)) / 2n;
  const id = middle.toString(16).padStart(64, '0');
  return low < id && id < high ? id : undefined;
};

/**
 * A regular competitor for a bound, placed against a superseded revision and
 * its winner by `created_at` — at the representable instant above both, below
 * both, between them where one exists, and tying either — and, where it ties,
 * with an id below, between and above the pair's and contents that run against
 * those ids. For `B5-C5`, an expiry that the clock crosses between arrivals.
 * Each relation it claims is checked as it is built, since at large instants a
 * step of one second is no step at all.
 */
export function competitorsFor(
  superseded: Partial<Nostr.Event>,
  winner: Partial<Nostr.Event>,
  { expiring = false }: { expiring?: boolean } = {}
): Partial<Nostr.Event>[] {
  const older = superseded.created_at as number;
  const newer = winner.created_at as number;
  const [low, high] = [superseded.id as string, winner.id as string].sort() as [string, string];
  const placed: number[] = [
    adjacent(Math.max(older, newer), 1),
    adjacent(Math.min(older, newer), -1)
  ];
  const between = adjacent(older, 1);
  if (between < newer) placed.push(between);
  const ids = [run('0', 64), idBetween(low, high), run('f', 64)].filter(
    (id): id is string => id !== undefined
  );
  const claims = [
    (placed[0] as number) > Math.max(older, newer),
    (placed[1] as number) < Math.min(older, newer),
    placed.length < 3 || (older < between && between < newer),
    (ids[0] as string) < low,
    ids.length < 3 || (low < (ids[1] as string) && (ids[1] as string) < high),
    high < (ids.at(-1) as string)
  ];
  if (claims.includes(false))
    throw new Error(`competitorsFor: a placement does not hold at ${older}, ${newer}`);
  const out: Partial<Nostr.Event>[] = [];
  const at = (created_at: number, id: string, content: string) =>
    out.push(base(1, { id, created_at, content, tags: expiring ? [['expiration', '500']] : [] }));
  // The id ranks a competitor only where it ties one of the pair; elsewhere
  // the instant alone places it, and one id is enough.
  for (const created_at of placed) at(created_at, ids[0] as string, 'm');
  for (const created_at of new Set([older, newer]))
    for (const [index, id] of ids.entries()) at(created_at, id, ['m', 'z', 'a'][index] as string);
  return out;
}

/** A change to one event of a bounded trio. */
export type Rewrite = (event: Partial<Nostr.Event>) => Partial<Nostr.Event>;

/** Values of each payload field that sort high, low and in the middle. */
const RANKS: {
  readonly [F in (typeof PAYLOAD_FIELDS)[number]]: readonly [string, string, string];
} = {
  content: ['z', 'a', 'm'],
  sig: [run('f', 128), run('0', 128), run('8', 128)],
  tags: ['z', 'a', 'm'],
  ots: ['z', 'a', 'm']
};

const rankedAs =
  (field: (typeof PAYLOAD_FIELDS)[number], value: string): Rewrite =>
  (event) =>
    field === 'tags'
      ? { ...event, tags: [[value, 'value'], ...(event.tags ?? [])] }
      : { ...event, [field]: value };

/**
 * The payload fields a bound's ranking might wrongly read, each assigned
 * across a trio — winner, superseded revision, competitor — so that its order
 * runs against the ids' both ways, for a pair that ties on `created_at`, where
 * the bound's tie-break decides which entry keeps the slot. A tag variant puts
 * a tag before the event's own, so the coordinate is unchanged. The first is
 * no change; one variant per field of {@link PAYLOAD_FIELDS}, per order.
 */
export function rankingVariants(): readonly (readonly [Rewrite, Rewrite, Rewrite])[] {
  const same: Rewrite = (event) => event;
  const out: [Rewrite, Rewrite, Rewrite][] = [[same, same, same]];
  for (const field of PAYLOAD_FIELDS) {
    const [high, low, middle] = RANKS[field];
    for (const [w, l, c] of [
      [high, low, middle],
      [low, high, middle]
    ] as const)
      out.push([rankedAs(field, w), rankedAs(field, l), rankedAs(field, c)]);
  }
  return out;
}

/** Every order of `items`. */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest])
  );
}
