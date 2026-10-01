/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The relay harness the rx-nostr sentinels use, built out of `rx-nostr`,
 * `mock-socket` and `vitest-websocket-mock` alone.
 *
 * It lives inside the sentinel directory because `DS0` holds that directory
 * to one property: nothing reachable from it imports the library. A sentinel
 * that measured rx-nostr through our own code would measure our code, and
 * keep passing while the dependency underneath moved. A member added here that
 * reaches into `$lib` puts the library back on the sentinels' path, and `DS0`'s
 * walk is what notices.
 *
 * `HARNESS_DIVERGENCES` records what these measurements deliberately turn off;
 * the production engine's own harness should say the same, so that a sentinel
 * and a contract test are not taken under two different configurations.
 */

import { WebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import type { EventPacket, IWebSocketConstructor, RxNostr, RxNostrConfig } from 'rx-nostr';
import { createRxNostr } from 'rx-nostr';
import WS from 'vitest-websocket-mock';

let fakeEventSeq = 0;

export interface TestRelay {
  rxNostr: RxNostr;
  server: WS;
}

// mock-socket's `WebSocket` is structurally compatible at runtime (send,
// close, readyState, add/removeEventListener) but its DOM-style overloads
// don't line up with rx-nostr's narrower `IWebSocketConstructor` type.
const websocketCtor = WebSocket as unknown as IWebSocketConstructor;

/**
 * Where this harness deliberately differs from what the library ships.
 *
 * Each divergence exists to make tests deterministic, and each one also blinds
 * the harness to a behaviour that is on by default for real users. **Which
 * provider to compare against is `createNostrContext`, not `NostrApp.svelte`**:
 * this line used to name the legacy component, whose configuration is the v0.x
 * one, so a reader checked the harness against a client the engine does not use.
 *
 * - `skipFetchNip11` — no relay metadata round trip.
 * - `skipExpirationCheck` — **rx-nostr's own default drops NIP-40 expired
 *   events inside `use()`**, before anything downstream sees them. This
 *   library's provider sets it to `true` (B7b), so turning it off here is how a
 *   test measures the *dependency's* behaviour rather than the shipping one —
 *   and the shipping one does not drop expired events at all: it stores them
 *   and hides them at the projection. It does *not* rank them for a retention
 *   slot; that clause stood here for the round in which the bound read a clock.
 * - `retry: 'off'` — **production reconnects (exponential, up to 5) and re-sends
 *   every ongoing REQ on reconnect.**
 *
 * The last two are not test hygiene: they turn off behaviour that decisions are
 * written about. Pass `config` to measure under production defaults instead.
 */
export interface TestRelayConfig {
  skipVerify?: boolean;
  skipFetchNip11?: boolean;
  skipExpirationCheck?: boolean;
  retry?: NonNullable<RxNostrConfig['retry']>;
  /**
   * Not a divergence: rx-nostr's own EOSE timer, left at its default unless a
   * test is measuring the timer itself. Waiting out the 30s default is not a
   * test anybody runs, so the tests that measure it shorten it.
   */
  eoseTimeout?: number;
}

/**
 * `skipVerify` is not among these any more, and that is a change in what it
 * means rather than a relaxation.
 *
 * It used to be the first divergence on the list: tests ran without signature
 * verification and production ran with it, so the harness could not produce the
 * event loss the dependency's `await` causes. The library now builds its client
 * with `skipVerify: true` too and runs its own gate (`referenceStream`'s
 * `verifyEvent`), so a client here without the dependency's verification is
 * what ships rather than a concession. The seam that replaced it is the gate:
 * pass `verifyEvent` to measure a request that verifies.
 */
export const HARNESS_DIVERGENCES: Required<Omit<TestRelayConfig, 'eoseTimeout' | 'skipVerify'>> = {
  skipFetchNip11: true,
  skipExpirationCheck: true,
  retry: { strategy: 'off' }
};

/**
 * The gate a machine-level measurement passes when it is not about the gate.
 *
 * Named and exported rather than written inline at twenty-one call sites, so
 * that "which measurements run without signature verification" is one grep
 * rather than a reading of every object literal. `referenceStream` requires a
 * verifier — an optional one is absent whenever somebody forgets it, which is
 * the configuration the gate exists to prevent — so a test that does not care
 * has to say that it does not care.
 */
export const acceptAnyEvent = async (): Promise<boolean> => true;

export function createTestRelay(url: string, config: TestRelayConfig = {}): TestRelay {
  const server = new WS(url, { jsonProtocol: true });
  const rxNostr = createRxNostr({
    websocketCtor,
    // What the provider writes, not a divergence: the library's gate verifies.
    skipVerify: true,
    ...HARNESS_DIVERGENCES,
    ...config
  });
  rxNostr.setDefaultRelays([url]);

  return { rxNostr, server };
}

export function fakeEvent(overrides: Partial<Nostr.Event> = {}): Nostr.Event {
  fakeEventSeq += 1;

  return {
    id: `id-${fakeEventSeq}`,
    pubkey: 'pubkey-1',
    created_at: fakeEventSeq,
    kind: 1,
    tags: [],
    content: `content-${fakeEventSeq}`,
    sig: 'sig',
    ...overrides
  };
}

export function fakeEventPacket(overrides: Partial<Nostr.Event> = {}): EventPacket {
  const event = fakeEvent(overrides);

  return {
    from: 'wss://relay.example/',
    type: 'EVENT',
    subId: 'sub-1',
    event,
    message: ['EVENT', 'sub-1', event]
  };
}

export async function nextReqSubId(server: WS): Promise<string> {
  const message = (await server.nextMessage) as [string, string, ...unknown[]];
  return message[1];
}

export function respondWithEvent(server: WS, subId: string, event: Nostr.Event): void {
  server.send(['EVENT', subId, event]);
}

export function respondWithEose(server: WS, subId: string): void {
  server.send(['EOSE', subId]);
}
