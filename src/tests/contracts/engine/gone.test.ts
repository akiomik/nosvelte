/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a request answers when the relays it is asking are gone: the landings
 * of `A5-C9` (`GN1`), `A5-C11` (`GN2`), `A5-C14` (`GN3`), `A5-C10` (`GN4`),
 * `A5-C15` (`GN5`) and `A5-C22` (`GN6`).
 *
 * **Through the published entry**, for every row but `A5-C22`: `NostrApp` with
 * `relays` only, so the verifier is the library's, the dependency's retry
 * policy is the one it ships with, and an event a relay sends is signed for
 * real; a consumer's own `useReq` under it; and a relay that goes away the
 * ways a relay can.
 *
 * **Three ways for a relay to go, all over the wire.**
 * - **Refused**: the relay closes the open socket with 4000, DONT_RETRY, and
 *   rx-nostr reports `rejected` at once. The spike forced that state by
 *   overwriting `getAllRelayStatus`, on the reading that the socket mock
 *   cannot refuse a handshake; the state is reached by the close code instead.
 * - **Died**: the relay drops the socket abnormally (1006). The shipping
 *   policy waits a second or so and reconnects, the request is sent again on
 *   the new socket, and the arm reads the request still running there — it is
 *   recovering, which ends nothing — before the relay refuses the retried
 *   socket with 4000. So a death passes through the state every death on a
 *   real network passes through, and ends in `rejected`.
 * - **Exhausted** (`GN3`'s second run): the relay stops accepting, and every
 *   retry fails before it opens, until rx-nostr gives up with `error`. The
 *   retries are about thirty seconds of the dependency's own timers, so that
 *   run is on a fake clock.
 *
 * Every request's own settle timeout is 30s, or 60s where the retries run out,
 * and the arms read well inside it, so an answer that arrives is not the
 * request's own timer.
 *
 * Port band 9520–9559.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { getEventHash, getPublicKey, getSignature } from 'rx-nostr-crypto';
import { QueryClient } from 'tanstack-svelte-query-v6';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import {
  setQueryDataAccumulator,
  type StreamAccumulator,
  streamedQueryAccumulator
} from '$lib/v1/accumulate.js';
import { createAttemptRegistry } from '$lib/v1/attempt.js';
import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import PublishedRequest from './fixtures/PublishedRequest.svelte';
import RequestsInTurn from './fixtures/RequestsInTurn.svelte';
import { acceptAnyEvent, createTestRelay } from './helpers/relay.js';
import { mount } from './helpers/runes.svelte.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  WS.clean();
});

let port = 9520;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Within this of the last relay going, an answer is the relays' and not the timer's. */
const PROMPTLY_MS = 2000;

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
 * never opens — which is what a retry against a relay that is gone is.
 */
