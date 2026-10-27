/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Which revision of a coordinate a consumer holds, and what it holds of it,
 * read through the published entry: `RP1`, a supporting arm of `B5-C1`,
 * `B5-C2` and `B5-C4`.
 *
 * **Their landings sit below the hook.** `ES28`, `ES5` and `ES6d` call the
 * fold and the bound directly, and a consumer's request folds through the
 * hook's `collect` (`src/lib/v1/useStreamedReq.svelte.ts`) instead. A defect in
 * `collect` that loses a replacement (#193) passed the whole suite, as the
 * seeded-defect baseline in `docs/process/phase-2-trial.md` records, and one
 * that keeps the incumbent at an equal `created_at` passed `identity.test.ts`,
 * `bounded.test.ts` and `forward.test.ts`. This arm sends signed revisions over
 * the wire, on the backlog and on a live request's forward leg, and reads the
 * answer the consumer holds.
 *
 * On the harness `release.test.ts` and `forward.test.ts` use
 * (`helpers/request.ts`): `NostrApp` with `relays` only, and one consumer's
 * `useReq` under it. **On the real clock only**: what is read is which events
 * the answer holds once each leg has delivered, not when they came.
 *
 * Port band 10220–10399: no other test file names a port in it.
 */
import type Nostr from 'nostr-typedef';
import { getEventHash, getPublicKey, getSignature } from 'rx-nostr-crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { ReqEvent, ReqPlan } from '$lib/v1/index.js';

import { ARM_TIMEOUT_MS, published, REAL, relayAt, urlsFrom } from './helpers/request.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(10220);

/** One author, so that two events of a replaceable kind are one coordinate. */
const SECKEY = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';
const PUBKEY = getPublicKey(SECKEY);

/**
 * An event signed correctly over its own fields, as a relay would carry one.
 * Given `digits`, its content is numbered until its id begins with one of
 * them, so that a case can say which of its events has the lower id.
 */
const signedAs = (
  kind: number,
  content: string,
  createdAt: number,
  tags: readonly (readonly string[])[] = [],
  digits?: string
): Nostr.Event => {
  for (let nonce = 0; ; nonce += 1) {
    const unsigned = {
      kind,
      created_at: createdAt,
      tags: tags.map((tag) => [...tag]),
      content: digits === undefined ? content : `${content} #${String(nonce)}`,
      pubkey: PUBKEY
    };
    const id = getEventHash(unsigned);
    if (digits === undefined || digits.includes(id.charAt(0)))
      return { ...unsigned, id, sig: getSignature(id, SECKEY) };
  }
};

/** The two classes NIP-01 replaces, each with what makes two of its events one coordinate. */
const CLASSES = [
  { name: 'replaceable', kind: 10002, tags: [] },
  { name: 'addressable', kind: 30023, tags: [['d', 'an-article']] }
] as const;

type Retain = 1 | 2 | 'unbounded';
const RETAINS = [1, 'unbounded'] as const;

/** Every order `items` can be sent in. */
const permutations = <T>(items: readonly T[]): T[][] =>
  items.length <= 1
    ? [[...items]]
    : items.flatMap((item, at) =>
        permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest])
      );

/**
 * An event with the name a case's title calls it by, and the name a reading
 * gives it where the row does not say which of two the consumer holds.
 */
interface Named {
  name: string;
  readAs?: string;
  event: Nostr.Event;
}

/**
 * One request: what the relay sends on the backlog and, for a live request,
 * on the forward leg once the backlog has settled, each in order; and which of
 * those the consumer must hold, after the backlog and at the end.
 */
interface Case {
  name: string;
  retain: Retain;
  backlog: readonly Named[];
  live?: { forward: readonly Named[]; afterTheBacklog: readonly string[] };
  held: readonly string[];
}

const sentAs = (sent: readonly Named[]): string => sent.map(({ name }) => name).join(' → ');

/**
 * Two revisions of one coordinate of `kind`, one strictly newer than the
 * other or both at one `created_at`, and which of them wins. The winner is
 * written out here rather than taken from the library: the newer, and at a tie
 * the lower id, as NIP-01 says.
 */
const revisionsOf = (
  name: string,
  kind: number,
  tags: readonly (readonly string[])[],
  dates: 'a strictly newer' | 'an equal'
): { winner: Named; loser: Named } => {
  const first = signedAs(kind, `${name}: first revision`, 1000, tags);
  const second = signedAs(
    kind,
    `${name}: second revision`,
    dates === 'an equal' ? 1000 : 2000,
    tags
  );
  const [winner, loser] =
    dates === 'an equal' && first.id < second.id ? [first, second] : [second, first];
  return { winner: { name: 'winner', event: winner }, loser: { name: 'loser', event: loser } };
};

const DATES = ['a strictly newer', 'an equal'] as const;

