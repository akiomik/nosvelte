/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The failure channel publishes a value this library made, never one it was
 * handed: `B5-C9`'s landing.
 *
 * `FC1` holds every clause of the row in one arm, so that the landing fails
 * under a mutation of each of them: the copy a foreign value becomes at every
 * entrance it arrives at, and nothing of the caller's kept, frozen or
 * reachable; the bounds, in numbers, and `truncated` derived from each; the
 * door a value belongs to, and the code that follows from it; which of this
 * library's own values pass through, and that the library alone mints them, at
 * the sites where it constructs them; `stack` closed before the freeze; the
 * transport's answer rendered rather than kept; and the vocabulary the channel
 * is typed in. The spike's witnesses, ported, are its supporting arms: `PB6`,
 * `PB7`, `PB8`, `PB10`, `PB12`, `TR20`, `TR21`, `CG1`, `CG11b`, `WI23`, `WI24`
 * and `WI28`.
 *
 * Port band 9300-9339.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { Observable } from 'rxjs';
import { QueryClient } from 'tanstack-svelte-query-v6';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { StreamAccumulator } from '$lib/v1/accumulate.js';
import { createAttemptRegistry, MissingRandomnessError } from '$lib/v1/attempt.js';
import { createNostrContext } from '$lib/v1/context.svelte.js';
import { beginAttempt, emptyEventSet, noteFailure } from '$lib/v1/eventset.js';
import { validateFilter } from '$lib/v1/key.js';
import { MAX_RENDERED, type ReadonlyFilter } from '$lib/v1/normalize.js';
import {
  capture as libraryCapture,
  type FailureSource,
  providerDisposed,
  ReqFailure
} from '$lib/v1/own.js';
import { isOwnedByLibrary, ownedByLibrary, sealOwned } from '$lib/v1/owned.js';
import {
  type CapturedReqError,
  DOOR_OF,
  REQ_ERROR_CODES,
  type ReqError,
  type ReqErrorCode,
  RequestTransportIncompatibleError
} from '$lib/v1/reqerror.js';
import {
  RelayConfigurationError,
  type RelayInput,
  TransportIncompatibleError,
  type TransportKeys
} from '$lib/v1/scope.svelte.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import {
  asAConsumerWould,
  componentAs,
  constructionSites,
  errorClasses,
  everyConstructorCalled,
  MINTERS,
  NOT_AN_ERROR_CLASS,
  oneOfEachClass,
  parsedAs,
  parsedModules,
  whatTheScanCannotRead
} from './helpers/errorclasses.js';
import {
  acceptAnyEvent,
  createTestRelay,
  HARNESS_DIVERGENCES,
  respondWithEose
} from './helpers/relay.js';
import { flush, mount } from './helpers/runes.svelte.js';

const LIBRARY = resolve(dirname(fileURLToPath(import.meta.url)), '../../../lib/v1');

const attempts = createAttemptRegistry();

let port = 9300;
const nextUrl = (): string => `ws://localhost:${(port += 1)}`;

async function settle(ms = 80): Promise<void> {
  await new Promise((done) => setTimeout(done, ms));
  flush();
}

async function waitForReq(server: WS): Promise<string> {
  const message = (await server.nextMessage) as unknown[];
  return String(message[1]);
}

/** What a call threw: an owned value cannot be asked for, only thrown by the boundary that builds it. */
function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (thrown) {
    return thrown;
  }
  throw new Error('the premise: this boundary was expected to refuse, and it returned');
}

/**
 * Every object of the caller's this arm hands to the library, held weakly, for
 * the question the arm ends on: once the arm has let go of all of it, is any of
 * it still held by anything ({@link collected})?
 *
 * **Every one, not a sample, and all of each.** The collector was asked only
 * about values made for a second pass, and a library keeping the first value it
 * saw at each door — the first pass's — left the arm green: measured. Then only
 * the value handed in was noted, not what hangs off it, and a library keeping
 * the caller's node past the depth bound, or the array a transport answered
 * with, left it green again: measured. So everything a value handed in holds
 * ({@link heldBy}) is noted, and every transport adapter is {@link noted}.
 */
const handedIn: { label: string; ref: WeakRef<object> }[] = [];
function theirOwn<T>(label: string, value: T): T {
  for (const node of heldBy(value)) handedIn.push({ label, ref: new WeakRef(node) });
  return value;
}

/**
 * The objects a value holds by its own data: through every own data slot,
 * names and symbols, and through a `Map`'s or a `Set`'s contents — not through
 * an accessor's functions or a prototype, which are the platform's as often as
 * the caller's (every `Error` here carries the realm's own `stack` accessor,
 * which nothing ever lets go of). A read that is refused ends that branch.
 */
function heldBy(root: unknown): Set<object> {
  const held = new Set<object>();
  // A worklist rather than recursion: a chain of twenty thousand ordinary
  // objects overflowed the stack, the overflow was caught as a refused read,
  // and the tail went unnoted without a word — measured.
  const waiting: unknown[] = [];
  const add = (value: unknown): void => {
    if ((typeof value === 'object' || typeof value === 'function') && value !== null)
      waiting.push(value);
  };
  add(root);
  while (waiting.length > 0) {
    const value = waiting.pop() as object;
    if (held.has(value)) continue;
    held.add(value);
    // **A proxy is noted and not opened.** Opening one runs its traps, and a
    // trap can change the very value the boundary is about to be handed — the
    // instrument altering its stimulus, measured. What it wraps is reachable
    // only through it.
    if (types.isProxy(value)) continue;
    let keys: (string | symbol)[] = [];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      // Keys that refuse to be read hold nothing this can reach.
    }
    for (const key of keys) {
      let slot: PropertyDescriptor | undefined;
      try {
        slot = Reflect.getOwnPropertyDescriptor(value, key);
      } catch {
        // A slot that refuses to be read holds nothing this can reach.
      }
      if (slot !== undefined && 'value' in slot) add(slot.value);
    }
    try {
      Map.prototype.forEach.call(value, (member: unknown, key: unknown) => {
        add(key);
        add(member);
      });
    } catch {
      // Not a `Map`.
    }
    try {
      Set.prototype.forEach.call(value, add);
    } catch {
      // Not a `Set`.
    }
  }
  return held;
}

/**
 * A transport adapter whose every answer, and everything it throws, is noted as
 * handed in — the arrays it answers with included, which the arrangements build
 * and a library could keep.
 */
const noted =
  (transportKeys: TransportKeys): TransportKeys =>
  (urls) => {
    let answer: readonly string[];
    try {
      answer = transportKeys(urls);
    } catch (thrown) {
      throw theirOwn('what a transport threw', thrown);
    }
    return theirOwn('a transport’s answer', answer);
  };

/** The boundary, with what it is handed noted as handed in. */
const capture = (thrown: unknown, source: FailureSource): ReqError =>
  libraryCapture(theirOwn('a value handed to the boundary', thrown), source);

/**
 * A proxy over a target of the arm's own, the target and what it holds noted
 * first. {@link heldBy} does not open a proxy, so a library that read a child
 * through the proxy and kept it would otherwise keep something never noted —
 * measured, the landing green.
 */
function proxied<T extends object>(label: string, target: T, handler: ProxyHandler<T>): T {
  return new Proxy(theirOwn(label, target), handler);
}

// **"Kept" is asked of the heap, not of the stores this arm knows about.** A
// walk can only read the stores it is pointed at, and a module-private `Set`
// the boundary added a thrown value to — or a closure holding one — is in none
// of them: measured, both left the walks green. Whether an object is still
// held by anything at all is a question the collector answers.
setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

/**
 * Whether each object is gone after a full collection, which is whether
 * anything at all still holds it. Between turns, because a `WeakRef` read in
 * this turn keeps its target alive until the turn ends.
 */
async function collected(refs: readonly WeakRef<object>[]): Promise<boolean[]> {
  for (let round = 0; round < 2; round += 1) {
    await new Promise((done) => setTimeout(done, 0));
    collectGarbage();
  }
  return refs.map((ref) => ref.deref() === undefined);
}

/**
 * The platform's prototypes and this library's own, by name: a walk records
 * them and does not go into them, since every object reaches `Object` through
 * one. Any other prototype is a node like any other.
 */
