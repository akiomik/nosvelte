/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A request that runs out of patience: the landings of `A-γ-C1` (`ST1`) and
 * `A-γ-C7` (`ST2`).
 *
 * **Through the published entry and nothing else**, because the rows' route is
 * `public`: `NostrApp` with `relays` only, so the verifier is the one the
 * library supplies and the event the relay sends is signed for real; a
 * consumer's own `useReq`, and a published `EventList` and `Event`, under it;
 * and a relay that never sends `EOSE`.
 *
 * **Each run is read on two clocks.** On a fake clock, installed before the
 * provider is rendered, the deadline is read exactly: a millisecond before it,
 * counted from just before the provider is rendered, and at it, counted from
 * when the relay was first asked. The request's timer is armed between those
 * two instants, so a timer armed for any other delay than the caller's, early
 * or late by more than that gap, is read on the wrong side of one of them. The
 * gap is read too, and held under `ASKED_WITHIN_MS`: a relay asked later, behind
 * a slow NIP-11 answer say, would widen what the two readings let through, and
 * fails the arm instead. On the real clock the same runs are read with wide
 * edges, which a loaded machine needs and which separate only a timer far from
 * the deadline (#179).
 *
 * Port band 9500-9519.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { untrack } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import {
  IncompleteResultError,
  type ReqDescriptor,
  type ReqHandle,
  type ReqPlan
} from '$lib/v1/index.js';
import { DEFAULT_SETTLE_TIMEOUT_MS } from '$lib/v1/normalize.js';

import ListedEvents from './fixtures/ListedEvents.svelte';
import PublishedRequest from './fixtures/PublishedRequest.svelte';
import { advanceUntil, fakeTheClock, openAmong, signed, urlsFrom } from './helpers/request.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(9500);

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The settle timeout a consumer's own request asks for. */
const TIMEOUT_MS = 300;

/**
 * On the fake clock, how soon after the provider is rendered its relay must be
 * asked: the most the two instants a deadline is read at may be apart.
 */
const ASKED_WITHIN_MS = 20;

/** The two clocks a run is read on. */
const CLOCKS = ['fake clock', 'real clock'] as const;
type Clock = (typeof CLOCKS)[number];

/**
 * A relay the published entry connects to, on `clock`. On the fake clock, every
 * clock the request reads is faked first, so that the time just before the
 * provider is rendered is `madeAt`.
 */
function relayFor(url: string, clock: Clock) {
  if (clock === 'fake clock') fakeTheClock();
  const madeAt = Date.now();
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  const relay = new WS(url, { jsonProtocol: true });
  const frames = (): unknown[][] => relay.messages as unknown[][];
  const asked = (): string[] =>
    frames()
      .filter((frame) => frame[0] === 'REQ')
      .map((frame) => String(frame[1]));
  return {
    url,
    relay,
    madeAt,
    /** The subscriptions open on the wire now, by leg. */
    open: (): string[] => openAmong(frames()).sort(),
    /**
     * The backlog's subscription and the live one once all `legs` have been
     * asked for, and when, on this clock: on the fake clock found a millisecond
     * at a time.
     */
    asked: async (
      legs: number
    ): Promise<{ backward: string; forward: string | undefined; askedAt: number }> => {
      const done = () => asked().length >= legs;
      if (clock === 'fake clock') expect(await advanceUntil(done, 2000, 1)).toBe(true);
      else
        await vi.waitFor(() => expect(done(), 'the relay was asked').toBe(true), { timeout: 3000 });
      return {
        backward: asked().find((subId) => subId.includes('-b:')) as string,
        forward: asked().find((subId) => subId.includes('-f:')),
        askedAt: Date.now()
      };
    }
  };
}

/**
 * Either side of a deadline, on `clock`. On the fake clock, `midway` is a sixth
 * of `timeoutMs` after `askedAt`, `before` is a millisecond short of
 * `timeoutMs` after `madeAt`, and `by` is `timeoutMs` after `askedAt`, read once
 * there. `first` gives the same verdict as `by`, but steps a millisecond at a
 * time and stops in the millisecond `done` first holds, so that what the arm
 * does next happens in that millisecond — at the price of reading `done` there
 * rather than at the deadline, which is why an arm that reads the answer
 * itself at the deadline uses `by`. `soonEnough` says whether the relay was
 * asked within `ASKED_WITHIN_MS` of `madeAt`. On the real clock, `midway` is a
 * sixth of `timeoutMs` after the arm acted, `before` is `beforeMs` after
 * `midway`, and `by` and `first` alike poll for `done` every millisecond and
 * say whether it came within `withinMs` of the act.
 */
function sides(
  clock: Clock,
  { madeAt, askedAt, timeoutMs }: { madeAt: number; askedAt: number; timeoutMs: number },
  { beforeMs, withinMs }: { beforeMs: number; withinMs: number }
) {
  const actedAt = Date.now();
  const to = (time: number) => vi.advanceTimersByTimeAsync(Math.max(0, time - Date.now()));
  const polled = async (done: () => boolean): Promise<boolean> => {
    try {
      await vi.waitFor(() => expect(done()).toBe(true), { timeout: withinMs + 1500, interval: 1 });
    } catch {
      return false;
    }
    return Date.now() - actedAt < withinMs;
  };
  return clock === 'fake clock'
    ? {
        soonEnough: { askedWithin: askedAt - madeAt < ASKED_WITHIN_MS },
        midway: () => to(askedAt + timeoutMs / 6),
        before: () => to(madeAt + timeoutMs - 1),
        by: async (done: () => boolean): Promise<boolean> => {
          await to(askedAt + timeoutMs);
          return done();
        },
        first: async (done: () => boolean): Promise<boolean> => {
          await advanceUntil(done, askedAt + timeoutMs - Date.now(), 1);
          return done();
        },
        after: () => vi.advanceTimersByTimeAsync(50)
      }
    : {
        soonEnough: {},
        midway: () => delay(timeoutMs / 6),
        before: () => delay(beforeMs),
        by: polled,
        first: polled,
        after: () => delay(50)
      };
}

/** Whether `done` comes to hold within a second, on `clock`: on the fake clock found a millisecond at a time. */
async function within(clock: Clock, done: () => boolean): Promise<boolean> {
  if (clock === 'fake clock') return advanceUntil(done, 1000, 1);
  try {
    await vi.waitFor(() => expect(done()).toBe(true), { timeout: 1000 });
  } catch {
    return false;
  }
  return true;
}

/** End a run: the provider is unmounted, and on the fake clock what it leaves behind runs out. */
async function end(clock: Clock, view: { unmount: () => void }): Promise<void> {
  view.unmount();
  if (clock === 'fake clock') {
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
  }
  vi.unstubAllGlobals();
}

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

/** A consumer's own request, mounted under the published entry, and the handle it holds. */
function consumerOf(url: string, descriptor: ReqDescriptor) {
  let handle: ReqHandle | undefined;
  const plan: ReqPlan = { kind: 'request', descriptor };
  const view = render(PublishedRequest, {
    relays: [url],
    plan: () => plan,
    seen: (request: ReqHandle) => {
      handle = request;
    },
    published: () => {}
  });
  return { view, handle: () => handle };
}

describe('a request that runs out of patience', () => {
  // @contracts A-γ-C1
  it('ST1: a relay that never sends EOSE leaves the request incomplete under timeout, keeping what it had', async () => {
    // **Four runs, on each clock.** A consumer's own `useReq`, non-live and
    // live, each with a 300ms settle timeout of its own, reads the answer:
    // `incomplete` under `timeout` alone, the event the relay sent on the
    // backlog still there, and an `IncompleteResultError` among the
    // diagnostics. A published `EventList`, and separately a published
    // `Event`, reads the slot — the one claim about a component rather than a
    // handle, and the two decide their outlets apart — under the default
    // timeout, with the request the outlet is handed read alongside the
    // events, so the outlet that shows events before the timeout cannot pass
    // for the one that shows them after it — and with the status read **as the
    // outlet rendered**, so an outlet left on the screen from before the
    // timeout, by a component that failed to render the answer, is not read as
    // the answer's.
    //
    // **And each is read on both sides of its deadline.** On the fake clock,
    // exactly. On the real clock, still waiting at half of it for the
    // consumers and a little over half of it for the default, and answered
    // within 1.5s and 7.5s of the asking: a timer of the library's own
    // choosing, of two seconds or of fifty milliseconds, misses one of those.
    //
    // **The relay sends an event a sixth of the way into the wait**, and to a
    // consumer's request one more as soon as it is asked. The deadline is
    // counted from the asking, and the events that arrive before it do not
    // move it: a deadline re-armed by each event, or armed by the first, is
    // A-ζ's no-progress shape rather than A-γ's, and under it a relay that
    // keeps sending holds the request open for as long as it does. Either
    // fires after the reading at the deadline. And an event that arrives at
    // once is kept as surely as a later one: with only the later event sent, a
    // request that let the first moments of its wait go unread would pass.
    //
    // **Its timeout is the sum of its windows**, not its usual run. A library
    // that never answers `incomplete` waits out every `by` on the real clock —
    // about 3 s for each consumer's run and 12 s for each component's, 30.5 s
    // measured with the fake clock's runs beside them — and the arm has to
    // reach its assertion rather than Vitest's timeout to say which run it was.
    const early = signed('an event the relay sends as it is asked');
    const event = signed('an event the relay sends while the request waits');
    const runs: Record<string, unknown> = {};

    for (const clock of CLOCKS)
      for (const live of [false, true]) {
        const name = `${clock}, ${live ? 'a consumer’s live request' : 'a consumer’s request'}`;
        const { url, relay, madeAt, asked } = relayFor(nextUrl(), clock);
        const { view, handle } = consumerOf(
          url,
          live
            ? {
                filters: [{ kinds: [1] }],
                live: true,
                retain: 'unbounded',
                settleTimeoutMs: TIMEOUT_MS
              }
            : { filters: [{ kinds: [1] }], settleTimeoutMs: TIMEOUT_MS }
        );
        try {
          const { backward, askedAt } = await asked(live ? 2 : 1);
          relay.send(['EVENT', backward, early]);
          const side = sides(
            clock,
            { madeAt, askedAt, timeoutMs: TIMEOUT_MS },
            { beforeMs: 100, withinMs: 1500 }
          );
          await side.midway();
          relay.send(['EVENT', backward, event]);
          await side.before();
          const beforeTheDeadline = handle()?.state.status;
          const byTheDeadline = await side.by(() => handle()?.state.status === 'incomplete');
          const { state, diagnostics } = handle() as ReqHandle;
          runs[name] = {
            ...side.soonEnough,
            beforeTheDeadline,
            byTheDeadline,
            status: state.status,
            causes: state.status === 'incomplete' ? [...state.causes] : undefined,
            events:
              state.status === 'loading' ? undefined : state.events.map((each) => each.id).sort(),
            lastError: diagnostics.lastError?.name,
            anIncompleteResultError: diagnostics.lastError instanceof IncompleteResultError
          };
        } catch (error) {
          runs[name] = failed(error);
        } finally {
          await end(clock, view);
        }
      }

    for (const clock of CLOCKS)
      for (const single of [false, true]) {
        const name = `${clock}, ${single ? 'a published single event' : 'a published list'}`;
        const { url, relay, madeAt, asked } = relayFor(nextUrl(), clock);
        type Argument =
          | { events?: readonly { id: string }[]; event?: { id: string }; request?: ReqHandle }
          | undefined;
        // Each outlet with the status its request had when it rendered, read
        // without subscribing: a read that subscribed would re-run the outlet on
        // its own when the status moved, whatever the component decided.
        const outlets: [string, Argument, string | undefined][] = [];
        const view = render(ListedEvents, {
          relays: [url],
          ids: [event.id],
          single,
          held: (outlet: string, argument: unknown) => {
            const held = argument as Argument;
            outlets.push([outlet, held, untrack(() => held?.request?.state.status)]);
          }
        });
        const latest = () => {
          const [outlet, argument, renderedAt] = outlets.at(-1) ?? ['none', undefined, undefined];
          return {
            outlet,
            events:
              argument?.events?.map((each) => each.id) ??
              (argument?.event === undefined ? undefined : [argument.event.id]),
            request: argument?.request,
            renderedAt
          };
        };
        try {
          const { backward, askedAt } = await asked(1);
          const side = sides(
            clock,
            { madeAt, askedAt, timeoutMs: DEFAULT_SETTLE_TIMEOUT_MS },
            { beforeMs: 2000, withinMs: 7500 }
          );
          await side.midway();
          relay.send(['EVENT', backward, event]);
          await side.before();
          const beforeTheDeadline = latest().request?.state.status;
          const byTheDeadline = await side.by(
            () => latest().request?.state.status === 'incomplete'
          );
          await side.after();
          const { outlet, events, request, renderedAt } = latest();
          const state = request?.state;
          runs[name] = {
            ...side.soonEnough,
            beforeTheDeadline,
            byTheDeadline,
            outlet,
            renderedAt,
            events,
            status: state?.status,
            causes: state?.status === 'incomplete' ? [...state.causes] : undefined
          };
        } catch (error) {
          runs[name] = failed(error);
        } finally {
          await end(clock, view);
        }
      }

    const soonEnough = (clock: Clock) => (clock === 'fake clock' ? { askedWithin: true } : {});
    const consumers = {
      beforeTheDeadline: 'streaming',
      byTheDeadline: true,
      status: 'incomplete',
      causes: ['timeout'],
      events: [early.id, event.id].sort(),
      lastError: 'IncompleteResultError',
      anIncompleteResultError: true
    };
    const shown = {
      beforeTheDeadline: 'streaming',
      byTheDeadline: true,
      outlet: 'events',
      renderedAt: 'incomplete',
      events: [event.id],
      status: 'incomplete',
      causes: ['timeout']
    };
    expect(
      runs,
      'incomplete under timeout, the event kept, the default slot, and the error that says so'
    ).toEqual(
      Object.fromEntries(
        CLOCKS.flatMap((clock) => [
          [`${clock}, a consumer’s request`, { ...soonEnough(clock), ...consumers }],
          [`${clock}, a consumer’s live request`, { ...soonEnough(clock), ...consumers }],
          [`${clock}, a published list`, { ...soonEnough(clock), ...shown }],
          [`${clock}, a published single event`, { ...soonEnough(clock), ...shown }]
        ])
      )
    );
  }, 60_000);

  // @contracts A-γ-C7
  it('ST2: a live request answered by nothing leaves loading at its timeout, its live subscription still open and delivering', async () => {
    // **The relay sends nothing at all**: no event and no `EOSE`, on either
    // subscription. Before the deadline the request has nothing to show and is
    // `loading`; at it, the request stops waiting for the backlog and says so,
    // `incomplete` under `timeout` alone and with no events, and the live
    // subscription is not what the timer ends. Read on both sides of the
    // deadline, on each clock, as `ST1` reads its own.
    //
    // **And the live subscription still delivers**: an event the relay sends on
    // it as the timeout passes — on the fake clock, in the millisecond the
    // request is first read `incomplete` — and another 50ms later, each reach
    // the consumer. A subscription left open on the wire by a request that has
    // stopped admitting what arrives on it would read as open and deliver
    // nothing — and one that stopped for a moment as its timer fired, even
    // for a millisecond, would deliver the later event and lose the first. So
    // the answer at the timeout is read at once, before the first event is
    // sent: in the millisecond it is first `incomplete` (`first`), where
    // `ST1` reads at the deadline itself, and the status is read again once
    // both events are in.
    const atOnce = signed('an event on the live subscription, as the timeout passes');
    const later = signed('an event on the live subscription, after the timeout');
    const runs: Record<string, unknown> = {};
    for (const clock of CLOCKS) {
      const { url, relay, madeAt, asked, open } = relayFor(nextUrl(), clock);
      const { view, handle } = consumerOf(url, {
        filters: [{ kinds: [1] }],
        live: true,
        retain: 'unbounded',
        settleTimeoutMs: TIMEOUT_MS
      });
      try {
        const { forward, askedAt } = await asked(2);
        const side = sides(
          clock,
          { madeAt, askedAt, timeoutMs: TIMEOUT_MS },
          { beforeMs: 100, withinMs: 1500 }
        );
        await side.before();
        const beforeTheDeadline = handle()?.state.status;
        const byTheDeadline = await side.first(() => handle()?.state.status === 'incomplete');
        const { state } = handle() as ReqHandle;
        runs[clock] = {
          ...side.soonEnough,
          beforeTheDeadline,
          byTheDeadline,
          status: state.status,
          causes: state.status === 'incomplete' ? [...state.causes] : undefined,
          events: state.status === 'loading' ? undefined : state.events.map((each) => each.id)
        };
        const shows = (event: Nostr.Event) => () => {
          const now = handle()?.state;
          return (
            now !== undefined &&
            now.status !== 'loading' &&
            now.events.some((each) => each.id === event.id)
          );
        };
        relay.send(['EVENT', forward, atOnce]);
        await side.after();
        const deliveredAtOnce = await within(clock, shows(atOnce));
        relay.send(['EVENT', forward, later]);
        const deliveredLater = await within(clock, shows(later));
        const after = (handle() as ReqHandle).state;
        runs[clock] = {
          ...(runs[clock] as object),
          open: open(),
          deliveredAtOnce,
          deliveredLater,
          afterwards: {
            status: after.status,
            events:
              after.status === 'loading' ? undefined : after.events.map((each) => each.id).sort()
          }
        };
      } catch (error) {
        runs[clock] = failed(error);
      } finally {
        await end(clock, view);
      }
    }
    const answered = {
      beforeTheDeadline: 'loading',
      byTheDeadline: true,
      status: 'incomplete',
      causes: ['timeout'],
      events: [] as Nostr.Event[],
      open: ['forward'],
      deliveredAtOnce: true,
      deliveredLater: true,
      afterwards: { status: 'incomplete', events: [atOnce.id, later.id].sort() }
    };
    expect(
      runs,
      'incomplete under timeout with no events, and the live subscription open and delivering'
    ).toEqual({ 'fake clock': { askedWithin: true, ...answered }, 'real clock': answered });
  }, 30_000);
});
