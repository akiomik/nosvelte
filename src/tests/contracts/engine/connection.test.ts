/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a request does with the state of each relay's connection: the landings
 * of `A5-C2` (`CS1`), `A5-C4` (`CS2`), `A5-C5` (`CS3`), `A5-C6` (`CS4`),
 * `A5-C25` (`CS5`), `A5-C7` (`CS6`), `A5-C8` (`CS7`) and `A5-C20` (`CS8`).
 * `CS7` also reads the order of the re-open and the ask, which no public
 * reading can see.
 *
 * **Through the published entry**, for `CS1`, `CS2`, `CS4`, `CS6` and `CS8`:
 * `NostrApp` with `relays` only, so the dependency's retry policy is the one
 * it ships with; a consumer's own `useReq` under it; and relays whose sockets
 * close the ways a relay's can. Each arm answers the backlog first where its
 * row is about the live leg, so what it reads afterwards is the leg's.
 *
 * **The states, all reached over the wire.**
 * - **Dropped**: the relay drops the socket abnormally (1006). The shipping
 *   policy waits a second or so and reconnects, and re-sends the live
 *   subscription under its own name. The connection is `recovering` until then.
 * - **Exhausted**: the ordinary death. The relay stops accepting, every retry
 *   fails before it opens, and rx-nostr gives up with `error` once its five
 *   retries are spent — about thirty seconds of its own timers. Those runs are
 *   on a fake clock installed before the request is made.
 * - **Refused**: the relay closes the open socket with 4000, which rx-nostr
 *   reports as `rejected` and does not retry.
 * - **Idle**: the relay closes the socket with 4537, the code rx-nostr reserves
 *   for a socket it put to sleep itself, which it reports as `dormant`. A later
 *   send wakes the socket; nothing re-sends what was riding on it. **The
 *   ordinary way into `dormant` is the dependency's own**: with nothing
 *   subscribed for ten seconds it puts the socket to sleep with that code, and
 *   `CS7` arranges it that way, since what an attempt meets at its preflight is
 *   the sleep that follows a pause and not a relay's close of a socket a live
 *   subscription is still riding on.
 *
 * `terminated` has no entrance in v1 — the only client is the provider's, and
 * its disposal revokes the capability before any request reaches a preflight
 * (0002) — so `CS7` forces it, on a client of the arm's own.
 *
 * Port band 9560–9599.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { type ConnectionState, createRxForwardReq, createRxOneshotReq } from 'rx-nostr';
import { getEventHash, getPublicKey, getSignature } from 'rx-nostr-crypto';
import { QueryClient } from 'tanstack-svelte-query-v6';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { streamedQueryAccumulator } from '$lib/v1/accumulate.js';
import { createAttemptRegistry } from '$lib/v1/attempt.js';
import type { NostrContext } from '$lib/v1/context.svelte.js';
import type { RefreshOutcome, ReqHandle, ReqPlan } from '$lib/v1/index.js';
import type { TransportCapability } from '$lib/v1/lease.js';
import { referenceStream } from '$lib/v1/machine.js';
import { approachFor, phaseOfConnectionState } from '$lib/v1/refusal.js';
import { requestTargets } from '$lib/v1/stream.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import ProvidedRequest from './fixtures/ProvidedRequest.svelte';
import PublishedRequest from './fixtures/PublishedRequest.svelte';
import RequestsInTurn from './fixtures/RequestsInTurn.svelte';
import {
  acceptAnyEvent,
  createTestRelay,
  permanentTransport,
  transportOf
} from './helpers/relay.js';
import { mount } from './helpers/runes.svelte.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  WS.clean();
});

let port = 9560;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Within this of a relay's last step, an answer is the relays' and not a timer's. */
const PROMPTLY_MS = 2000;

/**
 * What the fake clock fakes: the timers and the clocks, and not the promise
 * machinery — microtasks stay native, so Svelte, the query core and the socket
 * mock settle between the steps an arm advances.
 */
const FAKED = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'Date',
  'performance'
] as const;

const SECKEY = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';

/** An event signed correctly over its own fields, as a relay would carry one. */
const signed = (content: string): Nostr.Event => {
  const unsigned = { kind: 1, created_at: 1000, tags: [], content, pubkey: getPublicKey(SECKEY) };
  const id = getEventHash(unsigned);
  return { ...unsigned, id, sig: getSignature(id, SECKEY) };
};

/**
 * The published entry's globals: the socket mock, and no relay metadata. Every
 * socket the dependency constructs is recorded by its url, including one that
 * never opens — which is what a retry against a relay that is gone is. Called
 * again with the same list after a relay server is made, since making one puts
 * the plain mock back.
 */
function stubTheWire(constructed: string[] = []): string[] {
  class Recorded extends MockWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      constructed.push(String(url));
    }
  }
  vi.stubGlobal('WebSocket', Recorded);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  return constructed;
}

/** How many sockets were constructed for `url`. */
const constructedFor = (constructed: readonly string[], url: string): number =>
  constructed.filter((each) => each.startsWith(url)).length;

