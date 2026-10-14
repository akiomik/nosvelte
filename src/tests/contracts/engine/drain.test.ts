/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * How the machine waits for what the gate still holds, and how it stops
 * waiting: the landings of `A-ε-C6` (`DC1`), `A-ε-C7` (`DC2`), `A-ε-C8` (`DC3`),
 * `A-ε-C9` (`DC4`), `A-ε-C10` (`DC5`), `A-ε-C12` (`DC6`), `A-ε-C13` (`DC7`) and
 * `A-ε-C14` (`DC8`).
 *
 * **The rows are `internal`, because what they arrange is how the verifier
 * answers** — slowly, one at a time, held until the test releases it, or never
 * — and a consumer gets the provider's verifier, which answers in none of those
 * ways on purpose (0005, "Port route"). So these drive `referenceStream`
 * directly, over a real client and a mock socket, with the verifier injected
 * at the machine's required parameter and the relays named through a scope as
 * a provider's requests name them. `DC7` is the exception, because its claim
 * is about what a consumer's handle publishes: it goes through a provider
 * built with the test's verifier, the one seam a provider takes it at.
 *
 * **Each arm asserts its own arrangement as well as its answer**: that the
 * verifier was serial, that the forward gate was occupied at the EOSE, that a
 * forward candidate was never released, that the request was still running
 * when the held one was. An arm whose arrangement quietly changed would
 * otherwise stay green on an answer it no longer measures.
 *
 * Port band 9440-9479.
 */
import { render } from '@testing-library/svelte';
import type Nostr from 'nostr-typedef';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import { referenceStream } from '$lib/v1/machine.js';
import { createRelayScope } from '$lib/v1/scope.svelte.js';
import type { MachineChunk } from '$lib/v1/stream.js';
import { requestTargets } from '$lib/v1/stream.js';

import VerifiedOutlets from './fixtures/VerifiedOutlets.svelte';
import {
  createTestRelay,
  fakeEvent,
  permanentTransport,
  respondWithEose,
  respondWithEvent
} from './helpers/relay.js';

// `DC7`'s provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

/** Every request an arm opened, so one a failed run left behind is ended too. */
const opened: { stop: () => Promise<void> }[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const one of opened.splice(0)) await one.stop();
  WS.clean();
});

let port = 9440;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

type Verifier = (event: Nostr.Event) => Promise<boolean>;

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * One request through the machine over one relay: its chunks with the time
 * each reached the consumer, whether and when the generator returned, and the
 * subscription id of each leg as the relay saw it. A return read before `stop`
 * is one the generator made on its own; `stop` aborts.
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
  let returnedAt: number | undefined;
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
    returnedAt = Date.now();
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
  let stopped = false;
  /**
   * Waits for the generator to end on its own, for at most `ms`, then ends it.
   * Once: a run that failed half-way is ended by its arm and then by
   * `afterEach`, and the second does nothing.
   */
  const stop = async (ms = 0): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await Promise.race([done, delay(ms)]);
    ac.abort();
    await Promise.race([done, delay(500)]);
    rxNostr.dispose();
  };
  const one = {
    server,
    chunks,
    at,
    done,
    subId,
    stop,
    returned: (): boolean => returned,
    returnedAt: (): number | undefined => returnedAt
  };
  opened.push(one);
  return one;
}

/**
 * Each prototype a projection meets, numbered once for the whole file: the
 * same class reads alike in two runs, and two classes read apart even when
 * they share a name.
 */
const prototypes = new Map<object | null, number>();

/**
 * Where a projection keeps what it says about a value rather than the value's
 * own fields — its prototype and its symbol-keyed fields — so that nothing it
 * adds can be mistaken for, or collide with, a published member.
 */
const PROJECTION = Symbol('projection');

/**
 * What a handle publishes, read field by field rather than serialised. A spread
 * or `JSON.stringify` of an `Error` keeps only its enumerable own fields, so
 * every value is read through all its own keys **and every field its classes
 * define** — a getter on the prototype, or `name` and `message` on
 * `Error.prototype`, which its own keys do not list — recursively. Methods are
 * not fields. Symbol keys keep their identity, and a value's prototype is read
 * by identity rather than by name. A value deeper than this reader opens fails
 * the run rather than reading as a sentinel both runs share. The relay's
 * address is replaced wherever it appears by one token, and nothing else is:
 * two runs are two relays.
 */
const publishedOf = (value: unknown, url: string, depth = 0): unknown => {
  if (typeof value === 'string') return value.split(url).join('<relay>');
  if (typeof value === 'function') return '<function>';
  if (value === null || typeof value !== 'object') return value;
  if (depth > 16) throw new Error('a published value nested deeper than this reader opens');
  const proto = Object.getPrototypeOf(value) as object | null;
  if (!prototypes.has(proto)) prototypes.set(proto, prototypes.size);
  const keys: (string | symbol)[] = Reflect.ownKeys(value);
  for (
    let above = proto;
    above !== null && above !== Object.prototype && above !== Array.prototype;
    above = Object.getPrototypeOf(above) as object | null
  )
    for (const key of Reflect.ownKeys(above)) {
      if (key === 'constructor' || keys.includes(key)) continue;
      const field = Object.getOwnPropertyDescriptor(above, key);
      if (field !== undefined && (field.get !== undefined || typeof field.value !== 'function'))
        keys.push(key);
    }
  const read = (key: string | symbol): unknown =>
    publishedOf((value as Record<string | symbol, unknown>)[key], url, depth + 1);
  const symbols = keys.filter((key): key is symbol => typeof key === 'symbol');
  const strings = keys.filter((key): key is string => typeof key === 'string');
  const about = {
    prototype: prototypes.get(proto),
    symbols: symbols.map((key) => [key, read(key)])
  };
  if (Array.isArray(value)) {
    const items = value.map((each) => publishedOf(each, url, depth + 1));
    // An index is the canonical spelling of a whole number below 2³² − 1;
    // `'01'` is a field like any other.
    const index = (key: string) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < 2 ** 32 - 1;
    const extra = strings.filter((key) => key !== 'length' && !index(key));
    // An ordinary array reads as its items; one with anything more says so,
    // with its items beside what the projection says rather than among its
    // fields, where a field of the same name could stand in for them.
    if (proto === Array.prototype && extra.length === 0 && symbols.length === 0) return items;
    const out: Record<string | symbol, unknown> = Object.fromEntries(
      [...extra].sort().map((key) => [key, read(key)])
    );
    out[PROJECTION] = { ...about, items };
    return out;
  }
  const out: Record<string | symbol, unknown> = Object.fromEntries(
    [...strings].sort().map((key) => [key, read(key)])
  );
  out[PROJECTION] = about;
  return out;
};