/**
 * **Two revisions of one coordinate, in both orders** (`B5-C1`, `B5-C2`): one
 * strictly newer than the other, and two at an equal `created_at`.
 */
const PAIRS: readonly Case[] = CLASSES.flatMap(({ name, kind, tags }) =>
  DATES.flatMap((dates) => {
    const { winner, loser } = revisionsOf(name, kind, tags, dates);
    return [
      [winner, loser],
      [loser, winner]
    ].flatMap((backlog) =>
      RETAINS.map((retain) => ({
        name: `${name}, ${dates} created_at, ${sentAs(backlog)}, retaining ${String(retain)}`,
        retain,
        backlog,
        held: ['winner']
      }))
    );
  })
);

/**
 * **A regular event between the two revisions, in every order of the three**
 * (`B5-C4`): a bound that let the newer revision go before the older arrived
 * would have nothing to hold the older against. Bounded to one, the newer
 * revision is held; without a bound, it and the regular event are.
 */
const BETWEEN: readonly Case[] = CLASSES.flatMap(({ name, kind, tags }) => {
  const superseded = signedAs(kind, `${name}: superseded`, 1000, tags);
  const regular = signedAs(1, `${name}: a regular event between`, 1500);
  const winner = signedAs(kind, `${name}: winner`, 2000, tags);
  return permutations([
    { name: 'superseded', event: superseded },
    { name: 'regular', event: regular },
    { name: 'winner', event: winner }
  ]).flatMap((backlog) =>
    RETAINS.map((retain) => ({
      name: `${name} and a regular event, ${sentAs(backlog)}, retaining ${String(retain)}`,
      retain,
      backlog,
      held: retain === 1 ? ['winner'] : ['regular', 'winner']
    }))
  );
});

/**
 * **The two revisions and a regular event, all three at one `created_at`, in
 * every order of the three** (`B5-C4`): bounded to one, the bound has to choose
 * between two events of one date, and one that chose otherwise than the fold
 * does could let the winner go for the regular event and then keep the
 * superseded revision over that. Which order shows it depends on where the
 * regular event's id falls, so it falls below both revisions' ids, between them
 * and above both. Bounded to one, the superseded revision is not held and one
 * of the other two is — `B5-C4` does not say which, so the reading does not
 * tell them apart; without a bound, both are held.
 */
const TIED: readonly Case[] = CLASSES.flatMap(({ name, kind, tags }) => {
  const winner = signedAs(kind, `${name}: tied winner`, 1000, tags, '45');
  const superseded = signedAs(kind, `${name}: tied superseded`, 1000, tags, 'ab');
  return (
    [
      ['below both', '0123'],
      ['between them', '6789'],
      ['above both', 'cdef']
    ] as const
  ).flatMap(([where, digits]) => {
    const regular = signedAs(1, `${name}: a regular event at the same instant`, 1000, [], digits);
    return permutations([
      { name: 'superseded', event: superseded },
      { name: 'regular', event: regular },
      { name: 'winner', event: winner }
    ]).flatMap((backlog) =>
      RETAINS.map((retain) => ({
        name: `${name} and a regular event at one instant, its id ${where}, ${sentAs(backlog)}, retaining ${String(retain)}`,
        retain,
        backlog:
          retain === 1
            ? backlog.map((each) =>
                each.name === 'superseded' ? each : { ...each, readAs: 'winner or regular' }
              )
            : backlog,
        held: retain === 1 ? ['winner or regular'] : ['regular', 'winner']
      }))
    );
  });
});

/**
 * **One revision on the backlog and the other on the live leg, in both orders**
 * (`B5-C1`, `B5-C2`): the second revision reaches an answer that has settled.
 * A note dated after both is sent after it on the forward leg, and holding the
 * note is what says the revision before it was folded, so the request retains
 * two or is unbounded: bounded to one, the note would leave nothing else to
 * read.
 */
const LIVE: readonly Case[] = CLASSES.flatMap(({ name, kind, tags }) =>
  DATES.flatMap((dates) => {
    const { winner, loser } = revisionsOf(name, kind, tags, dates);
    const note = { name: 'later note', event: signedAs(1, `${name}: a later note`, 3000) };
    return (
      [
        [winner, loser],
        [loser, winner]
      ] as const
    ).flatMap(([first, second]) =>
      ([2, 'unbounded'] as const).map((retain) => ({
        name: `${name}, ${dates} created_at, ${first.name} on the backlog → ${second.name} live, retaining ${String(retain)}`,
        retain,
        backlog: [first],
        live: { forward: [second, note], afterTheBacklog: [first.name] },
        held: ['later note', 'winner']
      }))
    );
  })
);

/**
 * **The identity each class dictates** (`B5-C1`): two addressable events of
 * one kind and author under different `d` tags are two coordinates, and two
 * regular events of one author are never replaced. Both are held, in both
 * orders.
 */
