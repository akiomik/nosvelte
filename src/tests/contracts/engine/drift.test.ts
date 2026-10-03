/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Ported from the spike's `drift` suite onto `src/lib/v1`, against the
 * engine's own seam. The arms are renamed from `TD<n>` to `TR<n>` — 0005
 * records the old names as spike witnesses, and a production arm carries a
 * name of its own. **The comments keep the spike's names**, because what they
 * record was measured there: `TD1` in a comment is the arm that is `TR1`
 * here, and every other arm name in a comment is the spike's as 0005 records
 * it, not a file in this repository. Likewise "the ledger" is the spike's
 * mutation ledger, and a function or a file a comment names that this
 * repository does not have (`configOf`, `roles.ts`, `context.test.ts`, …) is
 * the spike's.
 *
 * What the spike's suite said of itself:
 *
 * B-α, from the transport's side: whose answer names a relay.
 *
 * `SC15` and `SC21` measure this library's transcription of rx-nostr's private
 * normalizer against the rx-nostr **this repository resolves**, and `CX10`-`CX13`
 * measure that a disagreeing transport is refused. Between them one input was
 * missing, and it is the caller's: the seam was handed
 * `next.relays[].url` — a string this library had already chosen — so the only
 * thing a consumer's transport was ever asked about was our own output.
 *
 * That is self-consistency wearing the shape of agreement, and it is the exact
 * move r29 withdrew from `canonicalUrl` reappearing one layer out. A transport
 * `T` with `T(raw) = other` and `T(ours) = ours` passes the old comparison and
 * routes every request to a relay the caller did not write.
 *
 * So these ask the transport about **what the caller wrote**, one URL at a
 * time, and the file's subject is the order: raw → the transport's one-pass
 * answer → the transport's stability check on that answer → the immutable
 * scope → the set probe → the live client.
 *
 * **Every *disagreeing* seam here is injected, and that is the only way that
 * condition exists.** The resolved rx-nostr agrees with `canonicalOnce` on
 * everything `SC15` measures, so a test that used the default probe could not
 * tell the two designs apart on the mismatch arms. What a consumer's lockfile
 * can produce, this repository can only inject. Two tests do run the default
 * probe and are not mismatch arms: `TD5` measures what the choice costs by
 * putting the resolved transport beside a hypothetical one, and `TD12` measures
 * why the *set* comparison is silent on the path a consumer walks.
 */
import type { RxNostr } from 'rx-nostr';
import { createRxNostr } from 'rx-nostr';
import { describe, expect, it } from 'vitest';

import { createNostrContext } from '$lib/v1/context.svelte.js';
import { MAX_RENDERED } from '$lib/v1/normalize.js';
import { capture } from '$lib/v1/own.js';
import type { TransportKeys } from '$lib/v1/scope.svelte.js';
import {
  canonicalUrl,
  createRelayScope,
  InvalidRelayInputError,
  NonIdempotentRelayUrlError,
  probeTransportKeys,
  RelayConfigurationError,
  resolveTargets,
  TransportKeyMismatchError
} from '$lib/v1/scope.svelte.js';

import { HARNESS_DIVERGENCES, transportOf } from './helpers/relay.js';
import { mount } from './helpers/runes.svelte.js';

/** A real rx-nostr, connected to nothing: the strategy is lazy. */
const bareClient = (): RxNostr =>
  createRxNostr({ skipVerify: true, skipFetchNip11: true, retry: { strategy: 'off' } });

/**
 * A transport with a table of its own, and identity everywhere else.
 *
 * Recording what it was asked is half of what these tests observe: a seam that
 * answers correctly and was never given the caller's string is the defect this
 * file exists for, and it is invisible to any assertion about the answer alone.
 */
function tabled(rewrites: Record<string, string>): {
  keys: TransportKeys;
  asked: (readonly string[])[];
} {
  const asked: (readonly string[])[] = [];
  const keys: TransportKeys = (urls) => {
    asked.push([...urls]);
    return urls.map((url) => rewrites[url] ?? url);
  };
  return { keys, asked };
}

/**
 * A relay URL the resolved transport renames once and then leaves alone.
 *
 * `?x=%7E` is `SC15`'s corpus member and `SC16`'s trace: 3.7.5 decodes the query
 * after sorting it, so the name it uses is `?x=~`. Both spellings are needed
 * below, and neither is written out — the point of every test here is that a
 * name comes from a transport rather than from a literal.
 */
const RAW = 'wss://h.example/?x=%7E';
/** What *this library's* transcription makes of it. The old oracle. */
const OURS = canonicalUrl(RAW);

