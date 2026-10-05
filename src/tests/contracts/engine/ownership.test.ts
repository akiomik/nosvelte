/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a consumer holds when they hold an event, and what the cache holds
 * (`B5-C6`).
 *
 * **`ReqState.events` used to hand out the dependency's objects.** The array was
 * `readonly` and its elements were not, so `state.events[0].content = '…'` and
 * `events[0].tags.push(…)` type-checked with no cast, reached the object inside
 * the shared cache, were visible to every other hook on the same key, and
 * survived `refresh()`. The repair is one boundary: at the moment an event
 * arrives, before anything reads it, this library takes its own copy and
 * freezes it, and the types say so.
 *
 * **The contract is not "mutating throws".** That is one host's way of refusing
 * and would pin an implementation detail into a permanent API. It is: a change
 * to a published event reaches neither the cache, nor another hook, nor a later
 * projection; the published types do not permit one; and the cache can be
 * handed nothing but this library's own copy. The arms attempt the write,
 * swallow whatever the host does about it, and then look at what everybody else
 * sees.
 *
 * `OE1`, `OE2`, `OE6` and `OE10` are the spike's `OW1`, `OW2`, `OW6` and
 * `OW10` from its `event-ownership` suite, and `LE16` its `LK16` from the `leak`
 * suite — renamed, because an id 0005 records as a spike witness is not a
 * landing. `OE14` is the landing, which holds every clause of the row in one
 * arm: the run-time half through the hook, and the compile half through the
 * compiler.
 *
 * Port band 9820-9859, as the spike's suite had it.
 */
import type Nostr from 'nostr-typedef';
import { QueryClient } from 'tanstack-svelte-query-v6';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { createAttemptRegistry } from '$lib/v1/attempt.js';
import type { OwnedPacket, ReqEvent } from '$lib/v1/event.js';
import { ownEvent, ownPacket } from '$lib/v1/event.js';
import { emptyEventSet, foldEvent } from '$lib/v1/eventset.js';
import { MAIN_SURFACE } from '$lib/v1/surface.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import {
  consumerDiagnostics,
  emitDeclarations,
  mutableMembers,
  publishedNames,
  removeDeclarations
} from './helpers/declarations.js';
import {
  acceptAnyEvent,
  createTestRelay,
  fakeEvent,
  fakeEventPacket,
  respondWithEose,
  respondWithEvent
} from './helpers/relay.js';
import { flush, mount } from './helpers/runes.svelte.js';

const attempts = createAttemptRegistry();

let port = 9820;
const nextUrl = (): string => `ws://localhost:${(port += 1)}`;

async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  flush();
}

async function waitForReq(server: WS): Promise<string> {
  const message = (await server.nextMessage) as unknown[];
  return String(message[1]);
}

/**
 * The copy, when the fixture is a well-formed event. `ownEvent` answers
 * `undefined` for a wire value that is not one, which is another row's subject.
 */
const owningOf = (event: Nostr.Event): ReqEvent => {
  const owned = ownEvent(event);
  if (owned === undefined) throw new Error('the fixture is not a well-formed event');
  return owned;
};

/** Write into a published event the way a consumer would, and survive it. */
function scribbleOn(event: ReqEvent): void {
  const target = event as unknown as Nostr.Event;
  try {
    target.content = 'rewritten by the consumer';
  } catch {
    // The host refused, which is one way of keeping the promise and not the
    // promise itself.
  }
  try {
    target.tags.push(['t', 'mine']);
  } catch {
    /* as above */
  }
  try {
    (target.tags[0] as string[]).push('mine');
  } catch {
    /* as above */
  }
}

const eventsOf = (handle: { state: { status: string } }): readonly ReqEvent[] =>
  (handle.state as { events?: readonly ReqEvent[] }).events ?? [];

/**
 * The published names whose shapes are a consumer's to read: everything the
 * entry publishes, less what the consumer writes (their own descriptor and
 * relay inputs) and what declares no shape (the guards, by group).
 */
const writtenByTheConsumer = new Set(['ReqDescriptor', 'ReqPlan', 'RelayConfig', 'RelayInput']);
const shapesHandedOut = (): ReadonlySet<string> =>
  new Set(
    publishedNames(emitDeclarations()).filter(
      (name) =>
        !writtenByTheConsumer.has(name) &&
        !(MAIN_SURFACE.guards as readonly string[]).includes(name)
    )
  );

/**
 * A consumer's file that writes through every depth of a published event and
 * hands the fold the wire's packet. Each line marked `// refused` must be a
 * compile error, and the rest must compile: the clean lines are the control
 * that the file compiles at all, so an error on a marked line is the type's
 * answer and not a broken import.
 */
