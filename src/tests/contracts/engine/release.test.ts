/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a request lets go of when each leg ends: the landings of `A5-C21`
 * (`RL1`), `A5-C23` (`RL2`) and `A5-C24` (`RL3`).
 *
 * **Through the published entry**, all three: `NostrApp` with `relays` only, and
 * one consumer's `useReq` under it, mounted while the arm says so
 * (`MountedRequest`). The consumer is torn down with the provider still
 * mounted, so its connection outlives the request and a `CLOSE` read after
 * that teardown is the consumer's. The provider's going away would close the
 * live leg as well (measured), which would hide a consumer that lets go of
 * nothing.
 *
 * **What the wire can say, and what it cannot.** The backlog's `CLOSE` is put
 * on the wire twice over: rx-nostr closes a oneshot on `EOSE` by itself, and
 * this library releases the backlog's subscription when its outcome is queued.
 * Measured, removing either leaves the wire as it was, and only removing both
 * leaves the backlog open. So `RL1` and `RL2` read what no subscription may be
 * left as — open — and `RL3` says whose release it was: the producer the
 * library is handed is wrapped so that it never completes, which only a
 * release by this library can tear down. The wrapper is put on the provider's
 * own client, handed over through its context by a child mounted before the
 * consumer (`ProviderReader`), so the transport is built exactly as it ships.
 *
 * **Every request is made in each of the ways its backlog can end**: with no
 * event, with one and with two, which the gate drains before the outcome, and
 * retaining without bound and at most one, which two overflow. `RL3` also
 * makes each one live and not.
 *
 * **Two clocks, each for what only it can read, and every ending on both.** On
 * a fake clock, the request's deadline left to the library's default, the
 * backlog's release is read within a fifth of that deadline, and the real time
 * the run has taken by then must be under that same fifth: a release that comes
 * later reads open, whichever clock it was scheduled on, unless the run was
 * held up in real time for as long, and then the run reads as held up rather
 * than as prompt; the consumer's teardown is read the same way, its real time
 * counted from the teardown. On the real clock, with a deadline of its own,
 * what is prompt is half that deadline, on the clock and in real time alike,
 * and the request is held a second past that deadline and the wire is read a
 * delivery turn later, so what the request scheduled for its deadline on
 * whatever clock it took — a `setTimeout` taken as a module was loaded,
 * `AbortSignal.timeout`, a deadline read off `Temporal.Now` — has had that
 * second to run and that turn to reach the wire (measured: each closed the live
 * leg at the deadline and passed every request on the fake clock). The fake
 * clock is installed before the provider is rendered and put back after it
 * goes; the requests on the real clock run all at once.
 *
 * Port band 9020–9099.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import type { RxNostr } from 'rx-nostr';
import { createRxOneshotReq } from 'rx-nostr';
import { getEventHash, getPublicKey, getSignature } from 'rx-nostr-crypto';
import { Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { NostrContext } from '$lib/v1/context.svelte.js';
import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import { DEFAULT_SETTLE_TIMEOUT_MS } from '$lib/v1/normalize.js';

import MountedRequest from './fixtures/MountedRequest.svelte';
import { transportOf } from './helpers/relay.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  WS.clean();
});

let port = 9020;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Every clock the dependency, the socket mock and the machine read, for a request on a fake one. */
const FAKED = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'Date',
  'performance'
] as const;

/** The deadline a request on the real clock is given: twice the arms' budget for what is prompt. */
const REAL_DEADLINE_MS = 4000;

/** A turn for what a callback put on the wire to reach the relay. */
const DELIVERY_MS = 100;

/** Real time an arm may take, with every wait in it run out. */
const ARM_TIMEOUT_MS = 60_000;

/**
 * Move the fake clock a step at a time until `done` holds or `ms` of it have
 * passed, and say whether it holds.
 */
async function advanceUntil(done: () => boolean, ms: number, step = 50): Promise<boolean> {
  for (let spent = 0; spent < ms && !done(); spent += step) await vi.advanceTimersByTimeAsync(step);
  return done();
}

/** Whether `done` holds within `ms` of real time. */
async function until(done: () => boolean, ms: number): Promise<boolean> {
  try {
    await vi.waitFor(() => expect(done()).toBe(true), { timeout: ms });
    return true;
  } catch {
    return false;
  }
}

