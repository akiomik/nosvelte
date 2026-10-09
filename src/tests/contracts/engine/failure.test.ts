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
import { runInNewContext } from 'node:vm';

import { Observable } from 'rxjs';
import { QueryClient } from 'tanstack-svelte-query-v6';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { StreamAccumulator } from '$lib/v1/accumulate.js';
import { createAttemptRegistry } from '$lib/v1/attempt.js';
import { createNostrContext } from '$lib/v1/context.svelte.js';
import { beginAttempt, emptyEventSet, noteFailure } from '$lib/v1/eventset.js';
import { validateFilter } from '$lib/v1/key.js';
import { MAX_RENDERED, type ReadonlyFilter } from '$lib/v1/normalize.js';
import { capture, providerDisposed, ReqFailure } from '$lib/v1/own.js';
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
  constructionSites,
  errorClasses,
  MINTERS,
  oneOfEachClass
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
 * Every object reachable from `root` through its own members — names and
 * symbols, enumerable or not — each read guarded, since a getter may throw.
 */
function reachable(root: unknown, seen = new Set<object>()): Set<object> {
  if ((typeof root !== 'object' && typeof root !== 'function') || root === null) return seen;
  if (seen.has(root)) return seen;
  seen.add(root);
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(root);
  } catch {
    return seen;
  }
  for (const key of keys) {
    let slot: PropertyDescriptor | undefined;
    try {
      slot = Reflect.getOwnPropertyDescriptor(root, key);
    } catch {
      continue;
    }
    if (slot !== undefined && 'value' in slot) reachable(slot.value, seen);
  }
  return seen;
}

/**
 * The caller's graph as it stands: for every object reachable from `root`,
 * whether it is extensible and frozen, and every own slot's kind and primitive
 * value. Compared before and after the boundary, so "untouched" is read off
 * the whole graph rather than off the object handed in.
 */
function shapeOf(root: object): string {
  const nodes = [...reachable(root)];
  const index = new Map(nodes.map((node, at) => [node, at]));
  return JSON.stringify(
    nodes.map((node) => ({
      extensible: Object.isExtensible(node),
      frozen: Object.isFrozen(node),
      slots: Reflect.ownKeys(node).map((key) => {
        const slot = Reflect.getOwnPropertyDescriptor(node, key) as PropertyDescriptor;
        const value: unknown = slot.value;
        return [
          String(key),
          'value' in slot ? 'data' : 'accessor',
          slot.writable,
          slot.enumerable,
          slot.configurable,
          typeof value === 'object' && value !== null
            ? `#${String(index.get(value))}`
            : String(value)
        ];
      })
    }))
  );
}

/** A caller's Error with a graph under it: a non-enumerable `cause`, and a member of their own. */
function theirs(message: string) {
  const leaf = { note: 'as they left it' };
  const middle = new Error('what it points at', { cause: leaf });
  const error = new Error(message, { cause: middle });
  Object.defineProperty(error, 'theirs', {
    value: { mine: 'as they left it' },
    enumerable: false,
    writable: true,
    configurable: true
  });
  return { error, middle, leaf };
}

