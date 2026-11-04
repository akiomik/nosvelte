/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A request's subscriptions as its plan and its attempts change: the landings
 * of `B-η-C5` (`SB1`), `A5-C30` (`SB2`), `B2-C3` (`SB3`), `A6-C5` (`SB4`),
 * `A6-C8` (`SB5`) and `C6-C10` (`SB6`).
 *
 * **Through the published entry**, because the rows are `public`: `NostrApp`
 * with `relays` only and a consumer's own `useReq` under it
 * (`fixtures/PublishedRequest.svelte`), and what a relay puts on the wire. A
 * relay's `CLOSED` names the subscription it answers, as a relay does, so each
 * one here is a frame the relay composed, not a call into the library.
 *
 * Port band 10600-10679.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';

import PublishedRequest from './fixtures/PublishedRequest.svelte';
import RequestsInTurn from './fixtures/RequestsInTurn.svelte';
import { type Relay, relayAt, signed, urlsFrom } from './helpers/request.js';
import { box, flush } from './helpers/runes.svelte.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(10600);

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A wait long enough for a frame to be taken, and for what follows from it to be published. */
const A_TURN_MS = 100;

/** A request's own deadline, far beyond every reading here: nothing below is its timer. */
const SETTLE_TIMEOUT_MS = 30_000;

/** A request that ends, or a live one, for the kinds it names. */
const request = (isLive: boolean, kinds: number[] = [1]): ReqPlan => ({
  kind: 'request',
  descriptor: isLive
    ? { filters: [{ kinds }], live: true, retain: 'unbounded', settleTimeoutMs: SETTLE_TIMEOUT_MS }
    : { filters: [{ kinds }], settleTimeoutMs: SETTLE_TIMEOUT_MS }
});

/** A live request for the kinds it names. */
const live = (kinds: number[] = [1]): ReqPlan => request(true, kinds);

/** What a request publishes that these rows read. */
const readingOf = (handle: ReqHandle) => ({
  status: handle.state.status,
  causes: handle.state.status === 'incomplete' ? [...handle.state.causes] : undefined,
  events:
    handle.state.status === 'loading'
      ? []
      : handle.state.events.map((event) => event.content).sort(),
  refusals: handle.diagnostics.refusals.map((each) => `${each.leg}:${each.reason}`)
});

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

/** Whether `done` comes to hold within three seconds of real time. */
const until = (done: () => boolean): Promise<void> =>
  vi.waitFor(() => expect(done(), done.toString()).toBe(true), { timeout: 3000 });

/** Whether `done` comes to hold within `ms` of real time, as an answer rather than a throw. */
const within = async (done: () => boolean, ms: number): Promise<boolean> => {
  try {
    await vi.waitFor(() => expect(done()).toBe(true), { timeout: ms });
    return true;
  } catch {
    return false;
  }
};

/**
 * A consumer's own request on `relays`, under the published entry, the handle
 * it holds, and every reading it published, as of the flush it published it in.
 */
function consumerOn(relays: readonly Relay[], plan: () => ReqPlan) {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  let handle: ReqHandle | undefined;
  const publications: ReturnType<typeof readingOf>[] = [];
  const view = render(PublishedRequest, {
    relays: relays.map((relay) => relay.url),
    plan,
    seen: (held: ReqHandle) => {
      handle = held;
    },
    published: (held: ReqHandle) => {
      publications.push(readingOf(held));
    }
  });
  return { view, handle: () => handle as ReqHandle, publications };
}

/** Each `REQ` `relay` was sent, in order: its leg, its subscription name and the kinds it asked for. */
const reqsOf = (relay: Relay) =>
  (relay.server.messages as unknown[][])
    .filter((frame) => frame[0] === 'REQ')
    .map(([, subId, filter]) => ({
      leg: legOf(String(subId)),
      subId: String(subId),
      kinds: (filter as { kinds?: number[] }).kinds
    }));

/** The leg a subscription name belongs to, as the machine names its two. */
const legOf = (subId: string): string =>
  subId.includes('-b:') ? 'backward' : subId.includes('-f:') ? 'forward' : subId;

/** The frames `relay` was sent from the `from`th on: each kind, leg and the kinds a `REQ` asked for. */
const framesFrom = (relay: Relay, from: number): string[] =>
  (relay.server.messages as unknown[][])
    .slice(from)
    .map(([kind, subId, filter]) =>
      [
        String(kind),
        legOf(String(subId)),
        ...(kind === 'REQ' ? [JSON.stringify((filter as { kinds?: number[] }).kinds)] : [])
      ].join(' ')
    )
    .sort();

