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
 * `OW10` from its `event-ownership` suite, renamed because an id 0005 records
 * as a spike witness is not a landing. `OE14` is the landing, which holds every
 * clause of the row in one arm: the run-time half through the hook, and the
 * compile half through the compiler, asked about a consumer's file.
 *
 * Port band 9820-9859, as the spike's suite had it.
 */
import { readFileSync } from 'node:fs';
import { types } from 'node:util';

import type Nostr from 'nostr-typedef';
import type { EventPacket } from 'rx-nostr';
import { QueryClient } from 'tanstack-svelte-query-v6';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { createAttemptRegistry } from '$lib/v1/attempt.js';
import type { OwnedPacket, ReqEvent } from '$lib/v1/event.js';
import { ownEvent, ownPacket } from '$lib/v1/event.js';
import type { CachedEventSet } from '$lib/v1/eventset.js';
import { emptyEventSet, foldEvent } from '$lib/v1/eventset.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import {
  consumerDiagnostics,
  judgeWrites,
  variantsWith,
  writesThrough
} from './helpers/declarations.js';
import {
  acceptAnyEvent,
  createTestRelay,
  fakeEvent,
  fakeEventPacket,
  ownedFrom,
  respondWithEose,
  respondWithEvent
} from './helpers/relay.js';
import { flush, mount } from './helpers/runes.svelte.js';

/**
 * Every packet the ownership boundary returned, so an arm can ask whether what
 * the cache holds is one of them by identity — rather than through
 * `isOwnedPacket`, which is the predicate under test and would answer for a
 * mutation of itself. The wrapper delegates: the real factory runs and
 * registers what it makes, so what is mocked is the bookkeeping, as in
 * `transportkey.test.ts`.
 */
vi.mock('$lib/v1/event.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/v1/event.js')>();
  return { ...actual, ownPacket: vi.fn(actual.ownPacket) };
});

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
 * Every object reachable from `root`: through every own property — symbol-keyed
 * and non-enumerable ones included, read off the descriptor so no getter runs —
 * and through each prototype other than the built-in ones. "No path back to the
 * transport's object" is a statement about reachability, and keys or a JSON
 * rendering are two partial views of it: a wrapper whose prototype is the wire's
 * packet has one key and serialises clean.
 */
function reachable(root: unknown): Set<object> {
  const builtIn = new Set<unknown>([Object.prototype, Array.prototype, Function.prototype, null]);
  const seen = new Set<object>();
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const next = pending.pop();
    if ((typeof next !== 'object' && typeof next !== 'function') || next === null) continue;
    if (seen.has(next) || builtIn.has(next)) continue;
    seen.add(next);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(next)))
      if ('value' in descriptor) pending.push(descriptor.value);
    pending.push(Object.getPrototypeOf(next));
  }
  return seen;
}

/**
 * What makes `reachable` exact and what the boundary made unchangeable: every
 * object reachable from `root` is plain, frozen data — no proxy, no accessor
 * and no function, whose traps and closures reflection cannot read, no symbol
 * key, no prototype
 * but the built-in object and array ones, and nothing left open to a write.
 * Returns what breaks that, by path.
 */
function plainDataBreaches(root: unknown): string[] {
  const breaches: string[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown, path: string): void => {
    // A proxy is not data either, and reflection cannot tell: every
    // descriptor, prototype and frozen state below is read through its traps,
    // and a `get` trap answers `toJSON` for a property that is not there. The
    // host can tell, so it is asked.
    if (
      (typeof value === 'object' || typeof value === 'function') &&
      value !== null &&
      types.isProxy(value)
    ) {
      breaches.push(`${path} is a proxy`);
      return;
    }
    // A function is not data: what it reaches is in a closure reflection
    // cannot read, and `toJSON` is called by every serialisation.
    if (typeof value === 'function') {
      breaches.push(`${path} is a function`);
      return;
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== Array.prototype)
      breaches.push(`${path} has a prototype of its own`);
    // Frozen at every level: with no accessor anywhere, `isFrozen` is the whole
    // answer — a registered packet whose payload could be replaced is the
    // boundary's object holding somebody else's event.
    if (!Object.isFrozen(value)) breaches.push(`${path} is not frozen`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') {
        breaches.push(`${path} has a symbol key`);
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor !== undefined && !('value' in descriptor))
        breaches.push(`${path}.${key} is an accessor`);
      else visit(descriptor?.value, `${path}.${key}`);
    }
  };
  visit(root, 'stored');
  return breaches;
}

