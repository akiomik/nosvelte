/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Which revision of a coordinate a consumer holds once the backlog has
 * answered, read through the published entry: `RP1`, a supporting arm of
 * `B5-C1`, `B5-C2` and `B5-C4`.
 *
 * **Their landings sit below the hook.** `ES28`, `ES5` and `ES6d` call the
 * fold and the bound directly, and a consumer's request folds through the
 * hook's `collect` (`src/lib/v1/useStreamedReq.svelte.ts`) instead. A defect in
 * `collect` that loses a replacement (#193) passed the whole suite, as the
 * seeded-defect baseline in `docs/process/phase-2-trial.md` records, and one
 * that keeps the incumbent at an equal `created_at` passed `identity.test.ts`,
 * `bounded.test.ts` and `forward.test.ts`. This arm sends signed revisions over
 * the wire and reads the answer the consumer holds.
 *
 * On the harness `release.test.ts` and `forward.test.ts` use
 * (`helpers/request.ts`): `NostrApp` with `relays` only, and one consumer's
 * `useReq` under it. **On the real clock only**: what is read is which events
 * the settled answer holds, not when it came.
 *
 * Port band 10220–10299: no other test file names a port in it.
 */
import type Nostr from 'nostr-typedef';
import { getEventHash, getPublicKey, getSignature } from 'rx-nostr-crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { ReqPlan } from '$lib/v1/index.js';

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

/** An event signed correctly over its own fields, as a relay would carry one. */
const signedAs = (
  kind: number,
  content: string,
  createdAt: number,
  tags: readonly (readonly string[])[] = []
): Nostr.Event => {
  const unsigned = {
    kind,
    created_at: createdAt,
    tags: tags.map((tag) => [...tag]),
    content,
    pubkey: PUBKEY
  };
  const id = getEventHash(unsigned);
  return { ...unsigned, id, sig: getSignature(id, SECKEY) };
};

/** The two classes NIP-01 replaces, each with what makes two of its events one coordinate. */
const CLASSES = [
  { name: 'replaceable', kind: 10002, tags: [] },
  { name: 'addressable', kind: 30023, tags: [['d', 'an-article']] }
] as const;

const RETAINS = [1, 'unbounded'] as const;
type Retain = (typeof RETAINS)[number];

/** Every order `items` can be sent in. */
const permutations = <T>(items: readonly T[]): T[][] =>
  items.length <= 1
    ? [[...items]]
    : items.flatMap((item, at) =>
        permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest])
      );

/** An event with the name a case's title calls it by. */
interface Named {
  name: string;
  event: Nostr.Event;
}

/** One request: what the relay sends on its backlog, in order, and which of those the consumer must hold. */
interface Case {
  name: string;
  retain: Retain;
  sent: readonly Named[];
  held: readonly string[];
}

const sentAs = (sent: readonly Named[]): string => sent.map(({ name }) => name).join(' → ');

/**
 * **Two revisions of one coordinate, in both orders** (`B5-C1`, `B5-C2`): one
 * strictly newer than the other, and two at an equal `created_at`. The winner
 * is written out here rather than taken from the library: the newer, and at a
 * tie the lower id, as NIP-01 says.
 */
const PAIRS: readonly Case[] = CLASSES.flatMap(({ name, kind, tags }) =>
  (['a strictly newer', 'an equal'] as const).flatMap((dates) => {
    const first = signedAs(kind, `${name}: first revision`, 1000, tags);
    const second = signedAs(
      kind,
      `${name}: second revision`,
      dates === 'an equal' ? 1000 : 2000,
      tags
    );
    const [winner, loser] =
      dates === 'an equal' && first.id < second.id ? [first, second] : [second, first];
    const both = [
      { name: 'winner', event: winner },
      { name: 'loser', event: loser }
    ];
    return [both, [...both].reverse()].flatMap((sent) =>
      RETAINS.map((retain) => ({
        name: `${name}, ${dates} created_at, ${sentAs(sent)}, retaining ${String(retain)}`,
        retain,
        sent,
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
  ]).flatMap((sent) =>
    RETAINS.map((retain) => ({
      name: `${name} and a regular event, ${sentAs(sent)}, retaining ${String(retain)}`,
      retain,
      sent,
      held: retain === 1 ? ['winner'] : ['regular', 'winner']
    }))
  );
});

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
  return [both, [...both].reverse()].map((sent) => ({
    name: `two kind-${String(older.kind)} events that are not one coordinate, ${sentAs(sent)}`,
    retain: 'unbounded' as const,
    sent,
    held: ['newer', 'older']
  }));
});

/** The request, with a deadline of the clock's own. */
const planOf = (retain: Retain, namespace: string): ReqPlan => ({
  kind: 'request',
  descriptor: {
    filters: [{ kinds: [1, 10002, 30023] }],
    live: false,
    retain,
    namespace,
    ...(REAL.settleTimeoutMs === undefined ? {} : { settleTimeoutMs: REAL.settleTimeoutMs })
  }
});

describe('B5: which revision of a coordinate a consumer holds', () => {
  it(
    'RP1: a consumer holds the revision NIP-01 says wins, in every order the revisions arrive in, bounded or not',
    async () => {
      // Each case is its own request on its own relay, all at once. The relay
      // sends the case's events on the backlog in order, then `EOSE`, and the
      // consumer's answer is read once it is settled: which of the case's
      // events it holds, by the names the case gives them, sorted, since the
      // order a list is shown in is `B6`'s and not this arm's. An event that
      // is none of them is read as its id.
      const cases = [...PAIRS, ...BETWEEN, ...DISTINCT];
      expect(cases, 'the cases this arm reads').toHaveLength(44);
      const readings = await Promise.all(
        cases.map((each, at) => {
          const relay = relayAt(nextUrl());
          return published(
            relay,
            planOf(each.retain, `rp1-${String(at)}`),
            REAL,
            async (consumer) => {
              const asked = await REAL.promptly(() => relay.asked('backward').length === 1);
              const subId = relay.asked('backward').at(-1);
              for (const { event } of each.sent) relay.server.send(['EVENT', subId, event]);
              relay.answerBacklog();
              await REAL.promptly(() => consumer.handle()?.state.status === 'settled');
              const state = consumer.handle()?.state;
              const nameOf = (id: string): string =>
                each.sent.find(({ event }) => event.id === id)?.name ?? id;
              return {
                asked,
                status: state?.status,
                held:
                  state === undefined || state.status === 'loading'
                    ? []
                    : state.events.map((event) => nameOf(event.id)).sort()
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
            { asked: true, status: 'settled', held: [...each.held].sort() }
          ])
        )
      );
    },
    ARM_TIMEOUT_MS
  );
});