const INTRINSIC = new Map<object | null, string>([
  [null, 'null'],
  [Object.prototype, 'Object.prototype'],
  [Function.prototype, 'Function.prototype'],
  [Array.prototype, 'Array.prototype'],
  [Map.prototype, 'Map.prototype'],
  [Set.prototype, 'Set.prototype'],
  [Error.prototype, 'Error.prototype'],
  [AggregateError.prototype, 'AggregateError.prototype'],
  [EvalError.prototype, 'EvalError.prototype'],
  [RangeError.prototype, 'RangeError.prototype'],
  [ReferenceError.prototype, 'ReferenceError.prototype'],
  [SyntaxError.prototype, 'SyntaxError.prototype'],
  [TypeError.prototype, 'TypeError.prototype'],
  [URIError.prototype, 'URIError.prototype']
]);
for (const [name, build] of Object.entries(oneOfEachClass())) {
  let prototype = Reflect.getPrototypeOf(build());
  while (prototype !== null && !INTRINSIC.has(prototype)) {
    INTRINSIC.set(prototype, `${name}'s prototype`);
    prototype = Reflect.getPrototypeOf(prototype);
  }
}

/**
 * Everything reachable from `root`: through every own slot, names and symbols,
 * enumerable or not — a data slot's value and an accessor's two functions —
 * through the contents of a `Map` or a `Set`, and through a prototype that is
 * not the platform's or this library's.
 *
 * **A read that is refused is reported, never skipped.** This walk used to
 * `continue` past a descriptor that threw and return early on keys that did,
 * and it did not open accessors, prototypes or collections at all — so a getter
 * answering the caller's `Error`, a prototype that was their object, or a `Map`
 * holding it, each certified "nothing of theirs reachable" — measured. `unread`
 * names what could not be read, and a walk with anything in it vouches for
 * nothing. What it still cannot open is a closure, which is why "kept" is also
 * asked of the collector ({@link collected}).
 */
function walk(root: unknown): { nodes: Set<object>; unread: string[] } {
  const nodes = new Set<object>();
  const unread: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
    if (nodes.has(value)) return;
    nodes.add(value);
    let keys: (string | symbol)[];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      unread.push(`${path}: its keys`);
      return;
    }
    for (const key of keys) {
      let slot: PropertyDescriptor | undefined;
      try {
        slot = Reflect.getOwnPropertyDescriptor(value, key);
      } catch {
        unread.push(`${path}.${String(key)}`);
        continue;
      }
      if (slot === undefined) unread.push(`${path}.${String(key)}: listed, and not there`);
      else if ('value' in slot) visit(slot.value, `${path}.${String(key)}`);
      else {
        visit(slot.get, `${path}.get ${String(key)}`);
        visit(slot.set, `${path}.set ${String(key)}`);
      }
    }
    let prototype: object | null;
    try {
      prototype = Reflect.getPrototypeOf(value);
    } catch {
      unread.push(`${path}: its prototype`);
      return;
    }
    if (!INTRINSIC.has(prototype)) visit(prototype, `${path}.[[Prototype]]`);
    // A `Map`'s and a `Set`'s contents are not slots. The platform's own
    // `forEach` refuses anything that is not one, which is how it is asked.
    try {
      Map.prototype.forEach.call(value, (member: unknown, key: unknown) => {
        visit(key, `${path} key`);
        visit(member, `${path} entry`);
      });
    } catch {
      // Not a `Map`.
    }
    try {
      Set.prototype.forEach.call(value, (member: unknown) => visit(member, `${path} member`));
    } catch {
      // Not a `Set`.
    }
  };
  visit(root, 'root');
  return { nodes, unread };
}

/** An identity for every object a shape has seen, held weakly: the same object is the same token every time. */
const identities = new WeakMap<object, number>();
let issued = 0;
const identityOf = (value: object): string => {
  const named = INTRINSIC.get(value);
  if (named !== undefined) return named;
  let id = identities.get(value);
  if (id === undefined) {
    id = issued += 1;
    identities.set(value, id);
  }
  return `#${String(id)}`;
};
const tokenOf = (value: unknown): string =>
  (typeof value === 'object' || typeof value === 'function') && value !== null
    ? identityOf(value)
    : typeof value === 'symbol'
      ? value.toString()
      : `${typeof value}:${String(value)}`;

/**
 * The caller's graph as it stands: for every object {@link walk} reaches, which
 * object it is, its prototype, whether it is extensible and frozen, every own
 * slot — a data slot's value, an accessor's functions, each flag — and a
 * collection's contents. Compared before and after the boundary, so "untouched"
 * is read off the whole graph rather than off the object handed in.
 *
 * **Objects are named by identity, not by where the walk met them**: a getter
 * swapped for another with the same flags stood at the same position in the
 * walk and compared equal, and so did a prototype set to `null` and a write
 * inside a `Map` — measured, all three. A token per object, kept in a
 * `WeakMap` so that naming an object does not hold it.
 */
function shapeOf(root: object): string {
  const { nodes, unread } = walk(root);
  return JSON.stringify({
    unread,
    nodes: [...nodes].map((node) => {
      const slots = Reflect.ownKeys(node).map((key) => {
        const slot = Reflect.getOwnPropertyDescriptor(node, key) as PropertyDescriptor;
        return [
          String(key),
          'value' in slot
            ? ['data', slot.writable, tokenOf(slot.value)]
            : ['accessor', tokenOf(slot.get), tokenOf(slot.set)],
          slot.enumerable,
          slot.configurable
        ];
      });
      const contents: string[] = [];
      try {
        Map.prototype.forEach.call(node, (member: unknown, key: unknown) =>
          contents.push(`${tokenOf(key)}=>${tokenOf(member)}`)
        );
      } catch {
        // Not a `Map`.
      }
      try {
        Set.prototype.forEach.call(node, (member: unknown) => contents.push(tokenOf(member)));
      } catch {
        // Not a `Set`.
      }
      return {
        node: identityOf(node),
        prototype: tokenOf(Reflect.getPrototypeOf(node)),
        extensible: Object.isExtensible(node),
        frozen: Object.isFrozen(node),
        slots,
        contents
      };
    })
  });
}

/**
 * What is open about a published value, a line each: every object reachable
 * from it has to be closed, hold no accessor and no function, and be this
 * library's if it is an `Error`. Empty is the claim; a walk with anything
 * unread is not empty.
 */
function openings(published: unknown, label: string): string[] {
  const { nodes, unread } = walk(published);
  const found = unread.map((path) => `${label}: could not read ${path}`);
  for (const node of nodes) {
    if (typeof node === 'function') found.push(`${label}: a function reachable`);
    if (!Object.isFrozen(node)) found.push(`${label}: a node still open`);
    for (const key of Reflect.ownKeys(node)) {
      const slot = Reflect.getOwnPropertyDescriptor(node, key);
      if (slot !== undefined && !('value' in slot))
        found.push(`${label}: an accessor at ${String(key)}`);
    }
    if (node instanceof Error && !isOwnedByLibrary(node))
      found.push(`${label}: an Error this library did not mint`);
  }
  return found;
}

/** A caller's Error with a graph under it: a non-enumerable `cause`, and a member of their own. */
function theirs(message: string) {
  const leaf = { note: 'as they left it' };
  const middle = new Error('what it points at', { cause: leaf });
  const error = new Error(message, { cause: middle });
  const own = { mine: 'as they left it' };
  Object.defineProperty(error, 'theirs', {
    value: own,
    enumerable: false,
    writable: true,
    configurable: true
  });
  for (const one of [error, middle, leaf, own]) theirOwn('a caller’s Error and its graph', one);
  return { error, middle, leaf, own };
}

/** What arrived at an entrance: what it published, the second surface's value, what the library keeps, and the teardown. */
type Arrival = { published: unknown; again?: unknown; kept: unknown; done: () => void };