/**
 * A consumer's own request answered on `kinds: [1]`, whose plan then moves to
 * `kinds: [7]` with the consumer still mounted: what the relay is sent when it
 * moves, every reading published from then on, and the answer once the second
 * descriptor's backlog has settled. On a live request, the relay then sends an
 * event on the first descriptor's forward subscription.
 */
async function movedOnce(isLive: boolean) {
  const relay = relayAt(nextUrl());
  const plan = box(request(isLive, [1]));
  const one = consumerOn([relay], () => plan.current);
  try {
    await until(
      () =>
        relay.asked('backward').length === 1 && relay.asked('forward').length === (isLive ? 1 : 0)
    );
    relay.sendBacklog(1, 'first');
    relay.answerBacklog();
    await until(() => one.handle().state.status === 'settled');
    await delay(A_TURN_MS);
    const firstForward = relay.asked('forward')[0];
    const sent = relay.server.messages.length;
    const published = one.publications.length;
    plan.current = request(isLive, [7]);
    flush();
    await until(
      () =>
        relay.asked('backward').length === 2 && relay.asked('forward').length === (isLive ? 2 : 0)
    );
    await delay(A_TURN_MS);
    const whenItMoved = framesFrom(relay, sent);
    const closedTheFirst =
      firstForward !== undefined && relay.closed('forward').includes(firstForward);
    if (firstForward !== undefined) {
      relay.server.send(['EVENT', firstForward, signed('late on the first', 3000)]);
    }
    await delay(A_TURN_MS);
    relay.server.send(['EVENT', relay.asked('backward').at(-1), signed('second', 1000, 7)]);
    relay.answerBacklog();
    await until(() => one.publications.slice(published).some((each) => each.status === 'settled'));
    await delay(A_TURN_MS);
    return {
      whenItMoved,
      closedTheFirst,
      afterTheMove: [
        ...new Set(one.publications.slice(published).flatMap((each) => each.events))
      ].sort(),
      answer: readingOf(one.handle())
    };
  } catch (error) {
    return failed(error);
  } finally {
    one.view.unmount();
    vi.unstubAllGlobals();
  }
}