interface Closable {
  close(options: { code: number }): void;
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

/**
 * Advance the fake clock a step at a time until `done` holds, or `ms` of it
 * have passed — the fake clock's `until`, since a wait on real time would
 * watch a clock that is not moving.
 */
async function advanceUntil(done: () => boolean, ms: number, step = 100): Promise<boolean> {
  for (let spent = 0; spent < ms && !done(); spent += step) await vi.advanceTimersByTimeAsync(step);
  return done();
}

/** The two clocks an arm can run on, behind one pair of calls. */
const clockOf = (fake: boolean) => ({
  wait: fake ? (done: () => boolean, ms: number) => advanceUntil(done, ms) : until,
  pause: fake
    ? async (ms: number): Promise<void> => {
        await vi.advanceTimersByTimeAsync(ms);
      }
    : delay
});

/** A relay the published entry connects to, whose sockets it closes as a relay would. */
function relayAt(url: string) {
  const server = new WS(url, { jsonProtocol: true });
  const sockets: Closable[] = [];
  server.on('connection', (socket) => {
    sockets.push(socket as unknown as Closable);
  });
  const frames = (): unknown[][] => server.messages as unknown[][];
  const reqs = (): string[] =>
    frames()
      .filter((frame) => frame[0] === 'REQ')
      .map((frame) => String(frame[1]));
  /** The subscription names asked of this relay on one leg, each once, first asked first. */
  const names = (leg: 'forward' | 'backward'): string[] => [
    ...new Set(reqs().filter((subId) => subId.includes(leg === 'forward' ? '-f:' : '-b:')))
  ];
  const closeWith = (code: number) => (): void => {
    sockets.at(-1)?.close({ code });
  };
  return {
    url,
    server,
    connections: (): number => sockets.length,
    /** How many sockets to this relay are open now. */
    open: (): number => server.server.clients().length,
    frames: (): number => frames().length,
    reqs,
    names,
    /** Wait until `count` subscriptions have been asked of this relay in all. */
    asked: async (count: number): Promise<void> => {
      await vi.waitFor(
        () => expect(reqs().length, `${url} was asked`).toBeGreaterThanOrEqual(count),
        { timeout: 3000 }
      );
    },
    /** `EOSE` for the latest backlog asked of this relay. */
    answerBacklog: (): void => {
      server.send(['EOSE', names('backward').at(-1)]);
    },
    /** `event` on the latest backlog asked of this relay, which stays open. */
    sendInTheBacklog: (event: Nostr.Event): void => {
      server.send(['EVENT', names('backward').at(-1), event]);
    },
    /** The open socket closed with 4000, which rx-nostr reports as `rejected`. */
    refuse: closeWith(4000),
    /** The open socket closed with rx-nostr's idle code, which it reports as `dormant`. */
    idle: closeWith(4537),
    /** The open socket dropped abnormally (1006), which the shipping policy retries. */
    drop: closeWith(1006),
    /**
     * The server closed and removed, with `code` delivered to every socket in
     * the same turn. With 1006 every retry then fails before it opens.
     */
    shut: (code: number): void => {
      server.close({ code, reason: 'gone', wasClean: false });
    }
  };
}

type Relay = ReturnType<typeof relayAt>;

/** The relays a reading names, by the label the arm gave each. */
type Labels = Readonly<Record<string, string>>;

/**
 * What a handle says, as the rows read it. `named` is which of the arm's
 * relays the leg end's error names, by label; it is absent when the leg end
 * carries no error. `causes` is there only for an incomplete answer.
 */
function readingOf(handle: ReqHandle | undefined, labels: Labels = {}) {
  const state = handle?.state;
  const ended = handle?.diagnostics.legEnded;
  const label = (url: string): string =>
    Object.entries(labels).find(([, each]) => each === url)?.[0] ?? url;
  return {
    status: state?.status,
    events:
      state === undefined || state.status === 'loading'
        ? undefined
        : state.events.map((each) => each.id),
    causes: state?.status === 'incomplete' ? [...state.causes] : undefined,
    legEnded: ended?.kind,
    code: ended?.error?.code,
    named:
      ended?.error === undefined
        ? undefined
        : Object.entries(labels)
            .filter(([, url]) => ended.error?.message.includes(url) === true)
            .map(([name]) => name),
    activity: handle?.activity,
    refusals: handle?.diagnostics.refusals.map((each) => `${each.leg} ${label(each.from)}`)
  };
}

/** A live request whose backlog is answered and whose leg is open. */
const running = (events: string[] = []) => ({
  status: 'settled',
  events,
  causes: undefined,
  legEnded: undefined,
  code: undefined,
  named: undefined,
  activity: 'live',
  refusals: []
});

/** The same request once its leg has ended, naming `named`. */
const stopped = (named: string[], events: string[] = []) => ({
  status: 'settled',
  events,
  causes: undefined,
  legEnded: 'ended',
  code: 'relay-failed',
  named,
  activity: 'idle',
  refusals: []
});

/** A plan that makes a request, which is every plan these arms hand the published entry. */
type RequestPlan = Extract<ReqPlan, { kind: 'request' }>;

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

const live = (namespace: string, kinds: number[], settleTimeoutMs = 30_000): RequestPlan => ({
  kind: 'request',
  descriptor: { filters: [{ kinds }], live: true, retain: 'unbounded', settleTimeoutMs, namespace }
});

const backlog = (namespace: string, kinds: number[], settleTimeoutMs = 30_000): RequestPlan => ({
  kind: 'request',
  descriptor: { filters: [{ kinds }], settleTimeoutMs, namespace }
});

/** What a `refresh()` resolved to, once it had: its kind and, for an incomplete one, the causes. */
const outcomeOf = (outcome: RefreshOutcome | 'pending' | { failed: string }): unknown => {
  if (outcome === 'pending' || 'failed' in outcome) return outcome;
  if (outcome.kind === 'incomplete') return { kind: outcome.kind, causes: [...outcome.causes] };
  return { kind: outcome.kind };
};

/** A `refresh()` started now, and what it has resolved to so far. */
function refreshing(handle: ReqHandle | undefined): () => unknown {
  let outcome: RefreshOutcome | 'pending' | { failed: string } = 'pending';
  void handle?.refresh().then(
    (resolved) => {
      outcome = resolved;
    },
    (error: unknown) => {
      outcome = failed(error);
    }
  );
  return () => outcomeOf(outcome);
}

/** The recording socket stub, and what an arm on the fake clock does to a relay with it. */
interface Wire {
  readonly constructed: string[];
  /** Install the recording stub again, after a relay server has been made. */
  rewire(): void;
  /**
   * Take one relay away for good: closed and removed, so each retry fails
   * before it opens, until the dependency gives up with `error`. Returns once
   * the sixth socket — the fifth retry — has been constructed, which is a
   * little before that state is reached; the clock moves in tenths of a second
   * so the arm can read what follows well inside the provider's first
   * recovery, two seconds after a leg ends (`A13`).
   */
  exhaust(relay: Relay): Promise<boolean>;
}

/**
 * One request through the published entry, handed to `run`, unmounted after.
 * With `onAFakeClock`, the clock is installed before the request is made, so
 * the dependency's retries run on it; it is put back after the unmount.
 */
async function published(
  relays: readonly Relay[],
  plan: ReqPlan,
  run: (handle: () => ReqHandle | undefined, wire: Wire) => Promise<unknown>,
  { onAFakeClock = false }: { onAFakeClock?: boolean } = {}
): Promise<unknown> {
  let handle: ReqHandle | undefined;
  if (onAFakeClock) vi.useFakeTimers({ toFake: [...FAKED] });
  const constructed = stubTheWire();
  const wire: Wire = {
    constructed,
    rewire: () => {
      stubTheWire(constructed);
    },
    exhaust: async (relay) => {
      relay.shut(1006);
      return advanceUntil(() => constructedFor(constructed, relay.url) >= 6, 45_000);
    }
  };
  const view = render(PublishedRequest, {
    relays: relays.map((relay) => relay.url),
    plan: () => plan,
    seen: (request: ReqHandle) => {
      handle = request;
    },
    published: () => {}
  });
  try {
    return await run(() => handle, wire);
  } catch (error) {
    return failed(error);
  } finally {
    view.unmount();
    if (onAFakeClock) {
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
    }
  }
}

describe('A5: what a request does with each relay’s connection', () => {
  // @contracts A5-C2
  it('CS1: a live request whose relays reach terminal connection states ends its leg and names them', async () => {
    // **Two relays, live, the backlog answered by both**, so the answer is
    // whole and the leg's end is the only thing left to report. Then each
    // relay's connection reaches a terminal state, one after the other. After
    // the first the request is still live — one relay stopping is degradation,
    // not the leg's end. After the second the leg end is published, as a relay
    // failure naming **both** relays — not merely the one that went last — the
    // request is no longer live, the answer is as it was, and nothing is
    // recorded as a refusal: these relays never said no.
    //
    // **Twice.** The ordinary death, each relay's retries spent until the
    // dependency gives up with `error`, on a fake clock installed before the
    // request; and each relay refusing the socket with 4000, `rejected`. The
    // last reading is taken as soon as the leg has ended and the request has
    // stopped — well inside the two seconds after which the provider starts a
    // new attempt of its own (`A13`), which is a different row's answer.
    const run = async (how: 'exhausted' | 'refused') => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      const labels = { a: a.url, b: b.url };
      const fake = how === 'exhausted';
      const { wait, pause } = clockOf(fake);
      return published(
        [a, b],
        live(`cs1-${how}`, [1]),
        async (handle, wire) => {
          const asked = await wait(() => a.reqs().length >= 2 && b.reqs().length >= 2, 5000);
          a.answerBacklog();
          b.answerBacklog();
          const answered = await wait(() => handle()?.state.status === 'settled', 2000);
          if (fake) {
            await wire.exhaust(a);
            await pause(2000);
          } else {
            a.refuse();
            await pause(300);
          }
          const afterTheFirst = readingOf(handle(), labels);
          if (fake) await wire.exhaust(b);
          else b.refuse();
          await wait(
            () => handle()?.diagnostics.legEnded !== undefined && handle()?.activity === 'idle',
            PROMPTLY_MS
          );
          return {
            asked,
            answered,
            afterTheFirst,
            afterTheSecond: readingOf(handle(), labels),
            ...(fake
              ? {
                  sockets: [a, b].map((relay) => ({
                    constructed: constructedFor(wire.constructed, relay.url),
                    opened: relay.connections()
                  }))
                }
              : {})
          };
        },
        { onAFakeClock: fake }
      );
    };
    const exhausted = await run('exhausted');
    const refused = await run('refused');
    const reading = {
      asked: true,
      answered: true,
      afterTheFirst: running(),
      afterTheSecond: stopped(['a', 'b'])
    };
    expect(
      { exhausted, refused },
      'the leg ends when every relay has stopped, and its end names each of them'
    ).toEqual({
      exhausted: {
        ...reading,
        sockets: [
          { constructed: 6, opened: 1 },
          { constructed: 6, opened: 1 }
        ]
      },
      refused: reading
    });
  }, 30_000);

  // @contracts A5-C4
  it('CS2: a live request whose relay drops and retries keeps its leg and recovers', async () => {
    // **One relay, live, the backlog answered.** The relay drops the socket
    // abnormally, and the shipping policy waits and reconnects. The request is
    // read while the connection waits to retry, and again once the retry has
    // landed and the dependency has re-sent the live subscription on the new
    // socket under its own name — the premise, asserted, since the re-send is
    // the dependency's (`A5-S2`). At both readings the leg is open and the
    // request is live. Then the relay sends an event on that subscription over
    // the retried socket, and it is shown: the request recovered. **Beside the
    // Then, and not part of it: no second backlog is asked.** The dependency
    // re-sends the live leg and not the backlog — a habit 0002 records (`N2`)
    // rather than a guarantee it owns, and a request that asked its backlog
    // again on a retry would still keep its leg and recover, which is all the
    // row says. Every backward REQ on the wire is counted, so a backlog asked
    // again under the name it had counts as well as one under a new name.
    const a = relayAt(nextUrl());
    const labels = { a: a.url };
    const event = signed('an event on the retried socket');
    const result = await published([a], live('cs2', [1]), async (handle) => {
      await a.asked(2);
      const [forward] = a.names('forward');
      a.answerBacklog();
      const answered = await until(() => handle()?.state.status === 'settled', 2000);
      const connected = a.connections();
      a.drop();
      // The first retry is at least a second away.
      await delay(200);
      const waiting = readingOf(handle(), labels);
      const reconnected = await until(() => a.connections() === connected + 1, 5000);
      const resentUnderItsName = await until(
        () => a.reqs().filter((subId) => subId === forward).length === 2,
        2000
      );
      await delay(100);
      const recovered = readingOf(handle(), labels);
      a.server.send(['EVENT', forward, event]);
      const delivered = await until(
        () => readingOf(handle()).events?.includes(event.id) === true,
        3000
      );
      return {
        answered,
        waiting,
        reconnected,
        resentUnderItsName,
        recovered,
        delivered,
        after: readingOf(handle(), labels),
        backlogsAsked: a.reqs().filter((subId) => subId.includes('-b:')).length
      };
    });
    expect(result, 'the leg stays open through the retry, and the request recovers').toEqual({
      answered: true,
      waiting: running(),
      reconnected: true,
      resentUnderItsName: true,
      recovered: running(),
      delivered: true,
      after: running([event.id]),
      backlogsAsked: 1
    });
  }, 20_000);

  // @contracts A5-C6
  it('CS4: a relay’s idle close ends that relay, the leg ends with the last one, the answer is kept, and refresh() recovers as a new attempt', async () => {
    // **`dormant` is terminal on the leg, and what it ends is that relay.** The
    // relay closes the socket with rx-nostr's idle code while the live
    // subscription is still riding on it. Two runs, one per thing that can
    // still be open when it does:
    // - **One relay, its backlog answered with an event.** The idle close is
    //   the last relay stopping, so the leg ends, its end naming the relay; the
    //   request is no longer live; and the answer is the one it had, `settled`
    //   with the event. **Then `refresh()`**: one new subscription per leg is
    //   asked of the socket that comes back — counted by name, since the
    //   dependency may send a frame twice — neither of them the dead attempt's,
    //   and once the new backlog is answered the call resolves `complete` and
    //   the request is live again.
    // - **Two relays, the backlog open, an event from a in it.** a's idle close
    //   ends a, and the request is still live — b is up — still waiting on the
    //   backlog, the event shown. Then b's: the leg ends naming both, and the
    //   backlog, which neither relay finished, is `incomplete` for that reason,
    //   with the event it had.
    //
    // **On a fake clock, and inside two seconds of each leg's end**, because two
    // seconds after a leg ends with nothing having said no the provider starts a
    // new attempt of its own (`A13`) — so a `refresh()` that did nothing would be
    // covered by that one if the arm waited past it.
    const event = signed('in the backlog before the idle close');
    const answered = async () => {
      const a = relayAt(nextUrl());
      const labels = { a: a.url };
      return published(
        [a],
        live('cs4-answered', [1]),
        async (handle) => {
          const asked = await advanceUntil(() => a.reqs().length >= 2, 5000);
          const dead = { forward: a.names('forward'), backward: a.names('backward') };
          a.sendInTheBacklog(event);
          a.answerBacklog();
          const settled = await advanceUntil(() => handle()?.state.status === 'settled', 2000);
          a.idle();
          await advanceUntil(
            () => handle()?.diagnostics.legEnded !== undefined && handle()?.activity === 'idle',
            PROMPTLY_MS
          );
          const idled = readingOf(handle(), labels);
          const outcome = refreshing(handle());
          const askedAgain = await advanceUntil(
            () => a.names('forward').length === 2 && a.names('backward').length === 2,
            500
          );
          const fresh = {
            forward: a.names('forward').filter((name) => !dead.forward.includes(name)).length,
            backward: a.names('backward').filter((name) => !dead.backward.includes(name)).length
          };
          a.answerBacklog();
          await advanceUntil(() => outcome() !== 'pending', 500);
          return {
            asked,
            settled,
            idled,
            askedAgain,
            fresh,
            outcome: outcome(),
            after: readingOf(handle(), labels)
          };
        },
        { onAFakeClock: true }
      );
    };
    const unfinished = async () => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      const labels = { a: a.url, b: b.url };
      return published(
        [a, b],
        live('cs4-unfinished', [1]),
        async (handle) => {
          const asked = await advanceUntil(
            () => a.reqs().length >= 2 && b.reqs().length >= 2,
            5000
          );
          a.sendInTheBacklog(event);
          const arrived = await advanceUntil(
            () => readingOf(handle()).events?.includes(event.id) === true,
            2000
          );
          a.idle();
          await vi.advanceTimersByTimeAsync(300);
          const afterTheFirst = readingOf(handle(), labels);
          b.idle();
          await advanceUntil(
            () => handle()?.diagnostics.legEnded !== undefined && handle()?.activity === 'idle',
            PROMPTLY_MS
          );
          return { asked, arrived, afterTheFirst, afterTheSecond: readingOf(handle(), labels) };
        },
        { onAFakeClock: true }
      );
    };
    const result = { answered: await answered(), unfinished: await unfinished() };
    expect(
      result,
      'an idle close ends that relay, the leg ends with the last, and the answer is kept'
    ).toEqual({
      answered: {
        asked: true,
        settled: true,
        idled: stopped(['a'], [event.id]),
        askedAgain: true,
        fresh: { forward: 1, backward: 1 },
        outcome: { kind: 'complete' },
        after: running([event.id])
      },
      unfinished: {
        asked: true,
        arrived: true,
        afterTheFirst: { ...running([event.id]), status: 'streaming' },
        afterTheSecond: {
          ...stopped(['a', 'b'], [event.id]),
          status: 'incomplete',
          causes: ['ended']
        }
      }
    });
  }, 20_000);

