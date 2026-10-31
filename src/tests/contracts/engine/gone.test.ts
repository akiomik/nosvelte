/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a request answers when the relays it is asking are gone: the landings
 * of `A5-C9` (`GN1`), `A5-C11` (`GN2`), `A5-C14` (`GN3`), `A5-C10` (`GN4`),
 * `A5-C15` (`GN5`), `A5-C22` (`GN6`), `A5-C12` (`GN7`) and `A5-C13` (`GN8`).
 *
 * **Through the published entry**, for every row but `A5-C22`: `NostrApp` with
 * `relays` only, so the verifier is the library's, the dependency's retry
 * policy is the one it ships with, and an event a relay sends is signed for
 * real; a consumer's own `useReq` under it; and a relay that goes away the
 * ways a relay can.
 *
 * **Three ways for a relay to go, all over the wire.**
 * - **Refused**: the relay closes the open socket with 4000, DONT_RETRY. That
 *   is the only way into rx-nostr's `rejected`: the dependency sets it for that
 *   close code and nothing else. The socket mock can refuse a handshake too,
 *   but it closes with 1000, which rx-nostr retries. The spike forced
 *   `rejected` by overwriting `getAllRelayStatus` instead.
 * - **Died**: the relay drops the socket abnormally (1006). The shipping
 *   policy waits a second or so and reconnects, and the request is sent again
 *   on the new socket. The arm reads the request while the relay waits to
 *   retry and again once it has, before the relay refuses the retried socket
 *   with 4000. That is one terminal loss — through recovery into `rejected` —
 *   and not the ordinary one.
 * - **Exhausted**: the ordinary one. The relay stops accepting, every retry
 *   fails before it opens, and rx-nostr gives up with `error` once its five
 *   retries are spent — about thirty seconds of its own timers. Those runs are
 *   on a fake clock installed before the request is made, so the request's own
 *   timer runs on the same clock and is set above the retries, at 60s.
 *
 * Every other request's own settle timeout is 30s, and the arms read well
 * inside it, so an answer that arrives is not the request's own timer.
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

/**
 * What the fake clock fakes: the timers and the clocks, and not the promise
 * machinery — microtasks and `nextTick` stay native, so Svelte, the query core
 * and the socket mock settle between the steps the arm advances.
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
  return {
    url,
    server,
    connections: (): number => sockets.length,
    frames: (): number => frames().length,
    reqs,
    /** Wait until `count` subscriptions have been asked of this relay in all. */
    asked: async (count: number): Promise<void> => {
      await vi.waitFor(
        () => expect(reqs().length, `${url} was asked`).toBeGreaterThanOrEqual(count),
        { timeout: 3000 }
      );
    },
    /** The open socket closed with 4000, which rx-nostr reports as `rejected`. */
    refuse: (): void => {
      sockets.at(-1)?.close({ code: 4000 });
    },
    /** The open socket dropped abnormally (1006), which the shipping policy retries. */
    drop: (): void => {
      sockets.at(-1)?.close({ code: 1006 });
    },
    /**
     * The server closed and removed, with `code` delivered to every socket in
     * the same turn — the close a socket's own proxy delivers later. With 1006
     * every retry then fails before it opens.
     */
    shut: (code: number): void => {
      server.close({ code, reason: 'gone', wasClean: false });
    }
  };
}

type Relay = ReturnType<typeof relayAt>;

/**
 * A relay that dies: dropped abnormally, read while it waits to retry and
 * again once it has reconnected and been asked, then ended by `end` — refused
 * on the retried socket unless the arm says otherwise. What the wire did is
 * returned rather than thrown, so a reading taken before a step that did not
 * happen is still reported.
 */
