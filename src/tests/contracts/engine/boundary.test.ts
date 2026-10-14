/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The boundary where an event off the wire becomes this library's own:
 * `A-ε-C15`'s landing, `WB1`.
 *
 * **The row is `internal`, because what it arranges is a verifier that records
 * what it was handed**, and the wire's own object held by the test so it can be
 * written to — neither of which a consumer has (0005, "Port route"). So the arm
 * drives the machine directly for most of it, a provider built with a verifier
 * of the test's own for the hook and the cache, and the boundary function
 * itself for the fields no request can reach.
 *
 * **The wire's object is the dependency's, and it is reached through `use`.**
 * The spike's `OW7` wrote to the test's own fixture after sending it, and the
 * mock relay serialises what it sends, so the client never held that object:
 * the write reached nothing, and the arm's final identity assertion was what
 * held the claim. Here `probed()` wraps the client's `use`, keeps each
 * delivered packet's own `event` — the object the dependency parsed, and the
 * one a write while the gate is open has to reach — and counts every read of
 * `event` after that, which is how "the gate is read before the copy" becomes
 * a number (`AE24`).
 *
 * **One arm, in parts that each run whatever the others did.** A landing has
 * to fail under a mutation of each clause, and a part that threw would
 * otherwise keep the parts after it from being measured at all; so each part
 * collects its own failure, and the arm fails on the list.
 *
 * Port band 9740-9759.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { createRxOneshotReq, type RxNostr } from 'rx-nostr';
import { map } from 'rxjs';
import { QueryClient } from 'tanstack-svelte-query-v6';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { NostrContext } from '$lib/v1/context.svelte.js';
import { isOwnedPacket, ownEvent } from '$lib/v1/event.js';
import type { CachedEventSet } from '$lib/v1/eventset.js';
import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import { referenceStream } from '$lib/v1/machine.js';
import { MAX_RELAY_MESSAGE_UNITS } from '$lib/v1/normalize.js';
import { createRelayScope } from '$lib/v1/scope.svelte.js';
import type { MachineChunk } from '$lib/v1/stream.js';
import { requestTargets } from '$lib/v1/stream.js';

import VerifiedRequest from './fixtures/VerifiedRequest.svelte';
import { escapes } from './helpers/escapes.js';
import { acceptAnyEvent, createTestRelay, fakeEvent, permanentTransport } from './helpers/relay.js';

// The provider in Part B reads the real context.
vi.unmock('svelte');

afterEach(() => {
  WS.clean();
  vi.unstubAllGlobals();
});

let port = 9740;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

const settle = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

type Verifier = (event: Nostr.Event) => Promise<boolean>;
type Wire = Record<string, unknown> & { tags: unknown[][] };

/**
 * A client whose `use` is the probe: every packet it delivers is kept by its
 * own `event` — the dependency's object — and every read of `event` downstream
 * of the probe is counted.
 */
function probed(url: string) {
  const { rxNostr, server } = createTestRelay(url);
  const received: Wire[] = [];
  const handedDown: unknown[] = [];
  let reads = 0;
  const use = rxNostr.use.bind(rxNostr);
  rxNostr.use = ((...args: Parameters<RxNostr['use']>) =>
    use(...args).pipe(
      map((packet) => {
        const own = packet.event;
        received.push(own as unknown as Wire);
        return Object.defineProperty({ ...packet }, 'event', {
          enumerable: true,
          get() {
            reads += 1;
            handedDown.push(own);
            return own;
          }
        });
      })
    )) as RxNostr['use'];
  return { url, rxNostr, server, received, handedDown, reads: (): number => reads };
}