describe('the failure channel publishes a value this library made, never one it was handed', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => WS.clean());

  // @contracts B5-C9
  it(
    'FC1: a foreign failure is copied at every door it arrives at, bounded and attributed, and only what this library made and closed passes through',
    { timeout: 90_000 },
    async () => {
      const failures: string[] = [];
      // **What this library keeps**, beside what it publishes: every entry of
      // the query cache, its data and its error — the query library's own
      // `error` and `failureReason` included, which no published surface hands
      // out and which kept the caller's object when an entrance did not copy.
      const cached = (): unknown[] =>
        client
          .getQueryCache()
          .getAll()
          .map((entry) => entry.state);
      const NAMES = {
        descriptor: 'descriptor-unreadable',
        relay: 'relay-failed',
        unspecified: 'unspecified'
      } as const;
      const DOOR_NAMES = ['descriptor', 'relay', 'unspecified'] as const;

      const cut = (length: number): string => 'x'.repeat(length);
      // Every character different from its neighbour, so that which 200 are
      // kept is read, not only how many.
      const varied = (length: number): string =>
        Array.from({ length }, (_, at) => String.fromCharCode(65 + (at % 26))).join('');
      const named = (name: string, message = 'short'): Error =>
        Object.defineProperty(new Error(message), 'name', { value: name });
      const chain = (depth: number): Error => {
        let link: Error = new Error(String(depth));
        for (let at = depth - 1; at >= 1; at -= 1) link = new Error(String(at), { cause: link });
        return link;
      };
      const of = (value: unknown): ReqFailure => capture(value, 'relay') as ReqFailure;
      const RELAYS = ['wss://a.example', 'wss://b.example'];

      // **The instruments' controls**, each a case the instrument would have
      // to get wrong for the checks below to pass wrongly.
      await (async (): Promise<void> => {
        {
          const control = theirs('a control');
          const { nodes } = walk(control.error);
          expect(nodes.has(control.leaf), 'the walk: a node two non-enumerable links down').toBe(
            true
          );
          const behind = { theirs: 'behind a getter' };
          const getter = (): object => behind;
          const accessed = Object.defineProperty({}, 'held', { get: getter, enumerable: false });
          expect(walk(accessed).nodes.has(getter), 'the walk: an accessor’s function').toBe(true);
          expect(walk(Object.create(behind)).nodes.has(behind), 'the walk: a prototype').toBe(true);
          expect(
            [
              walk(new Map([['key', behind]])).nodes.has(behind),
              walk(new Map([[behind, 'value']])).nodes.has(behind),
              walk(new Set([behind])).nodes.has(behind)
            ],
            'the walk: a Map’s values and keys, and a Set’s members'
          ).toEqual([true, true, true]);
          const refusing = (trap: 'ownKeys' | 'getOwnPropertyDescriptor' | 'getPrototypeOf') =>
            walk(
              new Proxy(
                { a: 1 },
                {
                  [trap]: (): never => {
                    throw new Error('refused');
                  }
                }
              )
            ).unread.length;
          expect(
            [refusing('ownKeys'), refusing('getOwnPropertyDescriptor'), refusing('getPrototypeOf')],
            'the walk: a refused read is reported, whichever it is'
          ).toEqual([1, 1, 1]);

          const before = shapeOf(control.error);
          control.leaf.note = 'written';
          expect(shapeOf(control.error) === before, 'the shape: a write two links down').toBe(
            false
          );
          const swapped = theirs('a swapped getter');
          Object.defineProperty(swapped.middle, 'stack', {
            get: () => 'the first',
            configurable: true
          });
          const withGetter = shapeOf(swapped.error);
          Object.defineProperty(swapped.middle, 'stack', {
            get: () => 'the second',
            configurable: true
          });
          expect(
            shapeOf(swapped.error) === withGetter,
            'the shape: an accessor swapped for another with the same flags'
          ).toBe(false);
          const reparented = theirs('a prototype');
          const parented = shapeOf(reparented.error);
          Object.setPrototypeOf(reparented.middle, null);
          expect(shapeOf(reparented.error) === parented, 'the shape: a prototype set').toBe(false);
          const holding = { map: new Map([['a', 1]]) };
          const mapped = shapeOf(holding);
          holding.map.set('a', 2);
          expect(shapeOf(holding) === mapped, 'the shape: a write inside a Map').toBe(false);

          // Each control answers to one branch and no other: an accessor with no
          // functions, so the function branch cannot answer for it, and an
          // `Error` whose `stack` is data, since the platform's is an accessor.
          const notOurs = new Error('not ours');
          // A descriptor whose `set` is present and `undefined`: an accessor with neither function.
          const noSetter = undefined as unknown as (value: unknown) => void;
          Object.defineProperty(notOurs, 'stack', { value: 'a stack', writable: false });
          expect(
            [
              openings(Object.freeze({ a: {} }), 'x'),
              openings(Object.freeze(Object.defineProperty({}, 'y', { set: noSetter })), 'x'),
              openings(Object.freeze({ f: Object.freeze(() => 1) }), 'x'),
              openings(Object.freeze(notOurs), 'x'),
              openings(Object.freeze({ a: Object.freeze({}) }), 'x')
            ],
            'openings: an open node, an accessor, a function, a foreign Error, each by its own line; and a closed graph has none'
          ).toEqual([
            ['x: a node still open'],
            ['x: an accessor at y'],
            ['x: a function reachable'],
            ['x: an Error this library did not mint'],
            []
          ]);

          const retained = new Set<object>();
          const refs = (() => {
            const free = { free: true };
            const kept = { kept: true };
            retained.add(kept);
            return [new WeakRef(free), new WeakRef(kept)];
          })();
          expect(
            await collected(refs),
            'the collector: an object nothing holds is gone, and one a Set holds is not'
          ).toEqual([true, false]);
          const noted = (one: object): boolean => handedIn.some(({ ref }) => ref.deref() === one);
          const hanging = { hangs: 'off what is handed in' };
          const asKey = { a: 'Map key' };
          const asValue = { a: 'Map value' };
          const asMember = { a: 'Set member' };
          let tail: { next?: object } = {};
          const chain = tail;
          for (let link = 0; link < 20_000; link += 1) {
            const next = {};
            tail.next = next;
            tail = next;
          }
          let trapped = 0;
          const watched = new Proxy(
            { inside: true },
            {
              ownKeys: (target): (string | symbol)[] => {
                trapped += 1;
                return Reflect.ownKeys(target);
              }
            }
          );
          const behindTheProxy = { a: 'behind a proxy the noting does not open' };
          theirOwn('the noting’s control', {
            holds: [hanging],
            map: new Map([[asKey, asValue]]),
            set: new Set([asMember]),
            chain,
            watched,
            fronted: proxied('the noting’s control', { behindTheProxy }, {})
          });
          expect(
            [
              noted(hanging),
              noted(asKey),
              noted(asValue),
              noted(asMember),
              noted(tail),
              noted(watched),
              noted(behindTheProxy),
              trapped,
              [...heldBy(null), ...heldBy(undefined), ...heldBy(1), ...heldBy('thrown')].length
            ],
            'the noting: what hangs off a value, a Map’s keys and values, a Set’s members and the end of a long chain are noted too; a proxy is noted and not opened'
          ).toEqual([true, true, true, true, true, true, true, 0, 0]);
          retained.clear();
        }
      })();

      // **(1) The copy, at every entrance a foreign value arrives at.** Not
      // `capture` alone: each door is the library's own call site, so a site
      // that published what it was handed fails here, whatever `capture` does.
      // The descriptor boundary, the accumulator, the failure writer the
      // library's own code calls, the forward leg's `error` handler — where a
      // transport's own object arrives — and the attempt registry the query
      // function asks before its `try`. Each takes the thrown value as a
      // function, so that the second pass below can hand it one nothing else
      // holds.
      const hookEntrance =
        (name: string, options: (produce: () => unknown) => Record<string, unknown>, wait = 200) =>
        async (produce: () => unknown): Promise<Arrival> => {
          const { rxNostr } = createTestRelay(nextUrl());
          const held = mount(() =>
            useStreamedReq(() => ({
              verifyEvent: acceptAnyEvent,
              attempts,
              rxNostr,
              client,
              namespace: `fc1-${name}-${port}`,
              filters: [{ kinds: [1] }],
              reqIdBase: `fc1-${name}`,
              settleTimeoutMs: 300,
              ...options(produce)
            }))
          );
          await settle(wait);
          return {
            published: (held.value.state as { error?: unknown }).error,
            again: held.value.diagnostics.lastError,
            kept: cached(),
            done: () => held.destroy()
          };
        };
      const entrances: [
        string,
        (produce: () => unknown) => Promise<Arrival>,
        keyof typeof NAMES
      ][] = [
        [
          'the descriptor boundary',
          hookEntrance(
            'descriptor',
            (produce) => ({
              filters: [
                {
                  get kinds(): number[] {
                    throw produce();
                  }
                } as unknown as { kinds: number[] }
              ]
            }),
            120
          ),
          'descriptor'
        ],
        [
          'the accumulator',
          hookEntrance('accumulator', (produce) => ({
            accumulator: (() => async () => {
              throw produce();
            }) as StreamAccumulator
          })),
          'unspecified'
        ],
        [
          'the failure writer the library calls',
          async (produce) => {
            const attemptId = attempts.mint();
            const written = noteFailure(
              beginAttempt(emptyEventSet, attemptId),
              attemptId,
              produce()
            );
            return { published: written.failure?.error, kept: written, done: () => undefined };
          },
          'unspecified'
        ],
        [
          'the forward leg’s error handler',
          async (produce) => {
            const { rxNostr, server } = createTestRelay(nextUrl());
            let failForward: ((reason: unknown) => void) | undefined;
            const use = rxNostr.use.bind(rxNostr);
            (rxNostr as { use: typeof rxNostr.use }).use = ((...args: Parameters<typeof use>) => {
              const source = use(...args);
              if (failForward !== undefined) return source;
              const failable = new Observable((subscriber) => {
                const inner = source.subscribe({
                  next: (packet) => subscriber.next(packet),
                  error: (reason: unknown) => subscriber.error(reason),
                  complete: () => subscriber.complete()
                });
                failForward = (reason) => subscriber.error(reason);
                return () => inner.unsubscribe();
              });
              return failable as ReturnType<typeof use>;
            }) as typeof rxNostr.use;
            const held = mount(() =>
              useStreamedReq(() => ({
                verifyEvent: acceptAnyEvent,
                attempts,
                rxNostr,
                client,
                namespace: `fc1-forward-${port}`,
                filters: [{ kinds: [1] }],
                live: true,
                retain: 'unbounded',
                reqIdBase: 'fc1-forward',
                settleTimeoutMs: 300
              }))
            );
            respondWithEose(server, await waitForReq(server));
            await settle(120);
            expect(
              failForward,
              'the premise: the forward leg was opened and is wrapped'
            ).toBeDefined();
            failForward?.(produce());
            await settle(150);
            return {
              published: held.value.diagnostics.legEnded?.error,
              again: held.value.diagnostics.legEnded?.error,
              kept: cached(),
              done: () => held.destroy()
            };
          },
          'relay'
        ],
        [
          'the attempt registry, before the query function’s try',
          hookEntrance('registry', (produce) => {
            const registry = createAttemptRegistry();
            return {
              attempts: {
                ...registry,
                begin: (): never => {
                  throw produce();
                }
              }
            };
          }),
          'unspecified'
        ]
      ];
      // Every entrance but the writer, which hands back one record, has a
      // second surface to read.
      expect(entrances.length, 'the premise: five entrances, four of them through a hook').toBe(5);

      await (async (): Promise<void> => {
        for (const [entrance, arrive, door] of entrances) {
          const { error, middle, leaf, own } = theirs(`thrown at ${entrance}`);
          const caller = [error, middle, leaf, own];
          const before = shapeOf(error);
          const { published, again, kept, done } = await arrive(() => error);
          const failure = published as ReqFailure | undefined;
          expect(failure, `${entrance}: the premise, a failure published`).toBeInstanceOf(Error);
          if (published === error) failures.push(`${entrance}: published the value it was handed`);
          if (!isOwnedByLibrary(published))
            failures.push(`${entrance}: published a value this library did not mint`);
          expect(
            [failure?.name, failure?.thrownName, failure?.message, failure?.source, failure?.code],
            `${entrance}: a copy — the name, what it called itself, its words, the door and its code`
          ).toEqual(['ReqFailure', 'Error', `thrown at ${entrance}`, door, NAMES[door]]);
          expect(
            [
              failure?.cause?.message,
              (failure?.cause as ReqFailure | undefined)?.source,
              failure?.cause?.code
            ],
            `${entrance}: the cause, copied, at the same door`
          ).toEqual(['what it points at', door, NAMES[door]]);
          expect(shapeOf(error), `${entrance}: the caller’s graph, untouched`).toBe(before);
          failures.push(...openings(published, entrance));
          const ours = walk(published).nodes;
          expect(
            caller.filter((one) => ours.has(one)),
            `${entrance}: nothing of the caller’s reachable from what is published`
          ).toEqual([]);
          const held = walk(kept);
          expect(held.unread, `${entrance}: what is kept, read whole`).toEqual([]);
          expect(
            held.nodes.has(published as object),
            `${entrance}: the premise, what is kept holds what was published`
          ).toBe(true);
          expect(
            caller.filter((one) => held.nodes.has(one)),
            `${entrance}: nothing of the caller’s kept by this library, published or not`
          ).toEqual([]);
          if (entrance !== 'the failure writer the library calls')
            expect(again, `${entrance}: and it is one object on both surfaces`).toBe(published);
          // A later write to their graph changes nothing published.
          error.message = 'REWRITTEN';
          leaf.note = 'REWRITTEN';
          middle.message = 'REWRITTEN';
          own.mine = 'REWRITTEN';
          expect(
            [failure?.message, failure?.cause?.message],
            `${entrance}: a later write to their graph changes nothing published`
          ).toEqual([`thrown at ${entrance}`, 'what it points at']);
          done();
        }
      })();

      // **And nothing of theirs is held at all**, asked of the collector: the
      // same entrances, handed a value nothing but the library could hold,
      // while what it published is still held and the hook still mounted.
      await (async (): Promise<void> => {
        for (const [entrance, arrive] of entrances) {
          const refs: WeakRef<object>[] = [];
          const arrival = await arrive(() => {
            const made = theirs(`thrown at ${entrance}, to be let go`);
            for (const one of [made.error, made.middle, made.leaf, made.own])
              refs.push(new WeakRef(one));
            return made.error;
          });
          const gone = await collected(refs);
          if (refs.length === 0) failures.push(`${entrance}: the premise, nothing was thrown`);
          if (gone.includes(false))
            failures.push(`${entrance}: something of the caller’s is still held by this library`);
          if (!isOwnedByLibrary(arrival.published))
            failures.push(`${entrance}: the second pass published nothing of its own`);
          arrival.done();
        }
      })();

      // **The query library's own value, which no caller throws**: a
      // cancellation that does not revert is written to the query's `error`
      // without the query function rejecting with it, so the reader is the
      // only door it passes. It is copied there, once per state: one object
      // however often, and on both surfaces.
      await (async (): Promise<void> => {
        {
          const { rxNostr, server } = createTestRelay(nextUrl());
          const held = mount(() =>
            useStreamedReq(() => ({
              verifyEvent: acceptAnyEvent,
              attempts,
              rxNostr,
              client,
              namespace: `fc1-cancelled-${port}`,
              filters: [{ kinds: [1] }],
              reqIdBase: 'fc1-cancelled',
              settleTimeoutMs: 5_000
            }))
          );
          await waitForReq(server);
          await client.cancelQueries(undefined, { revert: false });
          await settle(120);
          const first = (held.value.state as { error?: unknown }).error as ReqFailure | undefined;
          const second = (held.value.state as { error?: unknown }).error;
          const last = held.value.diagnostics.lastError;
          expect(
            [isOwnedByLibrary(first), first?.source, first?.code],
            'the query library’s cancellation: copied, at the door that cannot attribute it'
          ).toEqual([true, 'unspecified', 'unspecified']);
          expect(
            [second === first, last === first],
            'one object, read twice and on both surfaces'
          ).toEqual([true, true]);
          failures.push(...openings(first, 'the cancellation'));
          held.destroy();
        }
      })();

      // **(2) The values that used to break the boundary, at the entrance a
      // consumer can reach**, and directly at every door: none of them throws
      // out of it, each is recorded as a copy, and each says what it was.
      await (async (): Promise<void> => {
        const refusing = proxied(
          'a hostile value',
          new Error('refuses to be frozen', { cause: { theirs: 'behind a proxy' } }),
          { preventExtensions: (): boolean => false }
        );
        const partway = proxied('a hostile value', new Error('the freeze fails part-way'), {
          defineProperty: (target, key, slot): boolean => {
            if (key === 'message') throw new Error('defineProperty refused part-way');
            return Reflect.defineProperty(target, key, slot);
          }
        });
        const revoked = Proxy.revocable(theirOwn('a hostile value', {}), {});
        revoked.revoke();
        const members = theirOwn('an AggregateError’s members', [
          theirOwn('a member', new Error('the first member')),
          theirOwn('a member', { a: 'plain member' })
        ]);
        const aggregate = new AggregateError(members, 'several at once');
        const aggregateShape = shapeOf(aggregate);
        const theirGraph = theirOwn('a graph on a consumer’s ReqFailure', { mutable: 1 });
        const forgedFailure = new ReqFailure({
          thrownName: 'Error',
          message: 'forged at the door it names',
          source: 'descriptor',
          truncated: false,
          cause: theirGraph as unknown as CapturedReqError
        });
        const hostile: [string, unknown, string][] = [
          ['an Error that refuses to be frozen', refusing, 'Error'],
          [
            'an Error minted in another realm',
            runInNewContext('new Error("another realm")'),
            'Error'
          ],
          [
            'a proxy that answers `instanceof Error` over a plain object',
            proxied(
              'a hostile value',
              { message: 'not really an Error' },
              { getPrototypeOf: (): object => Error.prototype }
            ),
            'a thrown object'
          ],
          ['a proxy whose defineProperty throws part-way', partway, 'Error'],
          [
            'an Error whose cause is a revoked proxy',
            new Error('outer', { cause: revoked.proxy }),
            'Error'
          ],
          ['an AggregateError', aggregate, 'AggregateError'],
          ['a ReqFailure a consumer constructed', forgedFailure, 'ReqFailure']
        ];
        const [, descriptorEntrance] = entrances[0] as (typeof entrances)[number];
        for (const [what, value, thrownName] of hostile) {
          for (const door of DOOR_NAMES) {
            let captured: ReqError | undefined;
            expect(() => {
              captured = capture(value, door);
            }, `${what} at ${door}: capturing never throws`).not.toThrow();
            expect(captured, `${what} at ${door}: a copy, at the door it arrived at`).toMatchObject(
              {
                source: door,
                code: NAMES[door],
                thrownName
              }
            );
            if (captured === value) failures.push(`${what} at ${door}: published as itself`);
            failures.push(...openings(captured, `${what} at ${door}`));
          }
          const { published, done } = await descriptorEntrance(() => value);
          expect(
            published,
            `${what}, through the descriptor boundary: recorded as a copy`
          ).toMatchObject({
            name: 'ReqFailure',
            source: 'descriptor',
            thrownName
          });
          if (published === value) failures.push(`${what}: the descriptor boundary published it`);
          done();
        }
        expect(Object.isExtensible(refusing), 'the refusing Error is as it was').toBe(true);
        expect(shapeOf(aggregate), 'the AggregateError and its members, untouched').toBe(
          aggregateShape
        );
        expect(
          [...walk(capture(aggregate, 'relay')).nodes].filter(
            (one) => one === members || members.includes(one as never)
          ),
          'and nothing of its members reachable from the copy'
        ).toEqual([]);
        const forgedCopy = capture(forgedFailure, 'descriptor') as ReqFailure;
        expect(
          [
            forgedCopy === forgedFailure,
            isOwnedByLibrary(forgedCopy.cause),
            walk(forgedCopy).nodes.has(theirGraph)
          ],
          'a consumer’s ReqFailure is not ours, whatever it says: copied, its cause copied too, their graph not on it'
        ).toEqual([false, true, false]);
      })();

      // **(3) The bounds, in numbers, and `truncated` derived from every one.**
      await (async (): Promise<void> => {
        expect(MAX_RENDERED, 'the bound the record publishes').toBe(200);
        expect(
          [of(new Error(cut(200))).message.length, of(new Error(cut(200))).truncated],
          'a message at the bound is kept whole'
        ).toEqual([200, false]);
        expect(
          [
            of(new Error(cut(201))).message.length,
            of(new Error(cut(201))).message.endsWith('… (cut)'),
            of(new Error(cut(201))).truncated
          ],
          'one past it is cut to 200 and the marker, 207, and says so'
        ).toEqual([207, true, true]);
        expect(
          [of(new Error(varied(201))).message, of(named(varied(201))).thrownName],
          'and what is kept is the first 200, of the message and of the name'
        ).toEqual([`${varied(200)}… (cut)`, `${varied(200)}… (cut)`]);
        expect(
          [of(named(cut(200))).thrownName.length, of(named(cut(200))).truncated],
          'a name at the bound is kept whole'
        ).toEqual([200, false]);
        expect(
          [of(named(cut(201))).thrownName.length, of(named(cut(201))).truncated],
          'a name past it is cut the same way, and says so'
        ).toEqual([207, true]);
        expect(
          [of(new Error('')).message, of(new Error('')).truncated],
          'an empty message is a message: kept, empty'
        ).toEqual(['', false]);
        const causeOf = (cause: unknown): [string | undefined, string | undefined] => {
          const copied = of(new Error('with a cause', { cause })).cause as ReqFailure | undefined;
          return [copied?.thrownName, copied?.message];
        };
        expect(
          [causeOf(0), causeOf(false), causeOf(''), causeOf(null), causeOf(undefined)],
          'a cause that is there is copied however falsy, and one that is null or undefined is none'
        ).toEqual([
          ['a thrown number', '0'],
          ['a thrown boolean', 'false'],
          ['a thrown string', '""'],
          [undefined, undefined],
          [undefined, undefined]
        ]);
        expect(
          of({ message: 'short', truncated: true }).truncated,
          'a value that says it was cut, and was not, is not published as cut'
        ).toBe(false);
        const three = of(chain(3));
        expect(
          [three.cause?.cause?.message, three.cause?.cause?.cause, three.truncated],
          'three nodes, counting the thrown value: copied whole'
        ).toEqual(['3', undefined, false]);
        const longer = chain(4);
        const longerShape = shapeOf(longer);
        const four = of(longer);
        expect(
          [four.cause?.cause?.message, four.cause?.cause?.cause, four.truncated],
          'a fourth is not copied, and the cut is published'
        ).toEqual(['3', undefined, true]);
        expect(
          shapeOf(longer),
          'and the chain past the bound is the caller’s, untouched by the cut'
        ).toBe(longerShape);
        for (const door of DOOR_NAMES) {
          const copied = capture(chain(3), door) as ReqFailure;
          const nodes = [copied, copied.cause, copied.cause?.cause] as (ReqFailure | undefined)[];
          expect(
            nodes.map((node) => [node?.source, node?.code]),
            `every node copied at ${door} is attributed there`
          ).toEqual(nodes.map(() => [door, NAMES[door]]));
          failures.push(...openings(copied, `a chain copied at ${door}`));
        }
        expect(
          of(new Error('short', { cause: new Error(cut(201)) })).truncated,
          'a cut message below the root is the root’s cut too'
        ).toBe(true);
        expect(
          of(new Error('short', { cause: named(cut(201)) })).truncated,
          'and a cut name below it'
        ).toBe(true);
        expect(
          (capture(of(chain(4)), 'descriptor') as ReqFailure).truncated,
          'a value already cut keeps the fact when it is captured again at another door'
        ).toBe(true);
      })();

      // **(4) The door a value belongs to, and the code that follows from it.**
      // Written out rather than read from `DOOR_OF`, which is what is under
      // test here.
      await (async (): Promise<void> => {
        const DOORS: Readonly<Record<ReqErrorCode, keyof typeof NAMES>> = {
          'invalid-descriptor': 'descriptor',
          'unsupported-filter': 'descriptor',
          'relay-not-in-scope': 'descriptor',
          'transport-incompatible': 'descriptor',
          'descriptor-unreadable': 'descriptor',
          'relay-failed': 'relay',
          'incomplete-result': 'unspecified',
          'accumulator-contract': 'unspecified',
          'provider-disposed': 'unspecified',
          'missing-provider': 'unspecified',
          unspecified: 'unspecified'
        };
        expect([...REQ_ERROR_CODES].sort(), 'the table is the channel’s own set').toEqual(
          Object.keys(DOORS).sort()
        );
        expect(
          REQ_ERROR_CODES.filter((code) => DOOR_OF[code] !== DOORS[code]),
          'the library’s map from code to door is this one'
        ).toEqual([]);
        const minted = (code: ReqErrorCode): ReqError =>
          code === 'transport-incompatible'
            ? (ownedByLibrary(
                new RequestTransportIncompatibleError('a relay its transport cannot name')
              ) as unknown as ReqError)
            : (ownedByLibrary(
                Object.assign(new Error(`a ${code} value`), {
                  code,
                  thrownName: 'Error',
                  truncated: false,
                  ...(['descriptor-unreadable', 'relay-failed', 'unspecified'].includes(code)
                    ? { source: DOORS[code] }
                    : {})
                })
              ) as unknown as ReqError);
        for (const code of REQ_ERROR_CODES)
          for (const door of DOOR_NAMES) {
            const value = minted(code);
            const out = capture(value, door);
            const through = door === 'unspecified' || DOORS[code] === door;
            if ((out === value) !== through)
              failures.push(
                `${code} at ${door}: ${out === value ? 'handed through' : 're-derived'}`
              );
            if (out !== value && out.code !== NAMES[door])
              failures.push(`${code} re-derived at ${door} as ${out.code}`);
          }
        for (const door of DOOR_NAMES)
          expect(
            capture(new Error('foreign'), door).code,
            `a foreign value at ${door}: its code is its door’s`
          ).toBe(NAMES[door]);
        const fromRelay = of(new Error('the relay gave out'));
        expect(capture(fromRelay, 'relay'), 'a snapshot at its own door is the same failure').toBe(
          fromRelay
        );
        expect(
          capture(fromRelay, 'unspecified'),
          'and at the door that cannot attribute, it keeps the attribution it has'
        ).toBe(fromRelay);
        const elsewhere = capture(fromRelay, 'descriptor') as ReqFailure;
        expect(
          [elsewhere === fromRelay, elsewhere.source, elsewhere.code],
          'at another door it is another failure, attributed there'
        ).toEqual([false, 'descriptor', 'descriptor-unreadable']);
        const occurring = new Error('the first time');
        const first = capture(occurring, 'descriptor') as ReqFailure;
        occurring.message = 'the second time';
        const second = capture(occurring, 'descriptor') as ReqFailure;
        const third = capture(occurring, 'relay') as ReqFailure;
        expect(
          [second === first, second.message, third === first, third.message, third.source],
          'the same thrown object, thrown again, is a new occurrence: its words now, and its door'
        ).toEqual([false, 'the second time', false, 'the second time', 'relay']);
      })();

      // **(5) What passes through: this library's own values of this
      // channel, and nothing else of anybody's.**
      await (async (): Promise<void> => {
        const refusal = thrownBy(() => validateFilter({ search: 'unsupported' } as ReadonlyFilter));
        expect(capture(refusal, 'descriptor'), 'a refusal this library threw passes through').toBe(
          refusal
        );
        expect(Object.isFrozen(refusal), 'closed').toBe(true);
        const requestRefusal = ownedByLibrary(
          new RequestTransportIncompatibleError('a relay it cannot name')
        );
        expect(
          capture(requestRefusal, 'descriptor'),
          'the request’s own transport refusal is this channel’s, and passes through'
        ).toBe(requestRefusal);
        const providerRefusal = ownedByLibrary(
          new TransportIncompatibleError(
            ['wss://a.example'],
            ['wss://a.example'],
            'the transport said so'
          )
        );
        const configuration = ownedByLibrary(
          new RelayConfigurationError(
            'invalid-relay-input',
            ['wss://a.example'],
            'a refusal of ours'
          )
        );
        // **At every door, and the fallback first among them**: a value whose
        // code has no door is re-derived wherever it arrives at an attributable
        // one, whatever the channel test says, so only `unspecified` — where an
        // attribution is never erased — can tell a value of this channel from
        // one that is not.
        for (const [what, value] of [
          [
            'the provider’s transport refusal, which shares the code and not the channel',
            providerRefusal
          ],
          ['a relay-configuration refusal, whose code is not this channel’s', configuration],
          [
            'a refusal of ours on no channel at all',
            ownedByLibrary(new MissingRandomnessError()) as object
          ],
          ['a proxy over one of ours', new Proxy(refusal as object, {})]
        ] as const)
          for (const door of DOOR_NAMES) {
            const out = capture(value, door);
            if (out === value) failures.push(`${what}, at ${door}: passed through`);
            expect(out.code, `${what}, at ${door}: copied at the door it arrived at`).toBe(
              NAMES[door]
            );
          }
        const [, accumulatorEntrance] = entrances[1] as (typeof entrances)[number];
        {
          const { published, done } = await accumulatorEntrance(() => configuration);
          expect(
            [published === configuration, (published as ReqError | undefined)?.code],
            'a relay-configuration refusal an accumulator threw: copied, on the channel’s own code'
          ).toEqual([false, 'unspecified']);
          done();
        }
        const minting = Object.entries(asAConsumerWould)
          .filter(([, build]) => isOwnedByLibrary(build()))
          .map(([name]) => name);
        expect(
          minting,
          'a class whose constructor hands a consumer this library’s own answer'
        ).toEqual([]);
        for (const [name, build] of Object.entries(asAConsumerWould)) {
          const built = build();
          for (const door of DOOR_NAMES)
            if (capture(built, door) === built)
              failures.push(`${name} a consumer built, at ${door}: passed through`);
        }
      })();

      // **(6) This library mints where it constructs, every site of it.**
      await (async (): Promise<void> => {
        const refusal = thrownBy(() => validateFilter({ search: 'unsupported' } as ReadonlyFilter));
        const fromRelay = of(new Error('the relay gave out'));
        const population = new Set(errorClasses().map(({ name }) => name));
        expect(population.size, 'the error classes this library declares').toBeGreaterThan(10);
        const sites = constructionSites(population);
        expect(
          sites.some(({ name, wrapper }) => name === 'ReqFailure' && wrapper === 'sealOwned'),
          'the scan’s control: it finds the site the boundary builds its snapshot at'
        ).toBe(true);
        const unminted = sites
          .filter((site) => site.wrapper === undefined || !MINTERS.includes(site.wrapper))
          .map((site) => `${site.where} (${site.name})`);
        expect(unminted, 'a construction this library never claimed as its own').toEqual([]);
        expect(
          everyConstructorCalled()
            .filter(({ callee }) => !population.has(callee) && !NOT_AN_ERROR_CLASS.includes(callee))
            .map(({ where, callee }) => `${where} (${callee})`),
          'and from the other side: every constructor the library calls is one of those or named as not one'
        ).toEqual([]);
        expect(
          whatTheScanCannotRead(),
          'and nothing in the library is spelled where the scan cannot read it'
        ).toEqual([]);
        expect(
          parsedModules().some(({ module }) => module.endsWith('.svelte')),
          'the premise: the components are read too'
        ).toBe(true);
        const probe = parsedAs(
          'probe.ts',
          [
            "import { hardenOwned as ownedByLibrary } from './owned.js';",
            'class Wrapped extends (Error) {}',
            'export default class extends RangeError {}',
            'class Ranged extends RangeError {}',
            'const built = Reflect.construct(Ranged, []);',
            "const named = Reflect['construct'](Ranged, []);",
            'const viaGlobal = globalThis.Reflect.construct(Ranged, []);',
            'const { construct } = Reflect;',
            'const parenthesised = ownedByLibrary(new (Ranged)());'
          ].join('\n')
        );
        // A minter's name bound by a declaration the first version did not list.
        const expression = parsedAs(
          'expression.ts',
          'const minted = (function ownedByLibrary(value: Error): Error { return value; })(new Ranged());'
        );
        // The two bindings the scan allows, read by what they are: the minter
        // declared at the top of the library's `owned.ts`, and an import whose
        // path resolves there — and, beside each, the spelling that only looks
        // like it.
        const allowed = [
          parsedAs('owned.ts', 'export function ownedByLibrary<T>(value: T): T { return value; }'),
          parsedAs('refusal.ts', "import { ownedByLibrary } from './owned.js';"),
          parsedAs('components/descriptors.ts', "import { ownedByLibrary } from '../owned.js';")
        ];
        const lookalikes = [
          parsedAs(
            'owned.ts',
            'export function extra(): Error {\n  function ownedByLibrary<T>(value: T): T { return value; }\n  return ownedByLibrary(new Ranged());\n}'
          ),
          parsedAs(
            'other/owned.ts',
            "export { hardenOwned as ownedByLibrary } from '../owned.js';"
          ),
          parsedAs('other/refusal.ts', "import { ownedByLibrary } from './owned.js';"),
          parsedAs('package.ts', "import { ownedByLibrary } from 'owned.js';")
        ];
        expect(
          [
            whatTheScanCannotRead([probe]),
            whatTheScanCannotRead([expression]).length,
            whatTheScanCannotRead([parsedAs('broken.ts', 'const = ;')]),
            whatTheScanCannotRead(allowed),
            whatTheScanCannotRead(lookalikes).map((line) => line.split(':')[0]),
            errorClasses([probe]).map(({ name }) => name),
            constructionSites(new Set(['Ranged']), [probe]).map(({ wrapper }) => wrapper)
          ],
          'the scans’ controls: each spelling it cannot read refused for its own reason, a function expression and source that does not parse refused, the two allowed bindings read and their lookalikes refused, a built-in base and a parenthesised construction read'
        ).toEqual([
          [
            'probe.ts:1: `ownedByLibrary` bound to something it may not be',
            'probe.ts:2: a class extending something that is not a name',
            'probe.ts:3: a class with no name to be held by',
            'probe.ts:5: a construction through `construct`',
            'probe.ts:6: `Reflect` read by a computed name',
            'probe.ts:6: a construction through `construct`',
            'probe.ts:7: a construction through `construct`',
            'probe.ts:8: a construction through `construct`'
          ],
          1,
          ['broken.ts: source the parser could not read'],
          [],
          ['owned.ts', 'other/refusal.ts', 'package.ts'],
          ['Ranged'],
          ['ownedByLibrary']
        ]);
        const component = componentAs(
          'Probe.svelte',
          [
            '<div>',
            '  {#if shown}{new Ranged({ nested: { braces: true } })}{/if}',
            '</div>',
            // On the tag's own line, where a pattern that ends the tag at the
            // `>` in its attribute turns the script into an unclosed string.
            '<script lang="ts" generics="T extends Record<string, unknown>">const made = ownedByLibrary(new Ranged());</script>',
            '<p>{Reflect.construct(Ranged, [])}</p>',
            '<svelte:options customElement={{ tag: "x-probe", extend: (Base) => class extends Base { static made = new Ranged(); } }} />',
            '<i>{String(globalThis.Reflect.construct(Ranged, []))}</i>'
          ].join('\n')
        );
        expect(
          [
            constructionSites(new Set(['Ranged']), [component]).map(
              ({ where, wrapper }) => `${where} ${String(wrapper)}`
            ),
            whatTheScanCannotRead([component])
          ],
          'the components’ control: a construction in a script, read at its own line; one in the markup, one through Reflect and one in an option, refused'
        ).toEqual([
          ['Probe.svelte:4 ownedByLibrary'],
          [
            'Probe.svelte:2: a construction outside the scripts, which no scan reads',
            'Probe.svelte:5: a construction outside the scripts, which no scan reads',
            'Probe.svelte:6: a construction outside the scripts, which no scan reads',
            'Probe.svelte:7: a construction outside the scripts, which no scan reads'
          ]
        ]);
        expect(
          [
            isOwnedByLibrary(refusal),
            isOwnedByLibrary(providerDisposed('the provider went away')),
            isOwnedByLibrary(fromRelay)
          ],
          'and what it throws, builds and captures is owned'
        ).toEqual([true, true, true]);
      })();

      // **(7) `stack` is closed before the value is frozen**, at every class
      // and on the snapshot, and whatever the host's getter answers — a
      // preparer that answers nothing, or one that throws. Read through the
      // descriptor alone, and recorded rather than asserted: under a preparer
      // that throws, every read of a live `stack` throws, the test runner's
      // own included.
      await (async (): Promise<void> => {
        const isClosed = (value: Error): boolean => {
          const slot = Object.getOwnPropertyDescriptor(value, 'stack');
          try {
            (value as { stack?: string }).stack = 'rewritten by a second reader';
          } catch {
            // A closed property refuses, which is one way of keeping it.
          }
          const after = Object.getOwnPropertyDescriptor(value, 'stack');
          return slot?.set === undefined && slot?.writable === false && after?.value === slot.value;
        };
        const closed = (value: Error, what: string): void => {
          if (!isClosed(value)) failures.push(`${what}: \`stack\` is not closed`);
        };
        expect(isClosed(new Error('a stack nobody closed')), 'the check’s control').toBe(false);
        const previous = Error.prepareStackTrace;
        try {
          for (const [label, prepare] of [
            ['the host’s own preparer', previous],
            ['a preparer that answers nothing', (): undefined => undefined],
            [
              'a preparer that throws',
              (): never => {
                throw new Error('a dependency’s preparer threw');
              }
            ]
          ] as const) {
            Error.prepareStackTrace = prepare;
            for (const [name, build] of Object.entries(oneOfEachClass())) {
              if (name === 'ReqFailure') continue;
              let built: Error;
              try {
                built = build();
              } catch {
                failures.push(`${name}, under ${label}: not constructed`);
                continue;
              }
              closed(built, `${name}, under ${label}`);
              // **And frozen at the end of its constructor**, after the close:
              // every class but the base the five refusals extend, which closes
              // and leaves the freeze to each subclass.
              if (name !== 'RelayConfigurationError' && !Object.isFrozen(built))
                failures.push(`${name}, under ${label}: not frozen when it is made`);
            }
            closed(
              capture(new Error('from outside'), 'relay') as Error,
              `the snapshot, under ${label}`
            );
            closed(
              providerDisposed('the provider went away'),
              `the disposed provider’s refusal as this library builds it, under ${label}`
            );
            const sealed = new Error('handed to the sealer');
            sealOwned(sealed);
            closed(sealed, `a value sealed here, under ${label}`);
          }
        } finally {
          Error.prepareStackTrace = previous;
        }
      })();

      // **(8) The transport's answer is rendered into the refusal, not kept**
      // — whatever it answered, however it answers when read, and at both
      // places it is asked: about one relay, and about the set.
      await (async (): Promise<void> => {
        const refusedBy = (
          transportKeys: TransportKeys,
          relays: readonly string[] = ['wss://a.example']
        ): { refusal: Error | undefined; threw: unknown } => {
          try {
            const provider = mount(() =>
              createNostrContext({
                relays: [...relays],
                harness: HARNESS_DIVERGENCES,
                transportKeys: noted(transportKeys)
              })
            );
            const refusal = provider.value.configurationError as Error | undefined;
            provider.destroy();
            return { refusal, threw: undefined };
          } catch (thrown) {
            return { refusal: undefined, threw: thrown };
          }
        };
        // One relay at a time, answered as asked; the set, answered by `answer`.
        const atTheSet =
          (answer: () => unknown): TransportKeys =>
          (urls) =>
            (urls.length === 1 ? [urls[0]] : answer()) as readonly string[];
        {
          const nested = { deep: 'as the transport made it' };
          const kept: unknown[] = ['wss://a.example', nested];
          const { refusal } = refusedBy(() => kept as never);
          expect(
            handedIn.some(({ ref }) => ref.deref() === nested),
            'the premise: what the transport answered, down to what hangs off it, is noted as handed in'
          ).toBe(true);
          const answered = (refusal as unknown as { answered?: unknown } | undefined)?.answered;
          expect(
            [typeof answered, String(answered).includes('as the transport made it')],
            'the transport’s answer, as a rendering of what it said'
          ).toEqual(['string', true]);
          expect(
            [Object.isFrozen(kept), Object.isFrozen(nested)],
            'and its object is not frozen as a side effect of reading it'
          ).toEqual([false, false]);
          nested.deep = 'CHANGED AFTER THE REFUSAL';
          kept.push('wss://later.example');
          expect(String(answered), 'nor read again afterwards').not.toContain('CHANGED');
          expect(refusal?.message, 'and the refusal says what it said then').toContain(
            'as the transport made it'
          );
        }
        for (const [where, transportKeys, relays] of [
          [
            'about one relay',
            () => theirOwn('a transport’s answer', { detail: cut(100_000) }) as never,
            ['wss://a.example']
          ],
          [
            'about the set',
            atTheSet(() => theirOwn('a transport’s answer', { detail: cut(100_000) })),
            RELAYS
          ]
        ] as const) {
          const { refusal } = refusedBy(transportKeys, relays);
          const answered = (refusal as unknown as { answered?: unknown } | undefined)?.answered;
          expect(
            [typeof answered, String(answered).length <= MAX_RENDERED + '… (cut)'.length],
            `an answer of a hundred thousand characters, ${where}: rendered within the bound`
          ).toEqual(['string', true]);
        }
        {
          const foreign = theirOwn('a transport’s answer', {
            theirs: 'an object of the transport’s'
          });
          let iterations = 0;
          const changing = (): unknown => {
            const answer = ['wss://c.example'];
            Object.defineProperty(answer, Symbol.iterator, {
              value: function* () {
                iterations += 1;
                yield iterations === 1 ? 'wss://c.example' : foreign;
              }
            });
            return answer;
          };
          const { refusal, threw } = refusedBy(atTheSet(changing), RELAYS);
          expect(threw, 'an answer that changes as it is read: nothing escapes').toBeUndefined();
          expect(
            [
              (refusal as RelayConfigurationError | undefined)?.code,
              iterations,
              walk(refusal).nodes.has(foreign)
            ],
            'it is read once, refused from what it said then, and nothing of it is on the refusal'
          ).toEqual(['transport-key-mismatch', 1, false]);
        }
        for (const [what, answer] of [
          [
            'an answer whose entry throws when read',
            () => {
              const thrown = theirs('a transport’s answer refused to be read').error;
              return Object.defineProperty(['wss://a.example'], 0, {
                get: (): never => {
                  throw thrown;
                }
              });
            }
          ],
          [
            'an answer that is a revoked proxy',
            () => {
              const gone = Proxy.revocable(['wss://a.example'], {});
              gone.revoke();
              return gone.proxy;
            }
          ]
        ] as const)
          for (const [where, transportKeys, relays] of [
            ['about one relay', (() => answer()) as unknown as TransportKeys, ['wss://a.example']],
            ['about the set', atTheSet(answer), RELAYS]
          ] as const) {
            const { refusal, threw } = refusedBy(transportKeys, relays);
            if (threw !== undefined)
              failures.push(`${what}, ${where}: escaped the provider as ${String(threw)}`);
            expect(
              [
                (refusal as RelayConfigurationError | undefined)?.code,
                isOwnedByLibrary(refusal),
                Object.isFrozen(refusal)
              ],
              `${what}, ${where}: refused as this library’s, closed`
            ).toEqual(['transport-incompatible', true, true]);
          }
        {
          const refs: WeakRef<object>[] = [];
          const answering: TransportKeys = (urls) => {
            if (urls.length === 1) return [urls[0] as string];
            const answer = theirOwn('a transport’s answer', [
              'wss://c.example',
              theirOwn('a transport’s answer', { theirs: 'a malformed member' })
            ]);
            refs.push(new WeakRef(answer), new WeakRef(answer[1] as object));
            return answer as never;
          };
          const provider = mount(() =>
            createNostrContext({
              relays: [...RELAYS],
              harness: HARNESS_DIVERGENCES,
              transportKeys: noted(answering)
            })
          );
          const gone = await collected(refs);
          expect(
            [refs.length > 0, provider.value.configurationError?.code, gone.includes(false)],
            'and nothing of the transport’s answer is held while its refusal is'
          ).toEqual([true, 'transport-incompatible', false]);
          provider.destroy();
        }
      })();

      // **(9) The vocabulary the channel is typed in.**
      await (async (): Promise<void> => {
        const parsed = (name: string): ts.SourceFile =>
          ts.createSourceFile(
            name,
            readFileSync(join(LIBRARY, name), 'utf8'),
            ts.ScriptTarget.Latest,
            true
          );
        const alias = (file: ts.SourceFile, name: string): ts.TypeNode | undefined =>
          file.statements.find(
            (statement): statement is ts.TypeAliasDeclaration =>
              ts.isTypeAliasDeclaration(statement) && statement.name.text === name
          )?.type;
        const indexes = (type: ts.TypeNode | undefined, object: string, index: string): boolean =>
          type !== undefined &&
          ts.isIndexedAccessTypeNode(type) &&
          type.objectType.getText() === object &&
          type.indexType.getText() === `'${index}'`;
        const reqerror = parsed('reqerror.ts');
        const own = parsed('own.ts');
        expect(
          [
            indexes(alias(reqerror, 'ReqErrorCode'), 'ReqError', 'code'),
            indexes(alias(own, 'FailureSource'), 'CapturedReqError', 'source'),
            indexes(alias(own, 'FailureCode'), 'CapturedReqError', 'code')
          ],
          '`ReqErrorCode`, `FailureSource` and `FailureCode` are read off the variants, not declared beside them'
        ).toEqual([true, true, true]);
        // What the published variants themselves say, since the aliases follow
        // them: every `source` a variant declares, beside its `code`.
        const literals = (type: ts.TypeNode): string[] =>
          ts.isUnionTypeNode(type) ? type.types.flatMap(literals) : [type.getText()];
        const declared: string[] = [];
        const variants = alias(reqerror, 'ReqError');
        for (const member of variants !== undefined && ts.isUnionTypeNode(variants)
          ? variants.types
          : [])
          if (ts.isTypeLiteralNode(member)) {
            const typeOf = (name: string): ts.TypeNode | undefined =>
              member.members.find(
                (one): one is ts.PropertySignature =>
                  ts.isPropertySignature(one) && one.name.getText() === name
              )?.type;
            const source = typeOf('source');
            const code = typeOf('code');
            if (source !== undefined && code !== undefined)
              for (const each of literals(source))
                declared.push(`${each} → ${literals(code).join(' | ')}`);
          }
        expect(
          declared.sort(),
          'two attributable doors and a fallback, each with its one code, and no more'
        ).toEqual([
          "'descriptor' → 'descriptor-unreadable'",
          "'relay' → 'relay-failed'",
          "'unspecified' → 'unspecified'"
        ]);
      })();

      // **(10) What a relay-list seam said is bounded, whatever it was
      // thrown as, at each of the three seams it is quoted from**: the
      // caller's own input, the per-relay transport adapter, and the set
      // adapter. Bounded is read against the same refusal of a one-character
      // payload: what the long one adds is the rendering's bound and no more.
      await (async (): Promise<void> => {
        const refusing = theirOwn(
          'a payload',
          proxied('a payload', new Error('refuses to be frozen'), {
            preventExtensions: (): boolean => false
          })
        );
        const atTheSeam: [
          string,
          (payload: () => unknown) => Parameters<typeof createNostrContext>[0]
        ][] = [
          [
            'the caller’s own input',
            (payload) => ({
              relays: [
                {
                  get url(): string {
                    throw payload();
                  }
                } as unknown as RelayInput
              ],
              harness: HARNESS_DIVERGENCES
            })
          ],
          [
            'the per-relay transport adapter',
            (payload) => ({
              relays: ['wss://a.example'],
              harness: HARNESS_DIVERGENCES,
              transportKeys: noted(() => {
                throw payload();
              })
            })
          ],
          [
            'the set adapter',
            (payload) => ({
              relays: [...RELAYS],
              harness: HARNESS_DIVERGENCES,
              transportKeys: noted((urls) => {
                if (urls.length > 1) throw payload();
                return [urls[0] as string];
              })
            })
          ]
        ];
        const answersNothing = (): unknown =>
          proxied('a payload', new Error('answers nothing'), {
            get: (): never => {
              throw new Error('every read refuses');
            },
            getPrototypeOf: (): never => {
              throw new Error('every read refuses');
            },
            getOwnPropertyDescriptor: (): never => {
              throw new Error('every read refuses');
            },
            ownKeys: (): never => {
              throw new Error('every read refuses');
            },
            has: (): never => {
              throw new Error('every read refuses');
            }
          });
        for (const [seam, options] of atTheSeam) {
          const refusedWith = (payload: () => unknown): Error | undefined => {
            try {
              const provider = mount(() =>
                createNostrContext(options(() => theirOwn('a payload', payload())))
              );
              const refusal = provider.value.configurationError as Error | undefined;
              provider.destroy();
              return refusal;
            } catch (thrown) {
              failures.push(`${seam}: what it threw escaped the provider as ${typeof thrown}`);
              return undefined;
            }
          };
          for (const [what, payload] of [
            ['an Error that refuses to be frozen', () => refusing],
            ['a proxy that answers nothing', answersNothing]
          ] as const) {
            const refusal = refusedWith(payload);
            expect(
              [isOwnedByLibrary(refusal), Object.isFrozen(refusal)],
              `${what}, at ${seam}: refused as this library’s, closed`
            ).toEqual([true, true]);
          }
          expect(Object.isExtensible(refusing), `${seam}: the refusing Error, as it was`).toBe(
            true
          );
          for (const [what, long, short] of [
            [
              'an Error',
              () => theirOwn('a payload', new Error(cut(100_000))),
              () => theirOwn('a payload', new Error('x'))
            ],
            [
              'a plain object',
              () => theirOwn('a payload', { message: cut(100_000) }),
              () => theirOwn('a payload', { message: 'x' })
            ]
          ] as const) {
            const said = refusedWith(long)?.message ?? '';
            const baseline = refusedWith(short)?.message ?? '';
            expect(
              [
                baseline.length > 0,
                said.includes('… (cut)'),
                said.length - baseline.length <= MAX_RENDERED + '… (cut)'.length
              ],
              `${what} of a hundred thousand characters, at ${seam}: cut, and bounded by the rendering’s bound`
            ).toEqual([true, true, true]);
          }
        }
      })();

      // **And an owned value dropped is let go**: membership is weak, so the
      // registry holds nothing this library made once nobody else does.
      await (async (): Promise<void> => {
        {
          const refs = (() => {
            const snapshot = capture(new Error('nobody keeps this'), 'relay') as object;
            return [new WeakRef(snapshot)];
          })();
          expect(await collected(refs), 'an owned snapshot nobody holds is gone').toEqual([true]);
        }
      })();

      // **And, last, nothing of what this arm handed in is held by anything**:
      // every object of the caller's it gave the library, at any door, once
      // every section that held one has returned and the query cache is empty.
      // The control is one the arm still holds, which has to come back held.
      const onPurpose = theirOwn('the control, still held', { held: true });
      client.clear();
      const left = await collected(handedIn.map(({ ref }) => ref));
      expect(
        [onPurpose.held, left[handedIn.length - 1]],
        'the final collection’s control: what the arm still holds is still held'
      ).toEqual([true, false]);
      const stillHeld = new Map<string, number>();
      handedIn.slice(0, -1).forEach(({ label }, at) => {
        if (left[at] === false) stillHeld.set(label, (stillHeld.get(label) ?? 0) + 1);
      });
      expect(handedIn.length, 'the premise: what was handed in was noted').toBeGreaterThan(100);
      expect(
        [...stillHeld],
        'nothing of the caller’s still held once the arm has let go of all of it'
      ).toEqual([]);

      expect(
        failures,
        'a door that published what it was handed, or passed through what it should not'
      ).toEqual([]);
    }
  );
});
