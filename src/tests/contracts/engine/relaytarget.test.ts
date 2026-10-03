/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The relays a request names itself, folded through the scope generation
 * (0003 B3), against the engine's own seam.
 *
 * Ported from the spike's suite onto `src/lib/v1`. The arms are renamed from
 * `RT<n>` to `RG<n>` — 0005 records the old names as spike witnesses, and a
 * production arm carries a name of its own. **The comments keep the spike's
 * names**, because what they record was measured there: `RT3` in a comment is
 * the arm that is `RG3` here, and every other arm name in a comment is the
 * spike's as 0005 records it, not a file in this repository. Likewise "the
 * ledger" is the spike's mutation ledger, and a function a comment names that
 * `src/lib/v1` does not have is the spike's.
 *
 * What the spike's suite said of itself:
 *
 * `ReqDescriptor.relays`: where a request is asked, and what that does to its
 * identity.
 *
 * **Two decisions in one field, and they only work together.** `C3`'s falsifier
 * — nothing can be asked of a particular relay — is met by the field; `B3`'s
 * relay axis is met by keying on the **effective target set** rather than on the
 * provider's generation. A subset field added to a single scope-generation key
 * leaves the loop this file's `RT3` reproduces standing: an app fetches its
 * NIP-65 list from bootstrap relays, sets the provider's relays to the answer,
 * and re-keys the very request that produced it.
 *
 * So these are driven end to end rather than through `canonicalKey`: the key is
 * read off the cache the mounted hook filled, the targets are read off sockets
 * that are listening, and each "nothing was asked" carries the arrangement that
 * does ask.
 *
 * The refusal half of the same field is `RM27`/`RM28`, with the rest of the
 * failure channel.
 *
 * Port band 9340-9379, as the spike's suite had it.
 */
import { createRxForwardReq } from 'rx-nostr';
import { QueryClient } from 'tanstack-svelte-query-v6';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { createAttemptRegistry } from '$lib/v1/attempt.js';
import { createNostrContext, setNostrContext } from '$lib/v1/context.svelte.js';
import type { ReqHandle } from '$lib/v1/engine.js';
import { deriveOutlet } from '$lib/v1/engine.js';
import { canonicalUrl, createRelayScope } from '$lib/v1/scope.svelte.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

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

let port = 9340;
const nextUrl = () => `ws://localhost:${(port += 1)}`;

const reqs = (server: WS) => (server.messages as unknown[][]).filter((m) => m[0] === 'REQ');

async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  flush();
}

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
});

afterEach(() => {
  client.clear();
  WS.clean();
});

/**
 * The keys this library owns, read off the cache the hook filled.
 *
 * Off the cache rather than out of `canonicalKey`, because what the decision is
 * about is which **entry** a request lands in: a key computed beside the
 * request and never used would satisfy every assertion below while the hook
 * read somewhere else.
 */
const ourKeys = (): string[] =>
  client
    .getQueryCache()
    .getAll()
    .map((entry) => JSON.stringify(entry.queryKey))
    .filter((key) => key.startsWith('["nosvelte"'))
    .sort();

const idsOf = (handle: ReqHandle): string[] =>
  handle.state.status === 'loading' ? [] : handle.state.events.map((event) => event.id);