/** One request through the machine over a probed relay, its chunks as they arrive. */
function machine(
  probe: ReturnType<typeof probed>,
  verifyEvent: Verifier,
  options: {
    live: boolean;
    reqIdBase: string;
    filters?: Nostr.Filter[];
    timeoutMs?: number;
  }
) {
  const transport = permanentTransport(probe.rxNostr);
  const scope = createRelayScope(probe.rxNostr, [probe.url]);
  const ac = new AbortController();
  const chunks: MachineChunk[] = [];
  const done = (async () => {
    for await (const chunk of referenceStream({
      transport,
      targets: requestTargets(transport, scope.current),
      filters: options.filters ?? [{ kinds: [1] }],
      live: options.live,
      reqIdBase: options.reqIdBase,
      signal: ac.signal,
      timeoutMs: options.timeoutMs ?? 3000,
      verifyEvent
    }))
      chunks.push(chunk);
  })();
  const subId = async (leg: 'b' | 'f'): Promise<string> => {
    let found: string | undefined;
    await vi.waitFor(
      () => {
        found = (probe.server.messages as unknown[][])
          .filter((frame) => frame[0] === 'REQ')
          .map((frame) => String(frame[1]))
          .find((id) => id.startsWith(`${options.reqIdBase}-${leg}:`));
        expect(found, `the relay was asked for the ${leg} leg`).toBeDefined();
      },
      { timeout: 2000 }
    );
    return found as string;
  };
  const stop = async (): Promise<void> => {
    ac.abort();
    await done;
    probe.rxNostr.dispose();
  };
  return { chunks, done, subId, stop };
}

const delivered = (chunks: readonly MachineChunk[]): unknown[] =>
  chunks.flatMap((chunk) => (chunk.type === 'event' ? [chunk.packet.event] : []));

const kindsOf = (chunks: readonly MachineChunk[]): string[] => chunks.map((chunk) => chunk.type);

/** What an event is, every field and every array, read as it stands. */
const viewOf = (value: unknown) => {
  const event = value as Wire;
  return {
    keys: Object.keys(event).sort(),
    fields: {
      id: event['id'],
      sig: event['sig'],
      kind: event['kind'],
      pubkey: event['pubkey'],
      content: event['content'],
      created_at: event['created_at'],
      ots: event['ots'],
      tags: event.tags.map((tag) => [...tag])
    },
    frozen: [
      Object.isFrozen(event),
      Object.isFrozen(event.tags),
      ...event.tags.map((tag) => Object.isFrozen(tag))
    ]
  };
};

/** A verifier that records, when it is called, what it was handed and how that stood. */
const recording = () => {
  const handed: { event: Nostr.Event; then: ReturnType<typeof viewOf> }[] = [];
  const verify: Verifier = async (event) => {
    handed.push({ event, then: viewOf(event) });
    return true;
  };
  return { handed, verify };
};

/**
 * A verifier that holds each event until the test releases it, and a log of
 * the order things happened in: entered, then whatever the test did, then
 * released.
 */
const holding = () => {
  const log: string[] = [];
  const waiting = new Map<string, (ok: boolean) => void>();
  const handed: Nostr.Event[] = [];
  const verify: Verifier = (event) => {
    handed.push(event);
    log.push(`entered:${event.content}`);
    return new Promise<boolean>((resolve) => waiting.set(event.content, resolve));
  };
  const release = (content: string): void => {
    log.push(`released:${content}`);
    waiting.get(content)?.(true);
  };
  return { log, handed, verify, release };
};

/** Write into the wire's object the way anything still holding it could, and say whether it took. */
const scribble = (wire: Wire, marker: string): boolean => {
  try {
    wire['content'] = marker;
    wire.tags.push(['t', marker]);
    (wire.tags[0] as unknown[]).push(marker);
  } catch {
    // A refusal is measured below, as a write that did not take.
  }
  return wire['content'] === marker;
};

/**
 * The packets the cache holds under every query of `client`, read off the cache
 * itself. Packets rather than events, because a packet is what only the cache
 * has: the hook publishes events, so a packet that `isOwnedPacket` answers for
 * is one that came from here.
 */
