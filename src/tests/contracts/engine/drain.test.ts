/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * How the machine waits for what the gate still holds, and how it stops
 * waiting: the landings of `A-ε-C6` (`DC1`), `A-ε-C7` (`DC2`), `A-ε-C8` (`DC3`)
 * and `A-ε-C9` (`DC4`).
 *
 * **The rows are `internal`, because what they arrange is how the verifier
 * answers** — slowly, one at a time, held until the test releases it, or never
 * — and a consumer gets the provider's verifier, which answers in none of those
 * ways on purpose (0005, "Port route"). So these drive `referenceStream`
 * directly, over a real client and a mock socket, with the verifier injected
 * at the machine's required parameter and the relays named through a scope as
 * a provider's requests name them.
 *
 * **Each arm asserts its own arrangement as well as its answer**: that the
 * verifier was serial, that the forward gate was occupied at the EOSE, that a
 * forward candidate was never released, that the request was still running
 * when the held one was. An arm whose arrangement quietly changed would
 * otherwise stay green on an answer it no longer measures.
 *
 * Port band 9440-9479.
 */
import type Nostr from 'nostr-typedef';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { referenceStream } from '$lib/v1/machine.js';
import { createRelayScope } from '$lib/v1/scope.svelte.js';
import type { MachineChunk } from '$lib/v1/stream.js';
import { requestTargets } from '$lib/v1/stream.js';

import {
  createTestRelay,
  fakeEvent,
  permanentTransport,
  respondWithEose,
  respondWithEvent
} from './helpers/relay.js';

afterEach(() => {
  vi.useRealTimers();
  WS.clean();
});

let port = 9440;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

type Verifier = (event: Nostr.Event) => Promise<boolean>;

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * One request through the machine over one relay: its chunks with the time
 * each reached the consumer, whether the generator has returned, and the
 * subscription id of each leg as the relay saw it.
 */
function request(
  verifyEvent: Verifier,
  { live, reqIdBase, timeoutMs = 20_000 }: { live: boolean; reqIdBase: string; timeoutMs?: number }
) {
  const url = nextUrl();
  const { rxNostr, server } = createTestRelay(url);
  const transport = permanentTransport(rxNostr);
  const scope = createRelayScope(rxNostr, [url]);
  const ac = new AbortController();
  const chunks: MachineChunk[] = [];
  const at: number[] = [];
  let returned = false;
  const done = (async () => {
    for await (const chunk of referenceStream({
      transport,
      targets: requestTargets(transport, scope.current),
      filters: [{ kinds: [1] }],
      live,
      reqIdBase,
      signal: ac.signal,
      timeoutMs,
      verifyEvent
    })) {
      chunks.push(chunk);
      at.push(Date.now());
    }
    returned = true;
  })();
  const subId = async (leg: 'b' | 'f'): Promise<string> => {
    let found: string | undefined;
    await vi.waitFor(
      () => {
        found = (server.messages as unknown[][])
          .filter((frame) => frame[0] === 'REQ')
          .map((frame) => String(frame[1]))
          .find((id) => id.startsWith(`${reqIdBase}-${leg}:`));
        expect(found, `the relay was asked for the ${leg} leg`).toBeDefined();
      },
      { timeout: 2000 }
    );
    return found as string;
  };
  /** Waits for the generator to end on its own, for at most `ms`, then ends it. */
  const stop = async (ms = 0): Promise<void> => {
    await Promise.race([done, delay(ms)]);
    ac.abort();
    await Promise.race([done, delay(500)]);
    rxNostr.dispose();
  };
  return { server, chunks, at, done, subId, stop, returned: (): boolean => returned };
}

/** Chunk kinds, each event named by its content, because the order is the claim. */
const shape = (chunks: readonly MachineChunk[]): string[] =>
  chunks.map((chunk) =>
    chunk.type === 'event' ? `event:${chunk.packet.event.content}` : chunk.type
  );

const endsOf = (chunks: readonly MachineChunk[]) =>
  chunks.flatMap((chunk) => (chunk.type === 'settled' ? [chunk.end] : []));

