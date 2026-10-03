/**
 * Cache identity, on the engine that has a cache.
 *
 * Ported from the spike's entry-key suite onto `src/lib/v1`, the arms renamed
 * from `EK<n>` to `EY<n>` — 0005 records the `EK` names as spike witnesses, and
 * a production arm carries a name of its own. The hooks here are the engine's
 * own (`useStreamedReq`) with the provider's inputs supplied by the harness:
 * the internal seam, not the published API.
 *
 * Other arm names in the comments below — the ones not renamed here — are the
 * spike's, as 0005 records them; they are history rather than files in this
 * repository.
 *
 * `identity.test.ts` attacks `canonicalKey` and says a great deal about it —
 * including a 2000-case sweep. None of it was about the engine with the cache,
 * because that engine did not call the function: it keyed its entries with the
 * caller's `queryKey` plus the relay scope, so the filters, the settle timeout,
 * the retention bound and `namespace` were all outside cache identity on the
 * only path where an entry is shared at all. Two hooks with one key and
 * different filters shared one entry, which is verbatim the defect 0003 opens
 * with and says the record exists to remove.
 *
 * So these are the same claims as K1/K2/K4/K4b, asked of the shipping path
 * rather than of the function. Each is written so a shared entry is visible
 * from outside: the second request either reads an answer it did not ask for,
 * or it does not.
 *
 * They belong here rather than in `identity.test.ts` because they need a relay,
 * a client and two mounted hooks — that file is the pure half, deliberately.
 */
import type Nostr from 'nostr-typedef';
import type { QueryKey } from 'tanstack-svelte-query-v6';
import { QueryClient } from 'tanstack-svelte-query-v6';
import { hashKey } from 'tanstack-svelte-query-v6';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { createAttemptRegistry } from '$lib/v1/attempt.js';
import { entryKeyOf, useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import {
  acceptAnyEvent,
  createTestRelay,
  fakeEvent,
  respondWithEose,
  respondWithEvent
} from './helpers/relay.js';
import { flush, mount } from './helpers/runes.svelte.js';

/** The provider's job, done by the harness. */
const attempts = createAttemptRegistry();

let port = 9400;
const nextUrl = () => `ws://localhost:${(port += 1)}`;

/**
 * The client the hooks below are handed.
 *
 * Handed rather than left in the ambient context: the engine takes a client as
 * an option now. See `UseStreamedReqOpts.client`.
 */
let queryClient: QueryClient;

const settle = async (ms = 80): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  flush();
};

const reqs = (server: WS): unknown[][] =>
  (server.messages as unknown[][]).filter((m) => m[0] === 'REQ');

const backwardReqs = (server: WS): string[] =>
  reqs(server)
    .map((m) => String(m[1]))
    .filter((id) => id.includes('-b:'));

async function waitForBackward(server: WS, count: number): Promise<string[]> {
  for (let i = 0; i < 100 && backwardReqs(server).length < count; i += 1) await settle(10);
  return backwardReqs(server);
}

/** Everything a hook needs except what the request is. */
const base = (rxNostr: ReturnType<typeof createTestRelay>['rxNostr'], tag: string) => ({
  attempts,
  rxNostr,
  verifyEvent: acceptAnyEvent,
  client: queryClient,
  reqIdBase: tag,
  staleTime: 0
});

/** How many entries this client holds. One per distinct request, and no more. */
const entries = (): number => queryClient.getQueryCache().getAll().length;