const DISTINCT: readonly Case[] = (
  [
    [
      signedAs(30023, 'an article', 1000, [['d', 'an-article']]),
      signedAs(30023, 'another article', 2000, [['d', 'another-article']])
    ],
    [signedAs(1, 'a note', 1000), signedAs(1, 'a later note', 2000)]
  ] as const
).flatMap(([older, newer]) => {
  const both = [
    { name: 'older', event: older },
    { name: 'newer', event: newer }
  ];
  return [both, [...both].reverse()].map((backlog) => ({
    name: `two kind-${String(older.kind)} events that are not one coordinate, ${sentAs(backlog)}`,
    retain: 'unbounded' as const,
    backlog,
    held: ['newer', 'older']
  }));
});

/** The fields an event's id and signature commit to, in one order. */
const committed = ({ id, pubkey, created_at, kind, tags, content, sig }: ReqEvent): string =>
  JSON.stringify({ id, pubkey, created_at, kind, tags, content, sig });

/**
 * How a reading names a held event: by the name its case gives the event of
 * that id, marked altered where it is not that event field for field, or by
 * its id where the case sent none.
 */
const nameIn =
  (each: Case) =>
  (event: ReqEvent): string => {
    const sent = [...each.backlog, ...(each.live?.forward ?? [])].find(
      (one) => one.event.id === event.id
    );
    if (sent === undefined) return event.id;
    const name = sent.readAs ?? sent.name;
    return committed(event) === committed(sent.event) ? name : `${name}, altered`;
  };

/** The request, with a deadline of the clock's own. */
const planOf = (retain: Retain, live: boolean, namespace: string): ReqPlan => ({
  kind: 'request',
  descriptor: {
    filters: [{ kinds: [1, 10002, 30023] }],
    live,
    retain,
    namespace,
    ...(REAL.settleTimeoutMs === undefined ? {} : { settleTimeoutMs: REAL.settleTimeoutMs })
  }
});

describe('B5: which revision of a coordinate a consumer holds', () => {
  it(
    'RP1: a consumer holds the revision NIP-01 says wins, as it was sent, in every order the revisions arrive in, on either leg, bounded or not',
    async () => {
      // Each case is its own request on its own relay, all at once. The relay
      // sends the case's backlog in order, then `EOSE`, and the consumer's
      // answer is read once it is settled; for a live case, the forward leg's
      // events are sent then, and the answer is read again once it holds the
      // last of them. A reading is which of the case's events the answer holds,
      // by the names the case gives them, sorted, since the order a list is
      // shown in is `B6`'s and not this arm's.
      const cases = [...PAIRS, ...BETWEEN, ...TIED, ...LIVE, ...DISTINCT];
      expect(cases, 'the cases this arm reads').toHaveLength(132);
      const readings = await Promise.all(
        cases.map((each, at) => {
          const relay = relayAt(nextUrl());
          return published(
            relay,
            planOf(each.retain, each.live !== undefined, `rp1-${String(at)}`),
            REAL,
            async (consumer) => {
              const holding = (): readonly ReqEvent[] => {
                const state = consumer.handle()?.state;
                return state === undefined || state.status === 'loading' ? [] : state.events;
              };
              const held = (): string[] => holding().map(nameIn(each)).sort();
              const asked = await REAL.promptly(
                () =>
                  relay.asked('backward').length === 1 &&
                  relay.asked('forward').length === (each.live === undefined ? 0 : 1)
              );
              const backward = relay.asked('backward').at(-1);
              for (const { event } of each.backlog) relay.server.send(['EVENT', backward, event]);
              relay.answerBacklog();
              await REAL.promptly(() => consumer.handle()?.state.status === 'settled');
              if (each.live === undefined)
                return { asked, status: consumer.handle()?.state.status, held: held() };
              const afterTheBacklog = held();
              const forward = relay.asked('forward').at(-1);
              for (const { event } of each.live.forward)
                relay.server.send(['EVENT', forward, event]);
              const last = each.live.forward.at(-1)?.event.id;
              await REAL.promptly(() => holding().some((event) => event.id === last));
              return {
                asked,
                status: consumer.handle()?.state.status,
                afterTheBacklog,
                held: held()
              };
            }
          );
        })
      );
      expect(
        Object.fromEntries(cases.map((each, at) => [each.name, readings[at]])),
        'the revision each consumer holds'
      ).toEqual(
        Object.fromEntries(
          cases.map((each) => [
            each.name,
            {
              asked: true,
              status: 'settled',
              ...(each.live === undefined
                ? {}
                : { afterTheBacklog: [...each.live.afterTheBacklog].sort() }),
              held: [...each.held].sort()
            }
          ])
        )
      );
    },
    ARM_TIMEOUT_MS
  );
});