/** A clock a request is run on: how an arm waits on it, and how it holds a request past its deadline. */
interface Clock {
  name: string;
  fake: boolean;
  /** The request's deadline, as its descriptor states it: absent for the library's default. */
  settleTimeoutMs: number | undefined;
  /**
   * What is prompt on this clock: a fifth of the deadline on the fake clock,
   * half of it on the real one. It bounds the real time a prompt reading may
   * come after the arm last acted, as well as the wait on this clock's own
   * time, so that nothing scheduled later than this, on any clock, has had
   * the time to run by a prompt reading.
   */
  promptMs: number;
  /** Whether `done` holds within `promptMs` of this clock's time. */
  promptly: (done: () => boolean) => Promise<boolean>;
  /** Let a second more than the whole deadline pass, and a delivery turn after. */
  pastTheDeadline: () => Promise<void>;
}

const FAKE: Clock = {
  name: 'fake clock',
  fake: true,
  settleTimeoutMs: undefined,
  promptMs: DEFAULT_SETTLE_TIMEOUT_MS / 5,
  promptly: (done) => advanceUntil(done, FAKE.promptMs),
  pastTheDeadline: async () => {
    await vi.advanceTimersByTimeAsync(DEFAULT_SETTLE_TIMEOUT_MS + 1000);
  }
};

const REAL: Clock = {
  name: 'real clock',
  fake: false,
  settleTimeoutMs: REAL_DEADLINE_MS,
  promptMs: REAL_DEADLINE_MS / 2,
  promptly: (done) => until(done, REAL.promptMs),
  pastTheDeadline: async () => {
    await delay(REAL_DEADLINE_MS + 1000);
    await delay(DELIVERY_MS);
  }
};

const SECKEY = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';

/** An event signed correctly over its own fields, as a relay would carry one. */
const signed = (content: string): Nostr.Event => {
  const unsigned = { kind: 1, created_at: 1000, tags: [], content, pubkey: getPublicKey(SECKEY) };
  const id = getEventHash(unsigned);
  return { ...unsigned, id, sig: getSignature(id, SECKEY) };
};

type Leg = 'backward' | 'forward';

/** The leg a subscription name belongs to, as the machine names its two. */
const legOf = (subId: string): Leg | undefined =>
  subId.includes('-b:') ? 'backward' : subId.includes('-f:') ? 'forward' : undefined;

/**
 * The subscriptions `frames` leave open, by leg — a name the arm does not
 * know is given as itself. Folded in the order the frames were sent, so a
 * subscription asked again after its `CLOSE` is open again.
 */
function openAmong(frames: readonly unknown[][]): string[] {
  const open = new Set<string>();
  for (const [kind, subId] of frames) {
    if (kind === 'REQ') open.add(String(subId));
    if (kind === 'CLOSE') open.delete(String(subId));
  }
  return [...open].map((subId) => legOf(subId) ?? subId);
}

/**
 * The reader's own control: a backlog closed and asked again, which is open,
 * beside a live leg asked and closed, which is not.
 */
const REOPENED: readonly unknown[][] = [
  ['REQ', 'x-f:0'],
  ['REQ', 'x-b:0'],
  ['CLOSE', 'x-b:0'],
  ['CLOSE', 'x-f:0'],
  ['REQ', 'x-b:0']
];

/** A relay server, and what it was sent on each leg. */
function relayAt(url: string) {
  const server = new WS(url, { jsonProtocol: true });
  const frames = (): unknown[][] => server.messages as unknown[][];
  /** The subscription names `kind` frames carried on `leg`, in order. */
  const named = (kind: 'REQ' | 'CLOSE', leg: Leg): string[] =>
    frames()
      .filter((frame) => frame[0] === kind && legOf(String(frame[1])) === leg)
      .map((frame) => String(frame[1]));
  return {
    url,
    server,
    /** The subscriptions asked on `leg`, a name asked again counted again. */
    asked: (leg: Leg): string[] => named('REQ', leg),
    /** The subscriptions closed on `leg`. */
    closed: (leg: Leg): string[] => named('CLOSE', leg),
    /** The subscriptions open now, by leg, sorted. */
    open: (): string[] => openAmong(frames()).sort(),
    /** `count` events on the backlog asked of this relay, each signed. */
    sendBacklog: (count: number, content: string): void => {
      for (let each = 0; each < count; each += 1) {
        server.send([
          'EVENT',
          named('REQ', 'backward').at(-1),
          signed(`${content}-${String(each)}`)
        ]);
      }
    },
    /** `EOSE` for the backlog asked of this relay. */
    answerBacklog: (): void => {
      server.send(['EOSE', named('REQ', 'backward').at(-1)]);
    },
    /** `EOSE` for the live subscription asked of this relay, as a relay sends one on every subscription. */
    answerLive: (): void => {
      server.send(['EOSE', named('REQ', 'forward').at(-1)]);
    },
    /** How many sockets to this relay are open now. */
    sockets: (): number => server.server.clients().length
  };
}