  // @contracts A5-C7
  it('CS6: refresh() re-opens a relay that ran out of retries, so the attempt reaches it', async () => {
    // **One relay, live, the backlog answered, on a fake clock installed
    // before the request.** The relay goes for good: every retry fails before
    // it opens until the dependency gives up with `error`, and the leg ends —
    // the premise. The relay comes back at the same url, and nothing reopens
    // the socket on its own. **Then `refresh()`**: a socket is opened to the
    // relay, the new attempt's subscriptions are asked on it, and once its
    // backlog is answered the call resolves `complete` with the request live
    // again. An attempt that asked a socket in `error` without re-opening it
    // would send into a queue nobody flushes. **All of it inside two seconds of
    // the leg's end**, after which the provider would re-open the relay with a
    // new attempt of its own (`A13`).
    const url = nextUrl();
    let a = relayAt(url);
    const labels = { a: url };
    const result = await published(
      [a],
      live('cs6', [1]),
      async (handle, wire) => {
        const asked = await advanceUntil(() => a.reqs().length >= 2, 5000);
        a.answerBacklog();
        const answered = await advanceUntil(() => handle()?.state.status === 'settled', 2000);
        const spent = await wire.exhaust(a);
        await advanceUntil(
          () => handle()?.diagnostics.legEnded !== undefined && handle()?.activity === 'idle',
          PROMPTLY_MS
        );
        const ranOut = readingOf(handle(), labels);
        a = relayAt(url);
        wire.rewire();
        const before = constructedFor(wire.constructed, url);
        const outcome = refreshing(handle());
        const reopened = await advanceUntil(() => a.connections() === 1, 500);
        const reached = await advanceUntil(
          () => a.names('forward').length === 1 && a.names('backward').length === 1,
          500
        );
        a.answerBacklog();
        await advanceUntil(() => outcome() !== 'pending', 500);
        return {
          asked,
          answered,
          spent,
          ranOut,
          reopened,
          reached,
          socketsForTheAttempt: constructedFor(wire.constructed, url) - before,
          outcome: outcome(),
          after: readingOf(handle(), labels)
        };
      },
      { onAFakeClock: true }
    );
    expect(result, 'the relay is re-opened, and the attempt reaches it').toEqual({
      asked: true,
      answered: true,
      spent: true,
      ranOut: stopped(['a']),
      reopened: true,
      reached: true,
      socketsForTheAttempt: 1,
      outcome: { kind: 'complete' },
      after: running()
    });
  }, 20_000);