/** `value`, frozen at every level: a forgery of what the boundary makes. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Reflect.ownKeys(value))
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

/**
 * What stands before the fold's ownership check, read off the sources of
 * `eventset.ts` and `event.ts`.
 *
 * **"The check comes first" is a fact about order, and order is in the
 * source.** A run-time observer cannot see every read: `Array.isArray`,
 * `typeof` and an identity lookup touch an object without any proxy trap. So
 * the order is asked of the syntax trees:
 * - `foldEvent` is declared once, as an exported `const` holding a function —
 *   a function declaration is an assignable binding, and a wrapper assigned to
 *   it would be what every caller reaches;
 * - no parameter has a default or a pattern, which would run first;
 * - its first statement is `if (!isOwnedPacket(packet)) throw …`, with no
 *   `else`;
 * - that `isOwnedPacket` is the one imported from `./event.js`, redeclared
 *   nowhere in the file, and declared there once, as an exported `const`.
 *
 * What the check does is not read here. The forgeries measure that.
 */
function beforeTheCheck(eventset: string, event: string): string[] {
  const parse = (name: string, text: string): ts.SourceFile =>
    ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const breaches: string[] = [];
  // The one top-level declaration of `name` in `file`: a `const` holding a
  // function, exported, or a breach.
  const constant = (
    file: ts.SourceFile,
    name: string
  ): ts.ArrowFunction | ts.FunctionExpression | undefined => {
    const found: ts.Node[] = [];
    for (const statement of file.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
        found.push(statement);
      if (ts.isVariableStatement(statement))
        for (const one of statement.declarationList.declarations)
          if (ts.isIdentifier(one.name) && one.name.text === name) found.push(statement);
    }
    const [statement] = found;
    if (found.length !== 1 || statement === undefined) {
      breaches.push(`${found.length} declarations of ${name}`);
      return undefined;
    }
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    ) {
      breaches.push(`${name} is not a const`);
      return undefined;
    }
    if (!statement.modifiers?.some((one) => one.kind === ts.SyntaxKind.ExportKeyword))
      breaches.push(`${name} is not exported`);
    const initializer = statement.declarationList.declarations.find(
      (one) => ts.isIdentifier(one.name) && one.name.text === name
    )?.initializer;
    if (
      initializer === undefined ||
      !(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ) {
      breaches.push(`${name} does not hold a function`);
      return undefined;
    }
    return initializer;
  };

  const file = parse('eventset.ts', eventset);
  const fold = constant(file, 'foldEvent');
  if (fold !== undefined) {
    for (const parameter of fold.parameters) {
      if (!ts.isIdentifier(parameter.name)) breaches.push('a parameter is a pattern');
      if (parameter.initializer !== undefined)
        breaches.push(`a default for ${parameter.name.getText()}`);
    }
    const packet = fold.parameters[1]?.name.getText();
    const first = ts.isBlock(fold.body) ? fold.body.statements[0] : undefined;
    const condition = first !== undefined && ts.isIfStatement(first) ? first.expression : undefined;
    const call =
      condition !== undefined &&
      ts.isPrefixUnaryExpression(condition) &&
      condition.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isCallExpression(condition.operand)
        ? condition.operand
        : undefined;
    const isTheCheck =
      first !== undefined &&
      ts.isIfStatement(first) &&
      call !== undefined &&
      ts.isIdentifier(call.expression) &&
      call.expression.text === 'isOwnedPacket' &&
      call.arguments.length === 1 &&
      call.arguments[0]?.getText() === packet &&
      ts.isThrowStatement(first.thenStatement) &&
      first.elseStatement === undefined;
    if (!isTheCheck)
      breaches.push(`the first statement is ${first?.getText().split('\n')[0] ?? 'nothing'}`);
  }
  const imported = file.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === './event.js' &&
      statement.importClause?.isTypeOnly !== true &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (one) => one.name.text === 'isOwnedPacket' && one.propertyName === undefined
      )
  );
  if (!imported) breaches.push('isOwnedPacket is not imported from ./event.js');
  let redeclared = 0;
  const walk = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isClassDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'isOwnedPacket'
    )
      redeclared += 1;
    ts.forEachChild(node, walk);
  };
  walk(file);
  if (redeclared > 0) breaches.push('isOwnedPacket is redeclared in the file');
  constant(parse('event.ts', event), 'isOwnedPacket');
  return breaches;
}

/**
 * What a consumer imports: the published event and the handle from the public
 * entry, never the module behind them.
 */
const PUBLISHED = `import type * as Published from '$lib/v1/public-entry.js';`;

/**
 * The internal seam's refusals, as calls to the fold — the contract is its
 * parameter, not the alias it is spelled with: the wire's packet handed to it,
 * directly and as an owned packet rebuilt around the wire's event (the spread
 * keeps whatever brand the wrapper carries and swaps its payload), and an
 * owned event re-spread or copied.
 */
