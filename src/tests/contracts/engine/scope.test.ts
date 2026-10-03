/**
 * The relay scope — its identity, its generation, and how a request is keyed
 * under it (0003 B3, B-α) — against the engine's own seam.
 *
 * Ported from the spike's suite onto `src/lib/v1`. The arms are renamed from
 * `SC<n>` to `SG<n>` — 0005 records the old names as spike witnesses, and a
 * production arm carries a name of its own. **The comments keep the spike's
 * names**, because what they record was measured there: `SC3` in a comment is
 * the arm that is `SG3` here, and every other arm name in a comment is the
 * spike's as 0005 records it, not a file in this repository. Likewise "the
 * ledger" is the spike's mutation ledger, and a function or a file a comment names
 * that this repository does not have (`configOf`, `roles.ts`, `context.test.ts`,
 * …) is the spike's.
 *
 * What the spike's suite said of itself:
 *
 * B-α, measured against the thing it has to fix.
 *
 * The scope generation existed as a key field with no definition behind it, and
 * the two candidate definitions were compared on how simple they were to
 * explain. What decides between them is P19c: a request with nowhere to ask
 * stays that way after relays arrive, because nothing signals the change. So the
 * test that matters is whether a definition makes that recover.
 */
import { WebSocket } from 'mock-socket';
import type { IWebSocketConstructor, RxNostr } from 'rx-nostr';
import { createRxNostr } from 'rx-nostr';
import { QueryClient } from 'tanstack-svelte-query-v6';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { createAttemptRegistry } from '$lib/v1/attempt.js';
import { createNostrContext, setNostrContext } from '$lib/v1/context.svelte.js';
import type { ReqHandle } from '$lib/v1/engine.js';
import { canonicalKey } from '$lib/v1/key.js';
import type { RawDescriptor } from '$lib/v1/normalize.js';
import { normalizeDescriptor } from '$lib/v1/normalize.js';
import type { RelayConfig, RelayInput, TransportKeys } from '$lib/v1/scope.svelte.js';
import {
  canonicalUrl,
  createRelayScope,
  InvalidRelayInputError,
  InvalidRelayScopeError,
  NonIdempotentRelayUrlError,
  probeTransportKeys
} from '$lib/v1/scope.svelte.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import {
  acceptAnyEvent,
  createTestRelay,
  fakeEvent,
  HARNESS_DIVERGENCES,
  respondWithEose,
  respondWithEvent
} from './helpers/relay.js';
import { flush, mount, mountUnflushed } from './helpers/runes.svelte.js';

/**
 * The provider's job, done by the harness.
 *
 * One registry for the file, supplied the way the clock is. Per mount would be
 * the per-hook minting A6 rejects, and a module-level counter is what this
 * replaced.
 */
const attempts = createAttemptRegistry();

let port = 9920;
const nextUrl = () => `ws://localhost:${(port += 1)}`;

const reqs = (server: WS) => (server.messages as unknown[][]).filter((m) => m[0] === 'REQ');

async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  flush();
}

/**
 * A client that records what it is told and connects to nothing.
 *
 * These three are about the scope value itself, so a socket would only add
 * ports and teardown to a test with no wire in it.
 */
function silent(): RxNostr {
  let relays: Record<string, RelayConfig> = {};
  return {
    setDefaultRelays: (next: readonly RelayConfig[] | Record<string, RelayConfig>) => {
      relays = Array.isArray(next)
        ? Object.fromEntries(next.map((relay) => [relay.url, relay]))
        : (next as Record<string, RelayConfig>);
    },
    getDefaultRelays: () => relays
  } as unknown as RxNostr;
}

/**
 * A real rx-nostr, connected to nothing.
 *
 * `silent()` above is a stub, which is what makes `SC10` blind to the
 * dependency: no rx-nostr code runs in it. This is the opposite — the resolved
 * client, doing its own normalization — and nothing is dialled, because the
 * default connection strategy is lazy and `SC15` only reads keys.
 */
const bareClient = (): RxNostr =>
  createRxNostr({
    websocketCtor: WebSocket as unknown as IWebSocketConstructor,
    skipVerify: true,
    skipFetchNip11: true,
    retry: { strategy: 'off' }
  });

/** The relay a client is connected to, or would connect to: its own spelling. */
const keyOfClient = (client: RxNostr): string =>
  Object.keys(client.getAllRelayStatus())[0] as string;

/**
 * What the transport names a relay, asked of the transport and nothing else.
 *
 * A fresh client per call and the *caller's* string as its only input — never
 * this library's output, which is what the previous version of `SC15` did and
 * why it could not fail. One application, because one application is the
 * decision the transport makes about a URL a consumer wrote.
 */
const transportNames = (input: string): string => {
  const client = bareClient();
  client.setDefaultRelays([input]);
  const named = keyOfClient(client);
  client.dispose();
  return named;
};

const idsOf = (handle: ReqHandle): string[] =>
  handle.state.status === 'loading' ? [] : handle.state.events.map((event) => event.id);

/** The boundary, applied. Nothing below may take a raw descriptor. */
const keyOf = (raw: RawDescriptor): string => canonicalKey(normalizeDescriptor(raw));

/**
 * The client the hooks below are handed.
 *
 * Handed rather than left in the ambient context: the engine takes a client
 * as an option now, because the provider's client reached no request while it
 * did not. See `UseStreamedReqOpts.client`.
 */
let queryClient: QueryClient;