const cachedPackets = (client: QueryClient): unknown[] =>
  client
    .getQueryCache()
    .getAll()
    .flatMap((query) => {
      const data = query.state.data as Partial<CachedEventSet> | undefined;
      return data?.entries instanceof Map ? [...data.entries.values()] : [];
    });

/**
 * A relay message as the bound sees it: short text as itself, long text by
 * where it stands against the cap.
 */
const measured = (message: { text: string; truncated: boolean } | undefined): unknown =>
  message === undefined
    ? undefined
    : [
        message.truncated,
        message.text.length <= 100
          ? message.text
          : message.text.length === MAX_RELAY_MESSAGE_UNITS
            ? 'at the cap'
            : message.text.length < MAX_RELAY_MESSAGE_UNITS
              ? 'under the cap'
              : 'over the cap'
      ];

const LIVE: ReqPlan = {
  kind: 'request',
  descriptor: { filters: [{ kinds: [1] }], live: true, retain: 'unbounded', settleTimeoutMs: 2000 }
};

describe('the boundary where an event off the wire becomes this library’s own', () => {
  // @contracts A-ε-C15
  it('WB1: what is verified is the copy that is stored, taken first, of a value that was an event, read once', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
    const failures: string[] = [];
    const failed: string[] = [];
    const part = async (name: string, body: () => Promise<void> | void): Promise<void> => {
      try {
        await body();
      } catch (error) {
        failed.push(name);
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const escaped = escapes();
    try {
      // **The collector's positive controls**, one per channel, while it is
      // installed: a throw from a subscriber of the capability the machine
      // subscribes through, and a rejection nothing handles.
      await part('the collector hears a throw and a rejection', async () => {
        const url = nextUrl();
        const { rxNostr, server } = createTestRelay(url);
        const subscription = permanentTransport(rxNostr)
          .use(createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'wb1-control' }), {
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
        server.send(['EVENT', control, fakeEvent()]);
        await vi.waitFor(() => expect(escaped.seen).toHaveLength(1), { timeout: 2000 });
        subscription?.unsubscribe();
        rxNostr.dispose();
        void Promise.reject(new Error('nosvelte test: the rejected control'));
        await vi.waitFor(() => expect(escaped.seen).toHaveLength(2), { timeout: 2000 });
      });

      // **Part A, the copy (T1, T4)**, on both legs: what the verifier is handed
      // is this library's copy — not the wire's object, every field the
      // wire's, every array frozen when the verifier is called — and is the
      // object the machine hands on; the wire's object is left unfrozen, and
      // a write to it afterwards reaches nothing of ours.
      await part('A: the copy, on each leg', async () => {
        const probe = probed(nextUrl());
        const verifier = recording();
        const request = machine(probe, verifier.verify, { live: true, reqIdBase: 'wb1-a' });
        const backward = await request.subId('b');
        const forward = await request.subId('f');
        probe.server.send([
          'EVENT',
          backward,
          {
            ...fakeEvent({
              content: 'copied-backward',
              tags: [
                ['t', 'b'],
                ['p', 'x']
              ]
            }),
            ots: 'proof'
          }
        ]);
        probe.server.send(['EOSE', backward]);
        await vi.waitFor(() => expect(kindsOf(request.chunks)).toContain('settled'), {
          timeout: 3000
        });
        probe.server.send([
          'EVENT',
          forward,
          fakeEvent({ content: 'copied-forward', tags: [['t', 'f']] })
        ]);
        await vi.waitFor(() => expect(verifier.handed).toHaveLength(2), { timeout: 2000 });
        await settle(50);
        await request.stop();

        const wire = probe.received;
        expect(wire, 'the premise: the dependency delivered both').toHaveLength(2);
        expect(
          wire.map((object) => probe.handedDown.includes(object)),
          'the premise: what the probe keeps is the object the library was handed'
        ).toEqual([true, true]);
        const wireThen = wire.map(viewOf);
        expect(
          verifier.handed.map(({ event, then }, index) => ({
            ours: event !== (wire[index] as unknown),
            keys: then.keys,
            fields: then.fields,
            frozen: then.frozen
          })),
          'the verifier was handed a frozen copy of every field, on each leg'
        ).toEqual(
          wireThen.map((view) => ({
            ours: true,
            keys: view.keys,
            fields: view.fields,
            frozen: view.frozen.map(() => true)
          }))
        );
        expect(
          wireThen.map((view) => view.keys.includes('ots')),
          'the premise: one carried `ots` and one did not'
        ).toEqual([true, false]);
        const handedOn = delivered(request.chunks);
        expect(
          handedOn.map((event, index) => event === verifier.handed[index]?.event),
          'what the machine hands on is what the verifier was handed'
        ).toEqual([true, true]);
        expect(
          wireThen.map((view) => view.frozen),
          'the dependency’s object is not frozen by this library, at any depth'
        ).toEqual(wireThen.map((view) => view.frozen.map(() => false)));
        expect(
          wire.map((object, index) => scribble(object, `written-afterwards-${String(index)}`)),
          'the premise: a write to the dependency’s object takes'
        ).toEqual([true, true]);
        expect(
          handedOn.map((event) => viewOf(event).fields),
          'and it reaches nothing of ours'
        ).toEqual(wireThen.map((view) => view.fields));
      });

      // **Part A, the order (T3)**, on both legs: the copy is taken before the
      // verifier is called, so the wire's object written to while the gate is
      // held does not move what is handed on.
      await part('A: written while the gate is held', async () => {
        const probe = probed(nextUrl());
        const verifier = holding();
        const request = machine(probe, verifier.verify, { live: true, reqIdBase: 'wb1-t3' });
        const backward = await request.subId('b');
        const forward = await request.subId('f');
        const hold = async (subId: string, content: string): Promise<void> => {
          probe.server.send(['EVENT', subId, fakeEvent({ content, tags: [['t', content]] })]);
          await vi.waitFor(() => expect(verifier.log).toContain(`entered:${content}`), {
            timeout: 2000
          });
          const wire = probe.received[probe.received.length - 1] as Wire;
          if (scribble(wire, `changed-${content}`)) verifier.log.push(`written:${content}`);
          verifier.release(content);
        };
        await hold(backward, 'held-backward');
        probe.server.send(['EOSE', backward]);
        await vi.waitFor(() => expect(kindsOf(request.chunks)).toContain('settled'), {
          timeout: 3000
        });
        await hold(forward, 'held-forward');
        await vi.waitFor(() => expect(kindsOf(request.chunks)).toHaveLength(3), {
          timeout: 2000
        });
        await request.stop();

        expect(
          probe.received.map((object) => probe.handedDown.includes(object)),
          'the premise: what was written to is the object the library was handed'
        ).toEqual([true, true]);
        expect(verifier.log, 'entered, written, then released, on each leg').toEqual([
          'entered:held-backward',
          'written:held-backward',
          'released:held-backward',
          'entered:held-forward',
          'written:held-forward',
          'released:held-forward'
        ]);
        const handedOn = delivered(request.chunks);
        expect(
          handedOn.map((event) => {
            const view = viewOf(event).fields;
            return [view.content, view.tags];
          }),
          'what is handed on is what the gate was holding'
        ).toEqual([
          ['held-backward', [['t', 'held-backward']]],
          ['held-forward', [['t', 'held-forward']]]
        ]);
        expect(
          handedOn.map((event, index) => event === verifier.handed[index]),
          'and it is the object the verifier was handed'
        ).toEqual([true, true]);
      });

      // **Part A, the gate before the copy (T9).** A held verifier keeps the
      // backward subscription open past the timer that draws the boundary, so a
      // candidate the relay offers after it reaches the probe — and is not read.
      await part('A: past the boundary, nothing is read', async () => {
        const probe = probed(nextUrl());
        const verifier = holding();
        const request = machine(probe, verifier.verify, {
          live: false,
          reqIdBase: 'wb1-t9',
          timeoutMs: 150
        });
        const backward = await request.subId('b');
        probe.server.send(['EVENT', backward, fakeEvent({ content: 'before-the-boundary' })]);
        await vi.waitFor(() => expect(verifier.log).toContain('entered:before-the-boundary'), {
          timeout: 2000
        });
        const readsWhenAdmitted = probe.reads();
        await settle(250);
        probe.server.send(['EVENT', backward, fakeEvent({ content: 'past-the-boundary' })]);
        await vi.waitFor(() => expect(probe.received).toHaveLength(2), { timeout: 2000 });
        await settle(80);
        const readsAfterLate = probe.reads();
        verifier.release('before-the-boundary');
        await vi.waitFor(() => expect(kindsOf(request.chunks)).toContain('settled'), {
          timeout: 5000
        });
        await request.stop();

        expect(
          [readsWhenAdmitted > 0, readsAfterLate - readsWhenAdmitted, verifier.log],
          'an admitted candidate is read; one past the boundary is not read or verified'
        ).toEqual([true, 0, ['entered:before-the-boundary', 'released:before-the-boundary']]);
      });

      // **Part B, the hook and the cache (T2)**, on both legs, through a
      // provider whose verifier records: the object the hook publishes, and the
      // one the provider's cache holds, are the verifier's.
      await part('B: the hook and the cache hold what was verified', async () => {
        // The reader's positive control: it answers from the cache it is given.
        const sentinel = Object.freeze({ event: Object.freeze({ id: 'the cache’s own' }) });
        const control = new QueryClient();
        control.setQueryData(['wb1-control'], { entries: new Map([['k', sentinel]]) });
        expect(cachedPackets(control), 'the premise: the reader reads the cache').toEqual([
          sentinel
        ]);

        const url = nextUrl();
        const server = new WS(url, { jsonProtocol: true });
        const verifier = recording();
        let handle: ReqHandle | undefined;
        let context: NostrContext | undefined;
        const view = render(VerifiedRequest, {
          relays: [url],
          verifyEvent: verifier.verify,
          plan: () => LIVE,
          request: (held: ReqHandle) => {
            handle = held;
          },
          seen: (made: NostrContext) => {
            context = made;
          }
        });
        let ids: string[] = [];
        await vi.waitFor(
          () => {
            ids = (server.messages as unknown[][])
              .filter((frame) => frame[0] === 'REQ')
              .map((frame) => String(frame[1]));
            expect(ids.length, 'the request asked the relay for both legs').toBeGreaterThanOrEqual(
              2
            );
          },
          { timeout: 3000 }
        );
        const backward = ids.find((id) => id.includes('-b:')) as string;
        const forward = ids.find((id) => id.includes('-f:')) as string;
        server.send(['EVENT', backward, fakeEvent({ id: 'wb1-b-backward', created_at: 1 })]);
        server.send(['EOSE', backward]);
        await vi.waitFor(() => expect(handle?.state.status).not.toBe('loading'), {
          timeout: 3000
        });
        server.send(['EVENT', forward, fakeEvent({ id: 'wb1-b-forward', created_at: 2 })]);
        await vi.waitFor(() => expect(verifier.handed).toHaveLength(2), { timeout: 2000 });
        await settle(150);

        const published =
          handle === undefined || handle.state.status === 'loading' ? [] : handle.state.events;
        const cached = context === undefined ? [] : cachedPackets(context.client);
        const byId = (events: readonly unknown[], id: string): unknown =>
          events.find((event) => (event as { id: string }).id === id);
        const packetOf = (id: string): unknown =>
          cached.find((packet) => (packet as { event: { id: string } }).event.id === id);
        expect(
          ['wb1-b-backward', 'wb1-b-forward'].map((id) => {
            const verified = verifier.handed.find(({ event }) => event.id === id)?.event;
            const packet = packetOf(id);
            return [
              verified !== undefined,
              byId(published, id) === verified,
              isOwnedPacket(packet),
              (packet as { event?: unknown } | undefined)?.event === verified
            ];
          }),
          'the hook publishes, and the cache holds in a packet of its own, the verifier’s object, on each leg'
        ).toEqual([
          [true, true, true, true],
          [true, true, true, true]
        ]);
        view.unmount();
      });

      // **Part C, a candidate that is not an event (T5).** On a live request
      // that asks for everything — internal, since a published descriptor
      // requires `kinds`, and with `kinds` the dependency drops a candidate
      // with no number there before this library sees it — each malformed
      // EVENT is followed by a well-formed one and the EOSE.
      await part('C: a malformed candidate is dropped and nothing else is', async () => {
        const wireish = (over: Record<string, unknown>): Record<string, unknown> => ({
          ...fakeEvent({ content: 'malformed' }),
          ...over
        });
        const shapes: readonly (readonly [string, unknown])[] = [
          ['tags that are null', wireish({ tags: null })],
          ['a tag that is not a list', wireish({ tags: [['t', 'ok'], 'nope'] })],
          ['a tag element that is not a string', wireish({ tags: [['t', 7]] })],
          ['a missing scalar', wireish({ id: undefined })],
          ['an ots that is not a string', wireish({ ots: 7 })],
          ['not an object', 'EVENT?']
        ];
        expect(
          shapes.filter(([, value]) => ownEvent(JSON.parse(JSON.stringify(value))) !== undefined),
          'the premise: the boundary refuses each, called directly'
        ).toEqual([]);
        const rows: unknown[] = [];
        for (const [index, [name, malformed]] of shapes.entries()) {
          const probe = probed(nextUrl());
          let calls = 0;
          const request = machine(
            probe,
            async () => {
              calls += 1;
              return true;
            },
            { live: true, reqIdBase: `wb1-c${String(index)}`, filters: [{}] }
          );
          const backward = await request.subId('b');
          probe.server.send(['EVENT', backward, malformed]);
          await vi.waitFor(() => expect(probe.received, name).toHaveLength(1), {
            timeout: 2000
          });
          probe.server.send(['EVENT', backward, fakeEvent({ content: `after-${name}` })]);
          await vi.waitFor(() => expect(probe.received, name).toHaveLength(2), {
            timeout: 2000
          });
          probe.server.send(['EOSE', backward]);
          await vi.waitFor(() => expect(kindsOf(request.chunks), name).toContain('settled'), {
            timeout: 5000
          });
          await settle(30);
          await request.stop();
          rows.push({
            name,
            verified: calls,
            delivered: delivered(request.chunks).map(
              (event) => (event as { content: string }).content
            ),
            ends: request.chunks.flatMap((chunk) => (chunk.type === 'settled' ? [chunk.end] : []))
          });
        }
        expect(rows, 'dropped, not verified; the next event arrives and the EOSE settles').toEqual(
          shapes.map(([name]) => ({
            name,
            verified: 1,
            delivered: [`after-${name}`],
            ends: [{ kind: 'complete' }]
          }))
        );
      });

      // **Part D, the packets that are not events (T6, T8), at the machine.**
      // A `CLOSED` nothing can attribute, then one whose reason is not text:
      // the first is ignored and the second is a refusal, rendered. Then the
      // two bounds, each on a request of its own since a `CLOSED` ends it.
      await part('D: a CLOSED that is not what the protocol says', async () => {
        const closing = async (reason: unknown, unattributed: boolean): Promise<MachineChunk[]> => {
          const probe = probed(nextUrl());
          const request = machine(probe, acceptAnyEvent, {
            live: true,
            reqIdBase: `wb1-d${String(port)}`,
            timeoutMs: 1000
          });
          const backward = await request.subId('b');
          if (unattributed) probe.server.send(['CLOSED', 7, 'rate-limited: no']);
          probe.server.send(['CLOSED', backward, reason]);
          // The outcome, which arrives either way — by the refusal, or by the
          // timer when the refusal was lost — and then what it says.
          await vi.waitFor(() => expect(kindsOf(request.chunks)).toContain('settled'), {
            timeout: 3000
          });
          await settle(100);
          await request.stop();
          return request.chunks;
        };
        const refusalsOf = (chunks: readonly MachineChunk[]) =>
          chunks.flatMap((chunk) =>
            chunk.type === 'refused'
              ? [{ leg: chunk.refusal.leg, notice: chunk.refusal.notice }]
              : []
          );
        const object = await closing({ why: 'an object' }, true);
        const longText = await closing('x'.repeat(10_000), false);
        const longObject = await closing({ detail: 'x'.repeat(10_000) }, false);
        expect(
          [
            refusalsOf(object).map(({ leg, notice }) => [leg, measured(notice)]),
            object.some((chunk) => chunk.type === 'settled'),
            refusalsOf(longText).map(({ notice }) => measured(notice)),
            refusalsOf(longObject).map(({ notice }) => measured(notice))
          ],
          'one refusal, rendered, and an outcome; then each bound, and the flag that says so'
        ).toEqual([
          [['backward', [false, '{"why":"an object"}']]],
          true,
          [[true, 'at the cap']],
          [[true, 'under the cap']]
        ]);
      });

      // **Part D, a NOTICE (T7, T8), through the provider's diagnostics.** Each
      // stage is read before the next is sent.
      await part('D: a NOTICE that is not text', async () => {
        const url = nextUrl();
        const server = new WS(url, { jsonProtocol: true });
        let context: NostrContext | undefined;
        const view = render(VerifiedRequest, {
          relays: [url],
          verifyEvent: acceptAnyEvent,
          plan: () => LIVE,
          request: () => undefined,
          seen: (made: NostrContext) => {
            context = made;
          }
        });
        await vi.waitFor(
          () =>
            expect((server.messages as unknown[][]).some((frame) => frame[0] === 'REQ')).toBe(true),
          { timeout: 3000 }
        );
        const lastNotice = () => Object.values(context?.diagnostics.relays ?? {})[0]?.lastNotice;
        const seen: unknown[] = [];
        for (const body of [
          { why: 'an object' },
          'and now a string',
          'x'.repeat(10_000),
          { detail: 'x'.repeat(10_000) }
        ]) {
          const before = lastNotice();
          server.send(['NOTICE', body]);
          await vi.waitFor(() => expect(lastNotice()).not.toBe(before), { timeout: 2000 });
          seen.push(measured(lastNotice()));
        }
        view.unmount();
        expect(seen, 'rendered, bounded, and the next one read too').toEqual([
          [false, '{"why":"an object"}'],
          [false, 'and now a string'],
          [true, 'at the cap'],
          [true, 'under the cap']
        ]);
      });

      // **Part E, the boundary called directly (T5's unreachable fields, T10).**
      // What it returns is a snapshot, not an observation of the cache.
      await part('E: every field refused, and each read once', () => {
        const wire = (over: Record<string, unknown>): unknown => ({
          ...fakeEvent({ content: 'direct' }),
          ...over
        });
        const refused: readonly (readonly [string, unknown])[] = [
          ['no id', wire({ id: undefined })],
          ['an id that is not a string', wire({ id: 7 })],
          ['no sig', wire({ sig: undefined })],
          ['no pubkey', wire({ pubkey: null })],
          ['content that is not a string', wire({ content: { toString: () => 'x' } })],
          ['a kind that is not a number', wire({ kind: '1' })],
          ['a kind that is not finite', wire({ kind: Number.NaN })],
          ['a created_at that is not a number', wire({ created_at: '1' })],
          ['a created_at that is not finite', wire({ created_at: Number.POSITIVE_INFINITY })],
          ['an ots that is not a string', wire({ ots: 7 })],
          ['tags that are null', wire({ tags: null })],
          ['tags that are not a list', wire({ tags: { length: 0 } })],
          ['a tag that is not a list', wire({ tags: ['t'] })],
          ['a tag element that is not a string', wire({ tags: [['t', 7]] })],
          ['not an object', 'EVENT?'],
          ['null', null],
          ['undefined', undefined]
        ];
        expect(
          refused.filter(([, value]) => ownEvent(value) !== undefined).map(([name]) => name),
          'each malformed field is refused'
        ).toEqual([]);
        // The control: a well-formed event, with and without `ots`, and with an
        // empty tag, comes back as a copy.
        expect(
          [
            (ownEvent(wire({})) as { content?: string } | undefined)?.content,
            (ownEvent(wire({ ots: 'proof' })) as { ots?: string } | undefined)?.ots,
            ownEvent(wire({ tags: [['t', 'ok'], []] }))?.tags
          ],
          'a well-formed one is copied'
        ).toEqual(['direct', 'proof', [['t', 'ok'], []]]);

        // **Read once.** Each of these answers differently the second time it
        // is asked, which a fresh object shows first.
        const shifty = () => {
          let idReads = 0;
          let tagReads = 0;
          let harmReads = 0;
          let walks = 0;
          const walked = [['t', 'ok']];
          Object.defineProperty(walked[0], 1, {
            enumerable: true,
            get() {
              walks += 1;
              return walks === 1 ? 'ok' : null;
            }
          });
          return {
            id: {
              ...(wire({}) as object),
              get id(): unknown {
                idReads += 1;
                return idReads === 1 ? 'the-checked-id' : 'somebody-elses-id';
              }
            },
            tags: {
              ...(wire({}) as object),
              get tags(): unknown {
                tagReads += 1;
                return tagReads === 1 ? [['t', 'ok']] : [['t', 'somebody elses']];
              }
            },
            harm: {
              ...(wire({}) as object),
              get tags(): unknown {
                harmReads += 1;
                return harmReads === 1 ? [['t', 'ok']] : [['t', null]];
              }
            },
            walked: wire({ tags: walked }),
            reads: () => [idReads, tagReads, harmReads, walks]
          };
        };
        const premise = shifty();
        const twice = (read: () => unknown): boolean =>
          JSON.stringify(read()) !== JSON.stringify(read());
        expect(
          [
            twice(() => (premise.id as { id: unknown }).id),
            twice(() => (premise.tags as { tags: unknown }).tags),
            twice(() => (premise.harm as { tags: unknown }).tags),
            twice(() => ((premise.walked as { tags: unknown[][] }).tags[0] as unknown[])[1])
          ],
          'the premise: each answers differently the second time'
        ).toEqual([true, true, true, true]);
        const fresh = shifty();
        const kept = [
          ownEvent(fresh.id)?.id,
          ownEvent(fresh.tags)?.tags,
          ownEvent(fresh.harm)?.tags,
          ownEvent(fresh.walked)?.tags
        ];
        expect(
          [kept, fresh.reads()],
          'the answer that was checked is the one kept, each asked once'
        ).toEqual([
          ['the-checked-id', [['t', 'ok']], [['t', 'ok']], [['t', 'ok']]],
          [1, 1, 1, 1]
        ]);
      });

      // Long enough for an error reported on a timer, or a rejection reported
      // after the microtasks, to arrive while the collector listens.
      await settle(100);
    } finally {
      escaped.restore();
    }
    // The parts that failed, by name, on the line a ledger reports.
    expect(failures, `every part of the row holds; failed: ${failed.join(', ')}`).toEqual([]);
    expect(escaped.seen, 'nothing left uncaught but the two controls').toEqual([
      { channel: 'uncaughtException', message: 'nosvelte test: the thrown control' },
      { channel: 'unhandledRejection', message: 'nosvelte test: the rejected control' }
    ]);
  }, 60_000);
});