const SMUGGLES = `import type { EventPacket } from 'rx-nostr';
import { ownPacket } from '$lib/v1/event.js';
import { emptyEventSet, foldEvent } from '$lib/v1/eventset.js';
declare const wire: EventPacket;
const owned = ownPacket(wire);
if (owned !== undefined) foldEvent(emptyEventSet, owned);
foldEvent(emptyEventSet, wire); // refused
if (owned !== undefined) {
  foldEvent(emptyEventSet, { ...owned, ...wire }); // refused
  foldEvent(emptyEventSet, { ...owned, event: wire.event }); // refused
  foldEvent(emptyEventSet, { event: { ...owned.event, ...wire.event } }); // refused
  foldEvent(emptyEventSet, { event: { ...owned.event } }); // refused
}
`;

/**
 * "Not assignable": to a parameter (TS2345), or at a member of an argument
 * (TS2322) — each with its `exactOptionalPropertyTypes` spelling, TS2379 and
 * TS2375, which is what this project's configuration reports.
 */
const NOT_ASSIGNABLE: ReadonlySet<number> = new Set([2322, 2345, 2375, 2379]);

/** The lines of `source` that end `// refused`, 1-based. */
const refusedLines = (source: string): number[] =>
  source.split('\n').flatMap((text, at) => (text.endsWith('// refused') ? [at + 1] : []));

