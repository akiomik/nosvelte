/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Nothing a consumer holds is a way to write this library's state (`B5-C8`):
 * what a hook hands out reaches the cache and the other readers only through
 * the commands it names, such as `refresh()`.
 *
 * **The contract counted from the contract's side.** "A consumer's change
 * reaches neither the cache, nor another hook, nor a later projection" was
 * repaired at the events, then at the diagnostics rows, and both times the rule
 * was applied to the instance in front of me. Counting the *published
 * containers* instead found two more in a minute: a `Refusal` is built once and
 * carried by reference, so writing to one changed what the cached record
 * answered afterwards — measured — and the `causes` list is memoised per record
 * and published on two surfaces.
 *
 * So these arms do not name values. They drive a request to an outcome and
 * read everything reachable from what the hooks publish: the supporting arms
 * require each container to be frozen, and `PB13` holds the publication
 * discipline `helpers/publication.ts` reads by reflection — and, for the
 * Errors two hooks share, writes and reads back through each reader, because
 * `Object.isFrozen` answered `true` about an Error whose `stack` setter was
 * live.
 *
 * `PB1`, `PB3`, `PB4`, `PB5` and `PB9` are the spike's `PO1`, `PO3`, `PO4`,
 * `PO5` and `PO9` from its `published-ownership` suite, renamed because an id
 * 0005 records as a spike witness is not a landing. Their comments keep the
 * spike's names, as the history of what was measured.
 *
 * Port band 9600-9649.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';

import { render } from '@testing-library/svelte';
import type { RxNostr } from 'rx-nostr';
import { parse } from 'svelte/compiler';
import { QueryClient } from 'tanstack-svelte-query-v6';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { StreamAccumulator } from '$lib/v1/accumulate.js';
import {
  AccumulatorContractError,
  AttemptAbandonedError,
  createAttemptRegistry,
  MissingRandomnessError
} from '$lib/v1/attempt.js';
import {
  createNostrContext,
  MissingProviderError,
  MissingVerifierError,
  setNostrContext
} from '$lib/v1/context.svelte.js';
import { useRelayDiagnostics } from '$lib/v1/diagnostics.svelte.js';
import { IncompleteResultError, type ReqHandle } from '$lib/v1/engine.js';
import { beginAttempt, emptyEventSet, noteFailure } from '$lib/v1/eventset.js';
import * as Entry from '$lib/v1/index.js';
import { UnsupportedFilterError } from '$lib/v1/key.js';
import { InvalidDescriptorError } from '$lib/v1/normalize.js';
import { capture, ProviderDisposedError, ReqFailure } from '$lib/v1/own.js';
import { useReq } from '$lib/v1/req.svelte.js';
import {
  isRelayNotInScope,
  type RefreshRejection,
  RelayNotInScopeError,
  REQ_ERROR_CODES,
  RequestTransportIncompatibleError
} from '$lib/v1/reqerror.js';
import {
  InvalidRelayInputError,
  InvalidRelayScopeError,
  isRelayConfigurationError,
  isTransportIncompatible,
  NonIdempotentRelayUrlError,
  RelayConfigurationError,
  type RelayConfigurationErrorCode,
  TransportIncompatibleError,
  TransportKeyMismatchError
} from '$lib/v1/scope.svelte.js';
import { type NostrSigner, useSend } from '$lib/v1/send.svelte.js';
import { MAIN_SURFACE } from '$lib/v1/surface.js';
import { useStreamedReq, type UseStreamedReqOpts } from '$lib/v1/useStreamedReq.svelte.js';

import Outlets from './fixtures/Outlets.svelte';
import {
  consumerDiagnostics,
  declaredHere,
  exportsOf,
  handedArgumentsOf,
  judgeWrites,
  judgeWritesEach,
  type ListSite,
  memberNamesOf,
  signaturesOf,
  walkEach,
  writesThrough
} from './helpers/declarations.js';
import { breachesOf, type Discipline, type LiveInterface } from './helpers/publication.js';
import {
  acceptAnyEvent,
  createTestRelay,
  fakeEvent,
  HARNESS_DIVERGENCES,
  respondWithEose,
  respondWithEvent
} from './helpers/relay.js';
import { flush, mount } from './helpers/runes.svelte.js';

const attempts = createAttemptRegistry();

let port = 9600;
const nextUrl = (): string => `ws://localhost:${(port += 1)}`;

async function settle(ms = 80): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  flush();
}

async function waitForReq(server: WS): Promise<string> {
  const message = (await server.nextMessage) as unknown[];
  return String(message[1]);
}

/**
 * The next REQ, past anything else on the wire: a refresh closes the
 * subscription it replaces first, and answering that `CLOSE`'s id answers
 * nobody.
 */
async function nextReqOf(server: WS): Promise<string> {
  for (;;) {
    const message = (await server.nextMessage) as unknown[];
    if (message[0] === 'REQ') return String(message[1]);
  }
}

/** The next frame of one type, past anything else on the wire. */
async function nextOf(server: WS, type: string): Promise<unknown[]> {
  for (;;) {
    const message = (await server.nextMessage) as unknown[];
    if (message[0] === type) return message;
  }
}

/** The next `EVENT` the server is sent for one event, past any other's. */
async function nextEventOf(server: WS, id: string): Promise<unknown[]> {
  for (;;) {
    const message = await nextOf(server, 'EVENT');
    if ((message[1] as { id?: unknown } | undefined)?.id === id) return message;
  }
}

/**
 * Every container reachable from a published value, with the path that reached
 * it — so a failure names the member rather than an offset.
 *
 * **`Error` instances used to be exempt here, and the exemption was the hiding
 * place.** The argument was that they are host objects with their own
 * conventions (`stack`, `cause`) and that this arm is about the library's own
 * containers — but `IncompleteResultError` is memoised per record and handed to
 * every reader of that answer, and the failure Error is stored on the cached
 * value, so both are shared by construction. Measured through two hooks on one
 * key: `error.message = '…'` on one changed what the other read, and
 * `incompleteCauses` — `readonly` in the type — took the write too.
 *
 * So they are required to be frozen like everything else. Freezing keeps the
 * identity C15 promises, which is why the two contracts were never in conflict:
 * they had simply never been measured together.
 */
function containers(root: unknown, path: string, seen = new Set<unknown>()): [string, unknown][] {
  if (root === null || typeof root !== 'object') return [];
  if (seen.has(root)) return [];
  seen.add(root);
  const here: [string, unknown][] = [[path, root]];
  // **`Object.entries` walked past every own property of an `Error`.** `stack`,
  // `message` and `cause` are all non-enumerable, so this instrument's walk over
  // an Error returned the Error and nothing else — `PO1`, `PO4` and `PO6` were
  // asking about a subtree of one node. Measured by a reviewer with the standard
  // option: `new Error(msg, { cause: {...} })` thrown from an accumulator came
  // back with `containers(error) === ['error']`, an unfrozen `cause`, and one
  // hook's write to it visible on the other's `state.error` and
  // `diagnostics.lastError`.
  //
  // Own property *names* rather than entries, and each read guarded: a getter
  // can throw, and an instrument that throws reports nothing at all rather than
  // reporting a failure (measured too — an Error carrying an enumerable getter
  // that throws took the walk down with it). A property that refuses to be read
  // is named as unreadable and not descended into; it cannot be a shared
  // container this arm can check, and saying so is better than dying.
  const readable = (key: string | symbol): [string, unknown] | undefined => {
    try {
      return [`${path}.${String(key)}`, (root as Record<string | symbol, unknown>)[key]];
    } catch {
      return undefined;
    }
  };
  const children = Array.isArray(root)
    ? root.map((value, at): [string, unknown] => [`${path}[${at}]`, value])
    : [
        ...Object.getOwnPropertyNames(root),
        // **Symbol keys too.** A payload hung on one is reachable from the
        // published value by anybody holding the symbol, and it was invisible
        // here for the same reason `cause` was: the walk asked for the keys it
        // expected rather than for the keys the object has.
        ...Object.getOwnPropertySymbols(root)
      ]
        .map((key) => readable(key))
        .filter((each): each is [string, unknown] => each !== undefined);
  return [...here, ...children.flatMap(([where, value]) => containers(value, where, seen))];
}

/**
 * Every member of `held` a consumer can name — own keys, names and symbols, of
 * it and of every object it holds through a data member — as key paths, each
 * holder before what it holds.
 */
function namedMembers(held: object): (string | symbol)[][] {
  const paths: (string | symbol)[][] = [];
  const seen = new Set<object>();
  const walk = (value: object, path: (string | symbol)[]): void => {
    if (seen.has(value)) return;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      paths.push([...path, key]);
      const slot = Reflect.getOwnPropertyDescriptor(value, key);
      const inner: unknown = slot !== undefined && 'value' in slot ? slot.value : undefined;
      if (inner !== null && typeof inner === 'object') walk(inner, [...path, key]);
    }
  };
  walk(held, []);
  return paths;
}

const readAt = (root: unknown, path: readonly (string | symbol)[]): unknown => {
  let at = root;
  for (const key of path) {
    try {
      at = (at as Record<string | symbol, unknown> | undefined)?.[key];
    } catch {
      return '[unreadable]';
    }
  }
  return at;
};

/**
 * Which readers saw a consumer's write to `held`: every member it names written
 * to — by assignment and by redefinition, each attempt swallowing whatever the
 * host does about it — then read back through each reader and compared with
 * what that reader answered before.
 *
 * **Kept for Errors, where the reflection check alone is not the evidence.**
 * `Object.isFrozen` answered `true` about an Error whose `stack` setter was
 * live; `breachesOf` reads the setter now, and this reads its effect, through
 * the readers `B5-C8` names.
 */
function writeAndReadBack(
  held: object,
  readers: Readonly<Record<string, () => unknown>>
): { before: Record<string, unknown[]>; reached: string[] } {
  const paths = namedMembers(held);
  const answers = (): Record<string, unknown[]> =>
    Object.fromEntries(
      Object.entries(readers).map(([reader, read]) => {
        const root = read();
        return [reader, paths.map((path) => readAt(root, path))];
      })
    );
  const before = answers();
  for (const path of paths) {
    const holder = readAt(held, path.slice(0, -1)) as Record<string | symbol, unknown>;
    const key = path[path.length - 1] as string | symbol;
    try {
      holder[key] = `WRITTEN BY A CONSUMER (${String(key)})`;
    } catch {
      // A closed member refuses, which is one way of keeping the promise.
    }
    try {
      Object.defineProperty(holder, key, { value: 'REDEFINED BY A CONSUMER' });
    } catch {
      // So does a closed slot.
    }
  }
  const after = answers();
  const reached = Object.keys(readers).flatMap((reader) =>
    paths
      .filter((_, at) => !Object.is(after[reader]?.[at], before[reader]?.[at]))
      .map((path) => `${reader}: ${path.map(String).join('.')}`)
  );
  return { before, reached };
}

/** This library's source: the components `PB13` reads its outlet premise off. */
const LIBRARY = resolve(dirname(fileURLToPath(import.meta.url)), '../../../lib/v1');

/**
 * Every class this library declares, by its prototype, and nothing else: the
 * prototypes a published Error may have — an Error from anywhere else on a
 * published value is one this library did not make — and the one class each
 * must hold. Each is taken from where this file imports it, the entry's or its
 * module's; `ProviderDisposedError` is exported from its module for this, and
 * the entry does not publish it.
 */
const LIBRARY_CLASSES: ReadonlyMap<object, object> = new Map(
  [
    AccumulatorContractError,
    AttemptAbandonedError,
    IncompleteResultError,
    InvalidDescriptorError,
    InvalidRelayInputError,
    InvalidRelayScopeError,
    MissingProviderError,
    MissingRandomnessError,
    MissingVerifierError,
    NonIdempotentRelayUrlError,
    RelayConfigurationError,
    RelayNotInScopeError,
    ReqFailure,
    RequestTransportIncompatibleError,
    TransportIncompatibleError,
    TransportKeyMismatchError,
    UnsupportedFilterError,
    ProviderDisposedError
  ].map((one) => [one.prototype as object, one])
);

/** The discipline over one arrangement's live interfaces. */
const disciplineOver = (interfaces: readonly (readonly [object, LiveInterface])[]): Discipline => ({
  interfaces: new Map(interfaces),
  classes: LIBRARY_CLASSES
});

/**
 * The live interfaces the hooks hand out, member by member. The engine handle's
 * `raw` is the one edge not walked: the query library's own object, priced in
 * `B5-C8` rather than promised. `projected` is walked — it is a seam too, and
 * what it returns is a published state.
 */
const ENGINE_HANDLE: LiveInterface = {
  getters: ['raw', 'activity', 'state', 'projected', 'diagnostics'],
  commands: ['refresh'],
  unwalked: ['raw']
};
const REQ_HANDLE: LiveInterface = {
  getters: ['state', 'activity', 'diagnostics'],
  commands: ['refresh']
};
const RELAY_DIAGNOSTICS: LiveInterface = {
  getters: ['relays', 'configurationError'],
  commands: []
};
/** `useSend()`'s answer is a function: closed as an object, its results checked by calling it. */
const SEND: LiveInterface = { getters: [], commands: [] };

/**
 * Every case the matrix below arranges, by name — so an arrangement that stops
 * checking anything is a missing name rather than a quieter green.
 */
const POPULATION = [
  'a request loading',
  'its loading outlet',
  'a request streaming',
  'a request settled',
  'its events outlet',
  'its event outlet',
  'a refresh, complete',
  'a refresh, incomplete',
  'a refresh, cancelled because its consumer released it',
  'a refresh, not started because the handle was released',
  'a request settled with nothing',
  'its nodata outlet',
  'its nodata outlet, for a single event',
  'a request incomplete, with refusals and causes',
  'an attempt that failed',
  'a refresh, error',
  'a refused descriptor',
  'its error outlet',
  'a refresh, rejected with unsupported-filter',
  'a refused descriptor, on a server',
  'a refresh, not started on a server',
  'a deferred request',
  'a refresh, not started because the plan is deferred',
  'a live request whose leg ended',
  'an Error, invalid-descriptor',
  'an Error, invalid-descriptor, refused before the boundary',
  'a refresh, rejected with invalid-descriptor, refused before the boundary',
  'an Error, descriptor-unreadable',
  'an Error, accumulator-contract',
  'an Error, accumulator-contract, from a relay’s failure',
  'an Error, missing-provider',
  'a refresh, rejected with invalid-descriptor',
  'a refresh, rejected with descriptor-unreadable',
  'a refresh, rejected with missing-provider',
  'an Error a hook throws, missing-provider',
  'an Error a provider throws, missing-randomness',
  'useReq()',
  'useReq(), refused',
  'a refresh through useReq(), incomplete',
  'a refresh through useReq(), refused',
  'useRelayDiagnostics()',
  'useRelayDiagnostics(), a notice cut',
  'useRelayDiagnostics(), a notice that was not text',
  'useSend()',
  'a send, refused',
  'its events outlet, over useReq()’s handle',
  'a send, settled',
  'a send, refused by its signer',
  'a refresh, not started with no readable relay',
  'a refresh, cancelled because the provider was disposed',
  'a refresh, rejected because the provider was disposed',
  'a send, settled with no answer',
  'an Error, relay-not-in-scope',
  'an Error, transport-incompatible',
  'a refresh, rejected with relay-not-in-scope',
  'a refresh, rejected with transport-incompatible',
  'useRelayDiagnostics(), after its provider is gone',
  'a provider refusal, conflicting-capabilities',
  'a provider refusal, invalid-relay-input',
  'a provider refusal, non-idempotent-url',
  'a provider refusal, transport-key-mismatch',
  'a provider refusal, transport-incompatible'
];

/**
 * Every code a provider refuses a relay list with — `RelayConfigurationErrorCode`'s,
 * tied to the type both ways.
 */
const RELAY_REFUSAL_CODES = [
  'invalid-relay-input',
  'conflicting-capabilities',
  'non-idempotent-url',
  'transport-key-mismatch',
  'transport-incompatible'
] as const satisfies readonly RelayConfigurationErrorCode[];
const everyRefusalListed: (typeof RELAY_REFUSAL_CODES)[number] =
  null as unknown as RelayConfigurationErrorCode;
void everyRefusalListed;

/** The readers `B5-C8` names for an Error two hooks share. */
const READERS = [
  'the value written to',
  'a second hook',
  'its diagnostics',
  'the same hook, read again',
  'the cache'
];

/**
 * Every code `refresh()` rejects with — `RefreshRejection`'s, listed here and
 * tied to the type both ways, so a code added to it is a compile error here.
 */
const REFRESH_REJECTIONS = [
  'invalid-descriptor',
  'unsupported-filter',
  'relay-not-in-scope',
  'transport-incompatible',
  'descriptor-unreadable',
  'missing-provider',
  'provider-disposed'
] as const satisfies readonly RefreshRejection['code'][];
const everyRejectionListed: (typeof REFRESH_REJECTIONS)[number] =
  null as unknown as RefreshRejection['code'];
void everyRejectionListed;

/**
 * The discipline's controls: each rule, over a value built to break it and
 * nothing else, found at the member it names — and a value that keeps every
 * rule found nowhere. Without them, an empty list of breaches is as much a fact
 * about a blind rule as about a closed value.
 */
