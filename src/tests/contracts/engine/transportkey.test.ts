/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Ported from the spike's `transportkey` suite onto `src/lib/v1`, against the
 * engine's own seam. The arms are renamed from `TK<n>` to `TQ<n>` — 0005
 * records the old names as spike witnesses, and a production arm carries a
 * name of its own. **The comments keep the spike's names**, because what they
 * record was measured there: `TK1` in a comment is the arm that is `TQ1`
 * here, and every other arm name in a comment is the spike's as 0005 records
 * it, not a file in this repository. Likewise "the ledger" is the spike's
 * mutation ledger, and a function or a file a comment names that this
 * repository does not have (`configOf`, `roles.ts`, `context.test.ts`, …) is
 * the spike's.
 *
 * What the spike's suite said of itself:
 *
 * What happens to the clients nobody gets a handle on.
 *
 * `CX10`-`CX13` measure the transport-key comparison through the provider's
 * public shape: a matching transport builds it, a disagreeing one refuses it,
 * and a refused update leaves the previous generation and the client alone.
 * Two claims are outside what that shape can see, and both are about a client
 * the caller never receives:
 *
 * - a **refused construction** creates a client inside `createNostrContext` and
 *   then throws, so the only reference to it is on a stack frame that is
 *   unwinding;
 * - the **probe** the comparison runs on builds a client per call and is
 *   supposed to dispose it, and an undisposed one that has been given relays
 *   holds a timer.
 *
 * So this file captures every `RxNostr` at its constructor. That is why it is a
 * file of its own rather than four more tests in `context.test.ts`: `vi.mock`
 * is hoisted and applies to the whole module graph of the file it is in, and
 * putting it beside eleven tests that do not want it would make every one of
 * them run through a wrapper for the benefit of two.
 *
 * The wrapper delegates — `importActual`, real clients, real behaviour — so
 * what is mocked here is the *bookkeeping*, not the dependency.
 */
import type { RxNostr } from 'rx-nostr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { createNostrContext } from '$lib/v1/context.svelte.js';
import type { TransportKeys } from '$lib/v1/scope.svelte.js';
import { NonIdempotentRelayUrlError, probeTransportKeys } from '$lib/v1/scope.svelte.js';

import { HARNESS_DIVERGENCES, isTransportDisposed, transportOf } from './helpers/relay.js';
import { mount } from './helpers/runes.svelte.js';

/**
 * Every client the dependency was asked to build, in order.
 *
 * A module-level array because `vi.mock`'s factory is hoisted above every
 * `const` in this file, so the factory cannot close over one declared normally.
 * Cleared per test.
 */
const built: RxNostr[] = [];

vi.mock('rx-nostr', async () => {
  const actual = await vi.importActual<typeof import('rx-nostr')>('rx-nostr');
  return {
    ...actual,
    createRxNostr: (...args: Parameters<typeof actual.createRxNostr>) => {
      const client = actual.createRxNostr(...args);
      (globalThis as unknown as Record<string, RxNostr[]>)['__nosvelteBuilt']?.push(client);
      return client;
    }
  };
});

/**
 * Is this client disposed?
 *
 * The measurement that makes the second accessor the one that answers is in
 * {@link isTransportDisposed}, which is where it lives now: `ssr.test.ts` and
 * `transportconfig.test.ts` ask the same question about the same objects, and
 * three copies of one `try` is three places for the asymmetry to be recorded
 * differently.
 */
const isDisposed = isTransportDisposed;

let port = 9410;
const nextUrl = () => `ws://localhost:${(port += 1)}`;

