/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * One request through the published entry, on a relay server and on either of
 * two clocks: `NostrApp` with `relays` only and one consumer's `useReq` under
 * it (`MountedRequest`), the frames the relay was sent read per leg, and each
 * case run on a fake clock and on the real one. Moved here from
 * `release.test.ts` when a second file came to need it, so there is one of it.
 *
 * **Two clocks, each for what only it can read.** On the fake clock the
 * request's deadline is left to the library's default and what is prompt is a
 * fifth of it; on the real clock the request has a deadline of its own and
 * what is prompt is half of it. A prompt reading is bounded on the clock's own
 * time, and where the arm reads `inRealTime` beside it, the real time it comes
 * after the arm last acted is bounded by the same budget, so nothing scheduled
 * later than that, on any clock, has had the time to run by it.
 *
 * Loading this module installs nothing: each file that uses it calls
 * `vi.unmock('svelte')` itself, and puts the timers, the globals and the relay
 * servers back after each arm.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { getEventHash, getPublicKey, getSignature } from 'rx-nostr-crypto';
import { expect, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { NostrContext } from '$lib/v1/context.svelte.js';
import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import { DEFAULT_SETTLE_TIMEOUT_MS } from '$lib/v1/normalize.js';

import MountedRequest from '../fixtures/MountedRequest.svelte';

/** The urls of a file's port band, each call the next one after `first`. */
export const urlsFrom = (first: number): (() => string) => {
  let port = first;
  return () => `ws://localhost:${String((port += 1))}`;
};

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
export const ARM_TIMEOUT_MS = 60_000;

/** Fake every clock the dependency, the socket mock and the machine read. */
export const fakeTheClock = (): void => {
  vi.useFakeTimers({ toFake: [...FAKED] });
};

/**
 * Move the fake clock a step at a time until `done` holds or `ms` of it have
 * passed, and say whether it holds.
 */
export async function advanceUntil(done: () => boolean, ms: number, step = 50): Promise<boolean> {
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
export interface Clock {
  name: string;
  fake: boolean;
  /** The request's deadline, as its descriptor states it: absent for the library's default. */
  settleTimeoutMs: number | undefined;
  /** The request's deadline on this clock's own time. */
  deadlineMs: number;
  /**
   * What is prompt on this clock: a fifth of the deadline on the fake clock,
   * half of it on the real one. It bounds the wait on this clock's own time,
   * and, where an arm reads `inRealTime` beside a prompt reading, the real time
   * the reading may come after the arm last acted, so that nothing scheduled
   * later than this, on any clock, has had the time to run by it.
   */
  promptMs: number;
  /** Whether `done` holds within `promptMs` of this clock's time. */
  promptly: (done: () => boolean) => Promise<boolean>;
  /** Whether `done` holds within `ms` of this clock's time. */
  within: (done: () => boolean, ms: number) => Promise<boolean>;
  /** Let one delivery turn pass on this clock. */
  turn: () => Promise<void>;
  /** Let a second more than the whole deadline pass, and a delivery turn after. */
  pastTheDeadline: () => Promise<void>;
}

export const FAKE: Clock = {
  name: 'fake clock',
  fake: true,
  settleTimeoutMs: undefined,
  deadlineMs: DEFAULT_SETTLE_TIMEOUT_MS,
  promptMs: DEFAULT_SETTLE_TIMEOUT_MS / 5,
  promptly: (done) => advanceUntil(done, FAKE.promptMs),
  within: advanceUntil,
  turn: async () => {
    await vi.advanceTimersByTimeAsync(DELIVERY_MS);
  },
  pastTheDeadline: async () => {
    await vi.advanceTimersByTimeAsync(DEFAULT_SETTLE_TIMEOUT_MS + 1000);
  }
};

export const REAL: Clock = {
  name: 'real clock',
  fake: false,
  settleTimeoutMs: REAL_DEADLINE_MS,
  deadlineMs: REAL_DEADLINE_MS,
  promptMs: REAL_DEADLINE_MS / 2,
  promptly: (done) => until(done, REAL.promptMs),
  within: until,
  turn: () => delay(DELIVERY_MS),
  pastTheDeadline: async () => {
    await delay(REAL_DEADLINE_MS + 1000);
    await delay(DELIVERY_MS);
  }
};

const SECKEY = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';

/** An event signed correctly over its own fields, as a relay would carry one. */
export const signed = (content: string, createdAt = 1000): Nostr.Event => {
  const unsigned = {
    kind: 1,
    created_at: createdAt,
    tags: [],
    content,
    pubkey: getPublicKey(SECKEY)
  };
  const id = getEventHash(unsigned);
  return { ...unsigned, id, sig: getSignature(id, SECKEY) };
};

export type Leg = 'backward' | 'forward';

/** How events sent together are dated: all at one instant, or each newer, or each older, than the one before. */
export type Order = 'one instant' | 'oldest first' | 'newest first';

/** The `created_at` of the `each`th of `count` events sent in `order`, from `base`. */
const createdAtOf = (base: number, order: Order, each: number, count: number): number =>
  order === 'one instant' ? base : base + (order === 'oldest first' ? each : count - 1 - each);

/** The leg a subscription name belongs to, as the machine names its two. */
const legOf = (subId: string): Leg | undefined =>
  subId.includes('-b:') ? 'backward' : subId.includes('-f:') ? 'forward' : undefined;

/**
 * The subscriptions `frames` leave open, by leg — a name the arm does not
 * know is given as itself. Folded in the order the frames were sent, so a
 * subscription asked again after its `CLOSE` is open again.
 */
export function openAmong(frames: readonly unknown[][]): string[] {
  const open = new Set<string>();
  for (const [kind, subId] of frames) {
    if (kind === 'REQ') open.add(String(subId));
    if (kind === 'CLOSE') open.delete(String(subId));
  }
  return [...open].map((subId) => legOf(subId) ?? subId);
}

/** A relay server, and what it was sent on each leg. */
export function relayAt(url: string) {
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
    /**
     * `count` events on the backlog asked of this relay, each signed and dated
     * in `order` from 1000: all at that instant unless an order is given, so a
     * request that keeps only the newest keeps the last one sent oldest first
     * and the first one sent newest first. Handed back, in the order they were
     * sent.
     */
    sendBacklog: (count: number, content: string, order: Order = 'one instant'): Nostr.Event[] => {
      const sent: Nostr.Event[] = [];
      for (let each = 0; each < count; each += 1) {
        const event = signed(`${content}-${String(each)}`, createdAtOf(1000, order, each, count));
        server.send(['EVENT', named('REQ', 'backward').at(-1), event]);
        sent.push(event);
      }
      return sent;
    },
    /**
     * `count` events on the live subscription asked of this relay, each signed
     * and dated in `order` from 2000, each newer than the one before unless they
     * are sent newest first. Handed back, in the order they were sent.
     */
    sendLive: (
      count: number,
      content: string,
      order: Exclude<Order, 'one instant'> = 'oldest first'
    ): Nostr.Event[] => {
      const sent: Nostr.Event[] = [];
      for (let each = 0; each < count; each += 1) {
        const event = signed(
          `${content}-live-${String(each)}`,
          createdAtOf(2000, order, each, count)
        );
        server.send(['EVENT', named('REQ', 'forward').at(-1), event]);
        sent.push(event);
      }
      return sent;
    },
    /** `EOSE` for the backlog asked of this relay. */
    answerBacklog: (): void => {
      server.send(['EOSE', named('REQ', 'backward').at(-1)]);
    },
    /** `EOSE` for the live subscription asked of this relay, as a relay sends one on every subscription. */
    answerLive: (): void => {
      server.send(['EOSE', named('REQ', 'forward').at(-1)]);
    },
    /** `CLOSED` for the live subscription asked of this relay, with `notice`. */
    refuseLive: (notice: string): void => {
      server.send(['CLOSED', named('REQ', 'forward').at(-1), notice]);
    },
    /** How many sockets to this relay are open now. */
    sockets: (): number => server.server.clients().length
  };
}

export type Relay = ReturnType<typeof relayAt>;

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

/** One way a backlog can end: how many events it carries, and what the request retains. */
export interface Ending {
  events: 0 | 1 | 2;
  retain: 'unbounded' | 1;
}

export const ENDINGS: readonly Ending[] = ([0, 1, 2] as const).flatMap((events) =>
  (['unbounded', 1] as const).map((retain) => ({ events, retain }))
);

export const nameOf = ({ events, retain }: Ending): string =>
  `${String(events)} event, retaining ${String(retain)}`;

/** The events a request holds once its backlog has ended this way. */
export const kept = ({ events, retain }: Ending): number =>
  retain === 'unbounded' ? events : Math.min(events, retain);

/** The request, its deadline the clock's. */
export const planned = (
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
export const delivered = (handle: ReqHandle | undefined): number =>
  handle === undefined || handle.state.status === 'loading' ? 0 : handle.state.events.length;

export interface Consumer {
  /** The request the consumer holds, once it has one. */
  handle: () => ReqHandle | undefined;
  /** Mount the consumer under the provider. */
  mount: () => Promise<void>;
  /** Tear the consumer down, the provider staying mounted. */
  tearDown: () => Promise<void>;
  /** Say that the arm acted now, for `inRealTime` to count from. */
  acted: () => void;
  /**
   * Whether less than the clock's `promptMs` of real time has passed since the
   * arm last acted: the request was made, the consumer torn down, or `acted`
   * called, whichever came last.
   */
  inRealTime: () => boolean;
  /**
   * Whether `done` comes to hold before the request is its deadline less what
   * is prompt old, on the clock's own time: the longest an arm may wait and
   * still have a prompt reading after it land inside the deadline, whatever
   * the arm spent before the wait began. The age is counted from just before
   * the provider is rendered, a little before the request is made; on the
   * real clock the wait ends when its timer runs, which load can delay.
   */
  throughTheWait: (done: () => boolean) => Promise<boolean>;
  /**
   * Whether the request was made less than its deadline less a delivery turn
   * ago, on the clock's own time. **A diagnostic, not a reading an arm owes**:
   * read as the arm is about to answer, beside an answer it then did not get,
   * it says whether the run reached the answer in time, not why the answer was
   * not read; an answer that did arrive is not failed for arriving late in the
   * margin.
   */
  beforeTheDeadline: () => boolean;
}

/**
 * One request through the published entry, on `relay` and `clock`, handed to
 * `run`; the provider is unmounted after. On the fake clock, the clock is
 * installed before the provider is rendered, and moved on after it goes so
 * that what it leaves behind runs out, then put back. The consumer is mounted
 * at once unless `ready` is given, in which case the arm is handed the
 * provider's context first and mounts the consumer itself.
 */
export async function published(
  relay: Relay,
  plan: ReqPlan,
  clock: Clock,
  run: (consumer: Consumer) => Promise<unknown>,
  ready?: (context: NostrContext) => void
): Promise<unknown> {
  let handle: ReqHandle | undefined;
  let actedAt = vi.getRealSystemTime();
  if (clock.fake) fakeTheClock();
  const madeAt = Date.now();
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
      acted: () => {
        actedAt = vi.getRealSystemTime();
      },
      inRealTime: () => vi.getRealSystemTime() - actedAt < clock.promptMs,
      throughTheWait: (done) =>
        clock.within(done, Math.max(0, clock.deadlineMs - clock.promptMs - (Date.now() - madeAt))),
      beforeTheDeadline: () => Date.now() - madeAt < clock.deadlineMs - DELIVERY_MS
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
export async function onEachClock<Case>(
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
export const expectedOnEachClock = <Case>(
  cases: readonly Case[],
  name: (each: Case) => string,
  reading: (each: Case) => unknown
): Record<string, unknown> =>
  Object.fromEntries(
    CLOCKS.flatMap((clock) => cases.map((each) => [`${clock.name}, ${name(each)}`, reading(each)]))
  );