function disciplineControls(): void {
  // Closed the way this library closes its own classes — each function on the
  // prototype, the prototype, then the class — and their setters too, since
  // the controls below give one a class, which none of the library's has.
  const sealed = <T extends abstract new (...args: never[]) => unknown>(constructor: T): T => {
    for (const holder of [constructor.prototype as object, constructor]) {
      for (const key of Reflect.ownKeys(holder)) {
        const member = Reflect.getOwnPropertyDescriptor(holder, key);
        if (member?.get !== undefined) Object.freeze(member.get);
        if (member?.set !== undefined) Object.freeze(member.set);
        if (typeof member?.value === 'function') Object.freeze(member.value);
      }
      Object.freeze(holder);
    }
    return constructor;
  };
  const Ours = sealed(class Ours extends Error {});
  const Theirs = sealed(class Theirs extends Error {});
  // Classes whose prototypes reach an ordinary assignment or a second reader:
  // a setter, which runs on a frozen receiver — on the class, and on its
  // parent — an object every instance shares, a getter every instance
  // inherits, and a method whose function object was left open.
  const Setting = sealed(
    class Setting extends Error {
      set member(next: unknown) {
        void next;
      }
    }
  );
  const Leaf = sealed(class Leaf extends Setting {});
  class SharingClass extends Error {}
  Object.defineProperty(SharingClass.prototype, 'shared', { value: {} });
  const Sharing = sealed(SharingClass);
  const Gotten = sealed(
    class Gotten extends Error {
      get extra(): number {
        return 1;
      }
    }
  );
  class Methodical extends Error {
    describe(): number {
      return 1;
    }
  }
  Object.freeze(Methodical.prototype);
  Object.freeze(Methodical);
  class MarkedClass extends Error {}
  Object.defineProperty(MarkedClass.prototype, 'kind', { value: 'marked' });
  const Marked = sealed(MarkedClass);
  class ImpostorClass extends Error {}
  Object.defineProperty(ImpostorClass.prototype, 'constructor', {
    value: Object.freeze(function stranger() {}.bind(null))
  });
  Object.freeze(ImpostorClass.prototype);
  const Impostor = ImpostorClass;
  const Described = sealed(
    class Described extends Error {
      describe(): number {
        return 1;
      }
    }
  );
  // And a class nobody closed, reached through what its instances inherit; one
  // left open behind a closed prototype, reached as its `constructor`; and a
  // record in the class's place, reached the same way.
  class Open extends Error {}
  class HalfOpen extends Error {}
  Object.freeze(HalfOpen.prototype);
  class RecordedClass extends Error {}
  Object.defineProperty(RecordedClass.prototype, 'constructor', {
    value: { prototype: RecordedClass.prototype }
  });
  Object.freeze(RecordedClass.prototype);
  // A function whose own `prototype` is the class's, standing in its place:
  // it names the prototype, and is not the class the arrangement imported.
  class PretendedClass extends Error {}
  const pretender = function pretender(): void {};
  pretender.prototype = PretendedClass.prototype;
  Object.defineProperty(PretendedClass.prototype, 'constructor', {
    value: Object.freeze(pretender)
  });
  Object.freeze(PretendedClass.prototype);
  class ClasslessClass extends Error {}
  Reflect.deleteProperty(ClasslessClass.prototype, 'constructor');
  Object.freeze(ClasslessClass.prototype);
  // Closed the way this library closes its own Errors: `stack` made data, then frozen.
  const owned = <T extends Error>(error: T): T => {
    Object.defineProperty(error, 'stack', { value: 'as it was', writable: false });
    return Object.freeze(error);
  };
  const ours = owned(new Ours('as it was'));
  const control: Discipline = {
    interfaces: new Map(),
    classes: new Map(
      [
        Ours,
        Setting,
        Leaf,
        Sharing,
        Gotten,
        Methodical,
        Described,
        Open,
        HalfOpen,
        RecordedClass,
        ClasslessClass,
        PretendedClass,
        Marked,
        Impostor
      ].map((one) => [one.prototype as object, one])
    )
  };
  const breaches = (value: unknown, discipline = control): string[] =>
    breachesOf(value, 'held', discipline);
  const closed = <T extends object>(value: T): T => Object.freeze(value);

  const key = Symbol('member');
  expect(
    breaches(
      closed({
        list: closed([closed({ one: 1 })]),
        [key]: closed({ inner: 'as it was' }),
        error: ours,
        nothing: null,
        bare: closed(Object.create(null) as object)
      })
    ),
    'a value that keeps every rule'
  ).toEqual([]);

  const rules: [string, unknown, string][] = [
    ['an extensible record', { one: 1 }, 'held: extensible'],
    ['a writable member', Object.preventExtensions({ one: 1 }), 'held.one: writable'],
    [
      'a configurable member',
      Object.preventExtensions(
        Object.defineProperty({}, 'one', { value: 1, writable: false, configurable: true })
      ),
      'held.one: configurable'
    ],
    [
      'an accessor with a setter',
      closed(Object.defineProperty({}, 'one', { get: () => 1, set: () => undefined })),
      'held.one: a setter'
    ],
    [
      'an accessor in a snapshot',
      closed(Object.defineProperty({}, 'one', { get: () => 1 })),
      'held.one: an accessor in a snapshot'
    ],
    ['an inherited setter', owned(new Setting('x')), 'held: inherits a setter, member'],
    ['a setter two classes up', owned(new Leaf('x')), 'held: inherits a setter, member'],
    [
      'inherited data',
      owned(new Sharing('x')),
      'held (inherited from SharingClass).shared: a member every instance inherits'
    ],
    [
      'an inherited accessor',
      owned(new Gotten('x')),
      'held (inherited from Gotten).extra: a member every instance inherits'
    ],
    [
      'an inherited method left open',
      owned(new Methodical('x')),
      'held (inherited from Methodical).describe: extensible'
    ],
    ['a class nobody closed', owned(new Open('x')), 'held (inherited from Open): extensible'],
    [
      'a class left open behind its closed prototype',
      owned(new HalfOpen('x')),
      'held (inherited from HalfOpen).constructor: extensible'
    ],
    [
      'a prototype without its class',
      owned(new ClasslessClass('x')),
      'held (inherited from a prototype): a prototype without its class'
    ],
    [
      'a record in the class’s place',
      owned(new RecordedClass('x')),
      "held (inherited from a prototype).constructor: a constructor that is not this prototype's class"
    ],
    [
      'a function that names the prototype and is not its class',
      owned(new PretendedClass('x')),
      "held (inherited from pretender).constructor: a constructor that is not this prototype's class"
    ],
    [
      'a primitive every instance inherits',
      owned(new Marked('x')),
      'held (inherited from MarkedClass).kind: a member every instance inherits'
    ],
    [
      'a constructor that is not its prototype’s class',
      owned(new Impostor('x')),
      "held (inherited from bound stranger).constructor: a constructor that is not this prototype's class"
    ],
    [
      'a method every instance inherits, closed',
      owned(new Described('x')),
      'held (inherited from Described).describe: a member every instance inherits'
    ],
    [
      'a host object with internal state, under no prototype',
      closed({ host: closed(Object.setPrototypeOf(new Map(), null) as object) }),
      'held.host: a host object with internal state (isMap)'
    ],
    ['a list’s `length`', Object.preventExtensions([]), 'held.length: writable'],
    [
      'a symbol-keyed slot',
      Object.preventExtensions({ [Symbol('member')]: 1 }),
      'held[Symbol(member)]: writable'
    ],
    [
      'an Error’s own member',
      Object.preventExtensions(
        Object.defineProperty(new Ours('x'), 'stack', { value: 'x', writable: false })
      ),
      'held.message: writable'
    ],
    [
      'a list of another class',
      closed(new (class Listy extends Array<number> {})()),
      'held: a kind this discipline does not admit'
    ],
    [
      'a setter’s own function object',
      closed(Object.defineProperty({}, 'one', { get: closed(() => 1), set: () => undefined })),
      'held.one (its setter): extensible'
    ],
    [
      'the prototype’s own setter, on an extensible record',
      {},
      'held: inherits a setter, __proto__'
    ],
    ['a symbol-keyed member’s value', closed({ [key]: {} }), 'held[Symbol(member)]: extensible'],
    [
      'a list’s non-index member',
      closed(Object.assign([1], { extra: {} })),
      'held.extra: extensible'
    ],
    [
      'a function in a snapshot',
      closed({ call: closed(() => 1) }),
      'held.call: a function in a snapshot'
    ],
    ['a proxy', new Proxy(closed({ one: 1 }), {}), 'held: a proxy'],
    [
      'a host object, under its own prototype',
      closed({ map: closed(new Map()) }),
      'held.map: a host object with internal state (isMap)'
    ],
    [
      'internal state under a borrowed prototype',
      closed({ set: closed(Object.setPrototypeOf(new Set(), Object.prototype) as object) }),
      'held.set: a host object with internal state (isSet)'
    ],
    [
      'an Error this library did not make',
      closed({ error: closed(new Theirs('elsewhere')) }),
      'held.error: a kind this discipline does not admit'
    ],
    [
      'an instance of any other class',
      closed({ date: closed(new (class Moment {})()) }),
      'held.date: a kind this discipline does not admit'
    ],
    [
      'an Error whose stack freezing does not close',
      closed({ error: closed(new Ours('open')) }),
      'held.error.stack: a setter'
    ]
  ];
  for (const [rule, value, finding] of rules)
    expect(breaches(value), `the discipline’s control: ${rule}`).toContain(finding);

  // A live interface's own rules: the members it names and no others, its
  // functions closed as objects, each getter's output walked — and the one
  // edge it exempts exempted there and nowhere else.
  const handle = (members: PropertyDescriptorMap): object =>
    closed(Object.defineProperties({}, members));
  const getter = (value: unknown): PropertyDescriptor => ({ get: closed(() => value) });
  const command = closed(() => undefined);
  const spec: LiveInterface = {
    getters: ['state', 'raw'],
    commands: ['refresh'],
    unwalked: ['raw']
  };
  const over = (value: object, interfaceSpec = spec): string[] =>
    breaches(value, { interfaces: new Map([[value, interfaceSpec]]), classes: control.classes });
  const kept = handle({
    state: getter(closed({ status: 'settled' })),
    raw: getter({ open: 'and not walked' }),
    // An async function, as the handles' `refresh` is: its chain is the
    // platform's own and has nothing to report.
    refresh: { value: closed(async () => undefined) }
  });
  expect(over(kept), 'a live interface that keeps every rule').toEqual([]);
  // A constructible function no class of this library's is, on a command's
  // chain: closed, and still a second function a consumer can construct.
  const Stranger = function Stranger(): void {};
  Object.freeze(Stranger.prototype);
  Object.freeze(Stranger);
  const strayed = closed(Object.setPrototypeOf(async () => undefined, Stranger) as object);
  // And an object no class of this library's has as its prototype, on a
  // command's chain before the platform's own: closed, holding nothing.
  const astray = closed(
    Object.setPrototypeOf(
      async () => undefined,
      closed(Object.create(Object.getPrototypeOf(async () => undefined) as object) as object)
    ) as object
  );
  const interfaceRules: [string, object, string, LiveInterface?][] = [
    [
      'a function on a command’s chain that is not this library’s class',
      handle({ state: getter(1), raw: getter(1), refresh: { value: strayed } }),
      "held.refresh (inherited from a prototype): a function on a chain that is not this library's class"
    ],
    [
      'a prototype on a command’s chain that is not this library’s',
      handle({ state: getter(1), raw: getter(1), refresh: { value: astray } }),
      "held.refresh (inherited from a prototype): a prototype that is not this library's"
    ],
    [
      'a getter’s output',
      handle({ state: getter({ open: true }), raw: getter(1), refresh: { value: command } }),
      'held.state: extensible'
    ],
    [
      'a member the interface does not name',
      handle({ ...Object.getOwnPropertyDescriptors(kept), extra: { value: 1 } }),
      'held.extra: a member the interface does not name'
    ],
    [
      'an accessor the interface does not name',
      handle({ ...Object.getOwnPropertyDescriptors(kept), other: getter(1) }),
      'held.other: an accessor the interface does not name'
    ],
    [
      'a member it names and does not hold',
      handle({ state: getter(1), refresh: { value: command } }),
      'held.raw: named and absent'
    ],
    [
      'a getter that throws',
      handle({
        state: {
          get: closed(() => {
            throw new Error('unreadable');
          })
        },
        raw: getter(1),
        refresh: { value: command }
      }),
      'held.state: a getter that throws'
    ],
    [
      'a getter’s function object',
      handle({ state: { get: () => 1 }, raw: getter(1), refresh: { value: command } }),
      'held.state (its getter): extensible'
    ],
    [
      'a command’s own member',
      handle({
        state: getter(1),
        raw: getter(1),
        refresh: { value: closed(Object.assign(() => undefined, { cell: {} })) }
      }),
      'held.refresh.cell: extensible'
    ],
    [
      'a command left open',
      handle({ state: getter(1), raw: getter(1), refresh: { value: () => undefined } }),
      'held.refresh: extensible'
    ],
    [
      'the exempt edge, under an interface that does not exempt it',
      kept,
      'held.raw: extensible',
      { getters: ['state', 'raw'], commands: ['refresh'] }
    ],
    [
      'a command’s own writable member',
      handle({
        state: getter(1),
        raw: getter(1),
        refresh: { value: Object.preventExtensions(Object.assign(() => undefined, { tag: 1 })) }
      }),
      'held.refresh.tag: writable'
    ],
    [
      'a command that is not a function',
      handle({ state: getter(1), raw: getter(1), refresh: { value: closed({}) } }),
      'held.refresh: a command that is not a function'
    ],
    [
      'a getter that hands out a function',
      handle({ state: getter(command), raw: getter(1), refresh: { value: command } }),
      'held.state: a function in a snapshot'
    ],
    [
      'a getter closed on its first read only',
      handle({
        state: {
          get: closed(
            (() => {
              let reads = 0;
              return () => ((reads += 1) === 1 ? closed({}) : {});
            })()
          )
        },
        raw: getter(1),
        refresh: { value: command }
      }),
      'held.state (read again): extensible'
    ],
    [
      'a snapshot holding the command, whichever key comes first',
      handle({
        refresh: { value: command },
        state: getter(closed({ retry: command })),
        raw: getter(1)
      }),
      'held.state.retry: a function in a snapshot'
    ],
    [
      'an interface that is not a plain object',
      closed(
        Object.defineProperties(Object.create(closed({})) as object, {
          state: getter(1),
          raw: getter(1),
          refresh: { value: command }
        })
      ),
      'held: a kind this discipline does not admit'
    ],
    [
      'a configurable getter on an interface',
      Object.preventExtensions(
        Object.defineProperties(
          {},
          {
            state: { get: closed(() => 1), configurable: true },
            raw: getter(1),
            refresh: { value: command }
          }
        )
      ),
      'held.state: configurable'
    ],
    [
      'a named getter with a setter',
      handle({
        state: { get: closed(() => 1), set: closed(() => undefined) },
        raw: getter(1),
        refresh: { value: command }
      }),
      'held.state: a setter'
    ],
    [
      'a command it names and does not hold',
      handle({ state: getter(1), raw: getter(1) }),
      'held.refresh: named and absent'
    ],
    [
      'a command that can be constructed, and its open prototype',
      handle({
        state: getter(1),
        raw: getter(1),
        refresh: { value: closed(function regular() {}) }
      }),
      'held.refresh.prototype: extensible'
    ],
    [
      'a bound command, whose instances share its target’s prototype',
      handle({
        state: getter(1),
        raw: getter(1),
        refresh: { value: closed(function regular() {}.bind(null)) }
      }),
      'held.refresh: a constructible function'
    ],
    [
      'a bound getter, whose instances share its target’s prototype',
      handle({
        state: { get: closed(function regular() {}.bind(null)) },
        raw: getter(1),
        refresh: { value: command }
      }),
      'held.state (its getter): a constructible function'
    ],
    [
      'a function whose own prototype is a function',
      handle({
        state: getter(1),
        raw: getter(1),
        refresh: {
          value: closed(Object.assign(() => undefined, { prototype: closed(() => ({})) }))
        }
      }),
      'held.refresh.prototype: a function as a prototype'
    ],
    [
      'a function’s own prototype that is a host object',
      handle({
        state: getter(1),
        raw: getter(1),
        refresh: {
          value: closed(
            Object.assign(function regular() {}, {
              prototype: closed(Object.setPrototypeOf(new Map(), Object.prototype) as object)
            })
          )
        }
      }),
      'held.refresh.prototype: a host object with internal state (isMap)'
    ],
    [
      'a command whose prototype carries a getter',
      handle({
        state: getter(1),
        raw: getter(1),
        refresh: {
          value: closed(
            Object.setPrototypeOf(
              async () => undefined,
              closed(
                Object.defineProperty(Object.create(Function.prototype) as object, 'ledger', {
                  get: closed(() => ({}))
                })
              )
            ) as object
          )
        }
      }),
      'held.refresh (inherited from a prototype).ledger: a member every instance inherits'
    ]
  ];
  for (const [rule, value, finding, interfaceSpec] of interfaceRules)
    expect(over(value, interfaceSpec), `the interface’s control: ${rule}`).toContain(finding);
  // **A setter on the platform's own chain**, past the first link: installed
  // for this one question and taken back, since it runs on every assignment
  // to that name in this process while it is there.
  Object.defineProperty(Object.prototype, '__pb13Probe', {
    set: () => undefined,
    configurable: true
  });
  try {
    expect(
      breaches(owned(new Ours('x'))),
      'the discipline’s control: a setter the platform holds, two links up'
    ).toContain('held: inherits a setter, __pb13Probe');
  } finally {
    Reflect.deleteProperty(Object.prototype, '__pb13Probe');
  }
  // And the same with one dimension varied each: a symbol-keyed setter on a
  // list's chain, and a setter of a name the language does not restrict on
  // every function's.
  const probe = Symbol('pb13Probe');
  Object.defineProperty(Array.prototype, probe, { set: () => undefined, configurable: true });
  Object.defineProperty(Function.prototype, '__pb13Probe', {
    set: () => undefined,
    configurable: true
  });
  try {
    expect(
      breaches(closed([])),
      'the discipline’s control: a symbol-keyed setter the platform holds'
    ).toContain('held: inherits a setter, Symbol(pb13Probe)');
    expect(
      breaches(
        closed(() => undefined),
        {
          interfaces: new Map(),
          classes: control.classes
        }
      ),
      'the discipline’s control: a setter on every function’s chain, not a restricted one'
    ).toContain('held: inherits a setter, __pb13Probe');
  } finally {
    Reflect.deleteProperty(Array.prototype, probe);
    Reflect.deleteProperty(Function.prototype, '__pb13Probe');
  }
  // **A function interface that can be constructed** — `useSend()`'s answer
  // shape, bound to a regular function — is reported, as a command is.
  const sendLike = closed(function regular() {}.bind(null));
  expect(
    breaches(sendLike, {
      interfaces: new Map([[sendLike, { getters: [], commands: [] }]]),
      classes: control.classes
    }),
    'the discipline’s control: a function interface that can be constructed'
  ).toContain('held: a constructible function');
  // **And an object judged in each role it is reached in**: a host object
  // that is first a link of a chain, then a value beside it.
  const slottedLink = closed(Object.setPrototypeOf(new Map(), Object.prototype) as object);
  const linked = closed(Object.create(slottedLink) as object);
  expect(
    breaches(closed({ first: linked, then: slottedLink }), {
      interfaces: new Map(),
      classes: new Map([[slottedLink, class Holder {}]])
    }),
    'the discipline’s control: one object, two roles'
  ).toEqual(
    expect.arrayContaining([
      'held.first (inherited from a prototype): a host object with internal state (isMap)',
      'held.then: a host object with internal state (isMap)'
    ])
  );

  // Each host kind with internal state, under a borrowed prototype: admitted as
  // a record by its prototype, and refused by its slots.
  const hosts: [string, () => object][] = [
    ['a map', () => new Map()],
    ['a set', () => new Set()],
    ['a weak map', () => new WeakMap()],
    ['a weak set', () => new WeakSet()],
    ['a date', () => new Date(0)],
    ['a typed array', () => new Uint8Array(0)],
    ['an array buffer', () => new ArrayBuffer(1)],
    ['a promise', () => Promise.resolve()],
    ['a boxed number', () => Object(1) as object],
    ['a regular expression', () => /x/g]
  ];
  for (const [kind, make] of hosts)
    expect(
      breaches(closed({ host: closed(Object.setPrototypeOf(make(), Object.prototype) as object) })),
      `the discipline’s control: ${kind}, under a borrowed prototype`
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^held\.host: a host object with internal state/)
      ])
    );
  // **And a `raw` on a snapshot is walked like any other member**: the
  // exemption is read on one interface's getter, which the control above
  // takes away.
  expect(
    breaches(closed({ raw: { open: true } })),
    'a member named `raw`, on a snapshot'
  ).toContain('held.raw: extensible');
}

/** What a consumer imports: the entry, and the outlets each component's props are built from. */
const PUBLISHED = [
  `import type * as Published from '$lib/v1/index.js';`,
  `import type * as Outlets from '$lib/v1/components/outlets.js';`
].join('\n');

