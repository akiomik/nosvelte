/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What reaches a consumer around the moment a stream's end is decided: the
 * landings of `A-ε-C1` (`OR1`), `A-ε-C2` (`OR2`) and `A-ε-C5` (`OR3`).
 *
 * **`OR1` and `OR2` go through the published entry and nothing else**, because
 * their rows' route is `public`: `NostrApp` with `relays` only, so the verifier
 * is the one the library supplies, a consumer's own `useReq` under it, and
 * what a relay puts on the wire. `OR1` reads the handle twice — as of the
 * Svelte flush in which it first published an outcome, through an effect
 * (`WatchedRequest`), or on a refresh in the continuation of the promise it
 * returned; and once the test has waited — because "reflected first" is a
 * claim about the first. **`OR3` drives `referenceStream`**, because its row is
 * `internal`: what it arranges is how the verifier answers.
 *
 * `A-ε-C3` is not here. Its Given needs a consumer that has not asked for the
 * next chunk, and the published entry's only consumer folds each chunk and
 * asks for the next in the same turn. No public arrangement measured separates
 * a producer released with the decision from one released when the consumer
 * next asks, which is the row's subject; it is recorded as a phase-1 route
 * error to reopen (#175).
 *
 * Port band 9480-9499.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
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
      const name = sameTurnEose ? 'anEoseAndARefusalInOneTurn' : 'theRefusalIsTheEnd';
      const one = published(nonLive);
      try {
        const backward = await one.subId('b');
        if (sameTurnEose) one.relay.send(['EOSE', backward]);
        one.relay.send(['CLOSED', backward, `blocked: ${name}`]);
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
      anEoseAndARefusalInOneTurn: {
        atTheOutcome: refused('anEoseAndARefusalInOneTurn'),
        afterwards: refused('anEoseAndARefusalInOneTurn')
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
    // **Live, with the backlog settled first, read rather than slept for**,
    // then an EVENT and the forward leg's `CLOSED` in one batch. What is
    // asserted is membership: the row says the consumer receives the event,
    // and says in words that it does not say where the candidate was when the
    // end was decided, nor in what order the chunks arrive.
    //
    // **Twice: a verifier that answers at once, and one that answers only once
    // the forward leg's end has been published** — inside the wait, but after
    // anything the end could have done in the turn that decided it. The Given
    // is any verdict that comes before the wait ends, and the second is the one
    // a discard that waited a task would reach. **And the stream is read to
    // have ended**: a leg's end is published whether or not the end of the
    // stream follows, so the arm records which of the two finished first, the
    // stream or a two-second bound.
    //
    // **Where the candidate is on this tree, as a note beside the witness**:
    // when the forward leg's end sets `ending` the event is not yet in the
    // gate — it is still in the dependency's routing — and it is in the gate
    // when the boundary is drawn a microtask later. So a discard at the moment
    // `ending` is set survives this arm (measured), and nothing in the row asks
    // it not to. A forward leg ended by a dead socket rather than a `CLOSED` is
    // `DC7`'s third run.
    const run = async (reqIdBase: string, answersLate: boolean): Promise<unknown> => {
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
        respondWithEose(server, backward);
        await vi.waitFor(() => expect(shape()).toContain('settled'), { timeout: 3000 });
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
    const atOnce = await run('or3', false);
    const insideTheWait = await run('or3-late', true);
    expect(
      { atOnce, insideTheWait },
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
      }
    });
  });
});
