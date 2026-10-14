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
 * of the test's own for the hook, the cache, the filters a request is made with
 * and the provider's diagnostics, and the boundary function itself for values
 * no relay can send as JSON and for candidates that answer twice.
 *
 * **The wire's object is the dependency's, and it is reached through `use`.**
 * The spike's `OW7` wrote to the test's own fixture after sending it, and the
 * mock relay serialises what it sends, so the client never held that object:
 * the write reached nothing, and the arm's final identity assertion was what
 * held the claim. Here `probed()` wraps the client's `use`, keeps each
 * delivered packet's own `event` — the object the dependency parsed, and the
 * one a write while the gate is open has to reach — with its fields as they
 * stood when it was delivered, and counts every read of each packet after
 * that, per packet, which is how "the gate is read before the copy" becomes a
 * number (`AE24`).
 *
 * **One arm, in parts that each run whatever the others did.** A landing has
 * to fail under a mutation of each clause, and a part that threw would
 * otherwise keep the parts after it from being measured at all; so each part
 * collects its own failure, and the arm fails on the list. Each part also says
 * it ran to its end, so a part that did not run at all is a failure too.
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
import { MAX_RELAY_MESSAGE_UNITS, MAX_RENDERED } from '$lib/v1/normalize.js';
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

/** An event's fields, or `undefined` for a value whose shape will not read. */
const fieldsOf = (value: unknown): unknown => {
  try {
    return viewOf(value).fields;
  } catch {
    return undefined;
  }
};

/**
 * A client whose `use` is the probe: every packet it delivers is kept by its
 * own `event` — the dependency's object — with that event's fields as they
 * stood when it was delivered, before anything downstream ran; and every read
 * of each delivered packet, of any property, is counted against it.
 */