describe('B-η: when an attempt’s refusals stop being published', () => {
  // @contracts B-η-C5
  it('SB1: the next attempt withdraws the last one’s records at its start and its end, and a late refusal is published as no cause', async () => {
    // **The start is read while the new attempt is silent**: its REQs are on
    // the wire and no relay has answered them, which is the instant a
    // withdrawal made at the first chunk misses. Then at its first chunk and at
    // its end. **Two relays**, one refusing both legs and the other silent or
    // answered, so that the first attempt's backlog either never ended — both
    // of its records are withdrawn at the start — or ended under the refusal,
    // whose backward record goes on explaining the answer on show until the
    // next backlog replaces it.
    const withdrawn = async (ended: boolean) => {
      const refusing = relayAt(nextUrl());
      const other = relayAt(nextUrl());
      const one = consumerOn([refusing, other], () => live());
      try {
        await until(
          () =>
            [refusing, other].every((relay) => relay.asked('backward').length === 1) &&
            [refusing, other].every((relay) => relay.asked('forward').length === 1)
        );
        refusing.server.send(['CLOSED', refusing.asked('backward')[0], 'blocked: not here']);
        refusing.server.send(['CLOSED', refusing.asked('forward')[0], 'blocked: not here']);
        await until(() => one.handle().diagnostics.refusals.length === 2);
        if (ended) {
          other.answerBacklog();
          await until(() => one.handle().state.status === 'incomplete');
        }
        await delay(A_TURN_MS);
        const before = readingOf(one.handle());
        const running = one.handle().refresh();
        await until(() =>
          [refusing, other].every(
            (relay) => relay.asked('backward').length === 2 && relay.asked('forward').length === 2
          )
        );
        await delay(A_TURN_MS);
        const atItsStart = readingOf(one.handle());
        refusing.sendBacklog(1, 'fresh');
        await until(() => readingOf(one.handle()).events.includes('fresh-0'));
        const atItsFirstChunk = readingOf(one.handle());
        refusing.answerBacklog();
        other.answerBacklog();
        const outcome = await Promise.race([running, delay(3000)]);
        await delay(A_TURN_MS);
        return { before, atItsStart, atItsFirstChunk, outcome, atItsEnd: readingOf(one.handle()) };
      } catch (error) {
        return failed(error);
      } finally {
        one.view.unmount();
        vi.unstubAllGlobals();
      }
    };
    // **A refusal of the attempt the answer is on, after its backlog ended**,
    // against the same relay's refusal before the end: published both times,
    // and a cause only the second time.
    const late = async (afterTheEnd: boolean) => {
      const relay = relayAt(nextUrl());
      const one = consumerOn([relay], () => live());
      try {
        await until(() => relay.asked('backward').length === 1);
        const backward = relay.asked('backward')[0];
        if (afterTheEnd) {
          relay.answerBacklog();
          await until(() => one.handle().state.status === 'settled');
        }
        relay.server.send(['CLOSED', backward, 'restricted: members only']);
        await until(() => one.handle().diagnostics.refusals.length === 1);
        await delay(A_TURN_MS);
        return readingOf(one.handle());
      } catch (error) {
        return failed(error);
      } finally {
        one.view.unmount();
        vi.unstubAllGlobals();
      }
    };
    const runs = {
      'a backlog that never ended': await withdrawn(false),
      'a backlog that ended': await withdrawn(true),
      'refused after the end': await late(true),
      'refused before the end': await late(false)
    };
    const both = ['backward:blocked', 'forward:blocked'];
    expect(runs).toEqual({
      'a backlog that never ended': {
        before: { status: 'streaming', events: [], refusals: both },
        atItsStart: { status: 'streaming', events: [], refusals: [] },
        atItsFirstChunk: { status: 'streaming', events: ['fresh-0'], refusals: [] },
        outcome: { kind: 'complete' },
        atItsEnd: { status: 'settled', events: ['fresh-0'], refusals: [] }
      },
      'a backlog that ended': {
        before: { status: 'incomplete', causes: ['refused'], events: [], refusals: both },
        atItsStart: {
          status: 'incomplete',
          causes: ['refused'],
          events: [],
          refusals: ['backward:blocked']
        },
        atItsFirstChunk: {
          status: 'incomplete',
          causes: ['refused'],
          events: ['fresh-0'],
          refusals: ['backward:blocked']
        },
        outcome: { kind: 'complete' },
        atItsEnd: { status: 'settled', events: ['fresh-0'], refusals: [] }
      },
      'refused after the end': { status: 'settled', events: [], refusals: ['backward:restricted'] },
      'refused before the end': {
        status: 'incomplete',
        causes: ['refused'],
        events: [],
        refusals: ['backward:restricted']
      }
    });
  }, 30_000);
});

describe('A5 and B2: a plan that moves while its consumer stays mounted', () => {
  // @contracts A5-C30
  it('SB2: moving a live plan closes its first forward subscription with the consumer still mounted, and asks the second', async () => {
    // **The consumer is not torn down**, which is what `A5-C21` reads: the
    // close comes from the plan moving. The live request against one that is
    // not, whose backlog is all there is to ask again. The frames are those
    // sent from the move on, sorted, because which of them goes first is no
    // part of the row; an event the relay then sends on the first forward
    // subscription is looked for in every reading published after the move.
    const runs = { live: await movedOnce(true), 'not live': await movedOnce(false) };
    const late = (run: Awaited<ReturnType<typeof movedOnce>>) =>
      'answer' in run
        ? [...run.afterTheMove, ...run.answer.events].includes('late on the first')
        : run;
    expect({
      live: { ...runs.live, late: late(runs.live) },
      'not live': { ...runs['not live'], late: late(runs['not live']) }
    }).toEqual({
      live: expect.objectContaining({
        whenItMoved: ['CLOSE forward', 'REQ backward [7]', 'REQ forward [7]'],
        closedTheFirst: true,
        late: false
      }),
      'not live': expect.objectContaining({
        whenItMoved: ['REQ backward [7]'],
        closedTheFirst: false,
        late: false
      })
    });
  }, 30_000);

  // @contracts B2-C3
  it('SB3: once a plan moves, no reading holds the first descriptor’s events, and the second’s backlog is the answer', async () => {
    // Every reading published from the move on, live and not: the first
    // descriptor's event is in none of them — not while the second backlog is
    // being asked, and not after it — and the settled answer is the second's.
    const runs = { live: await movedOnce(true), 'not live': await movedOnce(false) };
    const second = {
      afterTheMove: ['second'],
      answer: { status: 'settled', events: ['second'], refusals: [] }
    };
    expect(runs).toEqual({
      live: expect.objectContaining(second),
      'not live': expect.objectContaining(second)
    });
  }, 30_000);
});

