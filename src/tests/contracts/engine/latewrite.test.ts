/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A delivery that comes too late to be written: the landing of `A11-C19`
 * (`LW1` on `streamedQueryAccumulator`, `LW2` on `setQueryDataAccumulator`).
 *
 * **On the accumulation seam, which is internal**: no published entry takes an
 * accumulator, so the library's two are the only ones that reach it, and a
 * request that names one is on the standalone arm — here with a client of the
 * arm's own whose `gcTime` is 0, so that an entry is collected as soon as its
 * last observer leaves.
 *
 * Port band 10880-10919.
 */
import { QueryClient, type QueryKey } from 'tanstack-svelte-query-v6';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type WS from 'vitest-websocket-mock';
import WSServer from 'vitest-websocket-mock';

import {
  setQueryDataAccumulator,
  type StreamAccumulator,
  streamedQueryAccumulator
} from '$lib/v1/accumulate.js';
import { createAttemptRegistry } from '$lib/v1/attempt.js';
import type { CachedEventSet } from '$lib/v1/eventset.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import { acceptAnyEvent, createTestRelay, fakeEvent } from './helpers/relay.js';
import {
  advanceUntil,
  ARM_TIMEOUT_MS,
  type Clock,
  expectedOnEachClock,
  fakeTheClock,
  onEachClock,
  urlsFrom
} from './helpers/request.js';
import { mount } from './helpers/runes.svelte.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  WSServer.clean();
});

const nextUrl = urlsFrom(10880);

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * How long the work outstanding at a reading is given to run out, on each
 * clock's own time: every timer armed for less than this has fired by then,
 * and every microtask has run.
 */
const RUN_OUT_MS = { fake: 5000, real: 300 } as const;

/** Whether `done` holds within `ms` of `clock`'s own time. */
const within = (clock: Clock, done: () => boolean, ms = 3000): Promise<boolean> =>
  clock.fake
    ? advanceUntil(done, ms)
    : vi
        .waitFor(() => expect(done()).toBe(true), { timeout: ms })
        .then(
          () => true,
          () => false
        );

/** Let the work outstanding run out, on `clock`'s own time. */
const runOut = (clock: Clock): Promise<unknown> =>
  clock.fake ? vi.advanceTimersByTimeAsync(RUN_OUT_MS.fake) : delay(RUN_OUT_MS.real);

/** The subscription a request's leg was asked under, by the leg's suffix. */
const legOf = (server: WS, leg: 'b' | 'f'): string | undefined =>
  (server.messages as unknown[][])
    .filter((frame) => frame[0] === 'REQ')
    .map((frame) => String(frame[1]))
    .find((name) => name.includes(`-${leg}:`));

/**
 * `inner`, handed a stream function that counts the events the accumulator
 * takes — each pull that comes back with one — and calls `taken` with the
 * count, and `asked` with the count so far each time the accumulator pulls.
 * **It does not read the cache**, so a write the accumulator defers is a write
 * this does not see: what it says is that the event reached the accumulator,
 * and the cache readings say what the accumulator did with it.
 */
function counting(
  inner: StreamAccumulator,
  taken: (count: number) => void,
  asked: (count: number) => void
): StreamAccumulator {
  let count = 0;
  return (params) =>
    inner({
      ...params,
      streamFn: (context) => {
        const source = params.streamFn(context);
        return {
          [Symbol.asyncIterator]: () => {
            const iterator = source[Symbol.asyncIterator]();
            return {
              next: () => {
                asked(count);
                return iterator.next().then((result) => {
                  if (result.done !== true && result.value.type === 'event') {
                    count += 1;
                    taken(count);
                  }
                  return result;
                });
              },
              return: (value?: unknown) =>
                iterator.return?.(value as never) ??
                Promise.resolve({ done: true, value: undefined }),
              throw: (error?: unknown) => iterator.throw?.(error) ?? Promise.reject(error)
            } as AsyncIterator<never>;
          }
        } as AsyncIterable<never>;
      }
    });
}

/** How the events reach the request: while it stands, after it has gone, or across its teardown. */
type Delivery = 'while the request stands' | 'after the entry is collected' | 'across the teardown';

interface Case {
  readonly delivery: Delivery;
  readonly events: 1 | 2;
}

const CASES: readonly Case[] = [
  { delivery: 'while the request stands', events: 1 },
  { delivery: 'while the request stands', events: 2 },
  { delivery: 'after the entry is collected', events: 1 },
  { delivery: 'across the teardown', events: 1 },
  { delivery: 'across the teardown', events: 2 }
];

const caseName = ({ delivery, events }: Case): string =>
  `${delivery}, ${String(events)} event${events === 1 ? '' : 's'} in turn`;