  // @contracts A5-C20
  it('CS8: a relay that stopped stays stopped when it comes back, so the leg ends when the other one does', async () => {
    // **Two relays; the live request under test asks both, its backlog
    // answered.** Relay a reaches a terminal state, and the request is still
    // live — b is up. Then a second request under the same provider, of its
    // own, begins, and its preflight brings a back: a's socket is open again
    // and a is asked. The first request's table must keep a where it was, so
    // when b goes too the leg ends, its end naming both. A table that let the
    // reconnection take a back out of `terminal` never sees every relay
    // terminal at once, and the leg end does not arrive.
    //
    // **Twice, one per way into `terminal`.** Directly: a closes with the idle
    // code, `dormant` without a recovering phase in between, and the second
    // request's REQ wakes it — nothing of the first request is re-sent on the
    // woken socket, so the only write the first request sees is the connection
    // coming back. Through recovery, the ordinary death, on a fake clock: a's
    // retries spent into `error` while b is up, a's server back, and the
    // second request's preflight re-opening it — a retry, after which the
    // dependency re-sends the first request's live subscription on a under its
    // own name, so the first request is asked again there too.
    //
    // **And a's socket stays open through b's death**, read when b goes and
    // again when the leg's end is read — the premise, asserted: a reconnection
    // that failed would put a back in `terminal` under any table, and one that
    // absorbs and one that does not would agree.
    const run = async (how: 'idle' | 'exhausted') => {
      const urlA = nextUrl();
      let a = relayAt(urlA);
      const b = relayAt(nextUrl());
      const labels = { a: urlA, b: b.url };
      const fake = how === 'exhausted';
      const { wait, pause } = clockOf(fake);
      const handles: Partial<Record<'first' | 'second', ReqHandle>> = {};
      const first = live(`cs8-${how}`, [1]);
      const second = backlog(`cs8-${how}-other`, [7]);
      const props = {
        relays: [urlA, b.url],
        first: () => first,
        second: () => second,
        later: false,
        seen: (which: 'first' | 'second', request: ReqHandle) => {
          handles[which] = request;
        }
      };
      if (fake) vi.useFakeTimers({ toFake: [...FAKED] });
      const constructed = stubTheWire();
      const view = render(RequestsInTurn, props);
      try {
        const asked = await wait(() => a.reqs().length >= 2 && b.reqs().length >= 2, 5000);
        const [forward] = a.names('forward');
        a.answerBacklog();
        b.answerBacklog();
        const answered = await wait(() => handles.first?.state.status === 'settled', 2000);
        let gone: boolean;
        if (fake) {
          a.shut(1006);
          gone = await advanceUntil(() => constructedFor(constructed, urlA) >= 6, 45_000, 500);
          await pause(2000);
          a = relayAt(urlA);
          stubTheWire(constructed);
        } else {
          a.idle();
          await pause(300);
          gone = a.connections() === 1;
        }
        const afterTheFirst = readingOf(handles.first, labels);
        const connected = a.connections();
        await view.rerender({ ...props, later: true });
        const back = await wait(
          () =>
            a.connections() === connected + 1 &&
            a.names('backward').length === (fake ? 1 : 2) &&
            (!fake || a.reqs().includes(forward ?? '')),
          5000
        );
        await pause(200);
        const afterItCameBack = readingOf(handles.first, labels);
        // How often the first request's live subscription has been asked of
        // a's server: idle, the one REQ from before a went quiet — nothing is
        // re-sent on a woken socket, the premise that leaves the connection
        // coming back as the only write the first request sees; exhausted, a
        // server made anew, the one re-send.
        const forwardOnA = a.reqs().filter((name) => name === forward).length;
        const openWhenTheOtherDied = a.open();
        b.refuse();
        await wait(() => handles.first?.diagnostics.legEnded !== undefined, PROMPTLY_MS);
        await pause(100);
        return {
          asked,
          answered,
          gone,
          afterTheFirst,
          back,
          afterItCameBack,
          forwardOnA,
          openWhenTheOtherDied,
          // The socket that came back is the one still open: none closed and
          // none opened since.
          stillTheSameSocket: a.open() === 1 && a.connections() === connected + 1,
          afterTheSecond: readingOf(handles.first, labels)
        };
      } catch (error) {
        return failed(error);
      } finally {
        view.unmount();
        if (fake) {
          await vi.advanceTimersByTimeAsync(1000);
          vi.useRealTimers();
        }
      }
    };
    const idle = await run('idle');
    const exhausted = await run('exhausted');
    const reading = {
      asked: true,
      answered: true,
      gone: true,
      afterTheFirst: running(),
      back: true,
      afterItCameBack: running(),
      forwardOnA: 1,
      openWhenTheOtherDied: 1,
      stillTheSameSocket: true,
      afterTheSecond: stopped(['a', 'b'])
    };
    expect(
      { idle, exhausted },
      'a relay recorded terminal stays terminal when it comes back, and the leg ends with the other'
    ).toEqual({ idle: reading, exhausted: reading });
  }, 30_000);
});