const CONSUMER = `import type { EventPacket } from 'rx-nostr';
import type { OwnedPacket, ReqEvent } from '$lib/v1/event.js';
import { emptyEventSet, foldEvent } from '$lib/v1/eventset.js';
declare const event: ReqEvent;
declare const tag: ReqEvent['tags'][number];
declare const wire: EventPacket;
declare const owned: OwnedPacket;
const read: string = event.content;
void read;
foldEvent(emptyEventSet, owned);
event.content = 'rewritten'; // refused
event.tags.push(['t', 'mine']); // refused
tag.push('mine'); // refused
const smuggled: OwnedPacket = wire; // refused
void smuggled;
foldEvent(emptyEventSet, wire); // refused
`;

describe('the event a consumer holds is this library’s own', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => WS.clean());
  afterAll(() => removeDeclarations());

  it(
    'OE1: a consumer’s write reaches no other reader of the same request',
    { timeout: 20_000 },
    async () => {
      const { rxNostr, server } = createTestRelay(nextUrl());
      const options = () => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: 'ow1',
        filters: [{ kinds: [1] }],
        reqIdBase: 'ow1'
      });
      const first = mount(() => useStreamedReq(options));
      const second = mount(() => useStreamedReq(options));

      const req = await waitForReq(server);
      respondWithEvent(
        server,
        req,
        fakeEvent({ id: 'ow1-a', created_at: 1, content: 'as it arrived', tags: [['t', 'theirs']] })
      );
      respondWithEose(server, req);
      await settle();

      expect(first.value.state.status).toBe('settled');
      expect(eventsOf(first.value)).toHaveLength(1);

      scribbleOn(eventsOf(first.value)[0] as ReqEvent);
      await settle();

      // Three readers of the same value: this hook again, the other hook, and the
      // list after a refresh. Before the repair all three read `rewritten by the
      // consumer`.
      expect(eventsOf(first.value)[0]?.content).toBe('as it arrived');
      expect(eventsOf(second.value)[0]?.content).toBe('as it arrived');
      expect(eventsOf(first.value)[0]?.tags).toEqual([['t', 'theirs']]);

      await first.value.refresh();
      const again = await waitForReq(server);
      respondWithEvent(
        server,
        again,
        fakeEvent({ id: 'ow1-a', created_at: 1, content: 'as it arrived', tags: [['t', 'theirs']] })
      );
      respondWithEose(server, again);
      await settle();
      expect(eventsOf(first.value)[0]?.content).toBe('as it arrived');

      first.destroy();
      second.destroy();
    }
  );

  it('OE2: the published event and its tags are immutable at run time', async () => {
    const { rxNostr, server } = createTestRelay(nextUrl());
    const { value: handle, destroy } = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: 'ow2',
        filters: [{ kinds: [1] }],
        reqIdBase: 'ow2'
      }))
    );

    const req = await waitForReq(server);
    respondWithEvent(
      server,
      req,
      fakeEvent({ id: 'ow2-a', created_at: 1, tags: [['e', 'one'], ['p']] })
    );
    respondWithEose(server, req);
    await settle();

    const [event] = eventsOf(handle);
    expect(event).toBeDefined();
    // Every depth a consumer can reach: the object, the list of tags, and each
    // tag. The middle one is the level `Readonly<Nostr.Event>` would have left
    // open, and the last is the one `readonly (readonly string[])[]` covers.
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event?.tags)).toBe(true);
    for (const tag of event?.tags ?? []) expect(Object.isFrozen(tag)).toBe(true);

    destroy();
  });

  it('OE10: the cache cannot be handed the wire’s packet, and does not keep one', () => {
    // **The type half of ownership, which the run-time arms cannot show.**
    // `Omit<EventPacket, 'event'> & { readonly event: ReqEvent }` was the first
    // shape of `OwnedPacket`, and TypeScript assigns a mutable value to a
    // readonly field — so `const owned: OwnedPacket = wirePacket` compiled.
    // `@ts-expect-error` is the assertion `npm run check` reads.
    const wire = fakeEventPacket({ id: 'ow10-a', created_at: 1 });

    // @ts-expect-error — a wire packet is not an owned one
    const notOwned: OwnedPacket = wire;
    void notOwned;
    // @ts-expect-error — and the fold will not take one
    foldEvent(emptyEventSet, wire);

    // **And what is stored has no path back to the transport's object.** The
    // packet used to be carried whole, so `message[2]` held the wire's event
    // beside the copy.
    const owned = ownPacket(wire);
    expect(owned).toBeDefined();
    expect(Object.keys(owned ?? {})).toEqual(['event']);
    expect(JSON.stringify(owned)).not.toContain('EVENT');
  });

  it('OE6: the published type does not permit a write, at either depth', () => {
    // **The type is half of the contract and the freeze is the other half.**
    // Freezing at run time while the declared type still said `Nostr.Event`
    // would make legal-looking code fail at run time. If any of the three stops
    // being an error, `npm run check` fails on the unused directive.
    const event: ReqEvent = owningOf(
      fakeEvent({ id: 'ow6-a', created_at: 9, content: 'as it arrived', tags: [['t', 'theirs']] })
    );

    try {
      // @ts-expect-error — every field of a published event is readonly
      event.content = 'rewritten by the consumer';
    } catch {
      // Whether the host refuses loudly is its business.
    }
    try {
      // @ts-expect-error — the tag list is readonly
      event.tags.push(['t', 'mine']);
    } catch {
      /* as above */
    }
    try {
      // @ts-expect-error — and so is each tag
      event.tags[0].push('mine');
    } catch {
      /* as above */
    }

    expect(event.content).toBe('as it arrived');
    expect(event.tags).toEqual([['t', 'theirs']]);
  });

  it('LE16: a value a consumer receives is readonly all the way down', { timeout: 60_000 }, () => {
    // **The type half of ownership, counted rather than checked value by value.**
    // The run time keeps what a consumer holds frozen, and a type that permits a
    // write over a frozen value is legal-looking code that fails only at run
    // time. It walks the syntax of the emitted declarations: a regular
    // expression over the text read one variant of a union, missed index
    // signatures and return types, and left published names unopened.
    const published = shapesHandedOut();
    expect(published.size).toBeGreaterThan(10);
    const { mutable, opened } = mutableMembers(emitDeclarations(), published);

    // Every published name was opened, or a skipped name would report the same
    // "nothing found" as one that was read. The hooks are values and declare
    // no shape, so they are excluded by name rather than by silence.
    const shapeless = new Set<string>(MAIN_SURFACE.hooks);
    expect([...published].filter((name) => !opened.has(name) && !shapeless.has(name))).toEqual([]);
    expect(mutable, 'a published value a consumer could write into').toEqual([]);
  });

  // @contracts B5-C6
  it(
    'OE14: a consumer’s write reaches nothing this library holds, and neither the types nor the fold let one in',
    { timeout: 60_000 },
    async () => {
      // **Every clause of the row in one arm.** At run time: a consumer who
      // writes to an event they were handed — its content, its tag list, one
      // tag — changes nothing that this hook reads again, that a second hook on
      // the same key reads, or that the list reads after a `refresh()`; and
      // what the cache stores is the event alone, with no path back to the
      // transport's packet. At compile time: the published types refuse those
      // writes, every member of every published type is readonly to the depth a
      // consumer can reach, and the fold refuses the wire's packet.
      const { rxNostr, server } = createTestRelay(nextUrl());
      const options = () => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: 'oe14',
        filters: [{ kinds: [1] }],
        reqIdBase: 'oe14'
      });
      const first = mount(() => useStreamedReq(options));
      const second = mount(() => useStreamedReq(options));
      const arrived = {
        id: 'ow14-a',
        created_at: 1,
        content: 'as it arrived',
        tags: [
          ['t', 'theirs'],
          ['p', 'them']
        ]
      };

      const req = await waitForReq(server);
      respondWithEvent(server, req, fakeEvent(arrived));
      respondWithEose(server, req);
      await settle();
      expect(eventsOf(first.value)).toHaveLength(1);

      scribbleOn(eventsOf(first.value)[0] as ReqEvent);
      await settle();
      const unchanged = (handle: typeof first.value, reader: string) => {
        const [event] = eventsOf(handle);
        expect(event?.content, `${reader}: content`).toBe(arrived.content);
        expect(event?.tags, `${reader}: tags`).toEqual(arrived.tags);
      };
      unchanged(first.value, 'the same handle');
      unchanged(second.value, 'a second hook on the same key');

      await first.value.refresh();
      const again = await waitForReq(server);
      respondWithEvent(server, again, fakeEvent(arrived));
      respondWithEose(server, again);
      await settle();
      unchanged(first.value, 'after a refresh');
      unchanged(second.value, 'the second hook after a refresh');
      first.destroy();
      second.destroy();

      // What the cache stores is the event alone: no `message`, no `from`
      // object, nothing that reaches the wire's packet.
      const wire = fakeEventPacket({ id: 'ow14-b', created_at: 1 });
      const owned = ownPacket(wire);
      expect(Object.keys(owned ?? {})).toEqual(['event']);
      expect(owned?.event).not.toBe(wire.event);
      expect(JSON.stringify(owned)).not.toContain('EVENT');

      // The compile half, answered by the compiler: every marked line of the
      // consumer's file is an error, and no other line is.
      const lines = CONSUMER.split('\n');
      const refused = lines.flatMap((text, at) => (text.endsWith('// refused') ? [at + 1] : []));
      const diagnostics = consumerDiagnostics(CONSUMER);
      expect(
        refused.filter((line) => !diagnostics.some((one) => one.line === line)),
        'a write the types let through'
      ).toEqual([]);
      expect(
        diagnostics.filter((one) => !refused.includes(one.line)),
        'the consumer file compiles apart from the refused lines'
      ).toEqual([]);

      // And every member of every published type is readonly, all the way down.
      const published = shapesHandedOut();
      const { mutable } = mutableMembers(emitDeclarations(), published);
      expect(mutable, 'a published value a consumer could write into').toEqual([]);
    }
  );
});
