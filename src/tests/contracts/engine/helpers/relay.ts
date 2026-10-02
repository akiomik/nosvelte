/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The relay harness for the engine's own seam, plus the two members of it that
 * read the library. Everything that builds a client and a mock socket out of
 * the dependency alone is the sentinels' `relay-dependency.js`, re-exported
 * here rather than copied, so there is one of it.
 * Ported from the spike's harness with the engine.
 */

import type { RxNostr, RxNostrConfig } from 'rx-nostr';

import type { NostrContext } from '$lib/v1/context.svelte.js';
import type { OwnedPacket } from '$lib/v1/event.js';
import { ownPacket } from '$lib/v1/event.js';
import type { TransportCapability } from '$lib/v1/lease.js';
import { callerTransport } from '$lib/v1/lease.js';
import { LIBRARY_EOSE_TIMEOUT_MS } from '$lib/v1/normalize.js';

export * from '../../sentinels/relay-dependency.js';
import type Nostr from 'nostr-typedef';
import type { EventPacket } from 'rx-nostr';

import { fakeEventPacket } from '../../sentinels/relay-dependency.js';

/**
 * Was this transport built to be **kept**, or to be asked one question and
 * thrown away?
 *
 * Two kinds of client come out of `createRxNostr` on the library's own path:
 *
 * - a **probe**, built by `probeTransportKeys` to ask the transport what it
 *   calls a relay. It opens no socket, is disposed in a `finally`, and passes no
 *   `eoseTimeout` at all. Probes run on both sides, because the relay scope is
 *   derived and validated on both sides.
 * - the **live** transport, which A-γ gives the library's EOSE timer to, which
 *   the accepted generation is written through to, and which is released with
 *   the provider. **Only a browser provider has one**; a server one creates
 *   none.
 *
 * The discriminator is the timer because it is a value `createLiveTransport`
 * writes and no probe does — and because it is read off the factory call rather
 * than off the object, which is the only place a client that was never kept can
 * still be observed. **It compares against the library's own constant rather
 * than a copy**, so a change to `LIBRARY_EOSE_TIMEOUT_MS` moves this with it.
 */
export function isLiveTransportConfig(config: Partial<RxNostrConfig>): boolean {
  return config.eoseTimeout === LIBRARY_EOSE_TIMEOUT_MS;
}

/**
 * Is this client disposed?
 *
 * Measured rather than assumed, and it is the second accessor that answers:
 * `getAllRelayStatus()` returns `{}` after `dispose()` rather than throwing,
 * because disposal clears the connection map and that getter has no disposal
 * guard — so it cannot tell a disposed client from one that was never given a
 * relay. `getDefaultRelays()` throws `RxNostrAlreadyDisposedError`, and it is
 * the only one of the two that discriminates. `stream.ts` records the same
 * asymmetry for the same reason.
 */
export function isTransportDisposed(client: RxNostr): boolean {
  try {
    client.getDefaultRelays();
    return false;
  } catch {
    return true;
  }
}

/**
 * The live transport a provider owns — from a context that has to say which
 * side it is rendering on before it will hand one over.
 *
 * `NostrContext` is a discriminated pair: a browser provider owns an `RxNostr`
 * and a server provider owns `undefined`, because on a server none is created.
 * So `context.rxNostr.anything()` no longer typechecks, and this is the one
 * place the narrowing is written instead of at each of the twenty-odd reads.
 *
 * **It throws rather than returning `undefined`**, and the throw is the reason
 * it exists rather than a `!`: every caller below built its provider under
 * jsdom, where the detection answers `'browser'`, so a `'server'` here means
 * the detection changed under the test — which is a result, not a
 * `TypeError: cannot read 'use' of undefined` three lines later.
 */
export function transportOf(context: NostrContext): RxNostr {
  if (context.environment !== 'browser') {
    throw new Error(
      'nosvelte test: this provider is rendering on a server, and a server provider owns no ' +
        'transport at all — there is nothing here to ask. See `ServerNostrContext`.'
    );
  }
  return context.rxNostr;
}

/**
 * A capability over a client that is already in hand.
 *
 * **A test-facing constructor, and it used to live in `lease.ts`.** Nothing in
 * the library called it: the two capabilities the library makes are the
 * provider's, over a client it created, and the caller's, over an option it
 * re-reads. A one-line wrapper exported from a library module with no caller in
 * it is a seam for a mode nothing reaches, which is the shape this branch keeps
 * finding — so it is here, where its callers are, built from the constructor
 * the library does use.
 */
export function permanentTransport(transport: RxNostr): TransportCapability {
  return callerTransport(() => transport);
}

/**
 * The **capability** a provider hands its requests, from the same context.
 *
 * {@link transportOf} answers the client, and the request path no longer takes
 * one: the machine, `requestTargets` and the stream are given a
 * `TransportCapability`, so a test that drives them directly needs what the
 * production path is given rather than what the provider holds behind it.
 * Reading `transportLease` is what the hook does, and a test that wrapped the
 * client in a fresh `permanentTransport` instead would be measuring a
 * capability the provider cannot revoke — which is the difference these arms
 * exist to see.
 */
export function leaseOf(context: NostrContext): TransportCapability {
  if (context.environment !== 'browser') {
    throw new Error(
      'nosvelte test: this provider is rendering on a server, and a server provider owns no ' +
        'transport at all — there is nothing here to ask. See `ServerNostrContext`.'
    );
  }
  return context.transportLease;
}

/**
 * A packet the cache will accept: the wire's, through the ownership boundary.
 *
 * **The boundary is the only way to make one**, which is what `OwnedPacket`'s
 * brand is for — a test that folded a raw `EventPacket` was measuring a cache
 * that cannot exist. `ownPacket` returns `undefined` for a malformed event, and
 * a fixture that is malformed is a broken fixture, so this throws rather than
 * handing back nothing.
 */
export function ownedEventPacket(overrides: Partial<Nostr.Event> = {}): OwnedPacket {
  const owned = ownPacket(fakeEventPacket(overrides));
  if (owned === undefined) throw new Error('the fixture is not a well-formed event');
  return owned;
}

/** The same, from a packet a test built itself. */
export function ownedFrom(packet: EventPacket): OwnedPacket {
  const owned = ownPacket(packet);
  if (owned === undefined) throw new Error('the packet is not a well-formed event');
  return owned;
}