type Relay = ReturnType<typeof relayAt>;

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

/** One way a backlog can end: how many events it carries, and what the request retains. */
interface Ending {
  events: 0 | 1 | 2;
  retain: 'unbounded' | 1;
}

const ENDINGS: readonly Ending[] = ([0, 1, 2] as const).flatMap((events) =>
  (['unbounded', 1] as const).map((retain) => ({ events, retain }))
);

const nameOf = ({ events, retain }: Ending): string =>
  `${String(events)} event, retaining ${String(retain)}`;

/** The events a request holds once its backlog has ended this way. */
const kept = ({ events, retain }: Ending): number =>
  retain === 'unbounded' ? events : Math.min(events, retain);

/** The request, its deadline the clock's. */
const planned = (
  namespace: string,
  live: boolean,
  retain: Ending['retain'],
  clock: Clock
): ReqPlan => ({
  kind: 'request',
  descriptor: {
    filters: [{ kinds: [1] }],
    live,
    retain,
    namespace,
    ...(clock.settleTimeoutMs === undefined ? {} : { settleTimeoutMs: clock.settleTimeoutMs })
  }
});

/** The events the consumer's request holds. */
const delivered = (handle: ReqHandle | undefined): number =>
  handle === undefined || handle.state.status === 'loading' ? 0 : handle.state.events.length;

interface Consumer {
  /** The request the consumer holds, once it has one. */
  handle: () => ReqHandle | undefined;
  /** Mount the consumer under the provider. */
  mount: () => Promise<void>;
  /** Tear the consumer down, the provider staying mounted. */
  tearDown: () => Promise<void>;
  /**
   * Whether less than the clock's `promptMs` of real time has passed since the
   * request was made, or since the consumer was torn down once it has been.
   */
  inRealTime: () => boolean;
}

/**
 * One request through the published entry, on `relay` and `clock`, handed to
 * `run`; the provider is unmounted after. On the fake clock, the clock is
 * installed before the provider is rendered, and moved on after it goes so
 * that what it leaves behind runs out, then put back. The consumer is mounted
 * at once unless `ready` is given, in which case the arm is handed the
 * provider's context first and mounts the consumer itself.
 */
async function published(
  relay: Relay,
  plan: ReqPlan,
  clock: Clock,
  run: (consumer: Consumer) => Promise<unknown>,
  ready?: (context: NostrContext) => void
): Promise<unknown> {
  let handle: ReqHandle | undefined;
  let actedAt = vi.getRealSystemTime();
  if (clock.fake) vi.useFakeTimers({ toFake: [...FAKED] });
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  const view = render(MountedRequest, {
    relays: [relay.url],
    plan: () => plan,
    mounted: ready === undefined,
    seen: (request: ReqHandle) => {
      handle = request;
    },
    ...(ready === undefined ? {} : { ready })
  });
  try {
    return await run({
      handle: () => handle,
      mount: () => view.rerender({ mounted: true }),
      tearDown: () => {
        actedAt = vi.getRealSystemTime();
        return view.rerender({ mounted: false });
      },
      inRealTime: () => vi.getRealSystemTime() - actedAt < clock.promptMs
    });
  } catch (error) {
    return failed(error);
  } finally {
    view.unmount();
    if (clock.fake) {
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
    }
  }
}

const CLOCKS: readonly Clock[] = [FAKE, REAL];

