/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What an invocation's end does to everything an accumulator was handed:
 * `A11-C10`'s landing, on `LS1`–`LS11`.
 *
 * **Internal, because no relay reaches this.** Every arm injects an
 * accumulator, or drives the capability the engine lends, since the state the
 * row is about — a stream held past the invocation that handed it out — is
 * one only the far side of the seam can make.
 *
 * **Two mechanisms, and arms that separate them.** The invocation's `finally`
 * withdraws the capability and aborts the invocation, and both stop a late act
 * reaching the relay. So the arms are chosen by which one alone they die to:
 * only the abort closes what a producer opened (`LS1`, read as a `CLOSE` on
 * the wire), and only the withdrawal stops a chunk the producer had already
 * queued from crossing the seam (`LS3`, against its control `LS4`).
 *
 * - **Through a relay**: `LS1` (the abandoned producer's subscriptions,
 *   closed), `LS2` (everything the accumulator kept, used after the end: the
 *   same object back, and nothing on the wire), `LS3` and `LS4` (a marker
 *   queued behind the iterator, refused after the end and received by the
 *   same pull taken inside it), and `LS11` (whose attempt the stream's own
 *   `finally` abandons).
 * - **Directly, over a source the arm drives by hand**: `LS5` and its control
 *   `LS6` (a call in flight at each of the three doors while the withdrawal
 *   lands), `LS7` (a rejection in flight at each door, raised by identity),
 *   and `LS8`, `LS9` and `LS10` (the visits that reach the underlying at
 *   `next`, `return` and `throw`, counted across the withdrawal, a source and
 *   a counter apiece).
 *
 * Every wire reading is every frame the relay heard and not its REQs: a
 * producer opened against an already-aborted signal can reach the relay as a
 * `CLOSE` alone. And the engine's producers are counted and held, through a
 * delegating wrapper on `twoStageStream`: `LS2` reads that a late call opens
 * none, which the wire cannot see once the signal is aborted, and `LS3` pulls
 * the one behind the facade itself after the refusals, to read that the
 * machine and its queue were left as they were — so the visit a late pull
 * did not make is read through a relay too, beside `LS8`'s count.
 *
 * Port band 10840-10879.
 */
import { QueryClient, type QueryFunctionContext, type QueryKey } from 'tanstack-svelte-query-v6';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import {
  setQueryDataAccumulator,
  type StreamAccumulator,
  streamedQueryAccumulator
} from '$lib/v1/accumulate.js';
import { type AttemptId, type AttemptRegistry, createAttemptRegistry } from '$lib/v1/attempt.js';
import { oneShotStream } from '$lib/v1/capability.js';
import type { ReqHandle } from '$lib/v1/engine.js';
import { type Chunk, twoStageStream } from '$lib/v1/stream.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import {
  acceptAnyEvent,
  createTestRelay,
  fakeEvent,
  ownedEventPacket,
  respondWithEose,
  respondWithEvent
} from './helpers/relay.js';
import { openAmong, urlsFrom } from './helpers/request.js';
import { flush, mount } from './helpers/runes.svelte.js';

/**
 * Every producer the engine opens, so an arm can count them and can hold the
 * one behind a facade — which the facade's closure keeps from everything
 * else. The wrapper delegates, so what is mocked is the bookkeeping, as in
 * `ownership.test.ts`.
 */
vi.mock('$lib/v1/stream.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/v1/stream.js')>();
  return { ...actual, twoStageStream: vi.fn(actual.twoStageStream) };
});

/** The producers the engine has opened since `from`, oldest first. */
const producersSince = (from: number): AsyncGenerator<Chunk>[] =>
  vi
    .mocked(twoStageStream)
    .mock.results.slice(from)
    .map((result) => result.value as AsyncGenerator<Chunk>);

/** How many producers the engine has opened so far. */
const producersOpened = (): number => vi.mocked(twoStageStream).mock.results.length;

const attempts = createAttemptRegistry();