describe('B-α: the transport is asked about the caller’s URL', () => {
  it('TR3: the caller’s own string reaches the seam, first, and one relay at a time', () => {
    // The observation the rest of the file rests on. `expected` used to be
    // `next.relays[].url`, so the caller's string was consumed by
    // `canonicalUrl` before the seam existed — and no assertion about the
    // seam's *answer* can see that, because the answer was right.
    //
    // One at a time, deliberately: several URLs in one client are merged by the
    // transport's own map before it reports them, so a batch probe cannot say
    // which raw URL produced which key. That is the correspondence the scope
    // needs and the batch cannot supply.
    const { keys, asked } = tabled({});
    const client = bareClient();
    createRelayScope(client, [RAW, 'wss://b.example/'], keys);

    // The caller's string, unmodified, is the first thing the transport is
    // asked. Not "appears somewhere": the order is the claim — a design that
    // canonicalises first and probes afterwards can still pass the raw string
    // in later, and it would still be deriving the name from the wrong place.
    expect(asked[0]).toEqual([RAW]);
    // And it is not the only raw entry that gets there.
    expect(asked.map((call) => call[0])).toContain('wss://b.example/');
    // The premise: our transcription does not leave `RAW` alone, so "the seam
    // saw RAW" is a different fact from "the seam saw what we would have used".
    expect(OURS).not.toBe(RAW);

    client.dispose();
  });

  it('TR1: a transport that names the caller’s relay differently is obeyed, not second-guessed', () => {
    // **The mismatch arm.** The transport answers the caller's raw URL with a
    // key this library's copy does not produce, and returns this library's own
    // output unchanged — so the old comparison, which only ever showed it our
    // output, was green while every request went to `OURS`.
    //
    // `ELSEWHERE` is already canonical under the resolved 3.7.5 as well as
    // under the seam, so the client the scope writes to keys it the same way.
    // A spelling only the seam agreed with would put a test artefact — our name
    // against the real client's — where the property should be.
    const ELSEWHERE = 'wss://h.example/tenant-b';
    const { keys, asked } = tabled({ [RAW]: ELSEWHERE });
    const client = bareClient();

    const scope = createRelayScope(client, [RAW], keys);

    // Routed, identified and attributed under the transport's answer to what
    // the caller wrote.
    expect(scope.current.urls).toEqual([ELSEWHERE]);
    expect(scope.current.id).toBe(JSON.stringify([ELSEWHERE]));
    expect(Object.keys(client.getDefaultRelays())).toEqual([ELSEWHERE]);
    expect(Object.keys(client.getAllRelayStatus())).toEqual([ELSEWHERE]);

    // **And never under ours.** This is the half that fails against a design
    // whose adapter shows the transport its own output: there, `OURS` is the
    // name, the seam agrees about it, and nothing anywhere says the caller's
    // URL meant something else.
    expect(scope.current.urls).not.toContain(OURS);
    expect(Object.keys(client.getDefaultRelays())).not.toContain(OURS);
    // The seam was asked about the raw URL and about its own answer — never
    // about `OURS`, which is a string this library no longer has a use for.
    expect(asked.flat()).not.toContain(OURS);

    client.dispose();

    // **And a request is routed by that name too, under either spelling.** A
    // transport whose name this library's own canonicalisation would rewrite —
    // a trailing slash it would drop — is still the name: a request naming it
    // as the transport does, and one naming it as the caller configured it,
    // reach the same relay under the same identity. Canonicalising before
    // looking the name up refused the first as not in the scope.
    const SLASHED = 'wss://a.example/';
    expect(canonicalUrl(SLASHED), 'the arrangement needs a name we would rewrite').not.toBe(
      SLASHED
    );
    const renamed = tabled({ [RAW]: SLASHED });
    const second = bareClient();
    const named = createRelayScope(second, [RAW], renamed.keys).current;
    expect(named.urls).toEqual([SLASHED]);
    const byTransport = resolveTargets([SLASHED], named);
    const byCaller = resolveTargets([RAW], named);
    expect(byTransport.requested).toEqual([SLASHED]);
    expect(byCaller.requested).toEqual([SLASHED]);
    expect(byTransport.generation).toBe(byCaller.generation);
    second.dispose();
  });

  it('TR2: a transport that would rename its own answer refuses the generation before the client is written', () => {
    // `TD1`'s other half, and its control: without this, "the transport's
    // answer is taken" is satisfied by an implementation that takes any answer
    // at all. The name a scope carries is written back to the client, so an
    // answer the transport would rename *again* is a name no connection opens
    // under — which is `SC21`'s decision, asked of the actual transport instead
    // of our copy of it.
    const { keys, asked } = tabled({
      [RAW]: 'wss://h.example/first',
      'wss://h.example/first': 'wss://h.example/second'
    });
    const client = bareClient();

    expect(() => createRelayScope(client, [RAW], keys)).toThrow(NonIdempotentRelayUrlError);

    // Refused before anything is opened, named or configured — the same
    // discriminating pair `SC21` reads, because a write-then-complain
    // implementation leaves a relay in both maps.
    expect(client.getDefaultRelays()).toEqual({});
    expect(client.getAllRelayStatus()).toEqual({});
    // And the refusal came from asking the transport twice about the caller's
    // URL, rather than from our copy: both calls are here.
    expect(asked).toEqual([[RAW], ['wss://h.example/first']]);

    client.dispose();
  });

  it('TR4: a transport that settles what our copy calls non-idempotent is obeyed too', () => {
    // **The change-of-capability arm, and it carries a decision.** `?x=%257E` is
    // a URL 3.7.5 renames twice — `?x=%7E`, then `?x=~` — so this library
    // refuses it (`SC21`). A consumer's rx-nostr that settles it in one pass has
    // no such problem, and the question is whose rule decides.
    //
    // **Transport-derived, taken here.** The alternative is to keep 3.7.5's
    // answer as a fixed policy and refuse, and the reason not to is that
    // refusing does not move the socket: whatever this library does, the
    // endpoint is wherever the resolved transport sends the string it is
    // handed. A fixed policy therefore does not protect the caller from a
    // lockfile-dependent endpoint — it only refuses to start. `TD5` is the
    // price of the choice, measured.
    //
    // **This is the arm the old design could not even reach**: the local
    // refusal fired first, so the seam's call count for this input was zero.
    const DOUBLED = 'wss://h.example/?x=%257E';
    const SETTLED = 'wss://h.example/?x=%7E';
    const { keys, asked } = tabled({ [DOUBLED]: SETTLED });
    const client = bareClient();

    const scope = createRelayScope(client, [DOUBLED], keys);

    expect(scope.current.urls).toEqual([SETTLED]);
    // The transport was consulted about the caller's string before any rule of
    // ours applied. A zero here is the old ordering, whatever the outcome.
    expect(asked[0]).toEqual([DOUBLED]);
    // The premise: our own copy does refuse this input, so the acceptance above
    // is the transport's decision overriding ours rather than a URL nobody
    // objected to.
    expect(() => canonicalUrl(DOUBLED)).toThrow(NonIdempotentRelayUrlError);

    client.dispose();
  });

  it('TR5: the accepted name is the consumer’s transport’s, and that is what the choice costs', () => {
    // The measurement `TD4`'s decision is taken against, rather than the prose
    // that would otherwise stand in for it. One caller input, one library, two
    // resolved transports — and two different relays.
    //
    // The first arm is not a written-out spelling of 3.7.5: it is
    // `probeTransportKeys`, the default a consumer gets, so if the dependency
    // moves this arm moves with it. The second is a transport that leaves the
    // escape alone, which is the shape of every future 3.x that stops decoding
    // the query.
    const clientA = bareClient();
    const resolved = createRelayScope(clientA, [RAW], probeTransportKeys);

    const clientB = bareClient();
    const future = createRelayScope(clientB, [RAW], (urls) => [...urls]);

    // Same code, same caller input, different endpoint. **This is the cost of
    // transport-derived policy stated as an observation**: a consumer's
    // lockfile decides which relay `RAW` names, and nothing in this repository
    // can see which one they resolved.
    expect(resolved.current.urls).not.toEqual(future.current.urls);
    expect(future.current.urls).toEqual([RAW]);
    // And the first arm agrees with what this repository's transport actually
    // does, which is what says the two arms differ by the transport and not by
    // the seam's shape.
    expect(resolved.current.urls).toEqual([OURS]);

    // **What the alternative would not have bought.** A fixed-3.7.5 policy
    // refuses arm two rather than routing it somewhere else — the endpoint is
    // not the library's to choose either way. The client here is 3.7.5's, so
    // its status map is not read: arm two's transport does not exist in this
    // process, and asking 3.7.5 what it thinks of arm two's answer would be
    // measuring the harness.
    clientA.dispose();
    clientB.dispose();
  });

  it('TR6: a transport that merges two relays it named separately is still refused', () => {
    // The set probe, and why there is one after the per-URL pass. Each name is
    // settled on its own here; what the transport does with them *together* is
    // a different question, and the answer that matters is a merge — two names
    // of ours arriving as one connection, so one relay's EOSE is attributed to
    // a scope entry that will never hear from anyone.
    //
    // Not reachable from a well-behaved transport, and that is the point of the
    // seam: the per-URL pass and the set pass are two different calls, and
    // nothing but a probe can say they compose.
    const merging: TransportKeys = (urls) => (urls.length === 1 ? [...urls] : [urls[0] as string]);
    const client = bareClient();

    expect(() => createRelayScope(client, ['wss://a.example', 'wss://b.example'], merging)).toThrow(
      TransportKeyMismatchError
    );

    expect(client.getDefaultRelays()).toEqual({});
    expect(client.getAllRelayStatus()).toEqual({});

    client.dispose();
  });

  it('TR11: a merging transport is refused at construction, and the provider stands with an empty scope and the refusal published', () => {
    // **This exists because a full ledger run showed two entries collapsing
    // onto one kill set.** `transport-key-disagreement-not-compared` removes
    // the set probe and `transport-key-compared-after-the-client-is-written`
    // moves it below the write; the first is "no check", the second is
    // fail-open with an exception on top, and telling them apart is the whole
    // reason they are two entries. `CX11` used to be the id that separated
    // them, and it stopped being one when the refusal it observes moved
    // upstream of the set probe into `acceptedRelayName` — after which both
    // entries killed `CX13, TD6` and nothing else.
    //
    // What separates them is an arm that observes the *construction* refusal
    // and not the client's state afterwards: with no check at all the provider
    // is built with a merged generation accepted, so this dies; with the check
    // merely late the list is still refused, so this survives. `TD6` is the
    // same seam at `createRelayScope` and reads the client's maps, which is why
    // it dies under both.
    //
    // **The refusal is published rather than thrown** since first construction
    // stopped throwing — a relay list is untrusted input. What this arm reads
    // is the same fact one field over: the refusal is the transport's, and the
    // accepted scope is empty rather than the merged set.
    const merging: TransportKeys = (urls) => (urls.length === 1 ? [...urls] : [urls[0] as string]);

    const refused = mount(() =>
      createNostrContext({
        relays: ['wss://a.example', 'wss://b.example'],
        harness: HARNESS_DIVERGENCES,
        transportKeys: merging
      })
    );
    expect(refused.value.configurationError).toBeInstanceOf(TransportKeyMismatchError);
    expect(refused.value.scope.urls, 'and the merged set was not accepted').toEqual([]);
    refused.destroy();

    // The control, and it has to be a *two-relay* one: this seam agrees about
    // any single URL, so a provider built with one relay is the arm that says
    // the refusal above is about the set rather than about the seam being
    // hostile to everything.
    const { value: context, destroy } = mount(() =>
      createNostrContext({
        relays: ['wss://a.example'],
        harness: HARNESS_DIVERGENCES,
        transportKeys: merging
      })
    );
    expect(context.scope.urls).toEqual(['wss://a.example']);
    destroy();
  });

  it('TR12: the set probe cannot disagree with the resolved transport, and the fixed-point check is why', () => {
    // **Why `TD6` and `TD11` inject a seam, measured rather than asserted.**
    // `probedAsASet` compares the per-relay names against the transport's answer
    // for all of them at once, and on the path a consumer walks it has never
    // disagreed — 74 calls over the whole suite, all agreeing. That is not luck
    // and it is not a gap in the corpus.
    //
    // **It is also not "the transport names a set element-wise", which is what
    // this said and is false.** At 3.7.5 `setDefaultRelays` collapses its list
    // three times, and the three do not agree with each other:
    // `normalizeRelaysConfig` keys an object by the **raw** string;
    // the `UrlMap` constructor keys by `normalizeRelayUrl` applied **twice** —
    // once in its own loop and again inside the `set` it overrides — and keeps
    // the last entry for each key; and `connections` keys by **one**
    // application of it to the raw URL that surviving entry still carries,
    // which is also what `NostrConnection` sets `_url` to and what
    // `getAllRelayStatus()` reports. So two entries can collapse under the
    // double application and then be *named* by the single one, and which of
    // them survives to be named is the order they were written in. The second
    // control below is that, constructed.
    //
    // What makes the set answer the sum of the parts is therefore the
    // precondition and not the dependency: where `N(e) = e`, one application
    // and two are both the identity, so all three collapses dedupe on the same
    // value and distinct fixed points come back unchanged.
    // `acceptedRelayName` refuses anything else first.
    //
    // So this is the guard's own premise as an observation, and it re-runs
    // against whatever rx-nostr the tree resolves: the day a consumer's
    // transport stops being a per-URL function is the day `probedAsASet` starts
    // being able to fire, and the day this test's first half goes red.
    //
    // **Nothing here is a written-out spelling.** Which names the transport
    // settles on is read off the transport; only the caller inputs are literals,
    // and those are what a person writes.
    const CORPUS = [
      'wss://h.example',
      'wss://h.example/',
      'wss://h.example//',
      'wss://h.example/?x=%7E',
      'wss://h.example/?x=%257E',
      'wss://h.example/%7Epath',
      'wss://h.example/?b=2&a=1',
      'wss://h.example./',
      'wss://a.example',
      'wss://b.example'
    ];

    // One application, which is what `probedAsASet` would see if
    // `acceptedRelayName`'s second call were removed.
    const oncePass = [...new Set(CORPUS.map((url) => probeTransportKeys([url])[0] as string))];
    // Both applications: the names a scope can actually carry.
    const accepted = [...new Set(oncePass.filter((url) => probeTransportKeys([url])[0] === url))];

    // The premise, so that "no pair disagreed" is not satisfied by there being
    // no pairs — and so that the two lists are known to be different questions.
    expect(accepted.length).toBeGreaterThan(4);
    expect(oncePass.length).toBeGreaterThan(accepted.length);

    // Encoded rather than joined, for `identityOf`'s reason: a separator a URL
    // could carry makes two different name sets compare equal.
    const sorted = (names: readonly string[]) => JSON.stringify([...names].sort());
    const disagreed: string[][] = [];
    for (let i = 0; i < accepted.length; i += 1) {
      for (let j = i + 1; j < accepted.length; j += 1) {
        const pair = [accepted[i] as string, accepted[j] as string];
        if (sorted(probeTransportKeys(pair)) !== sorted(pair)) disagreed.push(pair);
      }
    }
    // Every pair, and then all of them together — a merge is a property of the
    // set, so the whole list is its own case rather than the pairs implying it.
    expect(disagreed).toEqual([]);
    expect(sorted(probeTransportKeys(accepted))).toBe(sorted(accepted));

    // **The control, and without it this measures nothing**: a probe that
    // answered every list with its own argument would satisfy everything above.
    // Drop the fixed-point precondition — the same corpus after one application
    // instead of two — and the same transport does merge, which is what says the
    // silence is the precondition's doing and not the probe's blindness.
    const merged: string[][] = [];
    for (let i = 0; i < oncePass.length; i += 1) {
      for (let j = i + 1; j < oncePass.length; j += 1) {
        const pair = [oncePass[i] as string, oncePass[j] as string];
        if (sorted(probeTransportKeys(pair)) !== sorted(pair)) merged.push(pair);
      }
    }
    expect(merged.length).toBeGreaterThan(0);

    // **The same control constructed rather than sampled, which is what names
    // the mechanism** — and still without a written-out spelling: only the two
    // caller inputs are literals, and every name below is read off the
    // transport. These two are named *differently* one at a time, and together
    // they are **one** relay — a different one depending on which was written
    // first, because the `UrlMap` constructor collapsed them by the second
    // application of the normalizer and then named the survivor by the first.
    // A transport that merges is not hypothetical at 3.7.5; it is one trailing
    // slash away.
    const A = 'wss://h.example///';
    const B = 'wss://h.example//';
    const alone = [probeTransportKeys([A]), probeTransportKeys([B])];
    expect(alone.map((names) => names.length)).toEqual([1, 1]);
    expect(alone[0]?.[0]).not.toBe(alone[1]?.[0]);
    // Two names in, one out: the merge itself.
    expect(probeTransportKeys([A, B])).toHaveLength(1);
    // And the answer is a function of the order, not of the set.
    expect(probeTransportKeys([B, A])).not.toEqual(probeTransportKeys([A, B]));

    // And this is why the set probe never sees it: the entry that makes the
    // merge possible is refused one URL at a time, before any set is offered.
    // The refusal is `non-idempotent-url` and not `transport-key-mismatch`,
    // which is the whole of why `probedAsASet` is silent on this path.
    const client = bareClient();
    expect(() => createRelayScope(client, [A, B])).toThrow(NonIdempotentRelayUrlError);
    client.dispose();
  });

  it('TR8: five different values that are not relay URLs become five refusals, not one relay', () => {
    // **The falsifier B-α is written against, reached without a percent-escape,
    // a duplicate or a transport that misbehaves — by writing nonsense.**
    //
    // rx-nostr's `normalizeRelayUrl` opens with `let o = ""`, works inside a
    // `try` and returns `o` from the `catch`, so a value it cannot handle comes
    // back as the empty string instead of as an error. Measured at 3.7.5:
    // `setDefaultRelays([5])`, `[true]`, `[{}]` and `[['wss://a']]` are all
    // accepted, and every one of them names the connection `""`.
    //
    // Taking names from the transport is what exposed that. Before r31 these
    // four reached `canonicalOnce`, whose `url.trim()` threw a raw `TypeError`
    // — fail-closed by accident, with no message naming a layer. Measured in a
    // worktree at `d535d27` and again on the repair, same test both times:
    // **four `TypeError`s and one accepted at HEAD; five accepted afterwards,
    // all sharing the identity `[""]`.** So the repair opened this, and the
    // entrance check is what closes it.
    //
    // **No identity comes out at all, rather than five distinct ones.** Both
    // would close the collision; refusal is chosen because a value that is not
    // a relay URL has no relay to be distinct *from*, and because rx-nostr will
    // open `""` as a connection rather than complain about it.
    //
    // **The two entrance rules split this corpus and neither one closes it
    // alone** — measured, not assumed: `5`, `true`, `{}` and `['wss://a']` are
    // caught by the string rule, and `''` is a string, so it is the URL rule
    // that catches that one. `relay-url-not-required-to-be-a-relay-url` kills
    // this test for exactly that reason.
    const NOT_RELAY_URLS: unknown[] = [5, true, {}, ['wss://a'], ''];

    const ids: string[] = [];
    const refusals: string[] = [];
    for (const url of NOT_RELAY_URLS) {
      const client = bareClient();
      try {
        ids.push(createRelayScope(client, [{ url, read: true, write: true } as never]).current.id);
      } catch (error) {
        refusals.push((error as Error).name);
      }
      client.dispose();
    }

    expect(ids).toEqual([]);
    expect(refusals).toEqual(Array.from(NOT_RELAY_URLS, () => 'InvalidRelayInputError'));

    // And the same values written bare rather than inside a config, which is a
    // different branch and reached `entry.url` on a number before r31.
    for (const url of NOT_RELAY_URLS) {
      const client = bareClient();
      expect(() => createRelayScope(client, [url as string])).toThrow(InvalidRelayInputError);
      client.dispose();
    }
  });

  it('TR16: the other ways a transport fails to name one relay, and the URL a refusal names', () => {
    // **`TD14` covers one of the three shapes this code exists for.** The row
    // says "none, several, or a value that is not a string", and the arity half
    // — the case that moved to this code from the mismatch's this round — had
    // no arm of its own: measured, taking the whole of that repair out again
    // left every arm in the spike suite green but one, and that one is in
    // another file and outside the scope of any ledger entry that edits this.
    //
    // Two more the record names as the same remedy and the code did not have:
    // a name this library cannot open a socket on, and the adapter giving out.
    const refusalFrom = (answers: TransportKeys): RelayConfigurationError => {
      try {
        createRelayScope(bareClient(), ['wss://a.example'], answers);
      } catch (error) {
        return error as RelayConfigurationError;
      }
      throw new Error('the relay list was accepted');
    };

    const shapes: readonly (readonly [string, TransportKeys])[] = [
      ['no name at all', () => []],
      ['two names for one relay', (urls) => [...urls, `${urls[0]}/also`]],
      // `''` is not a hypothetical: rx-nostr's own normaliser answers with it
      // from its `catch`, so a version whose parsing differs hands this back.
      ['a name that is not a URL', () => ['']],
      ['a name that is not a relay URL', () => ['http://h.example']],
      ['a name that is not a URL at all', () => ['banana']],
      [
        'an adapter that gives out',
        () => {
          throw new Error('adapter boom');
        }
      ],
      // **Not a list at all.** `answer.length` is read outside the `try`, so
      // these left a raw `TypeError` out of `createRelayScope` past the class
      // `0004` publishes — the defect the set probe was repaired for one commit
      // earlier, under a comment claiming this path already had the check.
      ['nothing at all', (() => null) as unknown as TransportKeys],
      ['undefined', (() => undefined) as unknown as TransportKeys],
      ['one string rather than a list', (() => 'wss://a.example') as unknown as TransportKeys],
      [
        'an array-like that is not one',
        (() => ({ length: 1, 0: 'wss://a.example' })) as unknown as TransportKeys
      ],
      // **The name that a parser would tidy into a URL, which is not the same as
      // a URL.** The name is the routing key and what is written back to the
      // transport, while packets arrive under the spelling the transport itself
      // uses — so a name with whitespace in it, or without the slashes, makes
      // the scope and the client's status map disagree and a relay that answered
      // is reported as having timed out.
      ['a name with a leading space', () => [' wss://a.example']],
      ['a name with a newline', () => ['wss://a.example\n']],
      ['a name with a tab in its scheme', () => ['w\tss://a.example']],
      ['a name missing its slashes', () => ['wss:a.example']]
    ];

    for (const [name, answers] of shapes) {
      const refusal = refusalFrom(answers);
      expect(refusal, name).toBeInstanceOf(RelayConfigurationError);
      expect(refusal.code, name).toBe('transport-incompatible');
      // The relay the consumer wrote, which is the one they can act on.
      expect(refusal.urls, name).toEqual(['wss://a.example']);
      // **And the instruction, which is the whole reason this code is not the
      // mismatch's.** One phrase is not enough — a message can carry it and the
      // wrong instruction beside it — so all three edges are stated: what to do,
      // that the other code's instruction is absent, and that the relay list is
      // named as *not* the remedy rather than left unmentioned.
      expect(refusal.message, name).toMatch(/Pin or upgrade rx-nostr, or upgrade nosvelte, or/);
      expect(refusal.message, name).not.toMatch(/write the set/);
      expect(refusal.message, name).toMatch(/nothing about the relay list changes it/);
      // **And it was the per-relay probe that refused, not the set probe.**
      // The set probe checks the same shapes one call later, so deleting the
      // per-relay name check left every assertion above satisfied by the set's
      // refusal — measured, the entry that deletes it went from killing this
      // arm to killing nothing. The two are told apart by the sentence only a
      // question about a name *this library* produced can carry.
      expect(refusal.message, name).not.toMatch(/which is what it had named/);
    }

    // **The set probe's own call, which the first repair missed while its commit
    // said it had done both.** An adapter that throws only when asked about more
    // than one relay is caught there and nowhere else: every shape above throws
    // unconditionally, so they are refused a call earlier and that line is never
    // reached. Two relays, because that is what makes the set probe a set.
    const throwsOnTheSet: TransportKeys = (urls) => {
      if (urls.length > 1) throw new Error('adapter boom on the set');
      return [...urls];
    };
    let onTheSet: unknown;
    try {
      createRelayScope(bareClient(), ['wss://a.example', 'wss://b.example'], throwsOnTheSet);
    } catch (error) {
      onTheSet = error;
    }
    expect(onTheSet).toBeInstanceOf(RelayConfigurationError);
    expect((onTheSet as RelayConfigurationError).code).toBe('transport-incompatible');
    // **Every relay it asked about, and the question it asked.** Naming the
    // first of the two — which is what taking `expected[0]` did — sends a
    // consumer to a relay that may be perfectly good, and the message read
    // "one relay" about a question that named two.
    expect((onTheSet as RelayConfigurationError).urls).toEqual([
      'wss://a.example',
      'wss://b.example'
    ]);
    expect((onTheSet as Error).message).toMatch(
      /wss:\/\/a\.example, wss:\/\/b\.example — 2 relays, together —/
    );
    expect((onTheSet as Error).message).not.toMatch(/one relay/);

    // **A scope with no relays asks nothing, so nothing can be refused.** The
    // set probe used to ask anyway, and an adapter that throws then produced a
    // refusal whose `urls` was `['']` — a string that is not a URL in the field
    // 0004 says holds relays, and the only way that field can be empty-ish
    // under a code other than `invalid-relay-input`.
    const throwsAlways: TransportKeys = () => {
      throw new Error('adapter boom, always');
    };
    expect(() => createRelayScope(bareClient(), [], throwsAlways)).not.toThrow();
    // The positive control: the same adapter, one relay, and it does refuse —
    // so the line above is emptiness and not a broken adapter.
    expect(() => createRelayScope(bareClient(), ['wss://a.example'], throwsAlways)).toThrow(
      RelayConfigurationError
    );

    // **And the URL a refusal names, on the pass that asks about the
    // transport's own answer.** `acceptedRelayName` calls the naming twice, and
    // the second call's subject is a string the caller never wrote — reporting
    // that one put a URL the consumer had not configured into `urls`, which is
    // the field `0004` says names relays they can act on. Measured before this
    // was written.
    const renamesThenBreaks: TransportKeys = (urls) =>
      urls[0] === 'wss://a.example' ? ['wss://renamed.example'] : [];
    const second = refusalFrom(renamesThenBreaks);
    expect(second.code).toBe('transport-incompatible');
    expect(second.urls).toEqual(['wss://a.example']);
  });

  it('TR17: what the set probe’s refusal names, says, and will not take as an answer', () => {
    // **`TD16`'s set arm cannot see any of this, and the reason is its
    // adapter.** It answers `[...urls]` for one relay, so the scope's names and
    // the caller's strings are the same list and every claim about *which* of
    // them is published is satisfied by either. The adapters here rename, which
    // is what separates them.
    const renames = (url: string): string =>
      url === 'wss://a.example'
        ? 'wss://ra.example'
        : url === 'wss://b.example'
          ? 'wss://rb.example'
          : url;

    const refusalFromSet = (onTheSet: (urls: readonly string[]) => unknown): Error => {
      const answers: TransportKeys = (urls) =>
        urls.length > 1 ? (onTheSet(urls) as string[]) : urls.map(renames);
      try {
        createRelayScope(bareClient(), ['wss://a.example', 'wss://b.example'], answers);
      } catch (error) {
        return error as Error;
      }
      throw new Error('the relay list was accepted');
    };

    // **The relays the consumer configured, not the ones the transport made
    // up.** `urls` is the field `0004` says names relays they can act on, and
    // under a renaming transport the scope's names are strings that appear
    // nowhere in their source. Measured before this arm: it published
    // `['wss://ra.example', 'wss://rb.example']`.
    const threw = refusalFromSet(() => {
      throw new Error('adapter boom on the set');
    }) as RelayConfigurationError;
    expect(threw.code).toBe('transport-incompatible');
    expect(threw.urls).toEqual(['wss://a.example', 'wss://b.example']);

    // **And the message says which question was asked**, which is the other
    // half: naming only the configured spelling describes a call that never
    // happened — the transport was asked about its own answers.
    expect(threw.message).toMatch(/wss:\/\/ra\.example, wss:\/\/rb\.example — 2 relays, together/);
    expect(threw.message).toMatch(/what it had named wss:\/\/a\.example, wss:\/\/b\.example/);

    // **The clause fires for a rename, and only for one.** `asked` is the
    // scope's names, which are sorted and deduplicated; `wrote` is the caller's
    // list, which is neither. Compared position by position — the first form —
    // this said "which is what it had named" for a caller who wrote their two
    // relays in the other order, under a transport that renamed nothing.
    const noRename: TransportKeys = (urls) => {
      if (urls.length > 1) throw new Error('adapter boom on the set');
      return [...urls];
    };
    let unsorted: unknown;
    try {
      createRelayScope(bareClient(), ['wss://b.example', 'wss://a.example'], noRename);
    } catch (error) {
      unsorted = error;
    }
    expect((unsorted as Error).message).not.toMatch(/which is what it had named/);
    // And a caller who wrote one relay twice is shown it once.
    let twice: unknown;
    try {
      createRelayScope(
        bareClient(),
        ['wss://a.example', 'wss://a.example', 'wss://b.example'],
        noRename
      );
    } catch (error) {
      twice = error;
    }
    expect((twice as RelayConfigurationError).urls).toEqual(['wss://a.example', 'wss://b.example']);

    // **The shapes this path took on trust while the per-relay one did not.**
    // `sameNames` reads `.length` and iterates, so the first two left a raw
    // `TypeError` out of `createRelayScope`, past the class the records
    // publish; the last three reached `TransportKeyMismatchError.actual`, typed
    // `readonly string[]`, holding a bare string, a number and bigints.
    const unusable: readonly (readonly [string, unknown])[] = [
      ['nothing at all', null],
      ['undefined', undefined],
      ['an array-like that is not one', { length: 2 }],
      ['one string rather than a list', 'wss://ra.example'],
      ['a number', 7],
      ['names that are not strings', [1n, 2n]],
      ['a name that is not a relay URL', ['wss://ra.example', 'banana']],
      // **A hole, because `some` skips them.** A sparse array is an `Array`,
      // and `[ 'wss://ra.example', <1 empty item> ]` walked past the check into
      // `TransportKeyMismatchError.actual` — typed `readonly string[]` — where
      // `describeValue` rendered the hole as `null`, which is the collapse that
      // function exists to prevent.
      ['a list with a hole in it', Object.assign(new Array(2), { 0: 'wss://ra.example' })],
      // **And a name that is not a string at all**, which is a clause of its
      // own: without it `isRelayUrl` is handed a symbol and throws
      // `Cannot convert a Symbol value to a string` — a raw `TypeError` again,
      // from the check that was supposed to stop them.
      ['a name that is a symbol', ['wss://ra.example', Symbol('nope')]]
    ];
    for (const [name, answer] of unusable) {
      const refusal = refusalFromSet(() => answer);
      expect(refusal, name).toBeInstanceOf(RelayConfigurationError);
      expect((refusal as RelayConfigurationError).code, name).toBe('transport-incompatible');
      expect((refusal as RelayConfigurationError).urls, name).toEqual([
        'wss://a.example',
        'wss://b.example'
      ]);
    }

    // **The positive control, and it is the whole reason the list above is not
    // a check that refuses everything**: an answer of the right shape that
    // disagrees is still the *mismatch*, which is a different code with a
    // different remedy.
    const mismatch = refusalFromSet(() => ['wss://ra.example', 'wss://rc.example']);
    expect(mismatch).toBeInstanceOf(TransportKeyMismatchError);
    expect((mismatch as RelayConfigurationError).code).toBe('transport-key-mismatch');
    // **And it names what the consumer wrote, for the same reason.** This arm
    // built exactly this arrangement as a control and asserted only the class
    // and the code, so the mismatch went on publishing the transport's names as
    // `urls` for a round after the fifth code's class stopped — a reviewer
    // found it here, on the line below the one that could see it.
    expect((mismatch as RelayConfigurationError).urls).toEqual([
      'wss://a.example',
      'wss://b.example'
    ]);
    expect((mismatch as TransportKeyMismatchError).expected).toEqual([
      'wss://ra.example',
      'wss://rb.example'
    ]);
    // And an answer that agrees is accepted at all.
    expect(() =>
      createRelayScope(bareClient(), ['wss://a.example', 'wss://b.example'], (urls) =>
        urls.map(renames)
      )
    ).not.toThrow();
  });

  it('TR18: a capability conflict names the two entries the caller wrote', () => {
    // **The conflict is found after naming, so the refusal named the
    // transport's answer.** Under a transport that renames, `urls` held a URL
    // that is nowhere in the caller's source and the message contained nothing
    // they could search for — the same defect as the fifth code's, in the class
    // beside it, found one commit after that one was repaired and not swept.
    // Both spellings collapse onto one name, which is what makes the two
    // entries one relay and the conflict a conflict.
    const answers: TransportKeys = (urls) =>
      urls.map((url) => (url.startsWith('wss://a.example') ? 'wss://ra.example' : url));

    let refusal: unknown;
    try {
      createRelayScope(
        bareClient(),
        [
          { url: 'wss://a.example', read: false, write: true },
          { url: 'wss://a.example/', read: true, write: false }
        ],
        answers
      );
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(RelayConfigurationError);
    const refused = refusal as RelayConfigurationError;
    expect(refused.code).toBe('conflicting-capabilities');
    // Both spellings, as written — a consumer finds these by searching.
    expect(refused.urls).toEqual(['wss://a.example', 'wss://a.example/']);
    expect(refused.message).toContain('wss://a.example and wss://a.example/');
    // And the transport's name for them, said as the transport's rather than
    // as theirs, because that is what makes the two entries one relay.
    expect(refused.message).toContain('both named wss://ra.example by the transport');

    // **The control**: with a transport that renames nothing, the message does
    // not talk about the transport at all.
    let plain: unknown;
    try {
      createRelayScope(
        bareClient(),
        [
          { url: 'wss://b.example', read: false, write: true },
          { url: 'wss://b.example', read: true, write: false }
        ],
        (urls) => [...urls]
      );
    } catch (error) {
      plain = error;
    }
    expect((plain as RelayConfigurationError).urls).toEqual(['wss://b.example']);
    expect((plain as Error).message).not.toContain('by the transport');
  });

  it('TR19: the relay list itself is a list, and a hole in it is not a relay', () => {
    // **Every entry was checked and the container was taken on faith.** A
    // consumer who writes `relays={'wss://a.example'}` — one string instead of
    // a list, the commonest slip at this prop — got `entries.map is not a
    // function` out of `createRelayScope`, past the class `0004` publishes; and
    // a `Set`, an array-like from a config loader, and an array with a hole did
    // the same or worse (`Cannot read properties of undefined`). On a prop
    // change the provider's `$effect` rethrows anything that is not a
    // `RelayConfigurationError`, so the whole subtree went down and the client
    // with it — which is `C16`'s own falsifier.
    const shapes: readonly (readonly [string, unknown])[] = [
      ['one relay rather than a list', 'wss://a.example'],
      ['a Set', new Set(['wss://a.example'])],
      ['an array-like from a config loader', { 0: 'wss://a.example', length: 1 }],
      ['nothing at all', null],
      ['a number', 7]
    ];
    for (const [name, relays] of shapes) {
      let refusal: unknown;
      try {
        createRelayScope(bareClient(), relays as never, tabled({}).keys);
      } catch (error) {
        refusal = error;
      }
      expect(refusal, name).toBeInstanceOf(RelayConfigurationError);
      expect((refusal as RelayConfigurationError).code, name).toBe('invalid-relay-input');
      expect((refusal as Error).message, name).toMatch(/relay list must be an array of relays/);
    }

    // **A hole is not a value, and `map` skips it**: the list came out of `map`
    // still holed and `for…of` then read `.url` off `undefined`. Filled, it is
    // an entry that is not a relay, which this boundary already refuses.
    const holed = ['wss://a.example', 'wss://b.example'];
    delete holed[0];
    let sparse: unknown;
    try {
      createRelayScope(bareClient(), holed, tabled({}).keys);
    } catch (error) {
      sparse = error;
    }
    expect(sparse).toBeInstanceOf(RelayConfigurationError);
    expect((sparse as RelayConfigurationError).code).toBe('invalid-relay-input');
    expect((sparse as Error).message).toMatch(/was absent/);

    // **The control**: a dense list of relays is accepted, and an empty one is
    // a scope with no relays rather than a refusal.
    expect(() =>
      createRelayScope(bareClient(), ['wss://a.example'], tabled({}).keys)
    ).not.toThrow();
    expect(() => createRelayScope(bareClient(), [], tabled({}).keys)).not.toThrow();
  });

  it('TR15: a field the caller left out is refused as missing, not as a type', () => {
    // **The most likely mistake at this prop, and the message named the wrong
    // fault.** `{ url }` without `read`/`write` is what a caller writes when
    // they reach for the object form to say something about one relay — the
    // string form is the one that defaults both — and the refusal read `and was
    // a undefined`, which is ungrammatical and tells them to look for an
    // `undefined` they never wrote instead of for a field they never added.
    //
    // The control is the other edge: a value that is there is still shown, so
    // this is not a refusal that stopped rendering values.
    let missing: unknown;
    try {
      createRelayScope(bareClient(), [{ url: 'wss://a.example' } as never], tabled({}).keys);
    } catch (error) {
      missing = error;
    }
    expect(missing).toBeInstanceOf(RelayConfigurationError);
    expect((missing as Error).message).toContain('read flag must be a boolean, and was absent');

    let present: unknown;
    try {
      createRelayScope(
        bareClient(),
        [{ url: 'wss://a.example', read: 'yes', write: true } as never],
        tabled({}).keys
      );
    } catch (error) {
      present = error;
    }
    expect((present as Error).message).toContain('read flag must be a boolean, and was "yes"');
  });

  it('TR14: a transport that answers with something other than a name is refused by this library', () => {
    // **The seam this file already declines to trust, trusted about shape.**
    // `transportName` checks that the transport answered about exactly one
    // relay and then cast the answer to `string`. The cast is the only thing
    // that said so, and what a non-string reaches is `JSON.stringify` — in the
    // mismatch error's own message and in `identityOf` — where a bigint throws
    // a raw `TypeError` out of scope construction, past the
    // `RelayConfigurationError` `0004` publishes.
    //
    // Not a hypothetical seam: `transportKeys` is injectable, the harness
    // injects it, and the whole reason this file exists is that the transport's
    // naming is a fact to be measured rather than a version to be trusted.
    // **Every shape rather than the one that throws.** A first version of this
    // arm passed `1n` alone, and an implementation that refused bigints and
    // nothing else satisfied it — measured: with the guard narrowed to
    // `typeof name === 'bigint'`, eight of these nine were accepted and this
    // arm stayed green. What is contracted is that the transport answered with
    // something that is not a name, not that it answered with a bigint.
    const notNames: readonly (readonly [string, unknown])[] = [
      ['a bigint', 1n],
      ['a number', 1],
      ['null', null],
      ['undefined', undefined],
      ['a symbol', Symbol('wss://a.example')],
      ['a function', () => 'wss://a.example'],
      ['a boolean', true],
      ['an array', ['wss://a.example']],
      ['a String object', new String('wss://a.example')],
      // **And three that are strings and are not URLs**, which is a different
      // half of the same guard: the shapes above are refused by the `typeof`
      // test, and these reach `new URL` and make it throw. A scheme with no
      // host is what rx-nostr's own normaliser can answer, and the check that
      // turns that into a refusal is a `catch` — measured by putting a rethrow
      // in every `catch` in the library, which left this arm green because
      // every row above stops one line earlier.
      ['a scheme with no host', 'wss://'],
      ['an unterminated IPv6 literal', 'wss://['],
      ['a bare percent', 'ws://%']
    ];

    for (const [name, answer] of notNames) {
      const answers: TransportKeys = (urls) => urls.map(() => answer as unknown as string);
      let caught: unknown;
      try {
        createRelayScope(bareClient(), ['wss://a.example'], answers);
      } catch (error) {
        caught = error;
      }
      expect(caught, name).toBeInstanceOf(RelayConfigurationError);
      // **Its own code, not the mismatch's.** A mismatch is answered by
      // rewriting the relay list; this is answered by pinning, upgrading or
      // reporting, and `0004` says a cause a consumer answers differently is a
      // code. Named for the remedy rather than for the fault, so that the other
      // faults with the same remedy — no name for one relay, several names for
      // one relay — join it instead of growing the union.
      expect((caught as RelayConfigurationError).code, name).toBe('transport-incompatible');
      // And the refusal says what it saw, which is the half that would be lost if
      // the message were built with the call that throws on it.
      expect((caught as Error).message, name).toMatch(/^nosvelte: /);
      // The relay it happened about is named, and it is a URL — which is what
      // `urls` means for every other code.
      expect((caught as RelayConfigurationError).urls, name).toEqual(['wss://a.example']);
    }

    // **The renderings, because rendering the array collapsed four faults into
    // one message.** `JSON.stringify([Symbol()])`, `[undefined]`, `[() => {}]`
    // and `[null]` are all `[null]`, so a message built from the array said
    // `it answered [null]` for every one of them. Each is named on its own now.
    const rendered = (answer: unknown): string => {
      const answers: TransportKeys = (urls) => urls.map(() => answer as unknown as string);
      try {
        createRelayScope(bareClient(), ['wss://a.example'], answers);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(rendered(1n)).toContain('answered 1n');
    expect(rendered(1)).toContain('answered 1');
    expect(rendered(null)).toContain('answered null');
    expect(rendered(undefined)).toContain('answered absent');
    expect(rendered(Symbol('s'))).toContain('answered Symbol(s)');
    expect(rendered(() => 'x')).toContain('answered a function');
    // Four of those used to be one message; they are five distinct ones.
    expect(
      new Set([1n, 1, null, undefined, Symbol('s'), () => 'x'].map(rendered)).size
    ).toBeGreaterThanOrEqual(6);
  });

  it('TR13: a value the refusal cannot serialise is still refused, not thrown past', () => {
    // **The refusal path threw, so the published contract broke on exactly the
    // inputs the runtime check exists for.** `0004` publishes that a relay list
    // is refused with a `RelayConfigurationError` a consumer can catch by type
    // and discriminate by `code`, and the reason for checking at runtime at all
    // is that a `RelayInput` annotation stops nothing — this is a JavaScript
    // API. The message builder called `JSON.stringify` on the caller's value.
    //
    // Measured before the repair, all three escaping as something else: `1n`
    // threw `TypeError: Do not know how to serialize a BigInt`, an object
    // holding itself threw `TypeError: Converting circular structure to JSON`,
    // and a value with a throwing `toJSON` threw **the caller's own error** —
    // so a consumer could substitute anything at all for this library's
    // refusal. A symbol needed no throw to be wrong: `JSON.stringify` answers
    // `undefined` for one, and the message read `and was undefined`, naming the
    // wrong fault.
    //
    // Each arm asserts the type *and* that the message still says which field
    // and what was wrong with it, because a refusal that says `and was
    // [object Object]` for every one of these would satisfy the type alone.
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    // **The third column is what the message has to say about the value, and it
    // is here because the negative assertions below were satisfied by a refusal
    // that says nothing about it.** Measured: replacing every rendering with a
    // constant left all four arms green, so what this file was holding was "the
    // refusal is ours and does not name the wrong fault" and not "the refusal
    // names the value".
    const hostile: readonly (readonly [string, unknown, string])[] = [
      ['a bigint', 1n, 'and was 1n'],
      ['an object holding itself', { url: circular }, 'and was an unserialisable object'],
      [
        'a throwing toJSON',
        {
          url: {
            toJSON: () => {
              throw new Error('from the consumer');
            }
          }
        },
        'and was an unserialisable object'
      ],
      ['a symbol', Symbol('nope'), 'and was Symbol(nope)']
    ];

    for (const [name, value, shown] of hostile) {
      let caught: unknown;
      try {
        createRelayScope(bareClient(), [value as never], tabled({}).keys);
      } catch (error) {
        caught = error;
      }
      expect(caught, name).toBeInstanceOf(RelayConfigurationError);
      expect((caught as RelayConfigurationError).code, name).toBe('invalid-relay-input');
      // Not the consumer's error wearing the right shape: the message is this
      // library's, and it names the fault rather than the value's rendering.
      expect((caught as Error).message, name).toMatch(/^nosvelte: /);
      expect((caught as Error).message, name).not.toContain('from the consumer');
      expect((caught as Error).message, name).not.toContain('and was undefined');
      // And it says what it saw.
      expect((caught as Error).message, name).toContain(shown);
    }
  });

  it('TR21: what a seam said is quoted up to a bound the caller does not choose', () => {
    // **The bound the message-first path went round.** `saidBy` reads `.message`
    // first — which is what lets it quote a `Proxy` that refuses
    // `getPrototypeOf` — and returned it whole, while the *other* branch goes
    // through `describeValue` and its 200-unit cap. So the length of a published,
    // stored refusal was the caller's to choose: measured, a relay input whose
    // `url` getter threw an `Error` of 100 000 characters produced a
    // `RelayConfigurationError` of 100 439, and the same payload thrown as a
    // plain object came out at 646.
    //
    // Both shapes are read here, because the pair is the claim: one bound, not
    // one bound per shape of input.
    const long = 'x'.repeat(100_000);
    const thrown = (hostile: unknown): Error => {
      try {
        createRelayScope(
          bareClient(),
          [
            {
              get url(): string {
                throw hostile;
              },
              read: true,
              write: true
            } as never
          ],
          tabled({}).keys
        );
      } catch (error) {
        return error as Error;
      }
      throw new Error('the relay input was accepted, so this arm measures nothing');
    };
    const fromError = thrown(new Error(long));
    const fromObject = thrown({ detail: long });
    expect(fromError).toBeInstanceOf(RelayConfigurationError);
    // **Against the declared cap, not against a round number.** `< 1_000` was
    // the first version and a reviewer priced it: the fixed surround is 439
    // characters, so that assertion admitted any bound between 20 and 554 — a
    // library capped at 550 instead of 200 passed the whole suite.
    expect(fromError.message.length, 'an Error’s words are bounded too').toBeLessThan(
      500 + MAX_RENDERED
    );
    expect(fromObject.message.length).toBeLessThan(500 + MAX_RENDERED);
    // **A cut, and not a refusal to quote.** The control below uses a short
    // message, which is the side that is never cut — so it cannot see a bound
    // that throws the words away and says so instead. These two can: what fits
    // is still the caller's text, and the marker says the rest was dropped.
    expect(fromError.message).toContain('x'.repeat(MAX_RENDERED - 50));
    expect(fromError.message, 'the cut is published as a cut').toMatch(/… \(cut\)/);
    // **Not vacuous**: the words that fit are still there, so the bound is a cut
    // rather than a refusal to quote.
    expect(thrown(new Error('short enough to keep')).message).toContain('short enough to keep');

    // **And the other reader of the same bound**, which is the one that keys the
    // cache: a captured failure carries `saidBy`'s message too, and moving the
    // cap out to the relay-list call site left that copy unbounded — measured at
    // 100 000 characters, on a string that is the refused entry's key.
    expect(
      capture({ message: long }, 'unspecified').message.length,
      'the captured failure is bounded too'
    ).toBeLessThan(MAX_RENDERED + 20);
  });

  it('TR20: a value that refuses to be *read* is refused too, at all three seams that quote one', () => {
    // **`TD13`'s class, one question over.** That arm takes values the refusal
    // cannot *serialise*; this one takes values the refusal cannot **ask about**.
    // The three `catch` blocks in `scope.svelte.ts` all read a thrown value with
    // a bare `instanceof` and a bare `.message`, and a `Proxy` can make either
    // throw — so the consumer got `TypeError: 'getPrototypeOf' on proxy` where
    // this surface publishes a catchable `RelayConfigurationError`. Measured by
    // a reviewer, at three sites the round that built the Error-ownership
    // boundary had enumerated as four and left as seven.
    //
    // The sites are enumerated here rather than represented by one of them,
    // which is the same discipline `PO6` applies one module over.
    const refusesToSayWhatItIs = new Proxy(new Error('the seam threw'), {
      getPrototypeOf: (): never => {
        throw new TypeError('getPrototypeOf refuses');
      }
    });
    const refusesToSayAnything = new Proxy(
      {},
      {
        get: (): never => {
          throw new TypeError('every read refuses');
        },
        getPrototypeOf: (): never => {
          throw new TypeError('getPrototypeOf refuses');
        }
      }
    );

    // **The third value is the one that defeats the *renderer* rather than the
    // identity test.** `saidBy` falls back to the caller's own `describe` when
    // there is no string `message`, and the two transport seams pass `String` —
    // which a revoked `Proxy` makes throw. That fallback string was reachable
    // and witnessed by nothing.
    const revoked = ((): unknown => {
      const revocable = Proxy.revocable({}, {});
      revocable.revoke();
      return revocable.proxy;
    })();

    for (const [name, hostile] of [
      ['a proxy that hides its prototype', refusesToSayWhatItIs],
      ['a proxy that answers nothing', refusesToSayAnything],
      ['a revoked proxy', revoked]
    ] as const) {
      // (1) the relay input reader, which is the consumer's own object.
      let caught: unknown;
      try {
        createRelayScope(
          bareClient(),
          [
            {
              get url(): string {
                throw hostile;
              },
              read: true,
              write: true
            } as never
          ],
          tabled({}).keys
        );
      } catch (error) {
        caught = error;
      }
      expect(caught, `${name}: the relay input reader`).toBeInstanceOf(RelayConfigurationError);
      expect((caught as Error).message).toMatch(/^nosvelte: /);

      // (2) the per-relay transport adapter, and (3) the set adapter: the same
      // hostile value thrown by the seam this library calls rather than by the
      // caller's own getter.
      // **The set call is reached only by an adapter that answers the per-relay
      // ones**, which the first draft of this arm got wrong: an adapter that
      // throws unconditionally is caught one call earlier and the set call never
      // runs — which is what the comment on that line in `scope.svelte.ts`
      // already recorded about the arm before it. The per-relay call is handed
      // one url; the set call is handed the whole list.
      for (const [site, urls, keys] of [
        [
          'the per-relay adapter',
          ['wss://a.example'],
          () => {
            throw hostile;
          }
        ],
        [
          'the set adapter',
          ['wss://a.example', 'wss://b.example'],
          (asked: readonly string[]) => {
            if (asked.length > 1) throw hostile;
            return [...asked];
          }
        ]
      ] as const) {
        let fromSeam: unknown;
        try {
          createRelayScope(bareClient(), [...urls], keys as never);
        } catch (error) {
          fromSeam = error;
        }
        expect(fromSeam, `${name}: ${site}`).toBeInstanceOf(RelayConfigurationError);
        expect((fromSeam as Error).message, `${name}: ${site}`).toMatch(/^nosvelte: /);
        // A value that cannot be rendered *at all* still leaves a sentence a
        // consumer can read, rather than the word `undefined` in the middle of
        // one. `String` is what these two seams hand `saidBy`, and a revoked
        // proxy makes it throw.
        if (name === 'a revoked proxy') {
          expect((fromSeam as Error).message, `${name}: ${site}`).toContain(
            'a value that cannot be rendered'
          );
        }
      }
    }

    // **The control**: a seam that throws an ordinary Error still has its
    // message quoted, which is what says the guard reads the message rather
    // than giving up on every thrown value.
    let ordinary: unknown;
    try {
      createRelayScope(bareClient(), ['wss://a.example'], (() => {
        throw new Error('the transport said why');
      }) as never);
    } catch (error) {
      ordinary = error;
    }
    expect((ordinary as Error).message).toContain('the transport said why');
  });

  it('TR9: a URL with no scheme is refused, in a message that says who refused it', () => {
    // **`'nostr.example.com'` is the shape a person actually writes**, and
    // every layer under this one accepts it: `new URL` is the only thing that
    // objects, rx-nostr catches that and names the connection
    // `nostr.example.com`, and the request goes out to a relay that cannot be
    // dialled. `SEN25`'s corpus already records the same for
    // `'not a url at all'`.
    //
    // The message is asserted, not just the type. A refusal a consumer cannot
    // attribute sends them to rx-nostr's issue tracker for a decision this
    // library made — which is the failure `MissingProviderError` was written
    // against, in the layer below.
    const client = bareClient();
    expect(() => createRelayScope(client, ['nostr.example.com'], (urls) => [...urls])).toThrow(
      InvalidRelayInputError
    );
    try {
      createRelayScope(client, ['nostr.example.com'], (urls) => [...urls]);
      expect.unreachable('the entrance accepted a URL with no scheme');
    } catch (error) {
      const message = (error as Error).message;
      // Who refused it, what rule, and what was written — the three things a
      // caller needs to fix it without reading this library's source.
      expect(message).toContain('nosvelte');
      expect(message).toContain('must be a ws: or wss: URL');
      expect(message).toContain('"nostr.example.com"');
      expect(message).toContain('before the relay transport was asked anything about it');
    }

    // **The control, and it is the whole reason this arm can be trusted.** A
    // library that refused every relay would satisfy every assertion above.
    // `ws://` and `wss://` go through, including the escaped and slash-run
    // shapes `SC15` measures, so the rule rejects a scheme rather than a
    // syntax it does not like.
    const accepting = bareClient();
    const scope = createRelayScope(accepting, [
      'wss://h.example',
      '  wss://ws-spaced.example  ',
      'ws://localhost:9410',
      { url: 'wss://write.example', read: false, write: true }
    ]);
    expect(scope.current.urls).toEqual([
      'ws://localhost:9410',
      'wss://h.example',
      'wss://ws-spaced.example'
    ]);

    client.dispose();
    accepting.dispose();
  });

  it('TR10: a capability that is not a boolean is refused, either way it would have gone wrong', () => {
    // **Two defects that pull in opposite directions, and one rule answers
    // both.** Measured on the code this replaces:
    //
    // - `{ read: 'no', write: 0 }` put the relay in the *readable* set, because
    //   `urls` is built by a truthiness filter and `'no'` is truthy. A caller
    //   who said no was read from.
    // - `{ read: true }` beside `{ read: 1 }` for one relay was refused as a
    //   capability *conflict*, because the duplicate rule compares with `!==`.
    //   Two callers who agreed were told they disagreed.
    const client = bareClient();

    expect(() =>
      createRelayScope(client, [{ url: 'wss://a.example', read: 'no', write: 0 } as never])
    ).toThrow(InvalidRelayInputError);

    expect(() =>
      createRelayScope(client, [
        { url: 'wss://b.example', read: true, write: true },
        { url: 'wss://b.example', read: 1, write: 1 } as never
      ])
    ).toThrow(InvalidRelayInputError);

    // A missing flag is the same rule: `undefined` is not a boolean, and the
    // old truthiness filter read it as write-only silently.
    expect(() => createRelayScope(client, [{ url: 'wss://c.example' } as never])).toThrow(
      InvalidRelayInputError
    );

    // **The control.** Real booleans, in both positions, still separate the
    // readable set from the write-only one — so this refuses a type rather
    // than the distinction the flags exist to carry.
    const scope = createRelayScope(client, [
      { url: 'wss://read.example', read: true, write: false },
      { url: 'wss://write.example', read: false, write: true }
    ]);
    expect(scope.current.urls).toEqual(['wss://read.example']);
    // The whole pair rather than one projection of it: the entries are sorted
    // by url, so a `map` over one field reads as an order claim by accident.
    expect(scope.current.relays).toEqual([
      { url: 'wss://read.example', read: true, write: false },
      { url: 'wss://write.example', read: false, write: true }
    ]);

    client.dispose();
  });

  it('TR7: the provider takes the transport’s answer to the caller’s URL, and a refused update leaves the first generation', () => {
    // The two arms above at the provider, which is where a consumer meets them:
    // `createRelayScope` is unpublished, and what 0004 exposes is a component
    // that owns its client. `CX10`-`CX13` measure the same ordering against a
    // seam that only ever saw our output.
    const ELSEWHERE = 'wss://h.example/tenant-b';
    const { keys } = tabled({
      [RAW]: ELSEWHERE,
      'wss://bad.example': 'wss://bad.example/one',
      'wss://bad.example/one': 'wss://bad.example/two'
    });

    const { value: context, destroy } = mount(() =>
      createNostrContext({ relays: [RAW], harness: HARNESS_DIVERGENCES, transportKeys: keys })
    );

    expect(context.scope.urls).toEqual([ELSEWHERE]);
    expect(Object.keys(transportOf(context).getDefaultRelays())).toEqual([ELSEWHERE]);

    const before = context.scope;
    // Recorded rather than thrown, since C16: see `CX13` and `CF6`. The type is
    // still asserted here, because which refusal it was is what says the update
    // was rejected by the transport's stability check rather than by anything
    // else on the path.
    context.setRelays([RAW, 'wss://bad.example']);
    expect(context.configurationError).toBeInstanceOf(NonIdempotentRelayUrlError);

    // Identity, not equality: every request already keyed on this generation
    // stays keyed on it.
    expect(context.scope).toBe(before);
    expect(Object.keys(transportOf(context).getDefaultRelays())).toEqual([ELSEWHERE]);
    expect(Object.keys(transportOf(context).getAllRelayStatus())).toEqual([ELSEWHERE]);

    destroy();
  });
});