/** Whether the relay has been told to close this subscription. */
const closed = (server: WS, subId: string): boolean =>
  (server.messages as unknown[][]).some((frame) => frame[0] === 'CLOSE' && frame[1] === subId);

/** Chunk kinds, each event named by its content, because the order is the claim. */
const shape = (chunks: readonly MachineChunk[]): string[] =>
  chunks.map((chunk) =>
    chunk.type === 'event' ? `event:${chunk.packet.event.content}` : chunk.type
  );

const endsOf = (chunks: readonly MachineChunk[]) =>
  chunks.flatMap((chunk) => (chunk.type === 'settled' ? [chunk.end] : []));

/** The chunks up to and including the outcome, which is what "at the outcome" reads. */
const toTheOutcome = (chunks: readonly MachineChunk[]): string[] => {
  const seen = shape(chunks);
  const at = seen.indexOf('settled');
  return at < 0 ? seen : seen.slice(0, at + 1);
};

/**
 * A verifier that holds each event until the test answers it by content — with
 * `true`, `false` or a rejection — and says which it was handed, in the order
 * it was handed them, and which it answered.
 */
function held() {
  const answers = new Map<
    string,
    { resolve: (ok: boolean) => void; reject: (e: unknown) => void }
  >();
  const answered = new Set<string>();
  const handed: string[] = [];
  const verify: Verifier = (event) => {
    handed.push(event.content);
    return new Promise<boolean>((resolve, reject) =>
      answers.set(event.content, { resolve, reject })
    );
  };
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
  return {
    verify,
    admitted,
    handed: (): string[] => [...handed],
    release,
    answered: (content: string) => answered.has(content)
  };
}