describe('B-α: the scope generation', () => {
  // @contracts B-α-C24
  it('SG32: a relay input this library refuses is never handed to the transport to be named', () => {
    // What the transport is asked, recorded at the seam the scope names relays
    // through, and answered by the real probe.
    const asked: string[][] = [];
    const recording: TransportKeys = (urls) => {
      asked.push([...urls]);
      return probeTransportKeys(urls);
    };
    const good = 'wss://good.example';
    for (const [label, malformed] of [
      ['a number', 42],
      ['a url that is not a string', { url: 42, read: true, write: true }],
      ['not a URL', 'not a url'],
      ['no scheme', 'example.com'],
      ['the wrong scheme', 'https://a.example'],
      ['a capability that is not a boolean', { url: 'wss://b.example', read: 'yes', write: true }]
    ] as const) {
      asked.length = 0;
      expect(
        () => createRelayScope(undefined, [good, malformed as unknown as RelayInput], recording),
        label
      ).toThrow(InvalidRelayInputError);
      // Whatever the transport was asked, it was asked about the good entry
      // and nothing else: whether a list holding a malformed entry asks about
      // its well-formed ones is not contracted (`B-α-C17`).
      expect(
        asked.flat().filter((url) => url !== good),
        label
      ).toEqual([]);
    }

    // The control: a list that is all relays is asked about, so the record
    // above can see an ask.
    asked.length = 0;
    createRelayScope(undefined, [good, 'wss://b.example'], recording);
    expect(asked.flat()).toEqual(expect.arrayContaining([good, 'wss://b.example']));
  });

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => WS.clean());

  it('SG0: read/write configuration survives, and only readable relays identify', () => {
    // What the first version dropped. `NostrApp.relays` already accepts this
    // shape, and B-γ and the relay diagnostics both branch on it, so a scope
    // that could only hold URLs would have been a public API unable to express
    // the configuration the library itself reads.
    const { rxNostr } = createTestRelay(nextUrl());
    const scope = createRelayScope(rxNostr, [
      'wss://both.example',
      { url: 'wss://write.example', read: false, write: true },
      { url: 'wss://read.example', read: true, write: false }
    ]);

    expect(scope.current.relays).toEqual([
      { url: 'wss://both.example', read: true, write: true },
      { url: 'wss://read.example', read: true, write: false },
      { url: 'wss://write.example', read: false, write: true }
    ]);

    // Identity is the readable set alone: a write-only relay cannot answer a
    // REQ, so adding one changes nothing any request can be told, and splitting
    // the cache over it would re-ask every question for nothing.
    expect(scope.current.id).toBe(JSON.stringify(['wss://both.example', 'wss://read.example']));

    // And it reaches the client with the configuration intact.
    expect(rxNostr.getDefaultRelays()['wss://write.example']).toMatchObject({
      read: false,
      write: true
    });
  });

  it('SG6: the client can still be changed behind the scope, and that is visible', () => {
    // The claim in the first version was that `setRelays` is the only way the
    // set changes and the two cannot drift. It is passed a client, so anyone
    // holding that client can change it — which is a hole the provider owning
    // the client would close (C6) and a comment cannot.
    const url = nextUrl();
    const { rxNostr } = createTestRelay(url);
    // The harness sets the client's relays itself, so starting from the same
    // url would leave this passing even if the scope never wrote through —
    // which the mutation runner found: removing the write-through killed the
    // other two scope tests and not this one.
    rxNostr.setDefaultRelays([]);
    const scope = createRelayScope(rxNostr, [url]);

    expect(scope.hasDrifted()).toBe(false);

    rxNostr.setDefaultRelays([]);

    // The scope still says what it was told, the client says something else,
    // and every request keyed on the scope is now asking a question of relays
    // that are not there.
    expect(scope.current.id).toBe(JSON.stringify([url]));
    expect(scope.hasDrifted()).toBe(true);

    // **Emptying the client is the easiest drift to build and the weakest one
    // to hold.** A check that compared *how many* relays the client has would
    // pass every line above. So the same claim twice more, with a client that
    // is the same size as the scope and is not it:
    //
    // (a) a different relay, well-formed, one for one.
    const elsewhere = nextUrl();
    rxNostr.setDefaultRelays([elsewhere]);
    expect(scope.current.id, 'the scope has not moved').toBe(JSON.stringify([url]));
    expect(scope.hasDrifted(), 'one relay swapped for another is drift').toBe(true);

    // (b) the scope's own relay, at the same count, turned write-only. The
    // identity is the *readable* set (`SC7`), so a client that can no longer
    // answer a REQ for this scope has drifted even though the URL is still
    // there — and a comparison over URLs alone would call this agreement.
    rxNostr.setDefaultRelays([{ url, read: false, write: true }]);
    expect(Object.keys(rxNostr.getDefaultRelays()), 'the URL is still configured').toEqual([url]);
    expect(scope.hasDrifted(), 'readable is what the identity is over').toBe(true);

    // And the positive control the three of them need: put back exactly what
    // the scope was told, and the drift is gone. Without this, every assertion
    // above is satisfied by a check that always says `true`.
    rxNostr.setDefaultRelays([url]);
    expect(scope.hasDrifted(), 'and agreement is reachable').toBe(false);
  });

  it('SG10: two spellings of one relay are one relay, the way the client spells it', () => {
    // The duplicate rule below is only a rule about *the same relay* if the
    // same relay has one name here. rx-nostr normalizes a URL before it
    // connects and keys its own maps by the result, so two spellings reach the
    // client as one connection while reaching an un-normalized scope as two:
    // the identity splits a cache the connection does not, and the drift check
    // compares a list the client has rewritten against one it has not.
    const scope = createRelayScope(silent(), [
      'wss://h.example/',
      '  wss://h.example  ',
      'wss://h.example#fragment'
    ]);

    expect(scope.current.relays.map((relay) => relay.url)).toEqual(['wss://h.example']);
    expect(scope.current.id).toBe(JSON.stringify(['wss://h.example']));

    // And the conflict rule sees through the spelling too, rather than letting
    // a differently-written duplicate slip past it.
    expect(() =>
      createRelayScope(silent(), [
        { url: 'wss://h.example', read: true, write: false },
        { url: 'wss://h.example/', read: false, write: true }
      ])
    ).toThrow(InvalidRelayScopeError);
  });

  // @contracts B-α-C10
  it('SG15: this library’s transcription still agrees with one pass of the resolved client', () => {
    // `SC10` asserts `canonicalOnce`'s output as a written-out literal over a
    // stub, so it measures the transformation and not the agreement — and the
    // two had come apart. rx-nostr 3.7.5 decodes the query after sorting it and
    // this did not, so `?x=%7E` was one relay to the scope and another to the
    // client, which is `SEN25`'s corpus and the reason `SC16` reported a
    // healthy backlog as a timeout.
    //
    // **Both sides are taken in this one run.** A literal copied out of
    // `SEN25` would be a third transcription of the same transformation, and
    // the transcriptions are what drifted in the first place; a sentinel cannot
    // import `$lib` (`SEN0`), so the comparison has to happen here.
    //
    // **Its subject moved this round, and saying so is the point.** This used
    // to compare the *scope's* name against the transport's, and a scope takes
    // its names from the transport now (`TD1`) — so that comparison is true by
    // construction and could not fail whatever `canonicalUrl` did. What is
    // still a belief is `canonicalUrl` itself, which stays live on
    // `requestTargets`'s spike-only internal fallback, so that is what the
    // corpus is run against here.
    //
    // **The oracle is one application of the transport to the caller's string**
    // ({@link transportNames}), and nothing this library produced is on its
    // path. One round before that it compared against what the dependency
    // *settles* on — its own output fed back to a fresh client until it stopped
    // moving — which is an oracle built from the subject's own decision: the
    // library had started iterating, the expectation iterated too, and the two
    // agreed by construction. What that was hiding is that iterating changes
    // the route: `?x=%2526y=1` is one query parameter after one pass and two
    // after the next. `SC21` is that measurement.
    //
    // Every input in the corpus below is one the transport leaves alone after a
    // single application — the ones it does not are refused rather than
    // canonicalised, which is `SC21`'s subject and not this one's.
    const CORPUS = [
      'wss://h.example/?x=%7E',
      'wss://h.example/?x=%2F',
      'wss://h.example/?x=%20',
      'wss://h.example/?x=a%2Bb',
      'wss://h.example/?x=%zz',
      'wss://h.example/?b=2&a=1',
      'wss://h.example/?x=1#frag',
      'wss://h.example/',
      'wss://h.example',
      'wss://h.example#fragment',
      // One trailing hostname dot, which comes off in one pass and stays off.
      // Two do not: `h.example../` is `h.example.` after one pass, which is
      // `SC21`'s corpus and the counterexample to "the only unbounded shape is
      // a run of slashes".
      'wss://h.example./',
      'wss://h.example./?x=%7E',
      'wss://h.example/path/',
      'wss://h.example/%7Epath',
      'wss://h.example/%zz',
      // **A malformed escape beside something else the parse changes**, which
      // is what makes the path-decoding guard observable. `%zz` on its own
      // reaches it — `decodeURI('/%zz')` throws — and cannot separate the two
      // implementations: the outer `catch` hands back the trimmed input, and
      // the transport normalizes that same string to itself. Put a fragment or
      // a trailing hostname dot beside it and the two answers come apart, one
      // normalized and one raw. Measured: the sweep that puts a rethrow in
      // every `catch` left this arm green until these two rows existed.
      'wss://h.example/%zz#frag',
      'wss://h.example./%zz',
      // Up to two trailing slashes survive one pass: the path loses one and the
      // serialized string loses another when the query is empty. Three do not.
      'wss://h.example//',
      'wss://h.example//?a=1',
      'wss://h.example/path//',
      '  wss://h.example  ',
      // **Whitespace the URL parser keeps and `String.trim` removes.** `new URL`
      // strips only C0 controls and spaces, so a trailing no-break space parses
      // into the path as `%C2%A0`; the transport trims it first, and so must the
      // transcription. Before this row and the padded refusal below, the
      // transcription's own `trim` could be deleted and this arm stayed green,
      // because every surrounding space here was one the parser strips by
      // itself; either row alone now fails it.
      'wss://h.example/\u00A0'
    ];

    /**
     * Members that live in the transcription's domain and not in a scope's.
     *
     * rx-nostr names `'not a url at all'` and `''` after themselves, and the
     * first with surrounding spaces after the trimmed string — the one `trim`
     * both branches share, reached here on the branch where the parse fails — so
     * `canonicalUrl` has to agree with it about them or the scope-less fallback
     * would carry a spelling the client does not. But none is a relay URL, and
     * `checkedRelayInput` refuses all three at the entrance, so they cannot
     * reach a scope to be compared through one.
     *
     * Split out rather than dropped: leaving them in the main corpus would have
     * meant the transcription stopped being measured on the two inputs where
     * the dependency's own error handling is doing the work.
     */
    const REFUSED_AT_THE_ENTRANCE = ['not a url at all', '', ' not a url at all '];

    const ours: string[] = [];
    const theirs: string[] = [];
    const throughTheScope: string[] = [];
    for (const input of CORPUS) {
      // The transport's answer to the caller's string, taken first and from a
      // client that has never seen anything of ours.
      theirs.push(transportNames(input));

      // This library's own copy of the transformation — the one still used by
      // the scope-less fallback, and the one nothing but this test checks.
      ours.push(canonicalUrl(input));

      // A client each: several of these normalize onto one key, and one client
      // would merge them into a single entry.
      const written = bareClient();
      createRelayScope(written, [input]);
      throughTheScope.push(keyOfClient(written));
      written.dispose();
    }

    // Not vacuous: the corpus has to have reached both sides, or two empty
    // lists would agree. Every entry of it, so a case silently dropped is a
    // failure here rather than a hole in the comparison.
    expect(ours).toHaveLength(CORPUS.length);
    expect(ours.some((url) => url.includes('~'))).toBe(true);
    // And the transport is not an identity function over this corpus, or
    // "we agree with it" would be satisfied by taking the input as written.
    expect(theirs).not.toEqual(CORPUS);

    // **The property.** What this library's transcription calls a relay is what
    // the transport calls the relay the caller asked for — one application, to
    // the caller's own string. The scope no longer rests on this; the
    // scope-less fallback still does, and a consumer's rx-nostr can still make
    // it false without anything here noticing (`TD1` is the arm that survives
    // that, and it survives it by not consulting this function at all).
    expect(ours).toEqual(theirs);

    // And what the *client* ends up connected to, once the scope has written a
    // generation through. Over this corpus it agrees with both columns; it is
    // asserted separately because it is the only one of the three taken from a
    // client the scope configured, so a scope that named relays correctly and
    // wrote something else through would fail here and nowhere else.
    expect(throughTheScope).toEqual(ours);

    // **The two the transcription still covers and a scope will not take.** The
    // transport names them — that is the first pair of assertions, and it is
    // why they are in the transcription's corpus at all — and the entrance
    // refuses them anyway, because being nameable is not being a relay.
    for (const input of REFUSED_AT_THE_ENTRANCE) {
      expect(canonicalUrl(input)).toBe(transportNames(input));
      const written = bareClient();
      expect(() => createRelayScope(written, [input])).toThrow(InvalidRelayInputError);
      written.dispose();
    }
  });

  it('SG21: a relay the transport would rename twice is refused, with nothing opened under either name', () => {
    // The decision `SC15` used to hide. `normalizeRelayUrl` is not idempotent,
    // and the library writes its own output back to the client — so for these
    // inputs the name the scope, the cache key and the machine's backward table
    // use is *not* the connection that answers under it. There are two ways
    // out and only one of them is a v1 decision: converge, and the library
    // picks a relay the caller did not write; refuse, and the caller is told.
    //
    // What makes converging a route change rather than a spelling change is
    // measured below on `?x=%2526y=1`: one pass leaves one query parameter and
    // the next leaves two. A relay that authenticates, tenants or routes on its
    // query reads those as different requests.
    const HOSTILE = [
      // A doubly-escaped query, and the same escape in a path.
      'wss://h.example/?x=%257E',
      'wss://h.example/%257Epath',
      // The one that changes the query's shape.
      'wss://h.example/?x=%2526y=1',
      // Three trailing slashes. Two are accepted (`SC15`), so this is the first
      // member of the slash-shaped class rather than an arbitrary one.
      'wss://h.example///?a=1',
      'wss://h.example///',
      // And the shape that is not slashes at all: trailing hostname dots also
      // come off one per pass.
      'wss://h.example../?x=%7E'
    ];

    for (const input of HOSTILE) {
      // The premise, from the resolved client: one application does not settle
      // this URL. Without this the refusal below would be a rule about nothing.
      //
      // **This used to be a check on the implementation as well as a premise,
      // and it is only a premise now.** The refusal was `canonicalOnce`'s, so
      // taking the premise from the transport measured that our copy and the
      // transport agreed about *which* URLs are unstable. The refusal is the
      // transport's own answer since r31, so these two lines and the
      // implementation are now the same computation — what the assertions
      // below still discriminate is converging versus refusing, and writing
      // through versus not.
      const once = transportNames(input);
      const twice = transportNames(once);
      expect(twice).not.toBe(once);

      const client = bareClient();
      expect(() => createRelayScope(client, [input])).toThrow(NonIdempotentRelayUrlError);

      // **Refused before anything is opened, named or configured under it.**
      // This is the discriminating observation: an implementation that wrote
      // the list through and *then* noticed would leave a relay in both of
      // these. `setDefaultRelays` populates the status map at the moment it is
      // called (`RD6`), so an empty status map is the absence of that call.
      expect(client.getDefaultRelays()).toEqual({});
      expect(client.getAllRelayStatus()).toEqual({});
      client.dispose();
    }

    // The query-shape claim, measured rather than asserted in prose. The fixed
    // point is not a tidier spelling of the same request.
    const shapeOf = (url: string): number => [...new URL(url).searchParams].length;
    const onePass = transportNames('wss://h.example/?x=%2526y=1');
    expect(shapeOf(onePass)).toBe(1);
    expect(shapeOf(transportNames(onePass))).toBe(2);

    // **The control.** Without it, "it refuses" is satisfied by an
    // implementation that refuses everything, and the two empty maps above
    // would be the empty maps of a scope that never works. `?x=%7E` is
    // non-canonical in exactly the way the hostile inputs are — the transport
    // renames it — and differs only in that the new name is one the transport
    // leaves alone.
    const accepted = bareClient();
    const scope = createRelayScope(accepted, ['wss://h.example/?x=%7E']);
    expect(scope.current.urls).toEqual(['wss://h.example/?x=~']);
    expect(Object.keys(accepted.getAllRelayStatus())).toEqual(['wss://h.example/?x=~']);
    expect(Object.keys(accepted.getDefaultRelays())).toEqual(['wss://h.example/?x=~']);
    accepted.dispose();
  });

  it('SG23: a refused relay in an update leaves the previous generation and the client alone', () => {
    // The other half of `SC21`. A provider's relay list can change after
    // construction, so checking only the first one leaves every later
    // generation unchecked — and a refusal that has already written half of
    // itself through is worse than no refusal, because the client is then
    // pointing at relays no scope names.
    //
    // What is observed is the pair that decides it: the scope value the
    // requests are keyed under, by identity rather than by equality (a new
    // object with the same contents is a new cache generation, B-α), and the
    // client's own list.
    const client = bareClient();
    const scope = createRelayScope(client, ['wss://a.example']);
    const before = scope.current;
    const clientBefore = Object.keys(client.getDefaultRelays());

    expect(() => scope.setRelays(['wss://a.example', 'wss://b.example///?a=1'])).toThrow(
      NonIdempotentRelayUrlError
    );

    // Not `toEqual`: the same object, so every request already keyed on this
    // generation stays keyed on it and nothing is re-asked.
    expect(scope.current).toBe(before);
    expect(Object.keys(client.getDefaultRelays())).toEqual(clientBefore);
    // And the relay that *was* acceptable in the refused list did not land
    // either — the update is one act, not a per-entry loop that stops.
    expect(Object.keys(client.getDefaultRelays())).not.toContain('wss://b.example');

    // The control: the same update with the same second relay spelled so the
    // transport leaves it alone does move both.
    scope.setRelays(['wss://a.example', 'wss://b.example//']);
    expect(scope.current).not.toBe(before);
    expect(scope.current.urls).toEqual(['wss://a.example', 'wss://b.example']);
    expect(Object.keys(client.getDefaultRelays()).sort()).toEqual([
      'wss://a.example',
      'wss://b.example'
    ]);

    client.dispose();
  });

  // @contracts B-α-C5
  it('SG7: the identity separates scopes a joined string would merge', () => {
    // `urls.join(',')` is not injective. These two readable sets produce the
    // same string under it, so two different scopes shared a cache key — data
    // fetched under one relay set served under another, which is the falsifier
    // B3 is written against.
    // Commas inside a path, so the two sets survive canonicalization and still
    // collide under a joined string.
    const x = 'wss://h.example/x';
    const y = 'wss://h.example/y';
    const z = 'wss://h.example/z';
    const a = createRelayScope(silent(), [x, `${y},${z}`]);
    const b = createRelayScope(silent(), [`${x},${y}`, z]);

    expect(a.current.urls.join(',')).toBe(b.current.urls.join(','));
    expect(a.current.id).not.toBe(b.current.id);
  });

  it('SG8: a repeated relay is deduplicated, and a contradicted one is refused', () => {
    const url = 'wss://dup.example';
    // The same thing said twice is a spelling.
    expect(() =>
      createRelayScope(silent(), [
        { url, read: true, write: false },
        { url, read: true, write: false }
      ])
    ).not.toThrow();

    // Two different things said about one relay is not, and the obvious repair
    // is the dangerous one: OR-ing these produces a relay that is both read and
    // write, which neither entry asked for.
    expect(() =>
      createRelayScope(silent(), [
        { url, read: false, write: true },
        { url, read: true, write: false }
      ])
    ).toThrow(InvalidRelayScopeError);
    // And it does not depend on which was written first.
    expect(() =>
      createRelayScope(silent(), [
        { url, read: true, write: false },
        { url, read: false, write: true }
      ])
    ).toThrow(InvalidRelayScopeError);
  });

  it('SG9: a caller mutating the config they passed does not move the scope', () => {
    // B-α says the scope is immutable per generation. An object the caller
    // still holds is not: flipping `read` after the identity is computed would
    // make the scope and the connection disagree about which relays are in use.
    //
    // What this establishes is that it does not happen. The spike's version
    // of this comment said the arm passed with the copy removed from
    // `configOf`, because the scope lived in `$state` and Svelte does not hand
    // back the object it was given. That does not reproduce here: with both
    // copies removed — `checkedRelayInput`'s and `scopeOf`'s — this arm fails
    // under `$state` and `$state.raw` alike, because the freeze reaches the
    // caller's object and the write below throws. Either copy alone is enough.
    const config = { url: 'wss://mut.example', read: true, write: false };
    const scope = createRelayScope(silent(), [config]);
    const before = scope.current.id;

    config.read = false;
    config.url = 'wss://elsewhere.example';

    expect(scope.current.id).toBe(before);
    expect(scope.current.relays[0]).toEqual({
      url: 'wss://mut.example',
      read: true,
      write: false
    });
  });

  // @contracts B-α-C28
  it('SG31: the scope a request is keyed under is frozen, all the way down', () => {
    // **`0003` and `0004` both call it "the immutable `RelayScope`" and nothing
    // read it.** B-α's whole shape rests on the value being immutable per
    // generation: it is what every request is keyed under, what the diagnostics
    // are built from, and what a consumer is handed as the membership they can
    // depend on. A port that shipped a mutable one would break the key's
    // stability and nothing in this suite would notice — measured, the promise
    // was written twice in prose and asserted nowhere.
    //
    // Four levels, because freezing the top of an object graph is the mistake
    // this repository has made before: the value, its relay list, the urls it
    // publishes, and each relay entry.
    const { rxNostr } = createTestRelay(nextUrl());
    const scope = createRelayScope(rxNostr, [
      'wss://a.example',
      { url: 'wss://b.example', read: false, write: true }
    ]);
    const value = scope.current;

    expect(Object.isFrozen(value), 'the scope value').toBe(true);
    expect(Object.isFrozen(value.relays), 'its relay list').toBe(true);
    expect(Object.isFrozen(value.urls), 'the urls it publishes').toBe(true);
    for (const [at, relay] of value.relays.entries()) {
      expect(Object.isFrozen(relay), `relay ${at}`).toBe(true);
    }

    // **And the reading that `isFrozen` cannot do on its own**: a write through
    // the published value is refused rather than silently dropped. Module code
    // is strict, so the assignment throws — which is the behaviour a consumer
    // meets, and the half a `isFrozen` check would pass without.
    expect(() => {
      (value.relays as unknown as { length: number }).length = 0;
    }).toThrow(TypeError);
    expect(value.relays).toHaveLength(2);
  });

  // @contracts B-α-C1
  it('SG1: the same relays in any order are the same scope', () => {
    const { rxNostr } = createTestRelay(nextUrl());
    const a = createRelayScope(rxNostr, ['wss://b.example', 'wss://a.example']);
    const b = createRelayScope(rxNostr, ['wss://a.example', 'wss://b.example', 'wss://a.example']);

    // A user cannot see the order they wrote their relay list in, so a key that
    // could would split the cache for a difference that is not one.
    expect(a.current.id).toBe(b.current.id);
    expect(a.current.urls).toEqual(['wss://a.example', 'wss://b.example']);
  });

  // @contracts B3-C1
  it('SG2: the scope is what separates two otherwise identical requests', () => {
    const one = keyOf({
      filters: [{ kinds: [1] }],
      live: false,
      scopeGeneration: 'wss://a.example'
    });
    const two = keyOf({
      filters: [{ kinds: [1] }],
      live: false,
      scopeGeneration: 'wss://a.example,wss://b.example'
    });

    // The same question asked of different relays can get different answers, so
    // it is a different request. This is the field having a meaning at last.
    expect(one).not.toBe(two);
  });

  it('SG3: setting the same relays again changes nothing', () => {
    const { rxNostr } = createTestRelay(nextUrl());
    const scope = createRelayScope(rxNostr, ['wss://a.example']);
    const before = scope.current;

    scope.setRelays(['wss://a.example']);

    // Identity, not just equality: a new object would be a new key, and every
    // request keyed on it would go out again. B-ζ is the measurement of what
    // that costs.
    expect(scope.current).toBe(before);
  });

  it('SG29: a provider’s own accepted relay update starts the request waiting under it', async () => {
    // **`SC4` is this without a provider, and that gap let a regression
    // through.** That arm hands the hook a scope of its own and moves it; the
    // *published* arrangement is a provider whose `setRelays()` is accepted,
    // and nothing was driving it. When the request's inputs became a bundle the
    // provider mints, the scope was read into that bundle once — so the hook
    // went on reading the list the provider had at construction, and an outside
    // reviewer measured a provider that starts empty, is given a relay through
    // its own published call, and asks nobody: 0 REQs before, 0 after. The
    // bundle's *shape* is frozen; what each field answers is live.
    const url = nextUrl();
    const { server } = createTestRelay(url);
    const mounted = mount(() => {
      const context = createNostrContext({
        relays: [],
        environment: 'browser',
        verifyEvent: acceptAnyEvent,
        harness: HARNESS_DIVERGENCES
      });
      setNostrContext(context);

      return {
        context,
        // Nothing brought: the provider owns every input, which is the
        // arrangement `0004`'s five-field descriptor produces.
        handle: useStreamedReq(() => ({
          namespace: 'sc29',
          filters: [{ kinds: [1] }],
          reqIdBase: 'sc29',
          staleTime: 0,
          settleTimeoutMs: 120
        }))
      };
    });

    await settle(200);
    // The control: with no relay in the provider's scope there is nowhere to
    // ask, and the request says so rather than failing.
    expect(mounted.value.handle.state.status, 'nowhere to ask yet').toBe('loading');
    expect(reqs(server), 'and nobody has been asked').toEqual([]);

    mounted.value.context.setRelays([url]);
    flush();
    for (let index = 0; index < 100 && reqs(server).length === 0; index += 1) await settle(10);

    expect(reqs(server).length, 'the accepted update starts it').toBeGreaterThan(0);
    const sub = String(reqs(server)[0]?.[1]);
    respondWithEvent(server, sub, fakeEvent({ id: 'sc29-a' }));
    respondWithEose(server, sub);
    await settle(150);
    expect(mounted.value.handle.state.status, 'and it settles on the new relay').toBe('settled');

    mounted.destroy();
  });

  it('SG30: a provider’s refused relay update leaves the request where it was', async () => {
    // The other edge, and the one that says `SC29` is not simply "any call to
    // `setRelays` re-asks". A list the boundary refuses keeps the generation in
    // force — `C16-C2` says the previous scope and client survive it — so a
    // request that had settled is not re-asked and no second REQ goes out.
    //
    // **This arm has no mutation aimed at it and the ledger says why**: it
    // reads an absence, and an absence is what a *removed* path produces rather
    // than what a removal breaks. Measured while looking for one — with the
    // scheme check disabled, neither a non-URL nor an `http:` list moved the
    // generation, because three gates stand in front of the one it drives.
    const url = nextUrl();
    const { server } = createTestRelay(url);
    const mounted = mount(() => {
      const context = createNostrContext({
        relays: [url],
        environment: 'browser',
        verifyEvent: acceptAnyEvent,
        harness: HARNESS_DIVERGENCES
      });
      setNostrContext(context);

      return {
        context,
        handle: useStreamedReq(() => ({
          namespace: 'sc30',
          filters: [{ kinds: [1] }],
          reqIdBase: 'sc30',
          staleTime: 0,
          settleTimeoutMs: 120
        }))
      };
    });

    for (let index = 0; index < 100 && reqs(server).length === 0; index += 1) await settle(10);
    const sub = String(reqs(server)[0]?.[1]);
    respondWithEvent(server, sub, fakeEvent({ id: 'sc30-a' }));
    respondWithEose(server, sub);
    await settle(150);
    expect(mounted.value.handle.state.status, 'settled on the accepted list').toBe('settled');
    const asked = reqs(server).length;
    const generation = mounted.value.context.scope.id;

    // A URL that parses and carries the wrong scheme, rather than a string that
    // is not a URL at all: the second is refused one step earlier, so this arm
    // would be measuring the earlier step. `setRelays` does not throw for a
    // refusal — `C16-C2` — so it is published beside the map and the scope in
    // force stands. An **empty** list is not a refusal either: it is accepted,
    // and the request then has nowhere to ask.
    mounted.value.context.setRelays(['http://localhost:9999']);
    flush();
    await settle(300);

    expect(mounted.value.context.scope.id, 'the generation in force is the old one').toBe(
      generation
    );
    expect(reqs(server).length, 'and nothing was re-asked').toBe(asked);
    expect(mounted.value.handle.state.status, 'the request is where it was').toBe('settled');

    mounted.destroy();
  });

  // @contracts B-α-C26
  it('SG4: a request with nowhere to ask recovers when the scope gains a relay', async () => {
    // The point of the whole decision. Compare P19c, which is this without an
    // owned scope: there, the request stays `loading` forever.
    const url = nextUrl();
    const { rxNostr, server } = createTestRelay(url);
    const scope = createRelayScope(rxNostr, []);
    const { value: handle, destroy } = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        // Reading the scope is what makes this reactive. It used to be read into
        // the caller's `queryKey`, because the key was the caller's; the engine
        // derives its key from the descriptor now, and the scope is one of the
        // descriptor's inputs (B3), so passing it is both the reactivity and the
        // identity.
        scope: scope.current,
        client: queryClient,
        namespace: 's4',
        filters: [{ kinds: [1] }],
        reqIdBase: 's4',
        staleTime: 0,
        settleTimeoutMs: 120
      }))
    );

    await settle(300);
    expect(handle.state.status).toBe('loading');
    expect(reqs(server)).toEqual([]);

    scope.setRelays([url]);
    flush();

    for (let i = 0; i < 100 && reqs(server).length === 0; i += 1) await settle(10);
    const sub = String(reqs(server)[0]?.[1]);
    respondWithEvent(server, sub, fakeEvent({ id: 's4-a' }));
    respondWithEose(server, sub);
    await settle(150);

    expect(handle.state.status).toBe('settled');

    destroy();
  });

  it('SG5: dropping a relay is a different question, not the same one re-asked', async () => {
    const urlA = nextUrl();
    const urlB = nextUrl();
    const { rxNostr, server: a } = createTestRelay(urlA);
    const b = new WS(urlB, { jsonProtocol: true });
    const scope = createRelayScope(rxNostr, [urlA, urlB]);
    const { value: handle, destroy } = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: scope.current,
        client: queryClient,
        namespace: 's5',
        filters: [{ kinds: [1] }],
        reqIdBase: 's5',
        staleTime: 0,
        settleTimeoutMs: 120
      }))
    );

    // Both relays, not just the first: reading the second's REQ before it has
    // arrived made this pass or fail on timing, which the mutation runner found
    // by killing it once and not the next time.
    for (let i = 0; i < 100 && (reqs(a).length === 0 || reqs(b).length === 0); i += 1) {
      await settle(10);
    }
    const first = String(reqs(a)[0]?.[1]);
    respondWithEvent(a, first, fakeEvent({ id: 's5-a' }));
    respondWithEose(a, first);
    respondWithEose(b, String(reqs(b)[0]?.[1]));
    await settle(200);
    expect(handle.state.status).toBe('settled');

    scope.setRelays([urlA]);
    flush();
    await settle(200);

    // A narrower relay set can only give a narrower answer, so serving the
    // previous one under the new scope would be reporting events from a relay
    // the caller has just removed. A new key means it is asked again.
    expect(reqs(a).length).toBeGreaterThan(1);

    destroy();
  });

  it('SG27: the scope a request is handed refuses a write, at every container', () => {
    // **Three records said this and the code did one third of it.** The
    // submission wrote "`scope`（配列・entry・spelling map すべて凍結。実測）",
    // and `WR26`/`WR27` classify the member as `frozen` with "(measured)" beside
    // it. An outside reviewer measured it: only the spelling map was frozen.
    // `relays[0].read = false` took and `urls.push(…)` took — on the object
    // `stream.ts` hands the request path as the relays a request is for, and
    // which outlives any one request.
    //
    // The population is every container the snapshot has, because "frozen
    // through" is a claim about all of them and the record's own wording
    // enumerates three.
    const scope = createRelayScope(silent(), [
      'wss://a.example',
      { url: 'wss://b.example', read: true, write: false }
    ]).current;

    // Not vacuous: the snapshot has entries in each container, so a refusal is
    // not "there was nothing to write to".
    expect(scope.relays.length, 'the scope has relays').toBeGreaterThan(1);
    expect(scope.urls.length, 'and readable urls').toBeGreaterThan(1);
    expect(Object.keys(scope.configuredUrls).length, 'and spellings').toBeGreaterThan(0);

    const refused: Record<string, boolean> = {};
    const tried = (name: string, write: () => void): void => {
      try {
        write();
        refused[name] = false;
      } catch {
        refused[name] = true;
      }
    };
    tried('the snapshot itself', () => {
      (scope as unknown as { id: string }).id = 'rewritten';
    });
    tried('the relay list', () => {
      (scope.relays as RelayConfig[]).push({
        url: 'wss://injected.example/',
        read: true,
        write: true
      });
    });
    tried('a relay entry', () => {
      (scope.relays[0] as { read: boolean }).read = false;
    });
    tried('the readable urls', () => {
      (scope.urls as string[]).push('wss://injected.example/');
    });
    tried('the spelling map', () => {
      (scope.configuredUrls as Record<string, readonly string[]>)['wss://a.example/'] = [];
    });

    expect(
      Object.entries(refused)
        .filter(([, one]) => !one)
        .map(([name]) => name),
      'every container of the scope refuses a write'
    ).toEqual([]);
    // And the effect, which is what the request path depends on: nothing moved.
    expect(scope.urls.includes('wss://injected.example/'), 'and nothing was added').toBe(false);
    expect(scope.relays[0]?.read, 'and nothing was rewritten').toBe(true);
  });

  it('SG25: a relay nobody can read is not part of the question, and one that becomes unreadable is', async () => {
    // **The behaviour held by a mutation entry and by nothing a port inherits.**
    // `identityOf` runs over `RelayScope.urls` — the *readable* set — so a
    // write-only relay is outside the cache key on purpose: it cannot answer a
    // `REQ`, and splitting the cache over it would re-ask every question for
    // nothing. That was recorded in a decision, asserted by `SC0` against the
    // literal spelling of the id, and obliged by no contract row: a port that
    // keyed on the whole scope would break nothing rostered.
    //
    // **Four legs, because two were not enough and a reviewer measured which
    // implementations walked between them.** With edges (1) and (2) alone, an
    // implementation keyed on the *number* of readable relays passes both — 2→2
    // then 2→1 — and so does one keyed on the readable urls **plus their write
    // flags**, which re-asks every question whenever a consumer flips a flag on
    // a relay that stays readable. Both were run; only `SC0`, `SC6` and `SC10`,
    // the arms that read the id's spelling, died. So (3) flips `write` on a
    // readable relay, which must change nothing, and (4) swaps one readable
    // relay for another, which must change everything.
    //
    // It is read through the operation rather than through the id: what a
    // consumer can see is whether the question is asked again.
    const urlA = nextUrl();
    const urlB = nextUrl();
    const urlC = nextUrl();
    const { rxNostr, server: a } = createTestRelay(urlA);
    const b = new WS(urlB, { jsonProtocol: true });
    // Never connected to: a write-only relay is not asked, and the socket
    // exists so that "no REQ arrived here" is a measurement rather than an
    // absent server.
    const c = new WS(urlC, { jsonProtocol: true });
    const scope = createRelayScope(rxNostr, [urlA, urlB]);
    const { value: handle, destroy } = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: scope.current,
        client: queryClient,
        namespace: 's24',
        filters: [{ kinds: [1] }],
        reqIdBase: 's24',
        staleTime: 0,
        settleTimeoutMs: 120
      }))
    );

    for (let i = 0; i < 100 && (reqs(a).length === 0 || reqs(b).length === 0); i += 1) {
      await settle(10);
    }
    const first = String(reqs(a)[0]?.[1]);
    respondWithEvent(a, first, fakeEvent({ id: 's24-a' }));
    respondWithEose(a, first);
    respondWithEose(b, String(reqs(b)[0]?.[1]));
    await settle(200);
    expect(handle.state.status).toBe('settled');
    const asked = { a: reqs(a).length, b: reqs(b).length };

    // (1) A write-only relay joins the scope. Nothing a request can be told has
    // changed, so nothing is asked again — and the relay itself is never asked
    // anything, which is the reason the identity may leave it out.
    scope.setRelays([urlA, urlB, { url: urlC, read: false, write: true }]);
    flush();
    await settle(200);
    expect(reqs(a).length, 'no relay is asked again for a relay that cannot answer').toBe(asked.a);
    expect(reqs(b).length).toBe(asked.b);
    // Never asked while it is write-only — and leg (4) below is what makes
    // this line more than "no REQ was sent anywhere just now": the same relay
    // *is* asked once it becomes readable.
    expect(reqs(c), 'and the write-only relay is not asked at all').toEqual([]);
    expect(handle.state.status).toBe('settled');

    // (2) The other edge: a relay that *was* readable is made write-only. The
    // readable set is genuinely smaller now — the same narrowing `SC5` makes by
    // dropping a relay outright — so the question is a different one and is
    // asked again. Without this, an implementation that keys on nothing at all
    // passes (1).
    scope.setRelays([{ url: urlA, read: false, write: true }, urlB]);
    flush();
    await settle(200);
    expect(reqs(b).length, 'a narrower readable set is a new question').toBeGreaterThan(asked.b);
    expect(reqs(a).length, 'and the relay that lost its read flag is not asked again').toBe(
      asked.a
    );
    const afterNarrowing = { a: reqs(a).length, b: reqs(b).length };

    // (3) A `write` flag flipped on a relay that **stays readable**. Nothing a
    // request can be told has changed, so nothing is asked again — and an
    // identity that carries the write flags of readable relays re-asks here
    // while passing (1) and (2).
    scope.setRelays([
      { url: urlA, read: false, write: true },
      { url: urlB, read: true, write: false }
    ]);
    flush();
    await settle(200);
    expect(reqs(b).length, 'a write flag is not part of the question').toBe(afterNarrowing.b);
    expect(reqs(a).length).toBe(afterNarrowing.a);

    // (4) One readable relay swapped for another — same count, different set.
    // An identity keyed on how *many* relays are readable passes every leg above
    // and fails here.
    scope.setRelays([
      { url: urlA, read: false, write: true },
      { url: urlC, read: true, write: true }
    ]);
    flush();
    await settle(250);
    expect(reqs(c).length, 'a different readable set is a different question').toBeGreaterThan(0);

    destroy();
  });

  // @contracts B-α-C27
  it('SG26: a change that only moves capabilities is still adopted, and reaches the client', async () => {
    // **The conjunct nothing was reading.** `setRelays` returns early when the
    // identity is unchanged *and* the capabilities are unchanged; a reviewer
    // dropped the second half — `if (next.id === scope.id)` alone — and ran the
    // whole suite: nothing behavioural failed. What that mutant does is throw
    // away every capability-only update. A consumer who adds a relay in order to
    // **publish** to it, or who takes a relay's write flag away, is told nothing
    // and the transport never hears about it: `scope.current.relays` keeps the
    // old flags and `getDefaultRelays()` keeps the old set.
    //
    // The identity is deliberately blind to those changes (`B-α-C22`, `SC25`),
    // which is exactly why the *other* half of the conjunct has to be witnessed:
    // the two clauses cover different halves of the same update.
    const urlA = nextUrl();
    const urlB = nextUrl();
    const { rxNostr } = createTestRelay(urlA);
    const scope = createRelayScope(rxNostr, [urlA]);
    expect(scope.current.relays).toEqual([{ url: urlA, read: true, write: true }]);

    // (1) A relay added for writing only. The identity does not move — that is
    // `SC25` — and everything else must.
    const before = scope.current.id;
    scope.setRelays([urlA, { url: urlB, read: false, write: true }]);
    expect(scope.current.id, 'the identity is blind to it, by design').toBe(before);
    expect(scope.current.relays, 'the published scope is not').toEqual([
      { url: urlA, read: true, write: true },
      { url: urlB, read: false, write: true }
    ]);
    expect(
      rxNostr.getDefaultRelays()[urlB],
      'and the transport hears about the relay they added to publish to'
    ).toMatchObject({ read: false, write: true });

    // (2) And the other direction: a write flag taken away from a relay that
    // stays readable. Same identity, same set of urls, different capability.
    scope.setRelays([
      { url: urlA, read: true, write: false },
      { url: urlB, read: false, write: true }
    ]);
    expect(scope.current.id).toBe(before);
    expect(scope.current.relays[0]).toEqual({ url: urlA, read: true, write: false });
    expect(rxNostr.getDefaultRelays()[urlA]).toMatchObject({ read: true, write: false });

    // (3) **One write-only relay swapped for another** — same identity (neither
    // is readable), same count, same flags, different relay. A `sameConfig` that
    // compares lengths and flags but not urls calls that "the same", and then
    // the published scope names the relay the consumer just added while the
    // transport still holds the one they removed: a counterexample a reviewer
    // built, with the whole suite green.
    const urlC = nextUrl();
    scope.setRelays([
      { url: urlA, read: true, write: false },
      { url: urlC, read: false, write: true }
    ]);
    expect(scope.current.relays.map((relay) => relay.url).sort()).toEqual([urlA, urlC].sort());
    expect(
      Object.keys(rxNostr.getDefaultRelays()).sort(),
      'the transport publishes where the consumer said, not where they used to'
    ).toEqual([urlA, urlC].sort());

    // (4) **And the direction the other three cannot reach: the list gets
    // shorter.** `sameConfig` opens with a length comparison, and dropping it
    // left the whole spike suite green — because `every` walks the *new* list,
    // and a new list that is a prefix of the old one passes every element it
    // has. A consumer who removes a write-only relay would be answered with
    // silence: same identity, "same config", early return, and the relay they
    // deleted still published on `scope.current.relays` and still on the
    // client. The three legs above all lengthen or hold the length.
    scope.setRelays([{ url: urlA, read: true, write: false }]);
    expect(
      scope.current.relays.map((relay) => relay.url),
      'a relay the consumer removed is gone from the published scope'
    ).toEqual([urlA]);
    expect(Object.keys(rxNostr.getDefaultRelays()), 'and gone from the client').toEqual([urlA]);

    // **The control**: a re-set that changes nothing at all is still a no-op, so
    // the legs above are about capability changes rather than about the early
    // return being gone. It discriminates nothing on its own — what makes it a
    // control is that the generation moved first.
    const generation = scope.current;
    scope.setRelays([{ url: urlA, read: true, write: false }]);
    expect(scope.current, 'the same relays twice is still one generation').toBe(generation);
  });

  // @contracts B3-C2
  it('SG11: two scopes do not share an entry, with no help from the caller', async () => {
    // B3 on the path, which it was not. `canonicalKey` has honoured the scope
    // generation since B1 while each engine passed a literal naming itself, so
    // the field carried nothing about relays — and this engine took its key from
    // its caller (findings F7), which is what SC4 and SC5 above do by hand. Between them, "the readable relay set is part of
    // cache identity" was a decision, a unit test and a convention that a caller
    // had to remember. Here the caller does not remember: the key is what
    // somebody who has never heard of a relay scope would write.
    //
    // Two clients as well as two scopes, because that is the situation — a
    // second provider is a second connection — and it makes the falsifier
    // sharp: the answer below reached the cache from a relay the second request
    // cannot even talk to.
    const urlA = nextUrl();
    const urlB = nextUrl();
    const { rxNostr: clientA, server: serverA } = createTestRelay(urlA);
    const { rxNostr: clientB, server: serverB } = createTestRelay(urlB);
    const scopeA = createRelayScope(clientA, [urlA]);
    const scopeB = createRelayScope(clientB, [urlB]);

    const first = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr: clientA,
        scope: scopeA.current,
        client: queryClient,
        namespace: 'sc11',
        filters: [{ kinds: [1] }],
        reqIdBase: 'sc11a',
        staleTime: 0,
        settleTimeoutMs: 120
      }))
    );

    for (let i = 0; i < 100 && reqs(serverA).length === 0; i += 1) await settle(10);
    const sub = String(reqs(serverA)[0]?.[1]);
    respondWithEvent(serverA, sub, fakeEvent({ id: 'sc11-a' }));
    respondWithEose(serverA, sub);
    await settle(200);
    expect(first.value.state.status).toBe('settled');

    const second = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr: clientB,
        scope: scopeB.current,
        client: queryClient,
        namespace: 'sc11',
        filters: [{ kinds: [1] }],
        reqIdBase: 'sc11b',
        staleTime: 0,
        settleTimeoutMs: 120
      }))
    );
    await settle(60);

    // Read before the second request has an answer of its own, which is the
    // only window in which the two are distinguishable: sharing the entry hands
    // it the first one's settled list on the first paint, and then it goes and
    // fetches too, so the wire alone cannot tell them apart.
    expect(first.value.state.status).toBe('settled');
    expect(second.value.state.status).toBe('loading');

    // And it asked its own relay rather than being answered by the other's.
    for (let i = 0; i < 100 && reqs(serverB).length === 0; i += 1) await settle(10);
    expect(reqs(serverB).length).toBeGreaterThan(0);

    first.destroy();
    second.destroy();
  });

  it('SG12: a new scope is a new question, and the old answer is not re-served', async () => {
    // The other half of the same wiring. `canonicalKey` has honoured the scope
    // generation since B1 while each engine passed a literal naming itself, so
    // the field carried nothing about relays: with the literal in place the two
    // descriptors below were the same descriptor, and the events accumulated
    // under one relay set were handed back as the answer under another. That is
    // B3's falsifier written out, and it is P16 with the scope as the axis
    // instead of the filters.
    //
    // **It used to be written on the second engine**, on the reasoning that only
    // that one derived its key from the descriptor. The reasoning went stale the
    // round this one stopped taking a `queryKey` from its caller, and the engine
    // it named is deleted — so the expectation moved here rather than leaving B3
    // one witness short. SC11 is the same field observed across two clients;
    // this is it observed across two generations of one.
    const urlA = nextUrl();
    const urlB = nextUrl();
    const { rxNostr, server: a } = createTestRelay(urlA);
    const b = new WS(urlB, { jsonProtocol: true });
    const scope = createRelayScope(rxNostr, [urlA]);
    const { value: handle, destroy } = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: scope.current,
        client: queryClient,
        namespace: 'sc12',
        filters: [{ kinds: [1] }],
        reqIdBase: 'sc12',
        staleTime: 0,
        settleTimeoutMs: 120
      }))
    );

    for (let i = 0; i < 100 && reqs(a).length === 0; i += 1) await settle(10);
    const sub = String(reqs(a)[0]?.[1]);
    respondWithEvent(a, sub, fakeEvent({ id: 'sc12-a' }));
    respondWithEose(a, sub);
    await settle(200);
    expect(idsOf(handle)).toEqual(['sc12-a']);

    // A wider relay set is a different question — the same filters asked of
    // relays that were not asked before. Nothing about the previous answer is
    // part of this one, and on an engine with a cache that is the sharp form of
    // it: the narrower scope's entry is still in the cache and is not what this
    // handle reads.
    scope.setRelays([urlA, urlB]);
    flush();
    await settle(400);

    expect(reqs(b).length).toBeGreaterThan(0);
    expect(idsOf(handle)).toEqual([]);

    destroy();
  });

  // @contracts B3-C4
  it('SG13: the client moving to another scope does not move where a keyed request is asked', async () => {
    // The counterexample SC11 and SC12 cannot produce: there the scope and the
    // client agree, so a request that read either would look the same. Here they
    // disagree in the one window that matters — after the key is fixed and
    // before the request goes out.
    //
    // What was wrong: the key carried the scope while three other things read
    // the client. The plan counted `getDefaultRelays()`, the machine built its
    // per-relay table from it when the stream started, and the REQ named no
    // relays at all, so it went to whatever the client pointed at when it was
    // sent. A client that moved from scope A to scope B in this window therefore
    // put B's answers under A's key — B3's collision, reached from inside the
    // library rather than through a caller's key.
    //
    // `mountUnflushed` is what makes the window real rather than argued: a
    // component's effects have not run when it returns, so the query function
    // has not been called yet. See `runes.svelte.ts`.
    //
    // Which half this catches, measured rather than assumed: the *wire* one.
    // The options factory runs before the client moves, so a target list read
    // from the client there is still the right list, and the ledger entry that
    // takes the scope out of `requestTargets` does not kill this — it kills
    // SC14. What kills this is routing the REQ to the client's relays instead of
    // to the request's own.
    const urlA = nextUrl();
    const urlB = nextUrl();
    const { rxNostr, server: a } = createTestRelay(urlA);
    const scope = createRelayScope(rxNostr, [urlA]);
    // The value the request is keyed under. Immutable per generation, which is
    // what makes holding it meaningful (B-α).
    const keyedUnder = scope.current;

    const { value: handle, destroy } = mountUnflushed(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: keyedUnder,
        client: queryClient,
        namespace: 'sc13',
        filters: [{ kinds: [1] }],
        reqIdBase: 'sc13',
        staleTime: 0,
        settleTimeoutMs: 120
      }))
    );

    // The provider's relay set moves. The client follows it; this request does
    // not, because it was planned and keyed for the other one.
    const b = new WS(urlB, { jsonProtocol: true });
    scope.setRelays([urlB]);
    flush();

    for (let i = 0; i < 100 && reqs(a).length === 0; i += 1) await settle(10);
    const sub = String(reqs(a)[0]?.[1]);
    respondWithEvent(a, sub, fakeEvent({ id: 'sc13-a' }));
    respondWithEose(a, sub);
    await settle(200);

    // Asked of the relay its key names, answered by it, and settled on that
    // answer. Before the repair the REQ went to B — the wire followed the
    // client — and B's answer landed under A's key.
    expect(reqs(b)).toEqual([]);
    expect(idsOf(handle)).toEqual(['sc13-a']);
    expect(handle.state.status).toBe('settled');

    destroy();
  });

  // @contracts B3-C5
  it('SG14: a request is not deferred because the client has moved away from its scope', async () => {
    // The other derivation. "Nowhere to ask" is B-γ, and it
    // was counted from the client — so a client that had moved to an empty scope
    // deferred a request whose own scope has a relay in it, which is #74's
    // symptom produced by the library rather than by the world: an answer about
    // relays that were never asked.
    //
    // The disagreement is set up before the hook mounts rather than inside the
    // window SC13 opens, which is the same disagreement seen from a different
    // side: there the client moves after the key is fixed, here it has already
    // moved when the key is taken.
    //
    // This one carries both halves: it dies when `requestTargets` stops reading
    // the scope (the plan defers, so nothing is asked at all) and when the REQ
    // is left unrouted (it is sent to a client with nothing readable, so it
    // reaches nobody).
    const urlA = nextUrl();
    const { rxNostr, server: a } = createTestRelay(urlA);
    const scope = createRelayScope(rxNostr, [urlA]);
    const keyedUnder = scope.current;

    // The client moves to a scope with nothing readable in it.
    scope.setRelays([]);
    expect(Object.values(rxNostr.getDefaultRelays()).filter((relay) => relay.read)).toEqual([]);

    const { value: handle, destroy } = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        scope: keyedUnder,
        client: queryClient,
        namespace: 'sc14',
        filters: [{ kinds: [1] }],
        reqIdBase: 'sc14',
        staleTime: 0,
        settleTimeoutMs: 120
      }))
    );

    for (let i = 0; i < 100 && reqs(a).length === 0; i += 1) await settle(10);
    const sub = String(reqs(a)[0]?.[1]);
    respondWithEvent(a, sub, fakeEvent({ id: 'sc14-a' }));
    respondWithEose(a, sub);
    await settle(200);

    expect(idsOf(handle)).toEqual(['sc14-a']);
    expect(handle.state.status).toBe('settled');

    destroy();
  });
});