describe('the failure channel publishes a value this library made, never one it was handed', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => WS.clean());

  // @contracts B5-C9
  it(
    'FC1: a foreign failure is copied at every door it arrives at, bounded and attributed, and only what this library made and closed passes through',
    { timeout: 60_000 },
    async () => {
      const failures: string[] = [];
      const NAMES = {
        descriptor: 'descriptor-unreadable',
        relay: 'relay-failed',
        unspecified: 'unspecified'
      } as const;

      // **(1) The copy, at every entrance a foreign value arrives at.** Not
      // `capture` alone: each door is the library's own call site, so a site
      // that published what it was handed fails here, whatever `capture` does.
      // The descriptor boundary, the accumulator, the failure writer a port
      // calls, and the forward leg's `error` handler, where a transport's own
      // object arrives.
      const entrances: [
        string,
        (thrown: unknown) => Promise<{ published: unknown; again?: unknown }>,
        keyof typeof NAMES
      ][] = [
        [
          'the descriptor boundary',
          async (thrown) => {
            const { rxNostr } = createTestRelay(nextUrl());
            const held = mount(() =>
              useStreamedReq(() => ({
                verifyEvent: acceptAnyEvent,
                attempts,
                rxNostr,
                client,
                namespace: `fc1-descriptor-${port}`,
                filters: [
                  {
                    get kinds(): number[] {
                      throw thrown;
                    }
                  } as unknown as { kinds: number[] }
                ],
                reqIdBase: 'fc1-descriptor'
              }))
            );
            await settle(120);
            const published = (held.value.state as { error?: unknown }).error;
            const again = held.value.diagnostics.lastError;
            held.destroy();
            return { published, again };
          },
          'descriptor'
        ],
        [
          'the accumulator',
          async (thrown) => {
            const { rxNostr } = createTestRelay(nextUrl());
            const accumulator: StreamAccumulator = () => async () => {
              throw thrown;
            };
            const held = mount(() =>
              useStreamedReq(() => ({
                verifyEvent: acceptAnyEvent,
                attempts,
                rxNostr,
                client,
                namespace: `fc1-accumulator-${port}`,
                filters: [{ kinds: [1] }],
                reqIdBase: 'fc1-accumulator',
                settleTimeoutMs: 300,
                accumulator
              }))
            );
            await settle(200);
            const published = (held.value.state as { error?: unknown }).error;
            const again = held.value.diagnostics.lastError;
            held.destroy();
            return { published, again };
          },
          'unspecified'
        ],
        [
          'the failure writer a port calls',
          async (thrown) => {
            const attemptId = attempts.mint();
            const written = noteFailure(beginAttempt(emptyEventSet, attemptId), attemptId, thrown);
            return { published: written.failure?.error };
          },
          'unspecified'
        ],
        [
          'the forward leg’s error handler',
          async (thrown) => {
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
            failForward?.(thrown);
            await settle(150);
            const published = held.value.diagnostics.legEnded?.error;
            held.destroy();
            return { published };
          },
          'relay'
        ]
      ];
      for (const [entrance, arrive, door] of entrances) {
        const { error, middle, leaf } = theirs(`thrown at ${entrance}`);
        const before = shapeOf(error);
        const { published, again } = await arrive(error);
        const failure = published as ReqFailure | undefined;
        expect(failure, `${entrance}: the premise, a failure published`).toBeInstanceOf(Error);
        if (published === error) failures.push(`${entrance}: published the value it was handed`);
        if (!isOwnedByLibrary(published))
          failures.push(`${entrance}: published a value this library did not mint`);
        expect(
          [failure?.name, failure?.thrownName, failure?.message, failure?.source, failure?.code],
          `${entrance}: a copy — the name, what it called itself, its words, the door and its code`
        ).toEqual(['ReqFailure', 'Error', `thrown at ${entrance}`, door, NAMES[door]]);
        expect(failure?.cause?.message, `${entrance}: the cause, copied`).toBe('what it points at');
        expect(shapeOf(error), `${entrance}: the caller’s graph, untouched`).toBe(before);
        const ours = reachable(published);
        expect(
          [error, middle, leaf, (error as unknown as { theirs: object }).theirs].filter((one) =>
            ours.has(one)
          ),
          `${entrance}: nothing of the caller’s reachable from what is published`
        ).toEqual([]);
        expect(Object.isFrozen(published), `${entrance}: what is published is closed`).toBe(true);
        if (again !== undefined)
          expect(again, `${entrance}: and it is one object on both surfaces`).toBe(published);
        // A later write to their graph changes nothing published.
        error.message = 'REWRITTEN';
        leaf.note = 'REWRITTEN';
        middle.message = 'REWRITTEN';
        expect(
          [failure?.message, failure?.cause?.message],
          `${entrance}: a later write to their graph changes nothing published`
        ).toEqual([`thrown at ${entrance}`, 'what it points at']);
      }

      // **(2) The values that used to break the boundary, at the entrance a
      // consumer can reach**, and directly at every door: none of them throws
      // out of it, each is recorded as a copy, and each says what it was.
      const refusing = new Proxy(new Error('refuses to be frozen'), {
        preventExtensions: (): boolean => false
      });
      const partway = new Proxy(new Error('the freeze fails part-way'), {
        defineProperty: (target, key, slot): boolean => {
          if (key === 'message') throw new Error('defineProperty refused part-way');
          return Reflect.defineProperty(target, key, slot);
        }
      });
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      const members = [new Error('the first member'), { a: 'plain member' }];
      const aggregate = new AggregateError(members, 'several at once');
      const aggregateShape = shapeOf(aggregate);
      const theirGraph = { mutable: 1 };
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
          new Proxy(
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
      for (const [what, value, thrownName] of hostile) {
        for (const door of ['descriptor', 'relay', 'unspecified'] as const) {
          let captured: ReqError | undefined;
          expect(() => {
            captured = capture(value, door);
          }, `${what} at ${door}: capturing never throws`).not.toThrow();
          expect(captured, `${what} at ${door}: a copy, at the door it arrived at`).toMatchObject({
            source: door,
            code: NAMES[door],
            thrownName
          });
          if (captured === value) failures.push(`${what} at ${door}: published as itself`);
        }
        const [, arrive] = entrances[0] as (typeof entrances)[number];
        const { published } = await arrive(value);
        expect(
          published,
          `${what}, through the descriptor boundary: recorded as a copy`
        ).toMatchObject({
          name: 'ReqFailure',
          source: 'descriptor',
          thrownName
        });
        if (published === value) failures.push(`${what}: the descriptor boundary published it`);
      }
      expect(Object.isExtensible(refusing), 'the refusing Error is as it was').toBe(true);
      expect(shapeOf(aggregate), 'the AggregateError and its members, untouched').toBe(
        aggregateShape
      );
      expect(
        [...reachable(capture(aggregate, 'relay'))].filter(
          (one) => one === members || members.includes(one as never)
        ),
        'and nothing of its members reachable from the copy'
      ).toEqual([]);
      expect(
        (capture(forgedFailure, 'descriptor') as ReqFailure).cause,
        'a consumer’s ReqFailure is not ours, whatever it says: their graph is not on it'
      ).not.toBe(theirGraph);

      // **(3) The bounds, in numbers, and `truncated` derived from every one.**
      const cut = (length: number): string => 'x'.repeat(length);
      const named = (name: string, message = 'short'): Error =>
        Object.defineProperty(new Error(message), 'name', { value: name });
      const chain = (depth: number): Error => {
        let link: Error = new Error(String(depth));
        for (let at = depth - 1; at >= 1; at -= 1) link = new Error(String(at), { cause: link });
        return link;
      };
      const of = (value: unknown): ReqFailure => capture(value, 'relay') as ReqFailure;
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
        [of(named(cut(200))).thrownName.length, of(named(cut(200))).truncated],
        'a name at the bound is kept whole'
      ).toEqual([200, false]);
      expect(
        [of(named(cut(201))).thrownName.length, of(named(cut(201))).truncated],
        'a name past it is cut the same way, and says so'
      ).toEqual([207, true]);
      const three = of(chain(3));
      expect(
        [three.cause?.cause?.message, three.cause?.cause?.cause, three.truncated],
        'three nodes, counting the thrown value: copied whole'
      ).toEqual(['3', undefined, false]);
      const four = of(chain(4));
      expect(
        [four.cause?.cause?.message, four.cause?.cause?.cause, four.truncated],
        'a fourth is not copied, and the cut is published'
      ).toEqual(['3', undefined, true]);
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

      // **(4) The door a value belongs to, and the code that follows from it.**
      // Written out rather than read from `DOOR_OF`, which is what is under
      // test here.
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
        for (const door of ['descriptor', 'relay', 'unspecified'] as const) {
          const value = minted(code);
          const out = capture(value, door);
          const through = door === 'unspecified' || DOORS[code] === door;
          if ((out === value) !== through)
            failures.push(`${code} at ${door}: ${out === value ? 'handed through' : 're-derived'}`);
          if (out !== value && out.code !== NAMES[door])
            failures.push(`${code} re-derived at ${door} as ${out.code}`);
        }
      for (const door of ['descriptor', 'relay', 'unspecified'] as const)
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

      // **(5) What passes through: this library's own values of this
      // channel, and nothing else of anybody's.**
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
        new RelayConfigurationError('invalid-relay-input', ['wss://a.example'], 'a refusal of ours')
      );
      for (const [what, value] of [
        [
          'the provider’s transport refusal, which shares the code and not the channel',
          providerRefusal
        ],
        ['a relay-configuration refusal, whose code is not this channel’s', configuration],
        ['a proxy over one of ours', new Proxy(refusal as object, {})]
      ] as const) {
        const out = capture(value, 'descriptor');
        if (out === value) failures.push(`${what}: passed through`);
        expect(out.code, `${what}: copied at the door it arrived at`).toBe('descriptor-unreadable');
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
        if (capture(built, 'descriptor') === built)
          failures.push(`${name} a consumer built: passed through`);
      }

      // **(6) This library mints where it constructs, every site of it.**
      const population = new Set(errorClasses().map(({ name }) => name));
      expect(population.size, 'the error classes this library declares').toBeGreaterThan(10);
      const unminted = constructionSites(population)
        .filter((site) => site.wrapper === undefined || !MINTERS.includes(site.wrapper))
        .map((site) => `${site.where} (${site.name})`);
      expect(unminted, 'a construction this library never claimed as its own').toEqual([]);
      expect(
        [
          isOwnedByLibrary(refusal),
          isOwnedByLibrary(providerDisposed('the provider went away')),
          isOwnedByLibrary(fromRelay)
        ],
        'and what it throws, builds and captures is owned'
      ).toEqual([true, true, true]);

      // **(7) `stack` is closed before the value is frozen**, at every class
      // and on the snapshot, and whatever the host's getter answers.
      const closed = (value: Error, what: string): void => {
        const slot = Object.getOwnPropertyDescriptor(value, 'stack');
        const before = value.stack;
        try {
          (value as { stack?: string }).stack = 'rewritten by a second reader';
        } catch {
          // A closed property refuses, which is one way of keeping it.
        }
        if (slot?.set !== undefined || slot?.writable !== false || value.stack !== before)
          failures.push(`${what}: \`stack\` is not closed`);
      };
      const previous = Error.prepareStackTrace;
      try {
        for (const [label, prepare] of [
          ['the host’s own preparer', previous],
          ['a preparer that answers nothing', (): undefined => undefined]
        ] as const) {
          Error.prepareStackTrace = prepare;
          for (const [name, build] of Object.entries(oneOfEachClass())) {
            if (name === 'ReqFailure') continue;
            closed(build(), `${name}, under ${label}`);
          }
          closed(
            capture(new Error('from outside'), 'relay') as Error,
            `the snapshot, under ${label}`
          );
          const sealed = new Error('handed to the sealer');
          sealOwned(sealed);
          closed(sealed, `a value sealed here, under ${label}`);
        }
      } finally {
        Error.prepareStackTrace = previous;
      }

      // **(8) The transport's answer is rendered into the refusal, not kept.**
      const nested = { deep: 'as the transport made it' };
      const kept: unknown[] = ['wss://a.example', nested];
      const keeping: TransportKeys = () => kept as never;
      const provider = mount(() =>
        createNostrContext({
          relays: ['wss://a.example'],
          harness: HARNESS_DIVERGENCES,
          transportKeys: keeping
        })
      );
      const answered = (
        provider.value.configurationError as unknown as { answered?: unknown } | undefined
      )?.answered;
      const said = provider.value.configurationError?.message;
      provider.destroy();
      expect(typeof answered, 'the transport’s answer, as a rendering').toBe('string');
      expect(
        [Object.isFrozen(kept), Object.isFrozen(nested)],
        'and its object is not frozen as a side effect of reading it'
      ).toEqual([false, false]);
      nested.deep = 'CHANGED AFTER THE REFUSAL';
      kept.push('wss://later.example');
      expect(String(answered), 'nor read again afterwards').not.toContain('CHANGED');
      expect(said, 'and the refusal says what it said then').toContain('as the transport made it');

      // **(9) The vocabulary the channel is typed in.**
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
      const codeType = alias(parsed('reqerror.ts'), 'ReqErrorCode');
      expect(
        codeType !== undefined &&
          ts.isIndexedAccessTypeNode(codeType) &&
          codeType.objectType.getText() === 'ReqError' &&
          codeType.indexType.getText() === "'code'",
        "`ReqErrorCode` is derived from `ReqError['code']`, not declared beside it"
      ).toBe(true);
      const sourceType = alias(parsed('own.ts'), 'FailureSource');
      expect(
        sourceType !== undefined && ts.isUnionTypeNode(sourceType)
          ? sourceType.types.map((one) => one.getText()).sort()
          : sourceType?.getText(),
        'two attributable doors and a fallback, and no more'
      ).toEqual(["'descriptor'", "'relay'", "'unspecified'"]);

      // **(10) What a relay-list seam said is bounded, whatever it was
      // thrown as.**
      const throwing = (payload: unknown): RelayInput =>
        ({
          get url(): string {
            throw payload;
          }
        }) as unknown as RelayInput;
      const lengthOf = (payload: unknown): number => {
        const refused = mount(() =>
          createNostrContext({ relays: [throwing(payload)], harness: HARNESS_DIVERGENCES })
        );
        const message = refused.value.configurationError?.message ?? '';
        refused.destroy();
        return message.length;
      };
      const asError = lengthOf(new Error(cut(100_000)));
      const asObject = lengthOf({ message: cut(100_000) });
      expect(asError, 'the premise: a refusal, saying something').toBeGreaterThan(0);
      expect(
        [asError < 2_000, asObject < 2_000],
        'an Error of a hundred thousand characters is bounded, like the same payload as a plain object'
      ).toEqual([true, true]);

      expect(
        failures,
        'a door that published what it was handed, or passed through what it should not'
      ).toEqual([]);
    }
  );
});