describe('B1/B2/B9: the entry a request lands in is derived from the request', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => WS.clean());

  it('EY1: two requests differing only in their filters do not share an entry', async () => {
    // 0003's opening sentence, on the path. There is no caller-supplied key any
    // more, so the two hooks below agree about everything a caller can say and
    // differ only in what they are asking for — which is what has to split them.
    const { rxNostr, server } = createTestRelay(nextUrl());

    const notes = mount(() =>
      useStreamedReq(() => ({ ...base(rxNostr, 'ek1a'), filters: [{ kinds: [1] }] }))
    );
    const reactions = mount(() =>
      useStreamedReq(() => ({ ...base(rxNostr, 'ek1b'), filters: [{ kinds: [7] }] }))
    );

    const opened = await waitForBackward(server, 2);
    expect(opened.length).toBe(2);
    expect(entries()).toBe(2);

    // One of them is answered, and the answer must not become the other's. With
    // one entry the second hook reads a settled list of somebody else's events
    // on its next read, which is the merge the decision is written against.
    const note = fakeEvent({ kind: 1 });
    respondWithEvent(server, opened[0] as string, note);
    respondWithEose(server, opened[0] as string);
    await settle(120);

    expect(notes.value.state.status).toBe('settled');
    expect(reactions.value.state.status).toBe('loading');

    notes.destroy();
    reactions.destroy();
  });

  it('EY2: two requests differing only in the settle timeout do not share an entry', async () => {
    // B9, and the reason it is a decision rather than a detail: the settle
    // marker rides on the cache value, so two consumers sharing an entry would
    // have whichever of them set the query's options last decide when the other
    // reports that its backlog is over (the spike sentinel `SEN9`). Neither request is answered
    // here, so the only thing that can end either backlog is its own timer.
    const { rxNostr, server } = createTestRelay(nextUrl());

    const impatient = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek2a'),
        filters: [{ kinds: [1] }],
        settleTimeoutMs: 120
      }))
    );
    const patient = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek2b'),
        filters: [{ kinds: [1] }],
        settleTimeoutMs: 30_000
      }))
    );

    expect((await waitForBackward(server, 2)).length).toBe(2);
    expect(entries()).toBe(2);

    await settle(400);

    // The short timer fired and said so; the long one has not, and cannot have
    // been told that it did.
    expect(impatient.value.state.status).toBe('incomplete');
    expect(patient.value.state.status).toBe('loading');

    impatient.destroy();
    patient.destroy();
  });

  it('EY3: a namespace splits an entry, and it is the only thing a caller can say', async () => {
    // B2's second clause, which was a decision, a unit test (K4) and nothing in
    // between: `namespace` was published on the consumer's descriptor, honoured
    // by `canonicalKey`, and on no engine option at all. This is it doing its
    // job through a hook.
    const { rxNostr, server } = createTestRelay(nextUrl());

    const mine = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek3a'),
        namespace: 'sidebar',
        filters: [{ kinds: [1] }]
      }))
    );
    const theirs = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek3b'),
        namespace: 'timeline',
        filters: [{ kinds: [1] }]
      }))
    );

    const opened = await waitForBackward(server, 2);
    expect(opened.length).toBe(2);
    expect(entries()).toBe(2);

    respondWithEvent(server, opened[0] as string, fakeEvent({ kind: 1 }));
    respondWithEose(server, opened[0] as string);
    await settle(120);

    expect(mine.value.state.status).toBe('settled');
    expect(theirs.value.state.status).toBe('loading');

    mine.destroy();
    theirs.destroy();
  });

  it('EY6: the wire subscription id stays inside NIP-01’s 64 characters', async () => {
    // **A width decision needs the budget it spends from, and this is the
    // budget.** The registry origin went from 40 bits to 96 because 40 could
    // collide (a reviewer priced it), and the id it is part of rides inside a
    // subscription id: `${reqIdBase}-${attemptId}-b:<n>`, where NIP-01 says a
    // subscription id is at most 64 characters. Widening the token spends that
    // budget, so the arm that reads it is what stops the next widening from
    // spending it silently.
    //
    // Measured on the wire rather than computed from the format, because the
    // last two pieces are the dependency's: rx-nostr composes `:<n>` onto the
    // id this library hands it.
    const { rxNostr, server } = createTestRelay(nextUrl());
    // 32 characters — comfortably inside the 35 the record leaves at a
    // three-digit counter. A round number rather than one at the edge, so this
    // fails when the library's share grows and not when a caller is careless.
    const base32 = 'ek6-0123456789abcdef0123456789ab';
    expect(base32).toHaveLength(32);

    // **The attempt counter is part of the library's share, and this arm used
    // to read it at one digit.** The share is `r` + the token + `a` + a counter
    // that is per registry — so a provider's tenth attempt costs one character
    // more than its first, and at 24 hex characters of token the first version
    // of this arm sat on exactly 64 with a one-digit counter: the tenth attempt
    // would have gone over the protocol's cap with nothing failing. Measured by
    // a reviewer. A hundred mints first is where a long-lived page is.
    for (let i = 0; i < 100; i += 1) attempts.mint();

    const held = mount(() =>
      useStreamedReq(() => ({ ...base(rxNostr, base32), filters: [{ kinds: [1] }] }))
    );
    const opened = await waitForBackward(server, 1);
    expect(opened.length, 'a REQ was sent').toBe(1);

    const wire = opened[0] as string;
    expect(wire.startsWith(base32), wire).toBe(true);
    // The premise: the counter really is three digits here, so what follows is
    // about a wider id than the one this arm used to read.
    expect(wire, `${wire} does not carry a three-digit counter`).toMatch(/a\d{3}-b:/);
    expect(wire.length, `${wire} is longer than NIP-01 allows`).toBeLessThanOrEqual(64);
    // And the library's own share, which is what the token's width is chosen
    // against: the joining `-`, `r`, 19 characters of token, `a`, the counter,
    // `-b`, `:` and the dependency's number — `25 + digits + digits`, which is
    // 29 here. Arithmetic rather than a constant, and the record states it as
    // arithmetic for that reason.
    // **Exactly, not a bound.** `≤ 32` beside `≤ 64` and a 32-character base is
    // the same assertion twice — a token widened from 19 to 22 characters would
    // pass both. The number is what the record computes: 25 + 3 + 1.
    expect(wire.length - base32.length, 'the library’s own share of the id').toBe(29);

    held.destroy();
  });

  it('EY5: a namespace the boundary refuses does not reach the key it is refused on', async () => {
    // **The failure path is a second trust boundary, and it was trusting the
    // value the first one had just thrown out.** A refused descriptor has no
    // canonical form, so its entry is keyed on what the caller gave —
    // namespace, scope identity, message. `namespace` is one of the things
    // `normalizeDescriptor` refuses for *not being a string*, and query-core
    // hashes a key with `JSON.stringify`: a circular object left on that key
    // throws `TypeError: Converting circular structure to JSON` out of option
    // construction, in front of the `InvalidDescriptorError` that was supposed
    // to arrive in `state.error`. Measured by a reviewer, through the public
    // hook.
    //
    // Two cases of the same repaired branch rather than two axes — the
    // namespace is unusable in both, and what differs is *which* rejection
    // carried it: the namespace's own, and a filter's. The second is the one
    // where the refusal is about something else entirely and the namespace is
    // on the key regardless. The cases that reach the other guards are further
    // down, one each.
    const { rxNostr } = createTestRelay(nextUrl());
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    const valid = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5a'),
        filters: [{ kinds: [1] }],
        namespace: circular as unknown as string
      }))
    );
    await settle(60);
    const first = valid.value.state as { status: string; error?: Error };
    expect(first.status, 'the refusal reaches the state').toBe('error');
    expect(first.error?.name).toBe('InvalidDescriptorError');
    expect(first.error?.message).toContain('namespace');
    expect(valid.value.diagnostics.lastError?.name).toBe('InvalidDescriptorError');

    const refused = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5b'),
        filters: [{ kinds: [1], search: 'unsupported' } as unknown as { kinds: number[] }],
        namespace: circular as unknown as string
      }))
    );
    await settle(60);
    const second = refused.value.state as { status: string; error?: Error };
    expect(second.status, 'and so does the one refused for its filter').toBe('error');
    expect(second.error?.name).toBe('UnsupportedFilterError');

    // **A usable namespace is not merged with an unusable one**, which is what
    // makes `false` the right stand-in rather than a string. A string marker is
    // a namespace somebody may legitimately choose — and then their refusals
    // and the unusable ones share an entry, which is this key's original
    // defect wearing a different value. Measured on both sides: the consumer
    // who picks the marker keeps their own entry.
    const marked = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5g'),
        filters: [{ kinds: [1], search: 'unsupported' } as unknown as { kinds: number[] }],
        namespace: 'unusable'
      }))
    );
    await settle(60);
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => entry.queryKey)
      .filter((key) => Array.isArray(key) && key[1] === 'refused');
    const markedKeys = keys.filter((key) => (key as unknown[]).includes('unusable'));
    expect(markedKeys, 'the consumer who chose the marker has an entry of their own').toHaveLength(
      1
    );
    expect(
      keys.filter((key) => (key as unknown[]).includes(false)).length,
      'and both unusable ones are on keys of their own'
    ).toBe(2);
    marked.destroy();

    // **The key itself is hashable**, which is the property the throw was
    // about: the same function query-core calls on every key, called here.
    for (const key of queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => entry.queryKey)) {
      expect(() => hashKey(key), JSON.stringify(key.slice(0, 2))).not.toThrow();
    }

    // **Three requests, three entries**, and the reason is not that they are
    // all different: two of them carry the *same* unusable namespace and are
    // separated by what they were refused **for**, since the message is the
    // third element of the key. Two requests refused for the same field with
    // an unusable namespace would share one entry — which is what `false` is
    // for, an unusable value being the absence of a partition rather than one
    // of its own. (The count used to be nine, over an arm that also held the
    // guarded-read cases; those are `EY7` and `EY8` now.)
    expect(entries()).toBe(3);

    // The control, on the same client: a *usable* namespace on a refused
    // descriptor is carried onto the key as itself, which is what the spike's `PO5`
    // partitions on — so the guard above narrows the unusable case rather than
    // flattening every refusal onto one entry.
    const named = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5c'),
        filters: [{ kinds: [1], search: 'unsupported' } as unknown as { kinds: number[] }],
        namespace: 'ek5-usable'
      }))
    );
    await settle(60);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .some((entry) => (entry.queryKey as unknown[]).includes('ek5-usable')),
      'a usable namespace is still on the key'
    ).toBe(true);

    named.destroy();
    refused.destroy();
    valid.destroy();
  });

  it('EY7: the reads the refusal itself takes are guarded, not only the values', async () => {
    // **Split out of `EY5`, because a kill that names one arm has to name one
    // guard.** These are about the *rejection*: what the boundary caught, and
    // what it may ask of it. Each is reachable only through a supported
    // field's getter — an unsupported name is refused before anything is read
    // (`NM16`) — and each had a mutation-ledger entry of its own in the spike.
    const { rxNostr } = createTestRelay(nextUrl());
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    // **The third element of that key is the caller's too, in one case.** A
    // field whose getter throws leaves this boundary as the *caller's* error —
    // `NM16` refuses an *unsupported* name before reading it, so the field
    // here is a **supported** one, which is read — and then `rejection` is
    // their object and `.message` is whatever they made it, here a getter
    // returning the same circular value. The message goes through the
    // library's own total renderer for that reason.
    const theirs = new Error('replaced below');
    Object.defineProperty(theirs, 'message', { get: () => circular });
    // **And a thrown value that is not an Error and refuses to say so.**
    // `instanceof` invokes `getPrototypeOf`, so a `Proxy` decides whether this
    // boundary can even ask what it caught — the fourth guarded read.
    const unaskable = new Proxy(
      {},
      {
        getPrototypeOf(): never {
          throw new Error('you may not ask what this is');
        }
      }
    );
    const opaque = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5j'),
        filters: [
          {
            get kinds(): number[] {
              throw unaskable;
            }
          } as unknown as { kinds: number[] }
        ],
        namespace: 'ek5-unaskable'
      }))
    );
    await settle(60);
    expect(
      (opaque.value.state as { status: string }).status,
      'a thrown value that refuses `instanceof` is still a refusal'
    ).toBe('error');
    opaque.destroy();
    const hostile = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5d'),
        filters: [
          {
            get kinds(): number[] {
              throw theirs;
            }
          } as unknown as { kinds: number[] }
        ],
        namespace: 'ek5-hostile'
      }))
    );
    await settle(60);
    expect((hostile.value.state as { status: string }).status, 'it is still refused').toBe('error');
    hostile.destroy();

    // **And the reads themselves, which the first repair left unguarded.** The
    // values on this key were made total — checked primitives, the renderer's
    // output — while three *reads* on the way to them could still throw out of
    // the handler and into the options factory: a `message` getter that throws
    // rather than returning something unrenderable, a `namespace` getter of the
    // caller's, and the scope identity. A throw there is the same shape as the
    // defect this path was repaired for.
    const throwing = new Error('replaced below');
    Object.defineProperty(throwing, 'message', {
      get: () => {
        throw new Error('from the consumer, while the refusal was being filed');
      }
    });
    // A scope whose identity is what the boundary chokes on: the same value is
    // read again inside the handler, which is the third of the three reads.
    const throwingRead = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5e'),
        filters: [
          {
            get kinds(): number[] {
              throw throwing;
            }
          } as unknown as { kinds: number[] }
        ],
        namespace: 'ek5-throwing-message'
      }))
    );
    await settle(60);
    expect(
      (throwingRead.value.state as { status: string }).status,
      'a message getter that throws is still a refusal, not an exception in the render path'
    ).toBe('error');
    throwingRead.destroy();
  });

  it('EY8: an option the hook cannot read is refused by name, not thrown past', async () => {
    // **The other half of the split**: the caller's own object, read one frame
    // above the boundary, and the scope identity read inside the handler. A
    // getter that throws is a refusal naming the field — not an exception out
    // of the options factory, and not a request that quietly proceeds with no
    // scope at all.
    const { rxNostr } = createTestRelay(nextUrl());
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    // **Both halves of the scope element, because they are two guards.** A
    // scope whose identity *is* an unusable value exercises the check; one
    // whose identity cannot be read exercises the guard. The first version had
    // only the value, and the entry aimed at the read went from killing this
    // arm to killing nothing the moment the case became a throw — a full run
    // reported it.
    const valued = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5k'),
        filters: [{ kinds: [1], search: 'unsupported' } as unknown as { kinds: number[] }],
        namespace: 'ek5-valued-scope',
        scope: {
          id: circular,
          relays: [],
          configuredUrls: {}
        } as unknown as Parameters<typeof useStreamedReq>[0] extends { scope?: infer S }
          ? NonNullable<S>
          : never
      }))
    );
    await settle(60);
    expect(
      (valued.value.state as { status: string }).status,
      'an unusable scope identity is a refusal too'
    ).toBe('error');
    valued.destroy();

    const scoped = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5f'),
        filters: [{ kinds: [1], search: 'unsupported' } as unknown as { kinds: number[] }],
        namespace: 'ek5-scoped',
        scope: {
          get id(): string {
            throw new Error('the scope identity cannot be read');
          },
          relays: [],
          configuredUrls: {}
        } as unknown as Parameters<typeof useStreamedReq>[0] extends { scope?: infer S }
          ? NonNullable<S>
          : never
      }))
    );
    await settle(60);
    expect((scoped.value.state as { status: string }).status, 'refused, not thrown').toBe('error');
    scoped.destroy();

    // **And the frame above the boundary, which is where the guard was not.**
    // The hook materialises the caller's object before `resolveRequest` sees
    // it, so a `namespace` getter that throws threw out of the options factory
    // — the exception-in-the-render-path shape again, one frame up from the
    // repair. A field that cannot be read is handed on as a value the boundary
    // refuses by name, so what a consumer gets is a refusal that says which
    // field.
    const unreadable = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5h'),
        filters: [{ kinds: [1] }],
        get namespace(): string {
          throw new Error('the namespace getter throws');
        }
      }))
    );
    await settle(60);
    const refusedField = unreadable.value.state as { status: string; error?: Error };
    expect(refusedField.status, 'a getter that throws is a refusal, not an exception').toBe(
      'error'
    );
    expect(refusedField.error?.name).toBe('InvalidDescriptorError');
    expect(refusedField.error?.message, 'and it names the field').toContain('namespace');
    unreadable.destroy();

    // The same one field over, where the value is required rather than
    // optional: an unreadable `filters` is refused as `filters`.
    const noFilters = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5i'),
        get filters(): { kinds: number[] }[] {
          throw new Error('the filters getter throws');
        }
      }))
    );
    await settle(60);
    expect((noFilters.value.state as { status: string }).status).toBe('error');
    expect((noFilters.value.state as { error?: Error }).error?.message).toContain('filters');
    noFilters.destroy();

    // **The scope as an *option*, which is not the same read as its identity.**
    // `requestOf` reads `opts.scope`; `scopeGenerationOf` reads `scope.id`. The
    // second had a case and the first did not, and the branch written for it —
    // refuse an unreadable scope by name rather than proceed with none — had no
    // arm at all until this one.
    const noScope = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5l'),
        filters: [{ kinds: [1] }],
        get scope(): never {
          throw new Error('the scope getter throws');
        }
      }))
    );
    await settle(60);
    const scopeState = noScope.value.state as { status: string; error?: Error };
    expect(scopeState.status, 'an unreadable scope is a refusal, not a scopeless request').toBe(
      'error'
    );
    expect(scopeState.error?.name).toBe('InvalidDescriptorError');
    expect(scopeState.error?.message, 'and it names the field').toContain('scope');
    noScope.destroy();

    // **A field the refusal's own message would have rendered.** `retain` is
    // refused through a message that interpolates the value it refuses, so
    // while an unreadable field arrived as a sentinel *value* it reached a
    // consumer as that sentinel's JSON — something they never wrote, and
    // something they *could* write, which would then share their entry. The
    // unreadable fields are a list beside the values now, so the refusal is
    // built here and says what happened.
    const noRetain = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5m'),
        filters: [{ kinds: [1] }],
        get retain(): number {
          throw new Error('the retain getter throws');
        }
      }))
    );
    await settle(60);
    const retainState = noRetain.value.state as { status: string; error?: Error };
    expect(retainState.status).toBe('error');
    // **The whole message, not a substring of it.** The line this replaces
    // forbade a substring the builder cannot produce — an assertion that could
    // not fail, written in the commit that removed another one. What is worth
    // holding is that the refusal says the field and says what happened, and
    // renders no value at all: there is no value to render, because the failure
    // is a name beside the values rather than one of them.
    expect(retainState.error?.message).toBe(
      'nosvelte: retain could not be read. Descriptor values are checked at runtime because the ' +
        'published API is a JavaScript API — a type annotation does not stop a value arriving, and ' +
        'two descriptors that behave differently must not share a cache entry.'
    );
    noRetain.destroy();

    // **The product nobody had taken: an unreadable field *and* a scope whose
    // identity cannot be read.** Each half had a case; the pair had none, and
    // it is the pair that reaches the refusal branch with the caller's scope
    // still in hand. The branch read `scope.id` raw there for one commit —
    // which is the mutant an entry two rows up is aimed at.
    const bothUnreadable = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5p'),
        filters: [{ kinds: [1] }],
        get retain(): number {
          throw new Error('the retain getter throws');
        },
        scope: {
          get id(): string {
            throw new Error('and the scope identity cannot be read either');
          },
          relays: [],
          configuredUrls: {}
        } as unknown as Parameters<typeof useStreamedReq>[0] extends { scope?: infer S }
          ? NonNullable<S>
          : never
      }))
    );
    await settle(60);
    const both = bothUnreadable.value.state as { status: string; error?: Error };
    expect(both.status, 'a refusal, not an exception out of the options factory').toBe('error');
    expect(both.error?.name).toBe('InvalidDescriptorError');
    expect(both.error?.message, 'named after the first field that could not be read').toContain(
      'retain'
    );
    bothUnreadable.destroy();

    // **The clock, which three published members read through one getter.**
    // `state`, `diagnostics` and the expiry effect all reach `opts.clock`; a
    // getter that throws there threw at whoever read them.
    const noClock = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5n'),
        filters: [{ kinds: [1] }],
        get clock(): never {
          throw new Error('the clock getter throws');
        }
      }))
    );
    await settle(60);
    expect(
      (noClock.value.state as { status: string }).status,
      'a request with an unreadable clock still answers'
    ).toBe('loading');
    expect(noClock.value.diagnostics.lastError, 'and its diagnostics are readable').toBeUndefined();
    noClock.destroy();

    // **The third site, which nothing above reaches.** The rule names three
    // reads of `clock` — the expiry effect, the projection, and the fold — and
    // the two cases above answer a request that never arrives, so the fold
    // never runs: the guard there was raw for a mutation and every arm in this
    // file stayed green (measured). Answering the request is what enters it.
    const { rxNostr: foldRx, server: foldServer } = createTestRelay(nextUrl());
    const foldClock = mount(() =>
      useStreamedReq(() => ({
        ...base(foldRx, 'ek5q'),
        filters: [{ kinds: [1] }],
        get clock(): never {
          throw new Error('the clock getter throws');
        }
      }))
    );
    for (let i = 0; i < 200 && reqs(foldServer).length === 0; i += 1) await settle(5);
    const foldSub = String(reqs(foldServer)[0]?.[1]);
    respondWithEvent(foldServer, foldSub, fakeEvent({ id: 'ek5q-one', kind: 1, created_at: 5 }));
    respondWithEose(foldServer, foldSub);
    await settle(120);
    const folded = foldClock.value.state as { status: string; events?: Iterable<{ id: string }> };
    expect(folded.status, 'the fold reads the clock through the same guard').toBe('settled');
    expect([...(folded.events ?? [])].map((event) => event.id)).toEqual(['ek5q-one']);
    foldClock.destroy();

    // **And `live`, which is read where nothing can be refused.** `activity` is
    // a getter; it has no error channel, so an unreadable `live` defaults to
    // "not live" rather than refusing — the one axis on this surface that
    // defaults, said here because the boundary's rule everywhere else is
    // "checked, not coerced".
    const noLive = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek5o'),
        filters: [{ kinds: [1] }],
        get live(): boolean {
          throw new Error('the live getter throws');
        }
      }))
    );
    await settle(60);
    // **One value rather than the three it could take.** The line this replaces
    // named every value `activity` has, so it said only "it answered rather
    // than throwing".
    //
    // **What it still cannot say is the direction of the default**, and that is
    // a fact about the arrangement rather than about the assertion: a `live`
    // that cannot be read is *also* a descriptor field, so this request is
    // refused, nothing is ever in flight, and `deriveActivity(true, false)` and
    // `deriveActivity(false, false)` are both `idle`. Measured — a surgical
    // `catch { return true }` on this read passes every arm in this file. The
    // default value is witnessed where it is observable, in `EY11`'s control:
    // `live` absent on a request that really is fetching, where defaulting to
    // live reports `live` over a one-shot.
    expect(noLive.value.activity, 'it answers, and answers idle').toBe('idle');
    // The descriptor half is still a refusal: `live` is a descriptor field, so
    // the request itself is refused by name even though `activity` answered.
    expect((noLive.value.state as { error?: Error }).error?.message).toContain('live');
    noLive.destroy();
  });

  it('EY9: a value that cannot be read keys where unusable values key, not where absent ones do', () => {
    // **`entryKeyOf` is internal-only — `surface.ts` lists it — and it takes the
    // caller's object directly.** This comment said "published" for several
    // rounds and an adversarial pass read it against the list; the route the
    // sentence licenses is right for the other reason, which is that this arm
    // reaches a frame the hook does not have.
    // Through the hook a field whose getter throws is refused by name one frame
    // up, so the guard inside `refusedKey` was reached by nothing: an entry
    // removing it killed no arm in this file (measured). Through this function
    // there is no frame above, and the two guards answered differently from
    // each other — `safely` returns `undefined` for a throw, which `keyPart`
    // reads as *absent*, so an unreadable namespace filed exactly where **no**
    // namespace files, while `namespace: 42` filed under `false`.
    //
    // The rule this restores is `keyPart`'s own: absent is `null`, a string is
    // itself, and anything else is `false` — "anything else" including a value
    // nobody can look at.
    const refusedFor = (namespace: unknown): QueryKey =>
      entryKeyOf({
        // Refused for the filters, so the message element is identical across
        // the three keys below and the namespace element is what differs.
        filters: 'not an array' as unknown as Nostr.Filter[],
        namespace: namespace as string | undefined
      });

    const throwing = entryKeyOf({
      filters: 'not an array' as unknown as Nostr.Filter[],
      get namespace(): string {
        throw new Error('the namespace getter throws');
      }
    });

    expect(throwing[2], 'unreadable is unusable, not absent').toBe(false);
    expect(refusedFor(undefined)[2], 'absent is absent').toBe(null);
    expect(refusedFor(42)[2], 'the value it shares a partition with').toBe(false);
    // The whole key, because an element is only worth what the entry is: the
    // two callers who supply no namespace share an entry, and the one whose
    // namespace could not be read does not join them. (The messages differ too
    // — reading the getter is what throws, so the refusal is the caller's own
    // Error rather than the filters' — which is a second reason these are
    // different entries and not a substitute for the first: the element is
    // asserted above, where the message cannot stand in for it.)
    expect(hashKey(throwing)).not.toBe(hashKey(refusedFor(undefined)));
    expect(hashKey(refusedFor(42))).not.toBe(hashKey(refusedFor(undefined)));
  });

  it('EY10: the error a refused entry holds cannot be re-pointed by whoever reads it', async () => {
    // **The freeze is a class, and two of its four members were outside it.**
    // `UnsupportedFilterError` and `InvalidDescriptorError` freeze themselves,
    // and the reason written on them is this entry: refusals with the same text
    // share one key, so two hooks are handed **one** object, and 0003's
    // argument for allowing that merge — the entry holds an error and nothing
    // else — holds only while nobody can write to it. The two classes that
    // arrive through the boundary's `catch` are the caller's own Error and the
    // one this library mints for a thrown non-Error; neither was frozen.
    const { rxNostr } = createTestRelay(nextUrl());

    // Through a *filter's* own getter, which is how the caller's error reaches
    // this handler at all: a descriptor field whose getter throws is refused by
    // name one frame up (`EY8`), and an unsupported field is refused before
    // anything is read (`NM16`).
    const own = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek10a'),
        filters: [
          {
            get kinds(): number[] {
              throw new Error('thrown by the caller');
            }
          } as unknown as { kinds: number[] }
        ]
      }))
    );
    await settle(60);
    const ownError = (own.value.state as { error?: Error }).error;
    expect(ownError?.message).toBe('thrown by the caller');
    expect(Object.isFrozen(ownError), "the caller's own Error").toBe(true);
    own.destroy();

    // The library's own object, where "it is not ours to freeze" is not even
    // available as an answer.
    const foreign = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek10b'),
        filters: [
          {
            get kinds(): number[] {
              throw { notAnError: true };
            }
          } as unknown as { kinds: number[] }
        ]
      }))
    );
    await settle(60);
    const mintedError = (foreign.value.state as { error?: Error }).error;
    // **The rendering is this library's, not `String()`'s.** It read
    // `[object Object]` for a round, and that is not a detail of the message:
    // the refused entry is keyed by it, so every consumer who threw *any* plain
    // object shared one key and one Error. The spike's `PO5` defect, arriving through the
    // renderer instead of through the namespace.
    expect(mintedError?.message).toBe('{"notAnError":true}');
    expect(Object.isFrozen(mintedError), 'the Error this library minted').toBe(true);
    // And the write a merge would carry is the one that does not land. Reading
    // the message back is what says the freeze refused it rather than the
    // assignment happening somewhere else.
    expect(() => {
      (mintedError as unknown as { message: string }).message = 'rewritten';
    }).toThrow();
    expect(mintedError?.message).toBe('{"notAnError":true}');
    foreign.destroy();

    // **The interior a caller's Error carries reaches nobody**, and the reason
    // changed: the published value is not their Error any more. The boundary
    // copies what the value *said* — name, message, a bounded `cause` chain —
    // and keeps no reference at all, so a payload hung on their Error is not
    // shared with the next reader because it is not published, and their object
    // comes back untouched rather than frozen a level deep.
    const carrier = new Error('carries an interior');
    (carrier as unknown as { payload: { n: number } }).payload = { n: 1 };
    const carried = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek10d'),
        filters: [
          {
            get kinds(): number[] {
              throw carrier;
            }
          } as unknown as { kinds: number[] }
        ]
      }))
    );
    await settle(60);
    const carriedError = (carried.value.state as { error?: Error }).error;
    expect(Object.isFrozen(carriedError), 'what we publish is ours and frozen').toBe(true);
    expect(carriedError, 'and it is not theirs').not.toBe(carrier);
    expect(
      (carriedError as unknown as { payload?: unknown }).payload,
      'their payload is not republished'
    ).toBeUndefined();
    // Their object, after the boundary has seen it: unfrozen, and its interior
    // untouched. The library takes a copy; it does not take their value.
    expect(Object.isFrozen(carrier), 'the caller keeps their Error as it was').toBe(false);
    expect(Object.isFrozen((carrier as unknown as { payload: object }).payload)).toBe(false);
    (carrier as unknown as { payload: { n: number } }).payload.n = 2;
    expect(
      (carried.value.state as { error?: Error }).error,
      'and writing to it afterwards changes nothing published'
    ).toBe(carriedError);
    expect(carriedError?.message).toBe('carries an interior');
    carried.destroy();

    // **A value that refuses to be frozen used to cost its caller the
    // guarantee, and now costs nothing.** `Object.freeze` invokes
    // `preventExtensions`, which a `Proxy` can refuse: while this library kept
    // the caller's object, an unfreezable one was published unfrozen and the
    // record carried that as a price. Nothing of theirs is frozen or published
    // any more, so what a consumer holds is frozen whatever they threw — the
    // hostile value's only remaining effect is on what the message says.
    const unfreezable = new Proxy(new Error('refuses to be frozen'), {
      preventExtensions(): boolean {
        return false;
      }
    });
    const hostile = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek10c'),
        filters: [
          {
            get kinds(): number[] {
              throw unfreezable;
            }
          } as unknown as { kinds: number[] }
        ]
      }))
    );
    await settle(60);
    const hostileState = hostile.value.state as { status: string; error?: Error };
    expect(hostileState.status, 'a refusal, not an exception out of the factory').toBe('error');
    expect(hostileState.error?.message).toBe('refuses to be frozen');
    expect(Object.isFrozen(hostileState.error), 'ours, so freezing it always works').toBe(true);
    expect(hostileState.error, 'and it is not the proxy').not.toBe(unfreezable);
    // Their proxy is as they left it: this boundary read it and kept nothing.
    expect(Object.isExtensible(unfreezable), 'untouched, not half-frozen').toBe(true);
    hostile.destroy();
  });

  it('EY11: a nullish `live` is refused like every other value the boundary checks', async () => {
    // **The one field on this path that was behind a coalesce.** `live` was
    // forwarded as `opts.live ?? false`, so `live: null` became `false` while
    // `live: 0` and `live: 'yes'` were refused — a silent default on the
    // doorstep of the boundary whose whole rule is "checked, not coerced", and
    // the descriptor it produced was indistinguishable from the caller having
    // written `false`. Every other field here is forwarded with an
    // `=== undefined` test, which is the shape that keeps `null` a value.
    const { rxNostr } = createTestRelay(nextUrl());
    const nullish = mount(() =>
      useStreamedReq(() => ({
        ...base(rxNostr, 'ek11'),
        filters: [{ kinds: [1] }],
        live: null as unknown as boolean
      }))
    );
    await settle(60);
    const state = nullish.value.state as { status: string; error?: Error };
    expect(state.status).toBe('error');
    expect(state.error?.name).toBe('InvalidDescriptorError');
    expect(state.error?.message).toContain('live');
    nullish.destroy();

    // The control, without which the arm above is satisfied by a boundary that
    // refuses everything: absent is still not-live, and it still answers.
    const absent = mount(() =>
      useStreamedReq(() => ({ ...base(rxNostr, 'ek11b'), filters: [{ kinds: [1] }] }))
    );
    await settle(60);
    expect((absent.value.state as { status: string }).status).not.toBe('error');
    // Not-live, which on a request that is being fetched is `refreshing` and
    // never `live`: what absent means is that no subscription stays open.
    expect(absent.value.activity).not.toBe('live');
    absent.destroy();
  });

  it('EY4: one request spelled two ways is one entry, with no key from the caller', async () => {
    // The other direction, and the one that says the derivation is a
    // *canonicalisation* rather than a hash of whatever was typed. A filter's
    // OR array carries no order, a set field carries no order and no
    // duplicates, and a key written by hand can only get this right by
    // accident — which is what "derived, not caller-supplied" buys.
    const { rxNostr, server } = createTestRelay(nextUrl());
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);

    const first: Nostr.Filter[] = [{ kinds: [1], authors: [a, b] }];
    const second: Nostr.Filter[] = [{ authors: [b, a, b], kinds: [1] }];

    const one = mount(() => useStreamedReq(() => ({ ...base(rxNostr, 'ek4a'), filters: first })));
    const two = mount(() => useStreamedReq(() => ({ ...base(rxNostr, 'ek4b'), filters: second })));

    const opened = await waitForBackward(server, 1);
    await settle(120);

    // One entry, and one backward REQ: the second hook joined the first's fetch
    // rather than opening its own, which is the whole reason a cache is here.
    expect(entries()).toBe(1);
    expect(backwardReqs(server).length).toBe(1);

    respondWithEvent(server, opened[0] as string, fakeEvent({ kind: 1 }));
    respondWithEose(server, opened[0] as string);
    await settle(120);

    expect(one.value.state.status).toBe('settled');
    expect(two.value.state.status).toBe('settled');

    one.destroy();
    two.destroy();
  });
});