/**
 * The published names this row is not about, each for a reason: written by the
 * consumer and handed in, not given out; and the event, whose type is
 * `B5-C6`'s. `NostrSigner` is the consumer's, and so is what this library hands
 * it to sign: a fresh template per call, which signers write to (a common one
 * sets its `id`, `pubkey` and `sig` in place) and which is compared with a
 * frozen copy afterwards, so it reaches no other reader.
 */
const NOT_GIVEN_OUT: Readonly<Record<string, string>> = {
  ReqDescriptor: 'written by the consumer',
  ReqPlan: 'written by the consumer',
  RelayConfig: 'written by the consumer',
  RelayInput: 'written by the consumer',
  EventTemplate: 'written by the consumer',
  NostrSigner: 'supplied by the consumer, and the template it is handed is its to write',
  SendInput: 'written by the consumer',
  SendOptions: 'written by the consumer',
  ReqEvent: 'B5-C6’s'
};

/**
 * Asked once a file: `LE16` and `PB13` both read it, and it is the costliest
 * thing either does. A run of one arm alone — as the mutation ledger runs
 * `PB13` — computes it, and so asserts everything inside it, itself.
 */
let publishedOnce: ReturnType<typeof computePublishedTypes> | undefined;
function publishedTypeBreaches(): ReturnType<typeof computePublishedTypes> {
  publishedOnce ??= computePublishedTypes();
  return publishedOnce;
}

/**
 * What this library hands a consumer's code and the consumer may write: the
 * signer's template, fresh per call and compared with a frozen copy
 * afterwards, so it reaches no other reader. A value of one of these types is
 * not read for what it is handed.
 */
const HANDED_THEIRS: ReadonlySet<string> = new Set(['NostrSigner']);

/** A node of a component's script, as Svelte's parser hands it over: ESTree, with TypeScript's nodes. */
interface ScriptNode {
  readonly type: string;
  readonly name?: string;
  readonly body?: readonly ScriptNode[];
  readonly declaration?: unknown;
  readonly declarations?: readonly ScriptNode[];
  readonly specifiers?: readonly ScriptNode[];
  readonly local?: ScriptNode;
  readonly imported?: ScriptNode;
  readonly id?: unknown;
  readonly callee?: unknown;
  readonly typeAnnotation?: unknown;
  readonly typeArguments?: unknown;
  readonly typeName?: unknown;
  readonly source?: ScriptNode;
  readonly value?: unknown;
  readonly properties?: readonly ScriptNode[];
  readonly elements?: readonly (ScriptNode | null)[];
  readonly argument?: ScriptNode;
  readonly left?: ScriptNode;
}
const isNode = (value: unknown): value is ScriptNode =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string';

/** Every node under `node`, each with the node that holds it. */
function* nodesOf(
  node: ScriptNode,
  holder?: ScriptNode
): Generator<[ScriptNode, ScriptNode | undefined]> {
  yield [node, holder];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range') continue;
    for (const each of Array.isArray(value) ? value : [value])
      if (isNode(each)) yield* nodesOf(each, node);
  }
}

/** The names a binding pattern binds — not its type annotation, not its defaults. */
const patternNames = (pattern: ScriptNode | null | undefined): string[] => {
  if (pattern === null || pattern === undefined) return [];
  switch (pattern.type) {
    case 'Identifier':
      return pattern.name === undefined ? [] : [pattern.name];
    case 'ObjectPattern':
      return (pattern.properties ?? []).flatMap((one) =>
        one.type === 'RestElement'
          ? patternNames(one.argument)
          : patternNames(isNode(one.value) ? one.value : undefined)
      );
    case 'ArrayPattern':
      return (pattern.elements ?? []).flatMap((one) => patternNames(one));
    case 'RestElement':
      return patternNames(pattern.argument);
    case 'AssignmentPattern':
      return patternNames(pattern.left);
    default:
      throw new Error(`propsTypeOf: a binding pattern it cannot read, ${pattern.type}`);
  }
};

/** The names a script's top level binds, each with the node that binds it. */
function bindingsOf(program: ScriptNode): [string, ScriptNode][] {
  const named = (node: unknown): string[] =>
    isNode(node) && node.type === 'Identifier' && node.name !== undefined ? [node.name] : [];
  return (program.body ?? []).flatMap((statement) => {
    const declared =
      statement.type === 'ExportNamedDeclaration' && isNode(statement.declaration)
        ? statement.declaration
        : statement;
    if (declared.type === 'ImportDeclaration')
      return (declared.specifiers ?? []).map(
        (one) => [one.local?.name ?? '', one] as [string, ScriptNode]
      );
    if (declared.type === 'VariableDeclaration')
      return (declared.declarations ?? []).flatMap((one) =>
        patternNames(isNode(one.id) ? one.id : undefined).map(
          (name) => [name, one] as [string, ScriptNode]
        )
      );
    return named(declared.id).map((name) => [name, declared] as [string, ScriptNode]);
  });
}

/**
 * The type a component's `$props()` is annotated with — one name, bound once
 * across the component's scripts, by an unaliased import from the outlets in
 * its instance script — or `undefined`. Read off Svelte's own parse of the
 * component rather than its text, so a local type under an outlet type's
 * name, an alias in one script beside the import in another, an inline
 * annotation or a second `$props()` fails the premise rather than passing on
 * the name it shares. So does a `generics` attribute: it declares type
 * parameters the whole component sees, under any name, an outlet type's
 * included, and none of the scripts' bindings says so.
 */
function propsTypeOf(source: string): string | undefined {
  const parsed = parse(source, { modern: true });
  if (
    [parsed.instance, parsed.module].some((script) =>
      (script?.attributes ?? []).some((attribute) => attribute.name === 'generics')
    )
  )
    return undefined;
  const instance = parsed.instance?.content as unknown as ScriptNode | undefined;
  const module = parsed.module?.content as unknown as ScriptNode | undefined;
  if (instance === undefined) return undefined;
  const scripts = module === undefined ? [instance] : [instance, module];
  const calls = scripts.flatMap((script) =>
    [...nodesOf(script)].filter(
      ([node]) =>
        node.type === 'CallExpression' &&
        isNode(node.callee) &&
        node.callee.type === 'Identifier' &&
        node.callee.name === '$props'
    )
  );
  const [only] = calls;
  if (calls.length !== 1 || only === undefined) return undefined;
  const declarator = only[1];
  const annotation = isNode(declarator?.id) ? declarator.id.typeAnnotation : undefined;
  const reference = isNode(annotation) ? annotation.typeAnnotation : undefined;
  if (
    declarator?.type !== 'VariableDeclarator' ||
    !(instance.body ?? []).some((statement) =>
      (statement.declarations ?? []).includes(declarator)
    ) ||
    !isNode(reference) ||
    reference.type !== 'TSTypeReference' ||
    reference.typeArguments !== undefined ||
    !isNode(reference.typeName) ||
    reference.typeName.type !== 'Identifier'
  )
    return undefined;
  const name = reference.typeName.name ?? '';
  const bound = scripts.flatMap((script) =>
    bindingsOf(script)
      .filter(([each]) => each === name)
      .map(([, node]) => [script, node] as const)
  );
  const [binding] = bound;
  if (bound.length !== 1 || binding === undefined) return undefined;
  const [script, specifier] = binding;
  const declaration = (instance.body ?? []).find(
    (statement) =>
      statement.type === 'ImportDeclaration' && (statement.specifiers ?? []).includes(specifier)
  );
  return script === instance &&
    specifier.type === 'ImportSpecifier' &&
    specifier.imported?.name === name &&
    declaration?.source?.value === './outlets.js'
    ? name
    : undefined;
}

/**
 * Every write the published types let through, by type: each type the entry
 * gives out, each class's instances, what each hook answers, and every
 * argument this library hands a consumer's code — walked by the
 * compiler-asked probe, with a handle's methods taken for its API (their slots
 * refused, what they resolve with walked).
 *
 * **The population is the entry's own, both ways.** It used to be the type
 * entry's names alone, and what a hook answers and what an outlet is handed are
 * not names there: `useRelayDiagnostics()`'s object and every snippet argument
 * were on no walk. So the entry's values are counted too — each one a hook or a
 * component the surface record names — each component's props are read off
 * its source as one of the outlet types, and what this library calls in them,
 * in a hook's parameters and in a command's is read for what it is handed.
 */
function computePublishedTypes(): {
  shapes: string[];
  breaches: string[];
  exceptions: string[];
  lists: ListSite[][];
} {
  const exported = exportsOf('$lib/v1/index.js');
  const names = new Set(exported.map((one) => one.name));
  // Both edges of the exclusion: each name it leaves out is a name the entry
  // exports, so a renamed type is walked rather than silently skipped.
  for (const name of Object.keys(NOT_GIVEN_OUT))
    expect(names.has(name), `${name}, excluded, is published`).toBe(true);
  const values = exported.filter((one) => one.kind === 'value').map((one) => one.name);
  expect([...values].sort(), 'every value the entry exports is a hook or a component').toEqual(
    [...MAIN_SURFACE.hooks, ...MAIN_SURFACE.components].sort()
  );
  // **Every component's props are one of the outlet types**, the provider's
  // included: its `$props()` reads one by name, imported from the outlets and
  // declared nowhere in the component, so the type read below is the one the
  // component has. In the probe's program a component is `Component<any>`, so
  // its props are reached through its source rather than its type.
  const outletTypes = exportsOf('$lib/v1/components/outlets.js')
    .map((one) => one.name)
    .filter((name) => name.endsWith('Props'));
  const COMPONENTS = resolve(LIBRARY, 'components');
  for (const component of MAIN_SURFACE.components)
    expect(outletTypes, `${component}'s props are an outlet type`).toContain(
      propsTypeOf(readFileSync(join(COMPONENTS, `${component}.svelte`), 'utf8'))
    );
  // **A hook is one signature**, so `ReturnType` and `Parameters` read the one
  // a consumer calls rather than the last of several; and what each answers
  // that can be called is a command, whose parameters are read as a hook's are.
  const hookTypes = MAIN_SURFACE.hooks.map((hook) => `typeof Published.${hook}`);
  const answers = MAIN_SURFACE.hooks.map((hook) => `ReturnType<typeof Published.${hook}>`);
  const counted = signaturesOf(PUBLISHED, [...hookTypes, ...answers]);
  for (const [at, hook] of MAIN_SURFACE.hooks.entries())
    expect(counted[at], `${hook} is one signature`).toEqual({ calls: 1, constructs: 0 });
  const walk = { callables: 'api', commands: ['ReqHandle.refresh'], depth: 6 } as const;
  const commandParameters = [
    ...walk.commands.map((command) => {
      const [holder, member] = command.split('.');
      return `Parameters<Published.${holder}[${JSON.stringify(member)}]>`;
    }),
    ...answers
      .filter((_, at) => (counted[MAIN_SURFACE.hooks.length + at]?.calls ?? 0) > 0)
      .map((answer) => `Parameters<${answer}>`)
  ];
  expect(commandParameters, 'the premise: the commands whose parameters are read').toHaveLength(2);
  // **Everything this library calls in what a consumer hands it** — each
  // component's props, each hook's parameters and each command's — read for
  // the arguments it is handed: a snippet's, a callback's, at any depth and in
  // any variant. The signer is the one exemption, and both its edges are
  // asserted: it is met, once, where the provider's props hold it.
  const handedTo = handedArgumentsOf(
    PUBLISHED,
    [
      ...outletTypes.map((name) => `Outlets.${name}`),
      ...hookTypes.map((hook) => `Parameters<${hook}>`),
      ...commandParameters
    ],
    HANDED_THEIRS
  );
  expect(
    handedTo.theirs.map((label) => label.replace(/^value_\d+/, '')),
    'the exemption: the signer, where the provider’s props hold it'
  ).toEqual(['.signer']);
  const outlets = handedTo.handed;
  expect(outlets.length, 'the outlets’ arguments, each a type of its own').toBeGreaterThan(3);
  // **A class is two values a consumer holds**: its instances, walked here,
  // and the class itself, exported by name and reached as `error.constructor`.
  // Its static side is the platform's — `ErrorConstructor`'s members, as the
  // default library and the host's typings declare them, `Function`'s, and the
  // `prototype` TypeScript gives every class — so what this asks of it is that
  // it holds nothing of this library's; at run time the class is sealed, and
  // the discipline reads it through every instance's chain.
  for (const one of exported.filter((each) => each.kind === 'class')) {
    // Nothing of this library's on it — read by where each member is declared,
    // since a static of this library's under a name the platform also uses
    // (`isError`) passes the list below by name.
    expect(
      declaredHere(PUBLISHED, `typeof Published.${one.name}`),
      `${one.name}'s static side declares nothing of this library's`
    ).toEqual([]);
    // **And what it does hold, pinned**: the platform's — `ErrorConstructor`'s
    // members, as the default library and the host's typings declare them,
    // and the `prototype` TypeScript gives every class. Each type-checks as
    // an assignment, and the sealed class refuses it at run time, which is the
    // price `B5-C8` states; a member added here is a change to that price.
    expect(
      memberNamesOf(PUBLISHED, `typeof Published.${one.name}`).sort(),
      `${one.name}'s static side is the platform's`
    ).toEqual([
      'captureStackTrace',
      'isError',
      'prepareStackTrace',
      'prototype',
      'stackTraceLimit'
    ]);
  }
  const shapes = [
    ...exported
      .filter((one) => one.kind !== 'value' && !Object.hasOwn(NOT_GIVEN_OUT, one.name))
      .map((one) =>
        one.kind === 'class'
          ? `InstanceType<typeof Published.${one.name}>`
          : `Published.${one.name}`
      ),
    ...MAIN_SURFACE.hooks.map((hook) => `ReturnType<typeof Published.${hook}>`),
    ...outlets
  ];
  // Its control: a class that declares a static of its own, under a name the
  // platform also uses.
  expect(
    declaredHere(
      'export {};\nclass Registry extends Error { static override isError(value: unknown): value is Error { return value instanceof Error; } }',
      'typeof Registry'
    ),
    'the static side’s control'
  ).toEqual(['isError']);
  // A function is a command only where the handle names one — `ReqHandle`'s
  // `refresh`, by the type that declares it — and at a root, `useSend()`'s
  // answer; anywhere else it is data's, and is reported.
  const { writes, lists, types } = walkEach(PUBLISHED, shapes, walk);
  // **Each argument's text names the argument**: a text that resolved to
  // another type — `never`, under a key the text spelled differently from the
  // type — would be walked, find nothing to write, and read as refused.
  expect(
    types.slice(shapes.length - outlets.length),
    'each argument, as its text names it'
  ).toEqual(handedTo.types);
  const verdicts = judgeWritesEach(PUBLISHED, shapes, writes);
  const judged = shapes.flatMap((typeText, at) =>
    // ` :: ` between the shape and the line, since a shape's own text can
    // hold a colon (a conditional type does).
    (verdicts[at] ?? []).map((one) => ({ ...one, line: `${typeText} :: ${one.write}` }))
  );
  // What each hook answers is walked, and something in it is refused — so a
  // hook whose answer fell out of the walk is a failure, not one type fewer.
  for (const hook of MAIN_SURFACE.hooks)
    expect(
      judged.some(
        (one) =>
          one.line.startsWith(`ReturnType<typeof Published.${hook}> ::`) &&
          one.verdict === 'refused'
      ),
      `what ${hook} answers is walked`
    ).toBe(true);
  // **One exception, stated in the row rather than hidden here**: a member
  // TypeScript's default library declares on every value of its kind —
  // `Object`'s, a function's, a read-only list's — is an assignable slot in
  // those declarations, and the lists stay arrays rather than refuse that write
  // by type. Returned apart, so an arm asserts the whole table by name.
  const breaches = judged
    .filter((one) => one.verdict !== 'refused' && one.verdict !== 'a standard member slot')
    .map((one) => `${one.line} (${one.verdict})`);
  const exceptions = judged
    .filter((one) => one.verdict === 'a standard member slot')
    .map((one) => one.line);
  return { shapes, breaches, exceptions, lists };
}

/**
 * Every member the stated exception admits, by how a consumer spells it:
 * `Object`'s on any value, `Function`'s, `CallableFunction`'s and
 * `NewableFunction`'s on a function, `ReadonlyArray`'s on a read-only list —
 * the table the rows give examples from, pinned whole, so a TypeScript library
 * that declares one more widens the exception here rather than silently.
 */
const STANDARD_SLOTS = [
  '.apply',
  '.arguments',
  '.at',
  '.bind',
  '.call',
  '.caller',
  '.concat',
  '.constructor',
  '.entries',
  '.every',
  '.filter',
  '.find',
  '.findIndex',
  '.findLast',
  '.findLastIndex',
  '.flat',
  '.flatMap',
  '.forEach',
  '.hasOwnProperty',
  '.includes',
  '.indexOf',
  '.isPrototypeOf',
  '.join',
  '.keys',
  '.lastIndexOf',
  '.map',
  '.propertyIsEnumerable',
  '.prototype',
  '.reduce',
  '.reduceRight',
  '.slice',
  '.some',
  '.toLocaleString',
  '.toReversed',
  '.toSorted',
  '.toSpliced',
  '.toString',
  '.valueOf',
  '.values',
  '.with',
  '[Symbol.hasInstance]',
  '[Symbol.iterator]',
  '[Symbol.metadata]'
];

/**
 * The stated exception, held to its statement: every line it covers is an
 * assignment of a member to its own slot — `x.m = x.m!;`, nothing else — and
 * it covers every published list and the handle's `refresh`, so it is a
 * measured concession over a population, not a gap the probe stopped reading.
 */
function exceptionStated(exceptions: readonly string[]): void {
  expect(
    [
      ...new Set(
        exceptions.map(
          (line) => /(\.\w+|\[Symbol\.\w+\]) = [^=]*!;$/.exec(line)?.[1] ?? `? ${line}`
        )
      )
    ].sort(),
    'the members the exception admits, and no other'
  ).toEqual(STANDARD_SLOTS);
  for (const line of exceptions)
    expect(line, 'an exception line is a slot written with its own member').toMatch(
      /^.+? :: (?:if \(.*?\) |for \(.*?\) )*(.+?)(\.\w+|\[Symbol\.\w+\]) = \1\2!;$/
    );
  for (const list of [
    'events',
    'causes',
    'refusals',
    'incompleteCauses',
    'configuredUrls',
    'relays',
    'urls',
    'tags'
  ])
    expect(
      exceptions.some((line) => line.includes(`.${list}!.map = `)),
      `the exception, on ${list}`
    ).toBe(true);
  // And the members every value has: `Object`'s on a record, `Function`'s on
  // a function — `prototype`, `caller` and `arguments` are data slots, and the
  // exception is about whose declaration a member is, not whether it is called.
  for (const universal of [
    '.refresh!.call = ',
    '.refresh!.prototype = ',
    '.refresh!.caller = ',
    '.diagnostics!.constructor = ',
    '.diagnostics!.toString = '
  ])
    expect(
      exceptions.some((line) => line.includes(universal)),
      `the exception, on ${universal.slice(1, -3)}`
    ).toBe(true);
}

