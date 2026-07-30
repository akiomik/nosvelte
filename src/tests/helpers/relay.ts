/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { WebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import type { EventPacket, IWebSocketConstructor, RxNostr } from 'rx-nostr';
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

export function createTestRelay(url: string): TestRelay {
  const server = new WS(url, { jsonProtocol: true });
  const rxNostr = createRxNostr({
    websocketCtor,
    skipVerify: true,
    skipFetchNip11: true,
    skipExpirationCheck: true,
    retry: { strategy: 'off' }
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