describe('A5: what a provider-held transport, and the classifiers, decide', () => {
  // @contracts A5-C5
  it('CS3: a relay added behind the scope after a request began does not keep its leg alive', async () => {
    // **Internal, because it writes the transport the provider holds** — the
    // one thing a consumer cannot reach. One relay in the scope, a live
    // request over it with its backlog answered; then a second relay is added
    // to the provider's transport **behind the scope**, and something else on
    // that transport opens a socket to it. The request's target set was fixed
    // when it started, so the newcomer is nothing to it. **On the wire**: none
    // of the request's subscriptions is asked of it — the dependency re-issues
    // a request routed by its defaults to a relay added to them, so a request
    // that did not route by its own target set would be — and nothing new is
    // asked of the relay it did ask. **In its tables**: a `CLOSED` from the
    // newcomer naming the request's own live subscription is not a refusal of
    // the request and ends nothing. **The control** is the same frame from the
    // relay the request did ask: published as that relay's refusal, and —
    // every relay the request was asking having stopped — the leg ends, naming
    // that relay and not the newcomer, whatever the transport now holds. The
    // scope is the one the request began under throughout, so nothing re-keyed
    // it.
    //
    // **Twice, one per way the relay it was asking stops.** `closed`: that
    // `CLOSED`, a refusal. `dropped`: a's socket dropped with 1006 instead,
    // the connection-state route 0002 calls the ordinary one. The provider is
    // built with the harness's retries off (`HARNESS_DIVERGENCES`), so the drop
    // lands in `error` at once rather than after the shipping policy's
    // retries — the state the ordinary death lands in, written by the same
    // connection-state writer. Nothing is refused there, and the leg ends
    // naming a alone all the same.
    const run = async (how: 'closed' | 'dropped') => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      const labels = { a: a.url, b: b.url };
      let context: NostrContext | undefined;
      let handle: ReqHandle | undefined;
      stubTheWire();
      const view = render(ProvidedRequest, {
        relays: [a.url],
        plan: () => live(`cs3-${how}`, [1]),
        ready: (made: NostrContext) => {
          context = made;
        },
        seen: (request: ReqHandle) => {
          handle = request;
        }
      });
      let elsewhere: { unsubscribe(): void } | undefined;
      try {
        await a.asked(2);
        const [forward] = a.names('forward');
        a.answerBacklog();
        const answered = await until(() => handle?.state.status === 'settled', 2000);
        const scopeOf = () => ({ id: context?.scope.id, urls: context?.scope.urls });
        const scopeAtTheStart = scopeOf();
        const askedOfItsOwn = a.reqs().length;
        const transport = transportOf(context as NostrContext);
        transport.setDefaultRelays([a.url, b.url]);
        const other = createRxForwardReq(`cs3-${how}-elsewhere`);
        elsewhere = transport.use(other, { on: { relays: [b.url] } }).subscribe({});
        other.emit([{ kinds: [30_002] }]);
        const opened = await until(
          () => b.reqs().some((name) => name.startsWith(`cs3-${how}-elsewhere`)),
          3000
        );
        b.server.send(['CLOSED', forward, 'blocked: not a relay this request asked']);
        await delay(300);
        const afterTheNewcomer = readingOf(handle, labels);
        const askedOfItsOwnSince = a.reqs().length - askedOfItsOwn;
        if (how === 'closed') a.server.send(['CLOSED', forward, 'blocked: no']);
        else a.drop();
        await until(() => handle?.diagnostics.legEnded !== undefined, PROMPTLY_MS);
        await delay(100);
        return {
          answered,
          inTheTransport: Object.keys(transport.getDefaultRelays()).length,
          opened,
          // Everything the newcomer was asked, but the other subscription.
          askedOfTheNewcomer: b.reqs().filter((name) => !name.startsWith(`cs3-${how}-elsewhere`)),
          askedOfItsOwnSince,
          afterTheNewcomer,
          afterItsOwn: readingOf(handle, labels),
          // How a stopped: a refusal leaves its socket `connected`, the drop
          // leaves the connection in `error`.
          aIn: transport.getAllRelayStatus()[a.url]?.connection,
          scope: {
            kept: JSON.stringify(scopeOf()) === JSON.stringify(scopeAtTheStart),
            ...scopeAtTheStart,
            urls: scopeAtTheStart.urls?.map((url) => (url === a.url ? 'a' : url))
          }
        };
      } catch (error) {
        return failed(error);
      } finally {
        elsewhere?.unsubscribe();
        view.unmount();
      }
    };
    const closed = await run('closed');
    const dropped = await run('dropped');
    const reading = {
      answered: true,
      inTheTransport: 2,
      opened: true,
      askedOfTheNewcomer: [],
      askedOfItsOwnSince: 0,
      afterTheNewcomer: running(),
      scope: { kept: true, id: expect.any(String), urls: ['a'] }
    };
    expect({ closed, dropped }, 'the leg ends on the target set fixed when it started').toEqual({
      closed: {
        ...reading,
        afterItsOwn: { ...stopped(['a']), refusals: ['forward a'] },
        aIn: 'connected'
      },
      dropped: { ...reading, afterItsOwn: stopped(['a']), aIn: 'error' }
    });
  }, 30_000);

  // @contracts A5-C25
  it('CS5: every connection state rx-nostr reports is classified, initialized as deciding nothing', () => {
    // **The classifier, called directly**, over the dependency's own
    // vocabulary. The nine names are held both ways against rx-nostr's
    // `ConnectionState` — the `DS20` construction — so a state added or
    // removed upstream is a type error here (`npm run check`), not a state with
    // no decision about it. Retrying states keep the leg alive, terminal ones
    // end that relay, `dormant` among them, and `initialized` — a socket that
    // has not been anywhere — decides nothing.
    const NINE = [
      'initialized',
      'connecting',
      'connected',
      'waiting-for-retrying',
      'retrying',
      'dormant',
      'error',
      'rejected',
      'terminated'
    ] as const;
    const _fromDependency: (typeof NINE)[number] = null as unknown as ConnectionState;
    const _toDependency: ConnectionState = null as unknown as (typeof NINE)[number];
    void _fromDependency;
    void _toDependency;

    expect(
      Object.fromEntries(
        NINE.map((state) => [state, phaseOfConnectionState(state) ?? 'decides nothing'])
      ),
      'each state, and the phase it puts a relay in'
    ).toEqual({
      initialized: 'decides nothing',
      connecting: 'recovering',
      connected: 'active',
      'waiting-for-retrying': 'recovering',
      retrying: 'recovering',
      dormant: 'terminal',
      error: 'terminal',
      rejected: 'terminal',
      terminated: 'terminal'
    });
  });

  // @contracts A5-C8
  it('CS7: an attempt about to ask a relay re-opens it, leaves it, fails, or asks it, by how it stopped', async () => {
    // **Internal**: a client of the arm's own with retries off, under the hook
    // the provider builds on, so a relay can be put in each terminal state
    // and the next attempt — `refresh()` — read against it. The relay answers
    // a backlog first; then:
    // - **`error`**: the socket drops and, with retries off, the connection is
    //   left in `error`. The relay comes back at the url. The attempt re-opens
    //   the socket and asks it, and is answered.
    // - **`rejected`**: the relay closed the socket with 4000. The attempt
    //   leaves it alone — no socket, no frame — and its backlog ends on that
    //   relay at once.
    // - **`dormant`**, the ordinary way: once the backlog is answered nothing is
    //   subscribed, and after ten seconds of that the dependency puts the socket
    //   to sleep — on a fake clock installed before the client is made. The
    //   socket is asleep, not gone, so the attempt asks it, which wakes it, and
    //   is answered. **Not a relay's idle close of a live request's socket**:
    //   the end of that leg releases its subscription, the `CLOSE` that sends
    //   wakes the socket, and the attempt meets it `connected` (measured).
    // - **`terminated`**: no entrance in v1, so forced the way `A5-C26` forces
    //   a status — the client's status read overwritten for this relay. The
    //   attempt fails, naming the connection that is terminated.
    //
    // **And the order on `error`**, moved to this row from `A5-C7` because
    // `CS6`, that row's public arm, cannot read it. On the dependency a REQ sent
    // to a socket in `error` waits in a queue a later re-open flushes, so an
    // attempt that asked first and re-opened after would reach the relay all
    // the same. So one more run records the order the attempt calls its
    // transport in: a client of the arm's own with retries off, its socket
    // dropped so the connection is left in `error`, the relay back at the url,
    // and the machine driven directly on a capability that records each
    // `reconnect` and `use` as it passes them on. **The re-open is started
    // before either leg is asked — started, not awaited**: each `use` is
    // recorded with the connection's state as it is called, and that state is
    // `connecting`. An attempt that waited for the socket to open before asking
    // would record `connected` there and the same order, so the order alone
    // could not tell the two apart. Nothing between the preflight's `reconnect`
    // and the two `use` calls yields, so the socket cannot have opened in
    // between. It is a run of this arm rather than an arm of its own because
    // the row's landing is what has to fail when the order breaks.
    //
    // **And the decision in one table**, the classifier called directly over
    // the dependency's nine states: the four terminal ones as above, and every
    // other state asked as it is.
    const attempts = createAttemptRegistry();
    const run = async (how: 'error' | 'rejected' | 'dormant' | 'terminated') => {
      const fake = how === 'dormant';
      const { wait, pause } = clockOf(fake);
      if (fake) vi.useFakeTimers({ toFake: [...FAKED] });
      const url = nextUrl();
      const { rxNostr, server } = createTestRelay(url);
      const sockets: Closable[] = [];
      server.on('connection', (socket) => {
        sockets.push(socket as unknown as Closable);
      });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const { value: handle, destroy } = mount(() =>
        useStreamedReq(() => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace: `cs7-${how}`,
          filters: [{ kinds: [1] }],
          reqIdBase: `cs7-${how}`,
          settleTimeoutMs: 30_000,
          accumulator: streamedQueryAccumulator
        }))
      );
      const backlogs = (relay: WS): string[] =>
        (relay.messages as unknown[][])
          .filter((frame) => frame[0] === 'REQ')
          .map((frame) => String(frame[1]));
      try {
        await wait(() => backlogs(server).length >= 1, 3000);
        server.send(['EOSE', backlogs(server)[0]]);
        const answered = await wait(() => handle.state.status === 'settled', 2000);
        let relay = server;
        let opened = (): number => sockets.length;
        if (how === 'error') {
          server.error({ code: 1006, reason: 'gone', wasClean: false });
          await pause(200);
          relay = new WS(url, { jsonProtocol: true });
          const back: Closable[] = [];
          relay.on('connection', (socket) => {
            back.push(socket as unknown as Closable);
          });
          opened = () => back.length;
        } else if (how === 'terminated') {
          const status = rxNostr.getAllRelayStatus.bind(rxNostr);
          Object.defineProperty(rxNostr, 'getAllRelayStatus', {
            value: () => {
              const each = status();
              const ours = each[url];
              return ours === undefined
                ? each
                : { ...each, [url]: { ...ours, connection: 'terminated' } };
            }
          });
        } else if (how === 'dormant') {
          await pause(11_000);
        } else {
          sockets.at(-1)?.close({ code: 4000 });
          await pause(200);
        }
        const inState = rxNostr.getAllRelayStatus()[url]?.connection;
        const frames = relay.messages.length;
        const socketsBefore = opened();
        const asked = backlogs(relay).length;
        const outcome = refreshing(handle);
        const reached = await wait(() => backlogs(relay).length > asked, 1500);
        if (reached) relay.send(['EOSE', backlogs(relay).at(-1)]);
        await wait(() => outcome() !== 'pending', PROMPTLY_MS);
        return {
          answered,
          inState,
          socketsOpened: opened() - socketsBefore,
          asked: reached,
          frames: relay.messages.length > frames,
          outcome: outcome(),
          namesTheTerminatedConnection:
            handle.diagnostics.lastError?.message.includes(
              `the connection to ${url} is terminated`
            ) === true
        };
      } catch (error) {
        return failed(error);
      } finally {
        destroy();
        rxNostr.dispose();
        if (fake) {
          await vi.advanceTimersByTimeAsync(1000);
          vi.useRealTimers();
        }
      }
    };
    const reopenedFirst = async () => {
      const url = nextUrl();
      const { rxNostr, server } = createTestRelay(url);
      const base = permanentTransport(rxNostr);
      const calls: string[] = [];
      const transport: TransportCapability = {
        get revoked() {
          return base.revoked;
        },
        relayStatus: () => base.relayStatus(),
        defaultRelays: () => base.defaultRelays(),
        reconnect: (relay) => {
          calls.push('reconnect');
          base.reconnect(relay);
        },
        use: (...args) => {
          calls.push(`use ${args[0].rxReqId} while ${base.relayStatus()?.[url]?.connection}`);
          return base.use(...args);
        },
        send: (...args) => base.send(...args),
        onRevoke: (listener) => base.onRevoke(listener),
        outgoingRequests: () => base.outgoingRequests(),
        connectionState: () => base.connectionState(),
        controlMessages: () => base.controlMessages()
      };
      const ac = new AbortController();
      const chunks: string[] = [];
      let opening: { unsubscribe(): void } | undefined;
      let done: Promise<void> | undefined;
      return (async () => {
        try {
          // The socket opened once, by the client and not the capability, then
          // dropped: with retries off the connection is left in `error`.
          opening = rxNostr
            .use(createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'cs7-order-opening' }))
            .subscribe({});
          await server.connected;
          server.error({ code: 1006, reason: 'gone', wasClean: false });
          await delay(200);
          const inState = rxNostr.getAllRelayStatus()[url]?.connection;
          const back = new WS(url, { jsonProtocol: true });
          const asked = (): string[] =>
            (back.messages as unknown[][])
              .filter((frame) => frame[0] === 'REQ')
              .map((frame) => String(frame[1]));
          done = (async () => {
            for await (const chunk of referenceStream({
              transport,
              targets: requestTargets(transport, undefined),
              filters: [{ kinds: [1] }],
              live: true,
              reqIdBase: 'cs7-order',
              signal: ac.signal,
              timeoutMs: 5000,
              verifyEvent: acceptAnyEvent
            })) {
              chunks.push(chunk.type);
            }
          })();
          const reached = await until(
            () =>
              asked().some((name) => name.includes('-f:')) &&
              asked().some((name) => name.includes('-b:')),
            3000
          );
          back.send(['EOSE', asked().find((name) => name.includes('-b:'))]);
          const answered = await until(() => chunks.includes('settled'), 2000);
          return { inState, reached, answered, calls: [...calls] };
        } catch (error) {
          return failed(error);
        } finally {
          ac.abort();
          await done;
          opening?.unsubscribe();
          rxNostr.dispose();
        }
      })();
    };
    const error = await run('error');
    const rejected = await run('rejected');
    const dormant = await run('dormant');
    const terminated = await run('terminated');
    const order = await reopenedFirst();
    const STATES: readonly ConnectionState[] = [
      'initialized',
      'connecting',
      'connected',
      'waiting-for-retrying',
      'retrying',
      'dormant',
      'error',
      'rejected',
      'terminated'
    ];
    const table = Object.fromEntries(STATES.map((state) => [state, approachFor(state)]));
    expect(
      { error, rejected, dormant, terminated, order, table },
      'each terminal state is decided before the relay is asked, and differently'
    ).toEqual({
      error: {
        answered: true,
        inState: 'error',
        socketsOpened: 1,
        asked: true,
        frames: true,
        outcome: { kind: 'complete' },
        namesTheTerminatedConnection: false
      },
      rejected: {
        answered: true,
        inState: 'rejected',
        socketsOpened: 0,
        asked: false,
        frames: false,
        outcome: { kind: 'incomplete', causes: ['ended'] },
        namesTheTerminatedConnection: false
      },
      dormant: {
        answered: true,
        inState: 'dormant',
        socketsOpened: 1,
        asked: true,
        frames: true,
        outcome: { kind: 'complete' },
        namesTheTerminatedConnection: false
      },
      terminated: {
        answered: true,
        inState: 'terminated',
        socketsOpened: 0,
        asked: false,
        frames: false,
        outcome: { kind: 'error' },
        namesTheTerminatedConnection: true
      },
      order: {
        inState: 'error',
        reached: true,
        answered: true,
        calls: ['reconnect', 'use cs7-order-f while connecting', 'use cs7-order-b while connecting']
      },
      table: {
        initialized: 'ask',
        connecting: 'ask',
        connected: 'ask',
        'waiting-for-retrying': 'ask',
        retrying: 'ask',
        dormant: 'ask',
        error: 'reconnect-then-ask',
        rejected: 'give-up',
        terminated: 'disposed'
      }
    });
  }, 20_000);
});
