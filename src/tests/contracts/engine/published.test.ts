/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Nothing a consumer holds is a handle on this library's own state (`B5-C8`).
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
 * So these arms do not name values. They drive a request to an outcome, walk
 * everything reachable from what the hooks publish, and require each container
 * to be frozen — and, where freezing is not the whole answer, write and read
 * back through a second reader.
 *
 * `PB1`, `PB3`, `PB4`, `PB5` and `PB9` are the spike's `PO1`, `PO3`, `PO4`,
 * `PO5` and `PO9` from its `published-ownership` suite, renamed because an id
 * 0005 records as a spike witness is not a landing. Their comments keep the
 * spike's names, as the history of what was measured.
 *
 * Port band 9600-9649.
 */
import { isDeepStrictEqual } from 'node:util';

import { QueryClient } from 'tanstack-svelte-query-v6';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { StreamAccumulator } from '$lib/v1/accumulate.js';
import { createAttemptRegistry } from '$lib/v1/attempt.js';
import { createNostrContext } from '$lib/v1/context.svelte.js';
import { beginAttempt, emptyEventSet, noteFailure } from '$lib/v1/eventset.js';
import { capture } from '$lib/v1/own.js';
import type { RelayInput } from '$lib/v1/scope.svelte.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import {
  exportsOf,
  judgeWrites,
  judgeWritesEach,
  writesThrough,
  writesThroughEach
} from './helpers/declarations.js';
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
 * What a value holds, as data a comparison can read: every own property —
 * symbol-keyed and non-enumerable ones included, so an `Error`'s `message`,
 * `stack`, `code` and `cause` are in it — down every container, with each read
 * guarded. Two snapshots of one reader's view, taken before and after another
 * reader writes, are equal exactly when the write did not reach it.
 */
function shape(value: unknown, seen = new Set<unknown>()): unknown {
  if (typeof value === 'function') return '[function]';
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[seen]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((one) => shape(one, seen));
  if (value instanceof Map)
    return {
      '[map]': [...value.entries()].map(([key, one]) => [shape(key, seen), shape(one, seen)])
    };
  if (value instanceof Set) return { '[set]': [...value].map((one) => shape(one, seen)) };
  const keys = [...Object.getOwnPropertyNames(value), ...Object.getOwnPropertySymbols(value)];
  return Object.fromEntries(
    keys.map((key) => {
      let read: unknown;
      try {
        read = (value as Record<string | symbol, unknown>)[key];
      } catch {
        read = '[unreadable]';
      }
      return [String(key), shape(read, seen)];
    })
  );
}

/**
 * Write to everything a consumer holding `root` can reach: every own property
 * of every container — set and redefined — and, for a list, a push, a position
 * and its length. Each attempt swallows whatever the host does about it, since
 * the contract is the effect on the other readers, not how a write is refused.
 * Returns how many containers it wrote to, so an arm can tell a walk that found
 * nothing from one that found everything closed.
 */
function writeEverything(root: unknown): number {
  const written = containers(root, 'held');
  const attempt = (write: () => void): void => {
    try {
      write();
    } catch {
      // A frozen object refuses; that is one way of keeping the promise.
    }
  };
  for (const [, container] of written) {
    const target = container as Record<string | symbol, unknown>;
    // A list's positions are own members, and the loop below writes each; a
    // list with nothing in it has none, and a push is the write it takes.
    if (Array.isArray(container))
      attempt(() => (container as unknown[]).push('PUSHED BY A CONSUMER'));
    for (const key of [
      ...Object.getOwnPropertyNames(container),
      ...Object.getOwnPropertySymbols(container)
    ]) {
      attempt(() => {
        target[key] = `WRITTEN BY A CONSUMER (${String(key)})`;
      });
      attempt(() => {
        Object.defineProperty(container, key, { value: 'REDEFINED BY A CONSUMER' });
      });
    }
  }
  return written.length;
}

/** What a consumer imports. */
const PUBLISHED = `import type * as Published from '$lib/v1/public-entry.js';`;

/**
 * The published names this row is not about, each for a reason: written by the
 * consumer and handed in, not given out; a function a consumer calls rather than
 * a shape; and the event, whose type is `B5-C6`'s.
 */
const NOT_GIVEN_OUT: Readonly<Record<string, string>> = {
  ReqDescriptor: 'written by the consumer',
  ReqPlan: 'written by the consumer',
  RelayConfig: 'written by the consumer',
  RelayInput: 'written by the consumer',
  EventTemplate: 'written by the consumer',
  NostrSigner: 'supplied by the consumer',
  SendInput: 'written by the consumer',
  SendOptions: 'written by the consumer',
  Send: 'a function a consumer calls',
  ReqEvent: 'B5-C6’s'
};