/**
 * Each case's reading on each clock, by the clock's name and the case's: on
 * the fake clock one request after another, since that clock is the whole
 * process's, then on the real clock all at once, since each is held there for
 * its whole deadline.
 */
async function onEachClock<Case>(
  cases: readonly Case[],
  name: (each: Case) => string,
  read: (clock: Clock, each: Case) => Promise<unknown>
): Promise<Record<string, unknown>> {
  const readings: Record<string, unknown> = {};
  for (const each of cases) readings[`${FAKE.name}, ${name(each)}`] = await read(FAKE, each);
  const real = await Promise.all(cases.map((each) => read(REAL, each)));
  cases.forEach((each, index) => {
    readings[`${REAL.name}, ${name(each)}`] = real[index];
  });
  return readings;
}

/** What each case must read on each clock, by the same names. */
const expectedOnEachClock = <Case>(
  cases: readonly Case[],
  name: (each: Case) => string,
  reading: (each: Case) => unknown
): Record<string, unknown> =>
  Object.fromEntries(
    CLOCKS.flatMap((clock) => cases.map((each) => [`${clock.name}, ${name(each)}`, reading(each)]))
  );

/** One leg's subscriptions: every one taken, and every one torn down. */
interface Held {
  taken: number;
  released: number;
}

/** What a client handed out and had torn down, by the leg of the request it was asked for. */
type Counts = Record<string, Held>;

/** The leg a request belongs to, by the name the machine gives it, or the name itself. */
const legOfRequest = (rxReqId: string): string =>
  rxReqId.endsWith('-b') ? 'backward' : rxReqId.endsWith('-f') ? 'forward' : rxReqId;

/**
 * What the library takes from a client and lets go of, counted on a producer
 * that never completes, by leg: `taken` is every subscription the client's
 * `use` hands out, `released` every one torn down. Only an `unsubscribe()`
 * tears one down, since the dependency finishing — its oneshot completing on
 * `EOSE` — is not passed on.
 */
function counting(client: RxNostr): Counts {
  const counts: Counts = {};
  const use = client.use.bind(client);
  (client as { use: typeof client.use }).use = ((...args: Parameters<typeof use>) => {
    const source = use(...args);
    const leg = legOfRequest(args[0].rxReqId);
    const endless = new Observable((subscriber) => {
      const held = (counts[leg] ??= { taken: 0, released: 0 });
      held.taken += 1;
      const inner = source.subscribe({
        next: (packet) => subscriber.next(packet),
        error: (reason: unknown) => subscriber.error(reason)
        // No `complete`: the dependency finishing does not finish this.
      });
      return () => {
        held.released += 1;
        inner.unsubscribe();
      };
    });
    return endless as ReturnType<typeof use>;
  }) as typeof client.use;
  return counts;
}

/** The counts as they stand. */
const snapshot = (counts: Counts): Counts =>
  Object.fromEntries(Object.entries(counts).map(([leg, held]) => [leg, { ...held }]));