describe('the event a consumer holds is this library’s own', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => WS.clean());

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
    // @ts-expect-error — and the fold will not take one, at run time either
    expect(() => foldEvent(emptyEventSet, wire)).toThrow(TypeError);

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

  // @contracts B5-C6
  it(
    'OE14: a consumer’s write reaches nothing this library holds, and neither the types nor the fold let one in',
    { timeout: 60_000 },
    async () => {
      // **Every clause of the row in one arm.** At run time: a consumer who
      // writes to an event they were handed — its content, its tag list, one
      // tag — changes neither that event, nor what this hook reads again, what
      // a second hook on the same key reads, or what the list reads after a
      // `refresh()`; what
      // the cache stores is the event alone, plain data with no path back to
      // the transport's packet; and the fold refuses an event this library did
      // not copy, whatever its type. At compile time: the published event's
      // type — as the entry exports it and as the handle hands it out — refuses
      // every write a consumer could attempt, and the fold refuses the wire's
      // packet and any packet or event rebuilt around it.
      vi.mocked(ownPacket).mockClear();
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
      expect(eventsOf(first.value), 'the hook delivers the event').toHaveLength(1);

      // The event the consumer wrote to is one of the readers too: it refuses
      // the write, however the host refuses. A projection that handed out a
      // fresh, writable copy each time would keep every other reader clean and
      // let the consumer's own event change.
      const written = eventsOf(first.value)[0] as ReqEvent;
      scribbleOn(written);
      await settle();
      expect(written.content, 'the event written to: content').toBe(arrived.content);
      expect(written.tags, 'the event written to: tags').toEqual(arrived.tags);
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

      // **What the cache actually stores**, read out of the query cache rather
      // than off a separate call to the factory: each packet is, by identity,
      // an object the boundary returned; its only key is `event`; it is plain,
      // frozen data; and its event cannot be replaced — a registered packet
      // holding somebody else's event would pass every question about who
      // made it.
      const stored = client
        .getQueryCache()
        .getAll()
        .flatMap((entry) => {
          const data = entry.state.data as { entries?: unknown } | undefined;
          return data?.entries instanceof Map
            ? [...(data.entries as Map<string, unknown>).values()]
            : [];
        });
      expect(stored.length, 'the cache holds the event').toBeGreaterThan(0);
      // The plain-data check's own control: an object carrying each thing it
      // refuses is reported for each, so an empty answer below is the stored
      // packet answering.
      const impure = Object.freeze({
        fn: () => 0,
        get accessor() {
          return 0;
        },
        [Symbol('key')]: 0,
        own: Object.freeze(Object.create({}) as object),
        open: {},
        proxied: new Proxy(Object.freeze({}), {})
      });
      expect(plainDataBreaches(impure), 'the plain-data check’s control').toEqual(
        expect.arrayContaining([
          'stored.fn is a function',
          'stored.accessor is an accessor',
          'stored has a symbol key',
          'stored.own has a prototype of its own',
          'stored.open is not frozen',
          'stored.proxied is a proxy'
        ])
      );
      const made = new Set<unknown>(vi.mocked(ownPacket).mock.results.map((one) => one.value));
      for (const packet of stored) {
        expect(made.has(packet), 'a stored packet is one the boundary returned').toBe(true);
        expect(Reflect.ownKeys(packet as object), 'a stored packet’s keys').toEqual(['event']);
        expect(plainDataBreaches(packet), 'a stored packet is plain data').toEqual([]);
        const held = (packet as OwnedPacket).event;
        const foreign = { ...held };
        expect(Reflect.set(packet as object, 'event', foreign), 'the payload replaced').toBe(false);
        expect(
          Reflect.defineProperty(packet as object, 'event', { value: foreign }),
          'the payload redefined'
        ).toBe(false);
        expect((packet as OwnedPacket).event, 'the payload a stored packet holds').toBe(held);
      }
      first.destroy();
      second.destroy();

      // What the cache stores is the event alone: nothing reachable from it —
      // through any property or any prototype — is reachable from the wire's
      // packet. And it is a copy, not the wire's event.
      // The fixture fills every container a copy has to make — the tag list and
      // each tag, more than one deep — so a copy that shares an inner array
      // with the wire has one to share. An empty list cannot show it.
      const wire = fakeEventPacket({
        id: 'oe14-b',
        created_at: 1,
        tags: [
          ['t', 'x'],
          ['p', 'y', 'z']
        ]
      });
      expect(wire.event.tags.length).toBeGreaterThan(1);
      expect(wire.event.tags.every((tag) => tag.length > 1)).toBe(true);
      const owned = ownPacket(wire);
      expect(owned).toBeDefined();
      expect(Reflect.ownKeys(owned ?? {})).toEqual(['event']);
      expect(plainDataBreaches(owned), 'what is stored is plain data').toEqual([]);
      expect(owned?.event).not.toBe(wire.event);
      const theirs = reachable(wire);
      expect(
        [...reachable(owned)].filter((one) => theirs.has(one)),
        'what the cache stores reaches the transport’s packet'
      ).toEqual([]);

      // The compile half, answered by the compiler. Every write a consumer
      // could attempt through the published event — each property the type
      // checker gives it, the tag list and each tag — is refused, for being
      // read-only, judged on the type the compiler gives each line's receiver;
      // and the fold refuses the wire's packet, directly and rebuilt around an
      // owned one.
      // The event is asked about as the named type and as the handle hands it
      // out — each variant of the handle's state that carries events — since
      // the two are separate declarations that could drift apart.
      const carrying = variantsWith(PUBLISHED, "Published.ReqHandle['state']", 'status', 'events');
      expect(carrying, 'the handle’s states that carry events').toContain('settled');
      const eventTypes = [
        'Published.ReqEvent',
        ...carrying.map(
          (status) =>
            `Extract<Published.ReqHandle['state'], { status: '${status}' }>['events'][number]`
        )
      ];
      for (const eventType of eventTypes) {
        const writes = writesThrough(PUBLISHED, eventType);
        expect(writes.length, `${eventType}: the probe enumerated the event`).toBeGreaterThan(9);
        expect(
          judgeWrites(PUBLISHED, eventType, writes).filter((one) => one.verdict !== 'refused'),
          `${eventType}: a write through the published event the types do not refuse`
        ).toEqual([]);
      }

      // **And the surface stays readable.** The list type refuses every slot,
      // and what a consumer does with a list of tags still compiles: iterate,
      // spread, map, find, count, serialise, and hand the list or a tag to
      // something that takes `readonly string[]`.
      const reads = [
        PUBLISHED,
        'declare const event: Published.ReqEvent;',
        'declare function takesTags(tags: readonly (readonly string[])[]): void;',
        'declare function takesTag(tag: readonly string[]): void;',
        'for (const tag of event.tags) takesTag(tag);',
        'takesTags(event.tags);',
        "const p: string | undefined = event.tags.find((tag) => tag[0] === 'p')?.[1];",
        "const names: string[] = event.tags.map((tag) => tag[0] ?? '');",
        'const copy: string[][] = event.tags.map((tag) => [...tag]);',
        'const spread = [...event.tags];',
        'const count: number = event.tags.length;',
        'const json: string = JSON.stringify(event);',
        'const from = Array.from(event.tags);',
        'void [p, names, copy, spread, count, json, from];'
      ].join('\n');
      expect(consumerDiagnostics(reads), 'a consumer’s reads of the published event').toEqual([]);

      // Its positive control: the same probe over a type that permits every
      // write is refused nowhere, so a refusal above is the event's type
      // answering and not the probe failing to compile. The type reaches each
      // kind of line the probe emits — a tuple's rest position, a reachable
      // `any` and a member that can be called — and each is asked for by name,
      // so a branch of the probe that stopped emitting would show here.
      const mutable =
        '{ a: string; b: string[]; c: { d: number }; t: [string, ...number[][]]; x: any; m: { add(one: string): void } }';
      const open = writesThrough('', mutable);
      expect(open, 'the control’s lines, each asked for by name').toEqual(
        expect.arrayContaining([
          'value.b!.push(value.b![0]!);',
          'value.t![1]![0] = value.t![1]![0]!;',
          'value.x!.anything = value.x!;',
          'void value.b!.push!.call;',
          'void value.m!.add!.call;'
        ])
      );
      // The one slot refused there is the standard library's own: it
      // declares `[Symbol.unscopables]` read-only on every array.
      expect(
        judgeWrites('', mutable, open).filter(
          (one) =>
            one.verdict !== 'compiles' &&
            !(one.verdict === 'refused' && one.write.endsWith('[Symbol.unscopables]!;'))
        ),
        'a write through a mutable type was refused'
      ).toEqual([]);
      // The judge's own control: a refusal that one constituent of a union
      // gives is not counted. A leading rest makes a tuple's position 0 the
      // union of a mutable tag and a read-only one, though the walk derives it
      // from one type argument; the `push` onto it is TS2339 for the read-only
      // half and compiles for the other once a consumer narrows.
      const variadic = "{ t: readonly [...['t', ...string[]][], readonly ['p', ...string[]]] }";
      expect(
        judgeWrites('', variadic, writesThrough('', variadic)),
        'the judge’s control: a union receiver'
      ).toContainEqual({
        write: 'value.t![0]!.push(value.t![0]![0]!);',
        verdict: 'through a union'
      });
      // The admission's control: a member something other than the standard
      // library declares on the global array types is reported, though the
      // array it is on is read-only.
      const augmented = writesThrough(
        'export {};\ndeclare global { interface ReadonlyArray<T> { fill(value: T): this } }',
        '{ r: readonly string[] }'
      );
      expect(augmented, 'the admission’s control: a member added to ReadonlyArray').toContain(
        'void value.r!.fill!.call;'
      );
      // And its exactness: a diagnostic that is not a read-only refusal is not
      // counted as one — a `push` onto something that is no list at all, and
      // an assignment whose type is wrong.
      expect(
        judgeWrites('', '{ s: { readonly n: number }; a: string }', [
          'value.s.push(1);',
          'value.a = 1;'
        ]),
        'the judge’s exactness control'
      ).toEqual([
        { write: 'value.s.push(1);', verdict: 'not a refusal: TS2339' },
        { write: 'value.a = 1;', verdict: 'not a refusal: TS2322' }
      ]);
      // And where the probe cannot certify a type it throws, rather than
      // return having emitted nothing for it — each of those is asked for too.
      const certifies = {
        'a union': ['', '{ a: string[] | number }', /is a union/],
        'a symbol it cannot name': [
          'declare const key: unique symbol;',
          '{ [key]: string[] }',
          /a symbol member the probe cannot name/
        ],
        'members past its depth': [
          '',
          '{ a: { b: { c: { d: { e: string[] } } } } }',
          /is deeper than 4/
        ],
        'an unknown': ['', '{ a: unknown }', /is unknown/],
        'an object with nothing to enumerate': [
          '',
          '{ a: object }',
          /has nothing the probe can enumerate/
        ]
      } as const;
      for (const [what, [imports, typeText, message]] of Object.entries(certifies))
        expect(() => writesThrough(imports, typeText), `the control’s throw on ${what}`).toThrow(
          message
        );

      // **And at run time, past any type, the fold asks who made the packet,
      // and nothing else, on every path through it.** A cast types anything,
      // `structuredClone` is typed as the identity, and a spread keeps an owned
      // event typed owned. So the forgeries are the whole product of what one
      // can vary — whose event it holds (the owned event itself, a deep-frozen
      // copy of it, a plain copy, the wire's), what carries it (an object
      // holding the event alone, one beside the transport's fields, an array
      // holding it), and whether the packet is frozen — and no property the
      // boundary's object also has can stand in for having made it.
      const forgeriesOf = (wirePacket: EventPacket, basis: OwnedPacket) => {
        const carried: Record<string, unknown> = {
          'the owned event itself': basis.event,
          'a deep-frozen copy of it': deepFreeze(structuredClone(basis.event)),
          'a plain copy of it': structuredClone(basis.event),
          'the wire’s event': wirePacket.event
        };
        const shaped: Record<string, (event: unknown) => object> = {
          alone: (event) => ({ event }),
          'beside the transport’s fields': (event) => ({ ...wirePacket, event }),
          'on an array': (event) => Object.assign([], { event })
        };
        return Object.entries(carried).flatMap(([what, event]) =>
          Object.entries(shaped).flatMap(([how, shape]) =>
            [false, true].map((frozen) => ({
              name: `${what}, ${how}, ${frozen ? 'frozen' : 'not frozen'}`,
              packet: frozen ? Object.freeze(shape(event)) : shape(event)
            }))
          )
        );
      };
      const ownedPacket = owned as OwnedPacket;
      const forgeries = forgeriesOf(wire, ownedPacket);
      expect(forgeries, 'every cell of the product').toHaveLength(24);
      // The cell that differs from the owned packet in nothing but who made it.
      const perfect = forgeries.find(
        (one) => one.name === 'a deep-frozen copy of it, alone, frozen'
      )?.packet;
      expect(perfect, 'the perfect forgery is equal to the owned packet').toEqual(owned);
      expect(Reflect.ownKeys(perfect ?? {})).toEqual(['event']);
      expect(plainDataBreaches(perfect), 'the perfect forgery is plain, frozen data').toEqual([]);

      // **On every path.** A refusal placed after any early return would let a
      // forgery through there and only there, so the product is folded on
      // every path the fold has, each arranged from an event that takes it. The
      // paths are a product, so none is a sample:
      // - the kind's class — regular (keyed by id), replaceable, addressable,
      //   and addressable with no `d` tag (keyed by version, the last by the
      //   identifier's fallback) — against the newcomer's relation to what the
      //   set holds: nothing; older; newer; as old with a larger id; the
      //   incumbent again; as old with a smaller id, which are every branch of
      //   `laterWins`;
      // - an ephemeral event, which is never stored: the request's first, which
      //   flags the set, and one after another, which leaves it as it is;
      // - and each of those alone, and beside an unrelated event the set
      //   already holds, which has to survive as the very object it was.
      // An owned packet on the same arrangement is the control that the path is
      // the one named, read by identity: what the set holds afterwards is
      // exactly what it held, less the incumbent it replaces, plus that very
      // packet — or the set is the same object. A verdict has three answers —
      // folded, refused by the fold's own `TypeError`, or threw for another
      // reason — so the control cannot pass by failing.
      const attempt = (set: CachedEventSet, packet: object): string => {
        try {
          foldEvent(set, packet as OwnedPacket);
          return 'folded';
        } catch (error) {
          return error instanceof TypeError && /did not make/.test(error.message)
            ? 'refused'
            : `threw: ${String(error)}`;
        }
      };
      type Outcome = 'stored alongside' | 'replaces the incumbent' | 'unchanged' | 'flagged';
      // What the set held, read off its own properties — a value on its
      // prototype reads the same through `set[key]`, so a field moved there
      // would pass for one kept — and its prototype, and its map's entries.
      type Snapshot = {
        prototype: unknown;
        fields: readonly (readonly [PropertyKey, PropertyDescriptor | undefined])[];
        entries: readonly (readonly [string, unknown])[];
      };
      const snapshot = (set: CachedEventSet): Snapshot => ({
        prototype: Object.getPrototypeOf(set),
        fields: Reflect.ownKeys(set).map(
          (key) => [key, Object.getOwnPropertyDescriptor(set, key)] as const
        ),
        entries: [...set.entries]
      });
      // Judged against what the set held before any fold, copied out first:
      // the set's own map is the thing a fold could change in place, so it
      // cannot also be the record of what it held. Every outcome requires the
      // input to be as it was, and every packet the fold does not replace to
      // be where it was, as the very object it was.
      const shows = (
        outcome: Outcome,
        held: Snapshot,
        before: CachedEventSet,
        after: CachedEventSet,
        basis: OwnedPacket,
        incumbent: OwnedPacket | undefined
      ): boolean => {
        const keeps = (entries: ReadonlyMap<string, unknown>, except?: unknown): boolean =>
          held.entries.every(([key, packet]) => packet === except || entries.get(key) === packet);
        // The input as it was: the same fields, each the same value — the
        // flag a fold sets on the set it returns included — and its map
        // holding what it held.
        const now = snapshot(before);
        const intact =
          now.prototype === held.prototype &&
          now.fields.length === held.fields.length &&
          held.fields.every(([key, was]) => {
            const is = now.fields.find(([one]) => one === key)?.[1];
            return (
              is !== undefined &&
              was !== undefined &&
              'value' in is &&
              'value' in was &&
              is.value === was.value
            );
          }) &&
          before.entries.size === held.entries.length &&
          keeps(before.entries);
        if (outcome === 'unchanged') return intact && after === before;
        if (outcome === 'flagged')
          return (
            intact &&
            before.ephemeralOmitted !== true &&
            after.ephemeralOmitted === true &&
            after.entries === before.entries
          );
        const values: unknown[] = [...after.entries.values()];
        return outcome === 'replaces the incumbent'
          ? intact &&
              after.entries.size === held.entries.length &&
              keeps(after.entries, incumbent) &&
              values.includes(basis) &&
              !values.includes(incumbent)
          : intact &&
              after.entries.size === held.entries.length + 1 &&
              keeps(after.entries) &&
              values.includes(basis);
      };
      const classes: Record<string, { kind: number; tags: string[][]; byVersion: boolean }> = {
        'a regular event': { kind: 1, tags: [['t', 'x']], byVersion: false },
        'a replaceable event': { kind: 10002, tags: [['r', 'x']], byVersion: true },
        'an addressable event': { kind: 30023, tags: [['d', 'x']], byVersion: true },
        'an addressable event with no `d` tag': { kind: 30023, tags: [['t', 'x']], byVersion: true }
      };
      const relations: {
        relation: string;
        held: boolean;
        created_at: number;
        id: string;
        byId: Outcome;
        byVersion: Outcome;
      }[] = [
        {
          relation: 'with nothing to compete with',
          held: false,
          created_at: 5,
          id: 'm',
          byId: 'stored alongside',
          byVersion: 'stored alongside'
        },
        {
          relation: 'older than the incumbent',
          held: true,
          created_at: 4,
          id: 'z',
          byId: 'stored alongside',
          byVersion: 'unchanged'
        },
        {
          relation: 'newer than the incumbent',
          held: true,
          created_at: 6,
          id: 'a',
          byId: 'stored alongside',
          byVersion: 'replaces the incumbent'
        },
        {
          relation: 'as old, with a larger id',
          held: true,
          created_at: 5,
          id: 'n',
          byId: 'stored alongside',
          byVersion: 'unchanged'
        },
        {
          relation: 'the incumbent again',
          held: true,
          created_at: 5,
          id: 'm',
          byId: 'unchanged',
          byVersion: 'unchanged'
        },
        {
          relation: 'as old, with a smaller id',
          held: true,
          created_at: 5,
          id: 'b',
          byId: 'stored alongside',
          byVersion: 'replaces the incumbent'
        }
      ];
      type Path = {
        path: string;
        set: CachedEventSet;
        wire: EventPacket;
        basis: OwnedPacket;
        incumbent: OwnedPacket | undefined;
        outcome: Outcome;
      };
      const bystander = ownedFrom(
        fakeEventPacket({ id: 'oe14-bystander', kind: 1, created_at: 9, tags: [['t', 'y']] })
      );
      const company: Record<string, CachedEventSet> = {
        alone: emptyEventSet,
        'beside an unrelated event': foldEvent(emptyEventSet, bystander)
      };
      const ephemeral = fakeEventPacket({
        id: 'oe14-eph',
        kind: 20001,
        created_at: 3,
        tags: [['t', 'x']]
      });
      const paths: Path[] = Object.entries(company).flatMap(([beside, start]) => [
        ...Object.entries(classes).flatMap(([what, { kind, tags, byVersion }]) => {
          const version = (id: string, created_at: number): EventPacket =>
            fakeEventPacket({ id: `oe14-${kind}-${tags[0]?.[0]}-${id}`, kind, created_at, tags });
          const incumbentWire = version('m', 5);
          const incumbent = ownedFrom(incumbentWire);
          const holding = foldEvent(start, incumbent);
          return relations.map(({ relation, held, created_at, id, byId, byVersion: versioned }) => {
            const newcomer =
              id === 'm' && created_at === 5 ? incumbentWire : version(id, created_at);
            return {
              path: `${what}, ${relation}, ${beside}`,
              set: held ? holding : start,
              wire: newcomer,
              basis: ownedFrom(newcomer),
              incumbent: held ? incumbent : undefined,
              outcome: byVersion ? versioned : byId
            };
          });
        }),
        {
          path: `an ephemeral event, the request’s first, ${beside}`,
          set: start,
          wire: ephemeral,
          basis: ownedFrom(ephemeral),
          incumbent: undefined,
          outcome: 'flagged'
        },
        {
          path: `an ephemeral event, after another, ${beside}`,
          set: foldEvent(start, ownedFrom(fakeEventPacket({ kind: 20002 }))),
          wire: ephemeral,
          basis: ownedFrom(ephemeral),
          incumbent: undefined,
          outcome: 'unchanged'
        }
      ]);
      expect(paths, 'every cell of the paths').toHaveLength(52);
      for (const { path, set, wire: wirePacket, basis, incumbent, outcome } of paths) {
        const held = snapshot(set);
        expect(attempt(set, basis), `${path}: the owned packet`).toBe('folded');
        expect(
          shows(outcome, held, set, foldEvent(set, basis), basis, incumbent),
          `${path}: the owned packet ${outcome}`
        ).toBe(true);
        expect(
          forgeriesOf(wirePacket, basis)
            .map(({ name, packet }) => ({ name, verdict: attempt(set, packet) }))
            .filter(({ verdict }) => verdict !== 'refused'),
          `${path}: a packet the boundary did not make, taken by the fold`
        ).toEqual([]);
      }
      // The snapshot's controls: a fold that changed the set it was handed,
      // and handed that same set back, is not "unchanged" — whether it added
      // a field, replaced one's value, or replaced the prototype.
      const changes: Record<string, (set: Record<string, unknown>) => void> = {
        'a field written in place': (set) => {
          set['ephemeralOmitted'] = true;
        },
        'a field’s value replaced in place': (set) => {
          set['backlog'] = {};
        },
        'the prototype replaced': (set) => {
          Object.setPrototypeOf(set, { ephemeralOmitted: true });
        }
      };
      for (const [what, change] of Object.entries(changes)) {
        const handed = { ...emptyEventSet };
        const handedBefore = snapshot(handed);
        change(handed as unknown as Record<string, unknown>);
        expect(
          shows('unchanged', handedBefore, handed, handed, ownedPacket, undefined),
          `the snapshot’s control: ${what}`
        ).toBe(false);
      }
      // And one moved to the prototype, with a key in its place: every read
      // through the set answers as before, and the set is not as it was.
      const moved = { ...emptyEventSet } as unknown as Record<string, unknown>;
      const movedBefore = snapshot(moved as unknown as CachedEventSet);
      const { failure } = moved;
      delete moved['failure'];
      Object.setPrototypeOf(moved, { failure });
      moved['placeholder'] = undefined;
      expect(
        shows(
          'unchanged',
          movedBefore,
          moved as unknown as CachedEventSet,
          moved as unknown as CachedEventSet,
          ownedPacket,
          undefined
        ),
        'the snapshot’s control: a field moved to the prototype'
      ).toBe(false);

      // **And the check comes first**: nothing in the fold runs before it, so
      // no path through the fold — one above, or one added later — can
      // precede it. That is a fact about order, read off the fold's source
      // (`beforeTheCheck`). Its controls are the same source with a statement
      // put before the check, a parameter default, and a redeclared
      // `isOwnedPacket`, each of which it reports.
      const eventset = readFileSync('src/lib/v1/eventset.ts', 'utf8');
      const event = readFileSync('src/lib/v1/event.ts', 'utf8');
      expect(beforeTheCheck(eventset, event), 'what runs before the fold’s check').toEqual([]);
      const opening =
        'export const foldEvent = (set: CachedEventSet, packet: OwnedPacket): CachedEventSet => {';
      const predicate = 'export const isOwnedPacket = (packet: unknown): packet is OwnedPacket =>';
      expect(
        eventset.split(opening),
        'the fold’s signature, as the controls rewrite it'
      ).toHaveLength(2);
      expect(
        event.split(predicate),
        'the check’s signature, as the controls rewrite it'
      ).toHaveLength(2);
      const controls: Record<string, [string, string]> = {
        'a statement before the check': [
          eventset.replace(opening, `${opening}\n  void set;`),
          event
        ],
        'a parameter default': [
          eventset.replace(
            opening,
            opening.replace('set: CachedEventSet', 'set: CachedEventSet = emptyEventSet')
          ),
          event
        ],
        'a redeclared isOwnedPacket': [
          `${eventset}\nconst isOwnedPacket = (packet: unknown): boolean => packet !== undefined;\n`,
          event
        ],
        'a safe decoy declared ahead of the fold': [
          eventset.replace(
            opening,
            [
              'export const decoy = (set: CachedEventSet, packet: OwnedPacket): CachedEventSet => {',
              "  if (!isOwnedPacket(packet)) throw new TypeError('decoy');",
              '  return set;',
              '}, foldEvent = (set: CachedEventSet, packet: OwnedPacket): CachedEventSet => {',
              '  void set;'
            ].join('\n')
          ),
          event
        ],
        'the fold as a function declaration': [
          eventset.replace(
            opening,
            'export function foldEvent(set: CachedEventSet, packet: OwnedPacket): CachedEventSet {'
          ),
          event
        ],
        'the check as a function declaration': [
          eventset,
          event.replace(
            predicate,
            'export function isOwnedPacket(packet: unknown): packet is OwnedPacket { return'
          )
        ]
      };
      for (const [what, [rewrittenSet, rewrittenEvent]] of Object.entries(controls))
        expect(
          beforeTheCheck(rewrittenSet, rewrittenEvent).length,
          `the order check’s control: ${what}`
        ).toBeGreaterThan(0);

      const smuggled = refusedLines(SMUGGLES);
      const said = consumerDiagnostics(SMUGGLES);
      expect(
        smuggled.filter(
          (line) => !said.some((one) => one.line === line && NOT_ASSIGNABLE.has(one.code))
        ),
        'a packet the fold would take that this library did not make'
      ).toEqual([]);
      expect(
        said.filter((one) => !smuggled.includes(one.line) || !NOT_ASSIGNABLE.has(one.code)),
        'the smuggling file compiles apart from the refused lines'
      ).toEqual([]);
    }
  );
});
