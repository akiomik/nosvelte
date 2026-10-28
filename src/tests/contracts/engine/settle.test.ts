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
 * consumer's own `useReq`, and a published `EventList`, under it; and a relay
 * that never sends `EOSE`.
 *
 * **Each run is read on two clocks.** On a fake clock, installed before the
 * provider is rendered, the deadline is read exactly: a millisecond before it,
 * counted from just before the provider is rendered, and at it, counted from
 * when the relay was first asked. The request's timer is armed between those
 * two instants, so a timer armed for any other delay than the caller's, early
 * or late by more than that gap, is read on the wrong side of one of them. On
 * the real clock the same runs are read with wide edges, which a loaded
 * machine needs and which separate only a timer far from the deadline (#179).
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
     * The backlog's subscription once all `legs` have been asked for, and when,
     * on this clock: on the fake clock found a millisecond at a time.
     */
    asked: async (legs: number): Promise<{ backward: string; askedAt: number }> => {
      const done = () => asked().length >= legs;
      if (clock === 'fake clock') expect(await advanceUntil(done, 2000, 1)).toBe(true);
      else
        await vi.waitFor(() => expect(done(), 'the relay was asked').toBe(true), { timeout: 3000 });
      return {
        backward: asked().find((subId) => subId.includes('-b:')) as string,
        askedAt: Date.now()
      };
    }
  };
}

/**
 * Either side of a deadline, on `clock`. On the fake clock, `before` is a
 * millisecond short of `timeoutMs` after `madeAt`, and `by` is `timeoutMs`
 * after `askedAt`, read once there. On the real clock, `before` is `beforeMs`
 * after the arm acted, and `by` waits for `done` and says whether it came
 * within `withinMs` of that.
 */
