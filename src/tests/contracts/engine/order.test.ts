/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What reaches a consumer around the moment a stream's end is decided: the
 * landings of `A-ε-C1` (`OR1`), `A-ε-C2` (`OR2`), `A-ε-C5` (`OR3`), `A-ε-C3`
 * (`OR4`) and `A-ε-C19` (`OR5`).
 *
 * **`OR1`, `OR2` and `OR5` go through the published entry and nothing else**,
 * because their rows' route is `public`: `NostrApp` with `relays` only, so the
 * verifier is the one the library supplies, a consumer's own `useReq` under it,
 * and what a relay puts on the wire. `OR1` reads the handle twice — as of the
 * Svelte flush in which it first published an outcome, through an effect
 * (`WatchedRequest`), or on a refresh in the continuation of the promise it
 * returned; and once the test has waited — because "reflected first" is a
 * claim about the first. **`OR3` and `OR4` drive `referenceStream`**, because
 * their rows are `internal`: `OR3` arranges how the verifier answers, and
 * `OR4` is a consumer that stops asking, which the published entry's only
 * consumer never does: it folds each chunk and asks for the next in the same
 * turn (#175).
 *
 * Port band 9480-9499.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import { Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import type { TransportCapability } from '$lib/v1/lease.js';
import { referenceStream } from '$lib/v1/machine.js';
import { createRelayScope } from '$lib/v1/scope.svelte.js';
import type { MachineChunk } from '$lib/v1/stream.js';
import { requestTargets } from '$lib/v1/stream.js';

import PublishedRequest from './fixtures/PublishedRequest.svelte';
import {
  acceptAnyEvent,
  createTestRelay,
  fakeEvent,
  permanentTransport,
  respondWithEose
} from './helpers/relay.js';
import { signed } from './helpers/request.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

let port = 9480;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** What the handle publishes that these rows read, at one instant. */
const snapshotOf = (request: ReqHandle) => ({
  status: request.state.status,
  causes: request.state.status === 'incomplete' ? [...request.state.causes] : undefined,
  refusals: request.diagnostics.refusals.map((refusal) => `${refusal.leg}:${refusal.notice.text}`),
  activity: request.activity,
  legEnded: request.diagnostics.legEnded?.kind
});
type Snapshot = ReturnType<typeof snapshotOf>;

/** The first published snapshot that carries an outcome. */
const firstOutcome = (snapshots: readonly Snapshot[]): Snapshot | undefined =>
  snapshots.find((snapshot) => snapshot.status !== 'loading' && snapshot.status !== 'streaming');

/**
 * A request made through the published entry over one relay: the handle, every
 * snapshot it published, and the subscription ids the relay was asked for.
 */
function published(plan: ReqPlan) {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  const url = nextUrl();
  const relay = new WS(url, { jsonProtocol: true });
  let handle: ReqHandle | undefined;
  const snapshots: Snapshot[] = [];
  const view = render(PublishedRequest, {
    relays: [url],
    plan: () => plan,
    seen: (request: ReqHandle) => {
      handle = request;
    },
    published: (request: ReqHandle) => {
      snapshots.push(snapshotOf(request));
    }
  });
  /** The subscription id of a leg, other than the ones already seen. */
  const subId = async (leg: 'b' | 'f', seen: readonly string[] = []): Promise<string> => {
    let found: string | undefined;
    await vi.waitFor(
      () => {
        found = (relay.messages as unknown[][])
          .filter((frame) => frame[0] === 'REQ')
          .map((frame) => String(frame[1]))
          .find((id) => id.includes(`-${leg}:`) && !seen.includes(id));
        expect(found, `the relay was asked for a new ${leg} leg`).toBeDefined();
      },
      { timeout: 3000 }
    );
    return found as string;
  };
  return { relay, view, request: () => handle as ReqHandle, snapshots, subId };
}

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

describe('what reaches a consumer around the end of a stream', () => {
  // @contracts A-ε-C1
  it('OR1: a backlog ended by a refusal reports the refusal, as of the moment it reports the end', async () => {
    // **Three runs, each read at the moment the outcome is first published.**
    // A refusal is one message that is both the backlog's end and its
    // explanation; the end must not be observable before the explanation is.
    // So each run takes the first snapshot that carries an outcome — and, on a
    // refresh, the snapshot taken in the continuation of the promise it
    // returned, attached before the refusal is sent — as well as the one the
    // test reads once it has waited. An outcome reported `complete` because
    // the marker overtook its refusal, and a `refused` one whose refusal was
    // not yet in the diagnostics, both fail the first. **Exactly `['refused']`**:
    // a `timeout` beside it is a cause this attempt does not have, which is
    // what an outcome derived before its refusal reached the table reports.
    const nonLive: ReqPlan = {
      kind: 'request',
      descriptor: { filters: [{ kinds: [1] }], settleTimeoutMs: 2000 }
    };
    const live: ReqPlan = {
      kind: 'request',
      descriptor: {
        filters: [{ kinds: [1] }],
        live: true,
        retain: 'unbounded',
        settleTimeoutMs: 2000
      }
    };
    const read = ({ status, causes, refusals }: Snapshot) => ({ status, causes, refusals });
    const runs: Record<string, unknown> = {};

    // The refusal is the end: the relay closes the backlog's subscription.
    for (const sameTurnEose of [false, true]) {
      const name = sameTurnEose ? 'aRefusalAndAnEoseInOneTurn' : 'theRefusalIsTheEnd';
      const one = published(nonLive);
      try {
        const backward = await one.subId('b');
        one.relay.send(['CLOSED', backward, `blocked: ${name}`]);
        if (sameTurnEose) one.relay.send(['EOSE', backward]);
        await vi.waitFor(() => expect(firstOutcome(one.snapshots)).toBeDefined(), {
          timeout: 3000
        });
        await delay(100);
        const atTheOutcome = firstOutcome(one.snapshots);
        runs[name] = {
          atTheOutcome: atTheOutcome === undefined ? undefined : read(atTheOutcome),
          afterwards: read(snapshotOf(one.request()))
        };
      } catch (error) {
        runs[name] = failed(error);
      } finally {
        one.view.unmount();
      }
    }

    // On a refresh: the first attempt has answered `complete`, and the
    // refresh's own backlog is refused.
    {
      const one = published(live);
      try {
        const first = await one.subId('b');
        respondWithEose(one.relay, first);
        await vi.waitFor(() => expect(one.request().state.status).toBe('settled'), {
          timeout: 3000
        });
        const running = one.request().refresh();
        let atTheOutcome: unknown;
        void running.then((outcome) => {
          atTheOutcome = { outcome, ...read(snapshotOf(one.request())) };
        });
        const again = await one.subId('b', [first]);
        one.relay.send(['CLOSED', again, 'blocked: onARefresh']);
        await Promise.race([running, delay(3000)]);
        await delay(100);
        runs['onARefresh'] = { atTheOutcome, afterwards: read(snapshotOf(one.request())) };
      } catch (error) {
        runs['onARefresh'] = failed(error);
      } finally {
        one.view.unmount();
      }
    }

    const refused = (name: string) => ({
      status: 'incomplete',
      causes: ['refused'],
      refusals: [`backward:blocked: ${name}`]
    });
    expect(
      runs,
      'refused, with the refusal that explains it, at the moment the end is first reported'
    ).toEqual({
      theRefusalIsTheEnd: {
        atTheOutcome: refused('theRefusalIsTheEnd'),
        afterwards: refused('theRefusalIsTheEnd')
      },
      aRefusalAndAnEoseInOneTurn: {
        atTheOutcome: refused('aRefusalAndAnEoseInOneTurn'),
        afterwards: refused('aRefusalAndAnEoseInOneTurn')
      },
      onARefresh: {
        atTheOutcome: {
          outcome: { kind: 'incomplete', causes: ['refused'] },
          ...refused('onARefresh')
        },
        afterwards: refused('onARefresh')
      }
    });
  }, 20_000);

  // @contracts A-ε-C2
  it('OR2: a live request whose forward leg ends while its backlog waits still has an outcome, and it says the request stopped waiting', async () => {
    // **Twice: the request's first attempt, and an attempt a `refresh()`
    // started**, whose own forward subscription is the one refused — a
    // refusal of the first attempt's, followed by a refresh, would be
    // measuring another attempt. In both the relay never answers the backlog,
    // and the answer is `timeout` alone — not `complete`, not `ended`, and not
    // the forward leg's refusal. Which of the two sources of that word ended
    // the wait, the request's timer or the relay left undetermined, is not
    // separated here: both say it (`A5-C16` is where the timer's is measured).
    const live: ReqPlan = {
      kind: 'request',
      descriptor: {
        filters: [{ kinds: [1] }],
        live: true,
        retain: 'unbounded',
        settleTimeoutMs: 300
      }
    };
    const stoppedWaiting = (refusal: string) => ({
      status: 'incomplete',
      causes: ['timeout'],
      refusals: [`forward:blocked: ${refusal}`],
      activity: 'idle',
      legEnded: 'ended'
    });
    const runs: Record<string, unknown> = {};

    {
      const one = published(live);
      try {
        const forward = await one.subId('f');
        // The backlog is still waiting when the forward leg ends.
        const waitingAtTheRefusal = ['loading', 'streaming'].includes(one.request().state.status);
        one.relay.send(['CLOSED', forward, 'blocked: theFirstAttempt']);
        await vi.waitFor(() => expect(one.request().activity).toBe('idle'), { timeout: 3000 });
        const outcome = firstOutcome(one.snapshots);
        runs['theFirstAttempt'] = {
          waitingAtTheRefusal,
          anOutcome: outcome?.status,
          afterwards: snapshotOf(one.request())
        };
      } catch (error) {
        runs['theFirstAttempt'] = failed(error);
      } finally {
        one.view.unmount();
      }
    }

    {
      const one = published(live);
      try {
        const backward = await one.subId('b');
        const forward = await one.subId('f');
        // While the first attempt is still waiting on its backlog, read rather
        // than assumed.
        const waitingAtTheRefresh = one.request().state.status === 'loading';
        const running = one.request().refresh();
        const againForward = await one.subId('f', [forward]);
        await one.subId('b', [backward]);
        const waitingAtTheRefusal = ['loading', 'streaming'].includes(one.request().state.status);
        one.relay.send(['CLOSED', againForward, 'blocked: aRefreshedAttempt']);
        const outcome = await Promise.race([
          running,
          delay(3000).then(() => 'no outcome' as const)
        ]);
        await vi.waitFor(() => expect(one.request().activity).toBe('idle'), { timeout: 3000 });
        runs['aRefreshedAttempt'] = {
          waitingAtTheRefresh,
          waitingAtTheRefusal,
          outcome,
          afterwards: snapshotOf(one.request())
        };
      } catch (error) {
        runs['aRefreshedAttempt'] = failed(error);
      } finally {
        one.view.unmount();
      }
    }

    expect(runs, 'an outcome, and it says the request stopped waiting').toEqual({
      theFirstAttempt: {
        waitingAtTheRefusal: true,
        anOutcome: 'incomplete',
        afterwards: stoppedWaiting('theFirstAttempt')
      },
      aRefreshedAttempt: {
        waitingAtTheRefresh: true,
        waitingAtTheRefusal: true,
        outcome: { kind: 'incomplete', causes: ['timeout'] },
        afterwards: stoppedWaiting('aRefreshedAttempt')
      }
    });
  }, 20_000);

  // @contracts A-ε-C5
  it('OR3: an event the relay sent before the end was decided is delivered, when its verdict comes inside the wait', async () => {
    // **Live, with an EVENT and the forward leg's `CLOSED` in one batch.** What is
    // asserted is membership: the row says the consumer receives the event,
    // and says in words that it does not say where the candidate was when the
    // end was decided, nor in what order the chunks arrive.
    //
    // **Three runs.** The backlog settled first — read rather than slept for —
    // and a verifier that answers at once; the same with a verifier that
    // answers only once the forward leg's end has been published, inside the
    // wait but after anything the end could have done in the turn that decided
    // it, which is what a discard that waited a task would reach; and the
    // backlog still waiting when the batch arrives, so that the end is decided
    // only when its EOSE comes, with the candidate already held. The Given is
    // any verdict before the wait ends, whichever way the end comes to be
    // decided. **And the stream is read to
    // have ended**: a leg's end is published whether or not the end of the
    // stream follows, so the arm records which of the two finished first, the
    // stream or a two-second bound.
    //
    // **Where the candidate is on this tree, as a note beside the witness**:
    // in the first two runs, when the forward leg's end sets `ending` the event
    // is not yet in the gate — it is still in the dependency's routing — and it
    // is in the gate when the boundary is drawn a microtask later. In the third
    // the end is decided after the event has been admitted. So a discard at the
    // moment `ending` is set survives the first two (measured) and fails the
    // third. A forward leg ended by a dead socket rather than a `CLOSED` is
    // `DC7`'s third run.
    const run = async (
      reqIdBase: string,
      verdict: 'atOnce' | 'late',
      backlog: 'settledFirst' | 'stillWaiting'
    ): Promise<unknown> => {
      const answersLate = verdict === 'late';
      const url = nextUrl();
      const { rxNostr, server } = createTestRelay(url);
      const transport = permanentTransport(rxNostr);
      const scope = createRelayScope(rxNostr, [url]);
      const ac = new AbortController();
      const chunks: MachineChunk[] = [];
      let handed = 0;
      let answer: (ok: boolean) => void = () => {};
      const verifyEvent = answersLate
        ? () => {
            handed += 1;
            return new Promise<boolean>((resolve) => {
              answer = resolve;
            });
          }
        : acceptAnyEvent;
      const done = (async () => {
        for await (const chunk of referenceStream({
          transport,
          targets: requestTargets(transport, scope.current),
          filters: [{ kinds: [1] }],
          live: true,
          reqIdBase,
          signal: ac.signal,
          timeoutMs: 2000,
          verifyEvent
        })) {
          chunks.push(chunk);
        }
      })();
      const shape = () =>
        chunks.map((chunk) =>
          chunk.type === 'event' ? `event:${chunk.packet.event.content}` : chunk.type
        );
      try {
        let ids: string[] = [];
        await vi.waitFor(
          () => {
            ids = (server.messages as unknown[][])
              .filter((frame) => frame[0] === 'REQ')
              .map((frame) => String(frame[1]));
            expect(ids, 'the relay was asked for both legs').toHaveLength(2);
          },
          { timeout: 3000 }
        );
        const backward = ids.find((id) => id.includes('-b:')) as string;
        const forward = ids.find((id) => id.includes('-f:')) as string;
        if (backlog === 'settledFirst') {
          respondWithEose(server, backward);
          await vi.waitFor(() => expect(shape()).toContain('settled'), { timeout: 3000 });
        }
        const beforeTheBatch = shape();
        server.send(['EVENT', forward, fakeEvent({ content: 'in the batch' })]);
        server.send(['CLOSED', forward, 'blocked: done']);
        let heldInTheWait: boolean | undefined;
        if (answersLate) {
          // The verifier has the event and the leg's end is out; then, and
          // only then, the verdict.
          await vi.waitFor(() => expect(handed > 0 && shape().includes('legEnded')).toBe(true), {
            timeout: 2000
          });
          if (backlog === 'stillWaiting') {
            // Now the backlog answers, and that decides the end.
            respondWithEose(server, backward);
            await vi.waitFor(() => expect(shape()).toContain('settled'), { timeout: 3000 });
          }
          heldInTheWait = !shape().includes('event:in the batch');
          await delay(20);
          answer(true);
        }
        const theStreamEnded = await Promise.race([
          done.then(() => true),
          delay(2000).then(() => false)
        ]);
        return {
          beforeTheBatch,
          heldInTheWait,
          theStreamEnded,
          theForwardLegEnded: shape().includes('legEnded'),
          delivered: shape().includes('event:in the batch')
        };
      } catch (error) {
        return failed(error);
      } finally {
        ac.abort();
        await Promise.race([done, delay(500)]);
        rxNostr.dispose();
      }
    };
    const atOnce = await run('or3', 'atOnce', 'settledFirst');
    const insideTheWait = await run('or3-late', 'late', 'settledFirst');
    const decidedByTheBacklog = await run('or3-pending', 'late', 'stillWaiting');
    expect(
      { atOnce, insideTheWait, decidedByTheBacklog },
      'the event the relay sent before the end is delivered, whenever inside the wait its verdict comes'
    ).toEqual({
      atOnce: {
        beforeTheBatch: ['settled'],
        heldInTheWait: undefined,
        theStreamEnded: true,
        theForwardLegEnded: true,
        delivered: true
      },
      insideTheWait: {
        beforeTheBatch: ['settled'],
        heldInTheWait: true,
        theStreamEnded: true,
        theForwardLegEnded: true,
        delivered: true
      },
      decidedByTheBacklog: {
        beforeTheBatch: [],
        heldInTheWait: true,
        theStreamEnded: true,
        theForwardLegEnded: true,
        delivered: true
      }
    });
  });

  // @contracts A-ε-C3
  it('OR4: a consumer that has not asked since the end was decided finds the producer gone, and no refusal after it', async () => {
    // **A consumer that stops asking**, which the published entry does not
    // have: it pulls until the outcome, then pauses with the end still in the
    // queue. **Two reads, each independent of the other.** While it is paused,
    // the subscriptions the machine took from the transport: none is held, read
    // off a capability that counts each one taken and torn down, with the count
    // before the end as the control. That is the release: the frames on the
    // wire cannot show it, since `settle` closes the backlog's subscription
    // whether or not the producer goes, and a relay's own `CLOSED` needs no
    // frame back. A guard on the refusal alone would pass the second read with
    // the producer leaked. The second is what a refusal sent into the pause
    // delivers once the consumer asks again: nothing of it, beside a listener
    // of the arm's own on the client's message channel, which saw the frame
    // arrive. **Three ways to the decision**: a timer, and the last `EOSE`, on
    // a request that is not live, and a forward `CLOSED` on a live one.
    const run = async (reqIdBase: string, decision: 'timer' | 'eose' | 'forward') => {
      const live = decision === 'forward';
      const url = nextUrl();
      const { rxNostr, server } = createTestRelay(url);
      const base = permanentTransport(rxNostr);
      let held = 0;
      const counted = <Value>(stream: Observable<Value>): Observable<Value> =>
        new Observable<Value>((subscriber) => {
          held += 1;
          const inner = stream.subscribe(subscriber);
          return () => {
            held -= 1;
            inner.unsubscribe();
          };
        });
      const transport: TransportCapability = {
        get revoked() {
          return base.revoked;
        },
        relayStatus: () => base.relayStatus(),
        defaultRelays: () => base.defaultRelays(),
        reconnect: (relay) => {
          base.reconnect(relay);
        },
        use: (...args) => {
          const stream = base.use(...args);
          return stream === undefined ? undefined : counted(stream);
        },
        send: (...args) => base.send(...args),
        onRevoke: (listener) => base.onRevoke(listener),
        outgoingRequests: () => {
          const stream = base.outgoingRequests();
          return stream === undefined ? undefined : counted(stream);
        },
        connectionState: () => {
          const stream = base.connectionState();
          return stream === undefined ? undefined : counted(stream);
        },
        controlMessages: () => {
          const stream = base.controlMessages();
          return stream === undefined ? undefined : counted(stream);
        }
      };
      const scope = createRelayScope(rxNostr, [url]);
      const ac = new AbortController();
      const closedFrames: string[] = [];
      const listener = rxNostr.createAllMessageObservable().subscribe((packet) => {
        if (packet.type === 'CLOSED') closedFrames.push(packet.subId);
      });
      const stream = referenceStream({
        transport,
        targets: requestTargets(transport, scope.current),
        filters: [{ kinds: [1] }],
        live,
        reqIdBase,
        signal: ac.signal,
        timeoutMs: decision === 'timer' ? 300 : 2000,
        verifyEvent: acceptAnyEvent
      });
      const named = (leg: string) =>
        (server.messages as unknown[][]).find(
          (frame) => frame[0] === 'REQ' && String(frame[1]).includes(leg)
        )?.[1] as string | undefined;
      try {
        const outcome = stream.next();
        await vi.waitFor(() => expect(named('-b:')).toBeDefined(), { timeout: 3000 });
        if (live) await vi.waitFor(() => expect(named('-f:')).toBeDefined(), { timeout: 3000 });
        const backward = named('-b:') as string;
        const beforeTheEnd = held > 0;
        if (decision !== 'timer') respondWithEose(server, backward);
        const handed = ((await outcome).value as MachineChunk).type;
        if (live) {
          server.send(['CLOSED', named('-f:'), 'blocked: the end']);
          await vi.waitFor(() => expect(closedFrames).toHaveLength(1), { timeout: 3000 });
        }
        // The consumer has asked for nothing since the decision, and the
        // release is a turn after it.
        await delay(20);
        const whilePaused = held;
        const seen = closedFrames.length;
        server.send(['CLOSED', backward, 'blocked: into the pause']);
        await vi.waitFor(() => expect(closedFrames).toHaveLength(seen + 1), { timeout: 3000 });
        const rest: string[] = [];
        for await (const chunk of { [Symbol.asyncIterator]: () => stream }) {
          rest.push(chunk.type === 'refused' ? `refused:${chunk.refusal.leg}` : chunk.type);
        }
        return { beforeTheEnd, handed, whilePaused, rest };
      } catch (error) {
        return failed(error);
      } finally {
        listener.unsubscribe();
        ac.abort();
        rxNostr.dispose();
      }
    };
    const paused = { beforeTheEnd: true, handed: 'settled', whilePaused: 0 };
    expect(
      {
        timer: await run('or4-timer', 'timer'),
        eose: await run('or4-eose', 'eose'),
        forward: await run('or4-forward', 'forward')
      },
      'nothing held once the end is decided, and nothing delivered after it'
    ).toEqual({
      timer: { ...paused, rest: [] },
      eose: { ...paused, rest: [] },
      forward: { ...paused, rest: ['refused:forward', 'legEnded'] }
    });
  });

  // @contracts A-ε-C19
  it('OR5: a refusal after the forward `CLOSED` is not published, one before it is, and an event before it is delivered', async () => {
    // **Five orders, one batch each, on a live request whose backlog has
    // settled.** The forward `CLOSED` ends the stream. A backward `CLOSED`
    // after it is not published, and the reverse order, which publishes it as a
    // late refusal of a running request (0003), is what separates "dropped
    // because it came after the decision" from "late refusals are never
    // published". The three with an `EVENT` read that the boundary is a
    // refusal's and not an event's: an event that arrived before the forward
    // `CLOSED` is delivered in each, the one a refusal follows included, and a
    // guard on admission fails them. Each reads once the request has stopped.
    const live: ReqPlan = {
      kind: 'request',
      descriptor: {
        filters: [{ kinds: [1] }],
        live: true,
        retain: 'unbounded',
        settleTimeoutMs: 2000
      }
    };
    type Frame = 'event' | 'forward' | 'backward';
    const run = async (order: readonly Frame[]) => {
      const one = published(live);
      try {
        const backward = await one.subId('b');
        const forward = await one.subId('f');
        respondWithEose(one.relay, backward);
        await vi.waitFor(() => expect(one.request().state.status).toBe('settled'), {
          timeout: 3000
        });
        const event = signed('in the batch');
        for (const frame of order) {
          if (frame === 'event') one.relay.send(['EVENT', forward, event]);
          else if (frame === 'forward') one.relay.send(['CLOSED', forward, 'blocked: forward']);
          else one.relay.send(['CLOSED', backward, 'restricted: backward']);
        }
        await vi.waitFor(() => expect(one.request().activity).toBe('idle'), { timeout: 3000 });
        await delay(100);
        const { state } = one.request();
        return {
          ...snapshotOf(one.request()),
          delivered: state.status === 'loading' ? [] : state.events.map((each) => each.content)
        };
      } catch (error) {
        return failed(error);
      } finally {
        one.view.unmount();
      }
    };
    const runs = {
      'forward, backward': await run(['forward', 'backward']),
      'backward, forward': await run(['backward', 'forward']),
      'event, forward': await run(['event', 'forward']),
      'event, backward, forward': await run(['event', 'backward', 'forward']),
      'event, forward, backward': await run(['event', 'forward', 'backward'])
    };
    const ended = (refusals: string[], delivered: string[]) => ({
      status: 'settled',
      causes: undefined,
      refusals,
      activity: 'idle',
      legEnded: 'ended',
      delivered
    });
    const forward = 'forward:blocked: forward';
    const backward = 'backward:restricted: backward';
    expect(runs, 'the end decides a refusal, and no event').toEqual({
      'forward, backward': ended([forward], []),
      'backward, forward': ended([backward, forward], []),
      'event, forward': ended([forward], ['in the batch']),
      'event, backward, forward': ended([backward, forward], ['in the batch']),
      'event, forward, backward': ended([forward], ['in the batch'])
    });
  });
});