describe('the wait over what the gate holds, and its end', () => {
  // @contracts A-ε-C6
  it('DC1: a backlog verified one at a time is delivered whole ahead of its outcome', async () => {
    // **Serial, which is what verification is**, and the arm records it: a
    // verifier that answered all five at once would leave the chunk list the
    // same and measure nothing, so the order each began and finished in is
    // read as well as what was delivered. **Non-live and live**, which share
    // the wait and not the end: a live request's stream runs on past its
    // outcome, so an event delivered behind the outcome is visible there as
    // order rather than as loss.
    const bulk = [0, 1, 2, 3, 4].map((index) => `bulk-${String(index)}`);
    const runs: unknown[] = [];
    for (const live of [false, true]) {
      try {
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
        const one = request(serial, {
          live,
          reqIdBase: `dc1-${live ? 'live' : 'once'}`,
          timeoutMs: 8000
        });
        const backward = await one.subId('b');
        for (const content of bulk) respondWithEvent(one.server, backward, fakeEvent({ content }));
        respondWithEose(one.server, backward);
        // Every verification answered, or long enough that they would have.
        await vi.waitFor(() => expect(served).toHaveLength(bulk.length * 2), { timeout: 4000 });
        await delay(100);
        await one.stop();
        runs.push({ live, chunks: shape(one.chunks), ends: endsOf(one.chunks), served });
      } catch (error) {
        runs.push({ live, failed: error instanceof Error ? error.message : String(error) });
      }
    }
    expect(
      runs,
      'all five ahead of the one outcome, complete, each verified after the one before it finished'
    ).toEqual(
      [false, true].map((live) => ({
        live,
        chunks: [...bulk.map((content) => `event:${content}`), 'settled'],
        ends: [{ kind: 'complete' }],
        served: bulk.flatMap((content) => [`began:${content}`, `ended:${content}`])
      }))
    );
  }, 20_000);

  // @contracts A-ε-C7
  it('DC2: a live backlog settles at once while its forward leg is still being verified', async () => {
    // **On a clock the arm drives**, so "within 300ms of the EOSE" is a fact
    // about the machine's scheduling rather than about how busy the host is.
    // The socket is open and both REQs are out before `setTimeout`,
    // `setInterval`, their two clears and `Date` are replaced. Every timer made
    // after that — the feed, the verifier's cost, the machine's drain deadlines
    // — moves only when the arm moves it; the request's own settle timer was
    // made before and stays real, at 20s, and promise jobs run as they always
    // do. What is measured is the machine's scheduling on that clock: work it
    // does without a timer — a synchronous loop, say — takes no time on it, so
    // the 300ms bounds what the machine schedules and not the CPU it spends.
    //
    // **Twice: once as the row has it, and once after one forward event that
    // cost two seconds**, because a bound that grew with what the forward leg
    // cost is "a bound the forward leg sets" — which a feed that costs 60ms an
    // event cannot tell from none.
    const run = async (reqIdBase: string, heavyFirst: boolean): Promise<unknown> => {
      let pending = 0;
      const slow: Verifier = async (event) => {
        pending += 1;
        await delay(event.content === 'heavy' ? 2000 : 60);
        pending -= 1;
        return true;
      };
      const one = request(slow, { live: true, reqIdBase });
      try {
        const backward = await one.subId('b');
        const forward = await one.subId('f');
        vi.useFakeTimers({
          toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
        });
        const events = (): MachineChunk[] => one.chunks.filter((chunk) => chunk.type === 'event');
        let sent = 0;
        let feed: ReturnType<typeof setInterval> | undefined;
        const observed: Record<string, unknown> = {};
        try {
          if (heavyFirst) {
            respondWithEvent(one.server, forward, fakeEvent({ content: 'heavy' }));
            for (let step = 0; step < 300 && events().length < 1; step += 1)
              await vi.advanceTimersByTimeAsync(10);
            observed['heavyDeliveredFirst'] = shape(one.chunks)[0] === 'event:heavy';
          }
          const before = events().length;
          feed = setInterval(() => {
            sent += 1;
            respondWithEvent(one.server, forward, fakeEvent({ content: `live-${String(sent)}` }));
          }, 15);
          // The forward leg is already delivering when the backlog finishes: a
          // gate that is empty at the boundary drains at once whatever it is
          // shared with, so this is the condition the claim turns on.
          for (let step = 0; step < 200 && events().length - before < 2; step += 1)
            await vi.advanceTimersByTimeAsync(5);
          observed['deliveredBeforeTheEose'] = events().length - before;
          observed['pendingAtTheEose'] = pending;
          const sentAtTheEose = sent;
          const chunksAtTheEose = one.chunks.length;
          const eoseAt = Date.now();
          respondWithEose(one.server, backward);
          // The feed runs on for the whole window, outcome or not; when the
          // outcome arrives, how many had been sent by then is noted.
          let sentAtTheOutcome: number | undefined;
          for (let step = 0; step < 120; step += 1) {
            await vi.advanceTimersByTimeAsync(5);
            if (sentAtTheOutcome === undefined && shape(one.chunks).includes('settled'))
              sentAtTheOutcome = sent;
          }
          const settledIndex = one.chunks.findIndex((chunk) => chunk.type === 'settled');
          const settledAt = settledIndex < 0 ? undefined : one.at[settledIndex];
          observed['outcomeAfterTheEose'] = settledIndex >= chunksAtTheEose;
          observed['interval'] =
            settledAt === undefined ? 'no outcome in the window' : settledAt - eoseAt;
          // Counted over the window alone, from the EOSE on.
          observed['sentInTheWindow'] = sent - sentAtTheEose;
          // Sent after the outcome and delivered: what an in-flight drain of
          // the forward gate cannot account for.
          observed['deliveredAfterTheOutcome'] = one.chunks
            .slice(settledIndex < 0 ? one.chunks.length : settledIndex)
            .filter(
              (chunk) =>
                chunk.type === 'event' &&
                Number(chunk.packet.event.content.replace('live-', '')) >
                  (sentAtTheOutcome ?? Infinity)
            ).length;
          observed['ends'] = endsOf(one.chunks);
        } finally {
          if (feed !== undefined) clearInterval(feed);
          vi.useRealTimers();
        }
        return observed;
      } catch (error) {
        return { failed: error instanceof Error ? error.message : String(error) };
      } finally {
        await one.stop();
      }
    };
    const asTheRowHasIt = await run('dc2', false);
    const afterACostlyOne = await run('dc2-heavy', true);

    const judged = (observed: unknown) => {
      const o = observed as Record<string, unknown>;
      return {
        failed: o['failed'],
        heavyDeliveredFirst: o['heavyDeliveredFirst'],
        trafficBeforeTheEose: (o['deliveredBeforeTheEose'] as number) >= 2,
        forwardGateOccupiedAtTheEose: (o['pendingAtTheEose'] as number) > 0,
        outcomeAfterTheEose: o['outcomeAfterTheEose'],
        within300ms: typeof o['interval'] === 'number' && o['interval'] >= 0 && o['interval'] < 300,
        moreThan25SentInTheWindow: (o['sentInTheWindow'] as number) > 25,
        moreThan3SentAfterAndDelivered: (o['deliveredAfterTheOutcome'] as number) > 3,
        ends: o['ends']
      };
    };
    const expected = {
      failed: undefined,
      trafficBeforeTheEose: true,
      forwardGateOccupiedAtTheEose: true,
      outcomeAfterTheEose: true,
      within300ms: true,
      moreThan25SentInTheWindow: true,
      moreThan3SentAfterAndDelivered: true,
      ends: [{ kind: 'complete' }]
    };
    expect(
      { asTheRowHasIt: judged(asTheRowHasIt), afterACostlyOne: judged(afterACostlyOne) },
      `the outcome within 300ms of the EOSE and after it, complete, with live traffic either side — observed ${JSON.stringify({ asTheRowHasIt, afterACostlyOne })}`
    ).toEqual({
      asTheRowHasIt: { ...expected, heavyDeliveredFirst: undefined },
      afterACostlyOne: { ...expected, heavyDeliveredFirst: true }
    });
  }, 20_000);

  // @contracts A-ε-C8
  it('DC3: what the backlog answers does not depend on the forward leg’s order or its history', async () => {
    // **Six runs, every one collected before any is read**, so a mutation is
    // measured against all of them — a run whose setup failed is recorded
    // rather than ending the arm.
    const failedRun = (error: unknown): { failed: string } => ({
      failed: error instanceof Error ? error.message : String(error)
    });
    const orderRun = async (
      reqIdBase: string,
      plan: (gate: ReturnType<typeof held>) => Promise<void>,
      forwardAdmittedFirst = false
    ): Promise<unknown> => {
      const gate = held();
      const one = request(gate.verify, { live: true, reqIdBase });
      try {
        const backward = await one.subId('b');
        const forward = await one.subId('f');
        if (forwardAdmittedFirst) {
          // Admitted and handed to its verifier, not merely sent, before the
          // backward candidate is.
          respondWithEvent(one.server, forward, fakeEvent({ content: 'f1' }));
          await vi.waitFor(() => expect(gate.admitted('f1')).toBe(true), { timeout: 2000 });
          respondWithEvent(one.server, backward, fakeEvent({ content: 'b1' }));
        } else {
          respondWithEvent(one.server, backward, fakeEvent({ content: 'b1' }));
          respondWithEvent(one.server, forward, fakeEvent({ content: 'f1' }));
        }
        respondWithEose(one.server, backward);
        await vi.waitFor(() => expect(gate.admitted('b1') && gate.admitted('f1')).toBe(true), {
          timeout: 2000
        });
        await plan(gate);
        // The outcome, read together with the chunks up to it — waited for
        // with a bound, and recorded as missing if it never came.
        await vi
          .waitFor(() => expect(shape(one.chunks)).toContain('settled'), { timeout: 2000 })
          .catch(() => undefined);
        const atTheOutcome = toTheOutcome(one.chunks);
        const forwardAnswered = gate.answered('f1');
        await one.stop(100);
        return {
          end: endsOf(one.chunks)[0] ?? 'no outcome',
          backlogEventPrecedesOutcome:
            atTheOutcome.includes('settled') && atTheOutcome.includes('event:b1'),
          forwardAnswered
        };
      } catch (error) {
        return failedRun(error);
      } finally {
        await one.stop();
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
    const unfinished = async (gate: ReturnType<typeof held>) => {
      await gate.release('b1');
      await delay(300);
    };
    const forwardUnfinished = await orderRun('dc3c', unfinished);
    // **And admitted the other way round**: the forward candidate is in its
    // gate before the backward one arrives, and is still never answered. A
    // backlog that waited on what the other leg admitted before it — rather
    // than on its own candidates — answers differently here and nowhere else.
    const forwardAdmittedFirst = await orderRun('dc3f', unfinished, true);

    // **The other input**: the same backward event and EOSE, differing only in
    // whether one forward event was verified first, at 500ms against the
    // backward candidate's 1300ms — read at the outcome.
    const historyRun = async (reqIdBase: string, forwardFirst: boolean): Promise<unknown> => {
      const costed: Verifier = async (event) => {
        await delay(event.content.startsWith('fwd') ? 500 : 1300);
        return true;
      };
      const one = request(costed, { live: true, reqIdBase });
      try {
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
        const atTheOutcome = toTheOutcome(one.chunks);
        await one.stop(50);
        return {
          end: endsOf(one.chunks)[0],
          backlogEventDelivered: atTheOutcome.includes('event:bwd-1')
        };
      } catch (error) {
        return failedRun(error);
      } finally {
        await one.stop();
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
        sameInEveryOrder: [backwardFirst, forwardUnfinished, forwardAdmittedFirst].map(
          (run) => answerOf(run) === answerOf(forwardFirst)
        ),
        forwardFirst,
        forwardUnfinished,
        forwardAdmittedFirst,
        sameWhateverTheHistory:
          JSON.stringify(aForwardVerificationFirst) === JSON.stringify(noHistory),
        noHistory
      },
      'the same answer in every release order and whatever the forward leg cost before it'
    ).toEqual({
      sameInEveryOrder: [true, true, true],
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
      forwardAdmittedFirst: {
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
      const gate = held();
      const one = request(gate.verify, { live: true, reqIdBase: `dc4-${how}` });
      try {
        const backward = await one.subId('b');
        await one.subId('f');
        respondWithEvent(one.server, backward, fakeEvent({ content: `held-${how}` }));
        respondWithEose(one.server, backward);
        await vi.waitFor(() => expect(shape(one.chunks)).toContain('settled'), { timeout: 4000 });
        const atTheCut = shape(one.chunks);
        await gate.release(`held-${how}`, how);
        const runningAtRelease = !one.returned();
        // **A horizon, and a stated one**: what is read is what arrived in the
        // half second after the release. A delivery deferred past that is not
        // seen here; the continuations of the verification are microtasks, so
        // the leak this guards against arrives in the first few.
        await delay(500);
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
      } finally {
        await one.stop();
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

  // @contracts A-ε-C10
  it('DC5: a wait that was cut is not waited out again, and arms no second deadline', async () => {
    // **On a clock the arm drives, with every deadline counted.** The claim is
    // a gap — the outcome, then the generator's return inside 400ms of it,
    // where a second wait over the same gate would put a whole drain period
    // between them — and an absorption nothing downstream can see: a deadline
    // armed over a gate that has already answered resolves into that answer.
    // So the clock is the arm's, installed before the request is made so that
    // its settle timer is on it too, and every `setTimeout` armed with a delay
    // inside 1000–4000ms is recorded — a call through the global as it stands
    // when the call is made, which is how the machine reaches it, and not a
    // timer function captured before the recorder was installed: the range
    // `armCut` clamps each of the gate's deadlines into. Not every long timer, because the dependency arms its own
    // — rx-nostr's 10s `disconnectTimeout` once the backlog's subscription has
    // closed. The recorder's positive control is the one deadline the machine
    // does arm, over the gate whose boundary was drawn.
    //
    // **Three runs, because one edit reaches each and none reaches all.** The
    // first holds one candidate for ever, so the end is what is measured: a
    // second wait over the gate delays the return without arming anything a
    // later candidate could. The second holds two and answers one after the
    // cut, so a candidate leaving a gate that has answered is what is
    // measured — and the first run cannot see that, because nothing in it
    // ever leaves. The third is the first with the settle timer drawing the
    // boundary instead of an EOSE: a non-live request ends from the same
    // outcome by either, and an end that followed only one of them leaves the
    // other's generator running.
    const run = async (
      reqIdBase: string,
      candidates: readonly string[],
      releasedAfterTheCut: string | undefined,
      drawnBy: 'eose' | 'timer' = 'eose'
    ): Promise<unknown> => {
      const gate = held();
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
      });
      const armed: number[] = [];
      const faked = globalThis.setTimeout;
      globalThis.setTimeout = ((handler: () => void, ms?: number, ...rest: unknown[]) => {
        if ((ms ?? 0) >= 1000 && (ms ?? 0) <= 4000) armed.push(ms ?? 0);
        return (faked as unknown as (...args: unknown[]) => unknown)(handler, ms, ...rest);
      }) as unknown as typeof globalThis.setTimeout;
      const one = request(gate.verify, {
        live: false,
        reqIdBase,
        timeoutMs: drawnBy === 'timer' ? 150 : 20_000
      });
      const observed: Record<string, unknown> = {};
      try {
        try {
          // The REQ, on the arm's clock: a millisecond at a time, so the
          // candidates are in before a 150ms timer could fire.
          let backward: string | undefined;
          for (let step = 0; step < 100 && backward === undefined; step += 1) {
            await vi.advanceTimersByTimeAsync(1);
            backward = (one.server.messages as unknown[][])
              .filter((frame) => frame[0] === 'REQ')
              .map((frame) => String(frame[1]))
              .find((id) => id.startsWith(`${reqIdBase}-b:`));
          }
          if (backward === undefined) throw new Error('the relay was never asked for the backlog');
          for (const content of candidates)
            respondWithEvent(one.server, backward, fakeEvent({ content }));
          for (let step = 0; step < 100 && !candidates.every(gate.admitted); step += 1)
            await vi.advanceTimersByTimeAsync(1);
          observed['admitted'] = candidates.filter(gate.admitted);
          if (drawnBy === 'eose') respondWithEose(one.server, backward);
          for (let step = 0; step < 300 && armed.length === 0; step += 1)
            await vi.advanceTimersByTimeAsync(1);
          observed['armedAtTheBoundary'] = [...armed];
          for (let step = 0; step < 300 && !shape(one.chunks).includes('settled'); step += 1)
            await vi.advanceTimersByTimeAsync(10);
          const settledIndex = one.chunks.findIndex((chunk) => chunk.type === 'settled');
          const outcomeAt = settledIndex < 0 ? undefined : one.at[settledIndex];
          observed['atTheCut'] = shape(one.chunks);
          observed['ends'] = endsOf(one.chunks);
          if (releasedAfterTheCut !== undefined) {
            const before = armed.length;
            const releasing = gate.release(releasedAfterTheCut);
            await vi.advanceTimersByTimeAsync(100);
            await releasing;
            observed['armedAfterTheRelease'] = armed.slice(before);
            observed['afterTheRelease'] = shape(one.chunks);
          }
          // The end, read before anything aborts the request: up to 400ms of
          // the arm's clock past the outcome, and returned on its own or not.
          for (let step = 0; step < 80 && !one.returned(); step += 1)
            await vi.advanceTimersByTimeAsync(5);
          const returnedAt = one.returnedAt();
          observed['returnedOnItsOwnWithin400ms'] =
            one.returned() &&
            outcomeAt !== undefined &&
            returnedAt !== undefined &&
            returnedAt - outcomeAt < 400;
          // And over the whole run: the one deadline, and no other.
          observed['armedInAll'] = [...armed];
        } finally {
          globalThis.setTimeout = faked;
          vi.useRealTimers();
        }
        return observed;
      } catch (error) {
        return { failed: error instanceof Error ? error.message : String(error) };
      } finally {
        await one.stop();
      }
    };
    const heldForEver = await run('dc5a', ['never-released'], undefined);
    const oneOfTwoAnsweredAfterTheCut = await run('dc5b', ['first', 'second'], 'first');
    const drawnByTheTimer = await run('dc5c', ['never-released'], undefined, 'timer');

    const cut = [{ kind: 'incomplete', causes: ['verification-timeout'], error: undefined }];
    expect(
      { heldForEver, oneOfTwoAnsweredAfterTheCut, drawnByTheTimer },
      'the outcome alone, the end in the same breath, and one deadline only'
    ).toEqual({
      heldForEver: {
        admitted: ['never-released'],
        armedAtTheBoundary: [1000],
        atTheCut: ['settled'],
        ends: cut,
        returnedOnItsOwnWithin400ms: true,
        armedInAll: [1000]
      },
      oneOfTwoAnsweredAfterTheCut: {
        admitted: ['first', 'second'],
        armedAtTheBoundary: [1000],
        atTheCut: ['settled'],
        ends: cut,
        armedAfterTheRelease: [],
        afterTheRelease: ['settled'],
        returnedOnItsOwnWithin400ms: true,
        armedInAll: [1000]
      },
      drawnByTheTimer: {
        admitted: ['never-released'],
        armedAtTheBoundary: [1000],
        atTheCut: ['settled'],
        ends: [
          { kind: 'incomplete', causes: ['timeout', 'verification-timeout'], error: undefined }
        ],
        returnedOnItsOwnWithin400ms: true,
        armedInAll: [1000]
      }
    });
  }, 20_000);

  // @contracts A-ε-C12
  it('DC6: only what the gate held when the timer drew the boundary is handled before the outcome', async () => {
    // **The timer draws the boundary, because an EOSE would close the
    // subscription behind it** and leave the relay nothing to offer: the arm
    // says the subscription was still open when the late event was sent,
    // rather than trusting that it was. **The observation is the verifier's
    // own arrivals**, not the delivered chunks: a late event admitted,
    // verified and then dropped delivers nothing either, and it is a wait this
    // row says was never extended.
    //
    // **Twice: as the row has it, and with the relay's EOSE arriving after the
    // late offer and before the held event is answered.** With no EOSE the
    // target is still undetermined at the outcome, so `timeout` is said twice
    // over and the run cannot tell whether the timer is one of the sayers;
    // with the EOSE every target is determined, and the timer is the only
    // thing left that can say it.
    const run = async (reqIdBase: string, lateEose: boolean): Promise<unknown> => {
      const gate = held();
      const one = request(gate.verify, { live: false, reqIdBase, timeoutMs: 150 });
      try {
        const backward = await one.subId('b');
        respondWithEvent(one.server, backward, fakeEvent({ content: 'at-the-boundary' }));
        await vi.waitFor(() => expect(gate.admitted('at-the-boundary')).toBe(true), {
          timeout: 2000
        });
        // Past the 150ms timer, and well inside the 1000ms drain floor that
        // follows it: the boundary is drawn and the wait over it is still open.
        await delay(250);
        const openAtTheLateOffer = !closed(one.server, backward);
        respondWithEvent(one.server, backward, fakeEvent({ content: 'past-the-boundary' }));
        await delay(80);
        if (lateEose) respondWithEose(one.server, backward);
        // What the EOSE did, read before the release: it ended the backlog's
        // subscription, and the outcome was not yet out.
        await delay(50);
        const backlogClosedBeforeTheOutcome =
          closed(one.server, backward) && !shape(one.chunks).includes('settled');
        await gate.release('at-the-boundary');
        await vi
          .waitFor(() => expect(shape(one.chunks)).toContain('settled'), { timeout: 2000 })
          .catch(() => undefined);
        // The reader's positive control: once the request has ended, the same
        // reader sees the subscription closed.
        await vi
          .waitFor(() => expect(closed(one.server, backward)).toBe(true), { timeout: 1000 })
          .catch(() => undefined);
        return {
          openAtTheLateOffer,
          backlogClosedBeforeTheOutcome,
          closedOnceItEnded: closed(one.server, backward),
          handed: gate.handed(),
          chunks: shape(one.chunks),
          ends: endsOf(one.chunks)
        };
      } catch (error) {
        return { failed: error instanceof Error ? error.message : String(error) };
      } finally {
        await one.stop(200);
      }
    };
    const asTheRowHasIt = await run('dc6', false);
    const withALateEose = await run('dc6-eose', true);
    const answer = (backlogClosedBeforeTheOutcome: boolean) => ({
      openAtTheLateOffer: true,
      backlogClosedBeforeTheOutcome,
      closedOnceItEnded: true,
      handed: ['at-the-boundary'],
      chunks: ['event:at-the-boundary', 'settled'],
      ends: [{ kind: 'incomplete', causes: ['timeout'], error: undefined }]
    });
    expect(
      { asTheRowHasIt, withALateEose },
      'the first event and then the outcome; the second never handed to the verifier; the timer’s cause alone'
    ).toEqual({ asTheRowHasIt: answer(false), withALateEose: answer(true) });
  });

  // @contracts A-ε-C13
  it('DC7: a candidate the forward cut discarded is reported by the leg’s end and by nothing finer', async () => {
    // **Through a provider, and against a control.** The only shape in which a
    // discarded candidate and a `settled` answer coexist is the forward leg's:
    // a backward cut adds `verification-timeout` and the answer is never
    // `settled`. So the backlog answers complete and empty first, one matching
    // event is admitted to the forward gate, and the socket dies with it
    // inside. The verifier answers `true` once the cut is over — once the
    // stream has ended, which it does a drain floor after the death with a
    // candidate inside and at once without one.
    //
    // **Two runs, because the claim is an indistinguishability**: asserting the
    // discarding run's fields alone passes against an implementation that
    // publishes the discard. What is compared is everything the consumer's
    // handle publishes — its four members, every field under them, errors read
    // through and not serialised — and the outlet the request components
    // render, with the argument it is handed. **And read twice**: once the
    // forward gate's wait is over in both, and once inside it, 300ms after the
    // death, where the run holding a candidate is still `live` and the other
    // is not. That one field is `A-ε-C5`'s wait, and a third run is what says
    // so: the same candidate answered `true` inside the wait is delivered, and
    // the request ends then rather than when the cut would have fallen.
    const plan: ReqPlan = {
      kind: 'request',
      descriptor: {
        filters: [{ kinds: [1] }],
        live: true,
        retain: 'unbounded',
        settleTimeoutMs: 2000
      }
    };
    const runs: Record<string, Record<string, unknown>> = {};
    for (const arm of ['discarded', 'nothing-sent', 'delivered-in-the-wait'] as const) {
      const url = nextUrl();
      const server = new WS(url, { jsonProtocol: true });
      const gate = held();
      let handle: ReqHandle | undefined;
      const outlets: [string, unknown][] = [];
      const view = render(VerifiedOutlets, {
        relays: [url],
        verifyEvent: gate.verify,
        plan: () => plan,
        request: (made: ReqHandle) => {
          handle = made;
        },
        held: (outlet: string, argument: unknown) => {
          outlets.push([outlet, argument]);
        }
      });
      try {
        let ids: string[] = [];
        await vi.waitFor(
          () => {
            ids = (server.messages as unknown[][])
              .filter((frame) => frame[0] === 'REQ')
              .map((frame) => String(frame[1]));
            expect(ids.length, 'the relay was asked for both legs').toBeGreaterThanOrEqual(2);
          },
          { timeout: 3000 }
        );
        const backward = ids.find((id) => id.includes('-b:')) as string;
        const forward = ids.find((id) => id.includes('-f:')) as string;
        server.send(['EOSE', backward]);
        await vi.waitFor(() => expect(handle?.state.status).toBe('settled'), { timeout: 3000 });
        const candidate = arm === 'nothing-sent' ? undefined : arm;
        if (candidate !== undefined) {
          server.send(['EVENT', forward, fakeEvent({ content: candidate, created_at: 1000 })]);
          await vi.waitFor(() => expect(gate.admitted(candidate)).toBe(true), {
            timeout: 2000
          });
        }
        server.error({ code: 1006, reason: 'gone', wasClean: false });
        const diedAt = Date.now();
        // **Inside the forward gate's wait**: 300ms after the death, about
        // 700ms before this arrangement's cut, with the leg's end and the
        // query's state given that long to reach the handle.
        // A delay asked for, not a time measured: a host that stalls past the
        // deadline misses the window, and the arm fails rather than passes —
        // the time the sample was actually taken is in its message.
        await delay(300);
        const sampledAfterMs = Date.now() - diedAt;
        const inTheWait = publishedOf(handle as ReqHandle, url) as Record<string, unknown>;
        const { activity: activityInTheWait, ...restInTheWait } = inTheWait;
        let endedBeforeTheCut: boolean | undefined;
        if (arm === 'delivered-in-the-wait') {
          await gate.release(candidate as string);
          // Ended by the verdict: idle well before the 1000ms deadline, which
          // the wait would otherwise have run out to.
          endedBeforeTheCut = await vi
            .waitFor(() => expect(handle?.activity).toBe('idle'), { timeout: 400 })
            .then(
              () => true,
              () => false
            );
        }
        await vi.waitFor(() => expect(handle?.activity).toBe('idle'), { timeout: 4000 });
        const answeredBeforeTheStreamEnded =
          candidate === undefined ? undefined : gate.answered(candidate);
        if (arm === 'discarded') await gate.release('discarded');
        await delay(200);
        const request = handle as ReqHandle;
        const [outlet, argument] = outlets.at(-1) ?? ['none', undefined];
        runs[arm] = {
          sampledAfterMs,
          handed: gate.handed(),
          answeredBeforeTheStreamEnded,
          endedBeforeTheCut,
          members: Reflect.ownKeys(request).map(String).sort(),
          activityInTheWait,
          restInTheWait,
          surface: publishedOf(request, url),
          outlet,
          outletArgument: publishedOf(argument, url),
          outletHandsTheRequest:
            (argument as { request?: unknown } | undefined)?.request === request
        };
      } catch (error) {
        runs[arm] = { failed: error instanceof Error ? error.message : String(error) };
      } finally {
        view.unmount();
      }
    }

    const discarded = runs['discarded'] ?? {};
    const nothingSent = runs['nothing-sent'] ?? {};
    const delivered = runs['delivered-in-the-wait'] ?? {};
    type Published = {
      state?: { status?: unknown; events?: unknown; hasMatchEvidence?: unknown };
      diagnostics?: { legEnded?: { kind?: unknown } };
    };
    // The answer as the row states it, read off a projected surface: the
    // status, the contents of the events, the evidence and the leg's end.
    const answerOf = (published: unknown) => {
      const { state, diagnostics } = (published ?? {}) as Published;
      return {
        status: state?.status,
        events: Array.isArray(state?.events)
          ? (state.events as { content?: unknown }[]).map((event) => event.content)
          : state?.events,
        hasMatchEvidence: state?.hasMatchEvidence,
        legEnded: diagnostics?.legEnded?.kind
      };
    };
    const readOf = (run: Record<string, unknown>) => ({
      failed: run['failed'],
      inTheWait: answerOf(run['restInTheWait']),
      onceItEnded: answerOf(run['surface']),
      outlet: run['outlet'],
      outletHandsTheRequest: run['outletHandsTheRequest']
    });
    const nothingFound = {
      status: 'settled',
      events: [],
      hasMatchEvidence: false,
      legEnded: 'ended'
    };
    const found = { ...nothingFound, events: ['delivered-in-the-wait'], hasMatchEvidence: true };
    const four = ['activity', 'diagnostics', 'refresh', 'state'];
    expect(
      {
        // Each run is the one it says it is: what the verifier was handed, and
        // whether it had answered before the stream ended.
        arrangement: [discarded, nothingSent, delivered].map((run) => [
          run['handed'],
          run['answeredBeforeTheStreamEnded'],
          run['endedBeforeTheCut']
        ]),
        members: [discarded, nothingSent, delivered].map((run) => run['members']),
        discarded: readOf(discarded),
        nothingSent: readOf(nothingSent),
        delivered: readOf(delivered),
        // Inside the wait, one field apart: the activity, and nothing else.
        inTheWait: {
          activity: [discarded, nothingSent, delivered].map((run) => run['activityInTheWait']),
          theRest: [discarded['restInTheWait'], delivered['restInTheWait']]
        },
        // Once it is over, nothing apart at all.
        sameSurface: { handle: discarded['surface'], outlet: discarded['outletArgument'] }
      },
      `settled, nothing found, the leg’s end in both runs, and no field telling them apart once the wait is over — sampled inside the wait ${JSON.stringify([discarded, nothingSent, delivered].map((run) => run['sampledAfterMs']))}ms after the death`
    ).toStrictEqual({
      arrangement: [
        [['discarded'], false, undefined],
        [[], undefined, undefined],
        [['delivered-in-the-wait'], true, true]
      ],
      members: [four, four, four],
      discarded: {
        failed: undefined,
        inTheWait: nothingFound,
        onceItEnded: nothingFound,
        outlet: 'nodata',
        outletHandsTheRequest: true
      },
      nothingSent: {
        failed: undefined,
        inTheWait: nothingFound,
        onceItEnded: nothingFound,
        outlet: 'nodata',
        outletHandsTheRequest: true
      },
      delivered: {
        failed: undefined,
        inTheWait: nothingFound,
        onceItEnded: found,
        outlet: 'events',
        outletHandsTheRequest: true
      },
      inTheWait: {
        activity: ['live', 'idle', 'live'],
        theRest: [nothingSent['restInTheWait'], nothingSent['restInTheWait']]
      },
      sameSurface: { handle: nothingSent['surface'], outlet: nothingSent['outletArgument'] }
    });
  }, 20_000);

  // @contracts A-ε-C14
  it('DC8: a timer boundary over a cut gate reports both causes, exactly and in order', async () => {
    // **Two arms, and both are the contract.** With no EOSE the target is still
    // undetermined at the outcome, so `timeout` is over-determined and this
    // arm alone cannot see the timer's own contribution go away; it is the
    // trace the published wording was once false of — `verification-timeout`
    // from a relay that sent an EVENT and nothing else. With the EOSE inside
    // the drain every target is determined at the outcome, and the timer is
    // the only thing left that can say `timeout`.
    //
    // **Live**, so the consumer is still listening when the held candidate is
    // answered after the cut, and the arm says so. **The late EVENT goes
    // before the late EOSE**, with the subscription still open, so that its
    // refusal is the gate's and not a closed transport's; the one sent before
    // the boundary, which the verifier was handed, is the control. **The order
    // is held against a rank change and not against the sort**: both routes
    // add the two causes in canonical order already, so a `causesOf` that
    // stopped sorting would still pass here.
    const runs: unknown[] = [];
    for (const lateEose of [false, true]) {
      const arm = lateEose ? 'eose-inside-the-drain' : 'no-eose';
      const gate = held();
      const one = request(gate.verify, { live: true, reqIdBase: `dc8-${arm}`, timeoutMs: 150 });
      try {
        const backward = await one.subId('b');
        await one.subId('f');
        respondWithEvent(one.server, backward, fakeEvent({ content: `held-${arm}` }));
        await vi.waitFor(() => expect(gate.admitted(`held-${arm}`)).toBe(true), {
          timeout: 2000
        });
        // Past the 150ms timer and well inside the 1000ms floor that follows.
        await delay(400);
        const openAtTheLateOffer = !closed(one.server, backward);
        respondWithEvent(one.server, backward, fakeEvent({ content: `past-${arm}` }));
        await delay(80);
        if (lateEose) respondWithEose(one.server, backward);
        // The arrangement, read rather than trusted: the late EOSE reached the
        // client and ended the backlog's subscription before the outcome was
        // derived, and with no EOSE that subscription is still open then.
        await delay(50);
        const backlogClosedBeforeTheOutcome =
          closed(one.server, backward) && !shape(one.chunks).includes('settled');
        await vi.waitFor(() => expect(shape(one.chunks)).toContain('settled'), { timeout: 4000 });
        const atTheCut = shape(one.chunks);
        await gate.release(`held-${arm}`);
        const runningAtRelease = !one.returned();
        // The same stated horizon as `DC4`'s.
        await delay(500);
        const afterTheRelease = shape(one.chunks);
        // The reader's positive control: ended, the request has closed the
        // subscription the late offer found open.
        await one.stop();
        runs.push({
          arm,
          openAtTheLateOffer,
          backlogClosedBeforeTheOutcome,
          closedOnceItEnded: closed(one.server, backward),
          handed: gate.handed(),
          atTheCut,
          runningAtRelease,
          afterTheRelease,
          ends: endsOf(one.chunks)
        });
      } catch (error) {
        runs.push({ arm, failed: error instanceof Error ? error.message : String(error) });
      } finally {
        await one.stop();
      }
    }
    expect(runs, 'both causes, exactly, in canonical order, from one relay in either arm').toEqual(
      ['no-eose', 'eose-inside-the-drain'].map((arm) => ({
        arm,
        openAtTheLateOffer: true,
        backlogClosedBeforeTheOutcome: arm === 'eose-inside-the-drain',
        closedOnceItEnded: true,
        handed: [`held-${arm}`],
        atTheCut: ['settled'],
        runningAtRelease: true,
        afterTheRelease: ['settled'],
        ends: [
          { kind: 'incomplete', causes: ['timeout', 'verification-timeout'], error: undefined }
        ]
      }))
    );
  }, 20_000);
});