describe('what a request publishes is the consumer’s to hold and nobody else’s', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => WS.clean());

  it('PB1: every container a consumer can reach through a hook is frozen', async () => {
    const { rxNostr, server } = createTestRelay(nextUrl());
    const { value: handle, destroy } = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: 'po1',
        filters: [{ kinds: [1] }],
        reqIdBase: 'po1',
        settleTimeoutMs: 300
      }))
    );

    const req = await waitForReq(server);
    respondWithEvent(server, req, fakeEvent({ id: 'po1-a', created_at: 1, tags: [['t', 'ok']] }));
    // A refusal rather than an EOSE, so the outcome carries refusals and causes
    // as well as events — the three containers this arm exists to walk.
    server.send(['CLOSED', req, 'rate-limited: slow down']);
    await settle(400);

    // The premise, asserted rather than assumed: a walk over an empty answer
    // would pass this arm while measuring nothing.
    const state = handle.state as { status: string; events?: readonly unknown[] };
    expect(state.status).toBe('incomplete');
    expect(state.events).toHaveLength(1);
    expect(handle.diagnostics.refusals).toHaveLength(1);

    // **`raw` and `projected` are excluded, and the exclusion is not free.**
    // `handle.raw.data.entries.clear()` empties the cached value and flips
    // another hook on the same key to "settled, nothing exists" — measured — so
    // while that member is on the handle, this arm's contract holds for what
    // the API *publishes* and not through that seam. 0004 records it as the
    // price of the seam rather than as a property of the design.
    //
    // **The handle is a published value too**, and walking it found something
    // naming values could not: the object carries two members `0004`'s
    // `ReqHandle` does not declare — `raw`, the query library's own object with
    // the cache's `Map` under it, and `projected`, what one read derives. They
    // are this repository's inspection seams (`errormap` and `measurements` read
    // `raw`), they are not on the published entry, and `PB13`'s interface for
    // this handle names exactly these beside the published members, so a third
    // is a finding rather than the first of several. This said `PO2` held that,
    // over `raw` alone; `PO2` is a spike witness this branch has not ported.
    const seams = ['raw', 'projected'];
    const reachable = [
      ...containers(handle.state, 'state'),
      ...containers(handle.diagnostics, 'diagnostics'),
      ...containers(
        Object.fromEntries(Object.entries(handle).filter(([member]) => !seams.includes(member))),
        'handle'
      )
    ];
    // The instrument found things at all — the same null-result guard as above,
    // one level down.
    expect(reachable.length).toBeGreaterThan(6);

    const open = reachable
      .filter(([where, value]) => where !== 'handle' && !Object.isFrozen(value))
      .map(([where]) => where);
    expect(open, 'a published container a consumer could write into').toEqual([]);

    destroy();
  });

  it('PB3: the leg’s end and what `refresh()` resolves with are the consumer’s too', async () => {
    // **`PO1` walks a value that has neither.** Its request is not live, so
    // there is no forward leg and `diagnostics.legEnded` is `undefined`; and a
    // walk of the handle never calls `refresh()`, so the object that call
    // resolves with is on no path it takes. Both were open, and `PO1` was green
    // over a value carrying them — which is the shape of instrument gap this
    // file exists to keep finding.
    //
    // Two callers is not an embellishment here: `refresh()` resolves every
    // waiter of one attempt with **one object** (C15, asserted with `toBe`), so
    // a write by one consumer is a write to what the other reads.
    const { rxNostr, server } = createTestRelay(nextUrl());
    const { value: handle, destroy } = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: 'po3',
        filters: [{ kinds: [1] }],
        live: true,
        retain: 'unbounded',
        reqIdBase: 'po3',
        settleTimeoutMs: 300
      }))
    );

    const req = await waitForReq(server);
    respondWithEvent(server, req, fakeEvent({ id: 'po3-a', created_at: 1 }));
    respondWithEose(server, req);
    await settle(150);

    // The leg ends because every relay in the target set went terminal, which
    // is the door `P18a` uses.
    rxNostr.dispose();
    await settle(200);

    // The premise, asserted: without an end this walks nothing.
    const ended = handle.diagnostics.legEnded;
    expect(ended?.kind).toBe('ended');
    const openEnds = containers(ended, 'legEnded')
      .filter(([, value]) => !Object.isFrozen(value))
      .map(([where]) => where);
    expect(openEnds, 'the leg’s end is republished from the cache on every read').toEqual([]);
    destroy();

    // **The outcome, on its own request.** A second mount rather than the one
    // above: the live request has two subscriptions in flight, so the reply
    // this would have to steer is not the one `nextMessage` hands back, and an
    // arm that waits on the wrong REQ measures nothing while looking patient.
    const second = createTestRelay(nextUrl());
    const { value: other, destroy: destroySecond } = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr: second.rxNostr,
        client,
        namespace: 'po3b',
        filters: [{ kinds: [1] }],
        reqIdBase: 'po3b',
        settleTimeoutMs: 300
      }))
    );
    const first = await waitForReq(second.server);
    respondWithEose(second.server, first);
    await settle(150);

    // Not awaited before the relay is served: `refresh()` opens a second
    // attempt, and an attempt nobody answers stays pending until the settle
    // timeout — which is why the arms that do await one bare wrap it in a
    // budget. **The option that bounds it is `settleTimeoutMs`**: this file was
    // written with `timeoutMs`, which is not a field of the descriptor and is
    // passed through untouched, so every arm here ran on the 5s default and
    // this one took five seconds to answer while looking like it was waiting on
    // the relay.
    const pending = other.refresh();
    const again = await waitForReq(second.server);
    respondWithEose(second.server, again);
    const outcome = await pending;
    expect(outcome.kind).toBeDefined();
    const openOutcome = containers(outcome, 'outcome')
      .filter(([, value]) => !Object.isFrozen(value))
      .map(([where]) => where);
    expect(openOutcome, 'two callers of one refresh hold one object').toEqual([]);

    destroySecond();
  });

  it('PB4: an attempt that failed publishes an Error the consumer cannot rewrite', async () => {
    // **The third Error on this surface, and the one the other two arms cannot
    // reach.** `PO1` walks an *incomplete* answer, whose `state.error` is the
    // memoised `IncompleteResultError`; this is the other kind — an attempt
    // that failed, whose Error is stored on the cached value by `noteFailure`
    // and republished on `state.error` and `diagnostics.lastError`.
    //
    // The library did not make this one, which is the reason it was missed: an
    // object arriving from outside looks like somebody else's until you notice
    // that keeping it is what makes it shared. Two hooks on one key read it,
    // and `refresh()` hands it back by identity.
    const failure = new Error('the accumulator threw before reaching streamFn');
    const accumulator: StreamAccumulator = () => async () => {
      throw failure;
    };
    const { rxNostr } = createTestRelay(nextUrl());
    const { value: handle, destroy } = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: 'po4',
        filters: [{ kinds: [1] }],
        reqIdBase: 'po4',
        settleTimeoutMs: 300,
        accumulator
      }))
    );
    await settle(150);

    // The premise: without a failure this walks an answer that has none.
    expect(handle.state.status).toBe('error');
    const open = [
      ...containers(handle.state, 'state'),
      ...containers(handle.diagnostics, 'diagnostics')
    ]
      .filter(([, value]) => !Object.isFrozen(value))
      .map(([where]) => where);
    expect(open, 'the failure is stored on the value and published to every reader').toEqual([]);

    // **And it is not the object the caller threw.** The failure channel
    // publishes a value this library made (`own.ts`): what a consumer holds
    // carries the message and is frozen, and their `Error` comes back from the
    // boundary untouched — which is the guarantee the old design could not give,
    // because it kept their object and had to defend it.
    const state = handle.state as { error?: Error };
    expect(state.error, 'ours, not theirs').not.toBe(failure);
    expect(state.error?.message).toBe(failure.message);
    expect(Object.isFrozen(failure), 'their Error is as they left it').toBe(false);
    // One object across the two surfaces, which is what makes "the same failure"
    // a thing a consumer can check.
    expect(handle.diagnostics.lastError).toBe(state.error);

    destroy();
  });

  it('PB5: the refusal two unrelated requests share is not either of theirs to write', async () => {
    // **The most widely shared object on this surface, and the last one still
    // open.** A refused descriptor is filed under `['nosvelte', 'refused',
    // <message>]`, so two hooks asking entirely different questions — different
    // filters, different namespaces — refused for the same field are handed one
    // Error. 0003 argues the merge is safe because such an entry holds an error
    // and nothing else, "so the only thing a merge here could hand one caller is
    // the other's identical message". Measured: it handed one caller the
    // other's **mutation**, on `state.error` and on `diagnostics.lastError`.
    //
    // `PO1` and `PO4` walk accepted descriptors; this is the third kind of
    // answer a hook can hold, and no arm mounted one.
    const { rxNostr } = createTestRelay(nextUrl());
    const refused = (namespace: string, kind: number) =>
      mount(() =>
        useStreamedReq(() => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace,
          filters: [{ kinds: [kind], search: 'unsupported' } as unknown as { kinds: number[] }],
          reqIdBase: namespace,
          settleTimeoutMs: 300
        }))
      );
    // **One namespace, two questions.** This arm used to use two namespaces,
    // and that sharing is gone: `namespace` is on the refused key now, because
    // the published type says it can only split and it was merging here.
    // What still shares — and is what this arm is about — is two *different
    // filters* refused for the same field under one namespace, which is the
    // everyday case of one consumer asking two things.
    const sidebar = refused('po5-shared', 1);
    const timeline = refused('po5-shared', 7);
    await settle(150);

    // The premise, in two halves: both are refusals, and they really are the
    // same object — without the second line this arm is about one hook.
    const first = (sidebar.value.state as { error?: Error }).error;
    const second = (timeline.value.state as { error?: Error }).error;
    expect(first?.name).toBe('UnsupportedFilterError');
    expect(first).toBe(second);

    const open = [
      ...containers(sidebar.value.state, 'state'),
      ...containers(sidebar.value.diagnostics, 'diagnostics')
    ]
      .filter(([, value]) => !Object.isFrozen(value))
      .map(([where]) => where);
    expect(open, 'a refusal is published to every request that shares its message').toEqual([]);

    // The effect, which is what is contracted: the sidebar writing to what it
    // holds does not change what the timeline reads.
    const before = second?.message;
    try {
      (first as unknown as { message: string }).message = 'HIJACKED by the sidebar';
    } catch {
      // A frozen object refuses, which is one way of keeping the promise.
    }
    expect((timeline.value.state as { error?: Error }).error?.message).toBe(before);
    expect(timeline.value.diagnostics.lastError?.message).toBe(before);

    // **And the split the type promises, measured through the operation that
    // needs it.** `ReqDescriptor.namespace` is published as partitioning the
    // cache — "it can only split, never merge" — and the refused path was the
    // one place that was false. The consumer-visible act is clearing one
    // namespace, so that is what is done here rather than reading the key back:
    // `removeQueries` with a namespace prefix.
    //
    // **Both edges**, because "only mine is cleared" is two claims: the entry
    // under the other namespace survives, and mine is actually gone. Asserting
    // only the first passes on an implementation where the prefix matches
    // nothing at all — which is exactly what keying on the message alone does.
    const elsewhere = refused('po5-elsewhere', 1);
    await settle(150);
    expect((elsewhere.value.state as { error?: Error }).error?.name).toBe('UnsupportedFilterError');

    const held = () =>
      client
        .getQueryCache()
        .getAll()
        .map((entry) => entry.queryKey)
        .filter((key) => Array.isArray(key) && key[1] === 'refused').length;
    expect(held(), 'two namespaces, refused, are two entries').toBe(2);

    client.removeQueries({ queryKey: ['nosvelte', 'refused', 'po5-shared'] });
    expect(held(), 'clearing one namespace leaves the other').toBe(1);

    client.removeQueries({ queryKey: ['nosvelte', 'refused', 'po5-elsewhere'] });
    expect(held(), 'and clears the one it names').toBe(0);

    elsewhere.destroy();
    sidebar.destroy();
    timeline.destroy();
  });

  it('PB9: what a consumer holds cannot be written, including the member freezing does not close', async () => {
    // **`Object.freeze` does not close `stack`, and `Object.isFrozen` says
    // `true` anyway.** On V8 an `Error`'s `stack` is an own *accessor* — a
    // get/set pair, no `writable` in the descriptor — so every published Error
    // on this channel accepted `error.stack = '…'` while every instrument here
    // reported it frozen. Two hooks on one key share one object, so one wrote
    // what the other read, on `state.error` and on `diagnostics.lastError`:
    // `B5-C6`'s contract word for word, surviving the repair that was supposed
    // to close it.
    //
    // The walk cannot see it — `stack` is a string, so it is never a container —
    // and `Object.isFrozen` is exactly the question that answers wrongly here.
    // So this arm **writes**, and reads the value back through a second reader.
    // A refused descriptor, which is the shape `PO5` uses: two hooks refused for
    // the same reason are handed **one** object, so the sharing is by
    // construction rather than by arrangement.
    const { rxNostr } = createTestRelay(nextUrl());
    const ask = (kind: number) =>
      mount(() =>
        useStreamedReq(() => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace: 'po9',
          filters: [{ kinds: [kind], search: 'unsupported' } as unknown as { kinds: number[] }],
          reqIdBase: 'po9',
          settleTimeoutMs: 200
        }))
      );
    const first = ask(1);
    const second = ask(7);
    await settle(150);

    const held = (first.value.state as { error?: Error }).error;
    const other = (second.value.state as { error?: Error }).error;
    expect(held, 'the premise: an answer with an Error on it').toBeInstanceOf(Error);
    expect(other, 'and both hooks hold the same one').toBe(held);

    // **Every own property, derived — where this loop used to list three.**
    // `message`, `name` and `stack` are not what a published failure carries:
    // this one also has `field` and `code`, and `code` is the member `C16` says
    // a consumer branches on when `instanceof` cannot be trusted. A population
    // written out by hand answers about the members somebody remembered, and the
    // one it left out is the one the design is for.
    const membersOf = (value: object): string[] => Object.getOwnPropertyNames(value).sort();
    const refusalMembers = membersOf(held as object);
    expect(refusalMembers, 'the population is the value’s own, and it is not three').toEqual([
      'code',
      'field',
      'message',
      'name',
      'stack'
    ]);

    // Every one of them written to. What is contracted is the effect: a second
    // reader does not see it.
    for (const member of refusalMembers) {
      const before = (held as unknown as Record<string, unknown>)[member];
      try {
        (held as unknown as Record<string, unknown>)[member] =
          `${member.toUpperCase()} OVERWRITTEN`;
      } catch {
        // A closed property refuses, which is one way of keeping the promise.
      }
      expect(
        (other as unknown as Record<string, unknown>)[member],
        `${member} is not one hook's to rewrite`
      ).toBe(before);
      // **And on the other hook's other surface.** The line that stood here was
      // `expect(first.value.diagnostics.lastError?.stack).toBe(held?.stack)` —
      // the hook that did the writing, reading back the object it had just
      // written to, with no value from before the write to compare against. In
      // this arrangement those two expressions are one object, so the line
      // answered `true` whatever the setter did. The read is the *second* hook's
      // diagnostics now, and it is compared with what stood there beforehand.
      expect(
        (second.value.diagnostics.lastError as unknown as Record<string, unknown> | undefined)?.[
          member
        ],
        `${member} does not reach the other hook's diagnostics either`
      ).toBe(before);
    }

    // **And a `ReqFailure`, which is the class this arm did not cover and the
    // one the order was wrong for.** The refusal above is an
    // `UnsupportedFilterError`, whose constructor registers *before* it freezes
    // — the right order, arrived at by accident. `ReqFailure`'s factory froze
    // first, so closing `stack` threw into a `catch` and the setter stayed live
    // while `Object.isFrozen` answered `true`. A population that leaves out the
    // class the boundary *builds* is a population that answers about somebody
    // else.
    //
    // **Carrying a `cause`, because that is a member too.** A snapshot of an
    // Error with nothing under it has no `cause` at all, so the population this
    // loop derives would not have contained the one field the channel narrows
    // from `Error`'s `unknown`.
    //
    // **Captured at the `unspecified` door, and it used to be at `relay`.** The
    // failure *record* is narrower than a state's error now — `FailureRecord`
    // carries a `RefreshOutcomeError`, three codes — and `noteFailure` puts
    // everything through the total function into it. A relay-sourced snapshot is
    // not one of the three, so it is re-derived and the premise below stops
    // being true of it: not because the writer stopped carrying what it is
    // handed, but because a relay failure is not a thing this writer records.
    // The narrowing is asserted on its own two lines down, so the door this arm
    // moved to is not quietly standing in for it.
    const captured = capture(
      new Error('a value from outside', { cause: new Error('and what it points at') }),
      'unspecified'
    );
    // The same value through the writer *first*, so the read-back below comes
    // out of the record a consumer is handed rather than out of the local
    // variable that was written to.
    //
    // **`Object.isFrozen` is not the premise any more.** It stood here as one,
    // and it is precisely the question that answers `true` about a value whose
    // `stack` setter is still live — the defect this arm exists for. What is
    // asserted instead is the thing the premise was standing in for: this is the
    // object the writer carries, so writing to it is writing to what a reader
    // holds.
    const attemptId = attempts.mint();
    const stored = noteFailure(beginAttempt(emptyEventSet, attemptId), attemptId, captured).failure
      ?.error;
    expect(stored, 'the premise: carried, not re-derived').toBe(captured);
    // **And the other edge of the premise, so that "carried" is a claim rather
    // than the only case anyone tried.** A value the record cannot hold is
    // re-derived into one it can: same writer, same attempt, a snapshot from the
    // relay door, and what comes out is a different object wearing the record's
    // own code. Without this line the arrangement above would look like a
    // property of the writer instead of a property of what it was handed.
    const fromRelay = capture(new Error('a relay gave out'), 'relay');
    const narrowed = noteFailure(beginAttempt(emptyEventSet, attemptId), attemptId, fromRelay)
      .failure?.error;
    expect(narrowed, 'a value the record cannot hold is not carried').not.toBe(fromRelay);
    // **And it is re-derived into the entrance it came through, not into "this
    // library cannot say".** It read `unspecified` here for a round, which is
    // the remedy for a fault nothing can attribute — and this one can be: a
    // relay-door value at a *terminal* door has come back out of the
    // accumulator seam, because the relay door is the only place one is minted
    // and the seam is the only thing between the two (`A11-P4`).
    expect(narrowed, 'it is re-derived into the record’s own narrower type').toMatchObject({
      code: 'accumulator-contract'
    });
    expect(narrowed?.cause, 'with the relay’s own words kept underneath').toBe(fromRelay);

    const snapshotMembers = membersOf(captured);
    expect(snapshotMembers, 'the snapshot’s own members, including the ones it derived').toEqual([
      'cause',
      'code',
      'message',
      'name',
      'source',
      'stack',
      'thrownName',
      'truncated'
    ]);
    for (const member of snapshotMembers) {
      const before = (captured as unknown as Record<string, unknown>)[member];
      try {
        (captured as unknown as Record<string, unknown>)[member] = 'SNAPSHOT OVERWRITTEN';
      } catch {
        // Closed properties refuse, which is one way of keeping the promise.
      }
      expect(
        (stored as unknown as Record<string, unknown> | undefined)?.[member],
        `a snapshot's ${member} is not the consumer's to rewrite`
      ).toBe(before);
    }

    first.destroy();
    second.destroy();
  });

  it(
    'LE16: every member of every published type is readonly, to the depth a consumer can reach',
    {
      // A compile of every published shape, asked of the compiler line by
      // line: well under a minute here, and past one on a shared CI runner.
      timeout: 300_000
    },
    () => {
      // **The type half of the rule, counted rather than checked value by value.**
      // The spike's `LK16` was a regular expression over the emitted declarations,
      // then a syntax walk, and each read less than it claimed: one variant of a
      // union, no index signature, no method's return. This asks the compiler
      // instead — every published shape, every write a consumer could attempt
      // through it, each judged on the type the compiler gives the line — and the
      // handle's `refresh` is walked as API: its slot refused, what it resolves
      // with walked as a value the consumer holds.
      const { shapes, breaches, exceptions } = publishedTypeBreaches();
      expect(shapes.length, 'the published shapes, counted').toBeGreaterThan(25);
      expect(breaches, 'a write a published type lets through').toEqual([]);
      exceptionStated(exceptions);
    }
  );

  // @contracts B5-C8
  it(
    'PB13: what a hook publishes keeps the publication discipline, a write to its Errors reaches no reader, and no published type lets a write through',
    { timeout: 300_000 },
    async () => {
      // **Every clause of the row in one arm.** At run time, every value a hook
      // hands out — on each path that builds one — keeps the publication
      // discipline `breachesOf` reads: every object reachable from it closed,
      // no setter on its own or inherited path, nothing but plain records,
      // lists and this library's own Errors in a snapshot, and a live
      // interface holding the getters and commands it names and nothing else.
      // A value that keeps it cannot be changed by any write a consumer
      // spells, so it carries no write to the cache, another reader, a later
      // projection or itself. For Errors the effect is read as well: every
      // member written and read back through each reader the row names. At
      // compile time, every member of every published type but the event
      // refuses a write, with one exception the row states.
      disciplineControls();

      const roster: string[] = [];
      const breaches: string[] = [];
      const check = (
        name: string,
        root: unknown,
        interfaces: readonly (readonly [object, LiveInterface])[] = []
      ): void => {
        roster.push(name);
        // A root with nothing in it keeps every rule by default, so a case that
        // arranged nothing would count as one that passed.
        expect(
          typeof root === 'function' || (typeof root === 'object' && root !== null),
          `${name}: the premise, a value to read`
        ).toBe(true);
        breaches.push(...breachesOf(root, name, disciplineOver(interfaces)));
      };
      const engine = (handle: object): [object, LiveInterface][] => [[handle, ENGINE_HANDLE]];
      // The codes a published Error was reached under, and those `refresh()`
      // rejected with — each set compared at the end with the library's own
      // list, so a code nobody arranged is a missing name rather than a
      // quieter green.
      const codes = new Set<string>();
      const reached = (code: string, error: unknown): void => {
        expect((error as { code?: unknown } | undefined)?.code, `the premise: ${code}`).toBe(code);
        codes.add(code);
      };
      const rejections = new Set<string>();
      const rejectedWith = (code: string, rejected: unknown): void => {
        reached(code, rejected);
        rejections.add(code);
      };
      // **What a command returns is the platform's `Promise` and nothing
      // more**: one with a member of its own would be a value this library
      // hands out that no case here reads. Asked of every `refresh()` below,
      // each path's own, since a path may build its promise apart.
      // Its prototype and its own keys are a proxy's to answer, so the
      // promise's own slot is asked too.
      const bare = <T>(returned: Promise<T>, name: string): Promise<T> => {
        expect(
          types.isPromise(returned) && !types.isProxy(returned),
          `${name}: the platform’s own promise, not a stand-in`
        ).toBe(true);
        expect(Object.getPrototypeOf(returned), `${name}: a promise of the platform’s`).toBe(
          Promise.prototype
        );
        expect(Reflect.ownKeys(returned), `${name}: with nothing of its own`).toEqual([]);
        return returned;
      };
      expect(
        () => bare(new Proxy(Promise.resolve(), {}), 'a proxy over a promise'),
        'the promise check’s control: a proxy that answers both other questions as a promise'
      ).toThrow(/a proxy over a promise: the platform’s own promise, not a stand-in/);
      // An Error two readers share, written to through the first and read
      // back through each: first shown to be one object, so an unchanged read
      // is about this Error and not another.
      // Each answer it wrote to is recorded, so a case that stops writing is
      // missing from the record rather than silent.
      const writtenBack: string[] = [];
      const sharedAndKept = (
        answer: string,
        readers: Readonly<Record<string, () => unknown>>
      ): void => {
        const held = readers['the value written to']?.();
        expect(held, `${answer}: the premise, an Error to write to`).toBeInstanceOf(Error);
        for (const [reader, read] of Object.entries(readers))
          expect(read(), `${answer}: the premise, ${reader} holds the same Error`).toBe(held);
        const { before, reached } = writeAndReadBack(held as object, readers);
        // Each reader sampled before the write and after it, not only shown to
        // hold the Error: a reader left out of the write-back would read as one
        // the write did not reach.
        expect(Object.keys(before), `${answer}: every reader read back`).toEqual(
          Object.keys(readers)
        );
        expect(reached, `${answer}: a reader the consumer’s write reached`).toEqual([]);
        writtenBack.push(answer);
      };
      // The cache's reader of a request's Error: the one entry of `namespace`
      // in `cache`, whether the key names it as a part (a refused key) or
      // inside its descriptor. No namespace, or not exactly one entry, is
      // answered as it was found, which no Error is.
      const cacheOf = (cache: QueryClient, namespace: string | undefined) => (): unknown => {
        if (namespace === undefined) return 'no namespace to find an entry by';
        const found = cache
          .getQueryCache()
          .getAll()
          .filter((entry) =>
            entry.queryKey.some(
              (part) =>
                part === namespace ||
                (typeof part === 'string' && part.includes(`"ns":${JSON.stringify(namespace)}`))
            )
          );
        const [only] = found;
        return found.length === 1 && only !== undefined
          ? (only.state as { error?: unknown }).error
          : found;
      };
      // **A fresh one each call, the caller's own**: every path below is
      // asked twice, and the two answers are two promises. The second is
      // settled before the population is counted, so neither is left behind,
      // and what it settles with is read for the discipline as the first's is.
      const seconds: [string, Promise<unknown>][] = [];
      const againOf = (name: string, value: unknown): void => {
        breaches.push(...breachesOf(value, `${name}, asked again`, disciplineOver([])));
      };
      const twice = <T>(call: () => Promise<T>, name: string): [Promise<T>, Promise<T>] => {
        const pair: [Promise<T>, Promise<T>] = [bare(call(), name), bare(call(), name)];
        expect(pair[0], `${name}: a fresh promise each call`).not.toBe(pair[1]);
        return pair;
      };
      const fresh = <T>(call: () => Promise<T>, name: string): Promise<T> => {
        const [first, second] = twice(call, name);
        seconds.push([name, second]);
        return first;
      };
      const rejectionOf = async (call: () => Promise<unknown>): Promise<unknown> => {
        const settled = async (
          pending: Promise<unknown>
        ): Promise<{ thrown: unknown } | undefined> => {
          try {
            await pending;
          } catch (thrown) {
            return { thrown };
          }
          return undefined;
        };
        const [first, second] = await Promise.all(
          twice(call, 'what a rejected refresh() returns').map(settled)
        );
        if (first === undefined || second === undefined)
          throw new Error('the premise: refresh() rejects, each call');
        againOf('what a rejected refresh() rejects with', second.thrown);
        return first.thrown;
      };
      // What one outlet was handed, rendered once over `request` — and the
      // premise that it was rendered at all.
      const outlet = (request: object, single: boolean, slot: string): unknown => {
        const handed = new Map<string, unknown>();
        const view = render(Outlets, {
          props: {
            request: request as ReqHandle,
            single,
            held: (outlet: string, argument: unknown) => {
              handed.set(outlet, argument);
            }
          }
        });
        flush();
        view.unmount();
        expect([...handed.keys()], `the premise: the ${slot} outlet was rendered`).toEqual([slot]);
        return handed.get(slot);
      };
      const options =
        (
          namespace: string,
          rxNostr: RxNostr | undefined,
          extra: Partial<UseStreamedReqOpts> = {}
        ) =>
        (): UseStreamedReqOpts => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace,
          filters: [{ kinds: [1] }],
          reqIdBase: namespace,
          settleTimeoutMs: 300,
          ...extra
        });
      const refusedFilter = (kind: number): { kinds: number[] } =>
        ({ kinds: [kind], search: 'unsupported' }) as unknown as { kinds: number[] };

      // **The premise the outlet cases rest on**: every request component
      // renders its outlets through `RequestOutlets`, which is the one place an
      // outlet's argument is built — the only other `{@render` in a component
      // is `NostrApp`'s `children()`, which is handed nothing.
      const COMPONENTS = resolve(LIBRARY, 'components');
      const rendering = readdirSync(COMPONENTS)
        .filter((file) => file.endsWith('.svelte'))
        .filter((file) => readFileSync(join(COMPONENTS, file), 'utf8').includes('{@render'))
        .sort();
      expect(rendering, 'where an outlet’s argument can be built').toEqual([
        'NostrApp.svelte',
        'RequestOutlets.svelte'
      ]);
      expect(
        readFileSync(join(COMPONENTS, 'NostrApp.svelte'), 'utf8').match(/\{@render [^}]*\}/g),
        'and the provider’s is handed nothing'
      ).toEqual(['{@render children()}']);

      // A request through each status, and what one refresh resolves with.
      {
        const { rxNostr, server } = createTestRelay(nextUrl());
        const held = mount(() => useStreamedReq(options('pb13-status', rxNostr)));
        const req = await waitForReq(server);
        expect(held.value.state.status, 'the premise: loading').toBe('loading');
        check('a request loading', held.value, engine(held.value));
        check('its loading outlet', outlet(held.value, false, 'loading'), engine(held.value));

        respondWithEvent(
          server,
          req,
          fakeEvent({ id: 'pb13-a', created_at: 1, tags: [['t', 'ok']] })
        );
        await settle();
        expect(held.value.state.status, 'the premise: streaming').toBe('streaming');
        check('a request streaming', held.value, engine(held.value));

        respondWithEose(server, req);
        await settle();
        expect(held.value.state.status, 'the premise: settled').toBe('settled');
        check('a request settled', held.value, engine(held.value));
        check('its events outlet', outlet(held.value, false, 'events'), engine(held.value));
        check('its event outlet', outlet(held.value, true, 'event'), engine(held.value));

        // Two callers of one refresh hold one object (C15), so it is checked once.
        const [asked, askedAgain] = twice(() => held.value.refresh(), 'what refresh() returns');
        respondWithEose(server, await nextReqOf(server));
        const [complete, sameComplete] = await Promise.all([asked, askedAgain]);
        expect(complete.kind, 'the premise: complete').toBe('complete');
        expect(sameComplete, 'the premise: two callers, one object').toBe(complete);
        check('a refresh, complete', complete);

        // Nobody answers, and the settle timeout closes it incomplete.
        const timedOut = fresh(() => held.value.refresh(), 'what refresh() returns');
        await nextReqOf(server);
        const incomplete = await timedOut;
        expect(incomplete.kind, 'the premise: incomplete').toBe('incomplete');
        check('a refresh, incomplete', incomplete);

        const released = fresh(() => held.value.refresh(), 'what refresh() returns');
        await nextReqOf(server);
        held.destroy();
        const cancelled = await released;
        expect(cancelled, 'the premise: released while in flight').toEqual({
          kind: 'cancelled',
          reason: 'consumer-released'
        });
        check('a refresh, cancelled because its consumer released it', cancelled);
        const after = await fresh(() => held.value.refresh(), 'what refresh() returns');
        expect(after, 'the premise: a released handle').toEqual({
          kind: 'not-started',
          reason: 'released'
        });
        check('a refresh, not started because the handle was released', after);
      }

      // An answer with nothing in it.
      {
        const { rxNostr, server } = createTestRelay(nextUrl());
        const held = mount(() => useStreamedReq(options('pb13-nothing', rxNostr)));
        respondWithEose(server, await waitForReq(server));
        await settle();
        expect(held.value.state.status, 'the premise: settled with nothing').toBe('settled');
        check('a request settled with nothing', held.value, engine(held.value));
        check('its nodata outlet', outlet(held.value, false, 'nodata'), engine(held.value));
        check(
          'its nodata outlet, for a single event',
          outlet(held.value, true, 'nodata'),
          engine(held.value)
        );
        held.destroy();
      }

      // An answer with events, refusals and causes on it, held by two hooks.
      const incompleteAnswer = await (async () => {
        const { rxNostr, server } = createTestRelay(nextUrl());
        const first = mount(() => useStreamedReq(options('pb13-incomplete', rxNostr)));
        const second = mount(() => useStreamedReq(options('pb13-incomplete', rxNostr)));
        const req = await waitForReq(server);
        respondWithEvent(
          server,
          req,
          fakeEvent({ id: 'pb13-b', created_at: 1, tags: [['t', 'ok']] })
        );
        server.send(['CLOSED', req, 'rate-limited: slow down']);
        await settle(400);
        expect(first.value.state.status, 'the premise: incomplete').toBe('incomplete');
        expect(first.value.diagnostics.refusals, 'with a refusal').toHaveLength(1);
        reached('incomplete-result', (first.value.state as { error?: unknown }).error);
        check('a request incomplete, with refusals and causes', first.value, engine(first.value));
        return { first, second };
      })();

      // An attempt that failed, held by two hooks, and what refresh resolves with.
      const failedAnswer = await (async () => {
        const accumulator: StreamAccumulator = () => async () => {
          throw new Error('the accumulator threw', { cause: new Error('and why') });
        };
        const { rxNostr } = createTestRelay(nextUrl());
        const first = mount(() => useStreamedReq(options('pb13-failed', rxNostr, { accumulator })));
        const second = mount(() =>
          useStreamedReq(options('pb13-failed', rxNostr, { accumulator }))
        );
        await settle(150);
        expect(first.value.state.status, 'the premise: a failed attempt').toBe('error');
        reached('unspecified', (first.value.state as { error?: unknown }).error);
        check('an attempt that failed', first.value, engine(first.value));
        const outcome = await fresh(() => first.value.refresh(), 'what refresh() returns');
        expect(outcome.kind, 'the premise: error').toBe('error');
        check('a refresh, error', outcome);
        return { first, second };
      })();

      // A refused descriptor: two hooks asking different questions refused for
      // one reason share one Error, and `refresh()` rejects with it.
      const refusedAnswer = await (async () => {
        const { rxNostr } = createTestRelay(nextUrl());
        const first = mount(() =>
          useStreamedReq(options('pb13-refused', rxNostr, { filters: [refusedFilter(1)] }))
        );
        const second = mount(() =>
          useStreamedReq(options('pb13-refused', rxNostr, { filters: [refusedFilter(7)] }))
        );
        await settle(150);
        expect(first.value.state.status, 'the premise: refused').toBe('error');
        check('a refused descriptor', first.value, engine(first.value));
        check('its error outlet', outlet(first.value, false, 'error'), engine(first.value));
        reached('unsupported-filter', (first.value.state as { error?: unknown }).error);
        const rejected = await rejectionOf(() => first.value.refresh());
        // **Not the object the state carries**: `refresh()` resolves the
        // descriptor again, and the refusal it throws is built on that call —
        // the same class and words, and a published value of its own, so it is
        // checked on its own rather than covered by the state's.
        const carried = (first.value.state as { error?: Error }).error;
        expect(rejected, 'the premise: refresh() rejects with a refusal').toBeInstanceOf(
          UnsupportedFilterError
        );
        expect((rejected as Error).message, 'the same refusal the state carries').toBe(
          carried?.message
        );
        rejectedWith('unsupported-filter', rejected);
        check('a refresh, rejected with unsupported-filter', rejected);
        return { first, second };
      })();

      // On a server: a refused descriptor, and a request that is never started.
      {
        const { rxNostr } = createTestRelay(nextUrl());
        const refused = mount(() =>
          useStreamedReq(
            options('pb13-server-refused', rxNostr, {
              environment: 'server',
              filters: [refusedFilter(1)]
            })
          )
        );
        // **Before the query delivers the refusal**, which is the window this
        // path is for: on a server no subscription ever delivers it, so the
        // projection publishes it itself. Under jsdom a subscription does,
        // one tick later — read after that, this case took the browser's
        // path and a ledger entry that left the server's path open survived.
        expect(
          (refused.value.raw as { status: string }).status,
          'the premise: the query has not delivered it'
        ).not.toBe('error');
        expect(refused.value.state.status, 'the premise: refused on a server').toBe('error');
        check('a refused descriptor, on a server', refused.value, engine(refused.value));
        const asked = mount(() =>
          useStreamedReq(options('pb13-server', rxNostr, { environment: 'server' }))
        );
        await settle();
        const outcome = await fresh(() => asked.value.refresh(), 'what refresh() returns');
        expect(outcome, 'the premise: a server').toEqual({ kind: 'not-started', reason: 'server' });
        check('a refresh, not started on a server', outcome);
        refused.destroy();
        asked.destroy();
      }

      // A deferred plan.
      {
        const { rxNostr } = createTestRelay(nextUrl());
        const held = mount(() =>
          useStreamedReq(options('pb13-deferred', rxNostr, { deferred: true }))
        );
        await settle();
        expect(held.value.state.status, 'the premise: deferred').toBe('loading');
        check('a deferred request', held.value, engine(held.value));
        // **What a command returns is the platform's `Promise`, the caller's
        // own**: a fresh one each call, so a write to one reaches no other
        // caller. What it settles with is this library's, checked below.
        const [asked, askedAgain] = twice(
          () => held.value.refresh(),
          'what the engine’s refresh() returns'
        );
        await askedAgain;
        const outcome = await asked;
        expect(outcome, 'the premise: deferred').toEqual({
          kind: 'not-started',
          reason: 'deferred'
        });
        check('a refresh, not started because the plan is deferred', outcome);
        held.destroy();
      }

      // **An Error under every code the library publishes one with.** The
      // refusals the boundary builds and the failures the engine builds, one
      // each — none needs a provider, and the last needs there to be none —
      // and what `refresh()` rejects with on each, which the boundary builds
      // again on that call.
      {
        const { rxNostr } = createTestRelay(nextUrl());
        const unreadable = {
          get kinds(): number[] {
            throw new Error('a consumer’s getter threw');
          }
        };
        // **Two doors for `invalid-descriptor`**: a published field the
        // boundary refuses, whose Error `capture` freezes on its way to the
        // channel, and a value refused before the boundary — a `deferred` that
        // is not a boolean, at the engine's seam — which the class's own
        // freeze is all that closes.
        const arranged: [string, () => UseStreamedReqOpts, string?][] = [
          ['invalid-descriptor', options('pb13-invalid', rxNostr, { settleTimeoutMs: -1 })],
          [
            'invalid-descriptor',
            options('pb13-invalid-seam', rxNostr, { deferred: 'yes' as unknown as boolean }),
            ', refused before the boundary'
          ],
          ['descriptor-unreadable', options('pb13-unreadable', rxNostr, { filters: [unreadable] })],
          [
            'accumulator-contract',
            options('pb13-contract', rxNostr, { accumulator: () => async () => emptyEventSet })
          ],
          [
            'missing-provider',
            () => ({
              namespace: 'pb13-unowned',
              filters: [{ kinds: [1] }],
              reqIdBase: 'pb13-unowned'
            })
          ]
        ];
        // Each arranged twice: a second hook on the same descriptor reads the
        // refused entry the first did, and the Error they share is written to.
        const held = arranged.map(
          ([code, given, door = '']) =>
            [
              code,
              mount(() => useStreamedReq(given)),
              door,
              mount(() => useStreamedReq(given)),
              given().namespace
            ] as const
        );
        await settle(150);
        const unshared: string[] = [];
        for (const [code, hook, door, twin, namespace] of held) {
          reached(code, (hook.value.state as { error?: unknown }).error);
          check(`an Error, ${code}${door}`, hook.value, engine(hook.value));
          const errorOf = (one: typeof hook): unknown =>
            (one.value.state as { error?: unknown }).error;
          if (errorOf(twin) === errorOf(hook)) {
            // The readers the row names, each of them.
            const readers = {
              'the value written to': () => errorOf(hook),
              'a second hook': () => errorOf(twin),
              'its diagnostics': () =>
                (twin.value.diagnostics as { lastError?: unknown }).lastError,
              'the same hook, read again': () => errorOf(hook),
              'the cache': cacheOf(client, namespace)
            };
            expect(Object.keys(readers), `an Error, ${code}${door}: the readers`).toEqual(READERS);
            sharedAndKept(`an Error, ${code}${door}, two hooks share`, readers);
          } else unshared.push(`${code}${door}`);
          twin.destroy();
          if (code !== 'accumulator-contract') {
            const rejected = await rejectionOf(() => hook.value.refresh());
            rejectedWith(code, rejected);
            check(`a refresh, rejected with ${code}${door}`, rejected);
          }
          hook.destroy();
        }
        // The one code two hooks do not share: with no provider there is no
        // cache, and each hook builds its own.
        expect(unshared, 'the codes two hooks on one descriptor do not share').toEqual([
          'missing-provider'
        ]);
        // And every other one was written to through both.
        expect(
          writtenBack.filter((answer) => answer.endsWith(', two hooks share')),
          'every code two hooks share, written to through both'
        ).toEqual(
          held
            .map(([code, , door]) => `${code}${door}`)
            .filter((one) => !unshared.includes(one))
            .map((one) => `an Error, ${one}, two hooks share`)
        );
        // **And the one built after the channel's own freeze**: a relay's
        // failure that comes back out of the accumulator seam is re-derived
        // into an `accumulator-contract` on its way to the state, past the
        // point where `capture` freezes what it is handed.
        const relayed = mount(() =>
          useStreamedReq(
            options('pb13-relayed', rxNostr, {
              accumulator: () => async () => {
                throw capture(new Error('a relay gave out'), 'relay');
              }
            })
          )
        );
        await settle(150);
        reached('accumulator-contract', (relayed.value.state as { error?: unknown }).error);
        check(
          'an Error, accumulator-contract, from a relay’s failure',
          relayed.value,
          engine(relayed.value)
        );
        relayed.destroy();

        // **And thrown rather than published on a state**: a hook with no
        // provider above it, which is a value handed to the consumer's `catch`.
        // Called where a consumer's component would call it rather than inside
        // an effect root, which catches what its function throws.
        let thrown: unknown;
        try {
          useRelayDiagnostics();
        } catch (caught) {
          thrown = caught;
        }
        expect(thrown, 'the premise: a hook with no provider throws').toBeInstanceOf(
          MissingProviderError
        );
        reached('missing-provider', thrown);
        check('an Error a hook throws, missing-provider', thrown);
        // And what a provider throws at construction on a runtime with no
        // randomness — `NostrApp` builds its attempt registry first thing.
        vi.stubGlobal('crypto', {});
        let unrandom: unknown;
        try {
          createAttemptRegistry();
        } catch (caught) {
          unrandom = caught;
        } finally {
          vi.unstubAllGlobals();
        }
        reached('missing-randomness', unrandom);
        check('an Error a provider throws, missing-randomness', unrandom);
      }

      // A live request whose leg ended: its provider's one relay went away,
      // and with nothing retrying, every relay in scope has stopped.
      {
        const url = nextUrl();
        const server = new WS(url, { jsonProtocol: true });
        const provider = mount(() => {
          const built = createNostrContext({
            relays: [url],
            harness: HARNESS_DIVERGENCES,
            verifyEvent: acceptAnyEvent
          });
          setNostrContext(built);
          return built;
        });
        const ended = () =>
          useStreamedReq(() => ({
            namespace: 'pb13-ended',
            filters: [{ kinds: [1] }],
            live: true,
            retain: 'unbounded',
            reqIdBase: 'pb13-ended',
            settleTimeoutMs: 300
          }));
        const held = mount(ended);
        const again = mount(ended);
        const req = String(((await nextOf(server, 'REQ')) as unknown[])[1]);
        respondWithEvent(server, req, fakeEvent({ id: 'pb13-c', created_at: 1 }));
        respondWithEose(server, req);
        await settle(150);
        server.error({ code: 1006, reason: 'gone', wasClean: false });
        await settle(200);
        expect(held.value.diagnostics.legEnded?.kind, 'the premise: the leg ended').toBe('ended');
        reached('relay-failed', held.value.diagnostics.legEnded?.error);
        check('a live request whose leg ended', held.value, engine(held.value));
        // **An Error two hooks share**, as the state's are below: the leg's,
        // on one live key.
        sharedAndKept('the leg’s end', {
          'the value written to': () => held.value.diagnostics.legEnded?.error,
          'a second hook': () => again.value.diagnostics.legEnded?.error,
          'the same hook, read again': () => held.value.diagnostics.legEnded?.error,
          // Where the cache holds it: the query's data, which the
          // diagnostics are projected from.
          'the cache': () =>
            (held.value.raw as { data?: { forward?: { end?: { error?: unknown } } } }).data?.forward
              ?.end?.error
        });
        again.destroy();
        held.destroy();
        provider.destroy();
      }

      // Under a provider: the three published hooks, a send each way, a request
      // with nowhere to ask, and the provider going away under a refresh.
      {
        const url = nextUrl();
        const server = new WS(url, { jsonProtocol: true });
        const provider = mount(() => {
          const built = createNostrContext({
            relays: [url],
            harness: HARNESS_DIVERGENCES,
            verifyEvent: acceptAnyEvent
          });
          setNostrContext(built);
          return built;
        });

        const request = mount(() =>
          useReq(() => ({
            kind: 'request',
            descriptor: {
              filters: [{ kinds: [1] }],
              namespace: 'pb13-useReq',
              settleTimeoutMs: 300
            }
          }))
        );
        const req = String(((await nextOf(server, 'REQ')) as unknown[])[1]);
        respondWithEvent(server, req, fakeEvent({ id: 'pb13-d', created_at: 1 }));
        server.send(['NOTICE', 'a relay says something']);
        server.send(['CLOSED', req, 'rate-limited: slow down']);
        await settle(400);
        expect(request.value.state.status, 'the premise: useReq(), incomplete').toBe('incomplete');
        check('useReq()', request.value, [[request.value, REQ_HANDLE]]);
        // What a component hands its outlet: built over `useReq()`'s handle,
        // which is what every request component renders through.
        check('its events outlet, over useReq()’s handle', outlet(request.value, false, 'events'), [
          [request.value, REQ_HANDLE]
        ]);
        const outcome = fresh(() => request.value.refresh(), 'what useReq()’s refresh() returns');
        await nextOf(server, 'REQ');
        const refreshed = await outcome;
        expect(refreshed.kind, 'the premise: through useReq(), incomplete').toBe('incomplete');
        check('a refresh through useReq(), incomplete', refreshed);
        // **And refused, through the entry's own hook**: `useReq()`'s
        // `refresh` forwards the engine's promise, and this is the case that
        // asks the forwarded one on the error path — a wrapper that built its
        // own there, or reused one, is read here and nowhere else.
        const outOfScope = mount(() =>
          useReq(() => ({
            kind: 'request',
            descriptor: {
              filters: [{ kinds: [1] }],
              namespace: 'pb13-useReq-refused',
              relays: ['wss://not-in-scope.example'],
              settleTimeoutMs: 300
            }
          }))
        );
        await settle(150);
        reached('relay-not-in-scope', (outOfScope.value.state as { error?: unknown }).error);
        check('useReq(), refused', outOfScope.value, [[outOfScope.value, REQ_HANDLE]]);
        const refusedThrough = await rejectionOf(() => outOfScope.value.refresh());
        rejectedWith('relay-not-in-scope', refusedThrough);
        check('a refresh through useReq(), refused', refusedThrough);
        outOfScope.destroy();

        const diagnostics = mount(() => useRelayDiagnostics());
        const row = Object.values(diagnostics.value.relays)[0];
        expect(row?.lastNotice, 'the premise: a notice on the row').toBeDefined();
        expect(row?.lastRefusal, 'and a refusal').toBeDefined();
        check('useRelayDiagnostics()', diagnostics.value, [[diagnostics.value, RELAY_DIAGNOSTICS]]);
        // A relay's message is built at three sites: whole, cut at its bound,
        // and rendered from a value that was not text. One notice each.
        const noticed = async (name: string, said: unknown, begins: string): Promise<void> => {
          server.send(['NOTICE', said]);
          await settle();
          const notice = Object.values(diagnostics.value.relays)[0]?.lastNotice;
          expect(notice?.truncated, `the premise: ${name}, cut`).toBe(true);
          expect(notice?.text.startsWith(begins), `the premise: ${name}, what it says`).toBe(true);
          check(name, diagnostics.value, [[diagnostics.value, RELAY_DIAGNOSTICS]]);
        };
        await noticed('useRelayDiagnostics(), a notice cut', 'x'.repeat(5000), 'xxx');
        await noticed(
          'useRelayDiagnostics(), a notice that was not text',
          { detail: 'x'.repeat(300) },
          '{"detail"'
        );

        const sender = mount(() => useSend());
        check('useSend()', sender.value, [[sender.value, SEND]]);
        const refusedSend = await sender.value({} as never);
        expect(refusedSend.status, 'the premise: a send refused').toBe('refused');
        check('a send, refused', refusedSend);
        againOf(
          'a send, refused',
          await fresh(() => sender.value({} as never), 'what a send returns')
        );
        const signed = {
          id: 'a'.repeat(64),
          pubkey: 'b'.repeat(64),
          sig: 'c'.repeat(128),
          kind: 1,
          content: 'pb13',
          tags: [['t', 'sent']],
          created_at: 1
        };
        // Every path a send takes builds its own promise, and each is asked,
        // twice with one input: refused above, accepted here, abandoned
        // below. The second of each settles with the rest at the end.
        const sending = fresh(() => sender.value(signed), 'what an accepted send returns');
        await nextEventOf(server, signed.id);
        server.send(['OK', signed.id, true, 'saved: thanks']);
        const settledSend = await sending;
        expect(
          settledSend.status === 'settled'
            ? settledSend.relays.map((one) => one.outcome)
            : settledSend,
          'the premise: a send its relay accepted'
        ).toEqual(['accepted']);
        check('a send, settled', settledSend);
        // And one no relay answers, which the teardown below abandons.
        const unansweredInput = { ...signed, id: 'd'.repeat(64), content: 'pb13-unanswered' };
        const unanswered = fresh(
          () => sender.value(unansweredInput),
          'what an abandoned send returns'
        );
        await nextEventOf(server, unansweredInput.id);

        const nowhere = mount(() =>
          useStreamedReq(() => ({
            namespace: 'pb13-nowhere',
            filters: [{ kinds: [1] }],
            relays: [],
            reqIdBase: 'pb13-nowhere',
            settleTimeoutMs: 300
          }))
        );
        const unasked = await fresh(() => nowhere.value.refresh(), 'what refresh() returns');
        expect(unasked, 'the premise: nowhere to ask').toEqual({
          kind: 'not-started',
          reason: 'no-readable-relay'
        });
        check('a refresh, not started with no readable relay', unasked);

        const outliving = mount(() =>
          useStreamedReq(() => ({
            namespace: 'pb13-outliving',
            filters: [{ kinds: [1] }],
            reqIdBase: 'pb13-outliving',
            settleTimeoutMs: 30_000
          }))
        );
        respondWithEose(server, String(((await nextOf(server, 'REQ')) as unknown[])[1]));
        await settle();
        const inFlight = fresh(() => outliving.value.refresh(), 'what refresh() returns');
        await nextOf(server, 'REQ');
        request.destroy();
        diagnostics.destroy();
        sender.destroy();
        nowhere.destroy();
        provider.destroy();
        const disposed = await inFlight;
        expect(disposed, 'the premise: the provider went away under it').toEqual({
          kind: 'cancelled',
          reason: 'provider-disposed'
        });
        check('a refresh, cancelled because the provider was disposed', disposed);
        const rejected = await rejectionOf(() => outliving.value.refresh());
        rejectedWith('provider-disposed', rejected);
        check('a refresh, rejected because the provider was disposed', rejected);
        outliving.destroy();
        const abandoned = await unanswered;
        expect(
          abandoned.status === 'settled' ? abandoned.relays.map((one) => one.outcome) : abandoned,
          'the premise: a send the teardown abandoned'
        ).toEqual(['aborted']);
        check('a send, settled with no answer', abandoned);
        // And the diagnostics a consumer went on holding past the teardown,
        // which answer an empty map of their own.
        expect(
          Object.keys(diagnostics.value.relays),
          'the premise: the provider is gone, and so are its relays'
        ).toEqual([]);
        check('useRelayDiagnostics(), after its provider is gone', diagnostics.value, [
          [diagnostics.value, RELAY_DIAGNOSTICS]
        ]);
      }

      // **The signer's template is the signer's, and only because of how it
      // is made**: `B5-C8` leaves it out of the population as a fresh copy
      // each call, compared with a frozen copy once signed. So a signer that
      // rewrites a tag in place and signs what it rewrote is refused, and two
      // calls are handed two templates, the first's rewrite reaching neither
      // the second nor what the library compared against.
      {
        const url = nextUrl();
        const server = new WS(url, { jsonProtocol: true });
        const handed: object[] = [];
        // A template's content, its count of tags and its first tag's value.
        const shapeOf = (template: { content: string; tags: string[][] }): unknown[] => [
          template.content,
          template.tags.length,
          template.tags[0]?.[1]
        ];
        const asHanded: unknown[][] = [];
        // What each template held once the signer had written to it — at
        // each level: the template, its list of tags, and one tag. A template
        // it could not write would be refused too, as a signer that threw,
        // and say nothing about the comparison.
        const asRewritten: unknown[][] = [];
        const rewriting: NostrSigner = {
          signEvent: async (template) => {
            handed.push(template);
            asHanded.push(shapeOf(template));
            (template as { content: string }).content = 'rewritten by the signer';
            (template.tags as string[][]).push(['p', 'added by the signer']);
            (template.tags[0] as string[])[1] = 'rewritten by the signer';
            asRewritten.push(shapeOf(template));
            return {
              ...template,
              id: 'e'.repeat(64),
              pubkey: 'f'.repeat(64),
              sig: '0'.repeat(128)
            } as never;
          }
        };
        const provider = mount(() => {
          const built = createNostrContext({
            relays: [url],
            harness: HARNESS_DIVERGENCES,
            verifyEvent: acceptAnyEvent,
            signer: rewriting
          });
          setNostrContext(built);
          return built;
        });
        const signing = mount(() => useSend());
        const template = { kind: 1, content: 'pb13-signed', tags: [['t', 'as written']] };
        // One after the other, so the first's rewrite has happened before the
        // second is asked for, and the two promises compared.
        const firstSent = bare(signing.value(template), 'what a signed send returns');
        const first = await firstSent;
        const secondSent = bare(signing.value(template), 'what a signed send returns');
        expect(secondSent, 'what a signed send returns: a fresh promise each call').not.toBe(
          firstSent
        );
        const second = await secondSent;
        againOf('a send, refused by its signer', second);
        expect(
          asRewritten,
          'the premise: each template was the signer’s to write, and it wrote to it'
        ).toEqual(
          Array.from({ length: 2 }, () => ['rewritten by the signer', 2, 'rewritten by the signer'])
        );
        expect(
          [first, second].map((one) =>
            one.status === 'refused' ? `${one.code}: ${one.message}` : one.status
          ),
          'a signer that signs its own rewrite is refused by the comparison, each time'
        ).toEqual(
          Array.from(
            { length: 2 },
            () =>
              'signer-failed: nosvelte: the signer returned a different event from the one it was asked to sign.'
          )
        );
        check('a send, refused by its signer', first);
        expect(handed, 'the premise: the signer was asked twice').toHaveLength(2);
        expect(handed[0], 'two calls, two templates').not.toBe(handed[1]);
        expect(
          asHanded,
          'each handed as written: the first’s rewrite reached neither the second nor the comparison'
        ).toEqual(Array.from({ length: 2 }, () => ['pb13-signed', 1, 'as written']));
        expect(template, 'and the caller’s own template untouched').toEqual({
          kind: 1,
          content: 'pb13-signed',
          tags: [['t', 'as written']]
        });
        signing.destroy();
        provider.destroy();
        server.close();
      }

      // A provider whose transport cannot name one relay: a request naming it
      // is refused as the transport's, and a request naming a relay the
      // provider does not hold is refused as outside its scope.
      {
        const UNNAMEABLE = 'wss://unnameable.example';
        const provider = mount(() => {
          const built = createNostrContext({
            relays: ['wss://a.example'],
            harness: HARNESS_DIVERGENCES,
            verifyEvent: acceptAnyEvent,
            transportKeys: (urls) => {
              if (urls.includes(UNNAMEABLE)) throw new Error('this transport cannot name it');
              return [...urls];
            }
          });
          setNostrContext(built);
          return built;
        });
        // Each asked by two hooks on one descriptor, as above, and the Error
        // they share written to through every reader.
        const asking = (code: string, relay: string) => {
          const given = (): UseStreamedReqOpts => ({
            namespace: `pb13-${code}`,
            filters: [{ kinds: [1] }],
            relays: [relay],
            reqIdBase: `pb13-${code}`,
            settleTimeoutMs: 300
          });
          return [
            code,
            mount(() => useStreamedReq(given)),
            mount(() => useStreamedReq(given))
          ] as const;
        };
        const held = [
          asking('relay-not-in-scope', 'wss://b.example'),
          asking('transport-incompatible', UNNAMEABLE)
        ];
        await settle(150);
        for (const [code, hook, twin] of held) {
          reached(code, (hook.value.state as { error?: unknown }).error);
          check(`an Error, ${code}`, hook.value, engine(hook.value));
          const errorOf = (one: typeof hook): unknown =>
            (one.value.state as { error?: unknown }).error;
          expect(errorOf(twin), `an Error, ${code}: the premise, two hooks share it`).toBe(
            errorOf(hook)
          );
          const readers = {
            'the value written to': () => errorOf(hook),
            'a second hook': () => errorOf(twin),
            'its diagnostics': () => (twin.value.diagnostics as { lastError?: unknown }).lastError,
            'the same hook, read again': () => errorOf(hook),
            'the cache': cacheOf(provider.value.client, `pb13-${code}`)
          };
          expect(Object.keys(readers), `an Error, ${code}: the readers`).toEqual(READERS);
          sharedAndKept(`an Error, ${code}, two hooks share`, readers);
          twin.destroy();
          const rejected = await rejectionOf(() => hook.value.refresh());
          rejectedWith(code, rejected);
          check(`a refresh, rejected with ${code}`, rejected);
          hook.destroy();
        }
        expect(
          writtenBack.filter((answer) =>
            held.some(([code]) => answer === `an Error, ${code}, two hooks share`)
          ),
          'each of them written to through both'
        ).toEqual(held.map(([code]) => `an Error, ${code}, two hooks share`));

        // **And what this library decides about its own classes does not read
        // `instanceof`.** A published Error reaches its class, which is
        // sealed, and past it the platform's `Error`: one `Symbol.hasInstance`
        // there made the refused cache key — which names the relay a refusal
        // is about — miss it, and two requests whose names differ only past
        // the message's bound then shared one entry. Measured. The key reads a
        // brand now. A rewritten built-in is outside `B5-C8`, which assumes the
        // platform's built-ins as the language defines them; this arm holds
        // the narrower claim that the decision does not go through
        // `instanceof`, the one route that was measured.
        const refusal = (held[0]?.[1].value.state as { error?: Error } | undefined)?.error;
        expect(refusal, 'the premise: a published refusal to reach from').toBeInstanceOf(
          RelayNotInScopeError
        );
        // **And a brand answers for what this library made, not for its
        // class**: the constructors are published, so an instance a consumer
        // builds is one of the class and none of this library's — a refusal
        // it threw from a relay read was published as the provider's own,
        // open. Each decision's brand is asked of both.
        expect(isRelayNotInScope(refusal), 'the premise: this library’s refusal is its own').toBe(
          true
        );
        expect(
          [
            isRelayNotInScope(new RelayNotInScopeError('wss://elsewhere.example', false, [])),
            isRelayConfigurationError(
              new RelayConfigurationError('invalid-relay-input', [], 'built by a consumer')
            ),
            isTransportIncompatible(
              new TransportIncompatibleError(['wss://a.example'], ['wss://a.example'], 'built')
            )
          ],
          'an instance a consumer built answers for none of them'
        ).toEqual([false, false, false]);
        const platform = Object.getPrototypeOf(refusal?.constructor) as object;
        expect(platform, 'the premise: past the class, the platform’s Error').toBe(Error);
        expect(
          () =>
            Object.defineProperty(refusal?.constructor as object, Symbol.hasInstance, {
              value: () => false
            }),
          'the class itself refuses'
        ).toThrow(TypeError);
        Object.defineProperty(platform, Symbol.hasInstance, {
          value: () => false,
          configurable: true
        });
        try {
          expect(
            refusal instanceof RelayNotInScopeError,
            'the premise: `instanceof` now answers what a consumer wrote'
          ).toBe(false);
          const stem = `wss://b.example/${'x'.repeat(250)}`;
          const named = ['one', 'two'].map((end) =>
            mount(() =>
              useStreamedReq(() => ({
                namespace: 'pb13-hasinstance',
                filters: [{ kinds: [1] }],
                relays: [`${stem}/${end}`],
                reqIdBase: `pb13-hasinstance-${end}`,
                settleTimeoutMs: 300
              }))
            )
          );
          await settle(150);
          expect(
            named.map(
              (one) => (one.value.state as { error?: { url?: string } }).error?.url?.slice(-4) ?? ''
            ),
            'each request keeps its own refusal'
          ).toEqual(['/one', '/two']);
          for (const one of named) one.destroy();
        } finally {
          Reflect.deleteProperty(platform, Symbol.hasInstance);
        }
        provider.destroy();
      }

      // The refusal a provider publishes, one of each class, read through the
      // hook that publishes it — **through the entry's own door wherever one
      // exists**: a relay list as `NostrApp` hands it, under the transport this
      // library resolves. Only the two a transport's own names decide are
      // arranged through `transportKeys`, the seam a consumer cannot reach.
      const refusals: [
        RelayConfigurationErrorCode,
        { readonly prototype: object },
        Parameters<typeof createNostrContext>[0]
      ][] = [
        [
          'conflicting-capabilities',
          InvalidRelayScopeError,
          {
            relays: [
              { url: 'wss://a.example', read: true, write: true },
              { url: 'wss://a.example', read: false, write: true }
            ]
          }
        ],
        ['invalid-relay-input', InvalidRelayInputError, { relays: ['nostr.example.com'] }],
        [
          'non-idempotent-url',
          NonIdempotentRelayUrlError,
          // rx-nostr's normaliser decodes a percent-escape once a pass, so
          // `%2525` names a different relay each time it is named.
          { relays: ['wss://h.example/%2525'] }
        ],
        [
          'transport-key-mismatch',
          TransportKeyMismatchError,
          {
            relays: ['wss://a.example', 'wss://b.example'],
            transportKeys: (urls) => (urls.length === 1 ? [...urls] : [urls[0] as string])
          }
        ],
        [
          'transport-incompatible',
          TransportIncompatibleError,
          {
            relays: ['wss://a.example'],
            transportKeys: () => {
              throw new Error('this transport names nothing');
            }
          }
        ]
      ];
      for (const [code, kind, given] of refusals) {
        const provider = mount(() => {
          const built = createNostrContext({ harness: HARNESS_DIVERGENCES, ...given });
          setNostrContext(built);
          return built;
        });
        const diagnostics = mount(() => useRelayDiagnostics());
        const refusal = diagnostics.value.configurationError;
        reached(code, refusal);
        expect(Object.getPrototypeOf(refusal), `the premise: ${code}, its class`).toBe(
          kind.prototype
        );
        check(`a provider refusal, ${code}`, diagnostics.value, [
          [diagnostics.value, RELAY_DIAGNOSTICS]
        ]);
        // **Shared by every hook under the provider**, and written to as the
        // state's Errors are below.
        const second = mount(() => useRelayDiagnostics());
        sharedAndKept(`a provider refusal, ${code}`, {
          'the value written to': () => refusal,
          'a second hook': () => second.value.configurationError,
          'the same hook, read again': () => diagnostics.value.configurationError
        });
        second.destroy();
        diagnostics.destroy();
        provider.destroy();
      }

      for (const [name, second] of seconds) againOf(name, await second);
      expect([...roster].sort(), 'the population, case by case').toEqual([...POPULATION].sort());
      expect([...codes].sort(), 'an Error under every code a hook publishes one with').toEqual(
        [...new Set([...REQ_ERROR_CODES, ...RELAY_REFUSAL_CODES, 'missing-randomness'])].sort()
      );
      expect([...rejections].sort(), 'and `refresh()` rejecting with every code it can').toEqual(
        [...REFRESH_REJECTIONS].sort()
      );
      expect(breaches, 'a published value that does not keep the discipline').toEqual([]);

      // **The Errors, written to and read back.** Every member a consumer can
      // name — of the Error and of everything it holds — through the value
      // written to, a second hook, the cache, and the same hook read again.
      // Each reader is first shown to answer what the value written to
      // answers, so an unchanged read is about this Error and not another.
      const cached = (namespace: string): unknown[] =>
        client
          .getQueryCache()
          .getAll()
          .filter((entry) => JSON.stringify(entry.queryKey).includes(namespace))
          .map((entry) => entry.state);
      type Held = { value: { state: unknown; diagnostics: unknown } };
      const errorOf = (hook: Held): unknown => (hook.value.state as { error?: unknown }).error;
      const observed: [string, Held, Held, (() => unknown) | undefined][] = [
        [
          'a refusal',
          refusedAnswer.first,
          refusedAnswer.second,
          () => (cached('pb13-refused')[0] as { error?: unknown } | undefined)?.error
        ],
        [
          'a failure',
          failedAnswer.first,
          failedAnswer.second,
          () =>
            (cached('pb13-failed')[0] as { data?: { failure?: { error?: unknown } } } | undefined)
              ?.data?.failure?.error
        ],
        // **No cache reader for this one**, and that is what the cache holds:
        // the record, whose causes this Error is built from and memoised on.
        ['an incomplete answer', incompleteAnswer.first, incompleteAnswer.second, undefined]
      ];
      for (const [answer, first, second, cache] of observed) {
        const held = errorOf(first);
        expect(held, `${answer}: the premise, an Error to write to`).toBeInstanceOf(Error);
        expect(errorOf(second), `${answer}: the premise, one Error two hooks share`).toBe(held);
        const readers: Record<string, () => unknown> = {
          'the value written to': () => held,
          'a second hook': () => errorOf(second),
          'its diagnostics': () => (second.value.diagnostics as { lastError?: unknown }).lastError,
          'the same hook, read again': () => errorOf(first),
          ...(cache === undefined ? {} : { 'the cache': cache })
        };
        // The readers the row names, and the cache wherever it holds the Error:
        // an observation that quietly lost one would read as one more green.
        expect(Object.keys(readers), `${answer}: the readers`).toEqual(
          answer === 'an incomplete answer' ? READERS.filter((one) => one !== 'the cache') : READERS
        );
        const { before, reached } = writeAndReadBack(held as object, readers);
        for (const reader of Object.keys(readers))
          expect(
            before[reader],
            `${answer}: ${reader} answered what the value written to did`
          ).toEqual(before['the value written to']);
        expect(reached, `${answer}: a reader the consumer’s write reached`).toEqual([]);
      }
      // Its control: an Error frozen the way the platform freezes one, whose
      // `stack` setter is live — every reader sees the write — and a member
      // only a redefinition reaches, one level down.
      const leaky = Object.freeze(new Error('as it was'));
      expect(Object.isFrozen(leaky), 'the control’s premise: frozen, by the platform’s word').toBe(
        true
      );
      expect(
        writeAndReadBack(leaky, { 'the value written to': () => leaky, 'a reader': () => leaky })
          .reached,
        'the write-back’s control: a live setter'
      ).toEqual(['the value written to: stack', 'a reader: stack']);
      const marker = Symbol('member');
      const nested = Object.freeze({
        cause: Object.defineProperty({}, 'note', { value: 'as it was', configurable: true }),
        [marker]: Object.defineProperty({}, 'note', { value: 'as it was', configurable: true })
      });
      expect(
        writeAndReadBack(nested, { 'a reader': () => nested }).reached,
        'the write-back’s control: a redefinition, one level down'
      ).toEqual(['a reader: cause.note', 'a reader: Symbol(member).note']);

      // **The stated exception, at run time.** A method slot the list type
      // admits is a write the frozen list refuses: the list gains no member of
      // its own, a call answers as it did, and the other hook's list is
      // untouched.
      type Listed = { readonly events: readonly { readonly id: string }[] };
      const listed = (incompleteAnswer.first.value.state as Listed).events;
      const ids = listed.map((event) => event.id);
      try {
        (listed as unknown as { map: unknown }).map = () => [];
      } catch {
        // Refused, which is how the exception is closed at run time.
      }
      expect(Object.hasOwn(listed, 'map'), 'the exception at run time: no slot of its own').toBe(
        false
      );
      expect(
        listed.map((event) => event.id),
        'the exception at run time: a call answers as it did'
      ).toEqual(ids);
      expect(
        (incompleteAnswer.second.value.state as Listed).events.map,
        'the exception at run time: the other hook’s list'
      ).toBe(Array.prototype.map);

      for (const each of [incompleteAnswer, failedAnswer, refusedAnswer]) {
        each.first.destroy();
        each.second.destroy();
      }

      // At compile time: every member of every published type but the event
      // refuses a write, but the stated exception.
      // **The words the replaced designs were described in**, read for across
      // the library and its arms: a comment that still says them describes a
      // design that is gone, and two rounds of review found one each time.
      // Spelled in pieces here, so this file does not match itself.
      const retired = [
        ['standard ', 'method slot'],
        ['Hook', 'Image'],
        ['`call`, `apply` and ', '`bind` stay'],
        ['callable ', 'with nothing'],
        ['Readonly', 'List<'],
        ['write', 'Everything('],
        ['admitted in ', 'three places'],
        ['every list ', 'the walk meets'],
        ['snippet', 'ArgumentsOf'],
        ['lists', 'ThroughEach']
      ].map((parts) => parts.join(''));
      // **The tracked files only**: an untracked file in the tree — a ledger
      // run's debris, another agent's scratch — failed this for a reason the
      // repository does not hold. A file not yet added is read once it is,
      // and in CI every file is. A tracked file deleted from the tree holds no
      // phrase, and reading it would fail this on a state the next commit
      // records.
      const ROOT = resolve(LIBRARY, '../../..');
      const sources = execFileSync(
        'git',
        ['ls-files', '-z', '--', 'src/lib/v1', 'src/tests/contracts'],
        { cwd: ROOT, encoding: 'utf8' }
      )
        .split('\0')
        .filter((file) => /\.(ts|svelte)$/.test(file))
        .map((file) => join(ROOT, file))
        .filter((file) => existsSync(file));
      expect(
        sources.some((file) => file.endsWith('published.test.ts')),
        'the premise: the sweep reads this file’s neighbours'
      ).toBe(true);
      expect(
        sources.flatMap((file) =>
          retired
            .filter((phrase) => readFileSync(file, 'utf8').includes(phrase))
            .map((phrase) => `${file}: ${phrase}`)
        ),
        'a comment describing a replaced design'
      ).toEqual([]);

      // **The entry's own hooks and components are outside the population**,
      // and open: a consumer imports them, no hook publishes them. The row
      // says so, and this pins it — closing one is a change to that sentence.
      const entryValues = [...MAIN_SURFACE.hooks, ...MAIN_SURFACE.components].map(
        (name) => [name, (Entry as Record<string, unknown>)[name]] as const
      );
      expect(
        entryValues.filter(([, value]) => typeof value !== 'function').map(([name]) => name),
        'the premise: every hook and component the entry exports is a function'
      ).toEqual([]);
      expect(
        entryValues
          .filter(([, value]) => !Reflect.isExtensible(value as object))
          .map(([name]) => name),
        'the entry’s hooks and components are open, as the row prices'
      ).toEqual([]);
      // **And its classes are closed, read directly** rather than through an
      // instance's chain, which reaches a class only where its prototype holds
      // it: each class and its prototype frozen, and the static write the row
      // prices refused.
      const classes = Object.entries(Entry).filter(
        ([name]) => !entryValues.some(([value]) => value === name)
      );
      expect(
        classes.map(([name, value]) => `${name}: ${typeof value}`).sort(),
        'the premise: the entry’s other values are its classes'
      ).toEqual(
        [
          'IncompleteResultError',
          'MissingProviderError',
          'MissingRandomnessError',
          'RelayConfigurationError'
        ].map((name) => `${name}: function`)
      );
      expect(
        classes.flatMap(([name, value]) => {
          const held = value as { prototype: object };
          return [
            ...(Object.isFrozen(held) ? [] : [`${name}: open`]),
            ...(Object.isFrozen(held.prototype) ? [] : [`${name}.prototype: open`]),
            ...(Reflect.set(held, 'stackTraceLimit', 0) || Object.hasOwn(held, 'stackTraceLimit')
              ? [`${name}.stackTraceLimit: written`]
              : [])
          ];
        }),
        'every class the entry exports is closed, and refuses the static write the row prices'
      ).toEqual([]);

      // **The interfaces the discipline is told about, against the types**:
      // `useReq()`'s handle is `ReqHandle` member for member, the engine's is
      // that and its two seams, and `useRelayDiagnostics()` answers its type.
      const named = (spec: LiveInterface): string[] => [...spec.getters, ...spec.commands].sort();
      expect(named(REQ_HANDLE), 'useReq()’s handle is `ReqHandle`').toEqual(
        memberNamesOf(PUBLISHED, 'Published.ReqHandle').sort()
      );
      expect(named(ENGINE_HANDLE), 'the engine’s handle is that and its two seams').toEqual(
        [...named(REQ_HANDLE), 'raw', 'projected'].sort()
      );
      expect(named(RELAY_DIAGNOSTICS), 'useRelayDiagnostics() answers its type').toEqual(
        memberNamesOf(PUBLISHED, 'ReturnType<typeof Published.useRelayDiagnostics>').sort()
      );
      const typed = publishedTypeBreaches();
      expect(typed.shapes.length, 'the published shapes, counted').toBeGreaterThan(25);
      expect(typed.breaches, 'a write a published type lets through').toEqual([]);
      exceptionStated(typed.exceptions);

      // **The probe's controls, for what this row added to it.** A union walked
      // one variant at a time behind its guard, a handle's method — its slot,
      // and what it resolves with — a recursive type walked once, and a mutable
      // collection's methods reported where a read-only one's are admitted: each
      // line asked for by name, and each compiling over a type that permits it.
      const declarations =
        'export {};\ntype Failure = { code: "a"; note: string[]; cause?: Failure } | { code: "b"; cause?: Failure };\ntype Chain = { label: number[]; next?: Chain };';
      const mutable =
        "{ state: { status: 'a'; list: string[] } | { status: 'b'; error: Failure }; refresh(): Promise<{ kind: 'x'; n: number }>; seen: ReadonlyMap<string, string>; open: Map<string, string>; chain: Chain }";
      const asked = [
        'if (value.state!.status === "a") value.state!.list!.push(value.state!.list![0]!);',
        'if (value.state!.status === "b") if (value.state!.error!.code === "a") value.state!.error!.note = value.state!.error!.note!;',
        'value.refresh = value.refresh!;',
        'for (const __result1 of [await value.refresh!()]) __result1.n = __result1.n!;',
        'void value.open!.set!.call;',
        'value.chain!.next = value.chain!.next!;'
      ];
      const commands = { callables: 'api', commands: ['refresh', 'send'] } as const;
      const lines = writesThrough(declarations, mutable, commands);
      expect(lines, 'the probe’s controls, each asked for by name').toEqual(
        expect.arrayContaining(asked)
      );
      expect(
        judgeWrites(declarations, mutable, asked).map((one) => one.verdict),
        'the probe’s controls compile over a type that permits them'
      ).toEqual(asked.map(() => 'compiles'));
      expect(
        lines.filter((one) => one.startsWith('void value.seen!.')),
        'a read-only collection’s operations are admitted'
      ).toEqual([]);

      // **And for each branch the walk grew.** A command is one signature, or
      // it is reported, and a required argument is handed `never`; it returns
      // a promise and nothing more, or it is reported; a function anywhere a
      // command is not named is data's; a function's own members are walked
      // and its standard ones written to; a collection's payload and a list
      // that is not an array are reported rather than passed over; an index
      // signature is written under a key no member has; every prop that can be
      // called hands its arguments out; and the exception is a standard
      // member's slot, never a mutable list's.
      const throwsOn = (typeText: string, imports = declarations): string => {
        try {
          writesThrough(imports, typeText, commands);
        } catch (thrown) {
          return (thrown as Error).message;
        }
        return 'walked';
      };
      expect(
        throwsOn('{ refresh: { (): Promise<number>; (force: boolean): Promise<string[]> } }'),
        'the probe’s control: an overloaded method'
      ).toMatch(/cannot call/);
      expect(
        writesThrough(declarations, '{ send(input: string): Promise<{ n: number }> }', commands),
        'the probe’s control: a function with a required argument is walked, handed `never`'
      ).toContain(
        'for (const __result1 of [await value.send!(null as never)]) __result1.n = __result1.n!;'
      );
      expect(
        throwsOn('{ seen: ReadonlyMap<string, { n: number }> }'),
        'the probe’s control: a collection’s payload'
      ).toMatch(/payload the probe does not walk/);
      expect(
        throwsOn(
          '{ list: { readonly [K in keyof ReadonlyArray<string>]: ReadonlyArray<string>[K] } }'
        ),
        'the probe’s control: a list that is not an array'
      ).toMatch(/indexed by number and is not an array/);
      expect(
        throwsOn('{ refresh(): Promise<number> & { readonly progress: number[] } }'),
        'the probe’s control: a command whose promise carries members'
      ).toMatch(/returns a promise with members of its own: progress/);
      expect(
        writesThrough(declarations, '{ refusal: { retry(): Promise<void> } }', commands),
        'the probe’s control: a function on a snapshot is data’s, not a command'
      ).toContain('void value.refusal!.retry!.call;');
      expect(
        throwsOn('{ refresh(): number }'),
        'the probe’s control: a command that does not return a promise'
      ).toMatch(/does not return a promise/);
      expect(
        throwsOn('{ refresh(): Promise<number> & { [key: string]: number } }'),
        'the probe’s control: a command whose promise carries an index signature'
      ).toMatch(/members of its own: an index signature/);
      // A command's own index signature is written through, as an object's is.
      const indexed =
        'export {};\ninterface Handle { refresh: Indexed; snapshot: Snapshot }\ninterface Indexed { (): Promise<number>; [key: string]: number }\ninterface Snapshot { refresh(): Promise<number> }';
      const qualified = writesThrough(indexed, 'Handle', {
        callables: 'api',
        commands: ['Handle.refresh']
      });
      expect(qualified, 'the probe’s control: a command’s own index signature').toContain(
        "value.refresh!['__key'] = value.refresh!['__key']!;"
      );
      // And a command named by the type that holds it: the same name on a
      // snapshot is data's.
      expect(qualified, 'the probe’s control: a command is the holder’s, not the name’s').toContain(
        'void value.snapshot!.refresh!.call;'
      );
      expect(
        throwsOn('{ refresh(): Promise<number> | (Promise<number> & { progress: number[] }) }'),
        'the probe’s control: a promise one alternative of which carries a member'
      ).toMatch(/members of its own: progress/);
      expect(
        throwsOn('{ refresh(): Promise<number> | PromiseLike<number> }'),
        'the probe’s control: a command that may answer with a thenable'
      ).toMatch(/does not return a promise/);
      expect(
        throwsOn('{ refresh(): Promise<number> | number }'),
        'the probe’s control: a command that may answer without a promise'
      ).toMatch(/does not return a promise/);
      // And a type under the platform's name that the default library does
      // not declare: the name alone is not the platform's promise.
      expect(
        throwsOn(
          '{ refresh(): Promise<number> }',
          `${declarations}\ninterface Promise<T> { then(done: (value: T) => void): void }`
        ),
        'the probe’s control: a `Promise` declared outside the default library'
      ).toMatch(/does not return a promise of the platform's/);
      // **One function type, a command under the handle and data's in a
      // snapshot**, in both orders: whichever is met first, the other is
      // classified where it is met.
      for (const [order, context] of [
        ['after', '{ readonly request: Handle; readonly effect?: Refresh }'],
        ['before', '{ readonly effect?: Refresh; readonly request: Handle }']
      ] as const)
        expect(
          writesThrough(
            'export {};\ntype Refresh = () => Promise<number>;\ninterface Handle { readonly refresh: Refresh }',
            context,
            { callables: 'api', commands: ['Handle.refresh'] }
          ),
          `the probe’s control: a command’s type on a snapshot, met ${order} the command`
        ).toContain('void value.effect!.call;');
      // How many arguments the reader finds, or what it reports — a string
      // either way, so a control expecting one fails on the other by name.
      const handedBy = (imports: string, typeText: string): string => {
        try {
          return `${handedArgumentsOf(imports, [typeText]).handed.length} handed`;
        } catch (thrown) {
          return (thrown as Error).message;
        }
      };
      const snippet = "import type { Snippet } from 'svelte';";
      expect(
        handedBy(
          snippet,
          '{ onsettled?: (settled: { readonly n: number }, also: { readonly m: number }) => void; children: Snippet<[{ readonly s: string }, { readonly t: string }]> }'
        ),
        'the probe’s control: a callback prop and a snippet, each handed two arguments'
      ).toBe('4 handed');
      expect(
        handedBy(
          snippet,
          '({ kind: "a"; children: Snippet<[{ readonly a: number }]> } | { kind: "b"; only?: (handed: { readonly b: number }) => void }) & { on?: { settled?: (events: { readonly c: number }) => void }; as?: new (made: { readonly d: number }) => unknown }'
        ),
        'the probe’s control: a prop one variant holds, one inside a prop, and a class'
      ).toBe('4 handed');
      // Inside a prop, a callback is read through every shape that can hold
      // one: a union, an intersection, a list, a tuple, and a hook's
      // parameters.
      for (const [shape, typeText] of [
        [
          'a union',
          "{ observer?: { kind: 'callback'; done(value: { mutable: string }): void } | { kind: 'off' } }"
        ],
        [
          'a union with a callback in it',
          '{ on?: ((handed: { n: number[] }) => void) | { off: true } }'
        ],
        [
          'an intersection',
          '{ on?: { settled?: (handed: { events: string[] }) => void } & { readonly label?: string } }'
        ],
        ['a list', '{ handlers?: readonly ((handed: { list: string[] }) => void)[] }'],
        [
          'a list in an intersection',
          '{ handlers: readonly ((value: { mutable: number[] }) => void)[] & { readonly label: string } }'
        ],
        [
          'an index signature',
          '{ callbacks: Record<string, (value: { mutable: number[] }) => void> }'
        ],
        ['a member keyed by a number', '{ 0: (value: { mutable: number[] }) => void }'],
        ['a rest list', '{ on: (...values: { mutable: number[] }[]) => void }'],
        ['a tuple', '{ pair: [string, (handed: { list: string[] }) => void] }'],
        [
          'a hook’s parameter',
          'Parameters<(plan: (previous?: { events: string[] }) => number) => void>'
        ]
      ] as const)
        expect(
          handedBy('export {};', typeText),
          `the probe’s control: a callback inside ${shape}`
        ).toBe('1 handed');
      expect(
        handedBy(
          'export {};',
          '{ fn: ((x: { n: number[] }) => void) & { inner: (y: { m: number[] }) => void } }'
        ),
        'the probe’s control: a callback and one it holds'
      ).toBe('2 handed');
      expect(
        handedBy(
          'export {};',
          '{ onready: (prefix: string, ...rest: [{ readonly n: number }, { mutable: number[] }]) => void }'
        ),
        'the probe’s control: a rest tuple after an argument handed one by one'
      ).toBe('3 handed');
      expect(
        handedBy('export {};', '{ [Symbol.iterator](): Iterator<{ mutable: number[] }> }'),
        'the probe’s control: a member keyed by a symbol is reported'
      ).toMatch(/keyed by a symbol/);
      // **Each argument's text names the argument**, which the population's
      // own comparison asks of every outlet; and its control, the spelling of
      // a numeric key this replaced, which names `never`.
      const keyed = handedArgumentsOf('export {};', [
        '{ 0: (value: { mutable: number[] }) => void; on: Record<string, (seen: { n: string[] }) => void>; ready: (a: string, ...b: [{ c: number[] }]) => void }'
      ]);
      expect(
        walkEach('export {};', keyed.handed, {}).types,
        'the probe’s control: each argument’s text names the argument'
      ).toEqual(keyed.types);
      expect(
        walkEach(
          'export {};',
          ['{ 0: number } extends infer V ? ("0" extends keyof V ? V["0"] : never) : never'],
          {}
        ).types,
        'the identity check’s control: a text that names `never`'
      ).toEqual(['never']);
      expect(
        handedBy('export {};', '{ a: { b: { c: { d: (x: { n: number }) => void } } } }'),
        'the probe’s control: a callback at the depth the probe reads'
      ).toBe('1 handed');
      expect(
        handedBy('export {};', '{ a: { b: { c: { d: { e: (x: { n: number }) => void } } } } }'),
        'the probe’s control: a callback past it is reported'
      ).toMatch(/deeper than the probe reads/);
      expect(
        handedBy('export {};', '{ loose: any }'),
        'the probe’s control: a prop it cannot read is reported'
      ).toMatch(/a prop the probe cannot read/);
      // And `unknown` wherever a prop holds it: as a member, under an index
      // signature of either key, and as a list's element. Each is reached
      // through `NonNullable`, which turns `unknown` into `{}`, read as
      // holding nothing.
      expect(
        [
          '{ on: unknown }',
          '{ on: Record<string, unknown> }',
          '{ on: { [n: number]: unknown } }',
          '{ on: unknown[] }'
        ].map((typeText) => handedBy('export {};', typeText)),
        'the probe’s control: an unknown, wherever a prop holds it'
      ).toEqual([
        'handedArgumentsOf: value.on is a prop the probe cannot read',
        'handedArgumentsOf: value.on[string] is a prop the probe cannot read',
        'handedArgumentsOf: value.on[number] is a prop the probe cannot read',
        'handedArgumentsOf: value.on[] is a prop the probe cannot read'
      ]);
      // An index signature keyed by neither `string` nor `number` is one the
      // reader cannot name in a type, and is reported.
      expect(
        handedBy('export {};', '{ on: { [key: `on${string}`]: (x: { m: number[] }) => void } }'),
        'the probe’s control: an index signature it cannot name'
      ).toBe('handedArgumentsOf: value.on has an index signature the probe cannot name');
      // A tuple is read position by position, each callback in it handed its
      // own arguments. Read as one union through its `number` index, as a
      // list is, two callbacks would be one signature the probe cannot place.
      expect(
        handedBy(
          'export {};',
          '{ on: readonly [(a: { x: string[] }) => void, (b: { y: number[] }) => void] }'
        ),
        'the probe’s control: a tuple, read position by position'
      ).toBe('2 handed');
      // The exemption's other edge: a type under the signer's name that this
      // library does not declare is read like any other.
      const stranger = handedArgumentsOf(
        'export {};\ninterface NostrSigner { signEvent(template: { tags: string[][] }): void }',
        ['{ signer: NostrSigner }'],
        HANDED_THEIRS
      );
      expect(
        [stranger.handed.length, stranger.theirs],
        'the probe’s control: a signer this library does not declare'
      ).toEqual([1, []]);
      expect(
        signaturesOf(
          'export {};\ndeclare function useThing(a: string): number;\ndeclare function useThing(a: number, b: true): string;',
          ['typeof useThing']
        ),
        'the probe’s control: an overloaded hook'
      ).toEqual([{ calls: 2, constructs: 0 }]);
      // And the premise's: a component's props under an outlet type's name
      // that it declares itself, inline, not imported, imported under an
      // alias, or bound in the other script too, is not read as one.
      const imported =
        '<script lang="ts">\n  import type { EventListProps } from \'./outlets.js\';\n';
      expect(
        [
          ['read', `${imported}  let { ids }: EventListProps = $props();\n</script>`],
          [
            'declared beside the import',
            `${imported}  type Shadow = EventListProps;\n  type EventListProps = Shadow & { onsettled?: () => void };\n  let { ids }: EventListProps = $props();\n</script>`
          ],
          [
            'inline',
            `${imported}  let { ids }: EventListProps & { extra?: () => void } = $props();\n</script>`
          ],
          [
            'not imported',
            `<script lang="ts">\n  let { ids }: EventListProps = $props();\n</script>`
          ],
          [
            'read twice',
            `${imported}  let { ids }: EventListProps = $props();\n  let rest = $props();\n</script>`
          ],
          [
            'an alias of another outlet type',
            `<script lang="ts">\n  import type { EventProps as EventListProps } from './outlets.js';\n  let { ids }: EventListProps = $props();\n</script>`
          ],
          [
            'imported in the module script, aliased in the instance',
            `<script module lang="ts">\n  import type { EventListProps } from './outlets.js';\n</script>\n<script lang="ts">\n  import type { Unsafe as EventListProps } from './elsewhere.js';\n  let { ids }: EventListProps = $props();\n</script>`
          ],
          [
            'imported from elsewhere',
            `<script lang="ts">\n  import type { EventListProps } from './elsewhere.js';\n  let { ids }: EventListProps = $props();\n</script>`
          ],
          [
            'declared in the module script beside the instance’s import',
            `<script module lang="ts">\n  type EventListProps = { onsettled?: () => void };\n</script>\n${imported}  let { ids }: EventListProps = $props();\n</script>`
          ],
          [
            'imported in the module script alone',
            `<script module lang="ts">\n  import type { EventListProps } from './outlets.js';\n</script>\n<script lang="ts">\n  let { ids }: EventListProps = $props();\n</script>`
          ],
          [
            'with type arguments',
            `${imported}  let { ids }: EventListProps<{ onsettled?: () => void }> = $props();\n</script>`
          ],
          [
            'a generic under its name',
            `<script lang="ts" generics="EventListProps extends import('./outlets.js').EventListProps & { onsettled?: (seen: { ids: string[] }) => void }">\n  import type { EventListProps } from './outlets.js';\n  let { ids }: EventListProps = $props();\n</script>`
          ]
        ].map(([shape, source]) => `${shape}: ${propsTypeOf(source as string) ?? 'refused'}`),
        'the premise’s control: each way a component can name its props otherwise'
      ).toEqual([
        'read: EventListProps',
        'declared beside the import: refused',
        'inline: refused',
        'not imported: refused',
        'read twice: refused',
        'an alias of another outlet type: refused',
        'imported in the module script, aliased in the instance: refused',
        'imported from elsewhere: refused',
        'declared in the module script beside the instance’s import: refused',
        'imported in the module script alone: refused',
        'with type arguments: refused',
        'a generic under its name: refused'
      ]);
      // A method this repository declares, with a member of its own; and two
      // lists of different types, since a type is walked where it is first met.
      const withMethod = 'export {};\ninterface Refresh { (): Promise<number>; cell: string[] }';
      const shaped =
        '{ refresh: Refresh; list: number[]; frozen: readonly string[]; named: { __key: string; [key: string]: string } }';
      const shapedLines = writesThrough(withMethod, shaped, commands);
      const own = [
        'value.refresh!.cell = value.refresh!.cell!;',
        'value.refresh!.call = value.refresh!.call!;',
        'value.list!.map = value.list!.map!;',
        'value.frozen!.map = value.frozen!.map!;',
        "value.named!['__key_'] = value.named!['__key_']!;"
      ];
      expect(shapedLines, 'the probe’s control: each asked for by name').toEqual(
        expect.arrayContaining(own)
      );
      expect(
        judgeWrites(withMethod, shaped, own).map((one) => one.verdict),
        'the probe’s control: a function’s member compiles, its `call` and a read-only list’s method are the exception, a mutable list’s is not'
      ).toEqual([
        'compiles',
        'a standard member slot',
        'compiles',
        'a standard member slot',
        'compiles'
      ]);
      // Distinct by type, as the compiler interns them: a named type handed by
      // two outlets is one argument, and a member that is not a snippet is
      // the consumer's to write, not an outlet.
      const { handed } = handedArgumentsOf(
        "import type { Snippet } from 'svelte';\ntype N = { readonly n: number };\ntype S = { readonly s: string };",
        [
          '{ children: Snippet<[N]>; again?: Snippet<[N]>; other: Snippet<[S]>; written: string }',
          '{ children: Snippet<[S]> }'
        ]
      );
      expect(handed, 'the probe’s control: each outlet’s argument, once a type').toHaveLength(2);

      // **The arrays stay arrays**, which is what the exception buys: a
      // consumer's `$state.snapshot`, a non-empty tuple, and an `instanceof`
      // narrowing, compiled against the published types.
      const entry = "import type * as Published from '$lib/v1/index.js';";
      // **Every list site the walk meets** — where a consumer's line reaches
      // a list, read off the walk rather than written down: a list of sites somebody wrote
      // held those sites, and a list type changed at another left it green.
      // Each is snapshotted and mapped; each tuple the walk meets is taken as
      // a non-empty one; and each, narrowed by `instanceof`, is still refused
      // as a writable list — the one diagnostic expected, once a site.
      // Its control: one list type at two sites is two sites.
      expect(
        walkEach(
          'export {};',
          ['{ a: readonly string[]; b: readonly string[] }'],
          {}
        ).lists[0]?.map((site) => site.expression),
        'the list sites’ control: one type, met twice'
      ).toEqual(['value.a!', 'value.b!']);
      const sites = typed.lists.flatMap((each, at) => each.map((site) => ({ ...site, root: at })));
      expect(sites.length, 'the premise: the lists the walk met').toBeGreaterThan(20);
      expect(
        sites.filter((site) => site.tuple).length,
        'the premise: the non-empty lists among them'
      ).toBeGreaterThan(3);
      const said = consumerDiagnostics(
        [
          PUBLISHED,
          ...typed.shapes.map((shape, at) => `export declare const value_${at}: ${shape};`),
          ...sites.flatMap((site, at) => [
            `${site.guard}{ const snapshot${at} = $state.snapshot(${site.expression}).map((one: unknown) => one); void snapshot${at}; }`,
            ...(site.tuple
              ? [
                  `${site.guard}{ const tuple${at}: readonly [unknown, ...unknown[]] = ${site.expression}; void tuple${at}; }`
                ]
              : []),
            `${site.guard}if (${site.expression} instanceof Array) { const kept${at}: readonly unknown[] = ${site.expression}; void kept${at}; const lost${at}: unknown[] = ${site.expression}; void lost${at}; }`
          ])
        ].join('\n')
      );
      expect(
        said.filter((one) => one.code !== 4104),
        'a consumer’s snapshot, tuple and narrowing, on every list'
      ).toEqual([]);
      expect(said.length, 'and every narrowed list is still not a writable one').toBe(sites.length);
      // The tuple's and the narrowing's controls: a list that is not a tuple
      // is refused as one, and a writable list narrowed is assigned freely —
      // so the diagnostics above are the published types answering.
      expect(
        consumerDiagnostics(
          [
            'export {};',
            'declare const list: readonly string[];',
            'declare const writable: string[];',
            'export const tuple: readonly [unknown, ...unknown[]] = list;',
            'if (writable instanceof Array) { const lost: unknown[] = writable; void lost; }'
          ].join('\n')
        ).map((one) => one.code),
        'the tuple’s and the narrowing’s controls'
      ).toEqual([2322]);
      // Its control: the list type this row gave up, under the same snapshot —
      // so a clean compile above is the arrays, and not a check that reads
      // nothing.
      expect(
        consumerDiagnostics(
          [
            // The same import, which is what declares `$state` to a `.ts` file.
            entry,
            'export type Held = Published.ReqState;',
            'type MappedList<T> = { readonly [K in keyof ReadonlyArray<T>]: ReadonlyArray<T>[K] };',
            'declare const settled: { readonly events: MappedList<{ readonly id: string }> };',
            'export const ids = $state.snapshot(settled).events.map((event: { readonly id: string }) => event.id);'
          ].join('\n')
        ).map((one) => one.code),
        'the snapshot’s control: a list that is not an array'
      ).toEqual([2349]);
    }
  );
});