describe('C3/B3: the relays a request is asked of', () => {
  // @contracts B3-C6
  it('RG1: order, duplicates and the caller’s own spelling are one effective set', async () => {
    // **Three ways of writing the same two relays**, and the decision is that
    // they are one request: the caller's order is not a promise, a repeat is
    // not a second relay, and a spelling they configured the provider with is
    // one this library can be asked with. `configuredUrls` is the join — the
    // scope keeps what the caller wrote beside what the transport calls it.
    // Under the default transport the two agree for every spelling measured,
    // so the join is driven below through a transport that names relays
    // otherwise, where the caller's spelling is the only way to reach them.
    const urlA = nextUrl();
    const urlB = nextUrl();
    const { rxNostr, server: a } = createTestRelay(urlA);
    const b = new WS(urlB, { jsonProtocol: true });
    const scope = createRelayScope(rxNostr, [urlA, urlB]);

    const ask = (relays: readonly string[], base: string) =>
      mount(() =>
        useStreamedReq(() => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          scope: scope.current,
          client,
          namespace: 'rt1',
          filters: [{ kinds: [1] }],
          relays,
          reqIdBase: base,
          staleTime: 60_000,
          settleTimeoutMs: 120
        }))
      );

    const first = ask([urlB, urlA], 'rt1-a');
    await settle(150);
    const afterFirst = ourKeys();
    expect(afterFirst, 'one entry for the first request').toHaveLength(1);

    // The same set, written backwards, with a repeat.
    const second = ask([urlA, urlB, urlA], 'rt1-b');
    await settle(150);
    expect(ourKeys(), 'order and duplicates carry no identity').toEqual(afterFirst);

    // **The control the two above need**: a *different* set does get its own
    // entry. Without it "the keys are equal" is satisfied by a key that ignores
    // the field.
    const narrower = ask([urlA], 'rt1-c');
    await settle(150);
    expect(ourKeys().length, 'a different set is a different question').toBe(2);

    // And the wire: the narrower request reached the relay it named and not
    // the other — read by its own wire id, since the two-relay requests
    // legitimately asked both.
    const askedBy = (server: WS): unknown[][] =>
      reqs(server).filter((frame) => String(frame[1]).includes('rt1-c'));
    expect(askedBy(a).length, 'the relay it named was asked').toBeGreaterThan(0);
    expect(askedBy(b), 'and the one it did not name was not').toEqual([]);

    first.destroy();
    second.destroy();
    narrower.destroy();

    // **And the caller's own spelling.** A transport that names each relay
    // with a trailing slash, under a provider configured without one: the
    // spelling the caller wrote reaches the transport's name only through the
    // scope's record of what they wrote, since this library's own
    // canonicalisation would not add the slash. Written that way — reversed and
    // repeated as well — the pair is one entry, the entry a request naming no
    // relays lands on, and not a refusal.
    const slashed = (urls: readonly string[]): readonly string[] =>
      urls.map((url) => `${canonicalUrl(url)}/`);
    const renamed = createRelayScope(rxNostr, [urlA, urlB], slashed);
    expect(renamed.current.urls, 'the transport names them otherwise').toEqual(
      [`${urlA}/`, `${urlB}/`].sort()
    );
    const spelled = (relays: readonly string[] | undefined, base: string) =>
      mount(() =>
        useStreamedReq(() => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          scope: renamed.current,
          client,
          namespace: 'rt1-spelling',
          filters: [{ kinds: [1] }],
          ...(relays === undefined ? {} : { relays }),
          reqIdBase: base,
          staleTime: 60_000,
          settleTimeoutMs: 120
        }))
      );
    const before = ourKeys().length;
    const asConfigured = spelled([urlA, urlB], 'rt1-d');
    const reordered = spelled([urlB, urlA, urlB], 'rt1-e');
    const unnamed = spelled(undefined, 'rt1-f');
    await settle(150);
    for (const handle of [asConfigured, reordered, unnamed])
      expect(handle.value.state.status, 'not refused').not.toBe('error');
    expect(ourKeys().length, 'the three are one entry').toBe(before + 1);
    asConfigured.destroy();
    reordered.destroy();
    unnamed.destroy();
  });

  it('RG2: an empty target set is not-started rather than nothing-found', async () => {
    // **`relays: []` is a question a caller asked on purpose**, and it is not
    // the same as leaving the field out. Absent means "wherever this provider
    // reads" and moves when the provider does; empty means "nowhere", which no
    // provider update answers. `B-γ` says a request with nowhere to ask has not
    // been asked — so it reports `loading`, not `nodata`, and `refresh()`
    // resolves `not-started` with the reason rather than rejecting.
    const url = nextUrl();
    const { rxNostr, server } = createTestRelay(url);
    const scope = createRelayScope(rxNostr, [url]);

    const nowhere = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: scope.current,
        client,
        namespace: 'rt2',
        filters: [{ kinds: [1] }],
        relays: [],
        reqIdBase: 'rt2',
        settleTimeoutMs: 120
      }))
    );
    await settle(200);

    expect(nowhere.value.state.status, 'nothing was asked, so nothing is known').toBe('loading');
    expect(deriveOutlet(nowhere.value.state).slot, 'and the outlet is not “nothing found”').toBe(
      'loading'
    );
    const outcome = (await nowhere.value.refresh()) as { kind: string; reason?: string };
    expect(outcome.kind, 'refresh() resolves rather than rejecting').toBe('not-started');
    expect(outcome.reason, 'and says why').toBe('no-readable-relay');
    expect(reqs(server), 'no REQ was sent anywhere').toEqual([]);
    nowhere.destroy();

    // **The positive control, on the same socket.** Without it the silence
    // above is a fact about the probe: this mount differs in the target set
    // alone and puts a REQ on the very server that received nothing.
    const somewhere = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: scope.current,
        client,
        namespace: 'rt2b',
        filters: [{ kinds: [1] }],
        relays: [url],
        reqIdBase: 'rt2b',
        settleTimeoutMs: 120
      }))
    );
    for (let i = 0; i < 100 && reqs(server).length === 0; i += 1) await settle(10);
    expect(reqs(server).length, 'the same arrangement does ask when it has a target').toBe(1);
    somewhere.destroy();
  });

  // @contracts B3-C7
  it('RG3: a request that named its relays is not re-keyed when the provider’s list grows', async () => {
    // **The first request every Nostr client makes, keyed by its own answer.**
    // The app boots on bootstrap relays `B` and fetches the user's relay list;
    // the answer is `L`, so it sets the provider's relays to `B ∪ L` — and with
    // the provider's generation on the key, the relay-list request is re-keyed
    // and re-asked under the new set. If `L` holds an older kind-10002 the
    // answer changes, the app writes it back, and the entry it flips to may
    // still be warm.
    //
    // The field alone does not close that: it closes only if the request that
    // named `B` is keyed by `B` **instead of** by the provider's generation.
    // So this arm holds both halves at once — the explicit request keeps its
    // key, its data and its observer, and the implicit one beside it moves.
    const bootstrap = nextUrl();
    const learned = nextUrl();
    const { rxNostr, server: b } = createTestRelay(bootstrap);
    const l = new WS(learned, { jsonProtocol: true });
    const scope = createRelayScope(rxNostr, [bootstrap]);

    const named = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: scope.current,
        client,
        namespace: 'rt3',
        filters: [{ kinds: [10002] }],
        relays: [bootstrap],
        reqIdBase: 'rt3named',
        staleTime: 60_000,
        settleTimeoutMs: 120
      }))
    );
    const unnamed = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: scope.current,
        client,
        namespace: 'rt3b',
        filters: [{ kinds: [10002] }],
        reqIdBase: 'rt3any',
        staleTime: 60_000,
        settleTimeoutMs: 120
      }))
    );

    // Both settle on the bootstrap relay, with data, so that "kept its data" is
    // about a request that had some.
    for (let i = 0; i < 200 && reqs(b).length < 2; i += 1) await settle(10);
    expect(reqs(b).length, 'both requests reached the bootstrap relay').toBe(2);
    for (const frame of reqs(b)) {
      const sub = String(frame[1]);
      respondWithEvent(b, sub, fakeEvent({ id: `rt3-${sub}`, kind: 10002 }));
      respondWithEose(b, sub);
    }
    await settle(250);
    expect(named.value.state.status, 'the named request answered').toBe('settled');
    expect(idsOf(named.value).length, 'and holds what it was told').toBe(1);
    const keyBefore = JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((entry) => entry.queryKey)
        .find((key) => String(key[1]).includes('"ns":"rt3"'))
    );
    expect(keyBefore, 'the named request’s entry was found').toContain('rt3');
    const dataBefore = idsOf(named.value);
    // **Attributed per request, not counted per socket.** Both requests are
    // asked of the bootstrap relay, and the point of the arm is that one of
    // them moves while the other does not — a total of the socket's frames
    // cannot separate those. The wire id carries each request's own base.
    const askedBy = (server: WS, base: string): unknown[][] =>
      reqs(server).filter((frame) => String(frame[1]).includes(base));
    const askedBefore = askedBy(b, 'rt3named').length;
    const anyAskedBefore = askedBy(b, 'rt3any').length;
    const unnamedBefore = idsOf(unnamed.value);
    expect(unnamedBefore.length, 'so did the one beside it').toBe(1);

    // The answer written back: the provider's readable set becomes `B ∪ L`.
    scope.setRelays([bootstrap, learned]);
    flush();
    await settle(400);

    const keyAfter = JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((entry) => entry.queryKey)
        .find((key) => String(key[1]).includes('"ns":"rt3"'))
    );
    expect(keyAfter, 'the named request keeps its entry').toBe(keyBefore);
    expect(
      client
        .getQueryCache()
        .getAll()
        .find((entry) => String(entry.queryKey[1]).includes('"ns":"rt3"'))
        ?.getObserversCount(),
      'and its observer'
    ).toBe(1);
    expect(idsOf(named.value), 'and its data').toEqual(dataBefore);
    expect(named.value.state.status, 'and its status').toBe('settled');
    expect(askedBy(b, 'rt3named').length, 'and asks nothing again').toBe(askedBefore);
    expect(askedBy(l, 'rt3named'), 'and nothing at all of the relay it never named').toEqual([]);

    // **The other edge, and it is what makes the first one a decision.** A
    // request that named no relays *is* a function of the provider's list: it
    // re-keys, loses the previous answer, and is asked again — including of the
    // relay that just joined. Without this the assertions above are satisfied
    // by a key that ignores the relay axis entirely.
    expect(idsOf(unnamed.value), 'the request that named none is a new question').toEqual([]);
    expect(
      askedBy(b, 'rt3any').length + askedBy(l, 'rt3any').length,
      'and is asked again'
    ).toBeGreaterThan(anyAskedBefore);
    expect(askedBy(l, 'rt3any').length, 'including of the relay that just joined').toBeGreaterThan(
      0
    );

    named.destroy();
    unnamed.destroy();
  });

  // @contracts B3-C8
  it('RG4: naming every readable relay is the same request as naming none', async () => {
    // **The merge that says the key is about the effective targets**, not about
    // whether the caller spelled them. `resolveTargets` answers the scope's own
    // generation for an absent field and the named set's identity for a present
    // one, and both are `identityOf` of the same sorted list — so a consumer who
    // starts passing `relays` while the value is the provider's whole readable
    // set does not split their cache.
    //
    // It is also why `relays` is not a seventh member of `canonicalKey`: a
    // member beside the generation would separate these two, which is a second
    // REQ for a difference no relay can observe.
    const url = nextUrl();
    const { rxNostr } = createTestRelay(url);
    const scope = createRelayScope(rxNostr, [url]);

    const shared = (relays: readonly string[] | undefined, base: string) =>
      mount(() =>
        useStreamedReq(() => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          scope: scope.current,
          client,
          namespace: 'rt4',
          filters: [{ kinds: [1] }],
          ...(relays === undefined ? {} : { relays }),
          reqIdBase: base,
          staleTime: 60_000,
          settleTimeoutMs: 120
        }))
      );

    const implicit = shared(undefined, 'rt4-a');
    await settle(150);
    const afterImplicit = ourKeys();
    expect(afterImplicit, 'one entry').toHaveLength(1);

    const explicit = shared([url], 'rt4-b');
    await settle(150);
    expect(ourKeys(), 'the same effective targets are the same request').toEqual(afterImplicit);

    implicit.destroy();
    explicit.destroy();
  });

  it('RG5: a named relay the provider drops becomes a typed refusal, not a quieter request', async () => {
    // **The sentence in `0004` that had no witness.** The ruling says a
    // selected relay that leaves the scope, or stops being readable, is a
    // typed refusal — and until this arm the record said it while nothing
    // drove it. What makes it worth driving is the alternative: a request whose
    // target quietly disappears would go on asking the relays that are left,
    // and its answer would look complete.
    const kept = nextUrl();
    const dropped = nextUrl();
    const { rxNostr } = createTestRelay(kept);
    new WS(dropped, { jsonProtocol: true });
    const scope = createRelayScope(rxNostr, [kept, dropped]);

    const named = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: scope.current,
        client,
        namespace: 'rt5',
        filters: [{ kinds: [1] }],
        relays: [dropped],
        reqIdBase: 'rt5',
        settleTimeoutMs: 120
      }))
    );
    await settle(150);
    // The control: while the relay is in the scope, the request is not refused.
    expect(named.value.state.status, 'the named relay is in the scope').not.toBe('error');

    scope.setRelays([kept]);
    flush();
    await settle(200);

    const state = named.value.state as { status: string; error?: { code?: string; url?: string } };
    expect(state.status, 'the request is refused').toBe('error');
    expect(state.error?.code, 'as a relay this provider cannot read').toBe('relay-not-in-scope');
    expect(state.error?.url, 'and it names the one that left').toBe(dropped);

    named.destroy();
  });

  it('RG7: a named relay this library cannot spell is the request’s fault, not the provider’s', async () => {
    // **Which channel a refusal arrives on is the decision, and nothing drove
    // it.** `0003` splits the relay-list refusals in two by remedy: a string
    // that is not a relay URL, or one the transport would rename a second
    // time, is a value the *caller* fixes — so the target resolution catches
    // those classes and re-says them as a descriptor fault on the request's own
    // channel, rather than letting a provider-level `RelayConfigurationError`
    // escape where a request has no place to publish one.
    //
    // Found by putting a rethrow in every `catch` in the library: this one
    // swallowed nothing that any arm could see, and no test in the repository
    // asserted the message it writes.
    //
    // `wss://h.example/?x=%257E` is the non-idempotent shape `TD5` uses: one
    // pass leaves `%7E`, the next leaves `~`, so `canonicalUrl` refuses it
    // rather than choosing one of its own two answers.
    const kept = nextUrl();
    const { rxNostr } = createTestRelay(kept);
    const scope = createRelayScope(rxNostr, [kept]);

    const named = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: scope.current,
        client,
        namespace: 'rt7',
        filters: [{ kinds: [1] }],
        relays: ['wss://h.example/?x=%257E'],
        reqIdBase: 'rt7',
        settleTimeoutMs: 120
      }))
    );
    await settle(150);

    const state = named.value.state as {
      status: string;
      error?: { code?: string; message?: string };
    };
    expect(state.status, 'the request is refused').toBe('error');
    // The descriptor's channel and the descriptor's code: a provider-level
    // relay-configuration refusal here would be the escape this catch exists
    // to stop.
    expect(state.error?.code, 'as a descriptor the caller can fix').toBe('invalid-descriptor');
    expect(state.error?.message, 'and it says which field').toContain('relays');

    named.destroy();
  });

  it('RG6: two subsets inside one provider share a relay’s socket, and two providers share none', async () => {
    // **`C6`'s resource domain, read at the socket.** The whole reason a relay
    // subset is a *descriptor* field rather than a second provider is that a
    // second provider shares nothing: two sockets per common relay, two caches,
    // two clocks, two diagnostics maps. This is that difference, measured —
    // and it is the half of the ruling that says what the field bought.
    const shared = nextUrl();
    const other = nextUrl();
    const sharedServer = new WS(shared, { jsonProtocol: true });
    const otherServer = new WS(other, { jsonProtocol: true });

    const provider = mount(() => {
      const built = createNostrContext({
        relays: [shared, other],
        harness: HARNESS_DIVERGENCES,
        verifyEvent: acceptAnyEvent
      });
      setNostrContext(built);
      return built;
    });

    const ask = (relays: readonly string[], base: string) =>
      mount(() =>
        useStreamedReq(() => ({
          namespace: base,
          filters: [{ kinds: [1] }],
          relays,
          reqIdBase: base,
          settleTimeoutMs: 30_000
        }))
      );

    // Two requests naming **overlapping** subsets: both want the shared relay,
    // one wants the other relay as well.
    const both = ask([shared, other], 'rt6-both');
    const one = ask([shared], 'rt6-one');
    // **Both relays, because both are part of the claim.** Waiting only for the
    // shared one let the other's frame still be in flight, and the count below
    // then read 0 — a race that fails as if the request had gone to the wrong
    // relay. Seen once in a full-suite run and not alone, which is the shape a
    // bounded wait on the wrong condition has.
    for (
      let i = 0;
      i < 200 && (reqs(sharedServer).length < 2 || reqs(otherServer).length < 1);
      i += 1
    )
      await settle(10);

    expect(reqs(sharedServer).length, 'both requests asked the shared relay').toBe(2);
    expect(
      sharedServer.server.clients().length,
      'over one socket, because one provider is one connection pool'
    ).toBe(1);
    expect(reqs(otherServer).length, 'and only one of them asked the other relay').toBe(1);

    // **The control, and it is the alternative the field replaces**: a second
    // provider over the same relay is a second socket, which is what "a second
    // provider shares nothing" costs.
    const second = mount(() =>
      createNostrContext({
        relays: [shared],
        harness: HARNESS_DIVERGENCES,
        verifyEvent: acceptAnyEvent
      })
    );
    // A provider connects when something asks, so the arm asks through the
    // second one's own transport rather than waiting for a hook it cannot mount
    // beside the first provider's context.
    const req = createRxForwardReq('rt6-second');
    second.value.transportLease?.use(req)?.subscribe({ error: () => undefined });
    req.emit([{ kinds: [1] }]);
    for (let i = 0; i < 200 && sharedServer.server.clients().length < 2; i += 1) await settle(10);
    expect(
      sharedServer.server.clients().length,
      'a second provider is a second socket on the same relay'
    ).toBe(2);

    one.destroy();
    both.destroy();
    second.destroy();
    provider.destroy();
  });
});