async function dies(
  relay: Relay,
  read: (when: 'waiting' | 'recovering') => void,
  end: () => void = () => relay.refuse()
): Promise<{ reconnected: boolean; askedAgain: boolean }> {
  const connected = relay.connections();
  const asked = relay.reqs().length;
  relay.drop();
  // The first retry is at least a second away.
  await delay(200);
  read('waiting');
  const reconnected = await until(() => relay.connections() === connected + 1, 5000);
  const askedAgain = await until(() => relay.reqs().length > asked, 2000);
  read('recovering');
  end();
  return { reconnected, askedAgain };
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

/** What reached each relay after a moment: every frame, and every socket constructed for it. */
interface Since {
  frames: number[];
  sockets: number[];
}

/**
 * Two requests under one provider: the first opens the relays' sockets, `before`
 * does what it does to them, and the second — under its own namespace and
 * filters, so it is a request of its own and not a read of the first one's
 * answer — begins only then. `read` is handed what reached each relay from
 * that moment on.
 */
async function inTurn(
  relays: readonly Relay[],
  second: RequestPlan,
  before: () => Promise<void>,
  read: (second: ReqHandle | undefined, since: () => Since) => Promise<unknown>
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
  const constructed = stubTheWire();
  const view = render(RequestsInTurn, props);
  try {
    for (const relay of relays) await relay.asked(1);
    await before();
    const frames = relays.map((relay) => relay.frames());
    const sockets = relays.map((relay) => constructedFor(constructed, relay.url));
    await view.rerender({ ...props, later: true });
    return await read(handles.second, () => ({
      frames: relays.map((relay, at) => relay.frames() - (frames[at] ?? 0)),
      sockets: relays.map(
        (relay, at) => constructedFor(constructed, relay.url) - (sockets[at] ?? 0)
      )
    }));
  } catch (error) {
    return failed(error);
  } finally {
    view.unmount();
  }
}

/**
 * One request through the published entry, handed to `run`, unmounted after.
 * With `onAFakeClock`, the clock is installed before the request is made, so
 * the request's own settle timer runs on the same clock as the dependency's
 * retries; it is put back after the unmount.
 */
async function published(
  relays: readonly Relay[],
  plan: ReqPlan,
  run: (handle: () => ReqHandle | undefined, constructed: readonly string[]) => Promise<unknown>,
  { onAFakeClock = false }: { onAFakeClock?: boolean } = {}
): Promise<unknown> {
  let handle: ReqHandle | undefined;
  if (onAFakeClock) vi.useFakeTimers({ toFake: [...FAKED] });
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
    if (onAFakeClock) {
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
    }
  }
}

/**
 * Every relay taken away for good, together, on the fake clock `published`
 * installed: closed and removed, so each retry fails before it opens and the
 * retry count is never reset by a socket that opened, until the dependency
 * gives up with `error`. Together, because one relay's retries after
 * another's could outrun a 60s timer. Returns once the request has answered
 * and stopped, or the retries' thirty-odd seconds and some have passed.
 */
async function exhaust(
  relays: readonly Relay[],
  handle: () => ReqHandle | undefined
): Promise<void> {
  for (const relay of relays) relay.shut(1006);
  await advanceUntil(
    () => handle()?.state.status === 'incomplete' && handle()?.activity === 'idle',
    45_000,
    500
  );
}

/** The sockets each relay saw on an exhausted run: the first, and five retries that never opened. */
const exhaustedSockets = (relays: readonly Relay[], constructed: readonly string[]) =>
  relays.map((relay) => ({
    constructed: constructedFor(constructed, relay.url),
    opened: relay.connections()
  }));

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

/** The outcome every death in this file ends in, read once the request has stopped. */
const endedWith = (events: string[], legEnded: 'ended' | undefined) => ({
  status: 'incomplete',
  causes: ['ended'],
  events,
  legEnded,
  activity: 'idle'
});