/**
 * A verifier that holds each event until the test answers it by content — with
 * `true`, `false` or a rejection — and says which it was handed and which it
 * answered.
 */
function held() {
  const answers = new Map<
    string,
    { resolve: (ok: boolean) => void; reject: (e: unknown) => void }
  >();
  const answered = new Set<string>();
  const verify: Verifier = (event) =>
    new Promise<boolean>((resolve, reject) => answers.set(event.content, { resolve, reject }));
  const admitted = (content: string): boolean => answers.has(content);
  const release = async (content: string, how: 'true' | 'false' | 'reject' = 'true') => {
    await vi.waitFor(() => expect(answers.has(content), `${content} was handed over`).toBe(true), {
      timeout: 2000
    });
    const answer = answers.get(content) as {
      resolve: (ok: boolean) => void;
      reject: (e: unknown) => void;
    };
    answered.add(content);
    if (how === 'reject') answer.reject(new Error(`rejected: ${content}`));
    else answer.resolve(how === 'true');
    await delay(40);
  };
  return { verify, admitted, release, answered: (content: string) => answered.has(content) };
}

describe('the wait over what the gate holds, and its end', () => {
  // @contracts A-ε-C6
  it('DC1: a backlog verified one at a time is delivered whole ahead of its outcome', async () => {
    // **Serial, which is what verification is**, and the arm records it: a
    // verifier that answered all five at once would leave the chunk list the
    // same and measure nothing, so the order each began and finished in is
    // read as well as what was delivered.
    const served: string[] = [];
    let chain = Promise.resolve();
    const serial: Verifier = (event) => {
      chain = chain.then(async () => {
        served.push(`began:${event.content}`);
        await delay(300);
        served.push(`ended:${event.content}`);
      });
      return chain.then(() => true);
    };
    const one = request(serial, { live: false, reqIdBase: 'dc1', timeoutMs: 8000 });
    const backward = await one.subId('b');
    for (let index = 0; index < 5; index += 1)
      respondWithEvent(one.server, backward, fakeEvent({ content: `bulk-${String(index)}` }));
    respondWithEose(one.server, backward);
    await one.stop(4000);

    const bulk = [0, 1, 2, 3, 4].map((index) => `bulk-${String(index)}`);
    expect(
      [shape(one.chunks), endsOf(one.chunks), served],
      'all five ahead of the one outcome, complete, each verified after the one before it finished'
    ).toEqual([
      [...bulk.map((content) => `event:${content}`), 'settled'],
      [{ kind: 'complete' }],
      bulk.flatMap((content) => [`began:${content}`, `ended:${content}`])
    ]);
  }, 15_000);

  // @contracts A-ε-C7
  it('DC2: a live backlog settles at once while its forward leg is still being verified', async () => {
    // **On a clock the arm drives**, so "within 300ms of the EOSE" is a fact
    // about the machine's scheduling rather than about how busy the host is.
    // The socket is open and both REQs are out before the clock is replaced;
    // from then on every timer — the feed, the verifier's 60ms, the machine's
    // own deadlines — and `Date` move only when the arm moves them.
    let pending = 0;
    const slow: Verifier = async () => {
      pending += 1;
      await delay(60);
      pending -= 1;
      return true;
    };
    const one = request(slow, { live: true, reqIdBase: 'dc2' });
    const backward = await one.subId('b');
    const forward = await one.subId('f');
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
    });
    let sent = 0;
    let eoseAt: number | undefined;
    let pendingAtEose: number | undefined;
    const feed = setInterval(() => {
      sent += 1;
      respondWithEvent(one.server, forward, fakeEvent({ content: `live-${String(sent)}` }));
    }, 15);
    try {
      // The forward leg is already delivering when the backlog finishes: a
      // gate that is empty at the boundary drains at once whatever it is
      // shared with, so this is the condition the claim turns on.
      for (
        let step = 0;
        step < 200 && one.chunks.filter((c) => c.type === 'event').length < 2;
        step += 1
      )
        await vi.advanceTimersByTimeAsync(5);
      eoseAt = Date.now();
      pendingAtEose = pending;
      respondWithEose(one.server, backward);
      // The feed runs on for the whole window, outcome or not.
      for (let step = 0; step < 120; step += 1) await vi.advanceTimersByTimeAsync(5);
    } finally {
      clearInterval(feed);
      vi.useRealTimers();
    }
    await one.stop();

    const settledIndex = one.chunks.findIndex((chunk) => chunk.type === 'settled');
    const settledAt = settledIndex < 0 ? Number.NaN : (one.at[settledIndex] as number);
    expect(
      {
        pendingAtEose: pendingAtEose !== undefined && pendingAtEose > 0,
        sentAcrossTheWindow: sent > 25,
        settledWithin300ms: eoseAt !== undefined && settledAt - eoseAt < 300,
        deliveredAfterTheOutcome:
          settledIndex >= 0 &&
          one.chunks.slice(settledIndex).filter((chunk) => chunk.type === 'event').length > 3,
        ends: endsOf(one.chunks)
      },
      'the forward gate was occupied at the EOSE; the outcome came within 300ms of it, complete, with live traffic either side'
    ).toEqual({
      pendingAtEose: true,
      sentAcrossTheWindow: true,
      settledWithin300ms: true,
      deliveredAfterTheOutcome: true,
      ends: [{ kind: 'complete' }]
    });
  }, 15_000);

  // @contracts A-ε-C8
  it('DC3: what the backlog answers does not depend on the forward leg’s order or its history', async () => {
    // **Five runs, every one collected before any is read**, so a mutation is
    // measured against all of them — a run whose setup failed is recorded
    // rather than ending the arm.
    const failedRun = (error: unknown): { failed: string } => ({
      failed: error instanceof Error ? error.message : String(error)
    });
    const orderRun = async (
      reqIdBase: string,
      plan: (gate: ReturnType<typeof held>) => Promise<void>
    ): Promise<unknown> => {
      try {
        const gate = held();
        const one = request(gate.verify, { live: true, reqIdBase });
        const backward = await one.subId('b');
        const forward = await one.subId('f');
        respondWithEvent(one.server, backward, fakeEvent({ content: 'b1' }));
        respondWithEvent(one.server, forward, fakeEvent({ content: 'f1' }));
        respondWithEose(one.server, backward);
        await vi.waitFor(() => expect(gate.admitted('b1') && gate.admitted('f1')).toBe(true), {
          timeout: 2000
        });
        await plan(gate);
        const seen = shape(one.chunks);
        const forwardAnswered = gate.answered('f1');
        await one.stop(100);
        return {
          end: endsOf(one.chunks)[0],
          backlogEventPrecedesOutcome:
            seen.includes('event:b1') && seen.indexOf('event:b1') < seen.indexOf('settled'),
          forwardAnswered
        };
      } catch (error) {
        return failedRun(error);
      }
    };
    const forwardFirst = await orderRun('dc3a', async (gate) => {
      await gate.release('f1');
      await gate.release('b1');
    });
    const backwardFirst = await orderRun('dc3b', async (gate) => {
      await gate.release('b1');
      await gate.release('f1');
    });
    // **The order that is not one**: the forward verification never finishes,
    // which is the ordinary case for a live request rather than a corner.
    const forwardUnfinished = await orderRun('dc3c', async (gate) => {
      await gate.release('b1');
      await delay(300);
    });

    // **The other input**: the same backward event and EOSE, differing only in
    // whether one forward event was verified first, at 500ms against the
    // backward candidate's 1300ms — read at the outcome.
    const historyRun = async (reqIdBase: string, forwardFirst: boolean): Promise<unknown> => {
      try {
        const costed: Verifier = async (event) => {
          await delay(event.content.startsWith('fwd') ? 500 : 1300);
          return true;
        };
        const one = request(costed, { live: true, reqIdBase });
        const backward = await one.subId('b');
        const forward = await one.subId('f');
        if (forwardFirst) {
          respondWithEvent(one.server, forward, fakeEvent({ content: 'fwd-1' }));
          await vi.waitFor(() => expect(shape(one.chunks)).toContain('event:fwd-1'), {
            timeout: 4000
          });
        }
        respondWithEvent(one.server, backward, fakeEvent({ content: 'bwd-1' }));
        respondWithEose(one.server, backward);
        await vi.waitFor(() => expect(shape(one.chunks)).toContain('settled'), { timeout: 6000 });
        const atTheOutcome = shape(one.chunks);
        await one.stop(50);
        return {
          end: endsOf(one.chunks)[0],
          backlogEventDelivered: atTheOutcome.includes('event:bwd-1')
        };
      } catch (error) {
        return failedRun(error);
      }
    };
    const noHistory = await historyRun('dc3d', false);
    const aForwardVerificationFirst = await historyRun('dc3e', true);

    // Compared with each other as whole answers, and then with what they
    // answer: the first separates a shared gate even where it would return
    // nothing yet rather than something else. Whether the forward candidate
    // was answered is each run's arrangement, read beside its answer.
    const answerOf = (run: unknown): string => {
      const { end, backlogEventPrecedesOutcome } = run as Record<string, unknown>;
      return JSON.stringify({ end, backlogEventPrecedesOutcome });
    };
    expect(
      {
        sameInEveryOrder: [backwardFirst, forwardUnfinished].map(
          (run) => answerOf(run) === answerOf(forwardFirst)
        ),
        forwardFirst,
        forwardUnfinished,
        sameWhateverTheHistory:
          JSON.stringify(aForwardVerificationFirst) === JSON.stringify(noHistory),
        noHistory
      },
      'the same answer in every release order and whatever the forward leg cost before it'
    ).toEqual({
      sameInEveryOrder: [true, true],
      forwardFirst: {
        end: { kind: 'complete' },
        backlogEventPrecedesOutcome: true,
        forwardAnswered: true
      },
      forwardUnfinished: {
        end: { kind: 'complete' },
        backlogEventPrecedesOutcome: true,
        forwardAnswered: false
      },
      sameWhateverTheHistory: true,
      noHistory: {
        end: { kind: 'incomplete', causes: ['verification-timeout'], error: undefined },
        backlogEventDelivered: false
      }
    });
  }, 30_000);

  // @contracts A-ε-C9
  it('DC4: a candidate the cut gave up on is not delivered, whatever its verification answers', async () => {
    // **Live, or the arm asserts nothing**: a non-live request has returned by
    // the time the verifier is released, and a late chunk goes where nobody
    // reads. So each run also says the request was still running when its
    // held candidate was answered.
    const runs: unknown[] = [];
    for (const how of ['true', 'false', 'reject'] as const) {
      try {
        const gate = held();
        const one = request(gate.verify, { live: true, reqIdBase: `dc4-${how}` });
        const backward = await one.subId('b');
        await one.subId('f');
        respondWithEvent(one.server, backward, fakeEvent({ content: `held-${how}` }));
        respondWithEose(one.server, backward);
        await vi.waitFor(() => expect(shape(one.chunks)).toContain('settled'), { timeout: 4000 });
        const atTheCut = shape(one.chunks);
        const runningAtRelease = !one.returned();
        await gate.release(`held-${how}`, how);
        await delay(150);
        runs.push({
          how,
          runningAtRelease,
          atTheCut,
          afterTheRelease: shape(one.chunks),
          ends: endsOf(one.chunks)
        });
        await one.stop();
      } catch (error) {
        runs.push({ how, failed: error instanceof Error ? error.message : String(error) });
      }
    }
    expect(runs, 'the outcome alone, before and after, under its own cause').toEqual(
      (['true', 'false', 'reject'] as const).map((how) => ({
        how,
        runningAtRelease: true,
        atTheCut: ['settled'],
        afterTheRelease: ['settled'],
        ends: [{ kind: 'incomplete', causes: ['verification-timeout'], error: undefined }]
      }))
    );
  }, 30_000);
});