const nextUrl = urlsFrom(10840);

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
  WS.clean();
});

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function settle(ms = 80): Promise<void> {
  await delay(ms);
  flush();
}

/** Every frame the relay heard, whatever its kind, in order. */
const heard = (server: WS): unknown[][] => server.messages as unknown[][];

/** The backward subscriptions the relay has been asked for, oldest first. */
const askedBackward = (server: WS): string[] =>
  heard(server)
    .filter((frame) => frame[0] === 'REQ' && String(frame[1]).includes('-b:'))
    .map((frame) => String(frame[1]));

/** What {@link nextBackward} answers for a relay that was never asked. */
const NOT_ASKED = '(not asked)';

/**
 * The relay's newest backward subscription, once it has been asked for one.
 * **Bounded and answered rather than thrown**: a request that never asked is
 * the arm's premise failing, and the reading it reaches says so where the
 * clause is read, rather than at this wait.
 */
async function nextBackward(server: WS): Promise<string> {
  const deadline = Date.now() + 3000;
  while (askedBackward(server).length === 0 && Date.now() < deadline) await delay(10);
  return askedBackward(server).at(-1) ?? NOT_ASKED;
}

/** The legs the relay was asked to open, each named once. */
const legsAsked = (server: WS): string[] =>
  [
    ...new Set(
      heard(server)
        .filter((frame) => frame[0] === 'REQ')
        .map((frame) => (String(frame[1]).includes('-b:') ? 'backward' : 'forward'))
    )
  ].sort();

/** Where a call has got to, read without waiting on it for ever. */
type Landing<T> =
  | { readonly kind: 'resolved'; readonly value: T }
  | { readonly kind: 'rejected'; readonly error: unknown }
  | { readonly kind: 'pending' };

/**
 * How `promise` landed within `ms`. Bounded rather than awaited: a late pull
 * that reached a producer still waiting on the relay would otherwise be
 * reported as the runner's clock running out, with nothing read.
 */
async function within<T>(promise: Promise<T>, ms = 1000): Promise<Landing<T>> {
  let landing: Landing<T> = { kind: 'pending' };
  void promise.then(
    (value) => {
      landing = { kind: 'resolved', value };
    },
    (error: unknown) => {
      landing = { kind: 'rejected', error };
    }
  );
  const deadline = Date.now() + ms;
  while ((landing as Landing<T>).kind === 'pending' && Date.now() < deadline) await delay(10);
  return landing;
}

/** What these rows read of a request's state, at one instant. */
const stateOf = (handle: ReqHandle) => {
  const state = handle.state;
  return {
    status: state.status,
    events: state.status === 'loading' ? [] : state.events.map((event) => event.id),
    code: state.status === 'error' ? (state.error as { code?: unknown }).code : undefined
  };
};

/** A chunk, made through the ownership boundary as the stream's are. */
const chunkFor = (key: string): Chunk => ({
  type: 'event',
  packet: ownedEventPacket({ id: key }),
  fresh: true,
  attempt: attempts.mint()
});

/** The fields a `QueryFunctionContext` requires; the capability reads none of them. */
const contextFor = (key: string): QueryFunctionContext<QueryKey> => ({
  client,
  queryKey: [key] as QueryKey,
  signal: new AbortController().signal,
  meta: undefined
});

const DOORS = ['next', 'return', 'throw'] as const;
type Door = (typeof DOORS)[number];

/** One call at `door` of `iterator`, as an accumulator would make it. */
const callAt = (iterator: AsyncIterator<Chunk>, door: Door, key: string) =>
  door === 'next'
    ? iterator.next()
    : door === 'return'
      ? (iterator.return?.() ?? Promise.reject(new Error(`no return on ${key}`)))
      : (iterator.throw?.(new Error(`${key}-asked`)) ??
        Promise.reject(new Error(`no throw on ${key}`)));

/** An answer read by what it carries: the arm's chunk named, anything else as itself. */
const answerOf = (result: IteratorResult<Chunk> | undefined, chunk: Chunk) =>
  result === undefined
    ? undefined
    : { done: result.done, value: result.value === chunk ? 'the chunk' : result.value };