describe('A5: the relays a request is asking are gone', () => {
  // @contracts A5-C9
  it('GN1: a live request whose whole target set had refused the connection before it began ends its leg on its own check', async () => {
    // **The leg ends because the request looked, not because something
    // happened.** Both relays refuse the first request's sockets, and only then
    // does the live request under test begin, under the same provider: no
    // transition is still to come, so a request that waited for one would
    // wait for ever. It reads the leg end published, the answer `incomplete`
    // under `ended`, the invocation over, and nothing reaching either relay for
    // it — no frame of any kind and no socket constructed — inside two seconds
    // of a 30s timeout.
    //
    // **Two controls, one on each edge of "refused".** One relay of the two
    // refused: the second request is asked of the relay that is left, and at
    // the same horizon it is still running with no leg end. And both relays in
    // `error` instead — their retries spent, which is terminal too — and back
    // up by the time the second request begins: the preflight re-opens them
    // and asks them, rather than giving up, so that request is running as
    // well. That run is on a fake clock, since the retries are thirty-odd
    // seconds of the dependency's own timers.
    const run = async (refused: 'both' | 'one') => {
      const relays = [relayAt(nextUrl()), relayAt(nextUrl())];
      return inTurn(
        relays,
        live(`gn1-${refused}`, [7]),
        async () => {
          for (const relay of refused === 'both' ? relays : relays.slice(0, 1)) relay.refuse();
          await delay(100);
        },
        async (second, since) => {
          if (refused === 'both') {
            await vi.waitFor(
              () => expect(second?.diagnostics.legEnded, 'the leg end').toBeDefined(),
              { timeout: PROMPTLY_MS }
            );
            await answered(() => second);
          } else {
            const remaining = relays[1] as Relay;
            await until(() => (since().frames[1] ?? 0) >= 2, 3000);
            await delay(PROMPTLY_MS);
            return {
              ...readingOf(second),
              askedOfTheRemaining: remaining.reqs().length >= 3,
              ...since()
            };
          }
          return { ...readingOf(second), ...since() };
        }
      );
    };
    const inError = async () => {
      const urls = [nextUrl(), nextUrl()];
      let relays = urls.map(relayAt);
      const handles: Partial<Record<'first' | 'second', ReqHandle>> = {};
      const first = backlog('gn1-error-opener', [30_001], 60_000);
      const second = live('gn1-error', [7]);
      const props = {
        relays: urls,
        first: () => first,
        second: () => second,
        later: false,
        seen: (which: 'first' | 'second', request: ReqHandle) => {
          handles[which] = request;
        }
      };
      vi.useFakeTimers({ toFake: [...FAKED] });
      const constructed = stubTheWire();
      const view = render(RequestsInTurn, props);
      try {
        const asked = await advanceUntil(
          () => relays.every((relay) => relay.reqs().length >= 1),
          5000
        );
        for (const relay of relays) relay.shut(1006);
        // The retries spent on both relays: six sockets each, and the opener
        // over, with its own timer twice as far off as the retries.
        const spent = await advanceUntil(
          () =>
            urls.every((url) => constructedFor(constructed, url) >= 6) &&
            handles.first?.activity === 'idle',
          45_000,
          500
        );
        await vi.advanceTimersByTimeAsync(1000);
        const opener = readingOf(handles.first);
        // The relays come back; making their servers puts the plain mock back,
        // so the recording one is installed again over the same list.
        relays = urls.map(relayAt);
        stubTheWire(constructed);
        await view.rerender({ ...props, later: true });
        const reopenedAndAsked = await advanceUntil(
          () => relays.every((relay) => relay.connections() === 1 && relay.reqs().length >= 2),
          5000
        );
        await vi.advanceTimersByTimeAsync(PROMPTLY_MS);
        return { asked, spent, opener, reopenedAndAsked, ...readingOf(handles.second) };
      } catch (error) {
        return failed(error);
      } finally {
        view.unmount();
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();
      }
    };
    const wholeSet = await run('both');
    const oneOfTwo = await run('one');
    const reopened = await inError();
    expect(
      { wholeSet, oneOfTwo, reopened },
      'the leg ends on the request’s own check when every relay had refused, and not when one had or when they were in error'
    ).toEqual({
      wholeSet: { ...endedWith([], 'ended'), frames: [0, 0], sockets: [0, 0] },
      oneOfTwo: {
        status: 'loading',
        causes: undefined,
        events: undefined,
        legEnded: undefined,
        activity: 'live',
        askedOfTheRemaining: true,
        frames: [0, 2],
        sockets: [0, 0]
      },
      reopened: {
        asked: true,
        spent: true,
        opener: endedWith([], undefined),
        reopenedAndAsked: true,
        status: 'loading',
        causes: undefined,
        events: undefined,
        legEnded: undefined,
        activity: 'live'
      }
    });
  }, 30_000);

  // @contracts A5-C11
  it('GN2: a backlog over a relay that refused the connection before it began ends on that relay, not on the timer', async () => {
    // **The answer comes from the relay's state, inside two seconds of a 30s
    // timeout.** The relay refuses the first request's socket, and only then
    // does the non-live request under test begin: `incomplete` under `ended`,
    // the invocation over, and nothing reaching the relay for it — no frame
    // and no socket. **The control** is the same arrangement with the relay
    // left connected and silent: the request is asked of it, and at the same
    // horizon it is still waiting.
    const run = async (refused: boolean) => {
      const relay = relayAt(nextUrl());
      return inTurn(
        [relay],
        backlog(`gn2-${String(refused)}`, [7]),
        async () => {
          if (refused) relay.refuse();
          await delay(100);
        },
        async (second, since) => {
          if (refused) await answered(() => second);
          else {
            await until(() => (since().frames[0] ?? 0) >= 1, 3000);
            await delay(PROMPTLY_MS);
          }
          return { ...readingOf(second), ...since() };
        }
      );
    };
    const refused = await run(true);
    const silent = await run(false);
    expect(
      { refused, silent },
      'a relay that refused before the request began ends its backlog, and a silent one does not'
    ).toEqual({
      refused: { ...endedWith([], undefined), frames: [0], sockets: [0] },
      silent: {
        status: 'loading',
        causes: undefined,
        events: undefined,
        legEnded: undefined,
        activity: 'refreshing',
        frames: [1],
        sockets: [0]
      }
    });
  }, 20_000);

  // @contracts A5-C14
  it('GN3: one connection state that decides both the backlog and the live leg still leaves an outcome', async () => {
    // **One relay, live, and it goes while both of its subscriptions are
    // open**, so the one packet that says so determines the backlog and ends
    // the forward leg together. The attempt reports an outcome — `incomplete`
    // under `ended` — beside the leg end, and does not stop carrying only the
    // leg end. **Twice**: the relay dying, read while it waits to retry and
    // once it has, which ends in `rejected`; and the relay going for good, its
    // retries spent until the dependency gives up with `error` — on a fake
    // clock installed before the request is made, under a 60s timeout on that
    // same clock that the retries stay inside.
    const died = await (async () => {
      const relay = relayAt(nextUrl());
      return published([relay], live('gn3-died', [1]), async (handle) => {
        await relay.asked(2);
        const readings: Record<string, unknown> = {};
        const wire = await dies(relay, (when) => {
          readings[when] = readingOf(handle());
        });
        await answered(handle);
        return { ...readings, ...wire, after: readingOf(handle()) };
      });
    })();
    const exhausted = await (async () => {
      const relay = relayAt(nextUrl());
      return published(
        [relay],
        live('gn3-exhausted', [1], 60_000),
        async (handle, constructed) => {
          const asked = await advanceUntil(() => relay.reqs().length >= 2, 5000);
          await exhaust([relay], handle);
          return {
            asked,
            sockets: exhaustedSockets([relay], constructed),
            after: readingOf(handle())
          };
        },
        { onAFakeClock: true }
      );
    })();
    const running = {
      status: 'loading',
      causes: undefined,
      events: undefined,
      legEnded: undefined,
      activity: 'live'
    };
    expect(
      { died, exhausted },
      'the attempt reports its backlog’s outcome beside the leg end, however the relay went'
    ).toEqual({
      died: {
        waiting: running,
        recovering: running,
        reconnected: true,
        askedAgain: true,
        after: endedWith([], 'ended')
      },
      exhausted: {
        asked: true,
        sockets: [{ constructed: 6, opened: 1 }],
        after: endedWith([], 'ended')
      }
    });
  }, 30_000);

  // @contracts A5-C10
  it('GN4: a live request whose relays all die while its backlog is open is incomplete because the leg ended, keeping what arrived', async () => {
    // **Two relays, live, and an event from one of them on the forward leg
    // before either answers the backlog.** Then each dies in turn, read while
    // it waits to retry and once it has. After the first, the request is still
    // running — one relay is not the request. After the second, the answer is
    // `incomplete` under `ended` alone — the leg ended, the request did not
    // stop waiting — with the event still shown, and the leg end published.
    //
    // **Two more runs.** The relays going for good, together, their retries
    // spent until the dependency reports `error` — the ordinary death — on a
    // fake clock under a 60s timeout. And one relay whose last event arrives
    // in the same turn as its socket's terminal close, so the event is still
    // being verified when the leg ends: what arrived includes what was still
    // in hand.
    const died = await (async () => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      const event = signed('an event the second relay sends live');
      return published([a, b], live('gn4-died', [1]), async (handle) => {
        await a.asked(2);
        await b.asked(2);
        b.server.send(['EVENT', b.reqs().find((subId) => subId.includes('-f:')), event]);
        const delivered = await until(
          () => readingOf(handle()).events?.includes(event.id) === true,
          3000
        );
        const steps: Record<string, unknown> = { delivered };
        steps['first'] = await dies(a, (when) => {
          steps[`first ${when}`] = readingOf(handle());
        });
        await delay(200);
        steps['after the first'] = readingOf(handle());
        steps['second'] = await dies(b, (when) => {
          steps[`second ${when}`] = readingOf(handle());
        });
        await answered(handle);
        steps['after the second'] = readingOf(handle());
        return { event: event.id, ...steps };
      });
    })();
    const exhausted = await (async () => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      const event = signed('an event the second relay sends before it goes for good');
      return published(
        [a, b],
        live('gn4-exhausted', [1], 60_000),
        async (handle, constructed) => {
          const asked = await advanceUntil(
            () => a.reqs().length >= 2 && b.reqs().length >= 2,
            5000
          );
          b.server.send(['EVENT', b.reqs().find((subId) => subId.includes('-f:')), event]);
          const delivered = await advanceUntil(
            () => readingOf(handle()).events?.includes(event.id) === true,
            3000
          );
          await exhaust([a, b], handle);
          return {
            event: event.id,
            asked,
            delivered,
            sockets: exhaustedSockets([a, b], constructed),
            after: readingOf(handle())
          };
        },
        { onAFakeClock: true }
      );
    })();
    const held = await (async () => {
      const relay = relayAt(nextUrl());
      const event = signed('an event still being verified when the relay goes');
      return published([relay], live('gn4-held', [1]), async (handle) => {
        await relay.asked(2);
        const wire = await dies(
          relay,
          () => {},
          () => {
            relay.server.send([
              'EVENT',
              relay.reqs().find((subId) => subId.includes('-f:')),
              event
            ]);
            relay.shut(4000);
          }
        );
        await answered(handle);
        return { event: event.id, ...wire, after: readingOf(handle()) };
      });
    })();
    const ids = (reading: unknown): string[] => [String((reading as { event?: string }).event)];
    const running = (events: string[]) => ({
      status: 'streaming',
      causes: undefined,
      events,
      legEnded: undefined,
      activity: 'live'
    });
    const retried = { reconnected: true, askedAgain: true };
    expect(
      { died, exhausted, held },
      'incomplete because the leg ended, with what arrived still shown'
    ).toEqual({
      died: {
        event: ids(died)[0],
        delivered: true,
        'first waiting': running(ids(died)),
        'first recovering': running(ids(died)),
        first: retried,
        'after the first': running(ids(died)),
        'second waiting': running(ids(died)),
        'second recovering': running(ids(died)),
        second: retried,
        'after the second': endedWith(ids(died), 'ended')
      },
      exhausted: {
        event: ids(exhausted)[0],
        asked: true,
        delivered: true,
        sockets: [
          { constructed: 6, opened: 1 },
          { constructed: 6, opened: 1 }
        ],
        after: endedWith(ids(exhausted), 'ended')
      },
      held: {
        event: ids(held)[0],
        ...retried,
        after: endedWith(ids(held), 'ended')
      }
    });
  }, 40_000);

  // @contracts A5-C15
  it('GN5: a request over two relays whose connections both die before either answers is incomplete because the leg ended', async () => {
    // **Not live, two relays, neither answers.** Each dies in turn, and each is
    // read while it waits to retry and once it has reconnected — so a
    // recovering relay counted as gone is caught where it would answer early.
    // After the first death the request is still waiting for the other relay;
    // after the second it is `incomplete` under `ended`, the timer thirty
    // seconds away. **And the ordinary death**: both relays going for good
    // together, their retries spent into `error`, on a fake clock under a 60s
    // timeout.
    const died = await (async () => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      return published([a, b], backlog('gn5-died', [1]), async (handle) => {
        await a.asked(1);
        await b.asked(1);
        const steps: Record<string, unknown> = {};
        steps['first'] = await dies(a, (when) => {
          steps[`first ${when}`] = readingOf(handle());
        });
        await delay(200);
        steps['after the first'] = readingOf(handle());
        steps['second'] = await dies(b, (when) => {
          steps[`second ${when}`] = readingOf(handle());
        });
        await answered(handle);
        steps['after the second'] = readingOf(handle());
        return steps;
      });
    })();
    const exhausted = await (async () => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      return published(
        [a, b],
        backlog('gn5-exhausted', [1], 60_000),
        async (handle, constructed) => {
          const asked = await advanceUntil(
            () => a.reqs().length >= 1 && b.reqs().length >= 1,
            5000
          );
          await exhaust([a, b], handle);
          return {
            asked,
            sockets: exhaustedSockets([a, b], constructed),
            after: readingOf(handle())
          };
        },
        { onAFakeClock: true }
      );
    })();
    const waiting = {
      status: 'loading',
      causes: undefined,
      events: undefined,
      legEnded: undefined,
      activity: 'refreshing'
    };
    const retried = { reconnected: true, askedAgain: true };
    expect(
      { died, exhausted },
      'incomplete because the leg ended, not because the request stopped waiting'
    ).toEqual({
      died: {
        'first waiting': waiting,
        'first recovering': waiting,
        first: retried,
        'after the first': waiting,
        'second waiting': waiting,
        'second recovering': waiting,
        second: retried,
        'after the second': endedWith([], undefined)
      },
      exhausted: {
        asked: true,
        sockets: [
          { constructed: 6, opened: 1 },
          { constructed: 6, opened: 1 }
        ],
        after: endedWith([], undefined)
      }
    });
  }, 40_000);

  // @contracts A5-C12
  it('GN7: one relay gone and another silent when the request’s own timer fires reports both causes, exactly', async () => {
    // **Each cause is the doing of one relay**, so each run is read beside the
    // run without it. A relay that refuses the socket, under a 600 ms timeout,
    // and the ordinary death: its server gone and its retries spent into
    // `error`, on a fake clock under a 60s timeout. Each is read while the
    // other relay is still silent, where the request is still waiting, and
    // once the timer has fired. **The control is the same timer with nothing
    // gone**, which is `timeout` alone: without it, `ended` could be the
    // timer's. Which relay was gone is not published (`A5-C27` reads that).
    const refused = await (async () => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      return published([a, b], backlog('gn7-refused', [1], 600), async (handle) => {
        await a.asked(1);
        await b.asked(1);
        a.refuse();
        await delay(200);
        const waiting = readingOf(handle());
        await answered(handle);
        return { waiting, answer: readingOf(handle()) };
      });
    })();
    const exhausted = await (async () => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      return published(
        [a, b],
        backlog('gn7-exhausted', [1], 60_000),
        async (handle, constructed) => {
          const asked = await advanceUntil(
            () => a.reqs().length >= 1 && b.reqs().length >= 1,
            5000
          );
          a.shut(1006);
          await advanceUntil(() => false, 50_000, 500);
          const waiting = readingOf(handle());
          await advanceUntil(() => handle()?.state.status === 'incomplete', 15_000, 500);
          return {
            asked,
            sockets: exhaustedSockets([a], constructed),
            waiting,
            answer: readingOf(handle())
          };
        },
        { onAFakeClock: true }
      );
    })();
    const control = await (async () => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      return published([a, b], backlog('gn7-control', [1], 600), async (handle) => {
        await a.asked(1);
        await b.asked(1);
        await answered(handle);
        return readingOf(handle());
      });
    })();
    const waiting = {
      status: 'loading',
      causes: undefined,
      events: undefined,
      legEnded: undefined,
      activity: 'refreshing'
    };
    const stopped = (causes: string[]) => ({
      status: 'incomplete',
      causes,
      events: [],
      legEnded: undefined,
      activity: 'idle'
    });
    expect(
      { refused, exhausted, control },
      'both causes once the timer fires, and timeout alone with nothing gone'
    ).toEqual({
      refused: { waiting, answer: stopped(['timeout', 'ended']) },
      exhausted: {
        asked: true,
        sockets: [{ constructed: 6, opened: 1 }],
        waiting,
        answer: stopped(['timeout', 'ended'])
      },
      control: stopped(['timeout'])
    });
  }, 40_000);

  // @contracts A5-C13
  it('GN8: a relay that answered adds no timeout beside one that then died, and the death is reported', async () => {
    // **Causes exactly `['ended']`, the timer far away**, because each half
    // fails alone: a relay that answered and is left undetermined adds
    // `timeout`, and a backlog that takes every relay's silence for an answer
    // is `complete`. The death is the two ways again: the socket refused, and
    // the ordinary one on a fake clock. An event the answered relay sent is
    // kept. **The control is the same two relays with no death**, which is
    // `settled`. Whether the relay that answered is counted among those lost is
    // not published, since the one that died has already added `ended`
    // (`A5-C28` reads that).
    const event = signed('the relay that answered');
    const answeredThenGone = async (
      how: 'refused' | 'exhausted',
      go: (relay: Relay) => void,
      settle: (handle: () => ReqHandle | undefined) => Promise<void>,
      options: { onAFakeClock?: boolean } = {}
    ) => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      const plan = backlog(`gn8-${how}`, [1], options.onAFakeClock === true ? 60_000 : 30_000);
      return published(
        [a, b],
        plan,
        async (handle) => {
          const asked = options.onAFakeClock === true ? advanceUntil : until;
          await asked(() => a.reqs().length >= 1 && b.reqs().length >= 1, 3000);
          a.server.send(['EVENT', a.reqs()[0], event]);
          a.server.send(['EOSE', a.reqs()[0]]);
          await (options.onAFakeClock === true
            ? vi.advanceTimersByTimeAsync(100)
            : delay(100));
          go(b);
          await settle(handle);
          return readingOf(handle());
        },
        options
      );
    };
    const refused = await answeredThenGone(
      'refused',
      (relay) => relay.refuse(),
      (handle) => answered(handle)
    );
    const exhausted = await answeredThenGone(
      'exhausted',
      (relay) => relay.shut(1006),
      async (handle) => {
        await advanceUntil(() => handle()?.state.status === 'incomplete', 45_000, 500);
      },
      { onAFakeClock: true }
    );
    const control = await (async () => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      return published([a, b], backlog('gn8-control', [1]), async (handle) => {
        await a.asked(1);
        await b.asked(1);
        a.server.send(['EOSE', a.reqs()[0]]);
        b.server.send(['EOSE', b.reqs()[0]]);
        await vi.waitFor(() => expect(handle()?.state.status).toBe('settled'), { timeout: 2000 });
        return readingOf(handle());
      });
    })();
    expect(
      { refused, exhausted, control },
      'ended alone, with what the relay that answered sent, and settled with no death'
    ).toEqual({
      refused: endedWith([event.id], undefined),
      exhausted: endedWith([event.id], undefined),
      control: {
        status: 'settled',
        causes: undefined,
        events: [],
        legEnded: undefined,
        activity: 'idle'
      }
    });
  }, 40_000);
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