function stubTheWire(): string[] {
  const constructed: string[] = [];
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

interface Closable {
  close(options: { code: number }): void;
}

/** A relay the published entry connects to, whose sockets it closes as a relay would. */
function relayAt(url: string) {
  const server = new WS(url, { jsonProtocol: true });
  const sockets: Closable[] = [];
  server.on('connection', (socket) => {
    sockets.push(socket as unknown as Closable);
  });
  const reqs = (): string[] =>
    (server.messages as unknown[][])
      .filter((frame) => frame[0] === 'REQ')
      .map((frame) => String(frame[1]));
  return {
    url,
    server,
    connections: (): number => sockets.length,
    reqs,
    /** Wait until `count` subscriptions have been asked of this relay in all. */
    asked: async (count: number): Promise<void> => {
      await vi.waitFor(
        () => expect(reqs().length, `${url} was asked`).toBeGreaterThanOrEqual(count),
        {
          timeout: 3000
        }
      );
    },
    /** The open socket closed with 4000, which rx-nostr reports as `rejected`. */
    refuse: (): void => {
      sockets.at(-1)?.close({ code: 4000 });
    },
    /**
     * The open socket dropped abnormally, and this waits for the shipping
     * policy to reconnect and for the request to be sent again on the new
     * socket — so it returns with the relay recovering, not gone.
     */
    drop: async (): Promise<void> => {
      const connected = sockets.length;
      const asked = reqs().length;
      sockets.at(-1)?.close({ code: 1006 });
      await vi.waitFor(
        () => {
          expect(sockets.length, `${url} reconnected`).toBe(connected + 1);
          expect(reqs().length, `${url} was asked again`).toBeGreaterThan(asked);
        },
        { timeout: 5000 }
      );
    }
  };
}

type Relay = ReturnType<typeof relayAt>;

/** A relay that dies: dropped, recovering, and then refused on the retried socket. */
async function dies(relay: Relay, whileRecovering: () => void): Promise<void> {
  await relay.drop();
  whileRecovering();
  relay.refuse();
}

/** What a handle says, as the rows read it. */
function readingOf(handle: ReqHandle | undefined) {
  const state = handle?.state;
  return {
    status: state?.status,
    causes: state?.status === 'incomplete' ? [...state.causes] : undefined,
    events:
      state === undefined || state.status === 'loading'
        ? undefined
        : state.events.map((each) => each.id),
    legEnded: handle?.diagnostics.legEnded?.kind,
    activity: handle?.activity
  };
}

/** The relays a published leg end names, in the order given. */
const namedBy = (handle: ReqHandle | undefined, relays: readonly Relay[]): string[] =>
  relays
    .map((relay) => relay.url)
    .filter((url) => handle?.diagnostics.legEnded?.error?.message.includes(url) === true);

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

/**
 * Two requests under one provider: the first opens the relays' sockets, `before`
 * does what it does to them, and the second — under its own namespace and
 * filters, so it is a request of its own and not a read of the first one's
 * answer — begins only then.
 */
async function inTurn(
  relays: readonly Relay[],
  second: RequestPlan,
  before: () => Promise<void>,
  read: (second: ReqHandle | undefined, framesBefore: number[]) => Promise<unknown>
): Promise<unknown> {
  const handles: Partial<Record<'first' | 'second', ReqHandle>> = {};
  const first = backlog(`${second.descriptor.namespace ?? ''}-opener`, [30_001]);
  const props = {
    relays: relays.map((relay) => relay.url),
    first: () => first,
    second: () => second,
    later: false,
    seen: (which: 'first' | 'second', request: ReqHandle) => {
      handles[which] = request;
    }
  };
  stubTheWire();
  const view = render(RequestsInTurn, props);
  try {
    for (const relay of relays) await relay.asked(1);
    await before();
    const framesBefore = relays.map((relay) => relay.reqs().length);
    await view.rerender({ ...props, later: true });
    return await read(handles.second, framesBefore);
  } catch (error) {
    return failed(error);
  } finally {
    view.unmount();
  }
}

/** One request through the published entry, handed to `run`, unmounted after. */
async function published(
  relays: readonly Relay[],
  plan: ReqPlan,
  run: (handle: () => ReqHandle | undefined, constructed: readonly string[]) => Promise<unknown>
): Promise<unknown> {
  let handle: ReqHandle | undefined;
  const constructed = stubTheWire();
  const view = render(PublishedRequest, {
    relays: relays.map((relay) => relay.url),
    plan: () => plan,
    seen: (request: ReqHandle) => {
      handle = request;
    },
    published: () => {}
  });
  try {
    return await run(() => handle, constructed);
  } catch (error) {
    return failed(error);
  } finally {
    view.unmount();
  }
}

/** Wait, within a bound, for the request to have an answer that is not still coming. */
async function answered(handle: () => ReqHandle | undefined, within = PROMPTLY_MS): Promise<void> {
  await vi.waitFor(
    () => {
      expect(handle()?.state.status, 'the request answered').toBe('incomplete');
      expect(handle()?.activity, 'and stopped').toBe('idle');
    },
    { timeout: within }
  );
}

describe('A5: the relays a request is asking are gone', () => {
  // @contracts A5-C9
  it('GN1: a live request whose whole target set was terminal before it began ends its leg on its own check', async () => {
    // **The leg ends because the request looked, not because something
    // happened.** Both relays refuse the first request's sockets, and only then
    // does the live request under test begin, under the same provider: no
    // transition is still to come, so a request that waited for one would
    // wait for ever. It reads the leg end published naming both relays, the
    // answer `incomplete` under `ended`, the invocation over, and nothing sent
    // for it — no frame and no socket — inside two seconds of a 30s timeout.
    //
    // **And the control: one relay of the two refused**, so the whole set is
    // not terminal. The second request is asked of the relay that is left,
    // and at the same horizon it is still running with no leg end — the end
    // above is the whole set being gone, not the arrangement.
    const run = async (refused: 'both' | 'one') => {
      const relays = [relayAt(nextUrl()), relayAt(nextUrl())];
      const connected = () => relays.map((relay) => relay.connections());
      let connectedBefore: number[] = [];
      return inTurn(
        relays,
        live(`gn1-${refused}`, [7]),
        async () => {
          for (const relay of refused === 'both' ? relays : relays.slice(0, 1)) relay.refuse();
          await delay(100);
          connectedBefore = connected();
        },
        async (second, framesBefore) => {
          if (refused === 'both') {
            await vi.waitFor(
              () => expect(second?.diagnostics.legEnded, 'the leg end').toBeDefined(),
              { timeout: PROMPTLY_MS }
            );
            await answered(() => second);
          } else {
            const remaining = relays[1] as Relay;
            await remaining.asked((framesBefore[1] ?? 0) + 2);
            await delay(PROMPTLY_MS);
          }
          return {
            ...readingOf(second),
            relaysNamed: namedBy(second, relays).length,
            framesSent: relays.map((relay, at) => relay.reqs().length - (framesBefore[at] ?? 0)),
            socketsOpened: connected().map((count, at) => count - (connectedBefore[at] ?? 0))
          };
        }
      );
    };
    const wholeSet = await run('both');
    const oneOfTwo = await run('one');
    expect(
      { wholeSet, oneOfTwo },
      'the leg ends on the request’s own check when every relay was already gone, and not when one was'
    ).toEqual({
      wholeSet: {
        status: 'incomplete',
        causes: ['ended'],
        events: [],
        legEnded: 'ended',
        activity: 'idle',
        relaysNamed: 2,
        framesSent: [0, 0],
        socketsOpened: [0, 0]
      },
      oneOfTwo: {
        status: 'loading',
        causes: undefined,
        events: undefined,
        legEnded: undefined,
        activity: 'live',
        relaysNamed: 0,
        framesSent: [0, 2],
        socketsOpened: [0, 0]
      }
    });
  }, 20_000);

  // @contracts A5-C11
  it('GN2: a backlog over a relay that refused the connection before it began ends on that relay, not on the timer', async () => {
    // **The answer comes from the relay's state, inside two seconds of a 30s
    // timeout.** The relay refuses the first request's socket, and only then
    // does the non-live request under test begin: `incomplete` under `ended`,
    // the invocation over, nothing sent for it. **The control** is the same
    // arrangement with the relay left connected and silent: the request is
    // asked of it, and at the same horizon it is still waiting.
    const run = async (refused: boolean) => {
      const relay = relayAt(nextUrl());
      return inTurn(
        [relay],
        backlog(`gn2-${String(refused)}`, [7]),
        async () => {
          if (refused) relay.refuse();
          await delay(100);
        },
        async (second, framesBefore) => {
          if (refused) await answered(() => second);
          else {
            await relay.asked((framesBefore[0] ?? 0) + 1);
            await delay(PROMPTLY_MS);
          }
          return {
            ...readingOf(second),
            framesSent: relay.reqs().length - (framesBefore[0] ?? 0)
          };
        }
      );
    };
    const refused = await run(true);
    const silent = await run(false);
    expect(
      { refused, silent },
      'a relay that refused before the request began ends its backlog, and a silent one does not'
    ).toEqual({
      refused: {
        status: 'incomplete',
        causes: ['ended'],
        events: [],
        legEnded: undefined,
        activity: 'idle',
        framesSent: 0
      },
      silent: {
        status: 'loading',
        causes: undefined,
        events: undefined,
        legEnded: undefined,
        activity: 'refreshing',
        framesSent: 1
      }
    });
  }, 20_000);

  // @contracts A5-C14
  it('GN3: one connection state that decides both the backlog and the live leg still leaves an outcome', async () => {
    // **One relay, live, and it goes while both of its subscriptions are
    // open**, so the one packet that says so determines the backlog and ends
    // the forward leg together. The attempt reports an outcome — `incomplete`
    // under `ended` — beside the leg end, and does not stop carrying only the
    // leg end. **Twice**: the relay dying, which ends in `rejected`; and the
    // relay going for good, every retry failing before it opens until the
    // dependency gives up with `error` — on a fake clock, under a 60s timeout
    // the retries stay inside.
    const died = await (async () => {
      const relay = relayAt(nextUrl());
      return published([relay], live('gn3-died', [1]), async (handle) => {
        await relay.asked(2);
        let whileRecovering: unknown;
        await dies(relay, () => {
          whileRecovering = readingOf(handle());
        });
        await answered(handle);
        return { whileRecovering, after: readingOf(handle()) };
      });
    })();
    const exhausted = await (async () => {
      const relay = relayAt(nextUrl());
      return published([relay], live('gn3-exhausted', [1], 60_000), async (handle, constructed) => {
        await relay.asked(2);
        vi.useFakeTimers();
        // Closed and removed: every reconnection fails before it opens, so the
        // retry count is never reset by a socket that opened.
        relay.server.close({ code: 1006, reason: 'gone', wasClean: false });
        for (let step = 0; step < 90 && handle()?.state.status !== 'incomplete'; step += 1)
          await vi.advanceTimersByTimeAsync(500);
        await vi.advanceTimersByTimeAsync(500);
        vi.useRealTimers();
        // The first socket and the dependency's five retries, none of which opened.
        return {
          socketsConstructed: constructed.filter((url) => url.startsWith(relay.url)).length,
          socketsOpened: relay.connections(),
          after: readingOf(handle())
        };
      });
    })();
    const outcome = {
      status: 'incomplete',
      causes: ['ended'],
      events: [],
      legEnded: 'ended',
      activity: 'idle'
    };
    expect(
      { died, exhausted },
      'the attempt reports its backlog’s outcome beside the leg end, however the relay went'
    ).toEqual({
      died: {
        whileRecovering: {
          status: 'loading',
          causes: undefined,
          events: undefined,
          legEnded: undefined,
          activity: 'live'
        },
        after: outcome
      },
      exhausted: { socketsConstructed: 6, socketsOpened: 1, after: outcome }
    });
  }, 30_000);

  // @contracts A5-C10
  it('GN4: a live request whose relays all die while its backlog is open is incomplete because the leg ended, keeping what arrived', async () => {
    // **Two relays, live, and an event from one of them on the forward leg
    // before either answers the backlog.** Then each dies in turn. After the
    // first, the request is still running — one relay is not the request.
    // After the second, the answer is `incomplete` under `ended` alone — the
    // leg ended, the request did not stop waiting — with the event still
    // shown, and the leg end published.
    const a = relayAt(nextUrl());
    const b = relayAt(nextUrl());
    const event = signed('an event the second relay sends live');
    const reading = await published([a, b], live('gn4', [1]), async (handle) => {
      await a.asked(2);
      await b.asked(2);
      const forward = b.reqs().find((subId) => subId.includes('-f:'));
      b.server.send(['EVENT', forward, event]);
      await vi.waitFor(() => expect(readingOf(handle()).events).toEqual([event.id]), {
        timeout: 3000
      });
      const steps: Record<string, unknown> = {};
      await dies(a, () => {
        steps['whileTheFirstRecovers'] = readingOf(handle());
      });
      await delay(200);
      steps['afterTheFirst'] = readingOf(handle());
      await dies(b, () => {
        steps['whileTheSecondRecovers'] = readingOf(handle());
      });
      await answered(handle);
      steps['afterTheSecond'] = {
        ...readingOf(handle()),
        relaysNamed: namedBy(handle(), [a, b]).length
      };
      return steps;
    });
    const running = {
      status: 'streaming',
      causes: undefined,
      events: [event.id],
      legEnded: undefined,
      activity: 'live'
    };
    expect(reading, 'incomplete because the leg ended, with what arrived still shown').toEqual({
      whileTheFirstRecovers: running,
      afterTheFirst: running,
      whileTheSecondRecovers: running,
      afterTheSecond: {
        status: 'incomplete',
        causes: ['ended'],
        events: [event.id],
        legEnded: 'ended',
        activity: 'idle',
        relaysNamed: 2
      }
    });
  }, 30_000);

  // @contracts A5-C15
  it('GN5: a request over two relays whose connections both die before either answers is incomplete because the leg ended', async () => {
    // **Not live, two relays, neither answers.** Each dies in turn, and each is
    // read while it is recovering — the retried socket held open, the request
    // sent again on it — so a recovering relay counted as gone is caught where
    // it would answer early. After the first death the request is still
    // waiting for the other relay; after the second it is `incomplete` under
    // `ended`, the timer thirty seconds away.
    const a = relayAt(nextUrl());
    const b = relayAt(nextUrl());
    const reading = await published([a, b], backlog('gn5', [1]), async (handle) => {
      await a.asked(1);
      await b.asked(1);
      const steps: Record<string, unknown> = {};
      await dies(a, () => {
        steps['whileTheFirstRecovers'] = readingOf(handle());
      });
      await delay(200);
      steps['afterTheFirst'] = readingOf(handle());
      await dies(b, () => {
        steps['whileTheSecondRecovers'] = readingOf(handle());
      });
      await answered(handle);
      steps['afterTheSecond'] = readingOf(handle());
      return steps;
    });
    const waiting = {
      status: 'loading',
      causes: undefined,
      events: undefined,
      legEnded: undefined,
      activity: 'refreshing'
    };
    expect(
      reading,
      'incomplete because the leg ended, not because the request stopped waiting'
    ).toEqual({
      whileTheFirstRecovers: waiting,
      afterTheFirst: waiting,
      whileTheSecondRecovers: waiting,
      afterTheSecond: {
        status: 'incomplete',
        causes: ['ended'],
        events: [],
        legEnded: undefined,
        activity: 'idle'
      }
    });
  }, 30_000);
});

describe('A5: the same death, on either accumulator', () => {
  // @contracts A5-C22
  it('GN6: two relays whose connections both die leave the answer incomplete on either accumulator', async () => {
    // **The accumulation seam is not published**, so this is the hook the
    // provider builds on, handed each shipping accumulator in turn, over a
    // client of the arm's own with retries off — each death is `error` at
    // once. The answer is read once the invocation is over, so an incomplete
    // value the accumulator published on the way and then replaced is not
    // read as its answer.
    const attempts = createAttemptRegistry();
    const run = async (name: string, accumulator: StreamAccumulator) => {
      const first = nextUrl();
      const second = nextUrl();
      const { rxNostr, server } = createTestRelay(first);
      const other = new WS(second, { jsonProtocol: true });
      rxNostr.setDefaultRelays([first, second]);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const { value: handle, destroy } = mount(() =>
        useStreamedReq(() => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace: `gn6-${name}`,
          filters: [{ kinds: [1] }],
          reqIdBase: `gn6-${name}`,
          settleTimeoutMs: 30_000,
          accumulator
        }))
      );
      try {
        const asked = (relay: WS) =>
          vi.waitFor(
            () =>
              expect((relay.messages as unknown[][]).some((frame) => frame[0] === 'REQ')).toBe(
                true
              ),
            { timeout: 3000 }
          );
        await asked(server);
        await asked(other);
        server.error({ code: 1006, reason: 'gone', wasClean: false });
        await delay(200);
        const afterTheFirst = readingOf(handle);
        other.error({ code: 1006, reason: 'gone', wasClean: false });
        await answered(() => handle);
        return { afterTheFirst, afterTheSecond: readingOf(handle) };
      } catch (error) {
        return failed(error);
      } finally {
        destroy();
        rxNostr.dispose();
      }
    };
    const streamed = await run('streamed', streamedQueryAccumulator);
    const fallback = await run('fallback', setQueryDataAccumulator);
    const reading = {
      afterTheFirst: {
        status: 'loading',
        causes: undefined,
        events: undefined,
        legEnded: undefined,
        activity: 'refreshing'
      },
      afterTheSecond: {
        status: 'incomplete',
        causes: ['ended'],
        events: [],
        legEnded: undefined,
        activity: 'idle'
      }
    };
    expect(
      { streamed, fallback },
      'the report is the leg’s, whichever accumulator folds it'
    ).toEqual({
      streamed: reading,
      fallback: reading
    });
  }, 20_000);
});
