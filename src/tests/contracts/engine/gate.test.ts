/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The verification gate at the machine's own seam: `A-ε-C4`'s landing, `VG1`,
 * and `A-ε-C11`'s, `VG2`.
 *
 * **Both rows are `internal`, and the reason is what they arrange**: _how_ a
 * verifier answers — with something that is not a boolean, by throwing before
 * it has made a Promise, by never answering. A consumer gets the provider's
 * verifier, which answers none of those ways (0005, "Port route"). So these
 * drive `referenceStream` directly, over a real client and a mock socket, with
 * the verifier injected at the machine's required parameter, and the relays
 * named through a scope as a provider's requests name them. The client is
 * `createTestRelay`'s, which writes `skipVerify: true` as the provider does:
 * the gate under test is the only check between the wire and the chunks.
 *
 * **`A-ε-C11` says the runner observes the throw that escapes, and of its spike
 * witness that was so**: `AE17` asserted the outcome and left an uncaught
 * error to the runner failing the file. A ledger reads a test's own status, so
 * an error the runner reports around a passing test is a survivor there — and
 * a rejection handler that drops the event, releases the gate and then throws
 * on leaves the outcome exactly right. So `VG2` observes the escape itself,
 * through {@link escapes}, with a positive control on each of its channels.
 * **What it hears is what arrives while it listens**, which ends a tenth of a
 * second after the last request: an escape deferred past that is heard by
 * nothing, the runner included. Measured with a rethrow on a timer of a second
 * and a half and this arm run alone: it passed, and the run exited 0. The two
 * exits the controls measure — RxJS's report on a timer of zero, and a
 * rejection reported once the microtasks have run — arrive well inside it.
 *
 * Port band 9700-9739.
 */
import type Nostr from 'nostr-typedef';
import { createRxOneshotReq } from 'rx-nostr';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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

afterEach(() => WS.clean());

let port = 9700;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

type Verifier = (event: Nostr.Event) => Promise<boolean>;

const settle = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * One request over one relay, its chunks as they arrive, and the subscription
 * id of each leg as the relay saw it. The legs are told apart by the name the
 * machine gives them (`<base>-b:` and `<base>-f:`), because a delivered packet
 * carries no leg: an event's content is what says which leg it was sent on.
 */
