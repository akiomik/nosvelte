/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a relay's refusal is called, and what it does to a request: the
 * landings of `A-α-C1` (`RJ1`), `A-α-C2` (`RJ2`), `A-α-C3` (`RJ3`), `A-α-C4`
 * (`RJ4`), `A-α-C5` (`RJ5`), `A5-S4` (`RJ6`) and `A-α-C6` (`RJ7`).
 *
 * **Through the published entry**, because the rows but `A-α-C6` are `public`: `NostrApp`
 * with `relays` only and consumers' own `useReq` under it
 * (`descriptor/Host.svelte`), and what a relay puts on the wire. The subId a
 * relay answers with is the relay's to choose, so each `CLOSED` here is a frame
 * the relay composed, not a call into the library.
 *
 * Port band 10500-10559.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import { recoveryFor, type RefusalReason } from '$lib/v1/refusal.js';

import Host from '../descriptor/Host.svelte';
import { signed, urlsFrom } from './helpers/request.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(10500);

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A wait long enough for a frame to be taken, and for what follows from it to be published. */
const A_TURN_MS = 100;

/** Beyond the two seconds a leg that ended with no refusal waits before it is asked again. */
const PAST_THE_RECOVERYS_FIRST_WAIT_MS = 2600;

/** A request's own deadline, far beyond every reading here: nothing below is its timer. */
const SETTLE_TIMEOUT_MS = 30_000;

/** A request that ends, or a live one, for the kinds it names. */
const request = (live: boolean, kinds: number[] = [1]): ReqPlan => ({
  kind: 'request',
  descriptor: live
    ? {
        filters: [{ kinds }],
        live: true,
        retain: 'unbounded',
        settleTimeoutMs: SETTLE_TIMEOUT_MS
      }
    : { filters: [{ kinds }], settleTimeoutMs: SETTLE_TIMEOUT_MS }
});

/** A relay that is listening, and the subscriptions it has been asked for on each leg. */
function listening() {
  const url = nextUrl();
  const server = new WS(url, { jsonProtocol: true });
  const asked = (leg: 'b' | 'f'): string[] =>
    (server.messages as unknown[][])
      .filter((frame) => frame[0] === 'REQ' && String(frame[1]).includes(`-${leg}:`))
      .map((frame) => String(frame[1]));
  return {
    url,
    server,
    asked,
    /** The subscription the relay was last asked for on `leg`, once it has been asked. */
    latest: async (leg: 'b' | 'f', beyond = 0): Promise<string> => {
      await vi.waitFor(() => expect(asked(leg).length).toBeGreaterThan(beyond), { timeout: 3000 });
      return asked(leg).at(-1) as string;
    }
  };
}
type Listening = ReturnType<typeof listening>;

/** `plans` under one provider on `relays`, each handle as a consumer holds it. */
function mounted(relays: readonly Listening[], plans: readonly ReqPlan[]) {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  const handles: ReqHandle[] = [];
  const view = render(Host, {
    relays: relays.map((relay) => relay.url),
    plans: plans.map((plan) => () => plan),
    seen: (index: number, handle: ReqHandle) => {
      handles[index] = handle;
    }
  });
  return { view, handle: (index = 0) => handles[index] as ReqHandle };
}

/** What a request publishes that these rows read. */
const readingOf = (handle: ReqHandle) => ({
  status: handle.state.status,
  causes: handle.state.status === 'incomplete' ? [...handle.state.causes] : undefined,
  events:
    handle.state.status === 'loading'
      ? []
      : handle.state.events.map((event) => event.content).sort(),
  activity: handle.activity,
  legEnded: handle.diagnostics.legEnded?.kind,
  refusals: handle.diagnostics.refusals.map((each) => `${each.leg}:${each.reason}`)
});

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

/** The class a relay's `notice` lands in, on each leg of a live request. */
async function classOf(notice: string | undefined) {
  const relay = listening();
  const one = mounted([relay], [request(true)]);
  try {
    const frame = (subId: string) =>
      notice === undefined ? ['CLOSED', subId] : ['CLOSED', subId, notice];
    relay.server.send(frame(await relay.latest('b')));
    relay.server.send(frame(await relay.latest('f')));
    await vi.waitFor(() => expect(one.handle().diagnostics.refusals).toHaveLength(2), {
      timeout: 3000
    });
    return one.handle().diagnostics.refusals.map((each) => ({
      leg: each.leg,
      reason: each.reason,
      text: each.notice.text
    }));
  } catch (error) {
    return failed(error);
  } finally {
    one.view.unmount();
    vi.unstubAllGlobals();
  }
}

