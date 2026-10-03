/**
 * Where a send goes when the caller names its relays, under a transport that
 * names relays otherwise than this library's own canonicalisation (0003 B-α,
 * `B-α-C15`: a transport that renames is obeyed). The provider is built
 * through `createNostrContext`'s `transportKeys` seam, which is the only way
 * to meet such a transport in this repository: the one it resolves names
 * every relay exactly as `canonicalUrl` does.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import { seckeySigner } from 'rx-nostr-crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { NostrSigner, Send, SendResult } from '$lib/v1/index.js';

import RenamingSend from './fixtures/RenamingSend.svelte';

vi.unmock('svelte');

afterEach(() => {
  WS.clean();
  vi.unstubAllGlobals();
});

const signer = seckeySigner(
  '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a'
) as unknown as NostrSigner;

describe('send targets under a renaming transport', () => {
  it('SN1: a send naming a relay as the transport does, or as the consumer configured it, reaches it', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
    const url = 'ws://localhost:9141';
    const relay = new WS(url, { jsonProtocol: true });
    let send: Send | undefined;
    render(RenamingSend, { relays: [url], signer, seen: (made: Send) => (send = made) });

    // The transport's name for the relay — with the trailing slash this
    // library's canonicalisation would drop — and the spelling the consumer
    // configured. Each reaches the relay, which answers it.
    for (const named of [`${url}/`, url]) {
      const outcome = send?.(
        { kind: 1, content: named, tags: [], created_at: Math.floor(Date.now() / 1000) },
        { relays: [named] }
      );
      // Whichever comes first: a refusal resolves the send before any frame,
      // and is reported as itself rather than as a wait that never ends.
      const first = await Promise.race([
        relay.nextMessage.then((message) => ({ frame: message })),
        (outcome as Promise<SendResult>).then((result) => ({ result }))
      ]);
      expect('frame' in first ? 'sent' : first.result, named).toBe('sent');
      const frame = (first as { frame: unknown }).frame as [
        string,
        { id: string; content: string }
      ];
      expect(frame[0], named).toBe('EVENT');
      expect(frame[1].content, named).toBe(named);
      relay.send(['OK', frame[1].id, true, '']);
      const result = (await outcome) as SendResult;
      expect(result.status, named).toBe('settled');
    }

    // The control: a relay this provider does not hold is still refused.
    const outside = (await send?.(
      { kind: 1, content: 'outside', tags: [], created_at: Math.floor(Date.now() / 1000) },
      { relays: ['ws://localhost:9142'] }
    )) as SendResult;
    expect(outside.status === 'refused' && outside.code).toBe('relay-outside-scope');
  });
});