function request(verifyEvent: Verifier, { live, reqIdBase }: { live: boolean; reqIdBase: string }) {
  const url = nextUrl();
  const { rxNostr, server } = createTestRelay(url);
  const transport = permanentTransport(rxNostr);
  const scope = createRelayScope(rxNostr, [url]);
  const ac = new AbortController();
  const chunks: MachineChunk[] = [];
  const done = (async () => {
    for await (const chunk of referenceStream({
      transport,
      targets: requestTargets(transport, scope.current),
      filters: [{ kinds: [1] }],
      live,
      reqIdBase,
      signal: ac.signal,
      timeoutMs: 3000,
      verifyEvent
    }))
      chunks.push(chunk);
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
  /** Ends the request, waits for its generator and closes the client. */
  const stop = async (): Promise<void> => {
    ac.abort();
    await done;
    rxNostr.dispose();
  };
  return { server, chunks, done, subId, stop };
}

const shape = (chunks: readonly MachineChunk[]): string[] => chunks.map((chunk) => chunk.type);

const contents = (chunks: readonly MachineChunk[]): string[] =>
  chunks.flatMap((chunk) => (chunk.type === 'event' ? [chunk.packet.event.content] : []));

const endsOf = (chunks: readonly MachineChunk[]) =>
  chunks.flatMap((chunk) => (chunk.type === 'settled' ? [chunk.end] : []));

/**
 * What leaves as an uncaught error while it is installed: Node's two process
 * events, with the runner's own listeners taken off for the duration and put
 * back by `restore`.
 *
 * **Those two events are where an error with no handler goes.** A throw in a
 * subscriber's `next` is reported by RxJS on a timer, which throws it again —
 * the application's RxJS and the copy the dependency bundles do the same, which
 * was measured once, before this was written — and a rejection nobody handles
 * is Node's `unhandledRejection`. The arm's positive controls measure both on
 * every run, the first through the capability the machine subscribes through,
 * whose subscriber is the application's RxJS.
 *
 * **Put back however the arm ends.** A test the runner times out is abandoned
 * rather than unwound, so its `finally` never runs, and the runner's listeners
 * stayed off for the rest of the worker — measured. So `restore` is also
 * registered with the runner, and running it twice does nothing the second
 * time. The listeners are saved raw, so one registered with `once` goes back
 * as its wrapper and stays once.
 */
function escapes() {
  const saved = {
    uncaught: process.rawListeners('uncaughtException') as NodeJS.UncaughtExceptionListener[],
    rejection: process.rawListeners('unhandledRejection') as NodeJS.UnhandledRejectionListener[]
  };
  const seen: { channel: string; message: string }[] = [];
  const recorder =
    (channel: string) =>
    (error: unknown): void => {
      seen.push({ channel, message: error instanceof Error ? error.message : String(error) });
    };
  const onUncaught = recorder('uncaughtException');
  const onRejection = recorder('unhandledRejection');
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    process.removeListener('uncaughtException', onUncaught);
    process.removeListener('unhandledRejection', onRejection);
    for (const listener of saved.uncaught) process.on('uncaughtException', listener);
    for (const listener of saved.rejection) process.on('unhandledRejection', listener);
  };
  onTestFinished(restore);
  return { seen, restore };
}

describe('the verification gate', () => {
  // @contracts A-ε-C4
  it('VG1: neither leg hands over an event the verifier did not answer `true` for, and each hands over the event beside it', async () => {
    // **(A) A refusal, on each leg.** The relay sends a refused event, one the
    // verifier answers with a string, and then a genuine one on the backward
    // leg, and the same three on the forward leg once the backlog has settled.
    // The verifier answers by content, and keeps the content of everything it
    // was handed. The string is here as well as in (B) because (B) asks on the
    // backward leg only, and a leg that read the answer loosely is a leg.
    const handed: string[] = [];
    const gate = (async (event: Nostr.Event) => {
      handed.push(event.content);
      if (event.content.startsWith('REFUSED')) return false;
      if (event.content.startsWith('LOOSE')) return 'nope';
      return true;
    }) as unknown as Verifier;
    const live = request(gate, { live: true, reqIdBase: 'vg1' });
    const backward = await live.subId('b');
    const forward = await live.subId('f');
    // The forward leg is open from the start, so a relay can answer on it
    // while the backlog is still being read: a pair there too, before the EOSE.
    respondWithEvent(live.server, forward, fakeEvent({ content: 'REFUSED-early' }));
    respondWithEvent(live.server, forward, fakeEvent({ content: 'genuine-early' }));
    await vi.waitFor(() => expect(handed).toHaveLength(2), { timeout: 2000 });
    respondWithEvent(live.server, backward, fakeEvent({ content: 'REFUSED-backward' }));
    respondWithEvent(live.server, backward, fakeEvent({ content: 'LOOSE-backward' }));
    respondWithEvent(live.server, backward, fakeEvent({ content: 'genuine-backward' }));
    respondWithEose(live.server, backward);
    await vi.waitFor(() => expect(shape(live.chunks), 'the backlog settled').toContain('settled'), {
      timeout: 3000
    });
    respondWithEvent(live.server, forward, fakeEvent({ content: 'REFUSED-forward' }));
    respondWithEvent(live.server, forward, fakeEvent({ content: 'LOOSE-forward' }));
    respondWithEvent(live.server, forward, fakeEvent({ content: 'genuine-forward' }));
    // What is waited for is the verifier being asked, not something being
    // delivered: a mutation that drops an event has to reach the assertion
    // below rather than the wait.
    await vi.waitFor(() => expect(handed).toHaveLength(8), { timeout: 2000 });
    await settle(50);
    await live.stop();

    // **The premise**: every event the relay sent reached the gate, the
    // refused ones included. So nothing before it — the client's own check
    // among them — dropped them, and the refusal measured is the gate's.
    expect(handed, 'the gate was handed every event, on both legs').toEqual([
      'REFUSED-early',
      'genuine-early',
      'REFUSED-backward',
      'LOOSE-backward',
      'genuine-backward',
      'REFUSED-forward',
      'LOOSE-forward',
      'genuine-forward'
    ]);
    // In the order they reached the gate: the early forward one before the
    // backlog's, and the backlog's before the outcome.
    expect(
      [shape(live.chunks), contents(live.chunks)],
      'only the genuine events are handed over, from each leg and in each state of the backlog'
    ).toEqual([
      ['event', 'event', 'settled', 'event'],
      ['genuine-early', 'genuine-backward', 'genuine-forward']
    ]);

    // **(B) Answers that are not `true`**, one request each, with `true` as the
    // control. All of them are run before any is read, so a mutation that
    // breaks one is measured against all of them. The cast is the point: a
    // verifier is a consumer's function, and at run time its answer is
    // whatever it returned.
    const answers = [
      ['a string', 'nope'],
      ['an object', { ok: false }],
      ['a number', 1],
      ['a list', ['yes']],
      ['nothing', undefined],
      ['the word true', 'true'],
      ['a boxed true', Object(true) as unknown],
      ['true', true]
    ] as const;
    const seen: { answer: string; delivered: string[]; ends: unknown[] }[] = [];
    for (const [index, [answer, value]] of answers.entries()) {
      const one = request((async () => value) as unknown as Verifier, {
        live: false,
        reqIdBase: `vg1-${String(index)}`
      });
      const backlog = await one.subId('b');
      respondWithEvent(one.server, backlog, fakeEvent({ content: `answered ${answer}` }));
      respondWithEose(one.server, backlog);
      await one.done;
      await one.stop();
      seen.push({ answer, delivered: contents(one.chunks), ends: endsOf(one.chunks) });
    }
    // Written out rather than derived from the list above, so the control
    // cannot leave the arm by leaving the list.
    expect(seen, 'only `true` delivers, and every request answered').toEqual([
      { answer: 'a string', delivered: [], ends: [{ kind: 'complete' }] },
      { answer: 'an object', delivered: [], ends: [{ kind: 'complete' }] },
      { answer: 'a number', delivered: [], ends: [{ kind: 'complete' }] },
      { answer: 'a list', delivered: [], ends: [{ kind: 'complete' }] },
      { answer: 'nothing', delivered: [], ends: [{ kind: 'complete' }] },
      { answer: 'the word true', delivered: [], ends: [{ kind: 'complete' }] },
      { answer: 'a boxed true', delivered: [], ends: [{ kind: 'complete' }] },
      { answer: 'true', delivered: ['answered true'], ends: [{ kind: 'complete' }] }
    ]);
  }, 30_000);

  // @contracts A-ε-C11
  it('VG2: a verifier that throws before it makes a Promise drops the event, ends complete, and leaves nothing uncaught', async () => {
    const escaped = escapes();
    try {
      // **The two positive controls**, without which an empty list below is
      // satisfied by a collector that hears nothing. A throw from a subscriber
      // of the capability the machine subscribes through, which is the exit a
      // synchronous throw used to take — and a rejection nobody handles, which
      // is the exit a rejection handler that rethrows would take.
      {
        const url = nextUrl();
        const { rxNostr, server } = createTestRelay(url);
        const subscription = permanentTransport(rxNostr)
          .use(createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'vg2-control' }), {
            on: { relays: [url] }
          })
          ?.subscribe({
            next: () => {
              throw new Error('nosvelte test: the thrown control');
            }
          });
        let control: string | undefined;
        await vi.waitFor(
          () => {
            control = (server.messages as unknown[][]).find((frame) => frame[0] === 'REQ')?.[1] as
              string | undefined;
            expect(control, 'the control asked the relay').toBeDefined();
          },
          { timeout: 2000 }
        );
        respondWithEvent(server, control as string, fakeEvent());
        await vi.waitFor(() => expect(escaped.seen).toHaveLength(1), { timeout: 2000 });
        subscription?.unsubscribe();
        rxNostr.dispose();
        void Promise.reject(new Error('nosvelte test: the rejected control'));
        await vi.waitFor(() => expect(escaped.seen).toHaveLength(2), { timeout: 2000 });
      }

      // **The verifier that throws synchronously**, which the parameter's type
      // admits; the one that rejects, which the shared handler is the exit of
      // too; and the one that never answers, which is this arm's control for
      // `complete`: the same single chunk, ended by being cut rather than by
      // emptying. Each is one event and an EOSE on the backward leg, and all of
      // them run before any is read.
      const verifiers: [string, Verifier][] = [
        [
          'throws',
          (): Promise<boolean> => {
            throw new Error('nosvelte test: thrown by the verifier');
          }
        ],
        [
          'rejects',
          async () => {
            throw new Error('nosvelte test: rejected by the verifier');
          }
        ],
        ['never answers', () => new Promise<boolean>(() => undefined)]
      ];
      // **The premise, asserted rather than assumed**: the first one throws
      // before it returns anything, which is what no `async` function can do.
      let returned: unknown = 'nothing: it threw';
      try {
        returned = (verifiers[0] as [string, Verifier])[1](fakeEvent());
      } catch {
        // Thrown where it was called, which is the point.
      }
      expect(returned, 'the premise: the first verifier throws where it is called').toBe(
        'nothing: it threw'
      );
      const results: { verifier: string; chunks: string[]; ends: unknown[] }[] = [];
      for (const [index, [verifier, verifyEvent]] of verifiers.entries()) {
        const one = request(verifyEvent, { live: false, reqIdBase: `vg2-${String(index)}` });
        const backlog = await one.subId('b');
        respondWithEvent(
          one.server,
          backlog,
          fakeEvent({ content: `held by a verifier that ${verifier}` })
        );
        respondWithEose(one.server, backlog);
        await one.done;
        await one.stop();
        results.push({ verifier, chunks: shape(one.chunks), ends: endsOf(one.chunks) });
      }
      // Long enough for an error reported on a timer, or a rejection reported
      // after the microtasks, to arrive while the collector is installed.
      await settle(100);

      expect(
        results,
        `the event is dropped and the outcome says how the wait ended; what escaped was ${JSON.stringify(escaped.seen)}`
      ).toEqual([
        { verifier: 'throws', chunks: ['settled'], ends: [{ kind: 'complete' }] },
        { verifier: 'rejects', chunks: ['settled'], ends: [{ kind: 'complete' }] },
        {
          verifier: 'never answers',
          chunks: ['settled'],
          ends: [{ kind: 'incomplete', causes: ['verification-timeout'], error: undefined }]
        }
      ]);
      expect(escaped.seen, 'nothing left uncaught but the two controls').toEqual([
        { channel: 'uncaughtException', message: 'nosvelte test: the thrown control' },
        { channel: 'unhandledRejection', message: 'nosvelte test: the rejected control' }
      ]);
    } finally {
      escaped.restore();
    }
  }, 30_000);
});