describe('the clients nobody holds', () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, RxNostr[]>)['__nosvelteBuilt'] = built;
    built.length = 0;
  });
  afterEach(() => {
    for (const client of built) {
      if (!isDisposed(client)) client.dispose();
    }
    WS.clean();
  });

  it('TQ1: a provider the transport refuses never configured its client, and released it', () => {
    const url = nextUrl();
    new WS(url, { jsonProtocol: true });

    /**
     * The client's state **at the moment the transport is asked**.
     *
     * **Reading it after the throw does not work, and finding that out is what
     * this variable is for.** `setDefaultRelays` fills the status map when it is
     * called (`RD6`), so an empty map afterwards looks like "never configured" —
     * but `dispose()` clears that same map, and the provider disposes on its way
     * out of a refusal. Measured: with the comparison moved to *after* the
     * write, the map read after the throw is still empty, so the assertion this
     * replaces could not tell the two orderings apart. The seam runs inside the
     * window, so it can.
     */
    let statusWhenAsked: string[] | undefined;
    // Renames whatever it is shown, its own answers included, so there is no
    // name this library could write back that the connection would open under.
    // **The error this produces changed with r31 and the claim did not**: the
    // same seam used to disagree with a name `canonicalUrl` had chosen, and now
    // there is no such name to disagree with — what it refuses is its own
    // answer to the caller's URL. `CX11` is the same refusal through the
    // provider's public shape.
    const unstable: TransportKeys = (urls) => {
      statusWhenAsked = Object.keys((built[0] as RxNostr).getAllRelayStatus());
      return urls.map((each) => `${each}/rewritten`);
    };

    // **The refusal is published rather than thrown** since first construction
    // stopped throwing: a relay list is untrusted input, so the provider stands
    // with an empty accepted scope and the error on the diagnostics axis.
    const refused = mount(() =>
      createNostrContext({
        relays: [url],
        harness: HARNESS_DIVERGENCES,
        transportKeys: unstable
      })
    );
    expect(refused.value.configurationError).toBeInstanceOf(NonIdempotentRelayUrlError);
    expect(refused.value.scope.urls, 'and nothing was accepted').toEqual([]);

    // One client, and it is the provider's: the seam is injected here, so the
    // default probe — which would have built one of its own — never runs.
    // Asserting the count is what makes the lines below unambiguous about
    // *which* client is being asked.
    expect(built).toHaveLength(1);
    const provider = built[0] as RxNostr;

    // **Never configured**, asked while the answer still exists. This is the
    // observation that separates a refusal taken before the write from one
    // taken after it.
    expect(statusWhenAsked).toEqual([]);

    // **And still the provider's, which is what changed with the ruling.** The
    // old decision threw out of the constructor, so this client had no owner
    // and had to be released on the way out; the arm asserted exactly that. Now
    // the provider stands — a consumer can fix their relay list and the same
    // provider starts working — so releasing the client here would be
    // disposing the thing the recovery needs.
    //
    // **Both edges, because "not disposed" alone is what a leak looks like.**
    // The client is alive while the provider is, and the ordinary teardown is
    // what releases it: `C6`'s rule is unchanged, only the moment it applies.
    expect(isDisposed(provider), 'the provider stands, so its client does').toBe(false);
    refused.destroy();
    expect(isDisposed(provider), 'and the ordinary teardown releases it').toBe(true);
  });

  it('TQ2: the default probe disposes the client it asks, once per call', () => {
    // The control for `TK1` is `TK3` below; this is a different claim about a
    // different client, and it has its own falsifier: an undisposed client that
    // has been given relays holds a timer, so a probe that leaked would leak
    // one per relay-list change for the life of the page.
    // **Two relays, and the second one is the repair.** This read
    // `expect(first).toEqual(urls)` over two already-canonical URLs, which is an
    // assertion that the probe hands back what it was given — the one answer a
    // probe that never asked the transport also produces. Measured: with the
    // probe's answer replaced by its argument and its client left alone, that
    // line stayed green and only the counts below moved, so the test could not
    // tell "asked the transport" from "asked nothing".
    //
    // Which spelling the transport settles on is deliberately not written down.
    // What is asserted is that the second name is **not** the one handed in,
    // against a first URL that comes back unchanged — a difference and a
    // control, neither of which names a spelling, so a dependency that renames
    // differently moves this test with it instead of failing against a literal.
    const settled = nextUrl();
    const renamed = 'wss://h.example/?x=%7E';
    const urls = [settled, renamed];

    const first = probeTransportKeys(urls);

    // It answered, so the client really was configured — a probe that returned
    // an empty list would pass the disposal check by never having done anything.
    // And the answer came from the transport rather than from the argument.
    expect(first).toHaveLength(2);
    expect(first[1]).not.toBe(renamed);
    // The control for that, and it is what says the transport is not hostile to
    // every string it is shown: the first URL is one it does leave alone.
    expect(first[0]).toBe(settled);
    expect(built).toHaveLength(1);
    expect(isDisposed(built[0] as RxNostr)).toBe(true);

    // Once per call, and each one released: the seam is called once per
    // published generation, so a per-call leak is unbounded in the life of a
    // page rather than a single object.
    probeTransportKeys(urls);
    probeTransportKeys(urls);
    expect(built).toHaveLength(3);
    expect(built.every((client) => isDisposed(client))).toBe(true);
  });

  it('TQ3: a provider the transport agrees with keeps its client, and the probe it used does not', () => {
    // `TK1`'s control, and `TK2`'s. Without it, "the client is disposed" is
    // satisfied by a provider that disposes its client on every path — which is
    // a provider that does not work — and "the probe is disposed" is satisfied
    // by disposing everything in sight.
    const url = nextUrl();
    new WS(url, { jsonProtocol: true });

    // The **default** seam, deliberately: this is the only test here that runs
    // the probe on the same path a consumer does, so it is also what says the
    // resolved transport agrees with this library about an ordinary relay.
    const { value: context, destroy } = mount(() =>
      createNostrContext({ relays: [url], harness: HARNESS_DIVERGENCES })
    );

    // **Four clients: the provider's, and `2n + 1` probes for a generation of
    // `n` relays.** The count is the r31 adapter as an observation rather than
    // as prose — one probe for the caller's URL, one for the answer that came
    // back, and one for the candidate set. It was two before, because the whole
    // list was probed once and the caller's URL was never probed at all.
    //
    // Asserting the number rather than "more than one": a design that dropped
    // the stability probe, or that went back to a single set probe, is a real
    // regression and this is the only place the arithmetic is visible.
    expect(built).toHaveLength(4);
    const [provider, ...probes] = built as [RxNostr, ...RxNostr[]];
    expect(provider).toBe(transportOf(context));

    expect(isDisposed(provider)).toBe(false);
    expect(probes.every((each) => isDisposed(each))).toBe(true);
    expect(Object.keys(provider.getAllRelayStatus())).toEqual([url]);

    // And the provider's client goes when the provider does, which is the
    // lifetime `CX9` measures for the rest of what it owns.
    destroy();
    expect(isDisposed(provider)).toBe(true);
  });
});