describe('A5: what a request lets go of when each leg ends', () => {
  // @contracts A5-C21
  it(
    'RL1: a live request’s backlog end closes the backlog’s subscription and not the live one, and the consumer’s teardown closes the live one',
    async () => {
      // **Read per leg, as the wire stands and as it went.** The relay answers
      // both subscriptions with `EOSE`, as a relay does every subscription it
      // is asked, and the live one first. Then the backlog's subscription is
      // waited for to close, well inside the request's own deadline, and the
      // live one read open; the request is held past that deadline and the
      // wire read again, with every `CLOSE` and every `REQ` of each leg counted
      // up to the teardown, so a live leg closed late inside that span — or a
      // leg closed and asked again, or asked again on its own name — is read
      // rather than sampled past. Then the consumer alone is torn down, and
      // nothing may be left open, with the socket still open — the receipt
      // that the close is the consumer's. The reader is read first, on frames
      // that close a backlog and ask it again.
      const readings = await onEachClock(ENDINGS, nameOf, (clock, ending) => {
        const relay = relayAt(nextUrl());
        return published(
          relay,
          planned('rl1', true, ending.retain, clock),
          clock,
          async (consumer) => {
            const reader = openAmong(REOPENED);
            const asked = await clock.promptly(
              () => relay.asked('backward').length === 1 && relay.asked('forward').length === 1
            );
            const beforeTheEnd = relay.open();
            relay.sendBacklog(ending.events, 'rl1');
            relay.answerLive();
            relay.answerBacklog();
            await clock.promptly(() => relay.open().join() === 'forward');
            const afterTheBacklog = relay.open();
            const inRealTime = consumer.inRealTime();
            await clock.pastTheDeadline();
            const held = {
              open: relay.open(),
              asked: {
                backward: relay.asked('backward').length,
                forward: relay.asked('forward').length
              },
              liveCloses: relay.closed('forward').length,
              status: consumer.handle()?.state.status,
              activity: consumer.handle()?.activity,
              delivered: delivered(consumer.handle())
            };
            await consumer.tearDown();
            await clock.promptly(() => relay.open().length === 0);
            return {
              reader,
              asked,
              beforeTheEnd,
              afterTheBacklog,
              inRealTime,
              held,
              afterTheTeardown: relay.open(),
              tornDownInRealTime: consumer.inRealTime(),
              sockets: relay.sockets()
            };
          }
        );
      });
      expect(
        readings,
        'the backlog’s end closes its subscription and not the live one, and the consumer’s teardown closes the live one'
      ).toEqual(
        expectedOnEachClock(ENDINGS, nameOf, (ending) => ({
          reader: ['backward'],
          asked: true,
          beforeTheEnd: ['backward', 'forward'],
          afterTheBacklog: ['forward'],
          inRealTime: true,
          held: {
            open: ['forward'],
            asked: { backward: 1, forward: 1 },
            liveCloses: 0,
            status: 'settled',
            activity: 'live',
            delivered: kept(ending)
          },
          afterTheTeardown: [],
          tornDownInRealTime: true,
          sockets: 1
        }))
      );
    },
    ARM_TIMEOUT_MS
  );

  // @contracts A5-C23
  it(
    'RL2: a request that is not live leaves no subscription open once it settles, before any teardown',
    async () => {
      // The backlog is answered and the request read `settled`; then, with the
      // consumer still mounted, nothing may be open on the wire, read as `RL1`
      // reads it, its reader first — well inside the request's own deadline,
      // and again once the request is held past it, with the backlog asked
      // once in all.
      const readings = await onEachClock(ENDINGS, nameOf, (clock, ending) => {
        const relay = relayAt(nextUrl());
        return published(
          relay,
          planned('rl2', false, ending.retain, clock),
          clock,
          async (consumer) => {
            const reader = openAmong(REOPENED);
            const asked = await clock.promptly(() => relay.asked('backward').length === 1);
            relay.sendBacklog(ending.events, 'rl2');
            relay.answerBacklog();
            const settled = await clock.promptly(
              () => consumer.handle()?.state.status === 'settled'
            );
            await clock.promptly(() => relay.open().length === 0);
            const atTheOutcome = relay.open();
            const inRealTime = consumer.inRealTime();
            await clock.pastTheDeadline();
            return {
              reader,
              asked,
              settled,
              atTheOutcome,
              inRealTime,
              held: {
                open: relay.open(),
                asked: relay.asked('backward').length,
                delivered: delivered(consumer.handle())
              },
              sockets: relay.sockets()
            };
          }
        );
      });
      expect(
        readings,
        'a request that is not live leaves no subscription open once it settles'
      ).toEqual(
        expectedOnEachClock(ENDINGS, nameOf, (ending) => ({
          reader: ['backward'],
          asked: true,
          settled: true,
          atTheOutcome: [],
          inRealTime: true,
          held: { open: [], asked: 1, delivered: kept(ending) },
          sockets: 1
        }))
      );
    },
    ARM_TIMEOUT_MS
  );

  // @contracts A5-C24
  it(
    'RL3: the same settle, on a producer that never completes, is released by the library itself, once',
    async () => {
      // **The instrument is read first.** Before the consumer exists, the arm
      // takes a oneshot of its own through the same wrapped client and the
      // relay answers it: the dependency closes its oneshot — a `CLOSE` is on
      // the wire — and nothing is counted as released; the arm's own
      // `unsubscribe()` then is. So a release counted afterwards is somebody
      // letting go, and the dependency finishing is not one.
      //
      // **Then the claim**, on a request that is live and on one that is not,
      // in every ending and on both clocks: the backlog's producer taken once
      // and released, at the outcome — well inside the request's own deadline —
      // and again once the request is held past it, before any teardown; a live
      // leg taken and not released. **"Exactly once" is two halves held by two
      // parties.** At least once is the library's. At most once is the
      // dependency's: RxJS runs one subscription's teardown once, and the
      // shipping code leans on that — it calls `unsubscribe()` on the backlog's
      // twice, in `closeBackward` and again in `closeAll`. So the control makes
      // its own `unsubscribe()` twice and reads one release, which is where
      // that half is read. A producer taken twice reads two taken — on a
      // request that is not live both released at its end, and on a live one
      // the second held until the teardown — which is about what was taken
      // rather than a release repeated.
      const cases = [true, false].flatMap((live) => ENDINGS.map((ending) => ({ live, ending })));
      const caseName = ({ live, ending }: (typeof cases)[number]): string =>
        `${live ? 'live' : 'not live'}, ${nameOf(ending)}`;
      const readings = await onEachClock(cases, caseName, (clock, { live, ending }) => {
        const relay = relayAt(nextUrl());
        let client: RxNostr | undefined;
        let counts: Counts | undefined;
        return published(
          relay,
          planned('rl3', live, ending.retain, clock),
          clock,
          async (consumer) => {
            if (client === undefined || counts === undefined) return { wrapped: false };
            const own = client
              .use(createRxOneshotReq({ filters: [{ kinds: [7] }], rxReqId: 'rl3-control' }), {
                on: { relays: [relay.url] }
              })
              .subscribe({});
            const controlNamed = (kind: 'REQ' | 'CLOSE'): string[] =>
              (relay.server.messages as unknown[][])
                .filter((frame) => frame[0] === kind && String(frame[1]).startsWith('rl3-control:'))
                .map((frame) => String(frame[1]));
            const controlAsked = await clock.promptly(() => controlNamed('REQ').length === 1);
            relay.server.send(['EOSE', controlNamed('REQ')[0]]);
            const dependencyClosed = await clock.promptly(() => controlNamed('CLOSE').length === 1);
            const control = {
              asked: controlAsked,
              dependencyClosed,
              afterTheDependency: snapshot(counts)
            };
            own.unsubscribe();
            own.unsubscribe();
            const afterItsOwn = snapshot(counts);
            for (const leg of Object.keys(counts)) Reflect.deleteProperty(counts, leg);

            await consumer.mount();
            const asked = await clock.promptly(
              () =>
                relay.asked('backward').length === 1 &&
                relay.asked('forward').length === (live ? 1 : 0)
            );
            relay.sendBacklog(ending.events, 'rl3');
            if (live) relay.answerLive();
            relay.answerBacklog();
            const settled = await clock.promptly(
              () => consumer.handle()?.state.status === 'settled'
            );
            const atTheOutcome = snapshot(counts);
            const inRealTime = consumer.inRealTime();
            await clock.pastTheDeadline();
            return {
              control: { ...control, afterItsOwn },
              asked,
              settled,
              atTheOutcome,
              inRealTime,
              held: snapshot(counts),
              backlogs: relay.asked('backward').length,
              delivered: delivered(consumer.handle())
            };
          },
          (context) => {
            client = transportOf(context);
            counts = counting(client);
          }
        );
      });
      const expected = expectedOnEachClock(cases, caseName, ({ live, ending }) => {
        const legs = live
          ? { backward: { taken: 1, released: 1 }, forward: { taken: 1, released: 0 } }
          : { backward: { taken: 1, released: 1 } };
        return {
          control: {
            asked: true,
            dependencyClosed: true,
            afterTheDependency: { 'rl3-control': { taken: 1, released: 0 } },
            afterItsOwn: { 'rl3-control': { taken: 1, released: 1 } }
          },
          asked: true,
          settled: true,
          atTheOutcome: legs,
          inRealTime: true,
          held: legs,
          backlogs: 1,
          delivered: kept(ending)
        };
      });
      expect(
        readings,
        'the library itself releases the backlog’s subscription, once, and not the live one'
      ).toEqual(expected);
    },
    ARM_TIMEOUT_MS
  );
});