function sides(
  clock: Clock,
  { madeAt, askedAt, timeoutMs }: { madeAt: number; askedAt: number; timeoutMs: number },
  { beforeMs, withinMs }: { beforeMs: number; withinMs: number }
) {
  const actedAt = Date.now();
  const to = (time: number) => vi.advanceTimersByTimeAsync(Math.max(0, time - Date.now()));
  return clock === 'fake clock'
    ? {
        before: () => to(madeAt + timeoutMs - 1),
        by: async (done: () => boolean): Promise<boolean> => {
          await to(askedAt + timeoutMs);
          return done();
        },
        after: () => vi.advanceTimersByTimeAsync(50)
      }
    : {
        before: () => delay(beforeMs),
        by: async (done: () => boolean): Promise<boolean> => {
          try {
            await vi.waitFor(() => expect(done()).toBe(true), { timeout: withinMs + 1500 });
          } catch {
            return false;
          }
          return Date.now() - actedAt < withinMs;
        },
        after: () => delay(50)
      };
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
    // **Three runs, on each clock.** A consumer's own `useReq`, non-live and
    // live, each with a 300ms settle timeout of its own, reads the answer:
    // `incomplete` under `timeout` alone, the event the relay sent on the
    // backlog still there, and an `IncompleteResultError` among the
    // diagnostics. A published `EventList` reads the slot — the one claim
    // about a component rather than a handle — under the default timeout, with
    // the request the outlet is handed read alongside the events, so the
    // outlet that shows events before the timeout cannot pass for the one that
    // shows them after it — and with the status read **as the outlet
    // rendered**, so an outlet left on the screen from before the timeout, by a
    // component that failed to render the answer, is not read as the answer's.
    //
    // **And each is read on both sides of its deadline.** On the fake clock,
    // exactly. On the real clock, still waiting at a third of it for the
    // consumers and two fifths of it for the default, and answered within 1.5s
    // and 7.5s of the event: a timer of the library's own choosing, of two
    // seconds or of fifty milliseconds, misses one of those.
    const event = signed('the only event the relay sends');
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
          relay.send(['EVENT', backward, event]);
          const side = sides(
            clock,
            { madeAt, askedAt, timeoutMs: TIMEOUT_MS },
            { beforeMs: 100, withinMs: 1500 }
          );
          await side.before();
          const beforeTheDeadline = handle()?.state.status;
          const byTheDeadline = await side.by(() => handle()?.state.status === 'incomplete');
          const { state, diagnostics } = handle() as ReqHandle;
          runs[name] = {
            beforeTheDeadline,
            byTheDeadline,
            status: state.status,
            causes: state.status === 'incomplete' ? [...state.causes] : undefined,
            events: state.status === 'loading' ? undefined : state.events.map((each) => each.id),
            lastError: diagnostics.lastError?.name,
            anIncompleteResultError: diagnostics.lastError instanceof IncompleteResultError
          };
        } catch (error) {
          runs[name] = failed(error);
        } finally {
          await end(clock, view);
        }
      }

    for (const clock of CLOCKS) {
      const { url, relay, madeAt, asked } = relayFor(nextUrl(), clock);
      type Argument = { events?: readonly { id: string }[]; request?: ReqHandle } | undefined;
      // Each outlet with the status its request had when it rendered, read
      // without subscribing: a read that subscribed would re-run the outlet on
      // its own when the status moved, whatever the component decided.
      const outlets: [string, Argument, string | undefined][] = [];
      const view = render(ListedEvents, {
        relays: [url],
        ids: [event.id],
        held: (outlet: string, argument: unknown) => {
          const held = argument as Argument;
          outlets.push([outlet, held, untrack(() => held?.request?.state.status)]);
        }
      });
      const latest = () => {
        const [outlet, argument, renderedAt] = outlets.at(-1) ?? ['none', undefined, undefined];
        return {
          outlet,
          events: argument?.events?.map((each) => each.id),
          request: argument?.request,
          renderedAt
        };
      };
      try {
        const { backward, askedAt } = await asked(1);
        relay.send(['EVENT', backward, event]);
        const side = sides(
          clock,
          { madeAt, askedAt, timeoutMs: DEFAULT_SETTLE_TIMEOUT_MS },
          { beforeMs: 2000, withinMs: 7500 }
        );
        await side.before();
        const beforeTheDeadline = latest().request?.state.status;
        const byTheDeadline = await side.by(() => latest().request?.state.status === 'incomplete');
        await side.after();
        const { outlet, events, request, renderedAt } = latest();
        const state = request?.state;
        runs[`${clock}, a published list`] = {
          beforeTheDeadline,
          byTheDeadline,
          outlet,
          renderedAt,
          events,
          status: state?.status,
          causes: state?.status === 'incomplete' ? [...state.causes] : undefined
        };
      } catch (error) {
        runs[`${clock}, a published list`] = failed(error);
      } finally {
        await end(clock, view);
      }
    }

    const consumers = {
      beforeTheDeadline: 'streaming',
      byTheDeadline: true,
      status: 'incomplete',
      causes: ['timeout'],
      events: [event.id],
      lastError: 'IncompleteResultError',
      anIncompleteResultError: true
    };
    expect(
      runs,
      'incomplete under timeout, the event kept, the default slot, and the error that says so'
    ).toEqual(
      Object.fromEntries(
        CLOCKS.flatMap((clock) => [
          [`${clock}, a consumer’s request`, consumers],
          [`${clock}, a consumer’s live request`, consumers],
          [
            `${clock}, a published list`,
            {
              beforeTheDeadline: 'streaming',
              byTheDeadline: true,
              outlet: 'events',
              renderedAt: 'incomplete',
              events: [event.id],
              status: 'incomplete',
              causes: ['timeout']
            }
          ]
        ])
      )
    );
  }, 30_000);

  // @contracts A-γ-C7
  it('ST2: a live request answered by nothing leaves loading at its timeout, with its live subscription still open', async () => {
    // **The relay sends nothing at all**: no event and no `EOSE`, on either
    // subscription. Before the deadline the request has nothing to show and is
    // `loading`; at it, the request stops waiting for the backlog and says so,
    // `incomplete` under `timeout` alone and with no events, and the live
    // subscription is not what the timer ends. Read on both sides of the
    // deadline, on each clock, as `ST1` reads its own.
    const runs: Record<string, unknown> = {};
    for (const clock of CLOCKS) {
      const { url, madeAt, asked, open } = relayFor(nextUrl(), clock);
      const { view, handle } = consumerOf(url, {
        filters: [{ kinds: [1] }],
        live: true,
        retain: 'unbounded',
        settleTimeoutMs: TIMEOUT_MS
      });
      try {
        const { askedAt } = await asked(2);
        const side = sides(
          clock,
          { madeAt, askedAt, timeoutMs: TIMEOUT_MS },
          { beforeMs: 100, withinMs: 1500 }
        );
        await side.before();
        const beforeTheDeadline = handle()?.state.status;
        const byTheDeadline = await side.by(() => handle()?.state.status === 'incomplete');
        await side.after();
        const { state } = handle() as ReqHandle;
        runs[clock] = {
          beforeTheDeadline,
          byTheDeadline,
          status: state.status,
          causes: state.status === 'incomplete' ? [...state.causes] : undefined,
          events: state.status === 'loading' ? undefined : state.events.map((each) => each.id),
          open: open()
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
      open: ['forward']
    };
    expect(runs, 'incomplete under timeout with no events, and the live subscription open').toEqual(
      { 'fake clock': answered, 'real clock': answered }
    );
  }, 30_000);
});