describe('A11-C10: nothing an invocation handed out outlives it', () => {
  // @contracts A11-C10
  it('LS1: an accumulator that pulls once and walks away has both legs closed by its invocation’s end', async () => {
    // **The abort's arm.** The producer is opened, pulled once and abandoned
    // — the iterator never closed — and the request is live, so the forward
    // leg is the subscription that would survive a producer nobody closed.
    // Two shapes: the pull awaited, leaving the generator parked at a `yield`,
    // and the pull left in flight — **unanswered**, so that it is still
    // outstanding when the invocation ends, which the reading reads rather
    // than assumes. The consumer stays mounted and the settle
    // timer is far off, so nothing but the invocation's end can close
    // anything: not the accumulator, which never asks, and not query-core,
    // whose signal is read in the reading to say it never fired.
    const readings: Record<string, unknown> = {};
    for (const awaited of [true, false]) {
      const name = `ls1-${awaited ? 'awaited' : 'in-flight'}`;
      let releaseTheInvocation = (): void => undefined;
      const released = new Promise<void>((done) => {
        releaseTheInvocation = done;
      });
      let queryCore: AbortSignal | undefined;
      let pullLanded = false;
      const accumulator: StreamAccumulator =
        ({ initialValue, streamFn }) =>
        async (context) => {
          queryCore = context.signal;
          const iterator = streamFn(context)[Symbol.asyncIterator]();
          const pull = iterator.next().then(() => {
            pullLanded = true;
          });
          if (awaited) await pull;
          await released;
          // Returns without closing the iterator.
          return initialValue;
        };
      const { rxNostr, server } = createTestRelay(nextUrl());
      const held = mount(() =>
        useStreamedReq(() => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace: name,
          filters: [{ kinds: [1] }],
          reqIdBase: name,
          live: true,
          retain: 'unbounded' as const,
          settleTimeoutMs: 30_000,
          accumulator
        }))
      );
      try {
        const backward = await nextBackward(server);
        // Answers the awaited pull, which does not fold it; the one in flight
        // is left waiting on the relay.
        if (awaited) respondWithEvent(server, backward, fakeEvent({ id: name, created_at: 1 }));
        await settle();
        const askedWhileItRan = legsAsked(server);
        const pullAtTheEnd = pullLanded ? 'answered' : 'outstanding';
        releaseTheInvocation();
        await settle(200);
        readings[name] = {
          askedWhileItRan,
          pullAtTheEnd,
          open: openAmong(heard(server)),
          queryCoreCancelled: queryCore?.aborted,
          ...stateOf(held.value)
        };
      } finally {
        held.destroy();
      }
    }
    expect(
      readings,
      'both legs asked while it ran, none open after its end, and query-core never cancelled'
    ).toEqual(
      Object.fromEntries(
        (['awaited', 'in-flight'] as const).map((shape) => [
          `ls1-${shape}`,
          {
            askedWhileItRan: ['backward', 'forward'],
            pullAtTheEnd: shape === 'awaited' ? 'answered' : 'outstanding',
            open: [],
            queryCoreCancelled: false,
            status: 'error',
            events: [],
            code: 'accumulator-contract'
          }
        ])
      )
    );
  }, 20_000);

  it('LS2: everything an accumulator kept, used after its invocation ended, is the first object and reaches nothing', async () => {
    // **The interval after the return.** The accumulator delegates to a
    // shipping one, so the request is an ordinary one with an ordinary
    // answer, and keeps three things past it: its `streamFn`, the context it
    // was called with, and the object the call returned. Once the request has
    // settled and is still mounted — so the only thing that has ended is the
    // invocation — the kept `streamFn` is called again, an iterator taken
    // from what that returns, and pulled. Not live, because a live invocation
    // ends only when something tears it down.
    //
    // **The same object, by identity**, which is the row's sentence and not
    // 0002's weaker one: a capability minting a fresh do-nothing facade per
    // late call opens nothing either, and it fails here. And the producers
    // are counted, since a late call that opened one against the aborted
    // signal would put nothing on the wire and hand back the same facade.
    // Both shipping accumulators, since "returned normally" is a different
    // path in each.
    const readings: Record<string, unknown> = {};
    for (const [key, adapter] of [
      ['streamed-query', streamedQueryAccumulator],
      ['set-query-data', setQueryDataAccumulator]
    ] as const) {
      const name = `ls2-${key}`;
      let kept: (() => AsyncIterable<Chunk>) | undefined;
      let held: AsyncIterable<Chunk> | undefined;
      const keeping: StreamAccumulator = (params) =>
        adapter({
          ...params,
          streamFn: (context) => {
            const stream = params.streamFn(context);
            held = stream;
            kept = () => params.streamFn(context);
            return stream;
          }
        });
      const { rxNostr, server } = createTestRelay(nextUrl());
      const opened = producersOpened();
      const request = mount(() =>
        useStreamedReq(() => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace: name,
          filters: [{ kinds: [1] }],
          reqIdBase: name,
          settleTimeoutMs: 30_000,
          accumulator: keeping
        }))
      );
      try {
        const backward = await nextBackward(server);
        respondWithEvent(server, backward, fakeEvent({ id: name, created_at: 1 }));
        respondWithEose(server, backward);
        await settle();
        const whileItRan = stateOf(request.value);
        const heardWhileItRan = heard(server).length;
        const producersWhileItRan = producersOpened() - opened;
        const again = kept?.();
        const acquired = again?.[Symbol.asyncIterator]();
        const pulled = acquired === undefined ? undefined : await within(acquired.next());
        // Long enough for anything either act opened to reach the relay.
        await settle(200);
        readings[name] = {
          whileItRan,
          producersWhileItRan,
          sameObject: again !== undefined && again === held,
          // The facade is its own iterator, so a late acquisition is that
          // object and not the producer behind it.
          sameIterator: acquired !== undefined && (acquired as object) === held,
          pulled,
          producersSince: producersOpened() - opened - producersWhileItRan,
          heardSince: heard(server).slice(heardWhileItRan),
          after: stateOf(request.value)
        };
      } finally {
        request.destroy();
      }
    }
    expect(
      readings,
      'the late call hands back the first object, its pull yields nothing, and the relay hears nothing'
    ).toEqual(
      Object.fromEntries(
        ['ls2-streamed-query', 'ls2-set-query-data'].map((name) => {
          const settled = { status: 'settled', events: [name], code: undefined };
          return [
            name,
            {
              whileItRan: settled,
              producersWhileItRan: 1,
              sameObject: true,
              sameIterator: true,
              pulled: { kind: 'resolved', value: { done: true, value: undefined } },
              producersSince: 0,
              heardSince: [],
              after: settled
            }
          ];
        })
      )
    );
  }, 20_000);

  /**
   * One pull taken, the relay's end delivered while nothing is pulling — so
   * the backlog's settle marker sits on the machine's queue behind the
   * iterator — then the invocation released to return, and pulls taken
   * `inside` it or after it. The stampless return earns the request an
   * `accumulator-contract` failure, read as part of the Given: an arm that
   * never ended its invocation would otherwise look like one that passed.
   * Last, the producer behind the facade is pulled by the arm itself until it
   * ends, which is what it still holds.
   */
  async function aMarkerQueuedBehindTheEnd(name: string, inside: boolean) {
    let iterator: AsyncIterator<Chunk> | undefined;
    let firstPull: IteratorResult<Chunk> | undefined;
    let insideTheInvocation: IteratorResult<Chunk> | undefined;
    let releaseTheInvocation = (): void => undefined;
    const queueIsLoaded = new Promise<void>((done) => {
      releaseTheInvocation = done;
    });
    const accumulator: StreamAccumulator =
      ({ initialValue, streamFn }) =>
      async (context) => {
        iterator = streamFn(context)[Symbol.asyncIterator]();
        firstPull = await iterator.next();
        await queueIsLoaded;
        // The one line the two arms differ by.
        if (inside) insideTheInvocation = await iterator.next();
        return initialValue;
      };
    const { rxNostr, server } = createTestRelay(nextUrl());
    const opened = producersOpened();
    const request = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: name,
        filters: [{ kinds: [1] }],
        reqIdBase: name,
        settleTimeoutMs: 30_000,
        accumulator
      }))
    );
    try {
      const backward = await nextBackward(server);
      respondWithEvent(server, backward, fakeEvent({ id: name, created_at: 1 }));
      await settle();
      respondWithEose(server, backward);
      await settle();
      const heardWhileItRan = heard(server).length;
      releaseTheInvocation();
      await settle();
      const late =
        inside || iterator === undefined
          ? []
          : [await within(iterator.next()), await within(iterator.next())];
      await settle(100);
      const heardSince = heard(server).slice(heardWhileItRan);
      const producers = producersSince(opened);
      const underlying: unknown[] = [];
      for (const producer of producers.slice(0, 1)) {
        for (let pull = 0; pull < 3; pull += 1) {
          const landed = await within(producer.next());
          underlying.push(
            landed.kind === 'resolved'
              ? { done: landed.value.done, type: landed.value.value?.type }
              : landed.kind
          );
          if (landed.kind !== 'resolved' || landed.value.done === true) break;
        }
      }
      return {
        producers: producers.length,
        firstPull: firstPull?.value?.type,
        ended: stateOf(request.value),
        insideTheInvocation:
          insideTheInvocation === undefined
            ? undefined
            : { done: insideTheInvocation.done, type: insideTheInvocation.value?.type },
        late,
        heardSince,
        underlying
      };
    } finally {
      request.destroy();
    }
  }

  const ENDED = { status: 'error', events: [], code: 'accumulator-contract' };

  it('LS3: a pull taken after the invocation ended yields nothing, a chunk queued before its end included', async () => {
    // **The withdrawal's arm.** The abort alone does not empty the queue —
    // the machine drains what it holds before it checks it has ended — so a
    // late pull delegated to the producer would be answered with the marker.
    // Pulled twice, so the refusal is not a one-shot answer that lets the next
    // pull through to the rest of the queue.
    //
    // **And the machine is left as it was.** The producer, pulled by the arm
    // after both refusals, still answers the marker and then its end — the
    // queue untouched and drained before the end — so what the withdrawal
    // changed is the seam and not the machine, and the late pulls did not
    // visit it.
    expect(
      await aMarkerQueuedBehindTheEnd('ls3', false),
      'both late pulls answered done with no value, nothing heard, and the marker still behind the facade'
    ).toEqual({
      producers: 1,
      firstPull: 'event',
      ended: ENDED,
      insideTheInvocation: undefined,
      late: [
        { kind: 'resolved', value: { done: true, value: undefined } },
        { kind: 'resolved', value: { done: true, value: undefined } }
      ],
      heardSince: [],
      underlying: [
        { done: false, type: 'settled' },
        { done: true, type: undefined }
      ]
    });
  }, 20_000);

  it('LS4: the same pull taken one step earlier, inside the invocation, receives the queued marker', async () => {
    // **`LS3`'s control.** "There was something queued" is not observable
    // once the answer is `done`, so this is the same accumulator pulling one
    // line before its return. It receiving the backlog's marker is what says
    // `LS3`'s `done` is a refusal rather than an empty queue.
    expect(
      await aMarkerQueuedBehindTheEnd('ls4', true),
      'the pull inside the invocation receives the settle marker queued behind the iterator'
    ).toEqual({
      producers: 1,
      firstPull: 'event',
      ended: ENDED,
      insideTheInvocation: { done: false, type: 'settled' },
      late: [],
      heardSince: [],
      underlying: [{ done: true, type: undefined }]
    });
  }, 20_000);

  /**
   * A call left in flight at `door` of the capability's facade, its answer —
   * a chunk, at every door, since a `return()` and a `throw()` may answer
   * `{done: false, value}` too — given on the arm's command, with the
   * withdrawal landing between the call and its answer when `withdraw` says.
   */
  async function inFlightAt(door: Door, withdraw: boolean) {
    const key = `ls-in-flight-${door}-${String(withdraw)}`;
    const chunk = chunkFor(key);
    let answer: ((result: IteratorResult<Chunk>) => void) | undefined;
    const pending = (): Promise<IteratorResult<Chunk>> =>
      new Promise<IteratorResult<Chunk>>((resolve) => {
        answer = resolve;
      });
    const capability = oneShotStream(() => ({
      [Symbol.asyncIterator]: (): AsyncIterator<Chunk> => ({
        next: pending,
        return: pending,
        throw: pending
      })
    }));
    const iterator = capability.stream(contextFor(key))[Symbol.asyncIterator]();
    const inFlight = callAt(iterator, door, key);
    // Out at the underlying before anything else happens, so the door is
    // behind it and only the check on the way back can answer.
    const reached = answer !== undefined;
    if (withdraw) capability.revoke();
    answer?.({ done: false, value: chunk });
    const landed = await within(inFlight);
    return {
      reached,
      landed: landed.kind === 'resolved' ? { resolved: answerOf(landed.value, chunk) } : landed.kind
    };
  }

  it('LS5: a call already in flight at any of the three doors when the capability is withdrawn has its chunk dropped', async () => {
    // **The check on the way back**, at each door, since each delegates
    // separately. Through a relay the only chunk deliverable after the end is
    // one already queued, and which check answers it is decided by
    // scheduling; a source that answers on command puts the withdrawal
    // strictly between the call and its answer.
    const readings: Record<string, unknown> = {};
    for (const door of DOORS) readings[door] = await inFlightAt(door, true);
    expect(readings, 'every door answers done once the withdrawal has landed').toEqual(
      Object.fromEntries(
        DOORS.map((door) => [
          door,
          { reached: true, landed: { resolved: { done: true, value: undefined } } }
        ])
      )
    );
  });

  it('LS6: the same calls, with nothing withdrawn, each deliver the chunk', async () => {
    // **`LS5`'s control**: the same source, the same call and the same answer,
    // differing in the one call. A source that never answered, or a door that
    // never delegated, would make `LS5`'s `done` say nothing; here each door
    // delivers.
    const readings: Record<string, unknown> = {};
    for (const door of DOORS) readings[door] = await inFlightAt(door, false);
    expect(readings, 'every door delivers the chunk while the capability is live').toEqual(
      Object.fromEntries(
        DOORS.map((door) => [
          door,
          { reached: true, landed: { resolved: { done: false, value: 'the chunk' } } }
        ])
      )
    );
  });

  it('LS7: a rejection in flight at any of the three doors still reaches the caller after the withdrawal, by identity', async () => {
    // **What does still cross.** A producer's failure carries no chunk and
    // opens nothing, so it raises at whoever asked, revoked or not — and
    // raises the same object, so a caller can tell the producer's failure
    // from a boundary of the capability's making. The withdrawal lands before
    // the rejection at every door: the other order says nothing.
    const readings: Record<string, unknown> = {};
    for (const door of DOORS) {
      const key = `ls7-${door}`;
      const failure = new Error(key);
      let raise: ((reason: unknown) => void) | undefined;
      const pending = (): Promise<IteratorResult<Chunk>> =>
        new Promise<IteratorResult<Chunk>>((_resolve, reject) => {
          raise = reject;
        });
      const capability = oneShotStream(() => ({
        [Symbol.asyncIterator]: (): AsyncIterator<Chunk> => ({
          next: pending,
          return: pending,
          throw: pending
        })
      }));
      const iterator = capability.stream(contextFor(key))[Symbol.asyncIterator]();
      const inFlight = callAt(iterator, door, key);
      const reached = raise !== undefined;
      capability.revoke();
      raise?.(failure);
      const landed = await within(inFlight);
      readings[door] = {
        reached,
        kind: landed.kind,
        raised: landed.kind === 'rejected' ? String(landed.error) : undefined,
        theProducersOwn: landed.kind === 'rejected' && landed.error === failure
      };
    }
    expect(readings, 'every door raises the producer’s own error').toEqual(
      Object.fromEntries(
        DOORS.map((door) => [
          door,
          { reached: true, kind: 'rejected', raised: `Error: ls7-${door}`, theProducersOwn: true }
        ])
      )
    );
  });

  /**
   * A source counting what reaches it — opens, acquisitions, and arrivals at
   * each door — driven at `door` once before the withdrawal and once after,
   * so each count is a difference across it rather than a door nothing ever
   * reached. Every arrival is answered with a chunk, so the answer before the
   * withdrawal is the door delivering and not a source that only ends. After
   * it, the kept `stream` is called again and an iterator taken from that, so
   * the late call and the late acquisition are read here too.
   */
  async function visitsAt(door: Door) {
    const key = `ls-visits-${door}`;
    const chunk = chunkFor(key);
    const reached = { opened: 0, acquired: 0, next: 0, return: 0, throw: 0 };
    const capability = oneShotStream(() => {
      reached.opened += 1;
      return {
        [Symbol.asyncIterator]: (): AsyncIterator<Chunk> => {
          reached.acquired += 1;
          const arrive = (at: Door) => async (): Promise<IteratorResult<Chunk>> => {
            reached[at] += 1;
            return { done: false, value: chunk };
          };
          return { next: arrive('next'), return: arrive('return'), throw: arrive('throw') };
        }
      };
    });
    const stream = capability.stream(contextFor(key));
    const iterator = stream[Symbol.asyncIterator]();
    const before = {
      answer: answerOf(await callAt(iterator, door, key), chunk),
      reached: { ...reached }
    };
    capability.revoke();
    const again = capability.stream(contextFor(`${key}-late`));
    const acquired = again[Symbol.asyncIterator]();
    const late = await within(callAt(acquired, door, `${key}-late`));
    return {
      before,
      after: {
        sameObject: again === stream,
        sameIterator: acquired === iterator,
        answer: late.kind === 'resolved' ? answerOf(late.value, chunk) : late.kind,
        reached: { ...reached }
      }
    };
  }

  /** What `visitsAt(door)` must read: one visit at `door`, before the withdrawal and still after it. */
  const oneVisitAt = (door: Door) => {
    const reached = { opened: 1, acquired: 1, next: 0, return: 0, throw: 0, [door]: 1 };
    return {
      before: { answer: { done: false, value: 'the chunk' }, reached },
      after: {
        sameObject: true,
        sameIterator: true,
        answer: { done: true, value: undefined },
        reached
      }
    };
  };

  it('LS8: a pull taken after the withdrawal does not reach the underlying, and no producer is opened for it', async () => {
    // **The visit, not the answer.** Delete the check at the door and a late
    // pull still comes back `done`, because the check on the way back turns
    // the underlying's answer into one; only the count of what arrives there
    // can tell. The late call is read by identity, and the counts say it
    // opened and acquired nothing.
    expect(
      await visitsAt('next'),
      'one pull reaches the source before the withdrawal, and none after it'
    ).toEqual(oneVisitAt('next'));
  });

  it('LS9: a `return()` issued after the withdrawal does not reach the underlying', async () => {
    // A late `return()` that reached the underlying would resume it — running
    // the producer's `finally`, and abandoning an attempt a later invocation
    // may by then own. Its own source and counter, not `LS8`'s.
    expect(
      await visitsAt('return'),
      'one `return()` reaches the source before the withdrawal, and none after it'
    ).toEqual(oneVisitAt('return'));
  });

  it('LS10: a `throw()` issued after the withdrawal does not reach the underlying', async () => {
    // A late `throw()` that reached the underlying would raise inside it.
    // Its own source and counter, not `LS8`'s or `LS9`'s.
    expect(
      await visitsAt('throw'),
      'one `throw()` reaches the source before the withdrawal, and none after it'
    ).toEqual(oneVisitAt('throw'));
  });

  it('LS11: the stream’s own `finally` abandons the attempt its invocation was handed, not a live one', async () => {
    // **Where a late pull can still reach the stream's `finally`.** After an
    // invocation's end it cannot: the withdrawal stops every pull before the
    // producer. What is left is an invocation whose attempt was cancelled and
    // which has not yet returned — its capability live, its attempt dead, and
    // a later attempt on the same request running beside it. So: the first
    // invocation waits before touching its `streamFn`; a `refresh()` cancels
    // it and starts a second; once the second's REQ is on the wire the first
    // opens its stream and pulls, which runs the stream to its `finally`; and
    // then the second is answered. The registry is the arm's, watched, so the
    // reading says whose attempt that pull abandoned and whether the live one
    // still answers its caller.
    const registry = createAttemptRegistry();
    const handed: AttemptId[] = [];
    const abandoned: AttemptId[] = [];
    const watched: AttemptRegistry = {
      ...registry,
      begin: (lane) => {
        const id = registry.begin(lane);
        handed.push(id);
        return id;
      },
      abandon: (id, reason, as) => {
        abandoned.push(id);
        registry.abandon(id, reason, as);
      }
    };
    let invocations = 0;
    let releaseTheFirst = (): void => undefined;
    const theSecondIsRunning = new Promise<void>((done) => {
      releaseTheFirst = done;
    });
    let latePull: Promise<{ result: IteratorResult<Chunk>; abandoned: AttemptId[] }> | undefined;
    const accumulator: StreamAccumulator = (params) => {
      invocations += 1;
      if (invocations > 1) return streamedQueryAccumulator(params);
      return async (context) => {
        const pulled = (async () => {
          await theSecondIsRunning;
          const iterator = params.streamFn(context)[Symbol.asyncIterator]();
          const since = abandoned.length;
          const result = await iterator.next();
          return { result, abandoned: abandoned.slice(since) };
        })();
        latePull = pulled;
        await pulled;
        return params.initialValue;
      };
    };
    const name = 'ls11';
    const { rxNostr, server } = createTestRelay(nextUrl());
    const request = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts: watched,
        rxNostr,
        client,
        namespace: name,
        filters: [{ kinds: [1] }],
        reqIdBase: name,
        settleTimeoutMs: 30_000,
        accumulator
      }))
    );
    try {
      await settle();
      const refreshed = request.value.refresh();
      const backward = await nextBackward(server);
      releaseTheFirst();
      const pulled = latePull === undefined ? undefined : await within(latePull);
      respondWithEvent(server, backward, fakeEvent({ id: name, created_at: 1 }));
      respondWithEose(server, backward);
      const outcome = await within(refreshed, 3000);
      await settle();
      const whose = (id: AttemptId): string =>
        id === handed[0] ? 'its own' : id === handed[1] ? 'the live one' : id;
      expect(
        {
          invocations,
          askedAs: backward.includes(String(handed[1])) ? 'the live one' : backward,
          latePull:
            pulled?.kind === 'resolved'
              ? {
                  result: pulled.value.result,
                  abandoned: pulled.value.abandoned.map(whose)
                }
              : pulled?.kind,
          outcome,
          after: stateOf(request.value)
        },
        'the late pull abandons the first invocation’s attempt, and the live one answers its caller'
      ).toEqual({
        invocations: 2,
        askedAs: 'the live one',
        latePull: { result: { done: true, value: undefined }, abandoned: ['its own'] },
        outcome: { kind: 'resolved', value: { kind: 'complete' } },
        after: { status: 'settled', events: [name], code: undefined }
      });
    } finally {
      request.destroy();
    }
  }, 20_000);
});