/** What `classOf` reads for a relay saying `text`, classed as `reason`, on both legs. */
const inBothLegs = (reason: string, text: string) => [
  { leg: 'backward', reason, text },
  { leg: 'forward', reason, text }
];

describe('A-α: what a relay’s refusal is called, and what it does', () => {
  // @contracts A-α-C1
  it('RJ1: each of the nine standardized prefixes lands in its own class, on either leg', async () => {
    // **The published class, off the frame the relay sends**: `reason` on
    // `diagnostics.refusals`, for a refusal of each leg of a live request. The
    // nine names are written here, not read from the library, and they are nine
    // distinct answers, so a prefix folded into another's class fails. The
    // last two read that the prefix is what is read: a notice whose text goes
    // on to name another class is the class it opens with.
    const nine = [
      'duplicate',
      'pow',
      'blocked',
      'rate-limited',
      'invalid',
      'restricted',
      'mute',
      'error',
      'auth-required'
    ];
    const readings: Record<string, unknown> = {};
    for (const prefix of nine) readings[prefix] = await classOf(`${prefix}: the relay says so`);
    readings['opens with one and names another'] = await classOf('blocked: rate-limited: wait');
    readings['no space after the colon'] = await classOf('restricted:members only');
    expect(readings, 'each prefix is its own class, and only the prefix is read').toEqual({
      ...Object.fromEntries(
        nine.map((prefix) => [prefix, inBothLegs(prefix, `${prefix}: the relay says so`)])
      ),
      'opens with one and names another': inBothLegs('blocked', 'blocked: rate-limited: wait'),
      'no space after the colon': inBothLegs('restricted', 'restricted:members only')
    });
  }, 30_000);

  // @contracts A-α-C2
  it('RJ2: a notice with no prefix, or an unknown one, is `unknown`, not another name', async () => {
    // **Each is a string a relay may send**: NIP-01 does not require a prefix.
    // A word of the vocabulary with no colon after it, one with something
    // joined to it, one in another case, a word an object inherits, and no
    // notice at all: each is `unknown`, and none is folded into `error`, which
    // is the class a guess would reach for. The kept text is read beside it,
    // so that each reading is the frame it was sent for.
    const notices = [
      'we are down for maintenance',
      '',
      'teapot: short and stout',
      'rate-limited',
      'invalidX',
      'mutes',
      'Blocked: in another case',
      'constructor: a word every object has'
    ];
    const readings: Record<string, unknown> = {};
    for (const notice of notices) readings[notice] = await classOf(notice);
    readings['no notice at all'] = await classOf(undefined);
    expect(readings, 'unknown, each of them').toEqual({
      ...Object.fromEntries(notices.map((notice) => [notice, inBothLegs('unknown', notice)])),
      'no notice at all': inBothLegs('unknown', 'absent')
    });
  }, 30_000);

  // @contracts A-α-C3
  it('RJ3: a live request refused by every relay ends its leg with nothing else happening, and refresh() puts a REQ back', async () => {
    // **Nothing else happens**: no event, no timer of the request's own near
    // the readings, no socket going away. **Four runs**, because each has a way
    // of passing that another does not. One relay and two: with two, the first
    // refusal does not end the leg and the last does. A rate limit and a block,
    // since a refusal "that clears by waiting" is the one the first version of
    // this library left reporting `live` with no subscription anywhere. And a
    // backlog answered and one still waiting, where the leg's end is published
    // while the attempt is running. The way back is read as frames: a new
    // subscription on each leg of each relay, which, answered, is `complete`.
    // **And nothing but `refresh()` does that**: a fifth run is left alone past
    // the recovery's first wait, on the class recorded as clearing by itself,
    // since a recovery keyed on that class has no other run to show in.
    const run = async (relays: Listening[], notice: string, answered: boolean) => {
      const one = mounted(relays, [request(true)]);
      try {
        const forward: string[] = [];
        const backward: string[] = [];
        for (const relay of relays) {
          forward.push(await relay.latest('f'));
          backward.push(await relay.latest('b'));
        }
        if (answered) {
          relays.forEach((relay, index) => {
            relay.server.send(['EOSE', backward[index]]);
          });
          await vi.waitFor(() => expect(one.handle().state.status).toBe('settled'), {
            timeout: 3000
          });
        }
        const last = relays.length - 1;
        for (let index = 0; index < last; index += 1) {
          relays[index]?.server.send(['CLOSED', forward[index], notice]);
        }
        await delay(A_TURN_MS);
        const beforeTheLast = readingOf(one.handle());
        relays[last]?.server.send(['CLOSED', forward[last], notice]);
        await vi.waitFor(() => expect(one.handle().diagnostics.legEnded).toBeDefined(), {
          timeout: 3000
        });
        await delay(A_TURN_MS);
        const stopped = readingOf(one.handle());
        const sizes = relays.map((relay) => [relay.asked('b').length, relay.asked('f').length]);
        const running = one.handle().refresh();
        const again = await Promise.all(
          relays.map(async (relay, index) => [
            await relay.latest('b', sizes[index]?.[0]),
            await relay.latest('f', sizes[index]?.[1])
          ])
        );
        relays.forEach((relay, index) => {
          relay.server.send(['EOSE', again[index]?.[0]]);
        });
        const outcome = await Promise.race([running, delay(3000)]);
        return { beforeTheLast, stopped, outcome, reopened: readingOf(one.handle()) };
      } catch (error) {
        return failed(error);
      } finally {
        one.view.unmount();
        vi.unstubAllGlobals();
      }
    };
    const leftAlone = async () => {
      const relay = listening();
      const one = mounted([relay], [request(true)]);
      try {
        const forward = await relay.latest('f');
        relay.server.send(['EOSE', await relay.latest('b')]);
        await vi.waitFor(() => expect(one.handle().state.status).toBe('settled'), {
          timeout: 3000
        });
        relay.server.send(['CLOSED', forward, 'rate-limited: slow down']);
        await vi.waitFor(() => expect(one.handle().diagnostics.legEnded).toBeDefined(), {
          timeout: 3000
        });
        await delay(PAST_THE_RECOVERYS_FIRST_WAIT_MS);
        return {
          asked: { backward: relay.asked('b').length, forward: relay.asked('f').length },
          activity: one.handle().activity
        };
      } catch (error) {
        return failed(error);
      } finally {
        one.view.unmount();
        vi.unstubAllGlobals();
      }
    };
    const runs = {
      'one relay, a rate limit': await run([listening()], 'rate-limited: slow down', true),
      'two relays, a rate limit': await run(
        [listening(), listening()],
        'rate-limited: slow down',
        true
      ),
      'two relays, a block': await run([listening(), listening()], 'blocked: go away', true),
      'two relays, the backlog still waiting': await run(
        [listening(), listening()],
        'rate-limited: slow down',
        false
      ),
      'left alone': await leftAlone()
    };
    const answered = (reason: string, count: number, refusals: number) => ({
      beforeTheLast: {
        status: 'settled',
        events: [],
        activity: 'live',
        refusals: Array.from({ length: refusals }, () => `forward:${reason}`)
      },
      stopped: {
        status: 'settled',
        events: [],
        activity: 'idle',
        legEnded: 'ended',
        refusals: Array.from({ length: count }, () => `forward:${reason}`)
      },
      outcome: { kind: 'complete' },
      reopened: { status: 'settled', events: [], activity: 'live', refusals: [] }
    });
    expect(runs, 'the leg ends with the last relay, and refresh() opens a new one').toEqual({
      'one relay, a rate limit': answered('rate-limited', 1, 0),
      'two relays, a rate limit': answered('rate-limited', 2, 1),
      'two relays, a block': answered('blocked', 2, 1),
      'two relays, the backlog still waiting': {
        beforeTheLast: {
          status: 'streaming',
          events: [],
          activity: 'live',
          refusals: ['forward:rate-limited']
        },
        stopped: {
          status: 'streaming',
          events: [],
          activity: 'live',
          legEnded: 'ended',
          refusals: ['forward:rate-limited', 'forward:rate-limited']
        },
        outcome: { kind: 'complete' },
        reopened: { status: 'settled', events: [], activity: 'live', refusals: [] }
      },
      'left alone': { asked: { backward: 1, forward: 1 }, activity: 'idle' }
    });
  }, 30_000);

  // @contracts A-α-C4
  it('RJ4: a live request refused by one of two relays still receives what the other sends', async () => {
    // **"The leg has not ended" is true of a request nothing reaches**, so the
    // event is read beside it. The relay that was not refused sends on the
    // forward subscription after the other's refusal has been published, and
    // once more after a turn, since a leg kept open and then dropped would
    // deliver one and not the other.
    const a = listening();
    const b = listening();
    const one = mounted([a, b], [request(true)]);
    let reading: unknown;
    try {
      const refused = await a.latest('f');
      const forward = await b.latest('f');
      a.server.send(['EOSE', await a.latest('b')]);
      b.server.send(['EOSE', await b.latest('b')]);
      await vi.waitFor(() => expect(one.handle().state.status).toBe('settled'), { timeout: 3000 });
      a.server.send(['CLOSED', refused, 'blocked: not this one']);
      await vi.waitFor(() => expect(one.handle().diagnostics.refusals).toHaveLength(1), {
        timeout: 3000
      });
      b.server.send(['EVENT', forward, signed('the other relay')]);
      await delay(A_TURN_MS);
      b.server.send(['EVENT', forward, signed('a turn later')]);
      await delay(A_TURN_MS);
      reading = readingOf(one.handle());
    } catch (error) {
      reading = failed(error);
    } finally {
      one.view.unmount();
    }
    expect(reading, 'the events reach the consumer, and the leg has not ended').toEqual({
      status: 'settled',
      events: ['a turn later', 'the other relay'],
      activity: 'live',
      refusals: ['forward:blocked']
    });
  }, 20_000);

  // @contracts A-α-C5
  it('RJ5: a `CLOSED` naming a forward leg a request never opened ends nothing and is not a refusal', async () => {
    // **The relay chooses the subId it closes**, so the frame is built on the
    // wire: the request's own backward subId with `-f:` in it, on a request
    // that opened no forward leg, read off the frames first. Nothing is
    // recorded and no leg ends, and the backlog goes on to answer `complete`.
    // **The control is the same frame on a live request**, which did open that
    // leg, and there it is a refusal that ends it: without it, a guard that
    // dropped every forward `CLOSED` would pass.
    const name = (backward: string) => backward.replace('-b:', '-f:');
    const readings: Record<string, unknown> = {};
    {
      const relay = listening();
      const one = mounted([relay], [request(false)]);
      try {
        const backward = await relay.latest('b');
        await delay(A_TURN_MS);
        const forwardOpened = relay.asked('f').length;
        relay.server.send(['CLOSED', name(backward), 'blocked: never opened']);
        await delay(A_TURN_MS);
        const afterTheFrame = readingOf(one.handle());
        relay.server.send(['EOSE', backward]);
        await vi.waitFor(() => expect(one.handle().state.status).not.toBe('loading'), {
          timeout: 3000
        });
        await delay(A_TURN_MS);
        readings['not live'] = { forwardOpened, afterTheFrame, answer: readingOf(one.handle()) };
      } catch (error) {
        readings['not live'] = failed(error);
      } finally {
        one.view.unmount();
        vi.unstubAllGlobals();
      }
    }
    {
      const relay = listening();
      const one = mounted([relay], [request(true)]);
      try {
        const backward = await relay.latest('b');
        relay.server.send(['EOSE', backward]);
        await vi.waitFor(() => expect(one.handle().state.status).toBe('settled'), {
          timeout: 3000
        });
        relay.server.send(['CLOSED', await relay.latest('f'), 'blocked: opened']);
        await vi.waitFor(() => expect(one.handle().diagnostics.legEnded).toBeDefined(), {
          timeout: 3000
        });
        readings['the control: live'] = readingOf(one.handle());
      } catch (error) {
        readings['the control: live'] = failed(error);
      } finally {
        one.view.unmount();
        vi.unstubAllGlobals();
      }
    }
    expect(readings, 'no leg ended and nothing refused, and a live request is refused').toEqual({
      'not live': {
        forwardOpened: 0,
        afterTheFrame: { status: 'loading', events: [], activity: 'refreshing', refusals: [] },
        answer: { status: 'settled', events: [], activity: 'idle', refusals: [] }
      },
      'the control: live': {
        status: 'settled',
        events: [],
        activity: 'idle',
        legEnded: 'ended',
        refusals: ['forward:blocked']
      }
    });
  }, 20_000);

  // @contracts A5-S4
  it('RJ6: two requests on one relay, one refused: the refusal is that request’s, whichever it is, on either leg', async () => {
    // **One relay**, read off the frames: both are subscribed there before
    // either is answered, so a refusal arriving from it is one either could
    // claim. **Both ways round**, since an attribution that took the first
    // request subscribed, or the last, passes one of them. The other request
    // is answered in the same turn, and is left as if nothing had been refused.
    // **On either leg**, because each is read off the subId by a test of its
    // own: two live requests, their backlogs answered, one refused on its
    // forward subscription, and the other sent an event on its own.
    const run = async (refused: 0 | 1, live: boolean) => {
      const relay = listening();
      const leg = live ? 'f' : 'b';
      const one = mounted([relay], [request(live, [1, 7]), request(live, [1, 9])]);
      try {
        await vi.waitFor(
          () => {
            expect(relay.asked('b')).toHaveLength(2);
            expect(relay.asked(leg)).toHaveLength(2);
          },
          { timeout: 3000 }
        );
        const named = (on: 'b' | 'f', kind: number) =>
          (relay.server.messages as unknown[][]).find(
            (frame) =>
              frame[0] === 'REQ' &&
              String(frame[1]).includes(`-${on}:`) &&
              (frame[2] as { kinds?: number[] }).kinds?.includes(kind)
          )?.[1];
        const subIds = [named(leg, 7), named(leg, 9)];
        if (live) {
          relay.server.send(['EOSE', named('b', 7)]);
          relay.server.send(['EOSE', named('b', 9)]);
          await vi.waitFor(
            () => {
              expect(one.handle(0).state.status).toBe('settled');
              expect(one.handle(1).state.status).toBe('settled');
            },
            { timeout: 3000 }
          );
        }
        relay.server.send(['CLOSED', subIds[refused], 'auth-required: this one']);
        if (live) relay.server.send(['EVENT', subIds[1 - refused], signed('the other request')]);
        else relay.server.send(['EOSE', subIds[1 - refused]]);
        await vi.waitFor(
          () => {
            expect(one.handle(0).state.status).not.toBe('loading');
            expect(one.handle(1).state.status).not.toBe('loading');
          },
          { timeout: 3000 }
        );
        await delay(A_TURN_MS);
        return { requests: [readingOf(one.handle(0)), readingOf(one.handle(1))] };
      } catch (error) {
        return failed(error);
      } finally {
        one.view.unmount();
        vi.unstubAllGlobals();
      }
    };
    const runs = {
      'the first refused': await run(0, false),
      'the second refused': await run(1, false),
      'the first refused, live': await run(0, true),
      'the second refused, live': await run(1, true)
    };
    const refused = {
      status: 'incomplete',
      causes: ['refused'],
      events: [],
      activity: 'idle',
      refusals: ['backward:auth-required']
    };
    const bystander = { status: 'settled', events: [], activity: 'idle', refusals: [] };
    const refusedLive = {
      status: 'settled',
      events: [],
      activity: 'idle',
      legEnded: 'ended',
      refusals: ['forward:auth-required']
    };
    const bystanderLive = {
      status: 'settled',
      events: ['the other request'],
      activity: 'live',
      refusals: []
    };
    expect(runs, 'recorded against that request, and not the other').toEqual({
      'the first refused': { requests: [refused, bystander] },
      'the second refused': { requests: [bystander, refused] },
      'the first refused, live': { requests: [refusedLive, bystanderLive] },
      'the second refused, live': { requests: [bystanderLive, refusedLive] }
    });
  }, 20_000);

  // @contracts A-α-C6
  it('RJ7: `rate-limited` is the one class recorded as clearing on its own, and every class stops', () => {
    // **Internal, and an annotation**: nothing reads this answer, so it says
    // what a retry policy would be written against and promises no recovery.
    // Every class, `unknown` among them, is held both ways against the type, so
    // a class added to it is a type error here (`npm run check`) and not a
    // class with no answer.
    const TEN = [
      'duplicate',
      'pow',
      'blocked',
      'rate-limited',
      'invalid',
      'restricted',
      'mute',
      'error',
      'auth-required',
      'unknown'
    ] as const;
    const _fromTheType: (typeof TEN)[number] = null as unknown as RefusalReason;
    const _toTheType: RefusalReason = null as unknown as (typeof TEN)[number];
    void _fromTheType;
    void _toTheType;
    const stops = { selfClearing: false, action: 'stop' };
    expect(
      Object.fromEntries(TEN.map((reason) => [reason, recoveryFor(reason)])),
      'what each class is recorded as'
    ).toEqual({
      duplicate: stops,
      pow: stops,
      blocked: stops,
      'rate-limited': { selfClearing: true, action: 'stop' },
      invalid: stops,
      restricted: stops,
      mute: stops,
      error: stops,
      'auth-required': stops,
      unknown: stops
    });
  });
});