/**
 * Every write the published types let through, by type: each type the public
 * entry gives out — and each class's instances — walked by the compiler-asked
 * probe, with a handle's methods taken for its API (their slots refused, what
 * they resolve with walked).
 */
function publishedTypeBreaches(): { shapes: string[]; breaches: string[] } {
  const exported = exportsOf('$lib/v1/public-entry.js');
  const names = new Set(exported.map((one) => one.name));
  // Both edges of the exclusion: each name it leaves out is a name the entry
  // exports, so a renamed type is walked rather than silently skipped.
  for (const name of Object.keys(NOT_GIVEN_OUT))
    expect(names.has(name), `${name}, excluded, is published`).toBe(true);
  const shapes = exported
    .filter((one) => one.kind !== 'value' && NOT_GIVEN_OUT[one.name] === undefined)
    .map((one) =>
      one.kind === 'class' ? `InstanceType<typeof Published.${one.name}>` : `Published.${one.name}`
    );
  const writes = writesThroughEach(PUBLISHED, shapes, { callables: 'api', depth: 6 });
  const verdicts = judgeWritesEach(PUBLISHED, shapes, writes);
  const breaches = shapes.flatMap((typeText, at) =>
    (verdicts[at] ?? [])
      .filter((one) => one.verdict !== 'refused')
      .map((one) => `${typeText}: ${one.write} (${one.verdict})`)
  );
  return { shapes, breaches };
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
    // naming values could not: the object carries a `raw` member that `0004`'s
    // `ReqHandle` does not declare — the query library's own object, and under
    // it the cache's `Map`. It is this repository's inspection seam (`errormap`
    // and `measurements` read it), it is not on the published entry today, and
    // `PO2` is what keeps it the *only* undeclared member rather than the first
    // of several.
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
      timeout: 60_000
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
      const { shapes, breaches } = publishedTypeBreaches();
      expect(shapes.length, 'the published shapes, counted').toBeGreaterThan(25);
      expect(breaches, 'a write a published type lets through').toEqual([]);
    }
  );

  // @contracts B5-C8
  it(
    'PB13: what a consumer holds, they can write to without reaching anybody else, and no published type lets them',
    { timeout: 60_000 },
    async () => {
      // **Every clause of the row in one arm.** At run time, five answers a
      // consumer can hold — an answer with events, refusals and causes on it; a
      // live request whose leg ended; what one `refresh()` resolves its callers
      // with; an attempt that failed; and the refusal a provider publishes after
      // a refused relay list. For each, one reader writes to everything it can
      // reach — every own member of every container, an Error's `stack` and
      // `code` among them — and nobody else sees it: not a second reader of the
      // same answer, not the cache, not the same hook read again. **Freezing is
      // not asserted here**: it is how this library keeps the promise, and a
      // port that hands out copies keeps it too. At compile time, every member
      // of every published type but the event refuses a write.
      //
      // **`raw` and `projected` are not walked, and that is priced, not
      // promised.** They are this repository's inspection seams on the handle,
      // on no interface: `handle.raw` is the query library's own object, and one
      // line through it empties the cached value.
      const SEAMS = ['raw', 'projected'];
      const handedOut = (handle: object): Record<string, unknown> =>
        Object.fromEntries(Object.entries(handle).filter(([member]) => !SEAMS.includes(member)));
      const cached = (): unknown =>
        client
          .getQueryCache()
          .getAll()
          .map((entry) => entry.state.data);
      // Who saw a consumer's write to `held`, of the value written to and
      // `others`: an empty list is the promise kept.
      const reachedBy = (held: unknown, others: Record<string, () => unknown>): string[] => {
        // **What the consumer holds is a reader too**, as `B5-C6` reads its
        // event: this row's evidence (`PB1`) says every container a consumer
        // can reach is frozen, and a projection that handed out a fresh,
        // writable copy each time would keep every other reader clean while
        // the consumer's own value changed. Read off the published values
        // themselves — not the wrapper this arm builds around a handle's
        // members, which is the arm's own and takes every write.
        const values =
          held !== null &&
          typeof held === 'object' &&
          Object.getPrototypeOf(held) === Object.prototype
            ? Object.values(held)
            : [held];
        const readers: Record<string, () => unknown> = {
          'the value written to': () => values,
          ...others
        };
        const before = Object.fromEntries(
          Object.entries(readers).map(([reader, read]) => [reader, shape(read())])
        );
        expect(writeEverything(held), 'the containers written to').toBeGreaterThan(0);
        return Object.entries(readers)
          .filter(([reader, read]) => !isDeepStrictEqual(shape(read()), before[reader]))
          .map(([reader]) => reader);
      };
      const reaches = (
        answer: string,
        held: unknown,
        others: Record<string, () => unknown>
      ): void => {
        expect(reachedBy(held, others), `${answer}: a reader the consumer's write reached`).toEqual(
          []
        );
      };
      // Its control: a value nothing froze and nobody else reads, handed out
      // as the arm hands out a handle's members — the write reaches it, and
      // only it.
      expect(
        reachedBy({ published: { member: 'as it was' } }, { 'a stranger': () => ({}) }),
        'the reach’s control'
      ).toEqual(['the value written to']);

      // An answer with events, refusals and causes on it, held by two hooks.
      {
        const { rxNostr, server } = createTestRelay(nextUrl());
        const options = () => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace: 'pb13-incomplete',
          filters: [{ kinds: [1] }],
          reqIdBase: 'pb13a',
          settleTimeoutMs: 300
        });
        const first = mount(() => useStreamedReq(options));
        const second = mount(() => useStreamedReq(options));
        const req = await waitForReq(server);
        respondWithEvent(
          server,
          req,
          fakeEvent({ id: 'pb13-a', created_at: 1, tags: [['t', 'ok']] })
        );
        server.send(['CLOSED', req, 'rate-limited: slow down']);
        await settle(400);
        expect(first.value.state.status, 'the premise: an incomplete answer').toBe('incomplete');
        expect(first.value.diagnostics.refusals).toHaveLength(1);
        reaches('an answer with events, refusals and causes', handedOut(first.value), {
          'a second hook': () => handedOut(second.value),
          'the cache': cached,
          'the same hook, read again': () => handedOut(first.value)
        });
        first.destroy();
        second.destroy();
      }

      // A live request whose leg ended, held by two hooks.
      {
        const { rxNostr, server } = createTestRelay(nextUrl());
        const options = () => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace: 'pb13-ended',
          filters: [{ kinds: [1] }],
          live: true,
          retain: 'unbounded' as const,
          reqIdBase: 'pb13b',
          settleTimeoutMs: 300
        });
        const first = mount(() => useStreamedReq(options));
        const second = mount(() => useStreamedReq(options));
        const req = await waitForReq(server);
        respondWithEvent(server, req, fakeEvent({ id: 'pb13-b', created_at: 1 }));
        respondWithEose(server, req);
        await settle(150);
        rxNostr.dispose();
        await settle(200);
        expect(first.value.diagnostics.legEnded?.kind, 'the premise: the leg ended').toBe('ended');
        reaches('a live request whose leg ended', handedOut(first.value), {
          'a second hook': () => handedOut(second.value),
          'the cache': cached,
          'the same hook, read again': () => handedOut(first.value)
        });
        first.destroy();
        second.destroy();
      }

      // What one `refresh()` resolves its two callers with — **each kind of
      // outcome**, since each is built at a site of its own: an answer that
      // completed, one that timed out incomplete, an attempt that failed, and
      // a refresh the consumer released before it answered.
      const refreshed = async (
        kind: 'complete' | 'incomplete' | 'error' | 'cancelled'
      ): Promise<void> => {
        const { rxNostr, server } = createTestRelay(nextUrl());
        const failing: StreamAccumulator = () => async () => {
          throw new Error('the accumulator threw', { cause: new Error('and why') });
        };
        const handle = mount(() =>
          useStreamedReq(() => ({
            verifyEvent: acceptAnyEvent,
            attempts,
            rxNostr,
            client,
            namespace: `pb13-refreshed-${kind}`,
            filters: [{ kinds: [1] }],
            reqIdBase: `pb13c${kind}`,
            settleTimeoutMs: 300,
            ...(kind === 'error' ? { accumulator: failing } : {})
          }))
        );
        if (kind !== 'error') respondWithEose(server, await nextReqOf(server));
        await settle(150);
        const asked = handle.value.refresh();
        const askedAgain = handle.value.refresh();
        if (kind === 'complete') respondWithEose(server, await nextReqOf(server));
        if (kind === 'cancelled') {
          await nextReqOf(server);
          handle.destroy();
        }
        const [outcome, sameOutcome] = await Promise.all([asked, askedAgain]);
        expect(outcome.kind, `the premise: an outcome that is ${kind}`).toBe(kind);
        expect(sameOutcome, 'the premise: two callers of one refresh hold one object').toBe(
          outcome
        );
        reaches(`what a refresh resolves with, ${kind}`, outcome, {
          'the other caller': () => sameOutcome,
          'the cache': cached,
          ...(kind === 'cancelled' ? {} : { 'the hook': () => handedOut(handle.value) })
        });
        if (kind !== 'cancelled') handle.destroy();
      };
      for (const kind of ['complete', 'incomplete', 'error', 'cancelled'] as const)
        await refreshed(kind);

      // An attempt that failed, held by two hooks.
      {
        const accumulator: StreamAccumulator = () => async () => {
          throw new Error('the accumulator threw', { cause: new Error('and why') });
        };
        const { rxNostr } = createTestRelay(nextUrl());
        const options = () => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace: 'pb13-failed',
          filters: [{ kinds: [1] }],
          reqIdBase: 'pb13d',
          settleTimeoutMs: 300,
          accumulator
        });
        const first = mount(() => useStreamedReq(options));
        const second = mount(() => useStreamedReq(options));
        await settle(150);
        expect(first.value.state.status, 'the premise: a failed attempt').toBe('error');
        reaches('an attempt that failed', handedOut(first.value), {
          'a second hook': () => handedOut(second.value),
          'the cache': cached,
          'the same hook, read again': () => handedOut(first.value)
        });
        first.destroy();
        second.destroy();
      }

      // The refusal a provider publishes after a refused relay list.
      {
        const refused: RelayInput[] = [
          { url: 'wss://a.example', read: true, write: true },
          { url: 'wss://a.example', read: false, write: true }
        ];
        const built = mount(() =>
          createNostrContext({
            relays: refused,
            harness: HARNESS_DIVERGENCES,
            transportKeys: (urls) => [...urls]
          })
        );
        const refusal = built.value.configurationError;
        expect(refusal?.code, 'the premise: a refused list').toBe('conflicting-capabilities');
        reaches('the refusal a provider publishes', refusal, {
          'the provider, read again': () => built.value.configurationError,
          'the scope it accepted': () => built.value.scope
        });
        built.destroy();
      }

      // **The write's and the snapshot's own controls.** Over a value nothing
      // froze, the write lands on each kind of member it tries — a property, a
      // symbol-keyed one, a list, and one that refuses assignment but not
      // redefinition — and the snapshot sees each, and sees a non-enumerable
      // member and a map's contents, so an unchanged snapshot above is the
      // answer and not a blind instrument.
      const key = Symbol('member');
      // An empty list has no member to write to, and a push is the one write
      // it takes. Read by reference afterwards, since the slot that holds it
      // is written over.
      const empty: unknown[] = [];
      const open: Record<string | symbol, unknown> = {
        property: { value: 1 },
        [key]: 'as it was',
        list: ['as it was'],
        empty
      };
      Object.defineProperty(open, 'fixed', {
        value: 'as it was',
        writable: false,
        configurable: true,
        enumerable: true
      });
      const untouched = shape(open) as Record<string, unknown>;
      expect(writeEverything(open), 'the write’s control: what it reached').toBeGreaterThan(3);
      const touched = shape(open) as Record<string, unknown>;
      for (const member of ['property', String(key), 'list', 'fixed'])
        expect(touched[member], `the write’s control: ${member}, written`).not.toEqual(
          untouched[member]
        );
      expect(empty.length, 'the write’s control: an empty list, pushed onto').toBeGreaterThan(0);
      const hidden = {};
      Object.defineProperty(hidden, 'unlisted', { value: 'as it was', enumerable: false });
      expect(shape(hidden), 'the snapshot’s control: a non-enumerable member').toEqual({
        unlisted: 'as it was'
      });
      expect(shape({ [Symbol('k')]: 1 }), 'the snapshot’s control: a symbol key').not.toEqual(
        shape({})
      );
      expect(shape(new Map([['k', 1]])), 'the snapshot’s control: a map’s contents').not.toEqual(
        shape(new Map([['k', 2]]))
      );

      // At compile time: every member of every published type but the event
      // refuses a write.
      const { shapes, breaches } = publishedTypeBreaches();
      expect(shapes.length, 'the published shapes, counted').toBeGreaterThan(25);
      expect(breaches, 'a write a published type lets through').toEqual([]);

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
      const lines = writesThrough(declarations, mutable, { callables: 'api' });
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
    }
  );
});