function probed(url: string) {
  const { rxNostr, server } = createTestRelay(url);
  const received: Wire[] = [];
  const asDelivered: unknown[] = [];
  const handedDown: unknown[] = [];
  const packets: object[] = [];
  const reads = new Map<unknown, number>();
  const use = rxNostr.use.bind(rxNostr);
  rxNostr.use = ((...args: Parameters<RxNostr['use']>) =>
    use(...args).pipe(
      map((packet) => {
        const own = packet.event;
        received.push(own as unknown as Wire);
        asDelivered.push(fieldsOf(own));
        const counted = new Proxy(packet, {
          get(target, key, receiver) {
            reads.set(own, (reads.get(own) ?? 0) + 1);
            if (key === 'event') handedDown.push(own);
            return Reflect.get(target, key, receiver) as unknown;
          }
        });
        packets.push(counted);
        return counted;
      })
    )) as RxNostr['use'];
  return {
    url,
    rxNostr,
    server,
    received,
    asDelivered,
    handedDown,
    packets,
    readsOf: (event: unknown): number => reads.get(event) ?? 0
  };
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

/** At each depth of an event — itself, its tag list, each tag — whether it is frozen, sealed and extensible. */
const integrityOf = (value: unknown) => {
  const event = value as Wire;
  return [event, event.tags, ...event.tags].map((object) => [
    Object.isFrozen(object),
    Object.isSealed(object),
    Object.isExtensible(object)
  ]);
};

/** The fields a copy carries: NIP-01's seven, and `ots` when the wire had one. */
const copiedKeys = (wire: unknown): string[] =>
  ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags', 'ots']
    .filter((key) => key !== 'ots' || 'ots' in (wire as object))
    .sort();

/**
 * A verifier that records, when it is called, what it was handed and how that
 * stood — the call first, so a candidate whose shape will not read is still
 * counted as verified.
 */
const recording = () => {
  const handed: { event: Nostr.Event; then?: ReturnType<typeof viewOf> }[] = [];
  const verify: Verifier = async (event) => {
    const record: { event: Nostr.Event; then?: ReturnType<typeof viewOf> } = { event };
    handed.push(record);
    try {
      record.then = viewOf(event);
    } catch {
      // What it was handed did not read; the assertions say whether it should.
    }
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

/**
 * Write into the wire's object the way anything still holding it could — a
 * field, the tag list, a tag — and say, for each, whether it took.
 */
const scribble = (wire: Wire, marker: string): boolean[] => {
  const tags = wire.tags.length;
  const tag = (wire.tags[0] as unknown[]).length;
  for (const write of [
    () => {
      wire['content'] = marker;
    },
    () => wire.tags.push(['t', marker]),
    () => (wire.tags[0] as unknown[]).push(marker)
  ])
    try {
      write();
    } catch {
      // A refusal is measured below, as a write that did not take.
    }
  return [
    wire['content'] === marker,
    wire.tags.length === tags + 1,
    (wire.tags[0] as unknown[]).length === tag + 1
  ];
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

/** The longest a value that is not text renders to: the inner bound, and its marker. */
const INNER_BOUND = MAX_RENDERED + '… (cut)'.length;

/**
 * A relay message as the bounds see it: short text as itself, long text by
 * where it stands — at the outer cap, within the inner rendering's bound, or
 * neither.
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
            : message.text.length <= INNER_BOUND
              ? 'within the inner bound'
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
    // Pushed by each part's own body as its last line, so a part the runner
    // never ran is missing here rather than silently green.
    const ran: string[] = [];
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
        ran.push('controls');
      });

      // **Part A, the copy (T1, T4)**, on both legs: what the verifier is handed
      // is this library's copy — not the wire's object; every field the wire
      // delivered, and no field NIP-01 does not name; every array frozen when
      // the verifier is called — and is the object the machine hands on. The
      // wire's object is left as it was, at every depth, and a write to it
      // afterwards takes, and reaches nothing of ours.
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
            ots: 'proof',
            extra: { nested: ['x'] }
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
        expect(
          [
            wire.length,
            wire.map((object) => probe.handedDown.includes(object)),
            wire.map((object) => ['ots', 'extra'].map((key) => key in object))
          ],
          'the premise: both delivered, and handed to the library as they were kept; one with `ots` and a field NIP-01 does not name'
        ).toEqual([
          2,
          [true, true],
          [
            [true, true],
            [false, false]
          ]
        ]);
        expect(
          verifier.handed.map(({ event, then }, index) => ({
            ours: event !== (wire[index] as unknown),
            keys: then?.keys,
            fields: then?.fields,
            frozen: then?.frozen
          })),
          'the verifier was handed a frozen copy of the event as delivered, on each leg'
        ).toEqual(
          wire.map((object, index) => ({
            ours: true,
            keys: copiedKeys(object),
            fields: probe.asDelivered[index],
            frozen: viewOf(object).frozen.map(() => true)
          }))
        );
        const handedOn = delivered(request.chunks);
        expect(
          handedOn.map((event, index) => event === verifier.handed[index]?.event),
          'what the machine hands on is what the verifier was handed'
        ).toEqual([true, true]);
        expect(
          wire.map(integrityOf),
          'the dependency’s object is not frozen, sealed or closed by this library, at any depth'
        ).toEqual(wire.map((object) => integrityOf(object).map(() => [false, false, true])));
        expect(
          wire.map((object, index) => scribble(object, `written-afterwards-${String(index)}`)),
          'the premise: each write to the dependency’s object takes'
        ).toEqual([
          [true, true, true],
          [true, true, true]
        ]);
        expect(
          handedOn.map((event) => viewOf(event).fields),
          'and it reaches nothing of ours'
        ).toEqual(probe.asDelivered);
        ran.push('A-copy');
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
          if (scribble(wire, `changed-${content}`).every(Boolean))
            verifier.log.push(`written:${content}`);
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
        ran.push('A-order');
      });

      // **Part A, the gate before the copy (T9).** A held verifier keeps the
      // backward subscription open past the timer that draws the boundary, so a
      // candidate the relay offers after it reaches the probe — and is not read
      // at all. The reads are counted per packet, of any property.
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
        await settle(250);
        probe.server.send(['EVENT', backward, fakeEvent({ content: 'past-the-boundary' })]);
        await vi.waitFor(() => expect(probe.received).toHaveLength(2), { timeout: 2000 });
        await settle(80);
        const [before, past] = probe.received;
        const counted = [probe.readsOf(before), probe.readsOf(past)];
        verifier.release('before-the-boundary');
        await vi.waitFor(() => expect(kindsOf(request.chunks)).toContain('settled'), {
          timeout: 5000
        });
        await request.stop();
        // **The counter's own control**: two more reads of the admitted packet
        // are two more on its count, so it counts rather than marks.
        const was = probe.readsOf(before);
        const packet = probe.packets[0] as { event: unknown };
        void packet.event;
        void packet.event;

        expect(
          [counted[0] !== undefined && counted[0] > 0, counted[1], probe.readsOf(before) - was],
          'an admitted candidate is read; one past the boundary is not read at all; the counter counts'
        ).toEqual([true, 0, 2]);
        expect(verifier.log, 'and only the admitted one was verified').toEqual([
          'entered:before-the-boundary',
          'released:before-the-boundary'
        ]);
        ran.push('A-gate');
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
        ran.push('B');
      });

      // **Part C, a candidate that is not an event (T5)**, on both legs. On a
      // live request that asks for everything, each malformed EVENT is followed
      // by a well-formed one, on the backward leg before the EOSE and on the
      // forward leg after it. A filter that names nothing is what lets every
      // shape reach the boundary through a client that still matches before
      // delivering, as this one does; the provider's does not (Part F).
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
        // **The premise is recorded, not asserted first**, so a boundary that
        // throws when it is called directly does not keep the wire half below
        // from being measured.
        const directly = (value: unknown): string => {
          try {
            return ownEvent(JSON.parse(JSON.stringify(value))) === undefined ? 'refused' : 'copied';
          } catch {
            return 'threw';
          }
        };
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
          const forward = await request.subId('f');
          const offer = async (subId: string, event: unknown, count: number): Promise<void> => {
            probe.server.send(['EVENT', subId, event]);
            await vi.waitFor(() => expect(probe.received, name).toHaveLength(count), {
              timeout: 2000
            });
          };
          await offer(backward, malformed, 1);
          await offer(backward, fakeEvent({ content: `backward-${name}` }), 2);
          probe.server.send(['EOSE', backward]);
          await vi.waitFor(() => expect(kindsOf(request.chunks), name).toContain('settled'), {
            timeout: 5000
          });
          await offer(forward, malformed, 3);
          await offer(forward, fakeEvent({ content: `forward-${name}` }), 4);
          await settle(30);
          await request.stop();
          rows.push({
            name,
            directly: directly(malformed),
            verified: calls,
            delivered: delivered(request.chunks).map(
              (event) => (event as { content: string }).content
            ),
            ends: request.chunks.flatMap((chunk) => (chunk.type === 'settled' ? [chunk.end] : []))
          });
        }
        expect(
          rows,
          'refused; dropped on each leg, not verified; the next event arrives and the EOSE settles'
        ).toEqual(
          shapes.map(([name]) => ({
            name,
            directly: 'refused',
            verified: 2,
            delivered: [`backward-${name}`, `forward-${name}`],
            ends: [{ kind: 'complete' }]
          }))
        );
        ran.push('C');
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
          // A subId that is not a string — a list holding this request's own,
          // so a seam that turned it into text would attribute it.
          if (unattributed) probe.server.send(['CLOSED', [backward], 'rate-limited: no']);
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
        const endsOf = (chunks: readonly MachineChunk[]) =>
          chunks.flatMap((chunk) => (chunk.type === 'settled' ? [chunk.end] : []));
        expect(
          [object, longText, longObject].map((chunks) => ({
            refusals: refusalsOf(chunks).map(({ leg, notice }) => [leg, measured(notice)]),
            ends: endsOf(chunks)
          })),
          'one refusal each, rendered within each bound, with the flag that says so — and the backlog answered by it rather than by the timer'
        ).toEqual([
          {
            refusals: [['backward', [false, '{"why":"an object"}']]],
            ends: [{ kind: 'complete' }]
          },
          { refusals: [['backward', [true, 'at the cap']]], ends: [{ kind: 'complete' }] },
          {
            refusals: [['backward', [true, 'within the inner bound']]],
            ends: [{ kind: 'complete' }]
          }
        ]);
        ran.push('D-closed');
      });

      // **Part D, through the provider's diagnostics (T6, T7, T8).** A NOTICE,
      // and then a CLOSED, whose words are not text, and long ones: each read
      // on the relay axis before the next is sent.
      await part('D: a NOTICE and a CLOSED reason on the relay axis', async () => {
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
        const row = () => Object.values(context?.diagnostics.relays ?? {})[0];
        const stage = async (
          frame: unknown[],
          read: () => { text: string; truncated: boolean } | undefined
        ): Promise<unknown> => {
          const before = read();
          server.send(frame);
          // A bounded allowance rather than a wait the arm fails on: a stage
          // that publishes nothing is recorded as such, and the next one runs.
          try {
            await vi.waitFor(() => expect(read()).not.toBe(before), { timeout: 1000 });
          } catch {
            return 'nothing new was published';
          }
          return measured(read());
        };
        const notices: unknown[] = [];
        for (const body of [
          { why: 'an object' },
          'and now a string',
          'x'.repeat(10_000),
          { detail: 'x'.repeat(10_000) }
        ])
          notices.push(await stage(['NOTICE', body], () => row()?.lastNotice));
        const refusals: unknown[] = [];
        for (const reason of [
          { why: 'an object' },
          'x'.repeat(10_000),
          { detail: 'x'.repeat(10_000) }
        ])
          refusals.push(
            await stage(['CLOSED', 'wb1-relay-axis', reason], () => row()?.lastRefusal?.notice)
          );
        view.unmount();
        expect(
          { notices, refusals },
          'rendered, bounded, flagged, and the next one read too, on the relay axis'
        ).toEqual({
          notices: [
            [false, '{"why":"an object"}'],
            [false, 'and now a string'],
            [true, 'at the cap'],
            [true, 'within the inner bound']
          ],
          refusals: [
            [false, '{"why":"an object"}'],
            [true, 'at the cap'],
            [true, 'within the inner bound']
          ]
        });
        ran.push('D-relay-axis');
      });

      // **Part E, the boundary called directly (T5, T10)**: every malformed
      // field, including values no relay can send as JSON (`NaN`, `Infinity`,
      // `undefined`), and candidates that answer differently when asked twice.
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
        // is asked — every scalar, the tag list, and a tag whose walk changes —
        // which a fresh one shows first. The second answers are well-formed but
        // somebody else's, except `content`'s and the harm case's, which are
        // the `null` a frozen event must never hold.
        const answering = (field: string, first: unknown, second: unknown) => {
          let reads = 0;
          const value = { ...(wire({}) as object) };
          Object.defineProperty(value, field, {
            enumerable: true,
            get() {
              reads += 1;
              return reads === 1 ? first : second;
            }
          });
          return { value, reads: () => reads };
        };
        const walkedTags = () => {
          let walks = 0;
          const walked = [['t', 'ok']];
          Object.defineProperty(walked[0], 1, {
            enumerable: true,
            get() {
              walks += 1;
              return walks === 1 ? 'ok' : null;
            }
          });
          return { value: wire({ tags: walked }), reads: () => walks };
        };
        const cases: readonly (readonly [string, () => { value: unknown; reads: () => number }])[] =
          [
            ['id', () => answering('id', 'the-checked-id', 'somebody-elses-id')],
            ['sig', () => answering('sig', 'the-checked-sig', 'somebody-elses-sig')],
            ['kind', () => answering('kind', 1, 7)],
            ['pubkey', () => answering('pubkey', 'the-checked-pubkey', 'somebody-elses-pubkey')],
            ['content', () => answering('content', 'the-checked-content', null)],
            ['created_at', () => answering('created_at', 10, 20)],
            ['ots', () => answering('ots', 'the-checked-ots', 'somebody-elses-ots')],
            ['tags', () => answering('tags', [['t', 'ok']], [['t', 'somebody elses']])],
            ['tags, harmed', () => answering('tags', [['t', 'ok']], [['t', null]])],
            ['a tag, walked', walkedTags]
          ];
        const fieldOf = (name: string): string => (name.startsWith('tags') ? 'tags' : name);
        const readOf = (name: string, value: unknown): unknown =>
          name === 'a tag, walked'
            ? ((value as { tags: unknown[][] }).tags[0] as unknown[])[1]
            : (value as Record<string, unknown>)[fieldOf(name)];
        expect(
          cases.map(([name, make]) => {
            const { value } = make();
            return JSON.stringify(readOf(name, value)) !== JSON.stringify(readOf(name, value));
          }),
          'the premise: each answers differently the second time'
        ).toEqual(cases.map(() => true));
        expect(
          cases.map(([name, make]) => {
            const fresh = make();
            const kept = ownEvent(fresh.value) as Record<string, unknown> | undefined;
            return [name, kept?.[name === 'a tag, walked' ? 'tags' : fieldOf(name)], fresh.reads()];
          }),
          'the answer that was checked is the one kept, each asked once'
        ).toEqual([
          ['id', 'the-checked-id', 1],
          ['sig', 'the-checked-sig', 1],
          ['kind', 1, 1],
          ['pubkey', 'the-checked-pubkey', 1],
          ['content', 'the-checked-content', 1],
          ['created_at', 10, 1],
          ['ots', 'the-checked-ots', 1],
          ['tags', [['t', 'ok']], 1],
          ['tags, harmed', [['t', 'ok']], 1],
          ['a tag, walked', [['t', 'ok']], 1]
        ]);
        ran.push('E');
      });

      // **Part F, the filters a request is made with (T5)**, through a
      // provider, on both legs. The dependency matched an EVENT against the
      // REQ's filters before delivering it, reading the fields a filter names —
      // `tags` for `#t`, `pubkey` for `authors` — without checking them, so a
      // candidate missing one threw there and ended the subscription. The
      // provider's client no longer matches, and the engine matches the checked
      // copy. Under each filter, a malformed candidate is followed by one the
      // filter asks for and one it does not, on the backward leg and then the
      // forward one.
      await part('F: a filter the dependency would have read', async () => {
        const A = 'a'.repeat(64);
        const B = 'b'.repeat(64);
        const filtered: readonly {
          name: string;
          filter: Nostr.Filter;
          malformed: Record<string, unknown>;
          asked: Record<string, unknown>;
          unasked: Record<string, unknown>;
        }[] = [
          {
            name: 'a tag filter',
            filter: { kinds: [1], '#t': ['ok'] },
            malformed: { tags: null },
            asked: { tags: [['t', 'ok']] },
            unasked: { tags: [['t', 'other']] }
          },
          {
            name: 'an author filter',
            filter: { kinds: [1], authors: [A] },
            malformed: { pubkey: null },
            asked: { pubkey: A },
            unasked: { pubkey: B }
          },
          // And `kinds` alone, which the dependency's matcher reads without
          // throwing: a kind that is text was dropped there before, and reaches
          // the boundary now, which refuses it.
          {
            name: 'a kind filter',
            filter: { kinds: [1] },
            malformed: { kind: '1' },
            asked: {},
            unasked: { kind: 7 }
          }
        ];
        const rows: unknown[] = [];
        for (const { name, filter, malformed, asked, unasked } of filtered) {
          const url = nextUrl();
          const server = new WS(url, { jsonProtocol: true });
          const verifier = recording();
          let handle: ReqHandle | undefined;
          const view = render(VerifiedRequest, {
            relays: [url],
            verifyEvent: verifier.verify,
            plan: (): ReqPlan => ({
              kind: 'request',
              descriptor: {
                filters: [filter],
                live: true,
                retain: 'unbounded',
                settleTimeoutMs: 2000
              }
            }),
            request: (held: ReqHandle) => {
              handle = held;
            },
            seen: () => undefined
          });
          let ids: string[] = [];
          await vi.waitFor(
            () => {
              ids = (server.messages as unknown[][])
                .filter((frame) => frame[0] === 'REQ')
                .map((frame) => String(frame[1]));
              expect(ids.length, `${name}: both legs asked`).toBeGreaterThanOrEqual(2);
            },
            { timeout: 3000 }
          );
          const backward = ids.find((id) => id.includes('-b:')) as string;
          const forward = ids.find((id) => id.includes('-f:')) as string;
          const send = (subId: string, leg: string, at: number): void => {
            server.send([
              'EVENT',
              subId,
              { ...fakeEvent({ id: `malformed-${leg}` }), ...malformed }
            ]);
            server.send([
              'EVENT',
              subId,
              { ...fakeEvent({ id: `asked-${leg}`, created_at: at }), ...asked }
            ]);
            server.send([
              'EVENT',
              subId,
              { ...fakeEvent({ id: `unasked-${leg}`, created_at: at + 1 }), ...unasked }
            ]);
          };
          send(backward, 'backward', 10);
          server.send(['EOSE', backward]);
          await vi.waitFor(() => expect(handle?.state.status).not.toBe('loading'), {
            timeout: 3000
          });
          send(forward, 'forward', 20);
          // Time rather than an event to wait for: what is waited on here is
          // exactly what a regression loses.
          await settle(300);
          const published =
            handle === undefined || handle.state.status === 'loading' ? [] : handle.state.events;
          rows.push({
            name,
            status: handle?.state.status,
            legEnded: handle?.diagnostics.legEnded,
            verified: verifier.handed.map(({ event }) => event.id),
            published: published.map((event) => event.id)
          });
          view.unmount();
        }
        expect(
          rows,
          'the malformed one dropped, the asked one kept, the unasked one dropped, and the request still going'
        ).toEqual(
          filtered.map(({ name }) => ({
            name,
            status: 'settled',
            legEnded: undefined,
            verified: ['asked-backward', 'asked-forward'],
            published: ['asked-forward', 'asked-backward']
          }))
        );
        ran.push('F');
      });

      // **Nothing thrown, as a part of its own**, so that it is read whatever
      // the other parts did: an escape is the clause "not thrown", and it was
      // not being reached at all when an earlier part had failed. Long enough
      // first for an error reported on a timer, or a rejection reported after
      // the microtasks, to arrive while the collector listens.
      await settle(100);
      await part('nothing escaped but the two controls', () => {
        expect(escaped.seen).toEqual([
          { channel: 'uncaughtException', message: 'nosvelte test: the thrown control' },
          { channel: 'unhandledRejection', message: 'nosvelte test: the rejected control' }
        ]);
        ran.push('escapes');
      });
    } finally {
      escaped.restore();
    }
    // The parts that failed, by name, on the line a ledger reports; then that
    // every part ran to its end.
    expect(failures, `every part of the row holds; failed: ${failed.join(', ')}`).toEqual([]);
    expect(ran, 'every part ran to its end').toEqual([
      'controls',
      'A-copy',
      'A-order',
      'A-gate',
      'B',
      'C',
      'D-closed',
      'D-relay-axis',
      'E',
      'F',
      'escapes'
    ]);
  }, 60_000);
});