describe('A6 and C6: the subscriptions two attempts, two requests and two providers open', () => {
  // @contracts A6-C5
  it('SB4: each attempt of a live request asks each relay once per leg, under a name of its own, and refresh() does so again', async () => {
    // **Both legs, before and after the `refresh()`**, over two relays, and
    // counted a turn after each answer as well, so that a `REQ` sent twice
    // under one name — the shape the first v1 hook had — is on the wire to be
    // counted. The id is per leg per attempt and is fanned out, so one name on
    // both relays is the expected shape and one relay asked twice is the defect.
    const relays = [relayAt(nextUrl()), relayAt(nextUrl())];
    const one = consumerOn(relays, () => live());
    const asked = (count: number) =>
      relays.every(
        (relay) => relay.asked('backward').length >= count && relay.asked('forward').length >= count
      );
    try {
      await until(() => asked(1));
      for (const relay of relays) relay.answerBacklog();
      await until(() => one.handle().state.status === 'settled');
      await delay(A_TURN_MS);
      const first = relays.map(reqsOf);
      const running = one.handle().refresh();
      await until(() => asked(2));
      for (const relay of relays) relay.answerBacklog();
      const outcome = await Promise.race([running, delay(3000)]);
      await delay(A_TURN_MS);
      const both = relays.map(reqsOf);
      const names = (reqs: ReturnType<typeof reqsOf>, leg: string) =>
        reqs.filter((each) => each.leg === leg).map((each) => each.subId);
      expect({
        outcome,
        firstAttempt: first.map((reqs) => reqs.map((each) => each.leg).sort()),
        bothAttempts: both.map((reqs) => reqs.map((each) => each.leg).sort()),
        noNameTwiceToOneRelay: both.map((reqs) => new Set(reqs.map((each) => each.subId)).size),
        legsShareNoName: both.map(
          (reqs) =>
            names(reqs, 'backward').filter((name) => names(reqs, 'forward').includes(name)).length
        ),
        sameForwardOnBothRelays: [0, 1].map(
          (attempt) =>
            names(both[0] ?? [], 'forward')[attempt] === names(both[1] ?? [], 'forward')[attempt]
        ),
        newForwardIsNotTheLast:
          names(both[0] ?? [], 'forward')[1] !== names(both[0] ?? [], 'forward')[0]
      }).toEqual({
        outcome: { kind: 'complete' },
        firstAttempt: [
          ['backward', 'forward'],
          ['backward', 'forward']
        ],
        bothAttempts: [
          ['backward', 'backward', 'forward', 'forward'],
          ['backward', 'backward', 'forward', 'forward']
        ],
        noNameTwiceToOneRelay: [4, 4],
        legsShareNoName: [0, 0],
        sameForwardOnBothRelays: [true, true],
        newForwardIsNotTheLast: true
      });
    } finally {
      one.view.unmount();
      vi.unstubAllGlobals();
    }
  }, 30_000);

  // @contracts A6-C8
  it('SB5: two requests at once on one relay are each asked under names of their own, and each answer is its own, under randomness fixed to one value too', async () => {
    // **#95's collision is a draw**, so two ordinary requests pass under a
    // random six-digit name as well: the platform's randomness fixed to one
    // value — `Math.random`, `getRandomValues` and `randomUUID` — is what makes
    // two names drawn at random the same name. Live and not, under either.
    const run = async (isLive: boolean, fixed: boolean) => {
      if (fixed) {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
          <T extends ArrayBufferView | null>(array: T): T => {
            if (array !== null) new Uint8Array(array.buffer).fill(7);
            return array;
          }
        );
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
          '77777777-7777-4777-8777-777777777777'
        );
      }
      vi.stubGlobal('WebSocket', MockWebSocket);
      vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
      const relay = relayAt(nextUrl());
      const handles: Partial<Record<'first' | 'second', ReqHandle>> = {};
      const view = render(RequestsInTurn, {
        relays: [relay.url],
        first: () => request(isLive, [1]),
        second: () => request(isLive, [7]),
        later: true,
        seen: (which: 'first' | 'second', held: ReqHandle) => {
          handles[which] = held;
        }
      });
      try {
        // The relay is read a turn after the first `REQ` and not once two
        // have come, so that two requests sharing a name — of which the relay
        // hears one — are read as what they did rather than as a wait that ran
        // out. Each is then answered on the subscription that carries its kinds,
        // where there is one.
        await until(() => relay.asked('backward').length >= 1);
        await delay(A_TURN_MS * 2);
        const reqs = reqsOf(relay);
        for (const kind of [1, 7]) {
          const backward = reqs.find((each) => each.leg === 'backward' && each.kinds?.[0] === kind);
          if (backward === undefined) continue;
          relay.server.send(['EVENT', backward.subId, signed(`kind ${String(kind)}`, 1000, kind)]);
          relay.server.send(['EOSE', backward.subId]);
        }
        await within(
          () => [handles.first, handles.second].every((held) => held?.state.status === 'settled'),
          1000
        );
        await delay(A_TURN_MS);
        const legs = isLive ? ['backward', 'forward'] : ['backward'];
        return {
          namesPerLeg: legs.map(
            (leg) => new Set(reqs.filter((each) => each.leg === leg).map((each) => each.subId)).size
          ),
          kindsPerLeg: legs.map((leg) =>
            reqs
              .filter((each) => each.leg === leg)
              .map((each) => each.kinds?.[0])
              .sort()
          ),
          first: readingOf(handles.first as ReqHandle).events,
          second: readingOf(handles.second as ReqHandle).events
        };
      } catch (error) {
        return failed(error);
      } finally {
        view.unmount();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      }
    };
    const runs = {
      'live, random': await run(true, false),
      'live, fixed': await run(true, true),
      'not live, random': await run(false, false),
      'not live, fixed': await run(false, true)
    };
    const own = (isLive: boolean) => ({
      namesPerLeg: isLive ? [2, 2] : [2],
      kindsPerLeg: isLive
        ? [
            [1, 7],
            [1, 7]
          ]
        : [[1, 7]],
      first: ['kind 1'],
      second: ['kind 7']
    });
    expect(runs).toEqual({
      'live, random': own(true),
      'live, fixed': own(true),
      'not live, random': own(false),
      'not live, fixed': own(false)
    });
  }, 30_000);

  // @contracts C6-C10
  it('SB6: two requests in one provider share a relay’s socket, and a second provider is a second socket', async () => {
    // `RG6`'s arrangement on the published entry: two consumers' requests under
    // one `NostrApp`, naming overlapping subsets of its relays — one both, one
    // the shared relay alone, each by kinds of its own so the other relay's
    // frames say whose they are — and then a second `NostrApp` on the shared
    // relay, with a request of its own so that it connects.
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
    const shared = relayAt(nextUrl());
    const other = relayAt(nextUrl());
    const subset = (relays: string[], kinds: number[]): ReqPlan => ({
      kind: 'request',
      descriptor: { filters: [{ kinds }], relays, settleTimeoutMs: SETTLE_TIMEOUT_MS }
    });
    const first = render(RequestsInTurn, {
      relays: [shared.url, other.url],
      first: () => subset([shared.url, other.url], [1]),
      second: () => subset([shared.url], [7]),
      later: true,
      seen: () => {}
    });
    let second: { unmount: () => void } | undefined;
    try {
      await until(
        () => shared.asked('backward').length === 2 && other.asked('backward').length === 1
      );
      await delay(A_TURN_MS);
      const inOneProvider = {
        sharedAsked: reqsOf(shared)
          .map((each) => each.kinds?.[0])
          .sort(),
        sharedSockets: shared.sockets(),
        otherAsked: reqsOf(other).map((each) => each.kinds?.[0])
      };
      second = render(PublishedRequest, {
        relays: [shared.url],
        plan: () => subset([shared.url], [9]),
        seen: () => {},
        published: () => {}
      });
      await until(() => shared.asked('backward').length === 3);
      await delay(A_TURN_MS);
      expect({ inOneProvider, withASecondProvider: shared.sockets() }).toEqual({
        inOneProvider: { sharedAsked: [1, 7], sharedSockets: 1, otherAsked: [1] },
        withASecondProvider: 2
      });
    } finally {
      second?.unmount();
      first.unmount();
      vi.unstubAllGlobals();
    }
  }, 30_000);
});