/**
 * One live request on `inner`, under a client whose `gcTime` is 0, its backlog
 * answered, and `each`'s events delivered on its forward subscription, read
 * once the work outstanding has run out:
 *
 * - `taken`: how many events the accumulator took;
 * - `held`: how many events the request's entry holds at the end, or `'none'`
 *   when there is no entry for its key;
 * - `added`: how many times the cache announced an entry for the request's
 *   key **from that entry's removal on**, counted by a listener put on the
 *   cache before the teardown — a reading taken only at the end would pass an
 *   entry recreated and collected again, which `gcTime` 0 does at once;
 * - `byHand`: the count's own control — an entry written by hand under the key
 *   once the rest has run out: whether it is there at once, whether it has
 *   gone once the work has run out again, and how many additions the listener
 *   counted for it. Collected, it is there at once, gone after and counted
 *   once, which is why a reading taken only at the end cannot stand in for
 *   the count.
 */
async function delivered(inner: StreamAccumulator, clock: Clock, each: Case) {
  if (clock.fake) fakeTheClock();
  const { rxNostr, server } = createTestRelay(nextUrl());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const attempts = createAttemptRegistry();
  let taken = 0;
  let onAsked: ((count: number) => void) | undefined;
  const accumulator = counting(
    inner,
    (count) => {
      taken = count;
    },
    (count) => onAsked?.(count)
  );
  const request = mount(() =>
    useStreamedReq(() => ({
      verifyEvent: acceptAnyEvent,
      attempts,
      rxNostr,
      client,
      namespace: 'lw',
      filters: [{ kinds: [1] }],
      reqIdBase: 'lw',
      live: true,
      retain: 'unbounded',
      settleTimeoutMs: 30_000,
      accumulator
    }))
  );
  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    request.destroy();
  };
  try {
    if (
      !(await within(
        clock,
        () => legOf(server, 'b') !== undefined && legOf(server, 'f') !== undefined
      ))
    )
      return 'the request asked neither leg';
    server.send(['EOSE', legOf(server, 'b')]);
    const [entry] = client.getQueryCache().getAll();
    if (entry === undefined) return 'the request made no entry';
    const key: QueryKey = entry.queryKey;
    const send = (): void => {
      server.send(['EVENT', legOf(server, 'f'), fakeEvent()]);
    };
    let removed = false;
    let added = 0;
    client.getQueryCache().subscribe((event) => {
      if (event.query.queryHash !== entry.queryHash) return;
      if (event.type === 'removed') removed = true;
      if (event.type === 'added' && removed) added += 1;
    });
    if (each.delivery === 'while the request stands') {
      for (let at = 1; at <= each.events; at += 1) {
        send();
        await within(clock, () => taken >= at);
      }
    } else if (each.delivery === 'after the entry is collected') {
      destroy();
      if (!(await within(clock, () => removed))) return 'the entry was never collected';
      send();
    } else {
      // **Torn down the moment the accumulator has handled its last take**:
      // when it comes back for the next chunk, so whatever it does at once
      // with the event has been done, however many turns that took it, and
      // whatever it put off is still outstanding when the teardown begins.
      onAsked = (count) => {
        if (count === each.events) queueMicrotask(destroy);
      };
      for (let at = 1; at <= each.events; at += 1) {
        send();
        await within(clock, () => taken >= at);
      }
      if (!(await within(clock, () => removed))) return 'the entry was never collected';
    }
    await runOut(clock);
    const held = client.getQueryData<CachedEventSet>(key)?.entries.size ?? 'none';
    const before = added;
    const present = (): boolean => client.getQueryCache().find({ queryKey: key }) !== undefined;
    client.setQueryData<unknown>(key, { written: 'by hand' });
    const atOnce = present();
    await runOut(clock);
    return {
      taken,
      held,
      added: before,
      byHand: { atOnce, after: present(), counted: added - before }
    };
  } finally {
    destroy();
    rxNostr.dispose();
    if (clock.fake) {
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
    }
  }
}

/** What each case must read. */
const expected = ({ delivery, events }: Case) =>
  delivery === 'while the request stands'
    ? {
        taken: events,
        held: events,
        added: 0,
        byHand: { atOnce: true, after: true, counted: 0 }
      }
    : {
        taken: delivery === 'after the entry is collected' ? 0 : events,
        held: 'none',
        added: 0,
        byHand: { atOnce: true, after: false, counted: 1 }
      };

describe('A11-C19: from the collection of a request’s entry on, nothing the request was delivered adds an entry for its key', () => {
  // @contracts A11-C19
  it(
    'LW1: on `streamedQueryAccumulator`',
    async () => {
      const readings = await onEachClock(CASES, caseName, (clock, each) =>
        delivered(streamedQueryAccumulator, clock, each)
      );
      expect(readings).toEqual(expectedOnEachClock(CASES, caseName, expected));
    },
    ARM_TIMEOUT_MS
  );

  it(
    'LW2: on `setQueryDataAccumulator`',
    async () => {
      const readings = await onEachClock(CASES, caseName, (clock, each) =>
        delivered(setQueryDataAccumulator, clock, each)
      );
      expect(readings).toEqual(expectedOnEachClock(CASES, caseName, expected));
    },
    ARM_TIMEOUT_MS
  );
});
